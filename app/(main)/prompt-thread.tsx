import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, Animated, Pressable, BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import { Audio, Video, ResizeMode } from 'expo-av';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { TodAvatar } from '@/components/truthdare/TodAvatar';
import { UnifiedAnswerComposer, IdentityMode, Attachment } from '@/components/truthdare/UnifiedAnswerComposer';
// NOTE: `TodVoicePlayer` (the horizontal pill-shaped voice player) is no
// longer rendered in this thread/response card. Voice playback now happens
// inside the same compact 84×84 media tile used for photo/video — see
// `handleToggleVoiceTile` and the tile JSX further below. The component
// file itself is left untouched in case other Truth/Dare surfaces want to
// render it later.
import { uploadMediaToConvex } from '@/lib/uploadUtils';
import { getTimeAgo } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import type { TodReportReason } from '@/types';

const C = INCOGNITO_COLORS;
const PHASE2_TOD_HOME_ROUTE = '/(main)/(private)/(tabs)/truth-or-dare';

// Premium color palette for elevated UI
const PREMIUM = {
  bgDeep: '#0D0D1A',
  bgBase: '#141428',
  bgElevated: '#1C1C36',
  bgHighlight: '#252545',
  coral: '#E94560',
  coralSoft: '#FF6B8A',
  truthPurple: '#7C6AEF',
  truthPurpleSoft: '#9D8DF7',
  dareOrange: '#FF7849',
  dareOrangeSoft: '#FF9A76',
  textPrimary: '#F5F5F7',
  textSecondary: '#B8B8C7',
  textMuted: '#6E6E82',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderAccent: 'rgba(233, 69, 96, 0.3)',
  glowPurple: 'rgba(124, 106, 239, 0.15)',
  glowOrange: 'rgba(255, 120, 73, 0.15)',
  // Gender accent colors (subtle)
  genderFemale: '#FF8FA3',
  genderMale: '#7DB9FF',
  genderOther: '#B8B8C7',
};

// Available emoji reactions
const REACTION_EMOJIS = ['😂', '🔥', '😍', '👏', '😮', '💀'];

// Report reason options must stay aligned with the backend reasonCode union.
const REPORT_REASONS: { code: TodReportReason; label: string; icon: string }[] = [
  { code: 'harassment', label: 'Harassment', icon: '🚫' },
  { code: 'sexual', label: 'Sexual Content', icon: '🔞' },
  { code: 'spam', label: 'Spam', icon: '📢' },
  { code: 'hate', label: 'Hate Speech', icon: '💢' },
  { code: 'violence', label: 'Violence', icon: '⚠️' },
  { code: 'privacy', label: 'Privacy Violation', icon: '🔒' },
  { code: 'scam', label: 'Scam', icon: '💰' },
  { code: 'other', label: 'Other', icon: '📝' },
];

