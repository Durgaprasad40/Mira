/**
 * UnifiedAnswerComposer - Text + optional media attachment composer
 * Text always remains. User can optionally attach ONE media (audio/photo/video).
 * Identity mode is chosen ONCE per thread answer, then reused for all edits.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  KeyboardAvoidingView, Keyboard, Platform, Alert, ActivityIndicator,
  ScrollView, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FONT_SIZE,
  INCOGNITO_COLORS,
  SPACING,
  SIZES,
  lineHeight,
  moderateScale,
} from '@/lib/constants';
import { InAppMediaCamera, MediaCaptureResult } from './InAppMediaCamera';
import type { TodPrompt } from '@/types';
import {
  TOD_MEDIA_LIMITS,
  TOD_VIDEO_MAX_DURATION_SEC,
  TOD_VOICE_MAX_DURATION_SEC,
  type TodMediaLimitKind,
  formatTodMediaLimit,
  isTodAllowedMime,
  resolveTodMime,
} from '@/lib/todMediaLimits';

const C = INCOGNITO_COLORS;
const MAX_TEXT_CHARS = 400;
const MAX_AUDIO_SEC = TOD_VOICE_MAX_DURATION_SEC;
const TEXT_MAX_SCALE = 1.2;
const HEADER_ICON_SIZE = moderateScale(22, 0.25);
const AUDIO_PREVIEW_ICON_SIZE = moderateScale(34, 0.25);
const AUDIO_REMOVE_ICON_SIZE = SIZES.icon.lg;
const MEDIA_OVERLAY_ICON_SIZE = SIZES.icon.lg;
const VIDEO_OVERLAY_ICON_SIZE = moderateScale(44, 0.25);
const REMOVE_MEDIA_ICON_SIZE = moderateScale(26, 0.25);
const RECORD_STOP_ICON_SIZE = SIZES.icon.md;
const ATTACH_ICON_SIZE = moderateScale(22, 0.25);
// Media chooser accent colors (UI-only)
const MEDIA_GALLERY_COLOR = '#00B894'; // green/teal
const MEDIA_CAMERA_COLOR = '#E94560'; // pink/red
const MEDIA_VOICE_COLOR = '#FF9800'; // orange/yellow
const IDENTITY_OPTION_ICON_SIZE = SIZES.icon.sm;
const VISIBILITY_ICON_SIZE = SIZES.icon.xs;
const SUBMIT_ICON_SIZE = moderateScale(18, 0.25);
const FULLSCREEN_CLOSE_ICON_SIZE = moderateScale(26, 0.25);
const CONFIRM_ICON_SIZE = SIZES.icon.xl;
const SHEET_RADIUS = moderateScale(20, 0.25);
const MODAL_RADIUS = moderateScale(16, 0.25);

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

type ComposerMediaKind = 'photo' | 'video' | 'audio';

function getTodLimitKind(kind: ComposerMediaKind): TodMediaLimitKind {
  return kind === 'audio' ? 'voice' : kind;
}

function normalizePickerDurationMs(duration: number | null | undefined): number | undefined {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return undefined;
  }

  return duration <= TOD_VIDEO_MAX_DURATION_SEC
    ? Math.round(duration * 1000)
    : Math.round(duration);
}

// Identity modes matching backend
export type IdentityMode = 'anonymous' | 'no_photo' | 'profile';

// Attachment types
export interface Attachment {
  kind: 'audio' | 'photo' | 'video';
  uri: string;
  mime?: string;
  durationMs?: number;
  isFrontCamera?: boolean;
}

interface UnifiedAnswerComposerProps {
  visible: boolean;
  prompt: TodPrompt | null;
  /** Initial text for editing */
  initialText?: string;
  /** Initial attachment for editing (existing media) */
  initialAttachment?: Attachment | null;
  /** Existing identity mode (if answer already exists) */
  existingIdentityMode?: IdentityMode;
  /** Whether this is a new answer (show identity picker) or edit (hide picker) */
  isNewAnswer: boolean;
  onClose: () => void;
  /** Called when user submits */
  onSubmit: (params: {
    text: string;
    attachment: Attachment | null;
    removeMedia?: boolean;
    identityMode: IdentityMode;
    mediaVisibility?: 'private' | 'public';
  }) => Promise<void>;
  isSubmitting?: boolean;
}

