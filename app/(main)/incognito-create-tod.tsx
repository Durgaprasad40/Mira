import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
  Modal,
  Platform,
  Alert,
  ActivityIndicator,
  Pressable,
  Dimensions,
  BackHandler,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { uploadMediaToConvex } from '@/lib/uploadUtils';
import { InAppMediaCamera, MediaCaptureResult } from '@/components/truthdare/InAppMediaCamera';
import {
  TOD_MEDIA_LIMITS,
  TOD_VIDEO_MAX_DURATION_SEC,
  formatTodMediaLimit,
  isTodAllowedMime,
  resolveTodMime,
  type TodMediaLimitKind,
} from '@/lib/todMediaLimits';

/** Check if URL is a valid remote URL (http/https) */
function isRemoteUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Check if URL is a local file */
function isLocalFile(url: string | undefined | null): boolean {
  if (!url) return false;
  return url.startsWith('file://') || url.startsWith('content://');
}

/** Check if path is from unstable ImagePicker cache */
function isUnstableCachePath(url: string | undefined | null): boolean {
  if (!url) return false;
  return url.includes('/cache/ImagePicker/') || url.includes('/Cache/ImagePicker/');
}

type PostType = 'truth' | 'dare';
type VisibilityMode = 'anonymous' | 'public' | 'no_photo';
type PromptMediaKind = 'photo' | 'video' | 'voice';

type PromptMediaAttachment = {
  kind: PromptMediaKind;
  uri?: string;
  mime?: string;
  durationMs?: number;
  isFrontCamera?: boolean;
  fileSize?: number;
};

type PromptMediaAction = 'camera' | 'gallery' | 'voice';

const PROMPT_MEDIA_ACTIONS: {
  action: PromptMediaAction;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { action: 'camera', label: 'Camera', icon: 'camera-outline' },
  { action: 'gallery', label: 'Gallery', icon: 'images-outline' },
  { action: 'voice', label: 'Voice', icon: 'mic-outline' },
];

// Per-action premium accent palette for the vertical media popup.
// Subtle layered fill + tinted border + colored shadow gives the illusion
// of a soft gradient without requiring expo-linear-gradient.
const PROMPT_MEDIA_ACTION_ACCENTS: Record<
  PromptMediaAction,
  { fill: string; border: string; iconColor: string; glow: string }
> = {
  camera: {
    fill: 'rgba(255, 122, 150, 0.16)',
    border: 'rgba(255, 122, 150, 0.55)',
    iconColor: '#FF8AA5',
    glow: '#FF7A96',
  },
  gallery: {
    fill: 'rgba(124, 108, 255, 0.18)',
    border: 'rgba(124, 108, 255, 0.55)',
    iconColor: '#A99EFF',
    glow: '#7C6CFF',
  },
  voice: {
    fill: 'rgba(233, 69, 96, 0.20)',
    border: 'rgba(233, 69, 96, 0.60)',
    iconColor: '#FF7A95',
    glow: '#E94560',
  },
};

const PROMPT_MEDIA_LABEL: Record<PromptMediaKind, string> = {
  photo: 'Photo attached',
  video: 'Video attached',
  voice: 'Voice attached',
};

const PROMPT_MEDIA_ICON: Record<PromptMediaKind, keyof typeof Ionicons.glyphMap> = {
  photo: 'image-outline',
  video: 'videocam-outline',
  voice: 'mic-outline',
};

function getTodLimitKindFromPromptKind(kind: PromptMediaKind): TodMediaLimitKind {
  return kind;
}

function normalizePickerDurationMs(duration: number | null | undefined): number | undefined {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return undefined;
  }
  return duration <= TOD_VIDEO_MAX_DURATION_SEC
    ? Math.round(duration * 1000)
    : Math.round(duration);
}

async function getLocalFileSizeBytes(uri: string): Promise<number | undefined> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof (info as any).size === 'number') {
      return (info as any).size as number;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Parse DOB string to calculate age */
function calculateAge(dob: string | undefined): number | undefined {
  if (!dob) return undefined;
  const dobDate = new Date(dob);
  if (isNaN(dobDate.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - dobDate.getFullYear();
  const monthDiff = today.getMonth() - dobDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
    age--;
  }
  return age > 0 ? age : undefined;
}

function isRetryableTodError(error: unknown): boolean {
  const retryableFlag =
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    (error as { retryable?: boolean }).retryable === true;
  if (retryableFlag) {
    return true;
  }

  const message =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: string }).message === 'string'
      ? (error as { message: string }).message.toLowerCase()
      : '';

  return (
    message.includes('network') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('offline') ||
    message.includes('unable to connect') ||
    message.includes('fetch failed') ||
    message.includes('connection')
  );
}

const debugTodLog = (...args: unknown[]) => {
  if (__DEV__) {
    console.log(...args);
  }
};

const debugTodWarn = (...args: unknown[]) => {
  if (__DEV__) {
    console.warn(...args);
  }
};

