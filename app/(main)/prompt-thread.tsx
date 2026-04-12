import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, Animated, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { UnifiedAnswerComposer, IdentityMode, Attachment } from '@/components/truthdare/UnifiedAnswerComposer';
import { TodVoicePlayer } from '@/components/truthdare/TodVoicePlayer';
import { uploadMediaToConvex } from '@/lib/uploadUtils';
import { getTimeAgo } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import type { TodReportReason } from '@/types';

const C = INCOGNITO_COLORS;

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

// Report reason options (P0-002: Added 'privacy' and 'scam' for prompt reports)
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

export default function PromptThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    promptId: string;
    autoOpenComposer?: 'new' | 'edit';
  }>();
  const { promptId, autoOpenComposer } = params;
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
  const threadData = useQuery(
    api.truthDare.getPromptThread,
    promptId && token ? { promptId, token } : 'skip'
  );

  // RECEIVER VISIBILITY: Fetch pending connect requests for this user
  // This allows non-prompt-owners (answer authors) to see incoming connect requests
  const pendingRequests = useQuery(
    api.truthDare.getPendingConnectRequests,
    token ? { token } : 'skip'
  );
  const respondToConnect = useMutation(api.truthDare.respondToConnect);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  // FIX: Success sheet state for post-accept celebration (matching chats.tsx behavior)
  const [successSheet, setSuccessSheet] = useState<{
    visible: boolean;
    conversationId: string;
    senderName: string;
    senderPhotoUrl: string;
    recipientName: string;
    recipientPhotoUrl: string;
  } | null>(null);

  // Filter pending requests for this specific prompt
  const pendingRequestsForPrompt = useMemo(() => {
    if (!pendingRequests || !promptId) return [];
    return pendingRequests.filter((r) => r.promptId === promptId);
  }, [pendingRequests, promptId]);

  // Debug log for pending requests
  useEffect(() => {
    if (__DEV__) {
      console.log('[T/D THREAD] Pending requests state:', {
        viewerUserId: userId?.slice(-8),
        promptId: promptId?.slice(-8),
        totalPendingRequests: pendingRequests?.length ?? 0,
        pendingForThisPrompt: pendingRequestsForPrompt.length,
        pendingIds: pendingRequestsForPrompt.map((r) => r._id?.slice(-8)),
      });
    }
  }, [userId, promptId, pendingRequests, pendingRequestsForPrompt]);

  // Mutations
  const createOrEditAnswer = useMutation(api.truthDare.createOrEditAnswer);
  const generateUploadUrl = useMutation(api.truthDare.generateUploadUrl);
  const setReaction = useMutation(api.truthDare.setAnswerReaction);
  const setPromptReaction = useMutation(api.truthDare.setPromptReaction);
  const reportAnswer = useMutation(api.truthDare.reportAnswer);
  const reportPromptMutation = useMutation(api.truthDare.reportPrompt); // P0-002: Report prompt
  const deleteAnswer = useMutation(api.truthDare.deleteMyAnswer);
  const deletePrompt = useMutation(api.truthDare.deleteMyPrompt); // Prompt owner delete
  // Secure media APIs (for future viewer implementation)
  const claimAnswerMediaView = useMutation(api.truthDare.claimAnswerMediaView);
  const finalizeAnswerMediaView = useMutation(api.truthDare.finalizeAnswerMediaView);
  // T&D Connect
  const sendConnectRequest = useMutation(api.truthDare.sendTodConnectRequest);

  const isLoading = threadData === undefined;
  const prompt = threadData?.prompt;
  const answers = threadData?.answers ?? [];
  const visibleAnswerCount = prompt?.visibleAnswerCount ?? prompt?.answerCount ?? answers.length;
  const isAnswerListTruncated = answers.length < visibleAnswerCount;

  // Force re-render when expiry time passes (so isExpired updates in real-time)
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!prompt?.expiresAt || threadData?.isExpired) return;
    const msUntilExpiry = prompt.expiresAt - Date.now();
    if (msUntilExpiry <= 0) return; // Already expired
    // Schedule re-render when expiry time is reached
    const timer = setTimeout(() => forceUpdate((n) => n + 1), msUntilExpiry + 100);
    return () => clearTimeout(timer);
  }, [prompt?.expiresAt, threadData?.isExpired]);

  // Compute expiration locally to catch real-time expiry (server flag is a snapshot)
  const isExpired = useMemo(() => {
    // If server already says expired, trust it
    if (threadData?.isExpired) return true;
    // Otherwise check locally against expiresAt
    if (!prompt?.expiresAt) return false;
    return Date.now() >= prompt.expiresAt;
  }, [threadData?.isExpired, prompt?.expiresAt]);

  // Find user's own answer
  const myAnswer = useMemo(() => {
    return answers.find((a) => a.isOwnAnswer);
  }, [answers]);

  // Composer state - unified composer for text + optional media
  const [showUnifiedComposer, setShowUnifiedComposer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // P0-005 FIX: Track pending answer submission to ensure data arrives before UI transitions
  // When set, we're waiting for the answer to appear in threadData before closing composer
  const [pendingAnswerSubmission, setPendingAnswerSubmission] = useState<{
    submittedAt: number;
    isEdit: boolean;
  } | null>(null);

  // Close composer if prompt expires while it's open
  useEffect(() => {
    if (isExpired && showUnifiedComposer) {
      setShowUnifiedComposer(false);
    }
  }, [isExpired, showUnifiedComposer]);

  // P0-005 FIX: Watch for answer data to arrive after submission
  // This ensures we only close composer and scroll when data is actually present
  useEffect(() => {
    if (!pendingAnswerSubmission) return;

    // Check if our answer is now in the data
    const hasMyAnswer = answers.some((a) => a.isOwnAnswer);
    const isRecentEnough = (myAnswer?.createdAt ?? 0) >= pendingAnswerSubmission.submittedAt - 5000 ||
                           (myAnswer?.editedAt ?? 0) >= pendingAnswerSubmission.submittedAt - 5000;

    if (hasMyAnswer && (pendingAnswerSubmission.isEdit || isRecentEnough)) {
      // Data has arrived - safe to close composer, reset loading, and scroll
      setPendingAnswerSubmission(null);
      setIsSubmitting(false);
      setShowUnifiedComposer(false);
      // Scroll to end now that data is confirmed present
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current && listRef.current) {
          listRef.current.scrollToEnd({ animated: true });
        }
        scrollTimeoutRef.current = null;
      }, 100); // Small delay for render to complete
    }
  }, [pendingAnswerSubmission, answers, myAnswer]);

  // P0-005 FIX: Safety timeout - if data doesn't arrive within 5 seconds, close composer anyway
  // This prevents UI from getting stuck if there's a network issue
  useEffect(() => {
    if (!pendingAnswerSubmission) return;

    const safetyTimeout = setTimeout(() => {
      if (isMountedRef.current && pendingAnswerSubmission) {
        console.warn('[T/D] P0-005 safety timeout: closing composer after 5s');
        setPendingAnswerSubmission(null);
        setIsSubmitting(false);
        setShowUnifiedComposer(false);
        scrollToEnd();
      }
    }, 5000);

    return () => clearTimeout(safetyTimeout);
  }, [pendingAnswerSubmission]);

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

  // Selected answer state - for tap-to-reveal Connect (prompt owner only)
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);

  // Check if current user is the prompt owner
  // CONNECT FIX: Use backend-computed flag (resolves ID format mismatch)
  const isPromptOwner = threadData?.isViewerPromptOwner ?? false;

  // CONNECT DEBUG: Log thread ownership state
  useEffect(() => {
    if (__DEV__ && threadData) {
      console.log('[T/D Connect] Thread state:', {
        promptId: promptId?.slice(-8),
        viewerUserId: userId?.slice(-8),
        promptOwnerUserId: prompt?.ownerUserId?.slice(-8),
        isViewerPromptOwner: threadData?.isViewerPromptOwner,
        isPromptOwner,
        answerCount: visibleAnswerCount,
      });
    }
  }, [promptId, userId, prompt?.ownerUserId, threadData?.isViewerPromptOwner, isPromptOwner, visibleAnswerCount]);

  const listRef = useRef<FlatList>(null);

  // M-003 FIX: Track scroll timeout for cleanup
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Auto-open composer if requested from feed
  useEffect(() => {
    if (autoOpenComposer === 'new' && !myAnswer) {
      setShowUnifiedComposer(true);
    } else if (autoOpenComposer === 'edit' && myAnswer) {
      setShowUnifiedComposer(true);
    }
  }, [autoOpenComposer, myAnswer]);

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

  // Handle emoji reaction
  const handleReact = useCallback(async (answerId: string, emoji: string) => {
    if (!userId) {
      console.log('[T/D REACTION] skip - no userId');
      return;
    }

    // Prevent double-tap race condition
    if (pendingReactionsRef.current.has(answerId)) {
      console.log('[T/D REACTION] skip - already pending');
      return;
    }
    pendingReactionsRef.current.add(answerId);

    setEmojiPickerAnswerId(null);

    // Find the answer using ref to get latest data (avoids stale closure)
    const answer = answersRef.current.find((a) => a._id === answerId);
    const answerIdPrefix = answerId.substring(0, 8);

    console.log('[T/D REACTION] tap', {
      answerIdPrefix,
      emoji: emoji || '(remove)',
      currentCount: answer?.totalReactionCount ?? 0,
      isOwnAnswer: answer?.isOwnAnswer ?? false,
      hasAuth: !!userId,
    });

    try {
      if (!token) return;
      const result = await setReaction({ answerId, token, emoji });
      // Handle server returning ok: false (no throw, graceful fail)
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        console.warn('[T/D REACTION] failed', { reason: (result as any).reason });
      } else {
        console.log('[T/D REACTION] success', { action: (result as any)?.action });
      }
    } catch (error: any) {
      // Graceful handling - don't crash UI
      console.warn('[T/D REACTION] error', { message: error?.message?.substring(0, 50) });
      if (error.message?.includes('Rate limit')) {
        Alert.alert('Slow down', 'Please wait a moment before reacting again.');
      }
    } finally {
      pendingReactionsRef.current.delete(answerId);
    }
  }, [token, setReaction]);

  // Handle prompt emoji reaction
  const handlePromptReact = useCallback(async (emoji: string) => {
    if (!token || !promptId) {
      console.log('[T/D PROMPT REACTION] skip - no userId or promptId');
      return;
    }

    setShowPromptEmojiPicker(false);

    console.log('[T/D PROMPT REACTION] tap', {
      promptIdPrefix: promptId.substring(0, 8),
      emoji: emoji || '(remove)',
      hasAuth: !!userId,
    });

    try {
      const result = await setPromptReaction({ promptId, token, emoji });
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        console.warn('[T/D PROMPT REACTION] failed', { reason: (result as any).reason });
      } else {
        console.log('[T/D PROMPT REACTION] success', { action: (result as any)?.action });
      }
    } catch (error: any) {
      console.warn('[T/D PROMPT REACTION] error', { message: error?.message?.substring(0, 50) });
      if (error.message?.includes('Rate limit')) {
        Alert.alert('Slow down', 'Please wait a moment before reacting again.');
      }
    }
  }, [token, promptId, setPromptReaction]);

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

    setIsSubmittingReport(true);
    try {
      if (isReportingPrompt && promptId && token) {
        // P0-002: Report the prompt
        const result = await reportPromptMutation({
          promptId,
          token,
          reasonCode: selectedReportReason,
          reasonText: reportReasonText.trim() || undefined,
        });
        setReportModalVisible(false);
        if (result.isNowHidden) {
          Alert.alert('Reported', 'This prompt has been hidden due to multiple reports.');
          router.back();
        } else {
          Alert.alert('Reported', 'Thank you for your report. We will review it.');
        }
      } else if (reportingAnswerId && token) {
        // Report the answer
        const result = await reportAnswer({
          answerId: reportingAnswerId,
          token,
          reasonCode: selectedReportReason,
          reasonText: reportReasonText.trim() || undefined,
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
  }, [token, promptId, reportingAnswerId, isReportingPrompt, selectedReportReason, reportReasonText, reportAnswer, reportPromptMutation, router]);

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
  // P0-006 FIX: Use finally block to always clear loading state
  const handleDeletePrompt = useCallback(async () => {
    if (!token || !promptId || !isPromptOwner) return;
    if (isDeletingPrompt) return; // Prevent double-tap

    setIsDeletingPrompt(true);
    try {
      await deletePrompt({ promptId, token });
      setShowPromptActionPopup(false);
      router.back(); // Navigate back after successful delete
    } catch (error: any) {
      Alert.alert('Error', 'Failed to delete prompt. Please try again.');
    } finally {
      setIsDeletingPrompt(false);
    }
  }, [token, promptId, isPromptOwner, isDeletingPrompt, deletePrompt, router]);

  // Handle delete own comment
  const handleDeleteAnswer = useCallback(async (answerId: string) => {
    if (!token) return;

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
              await deleteAnswer({ answerId, token });
            } catch (error) {
              Alert.alert('Error', 'Failed to delete comment. Please try again.');
            }
          },
        },
      ]
    );
  }, [token, deleteAnswer]);

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
  // FIX: Show success sheet instead of navigating directly to chat
  const handleAcceptConnect = useCallback(async (requestId: string) => {
    if (!token) return;
    setRespondingTo(requestId);
    try {
      const result = await respondToConnect({
        requestId: requestId as any,
        action: 'connect',
        token,
      });
      if (__DEV__) {
        console.log('[T/D ACCEPT RESULT]', {
          success: result.success,
          conversationId: result.conversationId?.slice(-8),
          action: result.action,
          senderName: result.senderName,
        });
      }
      if (result.success && result.conversationId) {
        // FIX: Show success sheet instead of navigating directly
        console.log('[T/D ACCEPT] Showing success sheet instead of direct navigation');
        setSuccessSheet({
          visible: true,
          conversationId: result.conversationId,
          senderName: result.senderName || 'Someone',
          senderPhotoUrl: result.senderPhotoUrl || '',
          recipientName: result.recipientName || 'You',
          recipientPhotoUrl: result.recipientPhotoUrl || '',
        });
      } else {
        Alert.alert('Error', result.reason || 'Failed to accept request');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to accept connect request');
    } finally {
      setRespondingTo(null);
    }
  }, [token, respondToConnect]);

  // RECEIVER: Handle reject T&D connect request
  const handleRejectConnect = useCallback(async (requestId: string) => {
    if (!token) return;
    setRespondingTo(requestId);
    try {
      const result = await respondToConnect({
        requestId: requestId as any,
        action: 'remove',
        token,
      });
      if (__DEV__) {
        console.log('[T/D THREAD] Reject result:', result);
      }
      if (!result.success) {
        Alert.alert('Error', result.reason || 'Failed to decline request');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to decline connect request');
    } finally {
      setRespondingTo(null);
    }
  }, [token, respondToConnect]);

  // Handle send T&D connect request (prompt owner → answer author)
  // P0-007 FIX: Add double-tap guard + backend is authoritative for dedup
  const handleSendConnect = useCallback(async (answerId: string) => {
    if (!token || !promptId) return;
    if (connectSending) return; // P0-007: Prevent double-tap while request in flight

    setConnectSending(answerId);
    try {
      const result = await sendConnectRequest({
        promptId,
        answerId,
        token,
      });

      if (result.success) {
        setConnectSentFor((prev) => new Set(prev).add(answerId));
        setSelectedAnswerId(null); // Clear selection after successful send
        Alert.alert('Connect Sent', 'Your connect request has been sent!');
      } else {
        // Backend already deduplicates - show user-friendly message
        Alert.alert('Cannot Connect', result.reason || 'Failed to send connect request.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to send connect request. Please try again.');
    } finally {
      setConnectSending(null);
    }
  }, [token, promptId, connectSending, sendConnectRequest]);

  // Handle tap-to-view for media content
  // P0-001 FIX: Backend is the source of truth for view state.
  // P0-002 FIX: View is recorded atomically at claim time (backend already does this).
  const handleViewMedia = useCallback(async (answer: typeof answers[0]) => {
    if (!answer.mediaUrl || (answer.type !== 'photo' && answer.type !== 'video')) return;

    const answerId = answer._id;
    const isOwner = answer.isOwnAnswer;

    // P0-001 FIX: Prevent double-tap while claim is in flight
    if (pendingMediaClaimsRef.current.has(answerId)) {
      console.log('[T/D] Media claim already in progress, ignoring tap');
      return;
    }

    // Owner can always view their own media (no claim needed)
    if (isOwner) {
      setViewingMedia({
        answerId,
        mediaUrl: answer.mediaUrl,
        mediaType: answer.type as 'photo' | 'video',
        isOwnAnswer: true,
        isFrontCamera: answer.isFrontCamera,
      });
      return;
    }

    // P0-001 FIX: For non-owners, ALWAYS call backend claim - it is the source of truth.
    // Do NOT rely on stale hasViewedMedia from query snapshot.
    // The backend will return the appropriate status.

    // Guard: ensure user is authenticated before claiming
    if (!token) {
      Alert.alert('Sign In Required', 'Please sign in to view media.');
      return;
    }

    pendingMediaClaimsRef.current.add(answerId);

    try {
      // Backend claim is atomic and records the view at this moment (P0-002 FIX)
      const result = await claimAnswerMediaView({
        answerId,
        token,
      });

      // Handle backend responses
      // ONE-TIME VIEW: Block if already viewed
      if (result.status === 'already_viewed') {
        Alert.alert('Already Viewed', 'You can only view this media once.');
        return;
      }

      if (result.status === 'not_authorized') {
        Alert.alert('Not Available', 'This media is only visible to the prompt owner.');
        return;
      }

      if (result.status === 'no_media') {
        Alert.alert('Media Unavailable', 'This media is no longer available.');
        return;
      }

      if (result.status !== 'ok' || !result.url) {
        Alert.alert('Error', 'Failed to load media. Please try again.');
        return;
      }

      // Use the fresh URL from backend
      setViewingMedia({
        answerId,
        mediaUrl: result.url,
        mediaType: result.mediaType,
        isOwnAnswer: false,
        hasViewed: false, // Will be marked true on close
        isFrontCamera: result.isFrontCamera,
      });
    } catch (error: any) {
      console.error('[T/D] Claim media view failed:', error);
      if (error.message?.includes('Rate limit')) {
        Alert.alert('Please Wait', 'Too many requests. Try again in a moment.');
      } else {
        Alert.alert('Error', 'Failed to view media. Please try again.');
      }
    } finally {
      // P0-001 FIX: Always clear the pending flag
      pendingMediaClaimsRef.current.delete(answerId);
    }
  }, [token, claimAnswerMediaView]);

  // Handle closing the media viewer
  const handleCloseMediaViewer = useCallback(async () => {
    if (viewingMedia && !viewingMedia.isOwnAnswer && !viewingMedia.hasViewed && token) {
      // Finalize the view for non-owners
      try {
        await finalizeAnswerMediaView({
          answerId: viewingMedia.answerId,
          token,
        });
        console.log('[T/D] Media view finalized');
      } catch (error) {
        console.error('[T/D] Finalize media view failed:', error);
        // M-002 FIX: Add non-disruptive user feedback on failure
        // This informs the user but doesn't block the flow
        Alert.alert(
          'View Not Recorded',
          'Your view may not have been recorded. The media may still be viewable.',
          [{ text: 'OK', style: 'default' }]
        );
      }
    }
    setViewingMedia(null);
    // T/D VIDEO FIX: Reset video progress state
    setVideoProgress({ position: 0, duration: 0, isPlaying: false });
  }, [viewingMedia, token, finalizeAnswerMediaView]);

  // Unified submit handler - handles text + optional media attachment
  // Uses MERGE behavior: only sends fields that changed
  const handleUnifiedSubmit = useCallback(async (params: {
    text: string;
    attachment: Attachment | null;
    removeMedia?: boolean;
    identityMode: IdentityMode;
    mediaVisibility?: 'private' | 'public';
  }) => {
    if (!promptId || !token) return;

    setIsSubmitting(true);

    try {
      const { text, attachment, removeMedia, identityMode, mediaVisibility } = params;

      console.log('[T/D BEHAVIOR] submit_pipeline_start', {
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

      if (attachment) {
        // Check if this is a remote URL (already uploaded media from existing answer)
        // Remote URLs start with http:// or https:// and should NOT be re-uploaded
        const isRemoteUrl = attachment.uri.startsWith('http://') || attachment.uri.startsWith('https://');

        if (isRemoteUrl) {
          // Media is already in storage - don't upload, don't change mediaStorageId
          console.log('[T/D UPLOAD] skip - remote URL (existing media)');
        } else {
          // Local file - upload to Convex storage
          isFrontCamera = attachment.isFrontCamera;
          mediaMime = attachment.mime;

          const mediaType = attachment.kind === 'audio' ? 'audio' : attachment.kind;
          console.log('[T/D UPLOAD] start', { type: mediaType, isFrontCamera });

          try {
            mediaStorageId = await uploadMediaToConvex(
              attachment.uri,
              () => generateUploadUrl({ token }),
              mediaType
            );
            const storageIdPrefix = mediaStorageId?.substring(0, 8) ?? 'none';
            console.log('[T/D UPLOAD] success', { storageIdPrefix });
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
      const shouldAttachProfilePhoto =
        !isAnon &&
        !isNoPhoto &&
        typeof authorPhotoUrl === 'string' &&
        authorPhotoUrl.length > 0;

      if (shouldAttachProfilePhoto && authorPhotoUrl && !(authorPhotoUrl.startsWith('http://') || authorPhotoUrl.startsWith('https://'))) {
        authorPhotoStorageId = await uploadMediaToConvex(
          authorPhotoUrl,
          () => generateUploadUrl({ token }),
          'photo'
        );
      }

      // Create or edit the answer with MERGE behavior
      // Only send fields that are explicitly provided
      console.log('[T/D BEHAVIOR] createOrEditAnswer start', { identityMode, visibility: mediaVisibility === 'private' ? 'owner_only' : 'public' });
      await createOrEditAnswer({
        promptId,
        token,
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
        authorPhotoUrl:
          isAnon || isNoPhoto
            ? undefined
            : (authorPhotoUrl?.startsWith('http://') || authorPhotoUrl?.startsWith('https://'))
              ? authorPhotoUrl
              : undefined,
        authorPhotoStorageId: isAnon || isNoPhoto ? undefined : (authorPhotoStorageId as any),
        authorAge: isAnon ? undefined : authorProfile.age,
        authorGender: isAnon ? undefined : authorProfile.gender,
        photoBlurMode: photoBlurMode as 'none' | 'blur',
        isFrontCamera,
      });

      console.log('[T/D BEHAVIOR] createOrEditAnswer success');

      // P0-005 FIX: Instead of immediately closing composer and scrolling,
      // set pending state and let useEffect handle it when data arrives.
      // This ensures thread is updated before UI transitions.
      const isEdit = !!myAnswer;
      setPendingAnswerSubmission({
        submittedAt: Date.now(),
        isEdit,
      });

      // Keep isSubmitting true until data arrives (handled in finally after brief delay)
    } catch (error: any) {
      console.error('[T/D BEHAVIOR] submit_pipeline_failed', { error: error?.message?.substring(0, 50) });
      Alert.alert('Error', error.message || 'Failed to post comment. Please try again.');
      setIsSubmitting(false); // Only reset on error
    }
    // P0-005 FIX: Don't reset isSubmitting in finally - let the useEffect handle it
    // when data arrives, providing continuous loading feedback
  }, [promptId, token, generateUploadUrl, createOrEditAnswer, authorProfile, myAnswer]);

  // Helper for gender icon
  const getCommentGenderIcon = (gender: string | undefined): string => {
    if (!gender) return '';
    const g = gender.toLowerCase();
    if (g === 'male' || g === 'm') return '♂';
    if (g === 'female' || g === 'f') return '♀';
    return '⚧';
  };

  // P2-003 FIX: Wrap renderAnswer in useCallback to prevent recreation on every render
  // Render answer card - Premium elevated design with tap-to-reveal
  const renderAnswer = useCallback(({ item }: { item: typeof answers[0] }) => {
    const isOwnAnswer = item.isOwnAnswer;
    const hasReported = item.hasReported;
    const showEmojiPicker = emojiPickerAnswerId === item._id;
    const isSelected = selectedAnswerId === item._id;

    // Get top 3 emojis for display (reactionCounts is array of { emoji, count })
    const topEmojis = (item.reactionCounts ?? [])
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Author identity display logic
    const isAnon = item.isAnonymous !== false; // default to anonymous if undefined

    // Backward compatibility: if NOT anonymous but missing author fields,
    // use current user profile if this is our own comment
    let authorName = item.authorName;
    let authorPhotoUrl = item.authorPhotoUrl;
    let authorAge = item.authorAge;
    let authorGender = item.authorGender;
    const photoBlurMode = item.photoBlurMode;

    // Fallback for old comments without author snapshot
    if (!isAnon && isOwnAnswer && !authorName) {
      authorName = authorProfile.name;
      authorPhotoUrl = authorProfile.photoUrl;
      authorAge = authorProfile.age;
      authorGender = authorProfile.gender;
    }

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

    // CONNECT DEBUG: Log eligibility for each answer
    if (__DEV__) {
      console.log(`[T/D Connect] Answer ${item._id.slice(-6)}:`, {
        answerType: item.type,
        isAnon,
        identityMode: item.identityMode,
        isPromptOwner,
        isOwnAnswer,
        hasSentConnectBackend: item.hasSentConnect,
        hasSentConnectLocal: connectSentFor.has(item._id),
        isEligibleForConnect,
        isSelected,
        canConnect,
        // Product rule: Connect shown for ALL types except self/pending/connected
        hideReason: isOwnAnswer ? 'own_answer' : item.hasSentConnect ? 'already_sent' : connectSentFor.has(item._id) ? 'local_sent' : !isPromptOwner ? 'not_owner' : null,
      });
    }

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
        ]}>
          {/* Header with 3-dot menu */}
          <View style={styles.answerHeader}>
            {/* Avatar: Anonymous icon OR photo (clear/blurred based on mode) OR placeholder */}
            {isAnon ? (
              <View style={styles.answerAvatarAnon}>
                <Ionicons name="eye-off" size={14} color={PREMIUM.textMuted} />
              </View>
            ) : authorPhotoUrl ? (
              <Image
                source={{ uri: authorPhotoUrl }}
                style={styles.answerAvatar}
                blurRadius={photoBlurMode === 'blur' ? 20 : 0}
              />
            ) : (
              <View style={styles.answerAvatarPlaceholder}>
                <Ionicons name="person" size={14} color={PREMIUM.textMuted} />
              </View>
            )}
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
                  {item.hasViewedMedia && !isOwnAnswer ? 'Viewed' : 'Tap to view (1 time)'}
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
              {!isExpired && !myAnswer && !isPromptOwner && (
                <TouchableOpacity
                  style={styles.replyBtnInline}
                  onPress={() => setShowUnifiedComposer(true)}
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
                  onPress={() => setShowUnifiedComposer(true)}
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
    // P2-003: Dependencies for stable renderAnswer callback
    emojiPickerAnswerId,
    selectedAnswerId,
    authorProfile,
    isPromptOwner,
    connectSentFor,
    handleToggleSelect,
    handleOpenMenu,
    handleViewMedia,
    handleReact,
    handleSendConnect,
    connectSending,
    isExpired,
    myAnswer,
    setShowUnifiedComposer,
    setEmojiPickerAnswerId,
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
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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
    return 'male-female';
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
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
        {/* Owner Identity Row */}
        <View style={styles.ownerIdentityRow}>
          {/* Left: Photo or Anonymous icon */}
          {ownerIsAnonymous ? (
            <View style={styles.ownerAvatarAnon}>
              <Ionicons name="eye-off" size={16} color={PREMIUM.textMuted} />
            </View>
          ) : ownerPhotoUrl ? (
            <Image source={{ uri: ownerPhotoUrl }} style={styles.ownerAvatar} />
          ) : (
            <View style={styles.ownerAvatarPlaceholder}>
              <Ionicons name="person" size={16} color={PREMIUM.textMuted} />
            </View>
          )}

          {/* Owner info: name/anonymous + age + gender (premium styling) */}
          <View style={styles.ownerInfo}>
            <Text style={styles.ownerNamePremium} numberOfLines={1}>
              {ownerIsAnonymous ? 'Anonymous' : (ownerName || 'User')}
            </Text>
            {!ownerIsAnonymous && (ownerAge || ownerGender) && (
              <View style={styles.ownerMeta}>
                {ownerAge && (
                  <Text style={styles.ownerAge}>{ownerAge}</Text>
                )}
                {ownerGender && genderIcon && (
                  <>
                    <View style={[styles.genderDot, { backgroundColor: genderColor }]} />
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

        {/* Hero Prompt Text */}
        <Text style={styles.promptText}>{prompt.text}</Text>

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
        style={styles.answersListContainer}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* RECEIVER VISIBILITY: Simple inline Accept/Reject bar */}
            {pendingRequestsForPrompt.length > 0 && (
              <View style={styles.pendingConnectBar}>
                <Ionicons name="heart" size={16} color={PREMIUM.coral} />
                <Text style={styles.pendingConnectBarText}>
                  Connect request from prompt owner
                </Text>
                <View style={styles.pendingConnectBarActions}>
                  <TouchableOpacity
                    style={styles.pendingConnectReject}
                    onPress={() => handleRejectConnect(pendingRequestsForPrompt[0]._id)}
                    disabled={!!respondingTo}
                  >
                    {respondingTo === pendingRequestsForPrompt[0]._id ? (
                      <ActivityIndicator size="small" color={PREMIUM.textMuted} />
                    ) : (
                      <Text style={styles.pendingConnectRejectText}>Decline</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.pendingConnectAcceptBtn}
                    onPress={() => handleAcceptConnect(pendingRequestsForPrompt[0]._id)}
                    disabled={!!respondingTo}
                  >
                    {respondingTo === pendingRequestsForPrompt[0]._id ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.pendingConnectAcceptBtnText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <View style={styles.commentsHeader}>
              <Text style={styles.commentsHeaderText}>
                {visibleAnswerCount === 0
                  ? 'Be the first to respond'
                  : isAnswerListTruncated
                    ? `Showing ${answers.length} of ${visibleAnswerCount} responses`
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
                  {/* Edit button - navigate to create screen with edit params */}
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      handleClosePromptActionPopup();
                      router.push({
                        pathname: '/(main)/incognito-create-tod',
                        params: {
                          editPromptId: prompt._id as string,
                          editType: prompt.type,
                          editText: prompt.text,
                        },
                      } as any);
                    }}
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
                  {successSheet.senderPhotoUrl ? (
                    <Image
                      source={{ uri: successSheet.senderPhotoUrl }}
                      style={styles.successAvatar}
                      blurRadius={8}
                    />
                  ) : (
                    <View style={[styles.successAvatar, styles.successAvatarPlaceholder]}>
                      <Text style={styles.successAvatarInitial}>
                        {successSheet.senderName?.[0] || '?'}
                      </Text>
                    </View>
                  )}
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
                  {successSheet.recipientPhotoUrl ? (
                    <Image
                      source={{ uri: successSheet.recipientPhotoUrl }}
                      style={styles.successAvatar}
                      blurRadius={8}
                    />
                  ) : (
                    <View style={[styles.successAvatar, styles.successAvatarPlaceholder]}>
                      <Text style={styles.successAvatarInitial}>
                        {successSheet.recipientName?.[0] || '?'}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.successAvatarName} numberOfLines={1}>
                    {successSheet.recipientName}
                  </Text>
                </View>
              </View>

              {/* Title */}
              <Text style={styles.successTitle}>You're Connected! 🎉</Text>
              <Text style={styles.successSubtitle}>
                You and {successSheet.senderName} can now chat
              </Text>

              {/* Actions */}
              <View style={styles.successActions}>
                <TouchableOpacity
                  style={styles.successPrimaryBtn}
                  onPress={() => {
                    const convoId = successSheet.conversationId;
                    setSuccessSheet(null);
                    router.push(`/(main)/incognito-chat?id=${convoId}` as any);
                  }}
                >
                  <Ionicons name="chatbubble" size={18} color="#FFF" />
                  <Text style={styles.successPrimaryText}>Say Hi</Text>
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