export function UnifiedAnswerComposer({
  visible,
  prompt,
  initialText,
  initialAttachment,
  existingIdentityMode,
  isNewAnswer,
  onClose,
  onSubmit,
  isSubmitting,
}: UnifiedAnswerComposerProps) {
  const insets = useSafeAreaInsets();
  // Batch 1: responsive compact mode for small Android screens (e.g. OnePlus
  // CPH2691 reports h≈792dp). Mirrors `incognito-create-tod.tsx`'s pattern so
  // the composer behaves the same way under tight keyboard-open layouts.
  const { height: winHeightDp } = useWindowDimensions();
  const isCompact = winHeightDp < 800;

  // Text state
  const [text, setText] = useState(initialText || '');

  // Attachment state
  const [attachment, setAttachment] = useState<Attachment | null>(initialAttachment || null);
  const [mediaRemoved, setMediaRemoved] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  // Identity state - default to anonymous for new, use existing for edits
  const [identityMode, setIdentityMode] = useState<IdentityMode>(
    existingIdentityMode ?? 'anonymous'
  );

  // Media visibility state - only applies to photo/video, default private
  const [mediaVisibility, setMediaVisibility] = useState<'private' | 'public'>('private');

  // UI-only: tracks last tapped media tile so the helper line under the row can
  // show a short context message. Does NOT affect upload / capture / recording.
  const [lastMediaIntent, setLastMediaIntent] = useState<'gallery' | 'camera' | 'voice' | null>(null);

  // Fullscreen media preview state (includes isFrontCamera for unmirror)
  const [fullscreenMedia, setFullscreenMedia] = useState<{
    uri: string;
    type: 'photo' | 'video';
    isFrontCamera?: boolean;
  } | null>(null);

  // In-app media camera state (unified photo+video)
  const [showMediaCamera, setShowMediaCamera] = useState(false);

  // P1-001: Media confirmation modal state
  const [showMediaConfirmModal, setShowMediaConfirmModal] = useState(false);

  // Batch 2: + attachment menu visibility (Gallery / Camera / Voice).
  // Replaces the always-visible 3-button row. UI-only: handlers below
  // (`pickFromGallery`, `openMediaCamera`, `startRecording`) are unchanged.
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Batch 4 fix: track keyboard open/close so we can collapse the sheet's
  // safe-area paddingBottom when the keyboard is up. Without this the
  // sheet keeps `insets.bottom + SPACING.base` of padding under the Post
  // footer, which the KAV's "padding" behavior then sits on top of —
  // producing the visible blank dark strip between Post and the keyboard.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKeyboardOpen(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Refs
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTriggeredRef = useRef(false);
  // M-007 FIX: Track latest recordSeconds to avoid stale closure
  const recordSecondsRef = useRef(0);

  // Extract prompt type for stable dependency (avoids fragile optional chaining in dep array)
  const promptType = prompt?.type ?? null;

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setText(initialText || '');
      setAttachment(initialAttachment || null);
      setMediaRemoved(false);
      setIsRecording(false);
      setRecordSeconds(0);
      setIsPlayingPreview(false);
      setIdentityMode(existingIdentityMode ?? 'anonymous');
      setMediaVisibility('private');
      setFullscreenMedia(null);
      setShowMediaCamera(false);
      setShowAttachMenu(false);
      debugTodLog('[T/D COMPOSER] open', {
        mode: promptType,
        hasExistingAnswer: !!initialText || !!initialAttachment,
        attachmentKind: initialAttachment?.kind ?? 'none',
        identityMode: existingIdentityMode ?? 'anonymous',
        mediaVisibility: 'private',
        hasText: !!(initialText && initialText.length > 0),
      });
    }
  }, [visible, initialText, initialAttachment, existingIdentityMode, promptType]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Recording timer - just increment, no side effects
  useEffect(() => {
    if (isRecording) {
      autoStopTriggeredRef.current = false; // Reset guard when recording starts
      recordSecondsRef.current = 0; // M-007 FIX: Reset ref when recording starts
      intervalRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          const newVal = s + 1;
          recordSecondsRef.current = newVal; // M-007 FIX: Keep ref in sync
          return newVal;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRecording]);

  // Auto-stop at max duration - separate effect to avoid side effects in state setter
  useEffect(() => {
    if (isRecording && recordSeconds >= MAX_AUDIO_SEC && !autoStopTriggeredRef.current) {
      autoStopTriggeredRef.current = true;
      stopRecording();
    }
  }, [isRecording, recordSeconds]);

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow microphone access to record voice messages.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
      setRecordSeconds(0);
    } catch (error) {
      console.error('[T/D Composer] Start recording error:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      setIsRecording(false);

      // M-007 FIX: Use ref for latest duration to avoid stale closure
      const finalSeconds = recordSecondsRef.current;
      if (uri && finalSeconds > 0) {
        if (!validateMediaDuration('audio', finalSeconds * 1000)) {
          return;
        }

        const mime = getValidatedMime('audio', uri, 'audio/mp4');
        if (!mime) {
          return;
        }

        // P2-001: Validate audio file size before attaching
        const fileSize = await getFileSizeBytes(uri);
        if (!validateMediaSize(fileSize, 'audio')) {
          debugTodLog(`[T/D Composer] Voice recording rejected: size ${fileSize} exceeds limit`);
          return; // Size validation failed, don't attach
        }

        setAttachment({
          kind: 'audio',
          uri,
          mime,
          durationMs: finalSeconds * 1000,
        });
        setMediaRemoved(false);
        debugTodLog(`[T/D Composer] Voice recorded: ${finalSeconds}s, size: ${fileSize}`);
      }
    } catch (error) {
      console.error('[T/D Composer] Stop recording error:', error);
      setIsRecording(false);
    }
  };

  const playAudioPreview = async () => {
    if (!attachment || attachment.kind !== 'audio') return;

    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
        setIsPlayingPreview(false);
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: attachment.uri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlayingPreview(false);
            soundRef.current?.unloadAsync();
            soundRef.current = null;
          }
        }
      );

      soundRef.current = sound;
      setIsPlayingPreview(true);
    } catch (error) {
      console.error('[T/D Composer] Playback error:', error);
      setIsPlayingPreview(false);
    }
  };

  // P2-001: Helper to get file size and validate
  const getFileSizeBytes = async (uri: string): Promise<number | null> => {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && 'size' in info) {
        return info.size;
      }
      return null;
    } catch {
      return null;
    }
  };

  // P2-001: Validate file size before attaching
  const validateMediaSize = (sizeBytes: number | null | undefined, kind: ComposerMediaKind): boolean => {
    if (sizeBytes === null || sizeBytes === undefined) {
      // Can't determine size, allow it but log warning
      debugTodWarn('[T/D COMPOSER] Could not determine file size, allowing upload');
      return true;
    }

    const limitKind = getTodLimitKind(kind);
    if (sizeBytes > TOD_MEDIA_LIMITS[limitKind].maxBytes) {
      Alert.alert('File Too Large', formatTodMediaLimit(limitKind));
      return false;
    }
    return true;
  };

  const validateMediaDuration = (kind: ComposerMediaKind, durationMs: number | undefined): boolean => {
    const limitKind = getTodLimitKind(kind);
    if (limitKind !== 'video' && limitKind !== 'voice') {
      return true;
    }

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
  };

  const getValidatedMime = (
    kind: ComposerMediaKind,
    uri: string,
    mime: string | null | undefined
  ): string | undefined => {
    const limitKind = getTodLimitKind(kind);
    const resolvedMime = resolveTodMime(limitKind, uri, mime);
    if (!resolvedMime || !isTodAllowedMime(limitKind, resolvedMime)) {
      Alert.alert('Unsupported media format', 'Unsupported media format.');
      return undefined;
    }
    return resolvedMime;
  };

  // Gallery picker - picks both photos and videos
  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: TOD_VIDEO_MAX_DURATION_SEC,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      const kind = isVideo ? 'video' : 'photo';

      // P2-001: Validate file size before attaching
      // Use asset.fileSize if available, otherwise fetch it
      let fileSize = asset.fileSize;
      if (fileSize === undefined || fileSize === null) {
        fileSize = await getFileSizeBytes(asset.uri) ?? undefined;
      }

      if (!validateMediaSize(fileSize, kind)) {
        return; // Size validation failed, don't attach
      }

      const mime = getValidatedMime(kind, asset.uri, asset.mimeType);
      if (!mime) {
        return;
      }

      const durationMs = isVideo ? normalizePickerDurationMs(asset.duration) : undefined;
      if (isVideo && !validateMediaDuration('video', durationMs)) {
        return;
      }

      setAttachment({
        kind,
        uri: asset.uri,
        mime,
        durationMs,
        isFrontCamera: false, // Gallery picks are not from front camera
      });
      setMediaRemoved(false);
      // Extract URI prefix for logging (handle indexOf returning -1)
      const slashIdx = asset.uri.indexOf('/', 8);
      const uriPrefix = slashIdx === -1
        ? asset.uri.substring(0, Math.min(15, asset.uri.length))
        : asset.uri.substring(0, Math.min(20, slashIdx + 1));
      debugTodLog('[T/D COMPOSER] gallery_pick', {
        kind,
        uriPrefix,
        fileSize,
        durationMs,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to pick media. Please try again.');
    }
  };

  // Open unified in-app camera (photo + video modes)
  const openMediaCamera = useCallback(() => {
    setShowMediaCamera(true);
  }, []);

  // Handle media captured from in-app camera
  const handleMediaCaptured = useCallback(async (result: MediaCaptureResult) => {
    setShowMediaCamera(false);

    if (!validateMediaDuration(result.kind, result.durationMs)) {
      return;
    }

    const mime = getValidatedMime(
      result.kind,
      result.uri,
      result.kind === 'video' ? 'video/mp4' : 'image/jpeg'
    );
    if (!mime) {
      return;
    }

    // P2-001: Validate file size before attaching
    const fileSize = await getFileSizeBytes(result.uri);
    if (!validateMediaSize(fileSize, result.kind)) {
      return; // Size validation failed, don't attach
    }

    setAttachment({
      kind: result.kind,
      uri: result.uri,
      mime,
      durationMs: result.durationMs,
      isFrontCamera: result.isFrontCamera,
    });
    setMediaRemoved(false);
    const uriPrefix = result.uri.startsWith('file://') ? 'file://' : result.uri.substring(0, 10);
    debugTodLog('[T/D COMPOSER] camera_capture', {
      kind: result.kind,
      isFrontCamera: result.isFrontCamera,
      uriPrefix,
      durationMs: result.durationMs,
      fileSize,
    });
  }, []);

  const removeAttachment = () => {
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setAttachment(null);
    setMediaRemoved(true);
    setIsPlayingPreview(false);
  };

  const handleClose = useCallback(() => {
    // Stop any ongoing recording/playback
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsRecording(false);
    setIsPlayingPreview(false);
    debugTodLog('[T/D COMPOSER] close', { hadAttachment: !!attachment, hadText: text.trim().length > 0 });
    onClose();
  }, [onClose, attachment, text]);

  // P1-001: Actual submit logic (extracted for reuse)
  // P1-005 FIX: Include voice messages in visibility handling
  const executeSubmit = useCallback(async () => {
    const trimmedText = text.trim();
    const hasMedia = !!attachment;

    debugTodLog('[T/D COMPOSER] submit_execute', {
      attachmentKind: attachment?.kind ?? 'none',
      identityMode,
      mediaVisibility: hasMedia ? mediaVisibility : 'n/a',
    });

    await onSubmit({
      text: trimmedText,
      attachment,
      removeMedia: mediaRemoved && !attachment,
      identityMode,
      mediaVisibility: hasMedia ? mediaVisibility : undefined,
    });
  }, [text, attachment, mediaRemoved, identityMode, mediaVisibility, onSubmit]);

  const handleSubmit = useCallback(async () => {
    // Validate: text is MANDATORY, media is optional
    const trimmedText = text.trim();
    const hasText = trimmedText.length >= 1;
    const hasAttachment = !!attachment;

    // P1-005 FIX: Track all media types for visibility
    const hasPhotoOrVideo = attachment && (attachment.kind === 'photo' || attachment.kind === 'video');

    debugTodLog('[T/D COMPOSER] submit_start', {
      hasText,
      hasAttachment,
      attachmentKind: attachment?.kind ?? 'none',
      identityMode,
      mediaVisibility: hasAttachment ? mediaVisibility : 'n/a',
      removeMedia: false,
    });

    if (!hasText) {
      Alert.alert('Text Required', 'Please add some text to your comment.');
      return;
    }

    // P1-001: Show confirmation modal for photo/video before submitting
    // Voice messages skip confirmation but still use visibility setting
    if (hasPhotoOrVideo) {
      setShowMediaConfirmModal(true);
      return;
    }

    // No photo/video (including voice) - submit directly
    await executeSubmit();
  }, [text, attachment, identityMode, mediaVisibility, executeSubmit]);

  // P1-001: Handle media confirmation
  const handleMediaConfirmSend = useCallback(async () => {
    setShowMediaConfirmModal(false);
    await executeSubmit();
  }, [executeSubmit]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!prompt) return null;

  const isTruth = prompt.type === 'truth';
  // Text is MANDATORY (media is optional)
  const canSubmit = text.trim().length >= 1 && !isSubmitting && !isRecording;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        // Batch 4 fix: lift the WHOLE composer (header + ScrollView +
        // Reply-as + Post) as one unit when the keyboard opens. We use
        // `behavior="padding"` on both platforms because transparent
        // RN Modals on Android frequently fall back to `adjustPan`
        // even when the manifest declares `adjustResize`, which only
        // pans the focused TextInput and leaves the sticky footer
        // (Post button) below the keyboard. With "padding" the KAV
        // adds a bottom-pad equal to the keyboard height, pushing the
        // sheet upward in one piece. We avoid `behavior="height"` —
        // that one *did* double-shrink with adjustResize and previously
        // hid the footer on small Android screens.
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View
          style={[
            styles.sheet,
            {
              // Batch 4 fix: when the keyboard is open, the KAV's "padding"
              // behavior already lifts the sheet to sit just above the
              // keyboard. Adding the system safe-area inset on top of that
              // produces the visible empty dark strip below Post. Collapse
              // to a tiny breathing-room pad while typing; restore the full
              // safe-area pad when the keyboard is closed so Post still
              // clears the system nav bar at rest.
              paddingBottom: keyboardOpen
                ? SPACING.xs
                : Math.max(insets.bottom, SPACING.base) + SPACING.base,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.badgeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
            </View>
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.promptPreview} numberOfLines={1}>{prompt.text}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={HEADER_ICON_SIZE} color={C.textLight} />
            </TouchableOpacity>
          </View>

          {/* Batch 1: middle content is now a ScrollView so it can shrink and
              scroll when the keyboard reduces available height. The footer
              (Post button) remains sibling of this ScrollView and therefore
              sticky at the bottom of the sheet, always visible above the
              keyboard. `keyboardShouldPersistTaps="handled"` lets users tap
              attachment buttons / chips while the keyboard is open. */}
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={[styles.content, isCompact && styles.contentCompact]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Batch 2: text input wrapped in a card with charCount + plus
                button as a single bottom-right control. Replaces the old
                always-visible 3-button Gallery/Camera/Voice row. */}
            <View style={[styles.inputCard, isCompact && styles.inputCardCompact]}>
              <TextInput
                style={[styles.textInput, isCompact && styles.textInputCompact]}
                placeholder="Write your comment..."
                placeholderTextColor={C.textLight}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={MAX_TEXT_CHARS}
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="noExcludeDescendants"
              />
              <View style={styles.inputCardFooter}>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.inputCardCharCount}>
                  {text.length}/{MAX_TEXT_CHARS}
                </Text>
                {!attachment && !isRecording && (
                  <TouchableOpacity
                    onPress={() => setShowAttachMenu((v) => !v)}
                    style={[styles.plusBtn, showAttachMenu && styles.plusBtnActive]}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={showAttachMenu ? 'close' : 'add'}
                      size={moderateScale(20, 0.25)}
                      color={showAttachMenu ? '#FFF' : C.primary}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Compact + menu — only when no attachment, not recording, and
                user tapped +. Auto-closes once a choice is made. Handlers
                are unchanged: pickFromGallery / openMediaCamera /
                startRecording. */}
            {showAttachMenu && !attachment && !isRecording && (
              <View style={styles.attachMenu}>
                <TouchableOpacity
                  style={[styles.attachMenuItem, styles.attachMenuItemGallery]}
                  onPress={() => { setShowAttachMenu(false); setLastMediaIntent('gallery'); pickFromGallery(); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="images" size={moderateScale(18, 0.25)} color={MEDIA_GALLERY_COLOR} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.attachMenuLabel}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.attachMenuItem, styles.attachMenuItemCamera]}
                  onPress={() => { setShowAttachMenu(false); setLastMediaIntent('camera'); openMediaCamera(); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="camera" size={moderateScale(18, 0.25)} color={MEDIA_CAMERA_COLOR} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.attachMenuLabel}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.attachMenuItem, styles.attachMenuItemVoice]}
                  onPress={() => { setShowAttachMenu(false); setLastMediaIntent('voice'); startRecording(); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="mic" size={moderateScale(18, 0.25)} color={MEDIA_VOICE_COLOR} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.attachMenuLabel}>Voice</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Compact attachment chip — replaces the heavy media tile.
                Tap chip body → existing preview logic (fullscreen for
                photo/video, inline player toggle for voice). X removes
                via existing removeAttachment(). */}
            {attachment && (() => {
              const isAudio = attachment.kind === 'audio';
              const isPhoto = attachment.kind === 'photo';
              const chipIcon: keyof typeof Ionicons.glyphMap = isAudio
                ? (isPlayingPreview ? 'pause-circle' : 'play-circle')
                : isPhoto
                ? 'image'
                : 'videocam';
              const chipAccent = isAudio
                ? MEDIA_VOICE_COLOR
                : isPhoto
                ? MEDIA_GALLERY_COLOR
                : MEDIA_CAMERA_COLOR;
              const chipLabel = isAudio
                ? `Voice · ${formatTime(Math.ceil((attachment.durationMs || 0) / 1000))}`
                : isPhoto
                ? 'Photo attached'
                : 'Video attached';
              const handleChipPress = () => {
                if (isAudio) {
                  playAudioPreview();
                } else {
                  setFullscreenMedia({
                    uri: attachment.uri,
                    type: attachment.kind as 'photo' | 'video',
                    isFrontCamera: attachment.isFrontCamera,
                  });
                }
              };
              debugTodLog(`[T/D Composer] chipRender kind=${attachment.kind} isFrontCamera=${attachment.isFrontCamera}`);
              return (
                <TouchableOpacity
                  style={[styles.attachmentChip, { borderColor: chipAccent + '55', backgroundColor: chipAccent + '14' }]}
                  onPress={handleChipPress}
                  activeOpacity={0.8}
                >
                  <View style={[styles.attachmentChipIcon, { backgroundColor: chipAccent + '22' }]}>
                    <Ionicons name={chipIcon} size={moderateScale(18, 0.25)} color={chipAccent} />
                  </View>
                  <Text
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    style={styles.attachmentChipLabel}
                    numberOfLines={1}
                  >
                    {chipLabel}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    style={styles.attachmentChipHint}
                    numberOfLines={1}
                  >
                    {isAudio ? (isPlayingPreview ? 'Tap to pause' : 'Tap to play') : 'Tap to preview'}
                  </Text>
                  <TouchableOpacity
                    onPress={removeAttachment}
                    style={styles.attachmentChipRemove}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={moderateScale(16, 0.25)} color={C.textLight} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })()}

            {/* Recording indicator */}
            {isRecording && (
              <View style={[styles.recordingIndicator, isCompact && styles.recordingIndicatorCompact]}>
                <View style={styles.recordingDot} />
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.recordingText}>Recording... {formatTime(recordSeconds)}</Text>
                <TouchableOpacity onPress={stopRecording} style={styles.stopRecordBtn}>
                  <Ionicons name="stop" size={RECORD_STOP_ICON_SIZE} color="#FFF" />
                </TouchableOpacity>
              </View>
            )}

            {/* Identity Picker - only show for new answers */}
            {/* Identity Correction: side-by-side compact tiles with dynamic description below */}
            {/* Backend values unchanged: anonymous / no_photo / profile */}
            {/* Batch 4: Reply-as is now text-only chips. Icons were
                removed for a cleaner, premium look. Identity values
                (anonymous / no_photo / profile) and handlers are
                UNCHANGED. Selected chip uses primary tint + glow; the
                helper line below changes copy per selection. */}
            {isNewAnswer && (
              <View style={styles.identityRow}>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.identityRowLabel}>Reply as</Text>
                <View style={styles.identityChipsRow}>
                  <TouchableOpacity
                    style={[styles.identityChip, identityMode === 'anonymous' && styles.identityChipActive]}
                    onPress={() => setIdentityMode('anonymous')}
                    activeOpacity={0.7}
                  >
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      numberOfLines={1}
                      style={[styles.identityChipLabel, identityMode === 'anonymous' && styles.identityChipLabelActive]}
                    >
                      Anonymous
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.identityChip, identityMode === 'no_photo' && styles.identityChipActive]}
                    onPress={() => setIdentityMode('no_photo')}
                    activeOpacity={0.7}
                  >
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      numberOfLines={1}
                      style={[styles.identityChipLabel, identityMode === 'no_photo' && styles.identityChipLabelActive]}
                    >
                      Blur photo
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.identityChip, identityMode === 'profile' && styles.identityChipActive]}
                    onPress={() => setIdentityMode('profile')}
                    activeOpacity={0.7}
                  >
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      numberOfLines={1}
                      style={[styles.identityChipLabel, identityMode === 'profile' && styles.identityChipLabelActive]}
                    >
                      Full profile
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.identityHelperText}>
                  {identityMode === 'anonymous'
                    ? 'No name, no photo'
                    : identityMode === 'no_photo'
                    ? 'Blurred photo, name hidden'
                    : 'Name and photo visible'}
                </Text>
              </View>
            )}

            {/* Batch B: Media Visibility Selector — own card, sibling of identity card */}
            {/* Same gating as before: only when this is a new answer AND an attachment is present */}
            {/* P1-005 FIX: Include voice messages in visibility options */}
            {/* P1-002 FIX: Clearer labels with icons */}
            {isNewAnswer && attachment && (
              <View style={[styles.visibilitySection, isCompact && styles.visibilitySectionCompact]}>
                <View style={[styles.visibilityHeader, isCompact && styles.visibilityHeaderCompact]}>
                  <Ionicons name="eye-outline" size={VISIBILITY_ICON_SIZE} color={C.textLight} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.visibilityTitle}>Who can view your {attachment.kind === 'audio' ? 'voice message' : attachment.kind}?</Text>
                </View>
                <View style={styles.visibilitySegmented}>
                  <TouchableOpacity
                    style={[
                      styles.segmentBtn,
                      isCompact && styles.segmentBtnCompact,
                      mediaVisibility === 'private' && styles.segmentBtnActive,
                    ]}
                    onPress={() => setMediaVisibility('private')}
                  >
                    <Ionicons
                      name="lock-closed"
                      size={VISIBILITY_ICON_SIZE}
                      color={mediaVisibility === 'private' ? '#FFF' : C.textLight}
                      style={styles.segmentIcon}
                    />
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[
                      styles.segmentBtnText,
                      mediaVisibility === 'private' && styles.segmentBtnTextActive,
                    ]}>Just them</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.segmentBtn,
                      isCompact && styles.segmentBtnCompact,
                      mediaVisibility === 'public' && styles.segmentBtnActive,
                    ]}
                    onPress={() => setMediaVisibility('public')}
                  >
                    <Ionicons
                      name="people"
                      size={VISIBILITY_ICON_SIZE}
                      color={mediaVisibility === 'public' ? '#FFF' : C.textLight}
                      style={styles.segmentIcon}
                    />
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[
                      styles.segmentBtnText,
                      mediaVisibility === 'public' && styles.segmentBtnTextActive,
                    ]}>Everyone</Text>
                  </TouchableOpacity>
                </View>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[styles.visibilityHelperText, isCompact && styles.visibilityHelperTextCompact]}>
                  {mediaVisibility === 'private'
                    ? 'Only the prompt creator can view this'
                    : 'Anyone viewing this thread can see it'}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Footer — sticky bottom, sibling of ScrollView. Stays above
              the keyboard on every device because the ScrollView
              absorbs the shrink, not the footer. Batch 4 fix: removed
              the noisy "Tap to view" hint and the borderTop divider so
              Post feels visually attached to the last content row
              (Reply-as helper text, or "Who can view your media?" when
              media is attached). */}
          <View style={[styles.footer, isCompact && styles.footerCompact]}>
            <TouchableOpacity
              style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="send" size={SUBMIT_ICON_SIZE} color="#FFF" />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.submitText}>Post</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Fullscreen Media Preview Modal */}
        <Modal
          visible={!!fullscreenMedia}
          transparent
          animationType="fade"
          onRequestClose={() => setFullscreenMedia(null)}
        >
          <View style={styles.fullscreenOverlay}>
            <TouchableOpacity
              style={[styles.fullscreenClose, { top: insets.top + SPACING.md }]}
              onPress={() => setFullscreenMedia(null)}
            >
              <Ionicons name="close" size={FULLSCREEN_CLOSE_ICON_SIZE} color="#FFF" />
            </TouchableOpacity>

            {fullscreenMedia?.type === 'photo' && (() => {
              const shouldUnmirror = fullscreenMedia.isFrontCamera === true;
              return (
                <Image
                  source={{ uri: fullscreenMedia.uri }}
                  style={[styles.fullscreenMedia, shouldUnmirror && styles.unmirrorMedia]}
                  contentFit="contain"
                />
              );
            })()}

            {fullscreenMedia?.type === 'video' && (() => {
              const shouldUnmirror = fullscreenMedia.isFrontCamera === true;
              return (
                <Video
                  source={{ uri: fullscreenMedia.uri }}
                  style={[styles.fullscreenMedia, shouldUnmirror && styles.unmirrorMedia]}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay
                  useNativeControls
                  isLooping={false}
                />
              );
            })()}
          </View>
        </Modal>

        {/* In-App Media Camera (Photo + Video) */}
        <InAppMediaCamera
          visible={showMediaCamera}
          onClose={() => setShowMediaCamera(false)}
          onMediaCaptured={handleMediaCaptured}
        />

        {/* P1-001: Media Confirmation Modal - Shows visibility choice clearly */}
        <Modal
          visible={showMediaConfirmModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowMediaConfirmModal(false)}
        >
          <View style={styles.mediaConfirmOverlay}>
            <View style={styles.mediaConfirmSheet}>
              <View style={styles.mediaConfirmHeader}>
                <Ionicons
                  name={mediaVisibility === 'private' ? 'lock-closed' : 'people'}
                  size={CONFIRM_ICON_SIZE}
                  color={mediaVisibility === 'private' ? '#00B894' : '#E94560'}
                />
              </View>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaConfirmTitle}>
                {mediaVisibility === 'private' ? 'Send to prompt creator?' : 'Share with everyone?'}
              </Text>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaConfirmMessage}>
                {mediaVisibility === 'private'
                  ? 'Only the prompt creator will be able to view your media. They can view it once.'
                  : 'Anyone viewing this thread will be able to see your media. Each person can view it once.'}
              </Text>
              <View style={styles.mediaConfirmButtons}>
                <TouchableOpacity
                  style={styles.mediaConfirmCancelBtn}
                  onPress={() => setShowMediaConfirmModal(false)}
                >
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaConfirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.mediaConfirmSendBtn,
                    mediaVisibility === 'private' && styles.mediaConfirmSendBtnPrivate,
                  ]}
                  onPress={handleMediaConfirmSend}
                >
                  <Ionicons name="send" size={SIZES.icon.sm} color="#FFF" style={{ marginRight: SPACING.sm - 2 }} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaConfirmSendText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    // Batch 4: drop ~10% off the visible height. Removing `minHeight`
    // lets the sheet contract when the keyboard opens (so Post stays
    // above the keyboard) and avoids the oversized look on tall
    // devices. `maxHeight` still caps it so the header/handle stays
    // clear of the status bar.
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + SPACING.xs,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.base,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  badge: { paddingHorizontal: moderateScale(10, 0.35), paddingVertical: SPACING.xs, borderRadius: SIZES.radius.md },
  badgeText: { fontSize: FONT_SIZE.xs, lineHeight: lineHeight(FONT_SIZE.xs, 1.2), fontWeight: '700', color: '#FFF' },
  promptPreview: { flex: 1, fontSize: FONT_SIZE.body2, lineHeight: lineHeight(FONT_SIZE.body2, 1.35), color: C.textLight },

  // Batch 4: trim vertical paddings so the ScrollView content sits
  // closer to the sticky footer (Post). Bottom padding intentionally
  // small — the footer's own paddingTop provides the visible gap.
  content: { paddingHorizontal: SPACING.base, paddingTop: SPACING.md, paddingBottom: SPACING.sm },

  // Batch 3: premium input card. textInput is transparent inside the
  // card so charCount + plus button feel like one unit.
  // Batch 4: bring the input card back to a normal premium height
  // (96→80) so the composer is not oversized; keep transparent input,
  // soft shadow, and the + button anchored bottom-right.
  textInput: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: SPACING.sm,
    fontSize: FONT_SIZE.md,
    color: C.text,
    lineHeight: lineHeight(FONT_SIZE.md, 1.4),
    minHeight: moderateScale(80, 0.25),
    textAlignVertical: 'top',
  },
  inputCard: {
    backgroundColor: C.surface,
    borderRadius: moderateScale(14, 0.25),
    paddingHorizontal: SPACING.md + 2,
    paddingTop: SPACING.md - 2,
    paddingBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: C.textLight + '1F',
    marginBottom: SPACING.sm + 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  inputCardCompact: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm + 4,
    paddingBottom: SPACING.sm,
    marginBottom: SPACING.sm + 2,
  },
  inputCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
    minHeight: moderateScale(36, 0.25),
  },
  inputCardCharCount: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
    color: C.textLight,
    fontWeight: '500',
  },
  plusBtn: {
    width: moderateScale(36, 0.25),
    height: moderateScale(36, 0.25),
    borderRadius: SIZES.radius.full,
    backgroundColor: C.primary + '1F',
    borderWidth: 1.5,
    borderColor: C.primary + '66',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },

  // + menu (Gallery / Camera / Voice) — compact horizontal row, only
  // shown when user taps +. Auto-closes once a choice is made.
  attachMenu: {
    flexDirection: 'row',
    gap: SPACING.sm + 2,
    marginBottom: SPACING.md,
  },
  attachMenuItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs + 2,
    paddingVertical: SPACING.md - 2,
    paddingHorizontal: SPACING.xs,
    backgroundColor: C.surface,
    borderRadius: moderateScale(12, 0.25),
    borderWidth: 1,
    borderColor: 'transparent',
  },
  attachMenuItemGallery: {
    backgroundColor: MEDIA_GALLERY_COLOR + '14',
    borderColor: MEDIA_GALLERY_COLOR + '33',
  },
  attachMenuItemCamera: {
    backgroundColor: MEDIA_CAMERA_COLOR + '14',
    borderColor: MEDIA_CAMERA_COLOR + '33',
  },
  attachMenuItemVoice: {
    backgroundColor: MEDIA_VOICE_COLOR + '14',
    borderColor: MEDIA_VOICE_COLOR + '33',
  },
  attachMenuLabel: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
    fontWeight: '600',
    color: C.text,
  },

  // Compact attachment chip (shown when media is attached). Tap body =
  // existing preview logic; X = existing remove logic.
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: moderateScale(12, 0.25),
    borderWidth: 1,
    marginBottom: SPACING.sm,
  },
  attachmentChipIcon: {
    width: moderateScale(32, 0.25),
    height: moderateScale(32, 0.25),
    borderRadius: SIZES.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentChipLabel: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.2),
    fontWeight: '600',
    color: C.text,
  },
  attachmentChipHint: {
    flex: 1,
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
    color: C.textLight,
    textAlign: 'right',
  },
  attachmentChipRemove: {
    width: moderateScale(24, 0.25),
    height: moderateScale(24, 0.25),
    borderRadius: SIZES.radius.full,
    backgroundColor: C.textLight + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Batch 3: premium Reply-as section. Bigger chips, vertical
  // icon-on-top layout, clearer active state, helper line below.
  // Batch 4: tighten bottom margin so Post sits right under Reply-as
  // instead of floating at the bottom with empty space.
  identityRow: {
    marginBottom: SPACING.sm,
  },
  identityRowLabel: {
    fontSize: FONT_SIZE.xs,
    lineHeight: lineHeight(FONT_SIZE.xs, 1.2),
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
  },
  identityChipsRow: {
    flexDirection: 'row',
    gap: SPACING.sm + 2,
  },
  identityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Batch 4: text-only chips. Balanced vertical/horizontal padding
    // gives readable height without feeling cramped or oversized. The
    // 12 dp radius reads as a soft pill with the existing 1.5 dp
    // border.
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.sm,
    borderRadius: moderateScale(12, 0.25),
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.textLight + '1F',
  },
  identityChipActive: {
    // Batch 4 fix: drop elevation + shadow* — Android was painting the
    // elevation as a dark horizontal band along the chip bottom, which
    // looked like a leftover icon container behind the label. Selected
    // state is now signalled solely by a clearer coral tint + coral
    // border + coral label (see identityChipLabelActive). No shadows.
    backgroundColor: C.primary + '24',
    borderColor: C.primary,
  },
  identityChipLabel: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  identityChipLabelActive: {
    color: C.primary,
    fontWeight: '700',
  },
  identityHelperText: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    textAlign: 'center',
    // Batch 4: tighter helper margin to keep the section compact.
    marginTop: SPACING.xs + 2,
    fontStyle: 'italic',
  },

  // Attachment preview
  attachmentPreview: { marginBottom: SPACING.sm },

  audioPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + SPACING.xs,
    backgroundColor: C.surface,
    borderRadius: moderateScale(10, 0.25),
    padding: moderateScale(10, 0.35),
  },
  audioPlayBtn: { padding: moderateScale(2, 0.25) },
  audioWaveform: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs, flex: 1 },
  audioBar: { width: moderateScale(3, 0.25), borderRadius: moderateScale(1.5, 0.25), backgroundColor: C.primary },
  audioDuration: { fontSize: FONT_SIZE.caption, lineHeight: lineHeight(FONT_SIZE.caption, 1.2), fontWeight: '600', color: C.textLight },
  removeBtn: { padding: moderateScale(2, 0.25) },

  mediaPreview: {
    height: moderateScale(100, 0.25),
    borderRadius: SIZES.radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  mediaThumbnail: { width: '100%', height: '100%' },
  // Unmirror transform for front camera media
  unmirrorMedia: { transform: [{ scaleX: -1 }] },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaLabel: { fontSize: FONT_SIZE.body2, lineHeight: lineHeight(FONT_SIZE.body2, 1.2), color: '#FFF', fontWeight: '600', marginTop: SPACING.xs },
  removeMediaBtn: { position: 'absolute', top: SPACING.sm, right: SPACING.sm },

  // Recording indicator
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + SPACING.xs,
    backgroundColor: '#F4433620',
    borderRadius: moderateScale(10, 0.25),
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  recordingDot: {
    width: moderateScale(12, 0.25),
    height: moderateScale(12, 0.25),
    borderRadius: SIZES.radius.full,
    backgroundColor: '#F44336',
  },
  recordingText: { flex: 1, fontSize: FONT_SIZE.body, lineHeight: lineHeight(FONT_SIZE.body, 1.2), fontWeight: '600', color: '#F44336' },
  stopRecordBtn: {
    width: moderateScale(32, 0.25),
    height: moderateScale(32, 0.25),
    borderRadius: SIZES.radius.full,
    backgroundColor: '#F44336',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Attachment buttons
  // Batch C: wrapper for helper text + tiles
  attachmentBlock: {
    marginBottom: SPACING.sm,
  },
  attachmentHelperText: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    marginTop: SPACING.sm,
    paddingHorizontal: moderateScale(2, 0.25),
    textAlign: 'center',
  },
  attachmentButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  attachBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xs,
    backgroundColor: C.surface,
    borderRadius: moderateScale(12, 0.25),
    borderWidth: 1,
    borderColor: 'transparent',
  },
  attachBtnText: { fontSize: FONT_SIZE.sm, lineHeight: lineHeight(FONT_SIZE.sm, 1.2), fontWeight: '600', color: C.text },
  // Premium colored tile variants (UI-only accents; behavior unchanged)
  attachBtnGallery: {
    backgroundColor: MEDIA_GALLERY_COLOR + '14',
    borderColor: MEDIA_GALLERY_COLOR + '33',
  },
  attachBtnCamera: {
    backgroundColor: MEDIA_CAMERA_COLOR + '14',
    borderColor: MEDIA_CAMERA_COLOR + '33',
  },
  attachBtnVoice: {
    backgroundColor: MEDIA_VOICE_COLOR + '14',
    borderColor: MEDIA_VOICE_COLOR + '33',
  },

  // Identity picker
  identitySection: {
    backgroundColor: C.surface,
    borderRadius: moderateScale(10, 0.25),
    padding: moderateScale(10, 0.35),
    marginBottom: SPACING.sm,
  },
  identityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm - 2,
    marginBottom: SPACING.sm,
  },
  // Batch A: container that stacks the new title + subtitle
  identityHeaderText: { flex: 1 },
  identityTitle: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.2),
    fontWeight: '600',
    color: C.text,
  },
  // Batch A: new subtitle under "Reply as"
  identitySubtitle: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    marginTop: moderateScale(2, 0.25),
  },
  // Identity Correction: side-by-side tiles + dynamic description
  identityTilesRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  identityTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xs,
    borderRadius: SIZES.radius.sm,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  identityTileActive: {
    backgroundColor: C.primary + '14',
    borderColor: C.primary,
  },
  identityTileLabel: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  identityTileLabelActive: {
    color: C.primary,
  },
  identityDescription: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

  // Media visibility selector (segmented control)
  // P1-002 FIX: Added header styles for clearer visibility section
  // Batch B: Now rendered as its own standalone card, sibling of the identity card.
  visibilitySection: {
    backgroundColor: C.surface,
    borderRadius: moderateScale(10, 0.25),
    padding: moderateScale(10, 0.35),
    marginBottom: SPACING.sm,
  },
  visibilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm - 2,
    marginBottom: SPACING.sm,
  },
  visibilityTitle: { fontSize: FONT_SIZE.body2, lineHeight: lineHeight(FONT_SIZE.body2, 1.2), fontWeight: '600', color: C.text, flex: 1 },
  visibilitySegmented: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: moderateScale(10, 0.35),
    borderRadius: SIZES.radius.sm,
    borderWidth: 1,
    borderColor: C.textLight + '40',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm - 2,
  },
  segmentIcon: { marginRight: moderateScale(2, 0.25) },
  segmentBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  segmentBtnText: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.2),
    fontWeight: '600',
    color: C.textLight,
  },
  segmentBtnTextActive: {
    color: '#FFF',
  },
  visibilityHelperText: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm - 2,
  },

  // Footer — Batch 4 fix: drop the borderTop divider and the
  // "Tap to view" hint so the Post button reads as part of the
  // composer body, not a separate bottom bar. Right-align Post and
  // keep paddings tight so it sits just below the last content row.
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xs,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: C.primary,
    // Batch 4: less oversized — keeps the premium primary glow but
    // matches the tightened footer paddingTop.
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: SIZES.radius.xl,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.32,
    shadowRadius: 6,
    elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.5, shadowOpacity: 0, elevation: 0 },
  submitText: { fontSize: FONT_SIZE.body, lineHeight: lineHeight(FONT_SIZE.body, 1.2), fontWeight: '700', color: '#FFF', letterSpacing: 0.3 },

  // Fullscreen media preview
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenClose: {
    position: 'absolute',
    right: SPACING.lg,
    width: SIZES.touchTarget,
    height: SIZES.touchTarget,
    borderRadius: SIZES.radius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  fullscreenMedia: {
    width: '100%',
    height: '80%',
  },

  // P1-001: Media confirmation modal
  mediaConfirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  mediaConfirmSheet: {
    backgroundColor: C.background,
    borderRadius: MODAL_RADIUS,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: 320,
  },
  mediaConfirmHeader: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  mediaConfirmTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
    color: C.text,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  mediaConfirmMessage: {
    fontSize: FONT_SIZE.body,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    marginBottom: SPACING.xl,
  },
  mediaConfirmButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  mediaConfirmCancelBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: moderateScale(10, 0.25),
    backgroundColor: C.surface,
    alignItems: 'center',
  },
  mediaConfirmCancelText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
    color: C.text,
  },
  mediaConfirmSendBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: SPACING.md,
    borderRadius: moderateScale(10, 0.25),
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // P1-001: Green color for private/secure sends
  mediaConfirmSendBtnPrivate: {
    backgroundColor: '#00B894',
  },
  mediaConfirmSendText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
    color: '#FFF',
  },

  // ────────────────────────────────────────────────────────────────────
  // Batch 1: compact-mode overrides (applied when winHeightDp < 800)
  // Goal: keep ALL controls visible above the keyboard on small Android
  // screens (e.g. OnePlus CPH2691 ≈ 792dp) without changing layout on
  // taller devices. Each *Compact entry only tightens spacing/heights;
  // it never changes colors, fonts, or behavior.
  // ────────────────────────────────────────────────────────────────────
  contentScroll: {
    // Empty by design: the ScrollView itself uses default flexShrink so
    // it absorbs the remaining vertical space between header and footer.
    // Inner paddings live on `content` / `contentCompact` via
    // contentContainerStyle so the scrollbar stays at the edge.
  },
  contentCompact: {
    // Reclaim ~8dp horizontally and ~6dp vertically; the inner cards
    // already have their own padding, so this just trims the gutter.
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.sm,
  },
  textInputCompact: {
    // 80 → 64 dp: still 3 lines of text at default scale, but reclaims
    // ~16dp which is critical when the keyboard is open on small screens.
    minHeight: moderateScale(64, 0.25),
  },
  recordingIndicatorCompact: {
    padding: SPACING.sm + 2,
    marginBottom: SPACING.sm,
  },
  attachmentBlockCompact: {
    marginBottom: SPACING.xs,
  },
  attachmentHelperTextCompact: {
    marginTop: SPACING.xs,
  },
  identitySectionCompact: {
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  identityHeaderCompact: {
    marginBottom: SPACING.xs,
  },
  identityTileCompact: {
    paddingVertical: SPACING.sm,
  },
  identityDescriptionCompact: {
    marginTop: SPACING.xs,
  },
  visibilitySectionCompact: {
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  visibilityHeaderCompact: {
    marginBottom: SPACING.xs,
  },
  segmentBtnCompact: {
    paddingVertical: SPACING.sm,
  },
  visibilityHelperTextCompact: {
    marginTop: SPACING.xs,
  },
  footerCompact: {
    // Batch 4 fix: keep compact-mode footer flush with the body too —
    // the divider/hint are gone, so we no longer need extra breathing
    // room here.
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xs,
  },
});
