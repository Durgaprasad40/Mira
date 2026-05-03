import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, Animated, Pressable, BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
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
import { TodVoicePlayer } from '@/components/truthdare/TodVoicePlayer';
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
  // Secure media APIs (for future viewer implementation)
  const claimAnswerMediaView = useMutation(api.truthDare.claimAnswerMediaView);
  const finalizeAnswerMediaView = useMutation(api.truthDare.finalizeAnswerMediaView);
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

  // Prompt action popup state (for prompt long-press)
  const [showPromptActionPopup, setShowPromptActionPopup] = useState(false);
  const [isDeletingPrompt, setIsDeletingPrompt] = useState(false);

  // Inline prompt edit state
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editPromptText, setEditPromptText] = useState('');
  const [isSavingPromptEdit, setIsSavingPromptEdit] = useState(false);

  // Selected answer state - for tap-to-reveal Connect (prompt owner only)
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);

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
  const pendingMediaFinalizeRef = useRef<Set<string>>(new Set());
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
  const handleOpenMenu = useCallback((answerId: string, authorId: string, isOwn: boolean) => {
    setMenuAnswerId(answerId);
    setMenuAnswerOwnerId(authorId);
    setMenuIsOwnAnswer(isOwn);
  }, []);

  // Close 3-dot menu
  const handleCloseMenu = useCallback(() => {
    setMenuAnswerId(null);
    setMenuAnswerOwnerId(null);
    setMenuIsOwnAnswer(false);
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
          | 'reverse_pending'
          | undefined;

        if (isMountedRef.current) {
          setConnectSentFor((prev) => {
            const next = new Set(prev);
            next.add(answerId);
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
  }, [userId, promptId, sendConnectRequest, router]);

  // Handle tap-to-view for media content
  // P0-001 FIX: Backend is the source of truth for view state.
  // P0-17 FIX: Durable consumption happens on finalize after successful display.
  const handleViewMedia = useCallback(async (answer: typeof answers[0]) => {
    if (!answer.mediaUrl || (answer.type !== 'photo' && answer.type !== 'video')) return;

    const answerId = answer._id;
    const isOwner = answer.isOwnAnswer;

    // P0-001 FIX: Prevent double-tap while claim is in flight
    if (pendingMediaClaimsRef.current.has(answerId)) {
      debugTodLog('[T/D] Media claim already in progress, ignoring tap');
      return;
    }

    // Owner can always view their own media (no claim needed)
    if (isOwner) {
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
      // Backend returns a fresh URL without durably consuming the one-time view yet.
      const result = await claimAnswerMediaView({
        answerId,
        viewerId: userId,
      });

      // Handle backend responses
      // ONE-TIME VIEW: Block if already viewed
      if (result.status === 'already_viewed') {
        Alert.alert(
          'Already Viewed',
          `This one-time ${mediaLabel} has already been opened on your account.`
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
          hasViewed: false, // Will be marked true on close
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

  // Handle closing the media viewer
  const handleCloseMediaViewer = useCallback(async () => {
    const activeMedia = viewingMedia;
    if (isMountedRef.current) {
      setViewingMedia(null);
    }
    // T/D VIDEO FIX: Reset video progress state
    if (isMountedRef.current) {
      setVideoProgress({ position: 0, duration: 0, isPlaying: false });
    }

    if (!activeMedia || activeMedia.isOwnAnswer || activeMedia.hasViewed || !userId) {
      return;
    }

    if (pendingMediaFinalizeRef.current.has(activeMedia.answerId)) {
      return;
    }

    pendingMediaFinalizeRef.current.add(activeMedia.answerId);
    try {
      // Finalize the view for non-owners
      await finalizeAnswerMediaView({
        answerId: activeMedia.answerId,
        viewerId: userId,
      });
      debugTodLog('[T/D] Media view finalized');
    } catch (error) {
      console.error('[T/D] Finalize media view failed:', error);
      if (isRetryableTodError(error)) {
        Alert.alert(
          'View Unconfirmed',
          'We could not confirm the view was recorded. Refresh the thread before trying again.'
        );
      } else {
        Alert.alert(
          'View Not Recorded',
          'Your view may not have been recorded. The media may still be viewable.',
          [{ text: 'OK', style: 'default' }]
        );
      }
    } finally {
      pendingMediaFinalizeRef.current.delete(activeMedia.answerId);
    }
  }, [viewingMedia, userId, finalizeAnswerMediaView]);

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

  // Helper for gender icon
  const getCommentGenderIcon = (gender: string | undefined): string => {
    if (!gender) return '';
    const g = gender.toLowerCase();
    if (g === 'male' || g === 'm') return '♂';
    if (g === 'female' || g === 'f') return '♀';
    if (
      g === 'non_binary' ||
      g === 'non-binary' ||
      g === 'nonbinary' ||
      g === 'nb' ||
      g === 'other'
    ) {
      return '⚧';
    }
    return '';
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

    const genderIcon = getCommentGenderIcon(authorGender);

    // Build age + gender string
    const ageGenderStr = [
      authorAge ? `${authorAge}` : '',
      genderIcon,
    ].filter(Boolean).join(' · ');

    // CONNECT ELIGIBILITY RULE (Product Rule):
    // Show Connect for ALL answer types (anonymous, no-photo, full-view, photo, video, voice)
    // Only block for: own answer, existing pending request, already connected
    // NOTE: !isAnon was REMOVED - anonymous display doesn't block connection
    const isEligibleForConnect = isPromptOwner && !item.hasSentConnect && !connectSentFor.has(item._id) && !isOwnAnswer;
    const canConnect = isEligibleForConnect && isSelected;
    const hasSentConnect = isPromptOwner && (item.hasSentConnect || connectSentFor.has(item._id));

    return (
      <TouchableOpacity
        style={styles.answerCardWrapper}
        activeOpacity={0.8}
        onPress={() => isEligibleForConnect && handleToggleSelect(item._id)}
        onLongPress={() => handleOpenMenu(item._id, item.userId, isOwnAnswer)}
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
              <View style={styles.answerNameRow}>
                <Text style={styles.answerName}>
                  {isAnon ? 'Anonymous' : (authorName || 'User')}
                </Text>
                {isOwnAnswer && (
                  <View style={styles.youBadge}>
                    <Text style={styles.youBadgeText}>You</Text>
                  </View>
                )}
              </View>
              {/* Time + Age/Gender row */}
              <View style={styles.answerMetaRow}>
                <Text style={styles.answerTime}>{getTimeAgo(item.createdAt)}</Text>
                {!isAnon && ageGenderStr ? (
                  <>
                    <Text style={styles.answerMetaDot}>·</Text>
                    <Text style={styles.answerAgeGender}>{ageGenderStr}</Text>
                  </>
                ) : null}
              </View>
            </View>

          </View>

          {/* Content: ALWAYS show text first (if exists), then media below */}
          {item.text && item.text.trim().length > 0 && (
            <Text style={styles.answerText}>{item.text}</Text>
          )}

          {/* Voice media */}
          {item.type === 'voice' && item.mediaUrl && (
            <TodVoicePlayer
              answerId={item._id}
              audioUrl={item.mediaUrl}
              durationSec={item.durationSec || 0}
            />
          )}

          {/* P1-006: Private media indicator - shows when media exists but viewer not authorized */}
          {item.hasMedia && !item.mediaUrl && !item.isOwnAnswer && (
            <View style={styles.privateMediaIndicator}>
              <Ionicons name="lock-closed" size={14} color={PREMIUM.textMuted} />
              <Text style={styles.privateMediaText}>
                {item.type === 'voice' ? 'Voice message' : item.type === 'video' ? 'Video' : 'Photo'} for prompt creator only
              </Text>
            </View>
          )}

          {/* Photo/Video media - ONE-TIME PER USER VIEW */}
          {(item.type === 'photo' || item.type === 'video') && item.mediaUrl && (
            <TouchableOpacity
              style={styles.mediaContainer}
              onPress={() => handleViewMedia(item)}
              activeOpacity={0.7}
              disabled={item.hasViewedMedia && !isOwnAnswer}
            >
              <View style={[
                styles.mediaBadge,
                item.hasViewedMedia && !isOwnAnswer && styles.mediaBadgeViewed,
              ]}>
                <Ionicons
                  name={item.type === 'video' ? 'videocam' : 'image'}
                  size={18}
                  color={item.hasViewedMedia && !isOwnAnswer ? PREMIUM.textMuted : PREMIUM.coral}
                />
                <Text style={[
                  styles.mediaBadgeText,
                  item.hasViewedMedia && !isOwnAnswer && styles.mediaBadgeTextViewed,
                ]}>
                  {item.type === 'video' ? 'Video' : 'Photo'}
                </Text>
                {/* Visibility label: show who can see this media */}
                <View style={styles.visibilityLabel}>
                  <Ionicons
                    name={item.visibility === 'owner_only' ? 'lock-closed' : 'eye'}
                    size={10}
                    color={item.visibility === 'owner_only' ? PREMIUM.truthPurple : PREMIUM.textMuted}
                  />
                  <Text style={[
                    styles.visibilityLabelText,
                    item.visibility === 'owner_only' && { color: PREMIUM.truthPurple },
                  ]}>
                    {item.visibility === 'owner_only' ? 'Private' : 'Everyone'}
                  </Text>
                </View>
                <Text style={[
                  styles.mediaViewMode,
                  item.hasViewedMedia && !isOwnAnswer && { color: PREMIUM.textMuted },
                ]}>
                  {item.hasViewedMedia && !isOwnAnswer ? 'Viewed' : 'Tap to view once'}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Action row - emoji left, connect right - NO LAYOUT SHIFT */}
          <View style={styles.actionRow}>
            {/* Left: Reaction bubbles + add reaction */}
            <View style={styles.reactionSection}>
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
              {/* Add reaction button */}
              <TouchableOpacity
                style={styles.addReactionInline}
                onPress={() => setEmojiPickerAnswerId(showEmojiPicker ? null : item._id)}
              >
                <Ionicons
                  name={item.myReaction ? 'happy' : 'happy-outline'}
                  size={16}
                  color={item.myReaction ? PREMIUM.coral : PREMIUM.textMuted}
                />
              </TouchableOpacity>
              {/* Reply plus button - opens composer for new comment */}
              {canReplyInline && (
                <TouchableOpacity
                  style={styles.replyBtnInline}
                  onPress={openComposer}
                >
                  <Ionicons name="add-circle-outline" size={16} color={PREMIUM.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Right: Connect / Sent / Edit - fixed height area */}
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
              {hasSentConnect && item.connectStatus === 'pending' && (
                <View style={styles.connectPendingInline}>
                  <Ionicons name="hourglass-outline" size={12} color="#F5A623" />
                  <Text style={styles.connectPendingInlineText}>Waiting</Text>
                </View>
              )}
              {hasSentConnect && item.connectStatus === 'connected' && (
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

              {/* Own comment: Edit button - compact */}
              {isOwnAnswer && !isExpired && (
                <TouchableOpacity
                  style={styles.editBtnCompact}
                  onPress={openComposer}
                >
                  <Ionicons name="pencil" size={12} color={PREMIUM.coral} />
                </TouchableOpacity>
              )}
            </View>
          </View>

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

      {/* Premium Comment Menu Modal - Centered popup */}
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
              {menuIsOwnAnswer ? 'Delete Comment?' : 'Report Comment'}
            </Text>
            <Text style={styles.menuSubtitle}>
              {menuIsOwnAnswer
                ? 'This action cannot be undone.'
                : 'Help us keep the community safe.'}
            </Text>

            <View style={styles.menuActions}>
              <TouchableOpacity style={styles.menuCancelBtn} onPress={handleCloseMenu}>
                <Text style={styles.menuCancelText}>Cancel</Text>
              </TouchableOpacity>

              {menuIsOwnAnswer ? (
                <TouchableOpacity
                  style={[styles.menuItem, styles.menuItemDestructive]}
                  onPress={handleMenuDelete}
                >
                  <Ionicons name="trash-outline" size={16} color="#FFF" />
                  <Text style={styles.menuItemTextDestructive}>Delete</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.menuItem, styles.menuItemDestructive]}
                  onPress={handleMenuReport}
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
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    position: 'relative',
  },
  answerCardOwn: {
    borderColor: `${PREMIUM.coral}40`,
    borderLeftWidth: 3,
    borderLeftColor: PREMIUM.coral,
  },
  answerCardSelected: {
    backgroundColor: PREMIUM.bgHighlight,
    borderColor: `${PREMIUM.coral}50`,
  },
  answerCardHighlighted: {
    borderColor: `${PREMIUM.coral}85`,
    shadowColor: PREMIUM.coral,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 5,
  },
  answerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
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
  answerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  answerName: { fontSize: 13, fontWeight: '600', color: PREMIUM.textPrimary },
  youBadge: {
    backgroundColor: `${PREMIUM.coral}25`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  youBadgeText: { fontSize: 9, fontWeight: '700', color: PREMIUM.coral },
  answerMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  answerTime: { fontSize: 11, color: PREMIUM.textMuted },
  answerMetaDot: { fontSize: 11, color: PREMIUM.textMuted, marginHorizontal: 4 },
  answerAgeGender: { fontSize: 11, color: PREMIUM.textMuted },

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
    marginBottom: 10,
  },

  // Media
  mediaContainer: { marginBottom: 10 },
  mediaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: PREMIUM.bgHighlight,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
  },
  mediaBadgeText: { fontSize: 13, fontWeight: '600', color: PREMIUM.textPrimary },
  mediaViewMode: { fontSize: 11, color: PREMIUM.textSecondary, marginLeft: 'auto' },
  // T/D VISIBILITY LABEL: Shows who can view this media
  visibilityLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: PREMIUM.bgBase,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  visibilityLabelText: { fontSize: 9, fontWeight: '500', color: PREMIUM.textMuted },
  mediaBadgeViewed: {
    backgroundColor: PREMIUM.bgBase,
    borderColor: PREMIUM.textMuted + '30',
  },
  // P1-006: Private media indicator for viewers who can't access
  privateMediaIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PREMIUM.bgHighlight,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
    opacity: 0.7,
  },
  privateMediaText: {
    fontSize: 12,
    color: PREMIUM.textMuted,
    fontStyle: 'italic',
  },
  mediaBadgeTextViewed: {
    color: PREMIUM.textMuted,
  },

  // Action row - NO LAYOUT SHIFT - emoji left, connect right
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
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
    gap: 2,
    backgroundColor: PREMIUM.bgHighlight,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  reactionBubbleSmallActive: {
    backgroundColor: `${PREMIUM.coral}20`,
    borderWidth: 1,
    borderColor: PREMIUM.coral,
  },
  reactionEmojiSmall: { fontSize: 12 },
  reactionCountSmall: { fontSize: 10, color: PREMIUM.textSecondary, fontWeight: '600' },
  addReactionInline: {
    padding: 4,
  },
  replyBtnInline: {
    padding: 4,
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

  // Emoji picker
  emojiPickerOverlay: {
    position: 'absolute',
    bottom: 60,
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
    borderRadius: 16,
    padding: 20,
    width: 280,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PREMIUM.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  menuSubtitle: {
    fontSize: 13,
    color: PREMIUM.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  menuActions: {
    flexDirection: 'row',
    gap: 12,
  },
  menuItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: PREMIUM.bgHighlight,
  },
  menuItemDestructive: {
    backgroundColor: PREMIUM.coral,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: PREMIUM.textSecondary,
  },
  menuItemTextDestructive: {
    color: '#FFF',
  },
  menuCancelBtn: {
    flex: 1,
    backgroundColor: PREMIUM.bgHighlight,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
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