// Voice playback timer helper — formats milliseconds as `m:ss`. Used by
// the compact voice tile to show "0:03 / 0:10" while playing. Stays at
// module scope so the per-render renderItem closure stays cheap.
function formatVoiceClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Time remaining helper
function formatTimeLeft(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h left`;
  return `${minutes}m left`;
}

type ThreadAuthorProfile = {
  name?: string;
  age?: number;
  gender?: string;
  photoUrl?: string;
};

type ThreadAnswerIdentitySource = {
  identityMode?: IdentityMode | null;
  isAnonymous?: boolean | null;
  photoBlurMode?: 'none' | 'blur' | null;
  authorName?: string | null;
  authorPhotoUrl?: string | null;
  authorAge?: number | null;
  authorGender?: string | null;
};

function resolveThreadAnswerIdentity(
  answer: ThreadAnswerIdentitySource,
  fallbackProfile: ThreadAuthorProfile,
  isOwnAnswer: boolean
) {
  const identityMode: IdentityMode =
    answer.identityMode === 'anonymous' ||
    answer.identityMode === 'no_photo' ||
    answer.identityMode === 'profile'
      ? answer.identityMode
      : answer.isAnonymous !== false
        ? 'anonymous'
        : answer.photoBlurMode === 'blur'
          ? 'no_photo'
          : 'profile';
  const isAnonymous = identityMode === 'anonymous';
  const usesBlur = identityMode === 'no_photo';

  let authorName = answer.authorName ?? undefined;
  let authorPhotoUrl = answer.authorPhotoUrl ?? undefined;
  let authorAge = answer.authorAge ?? undefined;
  let authorGender = answer.authorGender ?? undefined;

  if (!isAnonymous && isOwnAnswer) {
    authorName = authorName || fallbackProfile.name;
    if (identityMode === 'profile') {
      authorPhotoUrl = authorPhotoUrl || fallbackProfile.photoUrl;
    }
    authorAge = authorAge ?? fallbackProfile.age;
    authorGender = authorGender || fallbackProfile.gender;
  }

  return {
    identityMode,
    isAnonymous,
    photoBlurMode: usesBlur ? 'blur' : 'none',
    authorName: isAnonymous ? 'Anonymous' : (authorName || 'User'),
    // `usesBlur` (no_photo mode) must KEEP the photo URL so `TodAvatar` can
    // actually blur it. Previously this returned `null`, which forced the
    // renderer to show an empty/initial placeholder instead of the intended
    // blurred photo. Only fully-anonymous answers should hide the photo.
    authorPhotoUrl: isAnonymous ? null : (authorPhotoUrl || null),
    authorAge: isAnonymous ? undefined : authorAge,
    authorGender: isAnonymous ? undefined : authorGender,
  };
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

export default function PromptThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    promptId: string;
    autoOpenComposer?: 'new' | 'edit';
    source?: string;
    requestId?: string;
    highlightAnswerId?: string;
  }>();
  const { promptId, autoOpenComposer, source, requestId, highlightAnswerId } = params;
  const shouldReturnToPhase2TodHome = source === 'phase2-tod';
  const handleBackToSource = useCallback(() => {
    if (shouldReturnToPhase2TodHome) {
      router.replace(PHASE2_TOD_HOME_ROUTE as any);
      return;
    }
    router.back();
  }, [router, shouldReturnToPhase2TodHome]);

  useFocusEffect(
    useCallback(() => {
      if (!shouldReturnToPhase2TodHome) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBackToSource();
        return true;
      });
      return () => subscription.remove();
    }, [handleBackToSource, shouldReturnToPhase2TodHome])
  );
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  // Get profile data for author identity snapshot
  const p2DisplayName = usePrivateProfileStore((s) => s.displayName);
  const p2Age = usePrivateProfileStore((s) => s.age);
  const p2Gender = usePrivateProfileStore((s) => s.gender);
  const p2PhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);

  // Build author profile for comments
  const authorProfile = useMemo(() => {
    const photoUrl = Array.isArray(p2PhotoUrls) && p2PhotoUrls.length > 0
      ? p2PhotoUrls.find((url) => url && !url.includes('/cache/'))
      : undefined;

    return {
      name: p2DisplayName || undefined,
      age: p2Age || undefined,
      gender: p2Gender || undefined,
      photoUrl,
    };
  }, [p2DisplayName, p2Age, p2Gender, p2PhotoUrls]);


  // Fetch thread data from Convex
  // FIX: Backend expects { promptId, viewerUserId }, not { token }
  const threadData = useQuery(
    api.truthDare.getPromptThread,
    promptId ? { promptId, viewerUserId: userId || undefined } : 'skip'
  );

  // RECEIVER VISIBILITY: Fetch pending connect requests for this user
  // This allows non-prompt-owners (answer authors) to see incoming connect requests
  // FIX: Backend expects { authUserId }, not { token }
  const pendingRequests = useQuery(
    api.truthDare.getPendingConnectRequests,
    userId ? { authUserId: userId } : 'skip'
  );
  const respondToConnect = useMutation(api.truthDare.respondToConnect);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  // FIX: Success sheet state for post-accept celebration (matching chats.tsx behavior)
  const [successSheet, setSuccessSheet] = useState<{
    visible: boolean;
    conversationId: string;
    matchId?: string;
    source?: 'truth_dare' | 'deep_connect' | 'rematch';
    alreadyMatched?: boolean;
    senderName: string;
    senderPhotoUrl: string;
    senderPhotoBlurMode?: 'none' | 'blur';
    senderIsAnonymous?: boolean;
    recipientName: string;
    recipientPhotoUrl: string;
    recipientPhotoBlurMode?: 'none' | 'blur';
    recipientIsAnonymous?: boolean;
  } | null>(null);
  const [processedPendingRequestIds, setProcessedPendingRequestIds] = useState<Set<string>>(new Set());
  const [highlightedAnswerId, setHighlightedAnswerId] = useState<string | null>(null);
  const [showRequestContextBanner, setShowRequestContextBanner] = useState(false);

  // Filter pending requests for this specific prompt
  const pendingRequestsForPrompt = useMemo(() => {
    if (!pendingRequests || !promptId) return [];
    return pendingRequests.filter((r) => r.promptId === promptId);
  }, [pendingRequests, promptId]);
  const visiblePendingRequestsForPrompt = useMemo(() => {
    if (pendingRequestsForPrompt.length === 0) return [];
    return pendingRequestsForPrompt.filter((request) => !processedPendingRequestIds.has(request._id));
  }, [pendingRequestsForPrompt, processedPendingRequestIds]);

  // Debug log for pending requests
  useEffect(() => {
    if (__DEV__) {
      debugTodLog('[T/D THREAD] Pending requests state:', {
        viewerUserId: userId?.slice(-8),
        promptId: promptId?.slice(-8),
        totalPendingRequests: pendingRequests?.length ?? 0,
        pendingForThisPrompt: pendingRequestsForPrompt.length,
        visiblePendingForThisPrompt: visiblePendingRequestsForPrompt.length,
        pendingIds: visiblePendingRequestsForPrompt.map((r) => r._id?.slice(-8)),
      });
    }
  }, [userId, promptId, pendingRequests, pendingRequestsForPrompt, visiblePendingRequestsForPrompt]);

  useEffect(() => {
    if (!pendingRequests) return;

    setProcessedPendingRequestIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const liveIds = new Set(pendingRequests.map((request) => String(request._id)));
      const next = new Set(Array.from(prev).filter((requestId) => liveIds.has(requestId)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingRequests]);

  // Mutations
  const createOrEditAnswer = useMutation(api.truthDare.createOrEditAnswer);
  const generateUploadUrl = useMutation(api.truthDare.generateUploadUrl);
  const trackPendingTodUploads = useMutation(api.truthDare.trackPendingTodUploads);
  const releasePendingTodUploads = useMutation(api.truthDare.releasePendingTodUploads);
  const cleanupPendingTodUploads = useMutation(api.truthDare.cleanupPendingTodUploads);
  const setReaction = useMutation(api.truthDare.setAnswerReaction);
  const setPromptReaction = useMutation(api.truthDare.setPromptReaction);
  const reportAnswer = useMutation(api.truthDare.reportAnswer);
  const reportPromptMutation = useMutation(api.truthDare.reportPrompt); // P0-002: Report prompt
  const deleteAnswer = useMutation(api.truthDare.deleteMyAnswer);
  const deletePrompt = useMutation(api.truthDare.deleteMyPrompt); // Prompt owner delete
  const editPrompt = useMutation(api.truthDare.editMyPrompt); // Prompt owner edit
  // Secure media APIs
  const claimAnswerMediaView = useMutation(api.truthDare.claimAnswerMediaView);
  // T&D Connect
  const sendConnectRequest = useMutation(api.truthDare.sendTodConnectRequest);

  const isLoading = threadData === undefined;
  const prompt = threadData?.prompt;
  const answers = threadData?.answers ?? [];
  const visibleAnswerCount = prompt?.visibleAnswerCount ?? answers.length;
  const [serverExpiryLocked, setServerExpiryLocked] = useState(false);
  const isExpired = !!threadData?.isExpired || serverExpiryLocked;

  // Find user's own answer
  const myAnswer = useMemo(() => {
    return answers.find((a) => a.isOwnAnswer);
  }, [answers]);

  // Composer state - unified composer for text + optional media
  const [showUnifiedComposer, setShowUnifiedComposer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Close composer if prompt expires while it's open
  useEffect(() => {
    if (isExpired && showUnifiedComposer) {
      setShowUnifiedComposer(false);
    }
  }, [isExpired, showUnifiedComposer]);

  // Emoji picker state (per answer)
  const [emojiPickerAnswerId, setEmojiPickerAnswerId] = useState<string | null>(null);
  // Emoji picker state for prompt
  const [showPromptEmojiPicker, setShowPromptEmojiPicker] = useState(false);

  // Report modal state
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportingAnswerId, setReportingAnswerId] = useState<string | null>(null);
  const [reportingAuthorId, setReportingAuthorId] = useState<string | null>(null);
  const [isReportingPrompt, setIsReportingPrompt] = useState(false); // P0-002: Track if reporting prompt vs answer
  const [selectedReportReason, setSelectedReportReason] = useState<TodReportReason | null>(null);
  const [reportReasonText, setReportReasonText] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // Media viewer state for tap-to-view
  const [viewingMedia, setViewingMedia] = useState<{
    answerId: string;
    mediaUrl: string;
    mediaType: 'photo' | 'video';
    isOwnAnswer: boolean;
    hasViewed?: boolean;
    isFrontCamera?: boolean;
  } | null>(null);

  // T/D VIDEO FIX: Custom progress for front camera videos (native controls flip with scaleX)
  const [videoProgress, setVideoProgress] = useState<{
    position: number;
    duration: number;
    isPlaying: boolean;
  }>({ position: 0, duration: 0, isPlaying: false });

  // T&D Connect state - tracks which answers have pending/sent connect requests
  const [connectSentFor, setConnectSentFor] = useState<Set<string>>(new Set());
  const [connectSending, setConnectSending] = useState<string | null>(null);

  // 3-dot menu state (for comment long-press)
  const [menuAnswerId, setMenuAnswerId] = useState<string | null>(null);
  const [menuAnswerOwnerId, setMenuAnswerOwnerId] = useState<string | null>(null);
  const [menuIsOwnAnswer, setMenuIsOwnAnswer] = useState(false);
  // Whether the long-pressed answer's parent prompt is still active. Used to
  // hide the Edit option in the long-press action sheet once the prompt has
  // expired (delete is still allowed for own answers post-expiry).
  const [menuIsExpired, setMenuIsExpired] = useState(false);

  // Prompt action popup state (for prompt long-press)
  const [showPromptActionPopup, setShowPromptActionPopup] = useState(false);
  const [isDeletingPrompt, setIsDeletingPrompt] = useState(false);

  // Inline prompt edit state
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editPromptText, setEditPromptText] = useState('');
  const [isSavingPromptEdit, setIsSavingPromptEdit] = useState(false);

  // Selected answer state - for tap-to-reveal Connect (prompt owner only)
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);

  // ───────────────────────────────────────────────────────────────────────
  // Compact-tile voice playback
  // ───────────────────────────────────────────────────────────────────────
  // Voice answers no longer render the old horizontal `TodVoicePlayer`
  // pill. Instead, they share the same 84×84 square media tile as photo
  // and video, with a centered play / pause icon. Tapping toggles
  // playback inline; only one voice can play at a time across the
  // screen, and playback auto-resets when the audio finishes one full
  // cycle, so a second tap restarts from the beginning.
  //
  // Lifecycle invariants enforced below:
  //  - `playingVoiceId` is the answer ID of the currently-playing voice,
  //    or `null` when nothing is playing.
  //  - `playingVoiceSoundRef` holds the live `Audio.Sound` instance and
  //    is cleared whenever the sound is unloaded.
  //  - On `didJustFinish`, both refs reset so the next tap creates a
  //    fresh sound from position 0 (no "stuck completed" state).
  //  - Unmount and screen blur both stop and unload the active sound,
  //    so leaving the screen never leaves audio playing.
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  // Live playback position / duration (in ms) for the currently-playing
  // voice tile. Both reset to 0 whenever playback stops, finishes, or a
  // new tile is tapped, so the tile microtext + progress bar always
  // reflect the active sound.
  const [voicePosMs, setVoicePosMs] = useState(0);
  const [voiceDurMs, setVoiceDurMs] = useState(0);
  const playingVoiceSoundRef = useRef<Audio.Sound | null>(null);

  const stopVoicePlayback = useCallback(async () => {
    const sound = playingVoiceSoundRef.current;
    playingVoiceSoundRef.current = null;
    if (sound) {
      try {
        await sound.stopAsync();
      } catch {
        // ignore — sound may already be stopped
      }
      try {
        await sound.unloadAsync();
      } catch {
        // ignore — sound may already be unloaded
      }
    }
    if (isMountedRef.current) {
      setPlayingVoiceId(null);
      setVoicePosMs(0);
      setVoiceDurMs(0);
    }
  }, []);

  const handleToggleVoiceTile = useCallback(
    async (answerId: string, audioUrl: string) => {
      // Tapping the currently-playing tile pauses & resets it. A
      // subsequent tap reloads from position 0 — same UX as a simple
      // play/stop control.
      if (playingVoiceId === answerId) {
        await stopVoicePlayback();
        return;
      }

      // Stop any other voice that's currently playing before we load a
      // new one — only one voice plays at a time on this screen.
      await stopVoicePlayback();

      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          // `progressUpdateIntervalMillis` throttles the status callback
          // to ~4Hz — smooth enough for a moving progress bar / clock
          // without flooding React with re-renders. `shouldPlay: true`
          // begins playback immediately on load.
          { shouldPlay: true, progressUpdateIntervalMillis: 250 },
          (status) => {
            if (!status.isLoaded) return;

            // Push live position / duration into state so the tile's
            // progress bar + clock can update while audio plays.
            const pos = status.positionMillis ?? 0;
            const dur = status.durationMillis ?? 0;
            if (isMountedRef.current) {
              setVoicePosMs(pos);
              if (dur > 0) setVoiceDurMs(dur);
            }

            if (status.didJustFinish) {
              // Auto-reset: unload, clear refs, drop the playing flag,
              // and zero the progress so the next tap starts at 0:00.
              const finished = playingVoiceSoundRef.current;
              playingVoiceSoundRef.current = null;
              finished?.unloadAsync().catch(() => {});
              if (isMountedRef.current) {
                setPlayingVoiceId(null);
                setVoicePosMs(0);
                setVoiceDurMs(0);
              }
            }
          },
        );
        playingVoiceSoundRef.current = sound;
        if (isMountedRef.current) {
          setPlayingVoiceId(answerId);
          setVoicePosMs(0);
          // Seed duration from the status snapshot so the clock displays
          // a useful total even before the first periodic callback fires.
          // Fall back to the answer's `durationSec` × 1000 in the render
          // path when this is still 0.
        } else {
          // Component unmounted between createAsync resolving and now —
          // bail out without leaking the sound.
          sound.unloadAsync().catch(() => {});
          playingVoiceSoundRef.current = null;
        }
      } catch (err) {
        console.error('[T/D voice tile] playback failed:', err);
        playingVoiceSoundRef.current = null;
        if (isMountedRef.current) {
          setPlayingVoiceId(null);
          setVoicePosMs(0);
          setVoiceDurMs(0);
        }
      }
    },
    [playingVoiceId, stopVoicePlayback],
  );

  // Hard cleanup on unmount — guarantees no orphan Audio.Sound survives
  // a screen pop. `stopVoicePlayback` is intentionally not used here so
  // the cleanup runs synchronously inside the effect teardown.
  useEffect(() => {
    return () => {
      const sound = playingVoiceSoundRef.current;
      playingVoiceSoundRef.current = null;
      if (sound) {
        sound.stopAsync().catch(() => {});
        sound.unloadAsync().catch(() => {});
      }
    };
  }, []);

  // Stop voice on screen blur so audio doesn't keep playing in the
  // background after the user navigates away.
  useFocusEffect(
    useCallback(() => {
      return () => {
        // Fire-and-forget; teardown can't await.
        stopVoicePlayback().catch(() => {});
      };
    }, [stopVoicePlayback]),
  );

  // Check if current user is the prompt owner
  // FIX: Backend returns isPromptOwner inside prompt object, not at threadData root
  const isPromptOwner = threadData?.prompt?.isPromptOwner ?? false;

  // CONNECT DEBUG: Log thread ownership state
  useEffect(() => {
    if (__DEV__ && threadData) {
      debugTodLog('[T/D Connect] Thread state:', {
        promptId: promptId?.slice(-8),
        viewerUserId: userId?.slice(-8),
        promptOwnerUserId: prompt?.ownerUserId?.slice(-8),
        backendIsPromptOwner: threadData?.prompt?.isPromptOwner, // FIX: Correct path
        isPromptOwner,
        answerCount: visibleAnswerCount,
      });
    }
  }, [promptId, userId, prompt?.ownerUserId, threadData?.prompt?.isPromptOwner, isPromptOwner, visibleAnswerCount]);

  const listRef = useRef<FlatList>(null);

  // M-003 FIX: Track scroll timeout for cleanup
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // M-003 FIX: Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      if (requestHighlightTimeoutRef.current) {
        clearTimeout(requestHighlightTimeoutRef.current);
        requestHighlightTimeoutRef.current = null;
      }
    };
  }, []);

  // Ref to always have latest answers for callbacks (avoids stale closure)
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Ref to track pending reactions (prevents double-tap race condition)
  const pendingReactionsRef = useRef<Set<string>>(new Set());

  // P0-001 FIX: Ref to track media claims in progress (prevents double-tap and stale state issues)
  const pendingMediaClaimsRef = useRef<Set<string>>(new Set());
  const connectSendInFlightRef = useRef(false);
  const pendingConnectResponsesRef = useRef<Set<string>>(new Set());
  const pendingScrollAnswerIdRef = useRef<string | null>(null);
  const autoOpenHandledRef = useRef<string | null>(null);
  const requestHighlightHandledRef = useRef<string | null>(null);

  useEffect(() => {
    setServerExpiryLocked(false);
    pendingScrollAnswerIdRef.current = null;
    autoOpenHandledRef.current = null;
    requestHighlightHandledRef.current = null;
    setHighlightedAnswerId(null);
    setShowRequestContextBanner(false);
  }, [promptId]);

  // Auto-open composer if requested from feed
  useEffect(() => {
    if (!autoOpenComposer || !promptId || !prompt) return;
    const autoOpenKey = `${promptId}:${autoOpenComposer}`;
    if (autoOpenHandledRef.current === autoOpenKey) return;
    autoOpenHandledRef.current = autoOpenKey;

    if (isExpired || isPromptOwner) {
      return;
    }

    if (autoOpenComposer === 'edit' && !myAnswer) {
      setShowUnifiedComposer(true);
      return;
    }

    if (autoOpenComposer === 'new' && myAnswer) {
      setShowUnifiedComposer(true);
      return;
    }

    setShowUnifiedComposer(true);
  }, [autoOpenComposer, isExpired, isPromptOwner, myAnswer, prompt, promptId]);

  // M-003 FIX: Safe scroll with cleanup support
  const scrollToEnd = () => {
    // Clear any pending scroll timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current && listRef.current) {
        listRef.current.scrollToEnd({ animated: true });
      }
      scrollTimeoutRef.current = null;
    }, 200);
  };

  useEffect(() => {
    if (!pendingScrollAnswerIdRef.current) return;
    const hasSubmittedAnswer = answers.some((answer) => answer._id === pendingScrollAnswerIdRef.current);
    if (!hasSubmittedAnswer) return;

    pendingScrollAnswerIdRef.current = null;
    scrollToEnd();
  }, [answers]);

  useEffect(() => {
    if (source !== 'phase2-tod' || !highlightAnswerId || answers.length === 0) return;
    const highlightKey = `${requestId ?? ''}:${highlightAnswerId}`;
    if (requestHighlightHandledRef.current === highlightKey) return;

    const answerIndex = answers.findIndex((answer) => String(answer._id) === String(highlightAnswerId));
    if (answerIndex < 0) return;

    requestHighlightHandledRef.current = highlightKey;
    setHighlightedAnswerId(String(highlightAnswerId));
    setShowRequestContextBanner(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current && listRef.current) {
        try {
          listRef.current.scrollToIndex({
            index: answerIndex,
            animated: true,
            viewPosition: 0.35,
          });
        } catch {
          // The banner still gives context if a virtualized row cannot be measured.
        }
      }
      scrollTimeoutRef.current = null;
    }, 250);

    if (requestHighlightTimeoutRef.current) {
      clearTimeout(requestHighlightTimeoutRef.current);
    }
    requestHighlightTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setHighlightedAnswerId(null);
        setShowRequestContextBanner(false);
      }
      requestHighlightTimeoutRef.current = null;
    }, 4500);
  }, [answers, highlightAnswerId, requestId, source]);

  const handleScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    if (!listRef.current) return;
    const offset = Math.max(0, info.averageItemLength * info.index);
    listRef.current.scrollToOffset({ offset, animated: true });
  }, []);

  // Handle emoji reaction
  const handleReact = useCallback(async (answerId: string, emoji: string) => {
    if (!userId) {
      debugTodLog('[T/D REACTION] skip - no userId');
      return;
    }

    // Prevent double-tap race condition
    if (pendingReactionsRef.current.has(answerId)) {
      debugTodLog('[T/D REACTION] skip - already pending');
      return;
    }
    pendingReactionsRef.current.add(answerId);

    setEmojiPickerAnswerId(null);

    // Find the answer using ref to get latest data (avoids stale closure)
    const answer = answersRef.current.find((a) => a._id === answerId);
    const answerIdPrefix = answerId.substring(0, 8);

    debugTodLog('[T/D REACTION] tap', {
      answerIdPrefix,
      emoji: emoji || '(remove)',
      currentCount: answer?.totalReactionCount ?? 0,
      isOwnAnswer: answer?.isOwnAnswer ?? false,
      hasAuth: !!userId,
    });

    try {
      if (!userId) return;
      const result = await setReaction({ answerId, userId, emoji });
      // Handle server returning ok: false (no throw, graceful fail)
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        debugTodWarn('[T/D REACTION] failed', { reason: (result as any).reason });
      } else {
        debugTodLog('[T/D REACTION] success', { action: (result as any)?.action });
      }
    } catch (error: any) {
      // Graceful handling - don't crash UI
      debugTodWarn('[T/D REACTION] error', { message: error?.message?.substring(0, 50) });
      if (error.message?.includes('Rate limit')) {
        Alert.alert('Slow down', 'Please wait a moment before reacting again.');
      }
    } finally {
      pendingReactionsRef.current.delete(answerId);
    }
  }, [userId, setReaction]);

  // Handle prompt emoji reaction
  const handlePromptReact = useCallback(async (emoji: string) => {
    if (!userId || !promptId) {
      debugTodLog('[T/D PROMPT REACTION] skip - no userId or promptId');
      return;
    }

    setShowPromptEmojiPicker(false);

    debugTodLog('[T/D PROMPT REACTION] tap', {
      promptIdPrefix: promptId.substring(0, 8),
      emoji: emoji || '(remove)',
      hasAuth: !!userId,
    });

    try {
      const result = await setPromptReaction({ promptId, userId, emoji });
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        debugTodWarn('[T/D PROMPT REACTION] failed', { reason: (result as any).reason });
      } else {
        debugTodLog('[T/D PROMPT REACTION] success', { action: (result as any)?.action });
      }
    } catch (error: any) {
      debugTodWarn('[T/D PROMPT REACTION] error', { message: error?.message?.substring(0, 50) });
      if (error.message?.includes('Rate limit')) {
        Alert.alert('Slow down', 'Please wait a moment before reacting again.');
      }
    }
  }, [userId, promptId, setPromptReaction]);

  // Open report modal
  const handleReport = useCallback((answerId: string, authorId: string) => {
    if (!userId || userId === authorId) return;
    setReportingAnswerId(answerId);
    setReportingAuthorId(authorId);
    setSelectedReportReason(null);
    setReportReasonText('');
    setReportModalVisible(true);
  }, [userId]);

  // Submit report with selected reason (handles both prompt and answer reports)
  const submitReport = useCallback(async () => {
    if (!selectedReportReason) return;
    // P0-002: Handle prompt vs answer reporting
    if (!isReportingPrompt && !reportingAnswerId) return;

    const normalizedReasonText = reportReasonText.trim() || undefined;

    setIsSubmittingReport(true);
    try {
      if (isReportingPrompt && promptId && userId) {
        // P0-002: Report the prompt
        const result = await reportPromptMutation({
          promptId,
          reporterId: userId,
          reasonCode: selectedReportReason,
          reasonText: normalizedReasonText,
        });
        setReportModalVisible(false);
        if (result.isNowHidden) {
          Alert.alert('Reported', 'This prompt has been hidden due to multiple reports.');
          handleBackToSource();
        } else {
          Alert.alert('Reported', 'Thank you for your report. We will review it.');
        }
      } else if (reportingAnswerId && userId) {
        // Report the answer
        const result = await reportAnswer({
          answerId: reportingAnswerId,
          reporterId: userId,
          reasonCode: selectedReportReason,
          reasonText: normalizedReasonText,
        });
        setReportModalVisible(false);
        // P1-002: Content is immediately hidden for the reporter
        if (result.isNowHidden) {
          Alert.alert('Reported', 'This comment has been hidden due to multiple reports.');
        } else {
          Alert.alert('Reported', 'Thank you for your report. This content is now hidden for you.');
        }
      }
    } catch (error: any) {
      if (error.message?.includes('already reported')) {
        Alert.alert('Already Reported', isReportingPrompt ? 'You have already reported this prompt.' : 'You have already reported this comment.');
      } else if (error.message?.includes('daily report limit')) {
        Alert.alert('Limit Reached', 'You have reached your daily report limit.');
      } else if (error.message?.includes('Cannot report your own')) {
        Alert.alert('Error', 'You cannot report your own content.');
      } else {
        Alert.alert('Error', 'Failed to report. Please try again.');
      }
    } finally {
      setIsSubmittingReport(false);
    }
  }, [userId, promptId, reportingAnswerId, isReportingPrompt, selectedReportReason, reportReasonText, reportAnswer, reportPromptMutation, handleBackToSource]);

  // Close report modal
  const closeReportModal = useCallback(() => {
    setReportModalVisible(false);
    setReportingAnswerId(null);
    setReportingAuthorId(null);
    setIsReportingPrompt(false); // P0-002: Reset prompt reporting state
    setSelectedReportReason(null);
    setReportReasonText('');
  }, []);

  // P0-002: Handle report prompt (via popup action)
  const handleReportPrompt = useCallback(() => {
    if (!userId || !promptId) return;
    setShowPromptActionPopup(false); // Close the action popup first
    setIsReportingPrompt(true);
    setReportingAnswerId(null);
    setReportingAuthorId(null);
    setSelectedReportReason(null);
    setReportReasonText('');
    setReportModalVisible(true);
  }, [userId, promptId]);

  // Handle prompt long-press (opens action popup)
  const handlePromptLongPress = useCallback(() => {
    if (!userId) return;
    setShowPromptActionPopup(true);
  }, [userId]);

  // Close prompt action popup
  const handleClosePromptActionPopup = useCallback(() => {
    setShowPromptActionPopup(false);
  }, []);

  // Handle delete own prompt
  // FIX: Use authUserId instead of token for backend mutation
  const handleDeletePrompt = useCallback(async () => {
    if (!userId || !promptId || !isPromptOwner) return;
    if (isDeletingPrompt) return; // Prevent double-tap

    setIsDeletingPrompt(true);
    try {
      await deletePrompt({ promptId, authUserId: userId });
      setShowPromptActionPopup(false);
      handleBackToSource(); // Navigate back after successful delete
    } catch (error: any) {
      console.error('[T/D] Delete prompt failed:', error);
      Alert.alert('Error', error?.message || 'Failed to delete prompt. Please try again.');
    } finally {
      setIsDeletingPrompt(false);
    }
  }, [userId, promptId, isPromptOwner, isDeletingPrompt, deletePrompt, handleBackToSource]);

  // Handle inline edit - start editing
  const handleStartEditPrompt = useCallback(() => {
    if (!prompt?.text) return;
    setEditPromptText(prompt.text);
    setIsEditingPrompt(true);
    setShowPromptActionPopup(false);
  }, [prompt?.text]);

  // Handle inline edit - cancel
  const handleCancelEditPrompt = useCallback(() => {
    setIsEditingPrompt(false);
    setEditPromptText('');
  }, []);

  // Handle inline edit - save
  const handleSaveEditPrompt = useCallback(async () => {
    if (!userId || !promptId || !editPromptText.trim()) return;
    if (isSavingPromptEdit) return;

    const trimmedText = editPromptText.trim();
    if (trimmedText.length < 10) {
      Alert.alert('Too Short', 'Prompt must be at least 10 characters.');
      return;
    }
    if (trimmedText.length > 280) {
      Alert.alert('Too Long', 'Prompt cannot exceed 280 characters.');
      return;
    }

    setIsSavingPromptEdit(true);
    try {
      await editPrompt({ promptId, authUserId: userId, newText: trimmedText });
      setIsEditingPrompt(false);
      setEditPromptText('');
      // Query will auto-refresh with new text
    } catch (error: any) {
      console.error('[T/D] Edit prompt failed:', error);
      Alert.alert('Error', error?.message || 'Failed to save changes. Please try again.');
    } finally {
      setIsSavingPromptEdit(false);
    }
  }, [userId, promptId, editPromptText, isSavingPromptEdit, editPrompt]);

  // Handle delete own comment
  const handleDeleteAnswer = useCallback(async (answerId: string) => {
    if (!userId) return;

    Alert.alert(
      'Delete Comment',
      'Are you sure you want to delete your comment? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAnswer({ answerId, userId });
            } catch (error) {
              Alert.alert('Error', 'Failed to delete comment. Please try again.');
            }
          },
        },
      ]
    );
  }, [userId, deleteAnswer]);

  // Open 3-dot menu
  const handleOpenMenu = useCallback((
    answerId: string,
    authorId: string,
    isOwn: boolean,
    isExpiredFlag: boolean,
  ) => {
    setMenuAnswerId(answerId);
    setMenuAnswerOwnerId(authorId);
    setMenuIsOwnAnswer(isOwn);
    setMenuIsExpired(isExpiredFlag);
  }, []);

  // Close 3-dot menu
  const handleCloseMenu = useCallback(() => {
    setMenuAnswerId(null);
    setMenuAnswerOwnerId(null);
    setMenuIsOwnAnswer(false);
    setMenuIsExpired(false);
  }, []);

  // Toggle card selection (for prompt owner to reveal Connect)
  const handleToggleSelect = useCallback((answerId: string) => {
    setSelectedAnswerId((prev) => prev === answerId ? null : answerId);
    // Close emoji picker if open
    setEmojiPickerAnswerId(null);
    // Close 3-dot menu if open
    setMenuAnswerId(null);
  }, []);

  // Handle menu action: delete own comment
  const handleMenuDelete = useCallback(() => {
    if (menuAnswerId && menuIsOwnAnswer) {
      handleDeleteAnswer(menuAnswerId);
    }
    handleCloseMenu();
  }, [menuAnswerId, menuIsOwnAnswer, handleDeleteAnswer, handleCloseMenu]);

  // Handle menu action: edit own comment.
  // Closes the action sheet first, then opens the unified composer which is
  // already wired to load the user's existing answer (text + attachment +
  // identity mode) when `myAnswer` is present — i.e. the same edit flow the
  // old visible pencil triggered.
  const handleMenuEdit = useCallback(() => {
    if (menuIsOwnAnswer && !menuIsExpired) {
      setShowUnifiedComposer(true);
    }
    handleCloseMenu();
  }, [menuIsOwnAnswer, menuIsExpired, handleCloseMenu]);

  // Handle menu action: report
  const handleMenuReport = useCallback(() => {
    if (menuAnswerId && menuAnswerOwnerId && !menuIsOwnAnswer) {
      handleReport(menuAnswerId, menuAnswerOwnerId);
    }
    handleCloseMenu();
  }, [menuAnswerId, menuAnswerOwnerId, menuIsOwnAnswer, handleReport, handleCloseMenu]);

  // RECEIVER: Handle accept T&D connect request
  const handleAcceptConnect = useCallback(async (requestId: string) => {
    if (!userId) return;
    if (pendingConnectResponsesRef.current.has(`connect:${requestId}`)) return;

    pendingConnectResponsesRef.current.add(`connect:${requestId}`);
    if (isMountedRef.current) {
      setRespondingTo(requestId);
    }
    try {
      const result = await respondToConnect({
        requestId: requestId as any,
        action: 'connect',
        authUserId: userId,
      });
      const connectResult = result as any;
      if (__DEV__) {
        debugTodLog('[T/D ACCEPT RESULT]', {
          success: result.success,
          conversationId: result.conversationId?.slice(-8),
          matchId: connectResult.matchId?.slice?.(-8),
          alreadyMatched: connectResult.alreadyMatched,
          source: connectResult.source,
          action: result.action,
          senderName: result.senderName,
        });
      }
      if (result.success && result.conversationId) {
        setProcessedPendingRequestIds((prev) => {
          const next = new Set(prev);
          next.add(requestId);
          return next;
        });
        if (!isMountedRef.current) {
          return;
        }
        const matchId = typeof connectResult.matchId === 'string' ? connectResult.matchId : null;
        const senderDbId = typeof connectResult.senderDbId === 'string' ? connectResult.senderDbId : null;

        if (!connectResult.alreadyMatched && matchId && senderDbId) {
          debugTodLog('[T/D ACCEPT] Opening source-aware Phase-2 match celebration');
          router.push(
            `/(main)/match-celebration?matchId=${matchId}&userId=${senderDbId}&mode=phase2&conversationId=${result.conversationId}&source=truth_dare&alreadyMatched=0` as any
          );
          return;
        }

        debugTodLog('[T/D ACCEPT] Showing already-matched continuation sheet');
        setSuccessSheet({
          visible: true,
          conversationId: result.conversationId,
          matchId: connectResult.matchId,
          source: connectResult.source || 'truth_dare',
          alreadyMatched: !!connectResult.alreadyMatched,
          senderName: result.senderName || 'Someone',
          senderPhotoUrl: result.senderPhotoUrl || '',
          senderPhotoBlurMode: result.senderPhotoBlurMode || 'none',
          senderIsAnonymous: !!result.senderIsAnonymous,
          recipientName: result.recipientName || 'You',
          recipientPhotoUrl: result.recipientPhotoUrl || '',
          recipientPhotoBlurMode: result.recipientPhotoBlurMode || 'none',
          recipientIsAnonymous: !!result.recipientIsAnonymous,
        });
      } else {
        Alert.alert('Error', result.reason || 'Failed to accept request');
      }
    } catch (error: any) {
      if (isRetryableTodError(error)) {
        Alert.alert(
          'Connection Unconfirmed',
          'We could not confirm this request was accepted. Refresh the thread before trying again.'
        );
      } else {
        Alert.alert('Error', error.message || 'Failed to accept connect request');
      }
    } finally {
      pendingConnectResponsesRef.current.delete(`connect:${requestId}`);
      if (isMountedRef.current) {
        setRespondingTo(null);
      }
    }
  }, [userId, respondToConnect, router]);

  // RECEIVER: Handle reject T&D connect request
  const handleRejectConnect = useCallback(async (requestId: string) => {
    if (!userId) return;
    if (pendingConnectResponsesRef.current.has(`remove:${requestId}`)) return;

    pendingConnectResponsesRef.current.add(`remove:${requestId}`);
    if (isMountedRef.current) {
      setRespondingTo(requestId);
    }
    try {
      const result = await respondToConnect({
        requestId: requestId as any,
        action: 'remove',
        authUserId: userId,
      });
      if (__DEV__) {
        debugTodLog('[T/D THREAD] Reject result:', result);
      }
      if (!result.success) {
        Alert.alert('Error', result.reason || 'Failed to decline request');
      } else {
        setProcessedPendingRequestIds((prev) => {
          const next = new Set(prev);
          next.add(requestId);
          return next;
        });
      }
    } catch (error: any) {
      if (isRetryableTodError(error)) {
        Alert.alert(
          'Decline Unconfirmed',
          'We could not confirm this request was declined. Refresh the thread before trying again.'
        );
      } else {
        Alert.alert('Error', error.message || 'Failed to decline connect request');
      }
    } finally {
      pendingConnectResponsesRef.current.delete(`remove:${requestId}`);
      if (isMountedRef.current) {
        setRespondingTo(null);
      }
    }
  }, [userId, respondToConnect]);

  // Handle send T&D connect request (prompt owner → answer author)
  // P0-10 FIX: Global in-flight guard + backend remains authoritative for dedup.
  const handleSendConnect = useCallback(async (answerId: string) => {
    if (!userId || !promptId) return;
    if (connectSendInFlightRef.current) return;
    const targetAnswer = answers.find((answer) => String(answer._id) === String(answerId));
    const promptScopedConnectKey = targetAnswer?.userId
      ? `${targetAnswer.promptId ?? promptId}:${targetAnswer.userId}`
      : null;

    connectSendInFlightRef.current = true;
    if (isMountedRef.current) {
      setConnectSending(answerId);
    }
    try {
      const result = await sendConnectRequest({
        promptId,
        answerId,
        authUserId: userId,
      });

      if (result.success) {
        const connectSendResult = result as any;
        const action = (result as any).action as
          | 'pending'
          | 'already_pending'
          | 'already_connected'
          | 'already_removed'
          | 'reverse_pending'
          | undefined;

        if (isMountedRef.current) {
          setConnectSentFor((prev) => {
            const next = new Set(prev);
            next.add(answerId);
            if (promptScopedConnectKey) {
              next.add(promptScopedConnectKey);
            }
            return next;
          });
          setSelectedAnswerId(null);
        }

        if (action === 'reverse_pending') {
          Alert.alert(
            'They sent you one!',
            'They already sent you a connect request. Open Messages to accept it.'
          );
        } else if (action === 'already_connected') {
          Alert.alert(
            'Already Connected',
            'You are already connected. Continue your conversation?',
            [
              { text: 'Not now', style: 'cancel' },
              ...(connectSendResult.conversationId
                ? [{
                    text: 'Continue Chat',
                    onPress: () => router.push(`/(main)/(private)/(tabs)/chats/${connectSendResult.conversationId}` as any),
                  }]
                : []),
            ],
          );
        } else if (action === 'already_pending') {
          Alert.alert('Already Sent', 'Your connect request is already pending.');
        } else if (action === 'already_removed') {
          Alert.alert('Already Handled', 'A Connect request was already handled for this person on this prompt.');
        } else {
          Alert.alert('Connect Sent', 'Your connect request has been sent!');
        }
      } else {
        // P2-9: Ensure retry is allowed on failure (no leaked state).
        if (isMountedRef.current) {
          setConnectSentFor((prev) => {
            if (!prev.has(answerId)) return prev;
            const next = new Set(prev);
            next.delete(answerId);
            if (promptScopedConnectKey) {
              next.delete(promptScopedConnectKey);
            }
            return next;
          });
        }
        Alert.alert('Cannot Connect', result.reason || 'Failed to send connect request.');
      }
    } catch (error) {
      // P2-9: Ensure retry is allowed on thrown error.
      if (isMountedRef.current) {
        setConnectSentFor((prev) => {
          if (!prev.has(answerId)) return prev;
          const next = new Set(prev);
          next.delete(answerId);
          if (promptScopedConnectKey) {
            next.delete(promptScopedConnectKey);
          }
          return next;
        });
      }
      if (isRetryableTodError(error)) {
        Alert.alert(
          'Connect Unconfirmed',
          'We could not confirm your connect request. Refresh the thread before trying again.'
        );
      } else {
        Alert.alert('Error', 'Failed to send connect request. Please try again.');
      }
    } finally {
      connectSendInFlightRef.current = false;
      if (isMountedRef.current) {
        setConnectSending(null);
      }
    }
  }, [answers, userId, promptId, sendConnectRequest, router]);

  // Handle tap-to-view for media content
  // P0-001 FIX: Backend is the source of truth for view state.
  // Phase-2 visual media is consumed by the backend claim before a URL is returned.
  const handleViewMedia = useCallback(async (answer: typeof answers[0]) => {
    // Only photo / video are openable through this flow. Voice has its own
    // inline player; other types have nothing to open.
    if (answer.type !== 'photo' && answer.type !== 'video') return;

    const answerId = answer._id;
    const isOwner = answer.isOwnAnswer;

    // BUG FIX: If the answer is the viewer's own, mediaUrl is required
    // (owner views inline). For non-owners, mediaUrl may be absent — e.g.
    // creator-only media that the prompt owner is authorized to claim.
    // The previous early return bailed for *any* missing mediaUrl, which
    // hid the affordance for the prompt creator entirely. Now we only bail
    // for the owner-with-no-url case; non-owners proceed to the claim path.
    if (isOwner && !answer.mediaUrl) return;

    // P0-001 FIX: Prevent double-tap while claim is in flight
    if (pendingMediaClaimsRef.current.has(answerId)) {
      debugTodLog('[T/D] Media claim already in progress, ignoring tap');
      return;
    }

    // Owner can always view their own media (no claim needed). The guard
    // above already returned when `isOwner && !answer.mediaUrl`, so the URL
    // is guaranteed here — restate it locally so TypeScript narrows.
    if (isOwner && answer.mediaUrl) {
      if (isMountedRef.current) {
        setViewingMedia({
          answerId,
          mediaUrl: answer.mediaUrl,
          mediaType: answer.type as 'photo' | 'video',
          isOwnAnswer: true,
          isFrontCamera: answer.isFrontCamera,
        });
      }
      return;
    }

    // P0-001 FIX: For non-owners, ALWAYS call backend claim - it is the source of truth.
    // Do NOT rely on stale hasViewedMedia from query snapshot.
    // The backend will return the appropriate status.

    // Guard: ensure user is authenticated before claiming
    if (!userId) {
      Alert.alert('Sign In Required', 'Please sign in to view media.');
      return;
    }

    pendingMediaClaimsRef.current.add(answerId);

    try {
      const mediaLabel = answer.type === 'video' ? 'video' : 'photo';
      // Backend records the one-time view before returning a playable URL.
      const result = await claimAnswerMediaView({
        answerId,
        viewerId: userId,
      });

      // Handle backend responses
      // ONE-TIME VIEW: Block if already viewed
      if (result.status === 'already_viewed') {
        Alert.alert(
          'Already Viewed',
          `This ${mediaLabel} was already viewed.`
        );
        return;
      }

      if (result.status === 'not_authorized') {
        Alert.alert(
          'Not Available',
          `This ${mediaLabel} is only available to the prompt creator.`
        );
        return;
      }

      if (result.status === 'no_media') {
        Alert.alert(
          'Unavailable',
          `This one-time ${mediaLabel} is no longer available.`
        );
        return;
      }

      if (result.status !== 'ok' || !result.url) {
        Alert.alert(
          'Couldn’t Open',
          `We couldn’t open this ${mediaLabel}. Please try again.`
        );
        return;
      }

      // Use the fresh URL from backend
      if (isMountedRef.current) {
        setViewingMedia({
          answerId,
          mediaUrl: result.url,
          mediaType: result.mediaType,
          isOwnAnswer: false,
          hasViewed: true,
          isFrontCamera: result.isFrontCamera,
        });
      }
    } catch (error: any) {
      console.error('[T/D] Claim media view failed:', error);
      if (error.message?.includes('Rate limit')) {
        Alert.alert('Please Wait', 'Too many requests. Try again in a moment.');
      } else if (isRetryableTodError(error)) {
        Alert.alert(
          'Media Not Loaded',
          'We could not load this media right now. Check your connection and try again.'
        );
      } else {
        Alert.alert('Error', 'Failed to view media. Please try again.');
      }
    } finally {
      // P0-001 FIX: Always clear the pending flag
      pendingMediaClaimsRef.current.delete(answerId);
    }
  }, [userId, claimAnswerMediaView]);

  // Handle closing the media viewer. Backend consumption already happened
  // during claim/open, so close is UI-only.
  const handleCloseMediaViewer = useCallback(async () => {
    if (isMountedRef.current) {
      setViewingMedia(null);
    }
    // T/D VIDEO FIX: Reset video progress state
    if (isMountedRef.current) {
      setVideoProgress({ position: 0, duration: 0, isPlaying: false });
    }

  }, []);

  // Unified submit handler - handles text + optional media attachment
  // Uses MERGE behavior: only sends fields that changed
  const handleUnifiedSubmit = useCallback(async (params: {
    text: string;
    attachment: Attachment | null;
    removeMedia?: boolean;
    identityMode: IdentityMode;
    mediaVisibility?: 'private' | 'public';
  }) => {
    if (!promptId || !userId) return;
    const uploadedStorageIds: string[] = [];

    if (isMountedRef.current) {
      setIsSubmitting(true);
    }

    try {
      const wasEditing = !!myAnswer;
      const { text, attachment, removeMedia, identityMode, mediaVisibility } = params;

      debugTodLog('[T/D BEHAVIOR] submit_pipeline_start', {
        hasText: !!text.trim(),
        hasAttachment: !!attachment,
        attachmentKind: attachment?.kind ?? 'none',
        removeMedia: !!removeMedia,
        identityMode,
        mediaVisibility: mediaVisibility ?? 'public',
      });

      const isAnon = identityMode === 'anonymous';
      const isNoPhoto = identityMode === 'no_photo';
      const photoBlurMode = isNoPhoto ? 'blur' : 'none';

      // Upload media if new attachment provided
      let mediaStorageId: string | undefined;
      let mediaMime: string | undefined;
      let durationSec: number | undefined;
      let isFrontCamera: boolean | undefined;
      let authorPhotoStorageId: string | undefined;
      const trackUploadedStorageId = async (storageId: string | undefined) => {
        if (!storageId) return;
        uploadedStorageIds.push(storageId);
        try {
          await trackPendingTodUploads({
            storageIds: [storageId as any],
            // Required: server uses two-tier auth (identity → authUserId fallback);
            // omitting this throws Unauthorized in demo/custom-auth mode.
            authUserId: userId,
          });
        } catch (trackError) {
          debugTodWarn('[T/D] Failed to track pending upload:', trackError);
        }
      };

      if (attachment) {
        // Check if this is a remote URL (already uploaded media from existing answer)
        // Remote URLs start with http:// or https:// and should NOT be re-uploaded
        const isRemoteUrl = attachment.uri.startsWith('http://') || attachment.uri.startsWith('https://');

        if (isRemoteUrl) {
          // Media is already in storage - don't upload, don't change mediaStorageId
          debugTodLog('[T/D UPLOAD] skip - remote URL (existing media)');
        } else {
          // Local file - upload to Convex storage
          isFrontCamera = attachment.isFrontCamera;
          mediaMime = attachment.mime;

          const mediaType = attachment.kind === 'audio' ? 'audio' : attachment.kind;
          debugTodLog('[T/D UPLOAD] start', { type: mediaType, isFrontCamera });

          try {
            // FIX: generateUploadUrl requires authUserId
            mediaStorageId = await uploadMediaToConvex(
              attachment.uri,
              () => generateUploadUrl({ authUserId: userId }),
              mediaType
            );
            await trackUploadedStorageId(mediaStorageId);
            const storageIdPrefix = mediaStorageId?.substring(0, 8) ?? 'none';
            debugTodLog('[T/D UPLOAD] success', { storageIdPrefix });
          } catch (uploadError: any) {
            console.error('[T/D UPLOAD] failed', { error: uploadError?.message?.substring(0, 50) });
            throw uploadError;
          }

          if (attachment.durationMs) {
            durationSec = Math.ceil(attachment.durationMs / 1000);
          }
        }
      }

      const authorPhotoUrl = authorProfile.photoUrl;
      // BLUR-PHOTO PARITY WITH CONFESS: `no_photo` mode needs the real photo
      // URL on the server so the thread renderer can blur it. Previously this
      // gated the upload on `!isNoPhoto`, which meant blur-mode answers had no
      // source image and `TodAvatar` fell back to the initial placeholder.
      // Anonymous mode still omits the photo entirely.
      const shouldAttachProfilePhoto =
        !isAnon &&
        typeof authorPhotoUrl === 'string' &&
        authorPhotoUrl.length > 0;

      if (shouldAttachProfilePhoto && authorPhotoUrl && !(authorPhotoUrl.startsWith('http://') || authorPhotoUrl.startsWith('https://'))) {
        // FIX: generateUploadUrl requires authUserId
        authorPhotoStorageId = await uploadMediaToConvex(
          authorPhotoUrl,
          () => generateUploadUrl({ authUserId: userId }),
          'photo'
        );
        await trackUploadedStorageId(authorPhotoStorageId);
      }

      // Create or edit the answer with MERGE behavior
      // Only send fields that are explicitly provided
      debugTodLog('[T/D BEHAVIOR] createOrEditAnswer start', { identityMode, visibility: mediaVisibility === 'private' ? 'owner_only' : 'public' });
      // FIX: Backend expects { userId }, not { token }
      const result = await createOrEditAnswer({
        promptId,
        userId: userId ?? '',
        // Text - send if provided (even empty string is valid to clear)
        text: text.trim() || undefined,
        // Media - only send if new attachment or removeMedia
        mediaStorageId: mediaStorageId as any,
        mediaMime,
        durationSec,
        removeMedia,
        // Identity - only used on first creation
        identityMode,
        isAnonymous: isAnon,
        visibility: mediaVisibility === 'private' ? 'owner_only' : 'public',
        viewMode: attachment ? 'tap' : undefined, // One-time tap to view for media
        // Author identity based on choice
        authorName: isAnon ? undefined : authorProfile.name,
        // BLUR-PHOTO PARITY WITH CONFESS: send the real photo URL for `no_photo`
        // too; the server stores it and the renderer applies blur on top. Only
        // anonymous mode omits the photo entirely.
        authorPhotoUrl:
          isAnon
            ? undefined
            : (authorPhotoUrl?.startsWith('http://') || authorPhotoUrl?.startsWith('https://'))
              ? authorPhotoUrl
              : undefined,
        authorPhotoStorageId: isAnon ? undefined : (authorPhotoStorageId as any),
        authorAge: isAnon ? undefined : authorProfile.age,
        authorGender: isAnon ? undefined : authorProfile.gender,
        photoBlurMode: photoBlurMode as 'none' | 'blur',
        isFrontCamera,
      });

      if (uploadedStorageIds.length > 0) {
        try {
          await releasePendingTodUploads({
            storageIds: uploadedStorageIds as any,
            authUserId: userId,
          });
        } catch (releaseError) {
          debugTodWarn('[T/D] Failed to release pending uploads after answer submit:', releaseError);
        }
      }

      debugTodLog('[T/D BEHAVIOR] createOrEditAnswer success');
      if (!wasEditing && result?.answerId) {
        pendingScrollAnswerIdRef.current = result.answerId as string;
      } else {
        pendingScrollAnswerIdRef.current = null;
      }
      if (isMountedRef.current) {
        setShowUnifiedComposer(false);
        setIsSubmitting(false);
      }
    } catch (error: any) {
      console.error('[T/D BEHAVIOR] submit_pipeline_failed', { error: error?.message?.substring(0, 50) });
      const retryableError = isRetryableTodError(error);

      if (!retryableError && uploadedStorageIds.length > 0) {
        try {
          await cleanupPendingTodUploads({
            storageIds: uploadedStorageIds as any,
            authUserId: userId,
          });
        } catch (cleanupError) {
          debugTodWarn('[T/D] Failed to clean up pending uploads after failed answer submit:', cleanupError);
        }
      }

      if (error?.message?.includes('Prompt has expired')) {
        if (isMountedRef.current) {
          setServerExpiryLocked(true);
          setShowUnifiedComposer(false);
        }
        Alert.alert('Prompt Expired', 'This prompt is no longer accepting responses.');
      } else if (retryableError) {
        Alert.alert(
          'Submission Unconfirmed',
          'We could not confirm your response was posted. Check the thread before trying again.'
        );
      } else {
        Alert.alert('Error', error.message || 'Failed to post comment. Please try again.');
      }
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [
    promptId,
    userId,
    generateUploadUrl,
    createOrEditAnswer,
    authorProfile,
    myAnswer,
    trackPendingTodUploads,
    releasePendingTodUploads,
    cleanupPendingTodUploads,
  ]);

  // Helper: returns an Ionicons descriptor + color for the author's gender so
  // the identity row can render a colored male/female/non-binary glyph instead
  // of a plain unicode character. Pink/blue accent matches the app-wide gender
  // color palette used elsewhere in the Phase-2 UI.
  type GenderAccent = {
    icon: 'male' | 'female' | 'transgender';
    color: string;
    label: string;
  } | null;
  const getCommentGenderAccent = (gender: string | undefined): GenderAccent => {
    if (!gender) return null;
    const g = gender.toLowerCase();
    if (g === 'male' || g === 'm') return { icon: 'male', color: '#3B82F6', label: 'Male' };
    if (g === 'female' || g === 'f') return { icon: 'female', color: '#EC4899', label: 'Female' };
    if (
      g === 'non_binary' ||
      g === 'non-binary' ||
      g === 'nonbinary' ||
      g === 'nb' ||
      g === 'other'
    ) {
      return { icon: 'transgender', color: PREMIUM.genderOther, label: 'Non-binary' };
    }
    return null;
  };
  const hasMyAnswer = !!myAnswer;
  const canReplyInline = !isExpired && !hasMyAnswer && !isPromptOwner;
  const openComposer = useCallback(() => {
    setShowUnifiedComposer(true);
  }, []);

  // P2-003 FIX: Wrap renderAnswer in useCallback to prevent recreation on every render
  // Render answer card - Premium elevated design with tap-to-reveal
  const renderAnswer = useCallback(({ item }: { item: typeof answers[0] }) => {
    const isOwnAnswer = item.isOwnAnswer;
    const hasReported = item.hasReported;
    const showEmojiPicker = emojiPickerAnswerId === item._id;
    const isSelected = selectedAnswerId === item._id;
    const isHighlighted = highlightedAnswerId === item._id;

    // Get top 3 emojis for display (reactionCounts is array of { emoji, count })
    const topEmojis = (item.reactionCounts ?? [])
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Author identity display logic
    const normalizedIdentity = resolveThreadAnswerIdentity(item, authorProfile, isOwnAnswer);
    const isAnon = normalizedIdentity.isAnonymous;
    const authorName = normalizedIdentity.authorName;
    const authorPhotoUrl = normalizedIdentity.authorPhotoUrl;
    const authorAge = normalizedIdentity.authorAge;
    const authorGender = normalizedIdentity.authorGender;
    const photoBlurMode = normalizedIdentity.photoBlurMode;

    const genderAccent = isAnon ? null : getCommentGenderAccent(authorGender ?? undefined);

    // CONNECT ELIGIBILITY RULE (Product Rule):
    // Show Connect for ALL answer types (anonymous, no-photo, full-view, photo, video, voice)
    // Only block for: own answer, existing pending request, already connected
    // NOTE: !isAnon was REMOVED - anonymous display doesn't block connection
    const promptScopedConnectKey = item.userId ? `${item.promptId}:${item.userId}` : null;
    const hasLocallySentConnect =
      connectSentFor.has(item._id) ||
      (promptScopedConnectKey ? connectSentFor.has(promptScopedConnectKey) : false);
    const effectiveConnectStatus =
      item.connectStatus !== 'none'
        ? item.connectStatus
        : hasLocallySentConnect
          ? 'pending'
          : 'none';
    const isEligibleForConnect = isPromptOwner && !item.hasSentConnect && !hasLocallySentConnect && !isOwnAnswer;
    const canConnect = isEligibleForConnect && isSelected;
    const hasSentConnect = isPromptOwner && (item.hasSentConnect || hasLocallySentConnect);

    // Compact media tile state machine. The tile occupies an 84×84 square on
    // the right of the answer body and supersedes both the old wide
    // mediaBadge and the inert privateMediaIndicator placeholder.
    //
    // States:
    //   'photo' | 'video' | 'voice' — viewer can open inline (mediaUrl present
    //     OR prompt-owner-only photo/video that requires a claim).
    //   'locked'   — viewer is not authorized (regular user looking at a
    //     creator-only photo/video/voice). Tile is non-interactive.
    //   'viewed'   — non-owner already consumed a one-time photo/video.
    //
    // BUG FIX: prompt creator viewing a creator-only photo/video used to fall
    // into the inert privateMediaIndicator branch (no onPress) so they could
    // not invoke the existing claim flow. The tile below makes that path
    // tappable for prompt owners — the backend (`claimAnswerMediaView`)
    // already authorizes them, only the UI affordance was missing.
    const tileMediaType: 'photo' | 'video' | 'voice' | null =
      item.type === 'photo' || item.type === 'video' || item.type === 'voice'
        ? item.type
        : null;
    const hasPlayableMedia = !!item.mediaUrl;
    const isCreatorOnly = item.visibility === 'owner_only';
    const canPromptOwnerClaim =
      isPromptOwner && !isOwnAnswer && item.hasMedia && !hasPlayableMedia &&
      (item.type === 'photo' || item.type === 'video');
    let tileState: 'photo' | 'video' | 'voice' | 'locked' | 'viewed' | null = null;
    if (tileMediaType) {
      if (item.hasViewedMedia && !isOwnAnswer && (tileMediaType === 'photo' || tileMediaType === 'video')) {
        tileState = 'viewed';
      } else if (hasPlayableMedia) {
        tileState = tileMediaType;
      } else if (canPromptOwnerClaim) {
        tileState = tileMediaType;
      } else if (item.hasMedia && !isOwnAnswer) {
        tileState = 'locked';
      }
    }
    // Voice now lives inside the same compact 84×84 tile as photo / video.
    // The icon swaps to `pause` while THIS answer's voice is playing so the
    // tile clearly reads as a play / stop control.
    const isThisVoicePlaying = tileState === 'voice' && playingVoiceId === item._id;
    // While playing, the tile shows a moving "0:03 / 0:10" clock and a
    // bottom progress bar. We prefer live `voiceDurMs` from the status
    // callback, falling back to the answer's recorded duration so the
    // total never reads as "0:00" before the first status tick lands.
    const voiceTotalMs = (() => {
      if (isThisVoicePlaying && voiceDurMs > 0) return voiceDurMs;
      const sec = item.durationSec || 0;
      return sec > 0 ? sec * 1000 : 0;
    })();
    const voiceProgressFraction = (() => {
      if (!isThisVoicePlaying) return 0;
      if (voiceTotalMs <= 0) return 0;
      // Clamp to [0, 1] — defensive against any callback over-shoot.
      return Math.min(1, Math.max(0, voicePosMs / voiceTotalMs));
    })();
    const tileIconName: keyof typeof Ionicons.glyphMap | null = (() => {
      switch (tileState) {
        case 'photo':
          return 'image';
        case 'video':
          return 'videocam';
        case 'voice':
          return isThisVoicePlaying ? 'pause' : 'play';
        case 'locked':
          return 'lock-closed';
        case 'viewed':
          return tileMediaType === 'video' ? 'videocam' : 'image';
        default:
          return null;
      }
    })();
    const tileMicrotext = (() => {
      if (tileState === 'locked') return 'Creator only';
      if (tileState === 'viewed') return 'Viewed';
      if (tileState === 'voice') {
        // Idle: show a clean "0:10" total when known, otherwise "Voice".
        if (!isThisVoicePlaying) {
          if (voiceTotalMs > 0) return formatVoiceClock(voiceTotalMs);
          return 'Voice';
        }
        // Playing: live "0:03 / 0:10" clock. If the duration is unknown
        // (some streams expose it lazily) fall back to just the elapsed
        // time so the user still sees movement.
        if (voiceTotalMs > 0) {
          return `${formatVoiceClock(voicePosMs)} / ${formatVoiceClock(voiceTotalMs)}`;
        }
        return formatVoiceClock(voicePosMs);
      }
      if (isCreatorOnly && (tileState === 'photo' || tileState === 'video')) return 'Tap once';
      if (tileState === 'photo' || tileState === 'video') return 'Tap to view';
      return null;
    })();
    const tileIsInteractive = tileState === 'photo' || tileState === 'video' ||
      (tileState === 'voice' && hasPlayableMedia);
    const tileA11yLabel = (() => {
      if (!tileState) return undefined;
      switch (tileState) {
        case 'photo':
          return canPromptOwnerClaim
            ? 'Open creator-only photo'
            : 'Open photo';
        case 'video':
          return canPromptOwnerClaim
            ? 'Open creator-only video'
            : 'Open video';
        case 'voice':
          if (!hasPlayableMedia) return 'Locked voice message';
          return isThisVoicePlaying ? 'Pause voice message' : 'Play voice message';
        case 'locked':
          return `${tileMediaType ?? 'Media'} locked — creator only`;
        case 'viewed':
          return `${tileMediaType ?? 'Media'} already viewed`;
        default:
          return undefined;
      }
    })();
    // Unified tile rule: every media answer with any resolved `tileState`
    // renders the same 84×84 square — no more split between the old
    // horizontal voice player and the tile. Tap routing still differs by
    // type (handled in `onPress` below).
    const showTile = !!tileState;

    return (
      <TouchableOpacity
        style={styles.answerCardWrapper}
        activeOpacity={0.8}
        onPress={() => isEligibleForConnect && handleToggleSelect(item._id)}
        onLongPress={() => handleOpenMenu(item._id, item.userId, isOwnAnswer, isExpired)}
        delayLongPress={400}
      >
        <View style={[
          styles.answerCard,
          isOwnAnswer && styles.answerCardOwn,
          isSelected && isEligibleForConnect && styles.answerCardSelected,
          isHighlighted && styles.answerCardHighlighted,
        ]}>
          {/* Header with 3-dot menu */}
          <View style={styles.answerHeader}>
            {/* Avatar: Anonymous icon OR photo (clear/blurred based on mode) OR placeholder */}
            <TodAvatar
              size={32}
              photoUrl={authorPhotoUrl ?? null}
              isAnonymous={isAnon}
              photoBlurMode={photoBlurMode ?? 'none'}
              label={authorName || 'User'}
              borderWidth={1}
              borderColor={PREMIUM.borderSubtle}
              backgroundColor={PREMIUM.bgHighlight}
              iconColor={PREMIUM.textMuted}
            />
            <View style={styles.answerInfo}>
              {/* Single identity row: name · age · colored gender icon */}
              <View style={styles.answerIdentityRow}>
                <Text
                  style={styles.answerName}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {isAnon ? 'Anonymous' : (authorName || 'User')}
                </Text>
                {!isAnon && authorAge ? (
                  <Text style={styles.answerAgeInline}>{`, ${authorAge}`}</Text>
                ) : null}
                {!isAnon && genderAccent ? (
                  <Ionicons
                    name={genderAccent.icon}
                    size={12}
                    color={genderAccent.color}
                    style={styles.answerGenderIcon}
                    accessibilityLabel={genderAccent.label}
                  />
                ) : null}
                {isOwnAnswer && (
                  <View style={styles.youBadge}>
                    <Text style={styles.youBadgeText}>You</Text>
                  </View>
                )}
              </View>
              {/* Time on its own muted line */}
              <Text style={styles.answerTime}>{getTimeAgo(item.createdAt)}</Text>
            </View>
          </View>

          {/* Body row: text column on the left, optional compact media tile
              on the right. The reaction strip lives at the bottom of the
              text column so it occupies the empty wedge to the left of the
              tile when text is short — eliminating the old separate bottom
              action band and ~42 dp of card height. `alignItems: 'stretch'`
              + text col `justifyContent: 'space-between'` ensures the strip
              floats to the visual baseline of the tile when text is short
              and sits below text when text is long. */}
          <View
            style={[
              styles.answerBodyRow,
              !showTile && styles.answerBodyRowNoTile,
            ]}
          >
            <View style={styles.answerBodyTextCol}>
              {item.text && item.text.trim().length > 0 && (
                <Text style={styles.answerText}>{item.text}</Text>
              )}

              {/* Reaction strip — relocated from the bottom action row.
                  Holds existing reaction bubbles + emoji-trigger + reply
                  plus button so the parent gestures still resolve to the
                  deepest TouchableOpacity child first (no tap-stealing). */}
              <View style={styles.reactionStripInline}>
                {topEmojis.length > 0 && (
                  <View style={styles.reactionBubblesInline}>
                    {topEmojis.slice(0, 3).map(({ emoji, count }) => (
                      <TouchableOpacity
                        key={emoji}
                        style={[
                          styles.reactionBubbleSmall,
                          item.myReaction === emoji && styles.reactionBubbleSmallActive,
                        ]}
                        onPress={() => handleReact(item._id, item.myReaction === emoji ? '' : emoji)}
                      >
                        <Text style={styles.reactionEmojiSmall}>{emoji}</Text>
                        <Text style={styles.reactionCountSmall}>{count}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <TouchableOpacity
                  style={styles.addReactionInline}
                  onPress={() => setEmojiPickerAnswerId(showEmojiPicker ? null : item._id)}
                  accessibilityRole="button"
                  accessibilityLabel="Add reaction"
                >
                  <Ionicons
                    name={item.myReaction ? 'happy' : 'happy-outline'}
                    size={16}
                    color={item.myReaction ? PREMIUM.coral : PREMIUM.textMuted}
                  />
                </TouchableOpacity>
                {canReplyInline && (
                  <TouchableOpacity
                    style={styles.replyBtnInline}
                    onPress={openComposer}
                    accessibilityRole="button"
                    accessibilityLabel="Add your response"
                  >
                    <Ionicons name="add-circle-outline" size={16} color={PREMIUM.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Edit pencil intentionally NOT rendered on the card.
                Edit is now exposed only via the long-press action sheet
                (Cancel | Edit | Delete), which keeps the card surface
                clean and removes a visual affordance that competed with
                the media tile. See the comment-menu Modal below. */}

            {showTile && tileIconName && (
              <TouchableOpacity
                style={[
                  styles.todMediaTile,
                  tileState === 'locked' && styles.todMediaTileLocked,
                  tileState === 'viewed' && styles.todMediaTileViewed,
                  isThisVoicePlaying && styles.todMediaTileVoiceActive,
                ]}
                activeOpacity={tileIsInteractive ? 0.85 : 1}
                disabled={!tileIsInteractive}
                onPress={() => {
                  if (!tileIsInteractive) return;
                  // Voice plays/pauses inline inside the tile; photo and
                  // video continue to open the full-screen viewer via the
                  // existing claim flow.
                  if (tileState === 'voice' && hasPlayableMedia && item.mediaUrl) {
                    handleToggleVoiceTile(item._id, item.mediaUrl);
                    return;
                  }
                  handleViewMedia(item);
                }}
                accessibilityRole="button"
                accessibilityLabel={tileA11yLabel}
              >
                {/* Subtle vertical gradient gives the tile depth without
                    competing with the icon chip. Lighter on top, base on
                    bottom — reads as a glass chip rather than a flat square.
                    `pointerEvents='none'` keeps the existing tap target. */}
                <LinearGradient
                  colors={
                    tileState === 'locked' || tileState === 'viewed'
                      ? [PREMIUM.bgHighlight, PREMIUM.bgBase] as const
                      : [PREMIUM.bgHighlight, PREMIUM.bgElevated] as const
                  }
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                  pointerEvents="none"
                />
                {/* Icon chip — wraps the Ionicon in a smaller rounded square so
                    the icon reads as an intentional media chip rather than a
                    free-floating system glyph. */}
                <View
                  style={[
                    styles.todMediaTileIconChip,
                    tileState === 'locked' && styles.todMediaTileIconChipMuted,
                    tileState === 'viewed' && styles.todMediaTileIconChipMuted,
                  ]}
                >
                  <Ionicons
                    name={tileIconName}
                    size={20}
                    color={
                      tileState === 'locked'
                        ? PREMIUM.textMuted
                        : tileState === 'viewed'
                          ? PREMIUM.textMuted
                          : PREMIUM.coral
                    }
                  />
                </View>
                {/* Lock corner badge for creator-only tappable photos/videos
                    so the prompt owner can tell at a glance that the media is
                    private even though it is openable for them. */}
                {isCreatorOnly && tileIsInteractive && (tileState === 'photo' || tileState === 'video') && (
                  <View style={styles.todMediaTileCorner}>
                    <Ionicons name="lock-closed" size={9} color="#FFF" />
                  </View>
                )}
                {tileMicrotext && (
                  <Text
                    style={[
                      styles.todMediaTileMicrotext,
                      tileState === 'locked' && styles.todMediaTileMicrotextMuted,
                      tileState === 'viewed' && styles.todMediaTileMicrotextMuted,
                      isThisVoicePlaying && styles.todMediaTileMicrotextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {tileMicrotext}
                  </Text>
                )}
                {/* Voice playback progress bar — pinned to the bottom of
                    the tile only while THIS voice is playing. The track is
                    a faint hairline so it doesn't draw attention when
                    idle; the fill is coral and animates as `voicePosMs`
                    advances (status callback throttled to ~4Hz). */}
                {isThisVoicePlaying && (
                  <View
                    style={styles.todMediaTileVoiceProgressTrack}
                    pointerEvents="none"
                  >
                    <View
                      style={[
                        styles.todMediaTileVoiceProgressFill,
                        { width: `${voiceProgressFraction * 100}%` },
                      ]}
                    />
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Voice playback now happens inside the compact tile above —
              the old horizontal `TodVoicePlayer` block was removed so
              photo, video, and voice all share one consistent surface. */}

          {/* Connect row — only rendered when prompt-owner is viewing
              someone else's answer AND there is real Connect content to
              show (eligible, sent-pending, or connected). For all other
              cases (own answer / non-prompt-owner) this row is suppressed
              entirely so the card height drops by ~42 dp.
              Edit and reactions have been relocated (header / body row),
              so this row only contains Connect-state UI. */}
          {(canConnect || (isEligibleForConnect && !isSelected) || hasSentConnect) && (
            <View style={styles.actionRow}>
              <View style={styles.connectSection}>
                {/* Connect button - only when selected and eligible */}
                {canConnect && (
                  <TouchableOpacity
                    style={styles.connectBtnCompact}
                    onPress={() => handleSendConnect(item._id)}
                    disabled={connectSending === item._id}
                  >
                    {connectSending === item._id ? (
                      <ActivityIndicator size="small" color={PREMIUM.coral} />
                    ) : (
                      <>
                        <Ionicons name="paper-plane" size={12} color={PREMIUM.coral} />
                        <Text style={styles.connectBtnCompactText}>Connect</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                {/* Placeholder to maintain height when eligible but not selected */}
                {isEligibleForConnect && !isSelected && (
                  <View style={styles.connectPlaceholder}>
                    <Text style={styles.connectPlaceholderText}>Tap to connect</Text>
                  </View>
                )}

                {/* Connect status indicator - P0-FIX: Show different states */}
                {hasSentConnect && effectiveConnectStatus === 'pending' && (
                  <View style={styles.connectPendingInline}>
                    <Ionicons name="hourglass-outline" size={12} color="#F5A623" />
                    <Text style={styles.connectPendingInlineText}>Waiting</Text>
                  </View>
                )}
                {hasSentConnect && effectiveConnectStatus === 'connected' && (
                  <TouchableOpacity
                    style={[styles.connectPendingInline, { backgroundColor: 'rgba(76, 175, 80, 0.15)' }]}
                    onPress={() => {
                      // Navigate to Phase-2 Messages to find the conversation
                      router.push('/(main)/(private)/(tabs)/chats');
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={12} color="#4CAF50" />
                    <Text style={[styles.connectPendingInlineText, { color: '#4CAF50' }]}>Connected</Text>
                  </TouchableOpacity>
                )}
                {hasSentConnect && effectiveConnectStatus === 'removed' && (
                  <View style={[styles.connectPendingInline, { backgroundColor: 'rgba(110, 110, 130, 0.14)' }]}>
                    <Ionicons name="remove-circle-outline" size={12} color={PREMIUM.textMuted} />
                    <Text style={[styles.connectPendingInlineText, { color: PREMIUM.textMuted }]}>Handled</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Emoji picker overlay - works with inline reactions */}
          {showEmojiPicker && (
            <View style={styles.emojiPickerOverlay}>
              {REACTION_EMOJIS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={[
                    styles.emojiPickerItem,
                    item.myReaction === emoji && styles.emojiPickerItemActive,
                  ]}
                  onPress={() => handleReact(item._id, item.myReaction === emoji ? '' : emoji)}
                >
                  <Text style={styles.emojiPickerEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Hidden indicator for reported content */}
          {item.isHiddenForOthers && !isOwnAnswer && (
            <View style={styles.hiddenIndicator}>
              <Ionicons name="eye-off" size={12} color={PREMIUM.textMuted} />
              <Text style={styles.hiddenText}>Hidden due to reports</Text>
            </View>
          )}

          {/* Reported badge */}
          {hasReported && !isOwnAnswer && (
            <View style={styles.reportedBadge}>
              <Ionicons name="flag" size={10} color={PREMIUM.textMuted} />
              <Text style={styles.reportedText}>Reported</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [
    // P3-004: keep answer-row deps narrow so unrelated screen state changes don't reshuffle renderItem
    emojiPickerAnswerId,
    selectedAnswerId,
    highlightedAnswerId,
    authorProfile.name,
    authorProfile.age,
    authorProfile.gender,
    authorProfile.photoUrl,
    isPromptOwner,
    connectSentFor,
    handleToggleSelect,
    handleOpenMenu,
    handleViewMedia,
    handleReact,
    handleSendConnect,
    connectSending,
    isExpired,
    canReplyInline,
    openComposer,
    // Voice tile playback — re-render answers when the active voice
    // changes so the tapped tile flips its play / pause icon and
    // microtext. `voicePosMs` / `voiceDurMs` drive the live "0:03 /
    // 0:10" clock and the bottom progress bar (status callback is
    // throttled to ~4Hz so this is a cheap re-render).
    // `handleToggleVoiceTile` is stable per playingVoiceId.
    playingVoiceId,
    voicePosMs,
    voiceDurMs,
    handleToggleVoiceTile,
  ]);

  // Loading state
  if (isLoading) {
    return (
      <LinearGradient
        colors={[PREMIUM.bgDeep, PREMIUM.bgBase] as const}
        style={[styles.container, styles.centered, { paddingTop: insets.top }]}
      >
        <ActivityIndicator size="large" color={PREMIUM.coral} />
        <Text style={styles.loadingText}>Loading thread...</Text>
      </LinearGradient>
    );
  }

  // Not found state
  if (!prompt) {
    return (
      <LinearGradient
        colors={[PREMIUM.bgDeep, PREMIUM.bgBase] as const}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBackToSource} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={PREMIUM.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Thread</Text>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={48} color={PREMIUM.textMuted} />
          <Text style={styles.emptyTitle}>Prompt not found</Text>
          <Text style={styles.emptySubtitle}>This prompt may have expired or been removed.</Text>
        </View>
      </LinearGradient>
    );
  }

  const isTruth = prompt.type === 'truth';
  const timeLeft = formatTimeLeft(prompt.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000);

  // Helper for gender icon (Ionicons)
  const getGenderIcon = (gender: string | undefined): keyof typeof Ionicons.glyphMap | null => {
    if (!gender) return null;
    const g = gender.toLowerCase();
    if (g === 'male' || g === 'm') return 'male';
    if (g === 'female' || g === 'f') return 'female';
    if (
      g === 'non_binary' ||
      g === 'non-binary' ||
      g === 'nonbinary' ||
      g === 'nb' ||
      g === 'other'
    ) {
      return 'male-female';
    }
    return null;
  };

  // Helper for gender color
  const getGenderColor = (gender: string | undefined): string => {
    if (!gender) return PREMIUM.genderOther;
    const g = gender.toLowerCase();
    if (g === 'female' || g === 'f') return PREMIUM.genderFemale;
    if (g === 'male' || g === 'm') return PREMIUM.genderMale;
    return PREMIUM.genderOther;
  };

  // Build owner identity display string
  const ownerIsAnonymous = prompt.isAnonymous !== false; // Default to anonymous if undefined
  const ownerAge = prompt.ownerAge;
  const ownerGender = prompt.ownerGender;
  const ownerName = prompt.ownerName;
  const ownerPhotoUrl = prompt.ownerPhotoUrl;
  const ownerPhotoBlurMode = prompt.photoBlurMode; // FIX: Extract blur mode for header photo
  const genderIcon = getGenderIcon(ownerGender);
  const genderColor = getGenderColor(ownerGender);

  // Type-specific gradient colors
  const typeGradient: readonly [string, string] = isTruth
    ? [PREMIUM.truthPurple, PREMIUM.truthPurpleSoft] as const
    : [PREMIUM.dareOrange, PREMIUM.dareOrangeSoft] as const;

  return (
    <LinearGradient
      colors={[PREMIUM.bgDeep, PREMIUM.bgBase] as const}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      {/* Premium Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBackToSource} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={PREMIUM.textPrimary} />
        </TouchableOpacity>
        <LinearGradient
          colors={typeGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerBadge}
        >
          <Text style={styles.headerBadgeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }} />
        <View style={styles.timeLeftBadge}>
          <Ionicons name="time-outline" size={12} color={PREMIUM.textSecondary} />
          <Text style={styles.timeLeftText}>{timeLeft}</Text>
        </View>
      </View>

      {/* Premium Question Block (Hero Card) - elegant thin border, long-press for actions */}
      <Pressable
        onLongPress={handlePromptLongPress}
        delayLongPress={400}
        style={[
          styles.questionBlock,
          { borderColor: isTruth ? `${PREMIUM.truthPurple}40` : `${PREMIUM.dareOrange}40` }
        ]}
      >
        {/* Owner Identity Row - matches homepage/feed layout */}
        <View style={styles.ownerIdentityRow}>
          {/* Left: Photo (clear/blurred) or Anonymous icon or placeholder */}
          <TodAvatar
            size={40}
            photoUrl={ownerPhotoUrl ?? null}
            isAnonymous={ownerIsAnonymous}
            photoBlurMode={ownerPhotoBlurMode ?? 'none'}
            label={ownerName || 'User'}
            borderWidth={2}
            borderColor={PREMIUM.borderSubtle}
            backgroundColor={PREMIUM.bgHighlight}
            iconColor={PREMIUM.textMuted}
          />

          {/* Owner info: name + age/gender on SAME ROW (matches homepage layout) */}
          <View style={styles.ownerInfoRow}>
            <Text style={styles.ownerNamePremium} numberOfLines={1}>
              {ownerIsAnonymous ? 'Anonymous' : (ownerName || 'User')}
            </Text>
            {!ownerIsAnonymous && (ownerAge || ownerGender) && (
              <View style={styles.ownerMetaInline}>
                {ownerAge && (
                  <Text style={styles.ownerAgeInline}>{ownerAge}</Text>
                )}
                {ownerGender && genderIcon && (
                  <>
                    <View style={[styles.genderDotInline, { backgroundColor: genderColor }]} />
                    <Ionicons name={genderIcon} size={11} color={genderColor} />
                  </>
                )}
              </View>
            )}
          </View>

          {/* Answer count badge */}
          {visibleAnswerCount > 0 && (
            <View style={styles.answerCountBadge}>
              <Ionicons name="chatbubbles" size={12} color={PREMIUM.coral} />
              <Text style={styles.answerCountText}>{visibleAnswerCount}</Text>
            </View>
          )}
        </View>

        {/* Hero Prompt Text - with inline edit support */}
        {isEditingPrompt ? (
          <View style={styles.inlineEditContainer}>
            <TextInput
              style={styles.inlineEditInput}
              value={editPromptText}
              onChangeText={setEditPromptText}
              multiline
              maxLength={280}
              autoFocus
              placeholder="Edit your prompt..."
              placeholderTextColor={PREMIUM.textMuted}
            />
            <Text style={styles.inlineEditCharCount}>
              {editPromptText.length}/280
            </Text>
            <View style={styles.inlineEditActions}>
              <TouchableOpacity
                style={styles.inlineEditCancelBtn}
                onPress={handleCancelEditPrompt}
                disabled={isSavingPromptEdit}
              >
                <Text style={styles.inlineEditCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.inlineEditSaveBtn,
                  (editPromptText.trim().length < 10 || isSavingPromptEdit) && styles.inlineEditSaveBtnDisabled,
                ]}
                onPress={handleSaveEditPrompt}
                disabled={editPromptText.trim().length < 10 || isSavingPromptEdit}
              >
                {isSavingPromptEdit ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.inlineEditSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <Text style={styles.promptText}>{prompt.text}</Text>
        )}

        {/* Prompt Reactions Row */}
        <View style={styles.promptReactionRow}>
          {/* Reaction bubbles */}
          <View style={styles.promptReactionBubbles}>
            {(prompt.reactionCounts ?? [])
              .slice()
              .sort((a, b) => b.count - a.count)
              .slice(0, 3)
              .map(({ emoji, count }) => (
                <TouchableOpacity
                  key={emoji}
                  style={[
                    styles.promptReactionBubble,
                    prompt.myReaction === emoji && styles.promptReactionBubbleActive,
                  ]}
                  onPress={() => handlePromptReact(prompt.myReaction === emoji ? '' : emoji)}
                >
                  <Text style={styles.promptReactionEmoji}>{emoji}</Text>
                  <Text style={styles.promptReactionCount}>{count}</Text>
                </TouchableOpacity>
              ))}
          </View>
          {/* Add reaction button */}
          <TouchableOpacity
            style={styles.promptAddReaction}
            onPress={() => setShowPromptEmojiPicker(!showPromptEmojiPicker)}
          >
            <Ionicons
              name={prompt.myReaction ? 'happy' : 'happy-outline'}
              size={14}
              color={prompt.myReaction ? PREMIUM.coral : PREMIUM.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* Prompt Emoji Picker */}
        {showPromptEmojiPicker && (
          <View style={styles.promptEmojiPicker}>
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={[
                  styles.promptEmojiItem,
                  prompt.myReaction === emoji && styles.promptEmojiItemActive,
                ]}
                onPress={() => handlePromptReact(prompt.myReaction === emoji ? '' : emoji)}
              >
                <Text style={styles.promptEmojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

      </Pressable>

      {/* Expired banner */}
      {isExpired && (
        <View style={styles.expiredBanner}>
          <Ionicons name="time-outline" size={16} color="#FF9800" />
          <Text style={styles.expiredBannerText}>This prompt has expired. No new responses allowed.</Text>
        </View>
      )}

      {/* Answers list (SCROLLABLE area - flex:1 takes remaining space) */}
      <FlatList
        ref={listRef}
        data={answers}
        keyExtractor={(item) => item._id}
        renderItem={renderAnswer}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        style={styles.answersListContainer}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {showRequestContextBanner && (
              <View style={styles.requestContextBanner}>
                <Ionicons name="git-merge" size={15} color={PREMIUM.coral} />
                <Text style={styles.requestContextBannerText}>
                  Request context highlighted
                </Text>
              </View>
            )}
            {/* RECEIVER VISIBILITY: Simple inline Accept/Reject bar */}
            {visiblePendingRequestsForPrompt.map((request, index) => (
              <View
                key={request._id}
                style={[
                  styles.pendingConnectBar,
                  index > 0 ? styles.pendingConnectBarStacked : null,
                ]}
              >
                <Ionicons name="heart" size={16} color={PREMIUM.coral} />
                <Text style={styles.pendingConnectBarText}>
                  {visiblePendingRequestsForPrompt.length > 1
                    ? `${request.senderName || 'Prompt owner'} wants to connect`
                    : 'Connect request from prompt owner'}
                </Text>
                <View style={styles.pendingConnectBarActions}>
                  <TouchableOpacity
                    style={styles.pendingConnectReject}
                    onPress={() => handleRejectConnect(request._id)}
                    disabled={!!respondingTo}
                  >
                    {respondingTo === request._id ? (
                      <ActivityIndicator size="small" color={PREMIUM.textMuted} />
                    ) : (
                      <Text style={styles.pendingConnectRejectText}>Decline</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pendingConnectAcceptBtn}
                    onPress={() => handleAcceptConnect(request._id)}
                    disabled={!!respondingTo}
                  >
                    {respondingTo === request._id ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.pendingConnectAcceptBtnText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <View style={styles.commentsHeader}>
              <Text style={styles.commentsHeaderText}>
                {visibleAnswerCount === 0
                  ? 'Be the first to respond'
                  : `${visibleAnswerCount} ${visibleAnswerCount === 1 ? 'Response' : 'Responses'}`}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyComments}>
            <Ionicons name="chatbubble-outline" size={32} color={PREMIUM.textMuted} />
            <Text style={styles.emptyCommentsText}>No responses yet</Text>
            <Text style={styles.emptyCommentsSubtext}>Tap the + button to share your thoughts</Text>
          </View>
        }
        // P2-003: Performance props for thread FlatList
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={50}
        windowSize={5}
      />

      {/* FAB (only if not expired, hasn't commented, and NOT prompt owner) */}
      {/* SELF-COMMENT RESTRICTION: Owner cannot answer their own prompt */}
      {!isExpired && !myAnswer && !isPromptOwner && (
        <View style={[styles.commentFab, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
          <TouchableOpacity
            style={styles.fabBtn}
            onPress={() => setShowUnifiedComposer(true)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[PREMIUM.coral, PREMIUM.coralSoft] as const}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.fabGradient}
            >
              <Ionicons name="add" size={28} color="#FFF" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Premium Comment Menu Modal — Centered popup.
          Own answer (active prompt):    Cancel | Edit | Delete  (3 equal cols)
          Own answer (expired prompt):   Cancel | Delete         (2 equal cols, edit suppressed)
          Other user's answer:           Cancel | Report         (2 equal cols)
          Tapping Delete still triggers the secondary `Alert.alert` confirmation
          inside `handleDeleteAnswer` (preserving the existing safety message). */}
      <Modal
        visible={!!menuAnswerId}
        transparent
        animationType="fade"
        onRequestClose={handleCloseMenu}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={handleCloseMenu}
        >
          <View style={styles.menuContent}>
            <Text style={styles.menuTitle}>
              {menuIsOwnAnswer ? 'Manage response' : 'Report Comment'}
            </Text>
            <Text style={styles.menuSubtitle}>
              {menuIsOwnAnswer
                ? (menuIsExpired
                    ? 'This prompt has expired. You can still delete your response.'
                    : 'Edit or delete your response.')
                : 'Help us keep the community safe.'}
            </Text>

            <View style={styles.menuActions}>
              <TouchableOpacity style={styles.menuCancelBtn} onPress={handleCloseMenu}>
                <Text style={styles.menuCancelText}>Cancel</Text>
              </TouchableOpacity>

              {menuIsOwnAnswer ? (
                <>
                  {!menuIsExpired && (
                    <TouchableOpacity
                      style={[styles.menuItem, styles.menuItemAccent]}
                      onPress={handleMenuEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Edit your response"
                    >
                      <Ionicons name="pencil" size={16} color={PREMIUM.coral} />
                      <Text style={styles.menuItemTextAccent}>Edit</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.menuItem, styles.menuItemDestructive]}
                    onPress={handleMenuDelete}
                    accessibilityRole="button"
                    accessibilityLabel="Delete your response"
                  >
                    <Ionicons name="trash-outline" size={16} color="#FFF" />
                    <Text style={styles.menuItemTextDestructive}>Delete</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.menuItem, styles.menuItemDestructive]}
                  onPress={handleMenuReport}
                  accessibilityRole="button"
                  accessibilityLabel="Report this comment"
                >
                  <Ionicons name="flag-outline" size={16} color="#FFF" />
                  <Text style={styles.menuItemTextDestructive}>Report</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Premium Prompt Action Modal - Centered popup (long-press on prompt) */}
      <Modal
        visible={showPromptActionPopup}
        transparent
        animationType="fade"
        onRequestClose={handleClosePromptActionPopup}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={handleClosePromptActionPopup}
        >
          <View style={styles.menuContent}>
            <Text style={styles.menuTitle}>
              {isPromptOwner ? 'Prompt Options' : 'Report Prompt'}
            </Text>
            <Text style={styles.menuSubtitle}>
              {isPromptOwner
                ? 'Edit or delete your prompt.'
                : 'Help us keep the community safe.'}
            </Text>

            <View style={styles.menuActions}>
              <TouchableOpacity style={styles.menuCancelBtn} onPress={handleClosePromptActionPopup}>
                <Text style={styles.menuCancelText}>Cancel</Text>
              </TouchableOpacity>

              {isPromptOwner ? (
                <>
                  {/* Edit button - inline edit in thread */}
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={handleStartEditPrompt}
                  >
                    <Ionicons name="pencil-outline" size={16} color={PREMIUM.textSecondary} />
                    <Text style={styles.menuItemText}>Edit</Text>
                  </TouchableOpacity>

                  {/* Delete button */}
                  <TouchableOpacity
                    style={[styles.menuItem, styles.menuItemDestructive]}
                    onPress={handleDeletePrompt}
                    disabled={isDeletingPrompt}
                  >
                    {isDeletingPrompt ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Ionicons name="trash-outline" size={16} color="#FFF" />
                        <Text style={styles.menuItemTextDestructive}>Delete</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.menuItem, styles.menuItemDestructive]}
                  onPress={handleReportPrompt}
                >
                  <Ionicons name="flag-outline" size={16} color="#FFF" />
                  <Text style={styles.menuItemTextDestructive}>Report</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Unified Answer Composer - text + optional media */}
      <UnifiedAnswerComposer
        visible={showUnifiedComposer}
        prompt={{
          id: prompt._id as unknown as string,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          ownerUserId: prompt.ownerUserId,
          answerCount: visibleAnswerCount,
          activeCount: 0,
          createdAt: prompt.createdAt,
          expiresAt: prompt.expiresAt,
        }}
        initialText={myAnswer?.text || ''}
        initialAttachment={myAnswer?.mediaUrl ? {
          kind: myAnswer.type === 'voice' ? 'audio' : (myAnswer.type === 'video' ? 'video' : 'photo'),
          uri: myAnswer.mediaUrl,
          durationMs: myAnswer.durationSec ? myAnswer.durationSec * 1000 : undefined,
          isFrontCamera: myAnswer.isFrontCamera,
        } as Attachment : null}
        existingIdentityMode={myAnswer?.identityMode as IdentityMode | undefined}
        isNewAnswer={!myAnswer}
        // VISUAL MEDIA LOCK: Lock photo/video if already viewed by authorized viewer
        visualMediaLocked={myAnswer?.isVisualMediaConsumed ?? false}
        onClose={() => setShowUnifiedComposer(false)}
        onSubmit={handleUnifiedSubmit}
        isSubmitting={isSubmitting}
      />

      {/* Media Viewer Modal - Tap to view */}
      <Modal
        visible={!!viewingMedia}
        transparent
        animationType="fade"
        onRequestClose={handleCloseMediaViewer}
      >
        <View style={styles.mediaViewerOverlay}>
          <TouchableOpacity
            style={styles.mediaViewerClose}
            onPress={handleCloseMediaViewer}
          >
            <Ionicons name="close" size={28} color="#FFF" />
          </TouchableOpacity>

          {viewingMedia?.mediaType === 'photo' && (
            <Image
              source={{ uri: viewingMedia.mediaUrl }}
              style={[
                styles.mediaViewerImage,
                viewingMedia.isFrontCamera && styles.unmirrorMedia,
              ]}
              contentFit="contain"
            />
          )}

          {viewingMedia?.mediaType === 'video' && (
            <View style={styles.videoContainer}>
              <Video
                source={{ uri: viewingMedia.mediaUrl }}
                style={[
                  styles.mediaViewerVideo,
                  viewingMedia.isFrontCamera && styles.unmirrorMedia,
                ]}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                useNativeControls={!viewingMedia.isFrontCamera}
                isLooping={false}
                onPlaybackStatusUpdate={(status) => {
                  if (status.isLoaded && viewingMedia.isFrontCamera) {
                    setVideoProgress({
                      position: status.positionMillis ?? 0,
                      duration: status.durationMillis ?? 0,
                      isPlaying: status.isPlaying ?? false,
                    });
                  }
                }}
              />
              {/* T/D VIDEO FIX: Custom progress bar for front camera videos (unflipped) */}
              {viewingMedia.isFrontCamera && videoProgress.duration > 0 && (
                <View style={styles.customVideoProgress}>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${(videoProgress.position / videoProgress.duration) * 100}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressTime}>
                    {Math.floor(videoProgress.position / 1000)}s / {Math.floor(videoProgress.duration / 1000)}s
                  </Text>
                </View>
              )}
            </View>
          )}

          {!viewingMedia?.isOwnAnswer && (
            <View style={styles.mediaViewerHint}>
              <Ionicons name="eye-outline" size={14} color="#FFF" />
              <Text style={styles.mediaViewerHintText}>
                One-time view — you won't be able to view this again
              </Text>
            </View>
          )}
        </View>
      </Modal>

      {/* Report Reason Modal */}
      <Modal
        visible={reportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeReportModal}
      >
        <View style={styles.reportModalOverlay}>
          <View style={styles.reportModalContent}>
            <View style={styles.reportModalHeader}>
              <Text style={styles.reportModalTitle}>
                {isReportingPrompt ? 'Report Prompt' : 'Report Comment'}
              </Text>
              <TouchableOpacity onPress={closeReportModal}>
                <Ionicons name="close" size={24} color={PREMIUM.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.reportModalSubtitle}>
              Why are you reporting this {isReportingPrompt ? 'prompt' : 'comment'}?
            </Text>

            {/* Reason selection */}
            <View style={styles.reportReasonList}>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.code}
                  style={[
                    styles.reportReasonItem,
                    selectedReportReason === reason.code && styles.reportReasonItemSelected,
                  ]}
                  onPress={() => setSelectedReportReason(reason.code)}
                >
                  <Text style={styles.reportReasonIcon}>{reason.icon}</Text>
                  <Text style={[
                    styles.reportReasonLabel,
                    selectedReportReason === reason.code && styles.reportReasonLabelSelected,
                  ]}>
                    {reason.label}
                  </Text>
                  {selectedReportReason === reason.code && (
                    <Ionicons name="checkmark-circle" size={20} color={PREMIUM.coral} />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Optional additional details (shown after reason selected) */}
            {selectedReportReason && (
              <View style={styles.reportTextContainer}>
                <Text style={styles.reportTextLabel}>Additional details (optional)</Text>
                <TextInput
                  style={styles.reportTextInput}
                  placeholder="Add more context..."
                  placeholderTextColor={PREMIUM.textMuted}
                  value={reportReasonText}
                  onChangeText={setReportReasonText}
                  multiline
                  maxLength={500}
                />
              </View>
            )}

            {/* Submit button */}
            <TouchableOpacity
              style={[
                styles.reportSubmitButton,
                !selectedReportReason && styles.reportSubmitButtonDisabled,
              ]}
              onPress={submitReport}
              disabled={!selectedReportReason || isSubmittingReport}
            >
              {isSubmittingReport ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.reportSubmitButtonText}>Submit Report</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* FIX: Post-accept success sheet (matching chats.tsx behavior) */}
      {successSheet?.visible && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setSuccessSheet(null)}
        >
          <View style={styles.successOverlay}>
            <View style={styles.successSheet}>
              {/* Both users' photos side by side */}
              <View style={styles.successAvatarsRow}>
                {/* Sender photo (T/D requester) */}
                <View style={styles.successAvatarContainer}>
                  <TodAvatar
                    size={70}
                    photoUrl={successSheet.senderPhotoUrl ?? null}
                    isAnonymous={successSheet.senderIsAnonymous}
                    photoBlurMode={successSheet.senderPhotoBlurMode ?? 'none'}
                    label={successSheet.senderName}
                    borderWidth={3}
                    borderColor={PREMIUM.coral}
                    backgroundColor={PREMIUM.bgBase}
                    textColor={PREMIUM.textPrimary}
                    iconColor={PREMIUM.textMuted}
                    style={styles.successAvatar}
                  />
                  <Text style={styles.successAvatarName} numberOfLines={1}>
                    {successSheet.senderName}
                  </Text>
                </View>

                {/* Heart icon between photos */}
                <View style={styles.successHeartContainer}>
                  <Ionicons name="heart" size={32} color={PREMIUM.coral} />
                </View>

                {/* Recipient photo (current user / acceptor) */}
                <View style={styles.successAvatarContainer}>
                  <TodAvatar
                    size={70}
                    photoUrl={successSheet.recipientPhotoUrl ?? null}
                    isAnonymous={successSheet.recipientIsAnonymous}
                    photoBlurMode={successSheet.recipientPhotoBlurMode ?? 'none'}
                    label={successSheet.recipientName}
                    borderWidth={3}
                    borderColor={PREMIUM.coral}
                    backgroundColor={PREMIUM.bgBase}
                    textColor={PREMIUM.textPrimary}
                    iconColor={PREMIUM.textMuted}
                    style={styles.successAvatar}
                  />
                  <Text style={styles.successAvatarName} numberOfLines={1}>
                    {successSheet.recipientName}
                  </Text>
                </View>
              </View>

              {/* Title */}
              <Text style={styles.successTitle}>
                {successSheet.alreadyMatched ? "You're already matched" : "Truth or Dare connection 🎲"}
              </Text>
              <Text style={styles.successSubtitle}>
                {successSheet.alreadyMatched
                  ? `You and ${successSheet.senderName} already have a conversation.`
                  : `You and ${successSheet.senderName} can now chat.`}
              </Text>

              {/* Actions */}
              <View style={styles.successActions}>
                <TouchableOpacity
                  style={styles.successPrimaryBtn}
                  onPress={() => {
                    const convoId = successSheet.conversationId;
                    setSuccessSheet(null);
                    router.push(`/(main)/(private)/(tabs)/chats/${convoId}` as any);
                  }}
                >
                  <Ionicons name="chatbubble" size={18} color="#FFF" />
                  <Text style={styles.successPrimaryText}>
                    {successSheet.alreadyMatched ? 'Continue Chat' : 'Open Chat'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.successSecondaryBtn}
                  onPress={() => setSuccessSheet(null)}
                >
                  <Text style={styles.successSecondaryText}>Keep Discovering</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  // Base
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: PREMIUM.textSecondary },

  // Premium Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PREMIUM.borderSubtle,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PREMIUM.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  headerBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: PREMIUM.textPrimary },
  timeLeftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: PREMIUM.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  timeLeftText: { fontSize: 12, color: PREMIUM.textSecondary, fontWeight: '500' },

  // Premium Question Block (Hero Card) - elegant thin border
  questionBlock: {
    backgroundColor: PREMIUM.bgElevated,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: PREMIUM.borderSubtle, // Will be overridden inline with type color
  },
  ownerIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  ownerAvatarAnon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: PREMIUM.borderSubtle,
  },
  ownerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerInfo: {
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
    flex: 1,
    marginLeft: 12,
  },
  ownerNamePremium: {
    fontSize: 13,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    letterSpacing: 0.2,
  },
  ownerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ownerAge: {
    fontSize: 11,
    fontWeight: '500',
    color: PREMIUM.textMuted,
  },
  genderDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    opacity: 0.7,
  },
  // Row layout for name + age/gender inline (matches homepage)
  ownerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginLeft: 12,
  },
  ownerMetaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ownerAgeInline: {
    fontSize: 11,
    fontWeight: '500',
    color: PREMIUM.textMuted,
  },
  genderDotInline: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    opacity: 0.7,
  },
  // Blur container for prompt owner photo
  ownerAvatarBlurContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: PREMIUM.bgHighlight,
  },
  ownerAvatarBlurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  answerCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${PREMIUM.coral}20`,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  answerCountText: {
    fontSize: 13,
    fontWeight: '700',
    color: PREMIUM.coral,
  },
  promptText: {
    fontSize: 18,
    fontWeight: '600',
    color: PREMIUM.textPrimary,
    lineHeight: 26,
  },
  // Inline Edit Styles
  inlineEditContainer: {
    marginBottom: 8,
  },
  inlineEditInput: {
    fontSize: 18,
    fontWeight: '600',
    color: PREMIUM.textPrimary,
    lineHeight: 26,
    backgroundColor: PREMIUM.bgHighlight,
    borderRadius: 12,
    padding: 14,
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: PREMIUM.coral,
  },
  inlineEditCharCount: {
    fontSize: 12,
    color: PREMIUM.textMuted,
    textAlign: 'right',
    marginTop: 4,
    marginRight: 4,
  },
  inlineEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  inlineEditCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: PREMIUM.bgHighlight,
  },
  inlineEditCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  inlineEditSaveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: PREMIUM.coral,
    minWidth: 70,
    alignItems: 'center',
  },
  inlineEditSaveBtnDisabled: {
    backgroundColor: PREMIUM.bgHighlight,
  },
  inlineEditSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
  // Prompt Reaction Styles - Compact
  promptReactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  promptReactionBubbles: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  promptReactionBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: PREMIUM.bgHighlight,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  promptReactionBubbleActive: {
    backgroundColor: `${PREMIUM.coral}20`,
    borderColor: `${PREMIUM.coral}40`,
  },
  promptReactionEmoji: {
    fontSize: 12,
  },
  promptReactionCount: {
    fontSize: 10,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  promptAddReaction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  promptEmojiPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: PREMIUM.bgHighlight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  promptEmojiItem: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptEmojiItemActive: {
    backgroundColor: `${PREMIUM.coral}30`,
  },
  promptEmojiText: {
    fontSize: 18,
  },

  // Comments list
  answersListContainer: {
    flex: 1,
  },
  commentsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  commentsHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  expiredBannerText: { fontSize: 12, color: '#FF9800' },

  listContent: { paddingHorizontal: 12, paddingBottom: 100 },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: PREMIUM.textPrimary },
  emptySubtitle: { fontSize: 14, color: PREMIUM.textSecondary, textAlign: 'center' },

  emptyComments: {
    padding: 48,
    alignItems: 'center',
    gap: 12,
  },
  emptyCommentsText: { fontSize: 16, fontWeight: '600', color: PREMIUM.textSecondary },
  emptyCommentsSubtext: { fontSize: 13, color: PREMIUM.textMuted },

  // Premium Answer Card
  answerCardWrapper: {
    marginBottom: 10,
  },
  answerCard: {
    backgroundColor: PREMIUM.bgElevated,
    // Softer corner radius (14 → 16) reads as a more premium chat card.
    borderRadius: 16,
    paddingHorizontal: 14,
    // Trimmed from 14 → 12: with edit relocated and reactions inline, the
    // card no longer needs the wider top/bottom padding to counterbalance a
    // separate action band.
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    position: 'relative',
    // Subtle neutral lift — gives the card a clear plane above the screen
    // bg without feeling glossy. Android `elevation` kept low so the row
    // doesn't paint a heavy material shadow.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  answerCardOwn: {
    // Slightly stronger left accent + soft coral border so own cards feel
    // distinct without becoming bright.
    borderColor: `${PREMIUM.coral}55`,
    borderLeftWidth: 3,
    borderLeftColor: PREMIUM.coral,
  },
  answerCardSelected: {
    // Selected state lifts the surface a touch and warms the border —
    // distinct from highlighted (which is a pulse) and own (left bar).
    backgroundColor: PREMIUM.bgHighlight,
    borderColor: `${PREMIUM.coral}70`,
  },
  answerCardHighlighted: {
    borderColor: `${PREMIUM.coral}99`,
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  answerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    // Trimmed 10 → 8 — the body row sits closer to the header. The visible
    // edit pencil has been removed entirely; edit is reachable via long-press.
    marginBottom: 8,
  },
  // (Removed) Visible body-row edit pencil. Edit is now exposed only via
  // the long-press action sheet (Cancel | Edit | Delete). See the
  // `menuItemAccent` / `menuItemTextAccent` styles below.
  answerAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerAvatarAnon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  answerInfo: { flex: 1, marginLeft: 10 },
  // Single row that holds name + age + colored gender icon + optional You badge
  answerIdentityRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' },
  answerName: {
    fontSize: 14,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    flexShrink: 1,
    letterSpacing: 0.1,
  },
  answerAgeInline: {
    fontSize: 13,
    fontWeight: '500',
    color: PREMIUM.textSecondary,
    // Bumped 1 → 4 so name and age have actual breathing room.
    marginLeft: 4,
  },
  answerGenderIcon: { marginLeft: 4 },
  // Slightly softer "You" pill — coral wash + thin coral border so it reads
  // as an intentional badge rather than a flat fill. Height unchanged.
  youBadge: {
    backgroundColor: `${PREMIUM.coral}1F`,
    borderWidth: 1,
    borderColor: `${PREMIUM.coral}55`,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    marginLeft: 8,
  },
  youBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: PREMIUM.coral,
    letterSpacing: 0.4,
  },
  answerTime: { fontSize: 11, color: PREMIUM.textMuted, marginTop: 2 },

  // 3-dot menu button
  menuBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBtnText: {
    fontSize: 16,
    color: PREMIUM.textMuted,
    fontWeight: '700',
    marginTop: -2,
  },

  answerText: {
    fontSize: 15,
    color: PREMIUM.textPrimary,
    lineHeight: 22,
  },

  // Body row: text column on the left + optional 84×84 media tile on the
  // right. `alignItems: 'stretch'` so the text column fills the row's height
  // (driven by the tile when present); combined with `space-between` on the
  // text column, the reaction strip floats to the bottom and aligns with the
  // visual baseline of the tile when text is short.
  answerBodyRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 8,
    // Two-column layout (text col + 84-dp media tile). Gap kept at 8 so the
    // card stays tight on narrow ~360-dp devices.
    gap: 8,
  },
  // Drops the bottom margin entirely when there is no media tile and no
  // inline voice player — i.e. text-only answers. The reaction strip already
  // contributes its own marginTop, and there is no following block, so this
  // saves a final ~8 dp on the slimmest cards.
  answerBodyRowNoTile: {
    marginBottom: 0,
  },
  answerBodyTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between',
  },
  // Reaction strip relocated from the old bottom `actionRow` into the body
  // text column. Sits just below the response text; when text is short it is
  // pushed to the bottom of the column by `space-between` so it lines up
  // with the bottom edge of the 84×84 media tile.
  reactionStripInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },

  // Compact media tile (photo / video / voice / locked / viewed states).
  // Background color is now drawn by an absolutely-positioned LinearGradient
  // child for subtle depth; the `backgroundColor` on the tile itself acts as
  // the fallback before the gradient mounts. `borderRadius: 14` matches the
  // card's radius for a more cohesive look.
  todMediaTile: {
    width: 84,
    height: 84,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgElevated,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    overflow: 'hidden',
    // Soft neutral lift — keeps the tile feeling like a chip resting on the
    // card surface. iOS shadow values; Android `elevation` deliberately small
    // so it doesn't read heavy.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  todMediaTileLocked: {
    borderColor: PREMIUM.textMuted + '30',
    opacity: 0.85,
  },
  todMediaTileViewed: {
    borderColor: PREMIUM.textMuted + '30',
  },
  // Inner icon chip — visually contains the Ionicon so it doesn't look like a
  // bare default glyph. Coral wash + coral border for active media; muted grey
  // wash for locked/viewed states.
  todMediaTileIconChip: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: `${PREMIUM.coral}1A`,
    borderWidth: 1,
    borderColor: `${PREMIUM.coral}30`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todMediaTileIconChipMuted: {
    backgroundColor: `${PREMIUM.textMuted}22`,
    borderColor: `${PREMIUM.textMuted}40`,
  },
  todMediaTileCorner: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todMediaTileMicrotext: {
    fontSize: 10,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    marginTop: 6,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  todMediaTileMicrotextMuted: {
    color: PREMIUM.textMuted,
    fontWeight: '600',
  },
  // Voice tile playing-state polish — coral border ring and a slightly
  // brighter coral microtext so the tile clearly reads as "currently
  // playing" without changing its dimensions or layout.
  todMediaTileVoiceActive: {
    borderColor: PREMIUM.coral + '99',
  },
  todMediaTileMicrotextActive: {
    color: PREMIUM.coral,
  },
  // Voice playback progress bar — anchored to the tile bottom edge so it
  // reads as a "now playing" timeline without expanding the 84×84 tile
  // or competing with the centered icon chip + clock above it. Track is
  // a faint hairline; fill is coral and grows with `voicePosMs`.
  todMediaTileVoiceProgressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: PREMIUM.coral + '22',
    overflow: 'hidden',
  },
  todMediaTileVoiceProgressFill: {
    height: '100%',
    backgroundColor: PREMIUM.coral,
  },

  // Action row — now Connect-only and conditionally rendered (only when
  // prompt-owner is viewing someone else's eligible / pending / connected
  // answer). Emoji + edit have moved out, so this row's marginTop is reduced.
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  reactionSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  reactionBubblesInline: {
    flexDirection: 'row',
    gap: 4,
  },
  reactionBubbleSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: PREMIUM.bgHighlight,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 11,
    borderWidth: 1,
    // Hairline neutral border ties the chip to the rest of the card surface
    // instead of letting it look like a flat solid pill.
    borderColor: PREMIUM.borderSubtle,
  },
  reactionBubbleSmallActive: {
    backgroundColor: `${PREMIUM.coral}22`,
    borderWidth: 1,
    borderColor: PREMIUM.coral,
  },
  reactionEmojiSmall: { fontSize: 12 },
  reactionCountSmall: { fontSize: 10, color: PREMIUM.textSecondary, fontWeight: '700' },
  // Add-reaction trigger now reads as an intentional ghost chip, not a
  // free-floating icon. Same hit area as the old `padding: 4` plus a
  // hairline border + soft surface — disappears into the row when text is
  // long, but is still clearly tappable when the row is empty.
  addReactionInline: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: PREMIUM.bgHighlight,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyBtnInline: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: PREMIUM.bgHighlight,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // Connect button - compact pill style
  connectBtnCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${PREMIUM.coral}15`,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${PREMIUM.coral}30`,
  },
  connectBtnCompactText: {
    fontSize: 11,
    fontWeight: '600',
    color: PREMIUM.coral,
  },
  connectPlaceholder: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  connectPlaceholderText: {
    fontSize: 10,
    color: PREMIUM.textMuted,
    opacity: 0.6,
  },
  connectSentInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  connectSentInlineText: {
    fontSize: 10,
    color: PREMIUM.textMuted,
  },
  // Strong pending approval state - orange/yellow glow effect
  connectPendingInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FFF3E0',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F5A623',
  },
  connectPendingInlineText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#F5A623',
  },
  editBtnCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: `${PREMIUM.coral}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },

  reportedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: PREMIUM.bgHighlight,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  reportedText: { fontSize: 9, color: PREMIUM.textMuted },

  // Emoji picker — re-anchored. The old `bottom: 60` matched a trigger that
  // sat in the bottom action band; that trigger has moved into the body row.
  // We now hover the picker near the bottom-left of the answer card so it
  // stays close to the relocated emoji button regardless of whether the
  // (now-conditional) action row is rendered.
  emojiPickerOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    flexDirection: 'row',
    gap: 2,
    backgroundColor: PREMIUM.bgHighlight,
    borderRadius: 18,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 10,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  emojiPickerItem: { padding: 8, borderRadius: 10 },
  emojiPickerItemActive: { backgroundColor: `${PREMIUM.coral}30` },
  emojiPickerEmoji: { fontSize: 22 },

  hiddenIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    padding: 8,
    backgroundColor: PREMIUM.bgHighlight,
    borderRadius: 8,
  },
  hiddenText: { fontSize: 11, color: PREMIUM.textMuted },

  // Premium FAB
  commentFab: { position: 'absolute', right: 16, alignItems: 'center' },
  fabBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Premium Comment Menu Modal - Centered popup style
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContent: {
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 18,
    padding: 22,
    width: 296,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.34,
    shadowRadius: 18,
    elevation: 12,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  menuSubtitle: {
    fontSize: 13,
    color: PREMIUM.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
  },
  menuActions: {
    flexDirection: 'row',
    gap: 10,
  },
  menuItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: PREMIUM.bgHighlight,
  },
  menuItemDestructive: {
    backgroundColor: PREMIUM.coral,
    // Soft coral lift — gives the destructive button a tactile feel without
    // making it scream. iOS only; Android keeps elevation modest.
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 3,
  },
  // Premium accent variant for the long-press Edit action. Soft coral wash
  // with coral text + coral icon — distinct from the neutral grey of the
  // existing prompt-edit `menuItem` and clearly different from the destructive
  // solid-coral `menuItemDestructive` so users can tell Edit and Delete apart
  // at a glance even on small screens.
  menuItemAccent: {
    backgroundColor: `${PREMIUM.coral}1F`,
    borderWidth: 1,
    borderColor: `${PREMIUM.coral}55`,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  menuItemTextDestructive: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.2,
  },
  menuItemTextAccent: {
    fontSize: 14,
    fontWeight: '700',
    color: PREMIUM.coral,
    letterSpacing: 0.2,
  },
  menuCancelBtn: {
    flex: 1,
    backgroundColor: PREMIUM.bgHighlight,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  menuCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },

  // Media viewer modal
  mediaViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaViewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  mediaViewerImage: {
    width: '100%',
    height: '80%',
  },
  mediaViewerVideo: {
    width: '100%',
    height: '80%',
  },
  // T/D VIDEO FIX: Container for video + custom progress
  videoContainer: {
    width: '100%',
    height: '80%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  customVideoProgress: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    alignItems: 'center',
    gap: 8,
  },
  progressBarBg: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: PREMIUM.coral,
    borderRadius: 2,
  },
  progressTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
  unmirrorMedia: {
    transform: [{ scaleX: -1 }],
  },
  mediaViewerHint: {
    position: 'absolute',
    bottom: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  mediaViewerHintText: {
    fontSize: 13,
    color: '#FFF',
    fontWeight: '500',
  },

  // Report modal styles
  reportModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  reportModalContent: {
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  reportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reportModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
  },
  reportModalSubtitle: {
    fontSize: 14,
    color: PREMIUM.textSecondary,
    marginBottom: 16,
  },
  reportReasonList: {
    gap: 8,
  },
  reportReasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: PREMIUM.bgHighlight,
  },
  reportReasonItemSelected: {
    backgroundColor: `${PREMIUM.coral}20`,
    borderWidth: 1,
    borderColor: PREMIUM.coral,
  },
  reportReasonIcon: {
    fontSize: 18,
  },
  reportReasonLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: PREMIUM.textPrimary,
  },
  reportReasonLabelSelected: {
    color: PREMIUM.coral,
  },
  reportTextContainer: {
    marginTop: 16,
  },
  reportTextLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PREMIUM.textPrimary,
    marginBottom: 8,
  },
  reportTextInput: {
    backgroundColor: PREMIUM.bgHighlight,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: PREMIUM.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  reportSubmitButton: {
    marginTop: 20,
    backgroundColor: '#E74C3C',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  reportSubmitButtonDisabled: {
    backgroundColor: PREMIUM.bgHighlight,
  },
  reportSubmitButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },

  requestContextBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${PREMIUM.coral}14`,
    borderWidth: 1,
    borderColor: `${PREMIUM.coral}35`,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  requestContextBannerText: {
    color: PREMIUM.coral,
    fontSize: 13,
    fontWeight: '800',
  },

  // Pending Connect Bar - simple inline Accept/Reject (RECEIVER VISIBILITY)
  pendingConnectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${PREMIUM.coral}12`,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 10,
  },
  pendingConnectBarStacked: {
    marginTop: 0,
  },
  pendingConnectBarText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: PREMIUM.coral,
  },
  pendingConnectBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingConnectReject: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: PREMIUM.bgHighlight,
  },
  pendingConnectRejectText: {
    fontSize: 13,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  pendingConnectAcceptBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: PREMIUM.coral,
  },
  pendingConnectAcceptBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFF',
  },

  // FIX: Success sheet styles (matching chats.tsx)
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  successSheet: {
    backgroundColor: PREMIUM.bgElevated,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
  },
  successAvatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 12,
  },
  successAvatarContainer: {
    alignItems: 'center',
    width: 80,
  },
  successAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: PREMIUM.coral,
  },
  successAvatarPlaceholder: {
    backgroundColor: PREMIUM.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successAvatarInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
  },
  successAvatarName: {
    fontSize: 12,
    fontWeight: '600',
    color: PREMIUM.textPrimary,
    marginTop: 6,
    textAlign: 'center',
  },
  successHeartContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PREMIUM.coral + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 14,
    color: PREMIUM.textSecondary,
    textAlign: 'center',
    marginBottom: 28,
  },
  successActions: {
    width: '100%',
    gap: 12,
  },
  successPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: PREMIUM.coral,
    paddingVertical: 14,
    borderRadius: 12,
  },
  successPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  successSecondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  successSecondaryText: {
    fontSize: 15,
    fontWeight: '500',
    color: PREMIUM.textSecondary,
  },
});