export default function CreateTodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [postType, setPostType] = useState<PostType>('truth');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<VisibilityMode>('anonymous');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mediaSheetVisible, setMediaSheetVisible] = useState(false);
  const [popupAnchor, setPopupAnchor] = useState<{ bottom: number; right: number } | null>(null);
  const [showMediaCamera, setShowMediaCamera] = useState(false);
  const [promptMediaAttachment, setPromptMediaAttachment] = useState<PromptMediaAttachment | null>(
    null
  );
  const mediaIconRef = useRef<View | null>(null);

  // Get user data from canonical sources
  const userId = useAuthStore((s) => s.userId);

  // Source 1: demoStore - select STABLE primitives
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const effectiveUserId = userId || currentDemoUserId || null;

  // Source 2: privateProfileStore - Phase-2 data
  const p2DisplayName = usePrivateProfileStore((s) => s.displayName);
  const p2Age = usePrivateProfileStore((s) => s.age);
  const p2Gender = usePrivateProfileStore((s) => s.gender);
  const p2PhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const p2BlurredPhotoUrls = usePrivateProfileStore((s) => s.blurredPhotoUrls);

  // Derive identity - collect ALL photo candidates (https preferred, then file://)
  const ownerIdentity = useMemo(() => {
    const preferredDisplayName = p2DisplayName?.trim() || undefined;

    // Collect all photo candidates from Phase-2
    const allP2Photos: string[] = [];
    if (p2PhotoUrls) allP2Photos.push(...p2PhotoUrls.filter(u => u && u.length > 0));
    if (p2BlurredPhotoUrls) allP2Photos.push(...p2BlurredPhotoUrls.filter(u => u && u.length > 0));

    // Try demoStore first (canonical for demo mode)
    const demoProfile = currentDemoUserId ? demoProfiles[currentDemoUserId] : null;

    if (demoProfile) {
      const demoName = preferredDisplayName || demoProfile.name;
      const demoAge = demoProfile.dateOfBirth ? calculateAge(demoProfile.dateOfBirth) : undefined;
      const demoGender = demoProfile.gender;

      // Collect demo photos
      const demoPhotos: string[] = [];
      if (demoProfile.photoSlots) {
        demoPhotos.push(...demoProfile.photoSlots.filter((p): p is string => p !== null && p.length > 0));
      } else if (demoProfile.photos && demoProfile.photos.length > 0) {
        demoPhotos.push(...demoProfile.photos.map(p => p.url).filter(u => u && u.length > 0));
      }

      // Combine: demo photos + P2 photos
      const allPhotos = [...demoPhotos, ...allP2Photos];

      if (demoName) {
        return {
          name: demoName,
          age: demoAge,
          gender: demoGender,
          photoCandidates: allPhotos,
        };
      }
    }

    // Fallback to privateProfileStore (Phase-2 data)
    if (preferredDisplayName) {
      return {
        name: preferredDisplayName,
        age: p2Age > 0 ? p2Age : undefined,
        gender: p2Gender || undefined,
        photoCandidates: allP2Photos,
      };
    }

    // No identity available
    return { name: undefined, age: undefined, gender: undefined, photoCandidates: [] };
  }, [currentDemoUserId, demoProfiles, p2DisplayName, p2Age, p2Gender, p2PhotoUrls, p2BlurredPhotoUrls]);

  // Convex mutation
  const createPrompt = useMutation(api.truthDare.createPrompt);
  const generateUploadUrl = useMutation(api.truthDare.generateUploadUrl);
  const trackPendingTodUploads = useMutation(api.truthDare.trackPendingTodUploads);
  const releasePendingTodUploads = useMutation(api.truthDare.releasePendingTodUploads);
  const cleanupPendingTodUploads = useMutation(api.truthDare.cleanupPendingTodUploads);

  const maxLength = 400;
  const minLength = 20;
  const trimmedLength = content.trim().length;
  const canSubmit =
    trimmedLength >= minLength && !isSubmitting && !!effectiveUserId;

  // Synchronous lock to prevent double-tap race condition
  const isSubmittingRef = useRef(false);
  const mountedRef = useRef(true);
  const localPhotoExistsCacheRef = useRef<Map<string, boolean>>(new Map());
  const prefetchedPhotoResultRef = useRef<{
    cacheKey: string;
    result: { url: string | undefined; type: string; reason: string };
  } | null>(null);
  const ownerPhotoCandidatesKey = useMemo(
    () => (ownerIdentity.photoCandidates || []).join('|'),
    [ownerIdentity.photoCandidates]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Resolve best photo URL from candidates:
   * 1. Prefer https URLs (always valid)
   * 2. Try file:// URLs but verify existence (skip unstable cache paths)
   * 3. Return undefined if no valid photo found
   * Logs a single summary line (no spam).
   */
  async function resolveBestPhoto(candidates: string[]): Promise<{ url: string | undefined; type: string; reason: string }> {
    let remoteCount = 0;
    let skippedCacheCount = 0;
    let verifiedLocalCount = 0;
    let chosenUrl: string | undefined;
    let chosenType = 'none';
    let chosenReason = 'no_valid_candidate';

    // Step A: Count and try https first
    for (const uri of candidates) {
      if (isRemoteUrl(uri)) {
        remoteCount++;
        if (!chosenUrl) {
          chosenUrl = uri;
          chosenType = 'https';
          chosenReason = 'found_remote';
        }
      }
    }

    // Step B: If no remote, try file:// URLs with existence check
    if (!chosenUrl) {
      for (const uri of candidates) {
        if (!isLocalFile(uri)) continue;

        // Skip unstable cache paths
        if (isUnstableCachePath(uri)) {
          skippedCacheCount++;
          continue;
        }

        try {
          let exists = localPhotoExistsCacheRef.current.get(uri);
          if (exists === undefined) {
            const info = await FileSystem.getInfoAsync(uri);
            const size = info.exists ? ((info as any).size || 0) : 0;
            exists = info.exists && size > 0;
            localPhotoExistsCacheRef.current.set(uri, exists);
          }

          if (exists) {
            verifiedLocalCount++;
            if (!chosenUrl) {
              chosenUrl = uri;
              chosenType = 'file';
              chosenReason = 'verified_local';
            }
          }
        } catch {
          // Silently skip errors
        }
      }
    }

    // Single summary log line
    debugTodLog(`[T/D REPORT] photoPick remoteCount=${remoteCount} verifiedLocalCount=${verifiedLocalCount} skippedCacheCount=${skippedCacheCount} chosen=${chosenType} reason=${chosenReason}`);

    return { url: chosenUrl, type: chosenType, reason: chosenReason };
  }

  useEffect(() => {
    // Prefetch best photo for any visibility that ends up sending one (public + no_photo).
    if ((visibility !== 'public' && visibility !== 'no_photo') || ownerIdentity.photoCandidates.length === 0) {
      return;
    }

    if (prefetchedPhotoResultRef.current?.cacheKey === ownerPhotoCandidatesKey) {
      return;
    }

    let cancelled = false;
    resolveBestPhoto(ownerIdentity.photoCandidates)
      .then((result) => {
        if (!cancelled) {
          prefetchedPhotoResultRef.current = {
            cacheKey: ownerPhotoCandidatesKey,
            result,
          };
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [visibility, ownerIdentity.photoCandidates, ownerPhotoCandidatesKey]);

  // ---- Media popup + actions (Camera / Gallery / Voice) ----

  const closeMediaPopup = useCallback(() => {
    setMediaSheetVisible(false);
    setPopupAnchor(null);
  }, []);

  const openMediaPopup = useCallback(() => {
    if (!mediaIconRef.current) {
      setPopupAnchor(null);
      setMediaSheetVisible(true);
      return;
    }
    mediaIconRef.current.measureInWindow?.((x, y, width) => {
      const screen = Dimensions.get('window');
      const POPUP_CIRCLE = 44;
      const ICON_GAP = 12; // visible gap above the + button so it stays uncovered
      // Center each circle horizontally on the + icon; clamp inside screen.
      const iconCenterX = x + width / 2;
      const desiredRight = (screen.width || 360) - (iconCenterX + POPUP_CIRCLE / 2);
      const safeRight = Math.max(8, desiredRight);
      const safeBottom =
        typeof screen.height === 'number' && Number.isFinite(screen.height)
          ? Math.max(60, screen.height - y + ICON_GAP)
          : 80;
      setPopupAnchor({ bottom: safeBottom, right: safeRight });
      setMediaSheetVisible(true);
    });
  }, []);

  // Android back closes the popup before navigating
  useEffect(() => {
    if (!mediaSheetVisible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeMediaPopup();
      return true;
    });
    return () => sub.remove();
  }, [closeMediaPopup, mediaSheetVisible]);

  const validatePromptMediaSize = useCallback(
    (sizeBytes: number | null | undefined, kind: PromptMediaKind): boolean => {
      const limitKind = getTodLimitKindFromPromptKind(kind);
      const maxBytes = TOD_MEDIA_LIMITS[limitKind].maxBytes;
      if (typeof sizeBytes !== 'number' || sizeBytes <= 0) {
        return true; // skip when size unknown; server will re-validate on upload
      }
      if (sizeBytes > maxBytes) {
        Alert.alert('Media Too Large', formatTodMediaLimit(limitKind));
        return false;
      }
      return true;
    },
    []
  );

  const validatePromptMediaDuration = useCallback(
    (kind: PromptMediaKind, durationMs: number | undefined): boolean => {
      const limitKind = getTodLimitKindFromPromptKind(kind);
      if (limitKind !== 'video' && limitKind !== 'voice') return true;
      const durationSec = durationMs ? Math.ceil(durationMs / 1000) : undefined;
      if (
        typeof durationSec !== 'number' ||
        durationSec <= 0 ||
        durationSec > TOD_MEDIA_LIMITS[limitKind].maxDurationSec
      ) {
        Alert.alert('Media Too Long', formatTodMediaLimit(limitKind));
        return false;
      }
      return true;
    },
    []
  );

  const validatePromptMediaMime = useCallback(
    (kind: PromptMediaKind, uri: string, mime: string | null | undefined): string | undefined => {
      const limitKind = getTodLimitKindFromPromptKind(kind);
      const resolved = resolveTodMime(limitKind, uri, mime);
      if (!resolved || !isTodAllowedMime(limitKind, resolved)) {
        Alert.alert('Unsupported media format', 'Unsupported media format.');
        return undefined;
      }
      return resolved;
    },
    []
  );

  const handleCameraAction = useCallback(() => {
    closeMediaPopup();
    setShowMediaCamera(true);
  }, [closeMediaPopup]);

  const handleMediaCaptured = useCallback(
    async (result: MediaCaptureResult) => {
      setShowMediaCamera(false);

      if (!validatePromptMediaDuration(result.kind, result.durationMs)) return;
      const mime = validatePromptMediaMime(
        result.kind,
        result.uri,
        result.kind === 'video' ? 'video/mp4' : 'image/jpeg'
      );
      if (!mime) return;

      const fileSize = await getLocalFileSizeBytes(result.uri);
      if (!validatePromptMediaSize(fileSize, result.kind)) return;

      setPromptMediaAttachment({
        kind: result.kind,
        uri: result.uri,
        mime,
        durationMs: result.durationMs,
        isFrontCamera: result.isFrontCamera,
        fileSize,
      });
      debugTodLog('[T/D NEWPOST] camera_capture', {
        kind: result.kind,
        durationMs: result.durationMs,
        fileSize,
      });
    },
    [validatePromptMediaDuration, validatePromptMediaMime, validatePromptMediaSize]
  );

  const handleGalleryAction = useCallback(async () => {
    closeMediaPopup();
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permission needed',
          'Please allow access to your photos to attach media.'
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: TOD_VIDEO_MAX_DURATION_SEC,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      const kind: PromptMediaKind = isVideo ? 'video' : 'photo';

      let fileSize = asset.fileSize;
      if (fileSize === undefined || fileSize === null) {
        fileSize = (await getLocalFileSizeBytes(asset.uri)) ?? undefined;
      }
      if (!validatePromptMediaSize(fileSize, kind)) return;

      const mime = validatePromptMediaMime(kind, asset.uri, asset.mimeType);
      if (!mime) return;

      const durationMs = isVideo ? normalizePickerDurationMs(asset.duration) : undefined;
      if (isVideo && !validatePromptMediaDuration('video', durationMs)) return;

      setPromptMediaAttachment({
        kind,
        uri: asset.uri,
        mime,
        durationMs,
        isFrontCamera: false,
        fileSize: typeof fileSize === 'number' ? fileSize : undefined,
      });
      debugTodLog('[T/D NEWPOST] gallery_pick', { kind, durationMs, fileSize });
    } catch (error) {
      Alert.alert('Error', 'Failed to pick media. Please try again.');
    }
  }, [
    closeMediaPopup,
    validatePromptMediaDuration,
    validatePromptMediaMime,
    validatePromptMediaSize,
  ]);

  const handleVoiceAction = useCallback(() => {
    closeMediaPopup();
    // Voice prompt recording is not yet implemented end-to-end. The previous
    // build attached a no-uri "mock" placeholder which `handleSubmit` would
    // have silently dropped (Phase 3 wiring would have created a fake-voice
    // post). To avoid that, we surface a clear coming-soon notice and do not
    // set any attachment state. The voice option remains available so users
    // can discover the upcoming capability.
    Alert.alert(
      'Coming Soon',
      'Voice prompts are coming soon. For now, attach a photo or video, or post text only.'
    );
    debugTodLog('[T/D NEWPOST] voice_action_coming_soon');
  }, [closeMediaPopup]);

  const handleMediaActionTap = useCallback(
    (action: PromptMediaAction) => {
      if (action === 'camera') return handleCameraAction();
      if (action === 'gallery') return handleGalleryAction();
      return handleVoiceAction();
    },
    [handleCameraAction, handleGalleryAction, handleVoiceAction]
  );

  const handleSubmit = async () => {
    // Synchronous guard: prevent double-tap race condition
    if (!canSubmit || isSubmittingRef.current) return;
    if (!effectiveUserId) {
      Alert.alert('Session Required', 'Please wait for your session to finish loading and try again.');
      return;
    }
    isSubmittingRef.current = true;
    const uploadedStorageIds: string[] = [];

    if (mountedRef.current) {
      setIsSubmitting(true);
    }

    try {
      const trackUploadedStorageId = async (storageId: string | undefined) => {
        if (!storageId) return;
        uploadedStorageIds.push(storageId);
        try {
          await trackPendingTodUploads({
            storageIds: [storageId as any],
            // Required: server uses two-tier auth (identity → authUserId fallback);
            // omitting this throws Unauthorized in demo/custom-auth mode.
            authUserId: effectiveUserId,
          });
        } catch (trackError) {
          debugTodWarn('[T/D] Failed to track pending post upload:', trackError);
        }
      };

      // ---- Phase 3: prompt-owner media upload ----
      // Resolve any attached prompt media (photo/video) to a Convex storage
      // reference BEFORE calling createPrompt. Voice is intentionally not
      // wired yet — handleVoiceAction surfaces a coming-soon notice and never
      // sets an attachment, so the `voice` branch below is purely defensive.
      // Errors thrown here propagate to the outer catch which (a) skips
      // createPrompt, (b) cleans up tracked uploads when non-retryable,
      // (c) surfaces an alert, and (d) leaves the user on the composer
      // with their text content intact for retry.
      const promptMediaArgs: {
        mediaStorageId?: any;
        mediaMime?: string;
        mediaKind?: PromptMediaKind;
        durationSec?: number;
        isFrontCamera?: boolean;
      } = {};

      if (promptMediaAttachment) {
        if (promptMediaAttachment.kind === 'voice') {
          // Defensive: voice attachments cannot exist via the UI in Phase 3
          // (handleVoiceAction shows a coming-soon alert without setting
          // state). Block submission rather than silently dropping/faking.
          throw Object.assign(
            new Error('Voice prompts are coming soon. Remove the voice attachment to post.'),
            { retryable: false }
          );
        }

        if (!promptMediaAttachment.uri || !promptMediaAttachment.mime) {
          throw Object.assign(
            new Error('Attached media is unavailable. Please remove and re-attach it.'),
            { retryable: false }
          );
        }

        // Re-validate size at submit time (file may have been replaced/cleared).
        const submitTimeSize = await getLocalFileSizeBytes(promptMediaAttachment.uri);
        if (!validatePromptMediaSize(submitTimeSize ?? promptMediaAttachment.fileSize, promptMediaAttachment.kind)) {
          // validatePromptMediaSize already showed an alert; skip createPrompt.
          isSubmittingRef.current = false;
          if (mountedRef.current) setIsSubmitting(false);
          return;
        }
        if (!validatePromptMediaDuration(promptMediaAttachment.kind, promptMediaAttachment.durationMs)) {
          isSubmittingRef.current = false;
          if (mountedRef.current) setIsSubmitting(false);
          return;
        }

        const limitKind: TodMediaLimitKind = promptMediaAttachment.kind; // 'photo' | 'video'
        const uploadType: 'photo' | 'video' = promptMediaAttachment.kind;

        const promptMediaStorageId = await uploadMediaToConvex(
          promptMediaAttachment.uri,
          () => generateUploadUrl({ authUserId: effectiveUserId }),
          uploadType,
          {
            contentType: promptMediaAttachment.mime,
            maxBytes: TOD_MEDIA_LIMITS[limitKind].maxBytes,
            limitMessage: formatTodMediaLimit(limitKind),
          }
        );
        await trackUploadedStorageId(promptMediaStorageId);

        const durationSec =
          typeof promptMediaAttachment.durationMs === 'number' &&
          promptMediaAttachment.durationMs > 0
            ? Math.max(1, Math.ceil(promptMediaAttachment.durationMs / 1000))
            : undefined;

        promptMediaArgs.mediaStorageId = promptMediaStorageId;
        promptMediaArgs.mediaMime = promptMediaAttachment.mime;
        promptMediaArgs.mediaKind = promptMediaAttachment.kind;
        if (durationSec !== undefined) promptMediaArgs.durationSec = durationSec;
        if (typeof promptMediaAttachment.isFrontCamera === 'boolean') {
          promptMediaArgs.isFrontCamera = promptMediaAttachment.isFrontCamera;
        }

        debugTodLog('[T/D NEWPOST] prompt_media_uploaded', {
          kind: promptMediaAttachment.kind,
          mime: promptMediaAttachment.mime,
          durationSec,
          isFrontCamera: promptMediaAttachment.isFrontCamera ?? false,
          sizeBytes: submitTimeSize ?? promptMediaAttachment.fileSize,
        });
      }

      // TOD-001 FIX: Use authUserId for server-side verification
      if (visibility === 'anonymous') {
        // Anonymous: no identity, no photo
        await createPrompt({
          type: postType,
          text: content.trim(),
          authUserId: effectiveUserId,
          isAnonymous: true,
          photoBlurMode: 'none',
          ...promptMediaArgs,
        });
        debugTodLog(`[T/D REPORT] created visibility=anonymous mediaKind=${promptMediaArgs.mediaKind ?? 'none'}`);
      } else if (visibility === 'no_photo') {
        // Without photo: identity visible, blur applied client-side over real photo.
        // We must send a real ownerPhotoUrl (or storageId) so TodAvatar can render
        // the actual photo behind the blur. Otherwise TodAvatar falls through to
        // the initial-letter placeholder. Mirror the public branch resolve+upload
        // flow, then send the resulting URL with photoBlurMode='blur'.
        const photoResultNoPhoto =
          prefetchedPhotoResultRef.current?.cacheKey === ownerPhotoCandidatesKey
            ? prefetchedPhotoResultRef.current.result
            : await resolveBestPhoto(ownerIdentity.photoCandidates || []);

        let ownerPhotoUrlNoPhoto: string | undefined;
        let ownerPhotoStorageIdNoPhoto: any;

        if (photoResultNoPhoto.url) {
          if (photoResultNoPhoto.type === 'file') {
            try {
              ownerPhotoStorageIdNoPhoto = await uploadMediaToConvex(
                photoResultNoPhoto.url,
                () => generateUploadUrl({ authUserId: effectiveUserId }),
                'photo'
              );
              await trackUploadedStorageId(ownerPhotoStorageIdNoPhoto);
            } catch (uploadError) {
              // Upload failed - proceed without photo (renderer will fall back gracefully)
              debugTodWarn('[T/D] Photo upload failed for no_photo mode, proceeding without photo:', uploadError);
            }
          } else {
            ownerPhotoUrlNoPhoto = photoResultNoPhoto.url;
          }
        }

        await createPrompt({
          type: postType,
          text: content.trim(),
          authUserId: effectiveUserId,
          isAnonymous: false,
          photoBlurMode: 'blur', // blur treatment applied client-side over the real photo
          ownerName: ownerIdentity.name,
          ownerAge: ownerIdentity.age,
          ownerGender: ownerIdentity.gender,
          ownerPhotoUrl: ownerPhotoUrlNoPhoto,
          ownerPhotoStorageId: ownerPhotoStorageIdNoPhoto,
          ...promptMediaArgs,
        });

        const photoStatusNoPhoto = ownerPhotoUrlNoPhoto ? 'url' : ownerPhotoStorageIdNoPhoto ? 'uploaded' : 'none';
        debugTodLog(`[T/D REPORT] created visibility=no_photo photoBlurMode=blur photoStatus=${photoStatusNoPhoto} resolveResult=${photoResultNoPhoto.type} mediaKind=${promptMediaArgs.mediaKind ?? 'none'}`);
      } else {
        // Everyone (public): identity + photo (photo is optional - graceful fallback)
        const photoResult =
          prefetchedPhotoResultRef.current?.cacheKey === ownerPhotoCandidatesKey
            ? prefetchedPhotoResultRef.current.result
            : await resolveBestPhoto(ownerIdentity.photoCandidates || []);

        let ownerPhotoUrl: string | undefined;
        let ownerPhotoStorageId: any;

        if (photoResult.url) {
          // Photo found - upload if local file, or use URL directly
          if (photoResult.type === 'file') {
            try {
              ownerPhotoStorageId = await uploadMediaToConvex(
                photoResult.url,
                () => generateUploadUrl({ authUserId: effectiveUserId }),
                'photo'
              );
              await trackUploadedStorageId(ownerPhotoStorageId);
            } catch (uploadError) {
              // Upload failed - proceed without photo rather than blocking
              debugTodWarn('[T/D] Photo upload failed, proceeding without photo:', uploadError);
            }
          } else {
            ownerPhotoUrl = photoResult.url;
          }
        }
        // If no photo found or upload failed, proceed without photo (backend accepts optional ownerPhotoUrl)
        // User selected "public" visibility, so identity is still shown - just without photo

        await createPrompt({
          type: postType,
          text: content.trim(),
          authUserId: effectiveUserId,
          isAnonymous: false,
          photoBlurMode: 'none',
          ownerName: ownerIdentity.name,
          ownerAge: ownerIdentity.age,
          ownerGender: ownerIdentity.gender,
          ownerPhotoUrl,
          ownerPhotoStorageId,
          ...promptMediaArgs,
        });

        const photoStatus = ownerPhotoUrl ? 'url' : ownerPhotoStorageId ? 'uploaded' : 'none';
        debugTodLog(`[T/D REPORT] created visibility=public photoStatus=${photoStatus} resolveResult=${photoResult.type} mediaKind=${promptMediaArgs.mediaKind ?? 'none'}`);
      }

      if (uploadedStorageIds.length > 0) {
        try {
          await releasePendingTodUploads({
            storageIds: uploadedStorageIds as any,
            authUserId: effectiveUserId,
          });
        } catch (releaseError) {
          debugTodWarn('[T/D] Failed to release pending post uploads:', releaseError);
        }
      }

      router.back();
    } catch (error: any) {
      console.error('[T/D UI] Post failed:', error);
      const retryableError = isRetryableTodError(error);

      if (!retryableError && uploadedStorageIds.length > 0) {
        try {
          await cleanupPendingTodUploads({
            storageIds: uploadedStorageIds as any,
            authUserId: effectiveUserId,
          });
        } catch (cleanupError) {
          debugTodWarn('[T/D] Failed to clean up pending post uploads:', cleanupError);
        }
      }

      if (retryableError) {
        Alert.alert(
          'Post Unconfirmed',
          'We could not confirm your post was created. Check the feed before trying again.'
        );
      } else {
        Alert.alert('Error', error?.message || 'Failed to create your post. Please try again.');
      }
    } finally {
      isSubmittingRef.current = false;
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const C = INCOGNITO_COLORS;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
      >
        {/* Header - close button only, no Post button here */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="close" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Post</Text>
          {/* Spacer for alignment */}
          <View style={{ width: 24 }} />
        </View>

        {/* Truth/Dare selector */}
        <View style={styles.typeSelector}>
          <TouchableOpacity
            style={[styles.typeOption, postType === 'truth' && styles.typeOptionActive]}
            onPress={() => setPostType('truth')}
          >
            <Ionicons name="help-circle" size={20} color={postType === 'truth' ? '#FFFFFF' : C.text} />
            <Text style={[styles.typeLabel, postType === 'truth' && styles.typeLabelActive]}>Truth</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeOption, postType === 'dare' && styles.typeOptionDareActive]}
            onPress={() => setPostType('dare')}
          >
            <Ionicons name="flash" size={20} color={postType === 'dare' ? '#FFFFFF' : C.text} />
            <Text style={[styles.typeLabel, postType === 'dare' && styles.typeLabelActive]}>Dare</Text>
          </TouchableOpacity>
        </View>

        {/* Input */}
        <View style={styles.inputContainer}>
          <View style={styles.inputCard}>
            <TextInput
              style={styles.textInput}
              placeholder={
                postType === 'truth'
                  ? 'Ask a truth question...'
                  : 'Write a dare challenge...'
              }
              placeholderTextColor={C.textLight}
              multiline
              maxLength={maxLength}
              value={content}
              onChangeText={setContent}
              autoFocus
            />
            <View style={styles.inputCardFooter} pointerEvents="box-none">
              {promptMediaAttachment ? (
                <View style={styles.inputAttachmentPill}>
                  <Ionicons
                    name={PROMPT_MEDIA_ICON[promptMediaAttachment.kind]}
                    size={13}
                    color={C.primary}
                  />
                  <Text
                    style={styles.inputAttachmentText}
                    numberOfLines={1}
                  >
                    {PROMPT_MEDIA_LABEL[promptMediaAttachment.kind]}
                  </Text>
                  <TouchableOpacity
                    style={styles.inputAttachmentRemove}
                    onPress={() => setPromptMediaAttachment(null)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Remove attached media"
                  >
                    <Ionicons name="close" size={13} color={C.textLight} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <View ref={mediaIconRef} collapsable={false}>
                <TouchableOpacity
                  style={styles.inputMediaButton}
                  onPress={openMediaPopup}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    promptMediaAttachment ? 'Change attached media' : 'Add media'
                  }
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={promptMediaAttachment ? 'swap-horizontal' : 'add'}
                    size={22}
                    color={C.primary}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* 3-Option Visibility Selector */}
        <View style={styles.visibilityContainer}>
          <Text style={styles.visibilityLabel}>Who can see your identity?</Text>
          <View style={styles.visibilityOptions}>
            {/* Anonymous */}
            <TouchableOpacity
              style={[styles.visibilityOption, visibility === 'anonymous' && styles.visibilityOptionActive]}
              onPress={() => setVisibility('anonymous')}
            >
              <Ionicons
                name="eye-off"
                size={18}
                color={visibility === 'anonymous' ? '#FFFFFF' : C.text}
              />
              <Text style={[styles.visibilityText, visibility === 'anonymous' && styles.visibilityTextActive]}>
                Anonymous
              </Text>
            </TouchableOpacity>

            {/* Public */}
            <TouchableOpacity
              style={[styles.visibilityOption, visibility === 'public' && styles.visibilityOptionActive]}
              onPress={() => setVisibility('public')}
            >
              <Ionicons
                name="person"
                size={18}
                color={visibility === 'public' ? '#FFFFFF' : C.text}
              />
              <Text style={[styles.visibilityText, visibility === 'public' && styles.visibilityTextActive]}>
                Everyone
              </Text>
            </TouchableOpacity>

            {/* Without photo */}
            <TouchableOpacity
              style={[styles.visibilityOption, visibility === 'no_photo' && styles.visibilityOptionActive]}
              onPress={() => setVisibility('no_photo')}
            >
              <Ionicons
                name="person-outline"
                size={18}
                color={visibility === 'no_photo' ? '#FFFFFF' : C.text}
              />
              <Text style={[styles.visibilityText, visibility === 'no_photo' && styles.visibilityTextActive]}>
                Blur photo
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.visibilityHint}>
            {visibility === 'anonymous'
              ? 'Your identity is completely hidden'
              : visibility === 'public'
              ? 'Your profile photo is visible'
              : 'Your name is visible, photo is blurred'}
          </Text>

          {promptMediaAttachment && (visibility === 'anonymous' || visibility === 'no_photo') ? (
            <View style={styles.identityWarning}>
              <Ionicons
                name="information-circle-outline"
                size={13}
                color={C.textLight}
                style={styles.identityWarningIcon}
              />
              <Text style={styles.identityWarningText}>
                Media may reveal your identity.
              </Text>
            </View>
          ) : null}

          {/* Inline POST button — standalone form action placed directly
              below the identity section. Not sticky, not a footer, and
              not attached to the keyboard. Scrolls with the rest of the
              composer content. */}
          <TouchableOpacity
            style={[styles.postButtonMain, !canSubmit && styles.postButtonMainDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={[styles.postButtonMainText, !canSubmit && styles.postButtonMainTextDisabled]}>
                POST
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={mediaSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={closeMediaPopup}
      >
        <Pressable
          style={styles.mediaPopupBackdrop}
          onPress={closeMediaPopup}
          accessibilityRole="button"
          accessibilityLabel="Close media menu"
        >
          {popupAnchor ? (
            <Pressable
              style={[
                styles.mediaPopupCard,
                { bottom: popupAnchor.bottom, right: popupAnchor.right },
              ]}
              // Stop propagation so taps inside the card don't dismiss
              onPress={(event) => event.stopPropagation?.()}
            >
              {PROMPT_MEDIA_ACTIONS.map((option) => {
                const accent = PROMPT_MEDIA_ACTION_ACCENTS[option.action];
                return (
                  <TouchableOpacity
                    key={option.action}
                    style={styles.mediaPopupCircle}
                    onPress={() => handleMediaActionTap(option.action)}
                    activeOpacity={0.75}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                  >
                    {/* Outer ring carries the colored shadow / glow */}
                    <View
                      style={[
                        styles.mediaPopupCircleOuter,
                        {
                          borderColor: accent.border,
                          shadowColor: accent.glow,
                        },
                      ]}
                    >
                      {/* Inner tinted fill on top of the elevated dark base */}
                      <View
                        style={[
                          styles.mediaPopupCircleInner,
                          { backgroundColor: accent.fill },
                        ]}
                      >
                        <Ionicons name={option.icon} size={22} color={accent.iconColor} />
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      <InAppMediaCamera
        visible={showMediaCamera}
        onClose={() => setShowMediaCamera(false)}
        onMediaCaptured={handleMediaCaptured}
      />
    </KeyboardAvoidingView>
  );
}

const C = INCOGNITO_COLORS;

// Premium dark-tier tokens for this composer only — keep surgical and local.
const PREMIUM = {
  surfaceElevated: '#1F1F3D',     // elevated card / chip inactive
  surfaceHighlight: '#252548',    // pressed / active subtle
  hairline: 'rgba(255,255,255,0.06)',
  hairlineStrong: 'rgba(255,255,255,0.10)',
  coralGlow: 'rgba(233, 69, 96, 0.22)',
  coralSoft: 'rgba(233, 69, 96, 0.10)',
  truthAccent: '#6C5CE7',          // brand indigo for Truth (unchanged)
  dareAccent: '#E17055',           // brand coral-orange for Dare (unchanged)
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scrollContent: { flexGrow: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PREMIUM.hairline,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    letterSpacing: 0.3,
  },

  // Truth / Dare segmented toggle
  typeSelector: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 10,
  },
  typeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    backgroundColor: PREMIUM.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PREMIUM.hairline,
  },
  typeOptionActive: {
    backgroundColor: PREMIUM.truthAccent,
    borderColor: PREMIUM.truthAccent,
    shadowColor: PREMIUM.truthAccent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 6,
  },
  typeOptionDareActive: {
    backgroundColor: PREMIUM.dareAccent,
    borderColor: PREMIUM.dareAccent,
    shadowColor: PREMIUM.dareAccent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 6,
  },
  typeLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    letterSpacing: 0.4,
  },
  typeLabelActive: { color: '#FFFFFF' },

  // Compose card
  inputContainer: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  inputCard: {
    backgroundColor: PREMIUM.surfaceElevated,
    borderRadius: 16,
    paddingBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PREMIUM.hairlineStrong,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 3,
  },
  textInput: {
    fontSize: 16,
    color: C.text,
    minHeight: 120,
    textAlignVertical: 'top',
    paddingTop: 18,
    paddingBottom: 10,
    paddingLeft: 18,
    paddingRight: 18,
    lineHeight: 24,
  },
  inputCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 10,
    paddingBottom: 8,
    minHeight: 44,
    gap: 8,
  },
  inputMediaButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PREMIUM.surfaceHighlight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PREMIUM.hairlineStrong,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  inputAttachmentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.primary,
    backgroundColor: PREMIUM.coralSoft,
    maxWidth: '80%',
  },
  inputAttachmentText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.text,
    flexShrink: 1,
    letterSpacing: 0.2,
  },
  inputAttachmentRemove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
    marginLeft: 2,
  },
  // Identity chips
  visibilityContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  visibilityLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    marginBottom: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    opacity: 0.85,
  },
  visibilityOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  visibilityOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: PREMIUM.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PREMIUM.hairline,
  },
  visibilityOptionActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.34,
    shadowRadius: 12,
    elevation: 5,
  },
  visibilityText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.text,
    letterSpacing: 0.3,
  },
  visibilityTextActive: {
    color: '#FFFFFF',
  },
  visibilityHint: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 8,
    textAlign: 'center',
    letterSpacing: 0.2,
    opacity: 0.85,
  },

  // Subtle privacy warning shown only when media is attached AND identity is hidden.
  // Premium dark-tier styling: muted text + info glyph; never blocks posting.
  identityWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  identityWarningIcon: {
    marginRight: 4,
    opacity: 0.85,
  },
  identityWarningText: {
    fontSize: 11,
    color: C.textLight,
    letterSpacing: 0.2,
    opacity: 0.85,
  },

  // Main POST button — inline standalone form action. Sits inside the
  // ScrollView under the identity hint/warning. Compact top/bottom spacing
  // keeps it close to the identity section without empty area below.
  postButtonMain: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    marginBottom: 24,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.36,
    shadowRadius: 18,
    elevation: 8,
  },
  postButtonMainDisabled: {
    backgroundColor: PREMIUM.surfaceElevated,
    shadowOpacity: 0,
    elevation: 0,
  },
  postButtonMainText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1.6,
  },
  postButtonMainTextDisabled: {
    color: C.textLight,
  },

  // Vertical media popup
  mediaPopupBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  mediaPopupCard: {
    position: 'absolute',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'transparent',
  },
  // Tap target — keeps the ~46dp circle hit area, transparent so the layered
  // outer/inner rings carry the visual styling.
  mediaPopupCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  // Outer ring: dark elevated base + colored hairline border + colored glow
  // shadow. Provides the premium "ring of light" silhouette.
  mediaPopupCircleOuter: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PREMIUM.surfaceElevated,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  // Inner fill: per-action tinted color layered ON TOP of the elevated dark
  // base. The translucent tint over the dark fill gives a soft gradient feel
  // without needing expo-linear-gradient.
  mediaPopupCircleInner: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
