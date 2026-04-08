/**
 * LOCKED (PHASE-1 CHAT SCREEN INNER)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - P0 audit passed: backend connectivity verified, demo mode disabled
 * - All messages via Convex messages backend
 * - Delivery/read ticks from backend truth
 * - Voice messages use storage URLs (not local paths)
 *
 * Used by both:
 *   - app/(main)/chat/[id].tsx            (standalone stack screen)
 *   - app/(main)/(tabs)/messages/chat/[conversationId].tsx  (inside Messages tab)
 *
 * Accepts conversationId as a prop so the route file handles param extraction.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
  InteractionManager,
  Image,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useConvex, useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { MessageBubble, MessageInput, ProtectedMediaViewer, ReportModal, BottleSpinGame, TruthDareInviteCard } from '@/components/chat';
import { Phase2ProtectedMediaViewer } from '@/components/private/Phase2ProtectedMediaViewer';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import type { IncognitoMessage } from '@/types';
import { CameraPhotoSheet, CameraPhotoOptions } from '@/components/chat/CameraPhotoSheet';
import { ReportBlockModal } from '@/components/security/ReportBlockModal';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoDmStore, DemoDmMessage } from '@/stores/demoDmStore';
import { DEMO_PROFILES } from '@/lib/demoData';
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble';
import { useDemoStore } from '@/stores/demoStore';
import { useBlockStore } from '@/stores/blockStore';
import { useDemoNotifStore } from '@/hooks/useNotifications';
// Toast import removed — using Alert.alert for guaranteed error visibility
import { logDebugEvent } from '@/lib/debugEventLogger';
import { popHandoff } from '@/lib/memoryHandoff';
import { useIsFocused } from '@react-navigation/native';
import { formatDayLabel, shouldShowDayDivider, shouldShowTimestamp } from '@/utils/chatTime';
import {
  isUserBlocked,
  isExpiredConfessionThread,
  getOtherUserIdFromMeta,
} from '@/lib/threadsIntegrity';
import { preloadVideos } from '@/lib/videoCache';

// ═══════════════════════════════════════════════════════════════════════════
// SKELETON LOADING - Chat loading placeholder
// ═══════════════════════════════════════════════════════════════════════════
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SkeletonBubble = ({ isOwn, width }: { isOwn: boolean; width: number }) => {
  const pulseAnim = React.useRef(new Animated.Value(0.4)).current;

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        skeletonStyles.bubble,
        isOwn ? skeletonStyles.ownBubble : skeletonStyles.otherBubble,
        { width, opacity: pulseAnim },
      ]}
    />
  );
};

const ChatLoadingSkeleton = () => (
  <View style={skeletonStyles.container}>
    <SkeletonBubble isOwn={false} width={SCREEN_WIDTH * 0.55} />
    <SkeletonBubble isOwn={true} width={SCREEN_WIDTH * 0.45} />
    <SkeletonBubble isOwn={false} width={SCREEN_WIDTH * 0.65} />
    <SkeletonBubble isOwn={true} width={SCREEN_WIDTH * 0.5} />
    <SkeletonBubble isOwn={false} width={SCREEN_WIDTH * 0.4} />
  </View>
);

const MESSAGE_PAGE_SIZE = 40;
const PRESENCE_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function mergeMessagesById(messages: any[]): any[] {
  const seen = new Set<string>();
  return messages
    .sort((a, b) => {
      const createdDiff = (a.createdAt ?? 0) - (b.createdAt ?? 0);
      if (createdDiff !== 0) return createdDiff;
      return String(a._id).localeCompare(String(b._id));
    })
    .filter((message) => {
      const id = String(message._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function getPresenceStatus(lastActive?: number) {
  if (!lastActive || lastActive <= 0) {
    return {
      label: 'Recently active',
      isActiveNow: false,
    };
  }

  const diff = Date.now() - lastActive;
  if (diff < PRESENCE_ACTIVE_WINDOW_MS) {
    return {
      label: 'Active now',
      isActiveNow: true,
    };
  }

  return {
    label: 'Recently active',
    isActiveNow: false,
  };
}

const skeletonStyles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 20,
    gap: 12,
    backgroundColor: COLORS.background,
  },
  bubble: {
    height: 42,
    borderRadius: 20,
  },
  ownBubble: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primarySubtle,
  },
  otherBubble: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.backgroundDark,
  },
});

/** Resolve the current demo user ID at call-time from authStore.
 *  Falls back to 'demo_user_1' for legacy data compatibility. */
function getDemoUserId(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useAuthStore } = require('@/stores/authStore');
  return useAuthStore.getState().userId || 'demo_user_1';
}

/** Seed data is no longer hardcoded — conversations are created dynamically
 * by simulateMatch() and match-celebration's "Say Hi" flow, both of which
 * seed demoDmStore with a deterministic `demo_convo_${profileId}` key.
 * This empty record is kept as a fallback for seedConversation(). */
const DEMO_SEED_MESSAGES: Record<string, DemoDmMessage[]> = {};

export type ChatSource = 'messages' | 'discover' | 'confession' | 'notification' | 'match' | undefined;

export interface ChatScreenInnerProps {
  conversationId: string;
  /** Source of navigation — determines back button behavior */
  source?: ChatSource;
}

export default function ChatScreenInner({ conversationId, source }: ChatScreenInnerProps) {
  const router = useRouter();
  const convex = useConvex();
  const insets = useSafeAreaInsets();

  // Back handler — routes based on source to ensure consistent navigation
  const handleBack = useCallback(() => {
    if (source === 'messages') {
      // From Messages tab: return to Messages list
      router.replace('/(main)/(tabs)/messages');
    } else {
      // Default: use router.back() for natural navigation
      router.back();
    }
  }, [source, router]);

  // Open other user's profile when tapping avatar or name (with fromChat flag to hide action buttons)
  // FIX 8: Pass mode='confession_comment' for mini profile when matchSource is 'confession_comment'
  const handleOpenProfile = useCallback((otherUserId: string | undefined, matchSource?: string) => {
    if (otherUserId) {
      const params: any = { id: otherUserId, fromChat: '1' };
      // FIX 8: Mini profile for confession_comment matches
      if (matchSource === 'confession_comment') {
        params.mode = 'confession_comment';
      }
      router.push({
        pathname: '/(main)/profile/[id]',
        params,
      });
    } else if (__DEV__) {
      console.warn('[P1ChatHeader] missing otherUserId', { convoId: conversationId });
    }
  }, [router, conversationId]);

  const { userId, token } = useAuthStore();
  const flatListRef = useRef<FlashListRef<any>>(null);
  const scrollOffsetRef = useRef(0);
  const pendingPrependScrollRef = useRef<{ previousHeight: number; previousOffset: number } | null>(null);
  const isPrependingOlderRef = useRef(false);
  const lastDeliveredMessageIdRef = useRef<string | null>(null);
  const lastReadMessageIdRef = useRef<string | null>(null);

  // Track screen focus to check for camera-composer handoff data
  const isFocused = useIsFocused();

  // ─── Mounted guard for async safety (stability fix 2.1/2.2) ───
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ─── Composer height tracking (matches locked chat-rooms pattern) ───
  const [composerHeight, setComposerHeight] = useState(56);
  const onComposerLayout = useCallback((e: LayoutChangeEvent) => {
    setComposerHeight(e.nativeEvent.layout.height);
  }, []);

  // Track whether the user is scrolled near the bottom so we only
  // auto-scroll on new messages when they are already reading the latest.
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  // Phase-2 Fix A: Track initial load for auto-scroll to bottom on open
  const hasInitiallyScrolledRef = useRef(false);
  const contentHeightRef = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distanceFromBottom < 80;
    scrollOffsetRef.current = contentOffset.y;
  }, []);

  // Detect demo mode by global flag OR by convention: demo conversation IDs
  // start with "match_" (hardcoded seeds) or "demo_" (dynamically created).
  // This lets the same ChatScreenInner work for both demo and live Convex data.
  const isDemo = isDemoMode || (conversationId?.startsWith('match_') ?? false) || (conversationId?.startsWith('demo_') ?? false);

  // ── Demo DM store — messages survive navigation & restarts ──
  const seedConversation = useDemoDmStore((s) => s.seedConversation);
  const addDemoMessage = useDemoDmStore((s) => s.addMessage);
  const deleteDemoMessage = useDemoDmStore((s) => s.deleteMessage);
  const demoConversations = useDemoDmStore((s) => s.conversations);
  const demoMeta = useDemoDmStore((s) => s.meta);
  const demoDraft = useDemoDmStore((s) => conversationId ? s.drafts[conversationId] : undefined);
  const setDemoDraft = useDemoDmStore((s) => s.setDraft);
  const clearDemoDraft = useDemoDmStore((s) => s.clearDraft);
  const cleanupExpiredThreads = useDemoDmStore((s) => s.cleanupExpiredThreads);

  // ── Phase-2 private chat store — for demo secure photos ──
  const addPrivateMessage = usePrivateChatStore((s) => s.addMessage);
  const privateMessages = usePrivateChatStore((s) => conversationId ? s.messages[conversationId] : undefined);

  // ── Sync state from privateChatStore to demoDmStore ──
  const markDemoSecurePhotoExpired = useDemoDmStore((s) => s.markSecurePhotoExpired);
  const syncTimerEndsAt = useDemoDmStore((s) => s.syncTimerEndsAt);

  // ── Log module for secure photo debugging ──
  const logSecure = (action: string, data: Record<string, any>) => {
    if (__DEV__) console.log(`[SECURE_SYNC] ${action}`, data);
  };

  // ── Safety / integrity guards ──
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);
  const justUnblockedUserId = useBlockStore((s) => s.justUnblockedUserId);
  const clearJustUnblocked = useBlockStore((s) => s.clearJustUnblocked);
  const currentMeta = conversationId ? demoMeta[conversationId] : undefined;
  const otherUserIdFromMeta = getOtherUserIdFromMeta(currentMeta);

  // ── "Just unblocked" one-time banner state ──
  const [showJustUnblockedBanner, setShowJustUnblockedBanner] = useState(false);

  // P1-FIX: Track if blocked alert has been shown this mount (prevents alert loop)
  const hasShownBlockedAlertRef = useRef(false);

  // Check if this chat is with the just-unblocked user and show banner once
  useEffect(() => {
    if (justUnblockedUserId && otherUserIdFromMeta === justUnblockedUserId) {
      setShowJustUnblockedBanner(true);
      // Clear the flag immediately so it only shows once
      clearJustUnblocked();
    }
  }, [justUnblockedUserId, otherUserIdFromMeta, clearJustUnblocked]);

  // 5-3: Live re-check of blocked user status (not one-time)
  // Re-runs whenever blockedUserIds changes, even if chat is already open
  // P1-FIX: Guard prevents alert loop from repeated navigation/deep links
  useEffect(() => {
    if (!isDemo) return;

    // Guard 1: Blocked user — re-check live when blockedUserIds changes
    if (otherUserIdFromMeta && isUserBlocked(otherUserIdFromMeta, blockedUserIds)) {
      // P1-FIX: Only show alert once per mount to prevent stacking
      if (hasShownBlockedAlertRef.current) return;
      hasShownBlockedAlertRef.current = true;

      logDebugEvent('BLOCK_OR_REPORT', 'Blocked user chat navigation prevented');
      Alert.alert(
        'User Blocked',
        'You cannot view this conversation because you blocked this user.',
        [{ text: 'OK', onPress: handleBack }]
      );
      return;
    }
  }, [isDemo, otherUserIdFromMeta, blockedUserIds, handleBack]);

  // 5-4: Expired thread guard with explanation alert (separate effect)
  useEffect(() => {
    if (!isDemo || !conversationId) return;

    // Guard 2: Expired confession thread — show alert before navigating back
    if (isExpiredConfessionThread(currentMeta)) {
      logDebugEvent('CHAT_EXPIRED', 'Expired confession thread cleaned on navigation');
      // Clean up the expired thread
      cleanupExpiredThreads([conversationId]);
      // 5-4: Show alert explaining why access is removed
      Alert.alert(
        'Chat Expired',
        'This confession chat has expired after 24 hours. The conversation is no longer accessible.',
        [{ text: 'OK', onPress: handleBack }]
      );
    }
  }, [isDemo, conversationId, currentMeta, handleBack, cleanupExpiredThreads]);

  const hasMeta = !!demoMeta[conversationId ?? ''];
  const hasMessages = !!(demoConversations[conversationId ?? '']?.length);

  // Seed once per conversation (no-op if already seeded)
  useEffect(() => {
    if (isDemo && conversationId) {
      seedConversation(conversationId, DEMO_SEED_MESSAGES[conversationId] || []);
    }
  }, [isDemo, conversationId, seedConversation]);

  const demoMessageList = conversationId ? demoConversations[conversationId] ?? [] : [];

  // Live Phase-1 chat reads use the validated session token as the source of truth.
  const conversation = useQuery(
    api.messages.getConversation,
    !isDemo && conversationId && token ? { conversationId: conversationId as any, token } : 'skip'
  );

  // Live Phase-1 chat reads use the validated session token as the source of truth.
  const liveMessagePage = useQuery(
    api.messages.getMessagesPage,
    !isDemo && conversationId && token
      ? { conversationId: conversationId as any, token, limit: MESSAGE_PAGE_SIZE }
      : 'skip'
  );

  const otherUserTyping = useQuery(
    api.messages.getTypingStatus,
    !isDemo && conversationId && token ? { conversationId: conversationId as any, token } : 'skip'
  );

  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemo && userId ? { userId: userId as any } : 'skip'
  );

  const [olderMessages, setOlderMessages] = useState<any[]>([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [oldestLoadedCreatedAt, setOldestLoadedCreatedAt] = useState<number | null>(null);
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);

  const liveMessages = useMemo(
    () => mergeMessagesById([...(olderMessages || []), ...((liveMessagePage?.messages as any[]) || [])]),
    [liveMessagePage?.messages, olderMessages]
  );
  const messages = isDemo ? demoMessageList : liveMessages;

  // Demo conversation metadata comes from demoDmStore.meta, seeded by
  // simulateMatch() or match-celebration's "Say Hi" flow.
  // Falls back to null → triggers the "not found" empty state.
  const storedMeta = conversationId ? demoMeta[conversationId] : undefined;
  // Robust otherUserId resolution: try id, then _id, then otherUserId
  const resolvedOtherUserId = storedMeta?.otherUser?.id
    || (storedMeta?.otherUser as any)?._id
    || (storedMeta as any)?.otherUserId;
  // Fallback: if photoUrl missing from stored meta, lookup from DEMO_PROFILES
  const resolvedPhotoUrl = storedMeta?.otherUser?.photoUrl
    || DEMO_PROFILES.find((p: any) => p._id === resolvedOtherUserId)?.photos?.[0]?.url;
  const demoConversation = storedMeta
    ? {
        otherUser: {
          ...storedMeta.otherUser,
          id: resolvedOtherUserId,
          lastActive: storedMeta.otherUser.lastActive ?? Date.now(),
          photoUrl: resolvedPhotoUrl,
        },
        isPreMatch: storedMeta.isPreMatch,
        isConfessionChat: storedMeta.isConfessionChat,
        expiresAt: storedMeta.expiresAt,
      }
    : null;

  const activeConversation = isDemo ? demoConversation : conversation;

  useEffect(() => {
    setOlderMessages([]);
    setIsLoadingOlder(false);
    setHasOlderMessages(false);
    setOldestLoadedCreatedAt(null);
    setLoadOlderError(null);
    pendingPrependScrollRef.current = null;
    isPrependingOlderRef.current = false;
    lastDeliveredMessageIdRef.current = null;
    lastReadMessageIdRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    if (isDemo || !liveMessagePage) return;
    if (olderMessages.length === 0) {
      setHasOlderMessages(liveMessagePage.hasOlder);
      setOldestLoadedCreatedAt(liveMessagePage.oldestMessageCreatedAt ?? null);
    }
  }, [isDemo, liveMessagePage, olderMessages.length]);

  // Check if this is an expired confession-based chat
  const now = Date.now();
  const isExpiredChat = activeConversation
    ? (isDemo
        ? !!(activeConversation.isConfessionChat && activeConversation.expiresAt && activeConversation.expiresAt <= now)
        : ((activeConversation as any).isExpired === true)
      )
    : false;

  const terminalState = !isDemo ? ((activeConversation as any)?.terminalState ?? null) : null;
  const isTerminalConversation = terminalState === 'blocked_by_you'
    || terminalState === 'blocked_by_other'
    || terminalState === 'unmatched'
    || terminalState === 'user_removed';

  const terminalStateCopy = useMemo(() => {
    switch (terminalState) {
      case 'blocked_by_you':
        return {
          title: 'You blocked this user',
          detail: 'Messaging is turned off here. You can unblock them later if you want to chat again.',
        };
      case 'blocked_by_other':
        return {
          title: 'Conversation unavailable',
          detail: 'This conversation can no longer receive new messages.',
        };
      case 'unmatched':
        return {
          title: 'You are no longer matched',
          detail: 'Your previous messages stay visible, but new messages are turned off.',
        };
      case 'user_removed':
        return {
          title: 'User unavailable',
          detail: 'This account is no longer available. Existing messages may remain visible here.',
        };
      default:
        return null;
    }
  }, [terminalState]);


  // Log when chat is detected as expired
  const hasLoggedExpired = useRef(false);
  useEffect(() => {
    if (isExpiredChat && !hasLoggedExpired.current) {
      hasLoggedExpired.current = true;
      logDebugEvent('CHAT_EXPIRED', 'Confession chat expired');
    }
  }, [isExpiredChat]);

  const sendMessage = useMutation(api.messages.sendMessage);
  const deleteMessageMutation = useMutation(api.messages.deleteMessage); // FEAT-2
  const markAsRead = useMutation(api.messages.markAsRead);
  const markAsDelivered = useMutation(api.messages.markAsDelivered); // MESSAGE-TICKS-FIX
  const updatePresence = useMutation(api.messages.updatePresence); // ONLINE-STATUS-FIX
  const sendPreMatchMessage = useMutation(api.messages.sendPreMatchMessage);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const sendProtectedImage = useMutation(api.protectedMedia.sendProtectedImage);
  const setTypingStatus = useMutation(api.messages.setTypingStatus);
  // EXPIRY-FIX: Add mutation for marking media expired from bubble countdown
  const markMediaExpired = useMutation(api.protectedMedia.markExpired);

  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);
  const isSendingVoiceRef = useRef(false);
  const [failedTextSend, setFailedTextSend] = useState<{
    id: string;
    text: string;
    reason: string;
    createdAt: number;
  } | null>(null);
  const [retryingFailedSend, setRetryingFailedSend] = useState(false);

  // Protected media state
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const [pendingMediaType, setPendingMediaType] = useState<'photo' | 'video'>('photo');
  const [pendingIsMirrored, setPendingIsMirrored] = useState(false); // Track front-camera video mirroring
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [viewerIsMirrored, setViewerIsMirrored] = useState(false); // VIDEO-MIRROR-FIX: Track mirrored state for viewer
  const [viewerIsHoldMode, setViewerIsHoldMode] = useState(false); // HOLD-MODE-FIX: Track if viewer was opened via hold
  const [demoSecurePhotoId, setDemoSecurePhotoId] = useState<string | null>(null); // Demo mode viewer
  const [demoViewerIsHoldMode, setDemoViewerIsHoldMode] = useState(false); // HOLD-MODE-FIX: Demo mode hold tracking
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [showReportBlock, setShowReportBlock] = useState(false);

  // PARALLEL-SEND-FIX: Support multiple concurrent secure photo/video sends
  // Changed from single object to array to allow back-to-back sends
  const [pendingSecureMessages, setPendingSecureMessages] = useState<Array<{
    _id: string;
    senderId: string;
    type: 'image' | 'video';
    content: string;
    createdAt: number;
    isPending: true;
  }>>([]);

  // PARALLEL-SEND-FIX: Helper to add a pending message
  const addPendingSecureMessage = useCallback((msg: {
    _id: string;
    senderId: string;
    type: 'image' | 'video';
    content: string;
    createdAt: number;
    isPending: true;
  }) => {
    setPendingSecureMessages((prev) => [...prev, msg]);
  }, []);

  // PARALLEL-SEND-FIX: Helper to remove a pending message by ID
  const removePendingSecureMessage = useCallback((id: string) => {
    setPendingSecureMessages((prev) => prev.filter((m) => m._id !== id));
  }, []);

  // PARALLEL-SEND-FIX: Compute display messages with all pending secure messages
  // Appends all pending messages at the end (most recent) if any are being sent
  const displayMessages = React.useMemo(() => {
    if (pendingSecureMessages.length === 0) return messages || [];
    return [...(messages || []), ...pendingSecureMessages];
  }, [messages, pendingSecureMessages]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (isDemo || !conversationId || !token) return;
    if (isLoadingOlder || !hasOlderMessages || oldestLoadedCreatedAt == null) return;

    setIsLoadingOlder(true);
    setLoadOlderError(null);
    isPrependingOlderRef.current = true;
    pendingPrependScrollRef.current = {
      previousHeight: contentHeightRef.current,
      previousOffset: scrollOffsetRef.current,
    };

    try {
      const olderPage = await convex.query(api.messages.getMessagesPage, {
        conversationId: conversationId as any,
        token,
        limit: MESSAGE_PAGE_SIZE,
        before: oldestLoadedCreatedAt,
      });

      setOlderMessages((prev) => mergeMessagesById([
        ...(olderPage.messages as any[]),
        ...prev,
      ]));
      setHasOlderMessages(olderPage.hasOlder);
      setOldestLoadedCreatedAt(olderPage.oldestMessageCreatedAt ?? null);
    } catch (error) {
      console.warn('[ChatScreenInner] Failed to load older messages:', error);
      setLoadOlderError("Couldn't load older messages.");
      isPrependingOlderRef.current = false;
      pendingPrependScrollRef.current = null;
    } finally {
      if (mountedRef.current) {
        setIsLoadingOlder(false);
      }
    }
  }, [
    conversationId,
    convex,
    hasOlderMessages,
    isDemo,
    isLoadingOlder,
    oldestLoadedCreatedAt,
    token,
  ]);

  // LIVE-TICK-FIX: Compute a hash of message read/delivered states to force FlashList re-renders
  // When any message's deliveredAt or readAt changes, this hash changes, triggering a re-render
  // This ensures the sender sees tick updates (1 -> 2 -> blue) in real-time without reopening the chat
  const messageStatusHash = React.useMemo(() => {
    if (!displayMessages || displayMessages.length === 0) return '';
    // Include only the last 20 messages for performance (most recent are what users see)
    const recentMessages = displayMessages.slice(-20);
    const hash = recentMessages.map((m: any) =>
      `${m._id}:${m.deliveredAt ?? 0}:${m.readAt ?? 0}`
    ).join('|');

    // LIVE-TICK-DEBUG: Log when hash changes (tracks sender seeing tick updates)
    if (__DEV__) {
      const lastMsg = recentMessages[recentMessages.length - 1] as any;
      console.log('[LIVE-TICK-HASH] Hash computed:', {
        msgCount: recentMessages.length,
        lastMsgId: lastMsg?._id?.slice(-6),
        lastDelivered: !!lastMsg?.deliveredAt,
        lastRead: !!lastMsg?.readAt,
      });
    }

    return hash;
  }, [displayMessages]);

  // ═══════════════════════════════════════════════════════════════════════════
  // VIDEO PRELOADING — Cache video messages for instant playback
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!displayMessages || displayMessages.length === 0) return;

    // Extract video URLs from messages (last 10 for performance)
    const videoUrls: string[] = [];
    const recentMessages = displayMessages.slice(-10);

    for (const msg of recentMessages) {
      // Cast to any to access all possible message properties
      const m = msg as any;

      // Check for video type messages with URLs
      if (m.type === 'video') {
        const videoUrl = m.mediaUrl || m.videoUri || m.imageUrl;
        if (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))) {
          videoUrls.push(videoUrl);
        }
      }
      // Check for protected video media
      if (m.isProtected && m.protectedMedia?.mediaType === 'video') {
        const protectedUrl = m.protectedMedia?.localUri || m.mediaUrl;
        if (protectedUrl && (protectedUrl.startsWith('http://') || protectedUrl.startsWith('https://'))) {
          videoUrls.push(protectedUrl);
        }
      }
    }

    // Preload unique video URLs (non-blocking)
    if (videoUrls.length > 0) {
      const uniqueUrls = [...new Set(videoUrls)];
      if (__DEV__) console.log('[VIDEO-PRELOAD] Preloading', uniqueUrls.length, 'videos');
      preloadVideos(uniqueUrls, 2); // Max 2 concurrent downloads
    }
  }, [displayMessages]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TRUTH/DARE GAME STATE & INVITE FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  const [showTruthDareGame, setShowTruthDareGame] = useState(false);
  const [showTruthDareInvite, setShowTruthDareInvite] = useState(false);

  // Query game session status from backend
  const gameSession = useQuery(
    api.games.getBottleSpinSession,
    !isDemo && conversationId ? { conversationId } : 'skip'
  );

  // Game session mutations
  const sendInviteMutation = useMutation(api.games.sendBottleSpinInvite);
  const respondToInviteMutation = useMutation(api.games.respondToBottleSpinInvite);
  const endGameMutation = useMutation(api.games.endBottleSpinGame);
  // TD-LIFECYCLE: New mutations for proper session lifecycle
  const startGameMutation = useMutation(api.games.startBottleSpinGame);
  const cleanupExpiredMutation = useMutation(api.games.cleanupExpiredSession);

  // Get other user's ID for invite
  const otherUserId = activeConversation?.otherUser?.id;

  // Track cooldown state for inline UI feedback (instead of Alert spam)
  const [showCooldownMessage, setShowCooldownMessage] = useState(false);
  const [cooldownRemainingMin, setCooldownRemainingMin] = useState(0);
  // TD-UX: Lightweight waiting toast for invitee (instead of full modal)
  const [showWaitingForStartToast, setShowWaitingForStartToast] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // TD-LIFECYCLE: Watch game session state changes for cross-device sync
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isDemo || !gameSession) return;

    // TD-LIFECYCLE: Debug logging for session state
    console.log('[TD_UI_STATE] Phase 1 session update:', {
      phase: 'P1',
      conversationId,
      sessionId: gameSession.sessionId,
      state: gameSession.state,
      turnPhase: gameSession.turnPhase,
      gameStartedAt: gameSession.gameStartedAt,
      hasGameStarted: !!gameSession.gameStartedAt,
    });

    // Auto-close game modal when game is ended/rejected/expired on either device
    if (gameSession.state === 'cooldown' || gameSession.state === 'none' || gameSession.state === 'expired') {
      if (showTruthDareGame) {
        console.log('[TD_MODAL_GUARD] Phase 1: Closing modal - session ended/expired');
        setShowTruthDareGame(false);
      }
      if (showTruthDareInvite) {
        setShowTruthDareInvite(false);
      }
    }

    // TD-LIFECYCLE: Handle expired session - cleanup and show message
    if (gameSession.state === 'expired' && gameSession.endedReason && userId && token && conversationId) {
      // Cleanup the expired session in backend
      cleanupExpiredMutation({
        authUserId: userId,
        conversationId,
        endedReason: gameSession.endedReason as 'invite_expired' | 'not_started' | 'timeout',
      }).catch((err) => console.warn('[TD_CLEANUP] Failed:', err));

      // Show appropriate system message (using sendMessage directly)
      const messages: Record<string, string> = {
        invite_expired: 'Truth or Dare invite expired',
        not_started: 'Truth or Dare was not started in time',
        timeout: 'Truth or Dare ended due to inactivity',
      };
      const msg = messages[gameSession.endedReason];
      if (msg && !isDemo) {
        // Send system message with marker
        sendMessage({
          conversationId: conversationId as any,
          token: token!,
          content: `[SYSTEM:truthdare]${msg}`,
          type: 'text',
        }).catch((err) => console.warn('[TD_SYSTEM_MSG] Failed:', err));
      }
    }

    // TD-LIFECYCLE: Close invite modal when game becomes active
    // Do NOT auto-open game modal - inviter must manually start
    if (gameSession.state === 'active') {
      if (showTruthDareInvite) {
        console.log('[TD_MODAL_GUARD] Phase 1: Closing invite modal - game accepted, waiting for manual start');
        setShowTruthDareInvite(false);
        // DO NOT open game modal - inviter must click T/D button to start
      }
    }

    // Clear cooldown message when cooldown expires
    if (gameSession.state !== 'cooldown') {
      setShowCooldownMessage(false);
    }
  }, [isDemo, gameSession?.state, gameSession?.turnPhase, gameSession?.gameStartedAt, gameSession?.endedReason, showTruthDareGame, showTruthDareInvite, userId, token, conversationId, cleanupExpiredMutation, sendMessage]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TD-LIFECYCLE: Auto-open modal ONLY when game has started and it's my turn
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isDemo || !gameSession || !userId) return;

    // Only care about active games that have been manually started
    if (gameSession.state !== 'active') return;
    if (!gameSession.gameStartedAt) {
      console.log('[TD_MODAL_GUARD] Phase 1: Blocked auto-open - game not started yet', {
        state: gameSession.state,
        gameStartedAt: gameSession.gameStartedAt,
      });
      return; // Game not started yet - do NOT auto-open
    }
    if (gameSession.turnPhase !== 'choosing') return;
    if (!gameSession.currentTurnRole) return;

    // Determine my role
    const amIInviter = gameSession.inviterId === userId;
    const amIInvitee = gameSession.inviteeId === userId;
    const myRole = amIInviter ? 'inviter' : (amIInvitee ? 'invitee' : null);

    if (!myRole) return;

    // Check if it's MY turn
    const isMyTurn = gameSession.currentTurnRole === myRole;

    // If it's my turn and modal is closed, open it automatically
    if (isMyTurn && !showTruthDareGame) {
      console.log('[TD_MODAL_GUARD] Phase 1: Auto-opening modal - my turn to choose');
      setShowTruthDareGame(true);
    }
  }, [isDemo, gameSession?.state, gameSession?.turnPhase, gameSession?.currentTurnRole, gameSession?.inviterId, gameSession?.inviteeId, gameSession?.gameStartedAt, userId, showTruthDareGame]);

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-CLOSE MODAL AFTER TRUTH/DARE/SKIP SELECTION
  // When turnPhase becomes 'complete', show result briefly then close modal.
  // Both devices see this since they watch the same backend state.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isDemo || !gameSession) return;

    // Only auto-close when active game reaches 'complete' phase
    if (gameSession.state !== 'active') return;
    if (gameSession.turnPhase !== 'complete') return;

    // Wait briefly to show result, then auto-close (fast, near-instant)
    const timer = setTimeout(() => {
      if (showTruthDareGame) {
        console.log('[BOTTLE_SPIN_AUTO_CLOSE] Closing modal after T/D selection complete');
        setShowTruthDareGame(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [isDemo, gameSession?.state, gameSession?.turnPhase, showTruthDareGame]);

  // TD-LIFECYCLE: Handle T/D button press with manual start support
  const handleTruthDarePress = useCallback(async () => {
    if (isDemo) {
      // Demo mode: skip invite flow, go directly to game
      setShowTruthDareGame(true);
      return;
    }

    if (!gameSession || !userId || !token || !conversationId) return;

    // Debug logging
    console.log('[TD_MODAL_GUARD] Phase 1: T/D button pressed', {
      state: gameSession.state,
      turnPhase: gameSession.turnPhase,
      gameStartedAt: gameSession.gameStartedAt,
      hasGameStarted: !!gameSession.gameStartedAt,
      amIInviter: gameSession.inviterId === userId,
    });

    // Priority 1: Cooldown active - show inline message instead of Alert
    if (gameSession.state === 'cooldown') {
      const remainingMin = Math.ceil((gameSession.remainingMs || 0) / 60000);
      setCooldownRemainingMin(remainingMin);
      setShowCooldownMessage(true);
      setTimeout(() => setShowCooldownMessage(false), 3000);
      return;
    }

    // Priority 2: Expired session - handled by useEffect, just return
    if (gameSession.state === 'expired') {
      return;
    }

    // Priority 3: Active game exists
    if (gameSession.state === 'active') {
      const amIInviter = gameSession.inviterId === userId;
      const hasGameStarted = !!gameSession.gameStartedAt;

      // TD-LIFECYCLE: If game not started yet, handle based on role
      if (!hasGameStarted) {
        if (amIInviter) {
          // Inviter: Start the game manually
          console.log('[TD_MANUAL_START] Phase 1: Inviter starting game');
          try {
            const result = await startGameMutation({
              authUserId: userId,
              conversationId,
            });
            if (result.success) {
              console.log('[TD_MANUAL_START] Phase 1: Game started successfully');
              // Send system message using sendMessage directly
              if (!isDemo) {
                sendMessage({
                  conversationId: conversationId as any,
                  token: token!,
                  content: '[SYSTEM:truthdare]Game started!',
                  type: 'text',
                }).catch((err) => console.warn('[TD_SYSTEM_MSG] Failed:', err));
              }
              setShowTruthDareGame(true);
            } else {
              console.warn('[TD_MANUAL_START] Phase 1: Failed to start game:', result);
            }
          } catch (err) {
            console.error('[TD_MANUAL_START] Phase 1: Error starting game:', err);
          }
        } else {
          // TD-UX: Invitee sees lightweight toast instead of full modal
          console.log('[TD_UX] Phase 1: Invitee - showing waiting toast (not modal)');
          setShowWaitingForStartToast(true);
          setTimeout(() => setShowWaitingForStartToast(false), 3000);
        }
        return;
      }

      // Game is started - open the game modal normally
      setShowTruthDareGame(true);
      return;
    }

    // Priority 4: Pending invite exists - no action (button is disabled or visual feedback)
    if (gameSession.state === 'pending') {
      return;
    }

    // Priority 5: No game - show invite modal
    setShowTruthDareInvite(true);
  }, [isDemo, gameSession, userId, conversationId, token, startGameMutation, sendMessage]);

  // Send game invite
  // INVITE-FIX: Handle "Invite already pending" error gracefully
  const handleSendInvite = useCallback(async () => {
    if (!userId || !token || !conversationId || !otherUserId) return;

    // INVITE-FIX: Don't send if invite is already pending
    if (gameSession?.state === 'pending') {
      setShowTruthDareInvite(false);
      return;
    }

    try {
      await sendInviteMutation({
        authUserId: userId,
        conversationId,
        otherUserId: String(otherUserId),
      });
      setShowTruthDareInvite(false);

      // Send system message about invite (neutral phrasing that works for both parties)
      // Using inviter's name so recipient sees "[Name] wants to play..." and sender sees their own name
      const inviterName = currentUser?.name || 'Someone';
      const markedMessage = `[SYSTEM:truthdare]${inviterName} wants to play Truth or Dare!`;
      await sendMessage({
        conversationId: conversationId as any,
        token: token!,
        content: markedMessage,
        type: 'text',
      });
    } catch (error: any) {
      // INVITE-FIX: Handle "Invite already pending" error gracefully
      const errorMsg = error?.message || '';
      if (errorMsg.toLowerCase().includes('already pending') || errorMsg.toLowerCase().includes('invite already')) {
        // Show friendly message instead of error
        Alert.alert(
          'Invite Already Sent',
          'A game invite is already pending. Wait for your match to respond.',
          [{ text: 'OK', onPress: () => setShowTruthDareInvite(false) }]
        );
      } else {
        Alert.alert('Error', errorMsg || 'Failed to send invite');
      }
    }
  }, [userId, conversationId, otherUserId, gameSession?.state, token, sendInviteMutation, currentUser, sendMessage]);

  // TD-UX: Respond to game invite with clean acceptance flow
  const handleRespondToInvite = useCallback(async (accept: boolean) => {
    if (!userId || !token || !conversationId) return;

    try {
      await respondToInviteMutation({
        authUserId: userId,
        conversationId,
        accept,
      });

      // TD-UX: Clear acceptance message (NO "Game starting..." - inviter must start)
      const responseText = accept
        ? 'Invite accepted! Tap T/D to start'
        : 'Invite declined';
      const markedMessage = `[SYSTEM:truthdare]${responseText}`;
      await sendMessage({
        conversationId: conversationId as any,
        token: token!,
        content: markedMessage,
        type: 'text',
      });

      // TD-UX: Do NOT open modal on accept - inviter must tap T/D to start
      // Modal will open only after startGame mutation succeeds
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to respond to invite');
    }
  }, [userId, conversationId, token, respondToInviteMutation, sendMessage]);

  // End game (called from BottleSpinGame)
  const handleEndGame = useCallback(async () => {
    if (isDemo) return; // Demo mode doesn't track game sessions

    if (!userId || !conversationId) return;

    try {
      await endGameMutation({
        authUserId: userId,
        conversationId,
      });
    } catch (error) {
      // Silent fail - UI will close anyway
      console.warn('[TD] Failed to end game:', error);
    }
  }, [isDemo, userId, conversationId, endGameMutation]);

  // Handler to send Truth/Dare result message to chat
  // Uses system message style: demo mode uses type:'system', Convex uses [SYSTEM:truthdare] marker
  const handleSendTruthDareResult = useCallback(async (message: string) => {
    if (!conversationId) return;

    // Handle "ended the game" message - also call backend
    if (message.includes('ended the game')) {
      handleEndGame();
    }

    try {
      if (isDemo) {
        // Demo mode: native system message type with subtype
        addDemoMessage(conversationId, {
          _id: `td_${Date.now()}`,
          content: message,
          senderId: getDemoUserId(),
          type: 'system',
          systemSubtype: 'truthdare',
          createdAt: Date.now(),
        } as any); // Cast needed since DemoDmMessage doesn't have systemSubtype
      } else if (userId && token) {
        // Convex mode: prefix with hidden marker (stripped by MessageBubble)
        const markedMessage = `[SYSTEM:truthdare]${message}`;
        await sendMessage({
          conversationId: conversationId as any,
          token: token!,
          content: markedMessage,
          type: 'text',
        });
      }
    } catch {
      // Silent fail - game continues even if message fails
    }
  }, [conversationId, isDemo, userId, token, addDemoMessage, sendMessage, handleEndGame]);

  const markDemoRead = useDemoDmStore((s) => s.markConversationRead);
  const markNotifReadForConvo = useDemoNotifStore((s) => s.markReadForConversation);
  const currentViewerId = isDemo ? getDemoUserId() : userId;

  useEffect(() => {
    if (!conversationId) return;

    if (isDemo) {
      markDemoRead(conversationId, getDemoUserId());
      markNotifReadForConvo(conversationId);
    }
  }, [conversationId, isDemo, markDemoRead, markNotifReadForConvo]);

  const latestInboundUndeliveredId = useMemo(() => {
    if (!messages || messages.length === 0 || !currentViewerId) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i] as any;
      if (message.senderId !== currentViewerId && !message.deliveredAt) {
        return String(message._id);
      }
    }
    return null;
  }, [currentViewerId, messages]);

  const latestInboundUnreadId = useMemo(() => {
    if (!messages || messages.length === 0 || !currentViewerId) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i] as any;
      if (message.senderId !== currentViewerId && !message.readAt) {
        return String(message._id);
      }
    }
    return null;
  }, [currentViewerId, messages]);

  useEffect(() => {
    if (isDemo || !conversationId || !token || !isFocused || !latestInboundUndeliveredId) {
      return;
    }
    if (lastDeliveredMessageIdRef.current === latestInboundUndeliveredId) {
      return;
    }

    lastDeliveredMessageIdRef.current = latestInboundUndeliveredId;
    markAsDelivered({ conversationId: conversationId as any, token }).catch((err) => {
      lastDeliveredMessageIdRef.current = null;
      if (__DEV__) console.warn('[ChatScreen] markAsDelivered failed:', err);
    });
  }, [conversationId, isDemo, isFocused, latestInboundUndeliveredId, markAsDelivered, token]);

  useEffect(() => {
    if (!conversationId || !isFocused) return;

    if (isDemo) {
      markDemoRead(conversationId, getDemoUserId());
      return;
    }

    if (!token || !latestInboundUnreadId) return;
    if (lastReadMessageIdRef.current === latestInboundUnreadId) {
      return;
    }

    lastReadMessageIdRef.current = latestInboundUnreadId;
    markAsRead({ conversationId: conversationId as any, token }).catch((err) => {
      lastReadMessageIdRef.current = null;
      if (__DEV__) console.warn('[ChatScreen] markAsRead failed:', err);
    });
  }, [conversationId, isDemo, isFocused, latestInboundUnreadId, markAsRead, markDemoRead, token]);

  useEffect(() => {
    if (isDemo || !token || !isFocused) return;

    updatePresence({ token }).catch(() => {
      // Silent fail - presence is best-effort
    });

    const interval = setInterval(() => {
      updatePresence({ token }).catch(() => {
        // Silent fail
      });
    }, 30_000);

    return () => clearInterval(interval);
  }, [token, isDemo, isFocused, updatePresence]);

  // Helper: scroll to bottom with reliable Android timing
  const scrollToBottom = useCallback((animated = true) => {
    const doScroll = () => flatListRef.current?.scrollToEnd({ animated });
    if (Platform.OS === 'android') {
      // Android needs extra delay after keyboard animations settle
      InteractionManager.runAfterInteractions(() => setTimeout(doScroll, 120));
    } else {
      requestAnimationFrame(doScroll);
    }
  }, []);

  // Phase-2 Fix A: Reset initial scroll flag when conversation changes
  // LIVE-TICK-FIX-V2: Reset tracking refs for new conversation
  useEffect(() => {
    hasInitiallyScrolledRef.current = false;
    contentHeightRef.current = 0;
    prevMessageCountRef.current = 0;
  }, [conversationId]);

  // Phase-2 Fix A: Handle content size changes for initial scroll
  const onContentSizeChange = useCallback((w: number, h: number) => {
    const prevHeight = contentHeightRef.current;
    contentHeightRef.current = h;

    if (pendingPrependScrollRef.current) {
      const { previousHeight, previousOffset } = pendingPrependScrollRef.current;
      pendingPrependScrollRef.current = null;
      isPrependingOlderRef.current = false;
      const heightDelta = h - previousHeight;
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToOffset({
          offset: Math.max(0, previousOffset + heightDelta),
          animated: false,
        });
      });
      return;
    }

    // Initial scroll: scroll to bottom when content first renders with messages
    if (!hasInitiallyScrolledRef.current && h > 0 && (messages?.length ?? 0) > 0) {
      hasInitiallyScrolledRef.current = true;
      // Use setTimeout(0) + requestAnimationFrame for reliable post-render scroll
      setTimeout(() => {
        requestAnimationFrame(() => {
          if (mountedRef.current) {
            scrollToBottom(false); // No animation for initial scroll
          }
        });
      }, 0);
      return;
    }

    // After initial scroll: only auto-scroll if user is near bottom
    // This prevents yanking scroll when user is reading old messages
    if (hasInitiallyScrolledRef.current && h > prevHeight && isNearBottomRef.current) {
      scrollToBottom(true);
    }
  }, [messages?.length, scrollToBottom]);

  // B6 fix: Auto-scroll when new messages arrive AND (user is near bottom OR message is from current user)
  // 6-4: Removed redundant `messages` from deps — only need `messages?.length` since
  // we only act when count increases. Access to `messages` for content is via closure.
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (isPrependingOlderRef.current) {
      prevMessageCountRef.current = count;
      return;
    }
    if (count > prevMessageCountRef.current) {
      // Check if latest message is from current user
      const latestMsg = messages?.[messages.length - 1];
      const currentUserId = isDemo ? getDemoUserId() : userId;
      const isSentByCurrentUser = latestMsg?.senderId === currentUserId;

      // Scroll if near bottom OR if current user sent the message
      if (isNearBottomRef.current || isSentByCurrentUser) {
        scrollToBottom(true);
      }
    }
    prevMessageCountRef.current = count;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length, isDemo, userId, scrollToBottom]);

  // Scroll to end when keyboard opens (WhatsApp behavior).
  // Always scroll — opening the keyboard means the user is engaged at the bottom.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      scrollToBottom(true);
    });
    return () => sub.remove();
  }, [scrollToBottom]);

  // B5 fix: persist drafts in both demo and Convex modes
  const handleDraftChange = useCallback((text: string) => {
    if (conversationId) {
      if (text) {
        setDemoDraft(conversationId, text);
      } else {
        clearDemoDraft(conversationId);
      }
    }
  }, [conversationId, setDemoDraft, clearDemoDraft]);

  // Typing indicator handler - notify backend when user starts/stops typing
  const handleTypingChange = useCallback((isTyping: boolean) => {
    if (isDemo || !conversationId || !token) return;
    // Fire and forget - don't block UI for typing status updates
    setTypingStatus({
      conversationId: conversationId as any,
      token,
      isTyping,
    }).catch(() => {
      // Silently ignore typing status errors
    });
  }, [isDemo, conversationId, token, setTypingStatus]);

  // Clear typing status when leaving the chat
  useEffect(() => {
    return () => {
      if (!isDemo && conversationId && token) {
        setTypingStatus({
          conversationId: conversationId as any,
          token,
          isTyping: false,
        }).catch(() => {});
      }
    };
  }, [isDemo, conversationId, token, setTypingStatus]);

  // Check for camera-composer handoff data when screen regains focus
  // This handles returning from camera-composer with captured photo/video
  useEffect(() => {
    if (!isFocused || !conversationId) return;

    const handoffKey = `secure_capture_media_${conversationId}`;
    const capturedMedia = popHandoff<{
      uri: string;
      type: 'photo' | 'video';
      durationSec?: number;
      isMirrored?: boolean;
    }>(handoffKey);

    if (capturedMedia) {
      setPendingImageUri(capturedMedia.uri);
      setPendingMediaType(capturedMedia.type);
      setPendingIsMirrored(capturedMedia.isMirrored === true);
    }
  }, [isFocused, conversationId]);

  const getSendFailureReason = useCallback((error: any) => {
    const message = typeof error?.message === 'string' ? error.message : '';
    const normalized = message.toLowerCase();

    if (
      normalized.includes('network') ||
      normalized.includes('fetch') ||
      normalized.includes('timeout') ||
      normalized.includes('offline')
    ) {
      return 'Message not sent. Check your connection and try again.';
    }

    return message || 'Message not sent. Try again.';
  }, []);

  const handleSend = async (text: string, type: 'text' | 'template' = 'text') => {
    if (!activeConversation) return;
    if (isSendingRef.current) return;

    // Block sending if chat is expired
    if (isExpiredChat) {
      Alert.alert('Chat Expired', 'This confession chat has expired and can no longer receive messages.');
      return;
    }

    if (isTerminalConversation) {
      Alert.alert(
        terminalStateCopy?.title || 'Conversation unavailable',
        terminalStateCopy?.detail || 'Messaging is disabled for this conversation.',
      );
      return;
    }

    if (isDemo) {
      // C9 fix: use unique ID to prevent collision on rapid sends
      const uniqueId = `dm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      addDemoMessage(conversationId!, {
        _id: uniqueId,
        content: text,
        type: 'text',
        senderId: getDemoUserId(),
        createdAt: Date.now(),
      });
      // Clear the draft after sending
      if (conversationId) clearDemoDraft(conversationId);
      return;
    }

    if (!userId || !token) return;
    isSendingRef.current = true;
    if (mountedRef.current) setIsSending(true);
    // Clear typing status when sending a message
    handleTypingChange(false);
    if (__DEV__) console.log('[STABILITY][ChatSend] starting async send');

    // P0-2 STABILITY FIX: Generate clientMessageId for idempotency on retry
    // Prevents duplicate messages if network fails and user retries
    const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    try {
      if (activeConversation.isPreMatch) {
        await sendPreMatchMessage({
          token,
          toUserId: (activeConversation as any).otherUser.id as any,
          content: text,
          templateId: type === 'template' ? 'custom' : undefined,
          clientMessageId,
        });
      } else {
        await sendMessage({
          conversationId: conversationId as any,
          token,
          type: 'text',
          content: text,
          clientMessageId,
        });
      }
      // B5 fix: clear draft after successful send in Convex mode
      if (conversationId) clearDemoDraft(conversationId);
      setFailedTextSend((prev) => (prev?.text === text ? null : prev));
    } catch (error: any) {
      setFailedTextSend({
        id: `failed_text_${Date.now()}`,
        text,
        reason: getSendFailureReason(error),
        createdAt: Date.now(),
      });
      // Use Alert.alert instead of Toast for guaranteed visibility (Toast requires ToastHost to be mounted)
      if (mountedRef.current) {
        Alert.alert('Send Failed', error.message || 'Message could not be sent. Your text has been restored — tap send to retry.');
      }
      throw error; // Re-throw so MessageInput can restore text for retry
    } finally {
      isSendingRef.current = false;
      if (mountedRef.current) setIsSending(false);
    }
  };

  const handleRetryFailedText = useCallback(async () => {
    if (!failedTextSend || retryingFailedSend) return;

    setRetryingFailedSend(true);
    try {
      await handleSend(failedTextSend.text);
    } catch {
      // handleSend already preserves the failed state and restored input.
    } finally {
      if (mountedRef.current) {
        setRetryingFailedSend(false);
      }
    }
  }, [failedTextSend, retryingFailedSend, handleSend]);

  // Voice message sending - supports both demo and production
  const handleSendVoice = useCallback(async (audioUri: string, durationMs: number) => {
    if (!activeConversation || !conversationId) return;
    if (isSendingVoiceRef.current) return;

    if (isDemo) {
      const uniqueId = `dm_voice_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      addDemoMessage(conversationId, {
        _id: uniqueId,
        content: 'Voice message',
        type: 'voice',
        senderId: getDemoUserId(),
        createdAt: Date.now(),
        audioUri,
        durationMs,
      });
    } else {
      // Production mode: upload audio and send via Convex
      if (!userId || !token) return;
      isSendingVoiceRef.current = true;
      try {
        // Get upload URL
        const uploadUrl = await generateUploadUrl();

        // Read and upload audio file
        const response = await fetch(audioUri);
        const blob = await response.blob();
        const uploadResult = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/m4a' },
          body: blob,
        });
        const { storageId } = await uploadResult.json();
        const clientMessageId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        // Send voice message
        await sendMessage({
          conversationId: conversationId as any,
          token,
          type: 'voice',
          content: 'Voice message',
          audioStorageId: storageId,
          audioDurationMs: durationMs,
          clientMessageId,
        });
      } catch (e) {
        console.error('[ChatScreenInner] Failed to send voice message:', e);
        Alert.alert('Error', 'Failed to send voice message. Please try again.');
      } finally {
        isSendingVoiceRef.current = false;
      }
    }
  }, [isDemo, activeConversation, conversationId, userId, token, addDemoMessage, generateUploadUrl, sendMessage]);

  // FEAT-2: Delete voice message (supports both demo and live modes)
  const handleVoiceDelete = useCallback(async (messageId: string) => {
    if (!conversationId) return;

    if (isDemo) {
      deleteDemoMessage(conversationId, messageId);
      return;
    }

    // Live mode: call Convex mutation
    if (!token) {
      console.warn('[ChatScreenInner] Cannot delete message: no session token');
      return;
    }

    try {
      await deleteMessageMutation({
        messageId: messageId as any, // Cast to Id<'messages'>
        token,
      });
    } catch (e) {
      console.error('[ChatScreenInner] Failed to delete message:', e);
      Alert.alert('Error', 'Failed to delete message. Please try again.');
    }
  }, [isDemo, conversationId, token, deleteDemoMessage, deleteMessageMutation]);

  // Camera handler: navigate to camera-composer for photo/video capture
  const handleSendCamera = useCallback(() => {
    if (!activeConversation || !conversationId) return;

    router.push({
      pathname: '/(main)/camera-composer',
      params: {
        mode: 'secure_capture',
        conversationId: conversationId,
      },
    });
  }, [activeConversation, conversationId, router]);

  // Gallery handler: launch system gallery picker for photos and videos
  const handleSendGallery = useCallback(async () => {
    if (!activeConversation) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed to select photos and videos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      allowsEditing: false,
      videoMaxDuration: 30, // 30 second limit for secure videos
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const isVideo = asset.type === 'video';

      // Check video duration (30s max)
      if (isVideo && asset.duration && asset.duration > 30000) {
        Alert.alert('Video Too Long', 'Please select a video 30 seconds or shorter.');
        return;
      }

      setPendingImageUri(asset.uri);
      setPendingMediaType(isVideo ? 'video' : 'photo');
    }
  }, [activeConversation]);

  const handleSecurePhotoConfirm = async (imageUri: string, options: CameraPhotoOptions) => {
    if ((!isDemo && (!userId || !token)) || !conversationId) return;

    const isVideo = pendingMediaType === 'video';
    const isMirrored = pendingIsMirrored;

    setPendingImageUri(null);
    setPendingMediaType('photo'); // Reset for next time
    setPendingIsMirrored(false); // Reset mirrored flag
    // PARALLEL-SEND-FIX: Don't block UI with isSending for media sends
    // The pending messages array provides visual feedback instead
    if (__DEV__) console.log('[STABILITY][SecureConfirm] starting async secure photo/video send');

    // PARALLEL-SEND-FIX: Declare pendingId at function scope for cleanup in catch
    let pendingId = '';

    try {
      // Demo mode: Store in BOTH stores
      // - demoDmStore: for chat list display (bubble rendering)
      // - privateChatStore: for Phase2ProtectedMediaViewer (timer logic)
      if (isDemo) {
        const uniqueId = `secure_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const now = Date.now();
        // Calculate expiry duration in ms (for continuous video resume)
        // timer=-1 means "Normal" (no timer, not view-once)
        // timer=0 means "View once" (view once)
        // timer>0 means timed (seconds)
        const effectiveTimer = options.timer === -1 ? 0 : options.timer;
        const isViewOnce = options.timer === 0; // Only 0 = View once
        const expiresDurationMs = effectiveTimer > 0 ? effectiveTimer * 1000 : 0;

        const protectedMedia = {
          localUri: imageUri,
          mediaType: isVideo ? 'video' as const : 'photo' as const,
          timer: effectiveTimer,
          expiresDurationMs, // Store for wall-clock based video resume
          viewingMode: options.viewingMode,
          screenshotAllowed: false,
          viewOnce: isViewOnce,
          watermark: false,
          isMirrored: isVideo && isMirrored, // Only videos need render-time flip
        };

        // Add to demoDmStore for chat list (bubble uses isProtected + protectedMedia for display)
        // For videos: use type 'video' and videoUri; for photos: use type 'image'
        // BUGFIX: Pass the FULL protectedMedia object including localUri and mediaType
        addDemoMessage(conversationId, {
          _id: uniqueId,
          content: isVideo ? 'Secure Video' : 'Secure Photo',
          type: isVideo ? 'video' : 'image',
          senderId: getDemoUserId(),
          createdAt: now,
          isProtected: true,
          // For videos, store in videoUri; for photos, the protectedMedia.localUri is used
          ...(isVideo ? { videoUri: imageUri } : {}),
          protectedMedia, // Use full object with localUri and mediaType
        });

        // Add to privateChatStore for viewer (has full schema with localUri)
        const privateMsg: IncognitoMessage = {
          id: uniqueId, // Same ID for lookup
          conversationId,
          senderId: 'me',
          content: isVideo ? 'Secure Video' : 'Secure Photo',
          createdAt: now,
          isRead: false,
          isProtected: true,
          protectedMedia,
        };
        addPrivateMessage(conversationId, privateMsg);
        // PARALLEL-SEND-FIX: No isSending state management for demo mode
        return;
      }

      // Convex mode: upload and send
      // PARALLEL-SEND-FIX: Show immediate optimistic placeholder (supports multiple)
      // VIDEO-FIX: Use correct type for video
      pendingId = `pending_secure_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      addPendingSecureMessage({
        _id: pendingId,
        senderId: userId || getDemoUserId(),
        type: isVideo ? 'video' : 'image',
        content: isVideo ? 'Sending secure video...' : 'Sending secure photo...',
        createdAt: Date.now(),
        isPending: true,
      });

      // 1. Get upload URL
      const uploadUrl = await generateUploadUrl();

      // 2. Upload the media
      const response = await fetch(imageUri);
      const blob = await response.blob();
      // VIDEO-FIX: Use correct Content-Type for video
      const contentType = isVideo ? (blob.type || 'video/mp4') : (blob.type || 'image/jpeg');

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: blob,
      });

      // CRASH FIX: Validate upload response before accessing storageId
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json();
      if (!uploadResult?.storageId) {
        throw new Error('Upload succeeded but no storageId returned');
      }
      const { storageId } = uploadResult;
      const clientMessageId = `secure_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

      // 3. Send protected media message with the canonical Phase-1 contract:
      // secure photo/video only, tap to view, Normal/View once/30s/60s.
      const effectiveTimerConvex = options.timer === -1 ? 0 : options.timer;
      const isViewOnceConvex = options.timer === 0; // Only 0 = View once
      await sendProtectedImage({
        conversationId: conversationId as any,
        token: token as string,
        imageStorageId: storageId,
        timer: effectiveTimerConvex,
        screenshotAllowed: false, // Phase-1 default: no screenshots
        viewOnce: isViewOnceConvex,
        watermark: false, // Phase-1 default: no watermark
        viewMode: options.viewingMode,
        mediaType: isVideo ? 'video' : 'image', // VIDEO-FIX: Pass correct media type
        isMirrored: isVideo && isMirrored, // VIDEO-MIRROR-FIX: Pass mirrored flag for front-camera videos
        clientMessageId,
      });
      // PARALLEL-SEND-FIX: Remove specific pending message on success
      removePendingSecureMessage(pendingId);
    } catch (error: any) {
      // PARALLEL-SEND-FIX: Remove pending message on error too (only if set)
      if (pendingId) removePendingSecureMessage(pendingId);
      if (mountedRef.current) Alert.alert('Error', error.message || 'Failed to send secure media.');
    } finally {
      // PARALLEL-SEND-FIX: No isSending state management for media sends
      // The pending messages array handles UI feedback
    }
  };

  const handleProtectedMediaPress = (messageId: string) => {
    if (isDemo) {
      // Demo mode: use Phase2ProtectedMediaViewer (reads from privateChatStore)
      setDemoViewerIsHoldMode(false); // HOLD-MODE-FIX: Tap mode
      setDemoSecurePhotoId(messageId);
    } else {
      // Convex mode: use ProtectedMediaViewer
      // VIDEO-MIRROR-FIX: Look up message to get isMirrored state
      const msg = displayMessages.find((m) => m._id === messageId) as any;
      const isMirrored = msg?.protectedMedia?.isMirrored === true;
      setViewerIsMirrored(isMirrored);
      setViewerIsHoldMode(false); // HOLD-MODE-FIX: Tap mode
      setViewerMessageId(messageId);
    }
  };

  // HOLD-MODE-FIX: Hold mode works for both demo and Convex
  // Hold mode: press in => open viewer
  const handleProtectedMediaHoldStart = (messageId: string) => {
    if (isDemo) {
      logSecure('holdStart', { messageId });
      setDemoViewerIsHoldMode(true); // HOLD-MODE-FIX: Hold mode
      setDemoSecurePhotoId(messageId);
    } else {
      // Convex mode: open viewer on hold start
      // VIDEO-MIRROR-FIX: Look up message to get isMirrored state
      const msg = displayMessages.find((m) => m._id === messageId) as any;
      const isMirrored = msg?.protectedMedia?.isMirrored === true;
      if (__DEV__) console.log('[HOLD-MODE] Convex holdStart:', messageId, 'isMirrored:', isMirrored);
      setViewerIsMirrored(isMirrored);
      setViewerIsHoldMode(true); // HOLD-MODE-FIX: Hold mode
      setViewerMessageId(messageId);
    }
  };

  // Hold mode: press out => close viewer
  const handleProtectedMediaHoldEnd = (messageId: string) => {
    if (isDemo) {
      if (demoSecurePhotoId === messageId) {
        logSecure('holdEnd', { messageId });
        // Check and sync expired state before closing
        const privateMsg = privateMessages?.find((m) => m.id === messageId);
        if (privateMsg?.isExpired) {
          markDemoSecurePhotoExpired(conversationId!, messageId);
          logSecure('expired synced on holdEnd', { messageId, expiredAt: Date.now() });
        }
        // Sync timerEndsAt if set
        if (privateMsg?.timerEndsAt && conversationId) {
          syncTimerEndsAt(conversationId, messageId, privateMsg.timerEndsAt);
        }
        setDemoSecurePhotoId(null);
      }
    } else {
      // Convex mode: close viewer on hold end
      if (viewerMessageId === messageId) {
        if (__DEV__) console.log('[HOLD-MODE] Convex holdEnd:', messageId);
        setViewerMessageId(null);
      }
    }
  };

  // EXPIRY-FIX: Called when bubble countdown reaches 0 - handles both demo and Convex
  const handleProtectedMediaExpire = (messageId: string) => {
    if (isDemo) {
      if (conversationId) {
        logSecure('expired from bubble', { messageId });
        markDemoSecurePhotoExpired(conversationId, messageId);
      }
    } else {
      // Convex mode: call backend to mark expired
      if (token) {
        if (__DEV__) console.log('[EXPIRY] Marking media expired from bubble:', messageId);
        markMediaExpired({
          messageId: messageId as any,
          token,
        }).catch((err) => {
          if (__DEV__) console.error('[EXPIRY] Failed to mark expired:', err);
        });
      }
    }
  };

  const handleSendDare = () => {
    router.push(`/(main)/dare/send?userId=${activeConversation?.otherUser.id}`);
  };

  // Get initials for avatar placeholder fallback (always shows something)
  const avatarInitials = useMemo(() => {
    const name = activeConversation?.otherUser?.name || '';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase() || '??';
  }, [activeConversation?.otherUser?.name]);

  // CRITICAL DISTINCTION:
  //   conversation === undefined  → Convex query still loading (show spinner)
  //   conversation === null       → Convex returned no result (show "not found")
  //   isDemo && demoConversation === null → no matching demo seed (show "not found")
  // We NEVER auto-navigate away — the user can tap "Go Back" themselves.
  // Auto-redirecting would cause flicker if the query is just slow.
  if (!activeConversation) {
    const isLoading = !isDemo && conversation === undefined;
    return (
      <View style={styles.container}>
        {isLoading ? (
          <ChatLoadingSkeleton />
        ) : (
          <View style={styles.loadingContainer}>
            <Text style={styles.notFoundEmoji}>💬</Text>
            <Text style={styles.loadingText}>Conversation unavailable</Text>
            <Text style={styles.loadingSubtext}>
              This conversation may have been removed, unmatched, blocked, or is no longer accessible.
            </Text>
            <TouchableOpacity
              style={styles.errorBackButton}
              onPress={handleBack}
            >
              <Text style={styles.errorBackText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  // CRASH FIX: Guard against missing otherUser data
  // Even when activeConversation exists, otherUser might be undefined or partially loaded
  const otherUser = activeConversation.otherUser;
  if (!otherUser || !otherUser.name) {
    return (
      <View style={styles.container}>
        <ChatLoadingSkeleton />
      </View>
    );
  }

  const canSendCustom = isDemo
    ? true
    : currentUser
      ? currentUser.gender === 'female' ||
        currentUser.subscriptionTier === 'premium' ||
        (!activeConversation.isPreMatch && currentUser.subscriptionTier !== 'free')
      : false;

  const messagesRemaining = isDemo ? 999999 : (currentUser?.messagesRemaining || 0);
  const presenceStatus = getPresenceStatus(activeConversation.otherUser.lastActive);
  const showTypingIndicator = !isDemo
    && !isExpiredChat
    && !isTerminalConversation
    && otherUserTyping?.isTyping === true;
  const composerDisabledPlaceholder = isTerminalConversation
    ? (terminalStateCopy?.title || 'Messaging unavailable')
    : isExpiredChat
      ? 'This chat has expired'
      : undefined;

  // CONFESSION CHAT PRIVACY: Check if other user is anonymous (from confession chat)
  const isOtherUserAnonymous = !isDemo && (activeConversation.otherUser as any).isAnonymous === true;
  const isConfessionChat = !isDemo && (activeConversation as any).isConfessionChat === true;
  const otherUserName = activeConversation.otherUser.name;
  const otherUserPhotoUrl = isOtherUserAnonymous ? undefined : activeConversation.otherUser.photoUrl ?? undefined;
  const activeMatchSource = (activeConversation as any).matchSource;

  const messageKeyExtractor = useCallback((item: any) => String(item._id), []);

  const renderMessageItem = useCallback(({ item, index }: { item: any; index: number }) => {
    const msgSenderId = item.senderId;
    const isMessageOwn = !!(
      msgSenderId &&
      currentViewerId &&
      typeof msgSenderId === 'string' &&
      typeof currentViewerId === 'string' &&
      msgSenderId === currentViewerId
    );

    const prevMessage = displayMessages[index - 1];
    const showDayDivider = shouldShowDayDivider(item.createdAt, prevMessage?.createdAt);
    const isFirstInGroup = !prevMessage || prevMessage.senderId !== item.senderId;
    const showTimestamp = isFirstInGroup || shouldShowTimestamp(item.createdAt, prevMessage?.createdAt);
    const showAvatar = !isMessageOwn && isFirstInGroup;

    const mergedProtectedMedia = item.protectedMedia
      ? {
          ...item.protectedMedia,
          mediaType: item.protectedMedia.mediaType ?? (item.mediaType === 'video' ? 'video' : 'photo'),
          isMirrored: item.protectedMedia.isMirrored ?? item.isMirrored,
          viewingMode: item.protectedMedia.viewingMode ?? item.viewMode,
        }
      : item.viewMode
        ? {
            mediaType: item.mediaType === 'video' ? 'video' : 'photo',
            isMirrored: item.isMirrored === true,
            viewingMode: item.viewMode,
            timer: 0,
            screenshotAllowed: false,
            viewOnce: false,
            watermark: false,
          }
        : undefined;

    return (
      <View>
        {showDayDivider && (
          <View style={styles.dayDivider}>
            <Text style={styles.dayDividerText}>{formatDayLabel(item.createdAt)}</Text>
          </View>
        )}
        <MessageBubble
          message={{
            id: item._id,
            content: item.content,
            type: item.type as any,
            senderId: item.senderId,
            createdAt: item.createdAt,
            readAt: item.readAt,
            deliveredAt: item.deliveredAt,
            isProtected: item.isProtected ?? false,
            protectedMedia: mergedProtectedMedia,
            isExpired: item.isExpired,
            timerEndsAt: item.timerEndsAt,
            expiredAt: item.expiredAt,
            viewedAt: item.viewedAt,
            systemSubtype: item.systemSubtype,
            mediaId: item.mediaId,
            viewOnce: item.viewOnce,
            recipientOpened: item.recipientOpened,
            audioUri: item.audioUri,
            durationMs: item.durationMs,
            audioUrl: item.audioUrl,
            audioDurationMs: item.audioDurationMs,
          }}
          isOwn={isMessageOwn}
          otherUserName={otherUserName}
          currentUserId={currentViewerId || undefined}
          currentUserToken={!isDemo ? (token || undefined) : undefined}
          onProtectedMediaPress={handleProtectedMediaPress}
          onProtectedMediaHoldStart={handleProtectedMediaHoldStart}
          onProtectedMediaHoldEnd={handleProtectedMediaHoldEnd}
          onProtectedMediaExpire={handleProtectedMediaExpire}
          onVoiceDelete={isDemo ? handleVoiceDelete : undefined}
          showTimestamp={showTimestamp}
          showAvatar={showAvatar}
          avatarUrl={otherUserPhotoUrl}
          isLastInGroup={isFirstInGroup}
          onAvatarPress={isOtherUserAnonymous ? undefined : () => handleOpenProfile(activeConversation.otherUser.id, activeMatchSource)}
        />
      </View>
    );
  }, [
    activeConversation.otherUser.id,
    activeMatchSource,
    currentViewerId,
    displayMessages,
    handleOpenProfile,
    handleProtectedMediaExpire,
    handleProtectedMediaHoldEnd,
    handleProtectedMediaHoldStart,
    handleProtectedMediaPress,
    handleVoiceDelete,
    isDemo,
    isOtherUserAnonymous,
    otherUserName,
    otherUserPhotoUrl,
    token,
  ]);

  const listHeaderComponent = useMemo(() => {
    if (isDemo || displayMessages.length === 0) {
      return null;
    }

    return (
      <View style={styles.loadOlderContainer}>
        {hasOlderMessages ? (
          <TouchableOpacity
            style={styles.loadOlderButton}
            onPress={handleLoadOlderMessages}
            disabled={isLoadingOlder}
            activeOpacity={0.8}
          >
            {isLoadingOlder ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Text style={styles.loadOlderButtonText}>Load older messages</Text>
            )}
          </TouchableOpacity>
        ) : (
          <Text style={styles.loadOlderDoneText}>Start of conversation</Text>
        )}
        {loadOlderError ? (
          <Text style={styles.loadOlderErrorText}>{loadOlderError}</Text>
        ) : null}
      </View>
    );
  }, [displayMessages.length, handleLoadOlderMessages, hasOlderMessages, isDemo, isLoadingOlder, loadOlderError]);

  const listEmptyComponent = useMemo(() => (
    <View style={styles.emptyChat}>
      <View style={styles.emptyChatIconContainer}>
        <Text style={styles.emptyChatEmoji}>💬</Text>
      </View>
      <Text style={styles.emptyChatText}>
        {activeConversation.isPreMatch ? 'Make the first move' : 'Start the conversation'}
      </Text>
      <Text style={styles.emptyChatHint}>
        {activeConversation.isPreMatch
          ? 'A simple hello or one of the prompts below is enough to get things started.'
          : `You matched with ${otherUserName}. Say hi when you're ready.`}
      </Text>
      {!activeConversation.isPreMatch && !isOtherUserAnonymous && (
        <View style={styles.matchContextBadge}>
          <Ionicons name="heart" size={12} color={COLORS.primary} />
          <Text style={styles.matchContextText}>
            You matched with {otherUserName}
          </Text>
        </View>
      )}
    </View>
  ), [activeConversation.isPreMatch, isOtherUserAnonymous, otherUserName]);

  const listFooterComponent = useMemo(() => {
    if (!failedTextSend) {
      return null;
    }

    return (
      <View style={styles.failedSendNotice}>
        <View style={styles.failedSendTextWrap}>
          <Text style={styles.failedSendTitle}>Message failed to send</Text>
          <Text style={styles.failedSendText} numberOfLines={2}>
            {failedTextSend.reason}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.failedSendAction}
          onPress={handleRetryFailedText}
          disabled={retryingFailedSend}
          activeOpacity={0.8}
        >
          {retryingFailedSend ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Text style={styles.failedSendActionText}>Retry</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.failedSendDismiss}
          onPress={() => setFailedTextSend(null)}
          disabled={retryingFailedSend}
          activeOpacity={0.8}
        >
          <Text style={styles.failedSendDismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    );
  }, [failedTextSend, handleRetryFailedText, retryingFailedSend]);

  const listContentContainerStyle = useMemo(() => ({
    flexGrow: 1,
    justifyContent: displayMessages.length > 0 ? 'flex-end' as const : 'center' as const,
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: composerHeight,
  }), [composerHeight, displayMessages.length]);

  return (
    <View style={styles.container}>
      {/* CONFESSION CHAT BANNER: Show safety notice for anonymous confession chats */}
      {isConfessionChat && (
        <View style={[styles.confessionBanner, { paddingTop: insets.top + 8 }]}>
          <View style={styles.confessionBannerInner}>
            <Ionicons name="eye-off" size={14} color={COLORS.primary} />
            <Text style={styles.confessionBannerText}>Anonymous Chat from Confess</Text>
          </View>
          <Text style={styles.confessionBannerHint}>Be kind. Do not share personal info.</Text>
        </View>
      )}
      {/* Header — sits above KAV (does not move when keyboard opens) */}
      <View style={[styles.header, !isConfessionChat && { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        {/* Avatar with presence dot - tappable to open profile (disabled for anonymous users) */}
        {isOtherUserAnonymous ? (
          // PRIVACY: Non-tappable anonymous avatar
          <View style={styles.avatarButton}>
            <View style={styles.avatarContainer}>
              <View style={[styles.headerAvatarPlaceholder, styles.headerAvatarAnonymous]}>
                <Ionicons name="eye-off" size={18} color={COLORS.textMuted} />
              </View>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => handleOpenProfile(activeConversation.otherUser.id, (activeConversation as any).matchSource)}
            style={styles.avatarButton}
            activeOpacity={0.7}
          >
            <View style={styles.avatarContainer}>
              {activeConversation.otherUser.photoUrl ? (
                <Image
                  source={{ uri: activeConversation.otherUser.photoUrl }}
                  style={styles.headerAvatar}
                />
              ) : (
                <View style={styles.headerAvatarPlaceholder}>
                  <Text style={styles.headerAvatarInitials}>{avatarInitials}</Text>
                </View>
              )}
              {/* PRESENCE-DOT: Online indicator on avatar */}
              <View style={[
                styles.presenceDot,
                presenceStatus.isActiveNow ? styles.presenceDotOnline : styles.presenceDotOffline,
              ]} />
            </View>
          </TouchableOpacity>
        )}
        {/* Name + status - tappable to open profile (disabled for anonymous users) */}
        {isOtherUserAnonymous ? (
          // PRIVACY: Non-tappable anonymous name display
          <View style={styles.headerInfo}>
            <Text style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
              Anonymous
            </Text>
            <Text style={styles.headerStatus}>From a confession</Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => handleOpenProfile(activeConversation.otherUser.id, (activeConversation as any).matchSource)}
            style={styles.headerInfo}
            activeOpacity={0.7}
          >
            <View style={styles.headerNameRow}>
              {/* LONG-NAME-FIX: Truncate long names with ellipsis */}
              <Text style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
                {activeConversation.otherUser.name}
              </Text>
              {activeConversation.otherUser.isVerified && (
                <View style={styles.headerVerifiedBadge}>
                  <Ionicons name="checkmark" size={10} color={COLORS.white} />
                </View>
              )}
            </View>
            <Text style={styles.headerStatus}>{presenceStatus.label}</Text>
          </TouchableOpacity>
        )}
        {/* Right section: T/D button + menu with stable spacing */}
        <View style={styles.headerRightSection}>
        {/* Truth/Dare game button - only for matched users (non-pre-match) */}
        {!activeConversation.isPreMatch && (
          <TouchableOpacity
            onPress={handleTruthDarePress}
            hitSlop={8}
            style={styles.gameButton}
            disabled={!isDemo && gameSession?.state === 'pending' && gameSession?.inviterId === userId}
          >
            <View style={[
              styles.truthDareButton,
              // Show indicator dot if there's a pending invite for me
              gameSession?.state === 'pending' && gameSession?.inviteeId === userId && styles.truthDareButtonWithBadge,
              // Dim button if I sent a pending invite (waiting for response)
              !isDemo && gameSession?.state === 'pending' && gameSession?.inviterId === userId && styles.truthDareButtonWaiting,
              // Dim button during cooldown
              !isDemo && gameSession?.state === 'cooldown' && styles.truthDareButtonCooldown,
              // TD-UX: Special "ready to start" style for inviter when accepted but not started
              !isDemo && gameSession?.state === 'active' && !gameSession?.gameStartedAt && gameSession?.inviterId === userId && styles.truthDareButtonReadyToStart,
              // Green for active game that's already started
              !isDemo && gameSession?.state === 'active' && !!gameSession?.gameStartedAt && styles.truthDareButtonActive,
            ]}>
              <Ionicons name="wine" size={18} color={COLORS.white} />
              <Text style={[
                styles.truthDareLabel,
                !isDemo && gameSession?.state === 'pending' && gameSession?.inviterId === userId && styles.truthDareLabelWaiting,
              ]} numberOfLines={1}>
                {/* TD-UX: Show contextual status on button */}
                {!isDemo && gameSession?.state === 'pending' && gameSession?.inviterId === userId
                  ? 'Sent'
                  : !isDemo && gameSession?.state === 'active' && !gameSession?.gameStartedAt && gameSession?.inviterId === userId
                    ? 'Start!'
                    : 'T/D'}
              </Text>
              {/* Pending invite indicator (for invitee) */}
              {gameSession?.state === 'pending' && gameSession?.inviteeId === userId && (
                <View style={styles.truthDareBadge} />
              )}
              {/* TD-UX: Badge dot for inviter when ready to start */}
              {!isDemo && gameSession?.state === 'active' && !gameSession?.gameStartedAt && gameSession?.inviterId === userId && (
                <View style={styles.truthDareStartBadge} />
              )}
            </View>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => setShowReportBlock(true)}
          hitSlop={8}
          style={styles.moreButton}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        </View>
      </View>

      {/* T/D Cooldown inline message (replaces Alert spam) */}
      {showCooldownMessage && (
        <View style={styles.cooldownBanner}>
          <Ionicons name="timer-outline" size={16} color={COLORS.warning} />
          <Text style={styles.cooldownBannerText}>
            Cooldown: wait {cooldownRemainingMin} min{cooldownRemainingMin !== 1 ? 's' : ''} before playing again
          </Text>
        </View>
      )}

      {/* TD-UX: Waiting for inviter to start banner (for invitee) */}
      {showWaitingForStartToast && (
        <View style={styles.waitingStartBanner}>
          <Ionicons name="hourglass-outline" size={16} color="#2E7D32" />
          <Text style={styles.waitingStartBannerText}>
            Waiting for {activeConversation?.otherUser?.name || 'them'} to start the game
          </Text>
        </View>
      )}

      {/* Expired chat banner */}
      {isExpiredChat && (
        <View style={styles.expiredBanner}>
          <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.expiredBannerText}>This chat has expired.</Text>
        </View>
      )}

      {terminalStateCopy && (
        <View style={styles.terminalBanner}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.warning} />
          <View style={styles.terminalBannerTextWrap}>
            <Text style={styles.terminalBannerTitle}>{terminalStateCopy.title}</Text>
            <Text style={styles.terminalBannerText}>{terminalStateCopy.detail}</Text>
          </View>
        </View>
      )}

      {/* Just unblocked banner - one-time indicator */}
      {showJustUnblockedBanner && (
        <View style={styles.justUnblockedBanner}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={styles.justUnblockedBannerText}>Unblocked just now</Text>
        </View>
      )}

      {/* ─── KEYBOARD AVOIDING VIEW (matches locked chat-rooms pattern) ─── */}
      <KeyboardAvoidingView
        style={styles.kavContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatArea}>
          <FlashList
          ref={flatListRef}
          data={displayMessages}
          keyExtractor={messageKeyExtractor}
          // LIVE-TICK-FIX: Force re-render when message read/delivered states change
          // This ensures sender sees tick updates in real-time without reopening chat
          extraData={messageStatusHash}
          renderItem={renderMessageItem}
          ListHeaderComponent={listHeaderComponent}
          ListEmptyComponent={listEmptyComponent}
          ListFooterComponent={listFooterComponent}
          contentContainerStyle={listContentContainerStyle}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={onContentSizeChange}
        />
          {/* ─── COMPOSER (matches locked chat-rooms pattern) ─── */}
          <View
            onLayout={onComposerLayout}
            style={styles.composerWrapper}
          >
            {showTypingIndicator && (
              <View style={styles.typingIndicatorBar}>
                <View style={styles.typingIndicatorDot} />
                <Text style={styles.typingIndicatorText}>
                  {activeConversation.otherUser.name} is typing…
                </Text>
              </View>
            )}
            {/* COMPOSER-SPACING-FIX: Conditional bottom spacing based on context
                - Inside tabs (source='messages'): Tab bar handles safe area, use minimal padding
                - Standalone screen: Apply full insets.bottom for safe area protection */}
            <View style={{ paddingBottom: source === 'messages' ? 4 : insets.bottom }}>
              {/* L2 FIX: Voice messages only work in demo mode - hide from production UI */}
              <MessageInput
                onSend={handleSend}
                onSendCamera={handleSendCamera}
                onSendGallery={handleSendGallery}
                onSendVoice={handleSendVoice}
                onSendDare={activeConversation.isPreMatch ? handleSendDare : undefined}
                disabled={isSending || isExpiredChat || isTerminalConversation}
                isPreMatch={activeConversation.isPreMatch}
                messagesRemaining={messagesRemaining}
                subscriptionTier={isDemo ? 'premium' : (currentUser?.subscriptionTier || 'free')}
                canSendCustom={canSendCustom}
                recipientName={activeConversation.otherUser.name}
                initialText={demoDraft ?? ''}
                onTextChange={handleDraftChange}
                onTypingChange={handleTypingChange}
                disabledPlaceholder={composerDisabledPlaceholder}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Phase-1 Secure Photo/Video Sheet */}
      <CameraPhotoSheet
        visible={!!pendingImageUri}
        imageUri={pendingImageUri}
        mediaType={pendingMediaType}
        onConfirm={handleSecurePhotoConfirm}
        onCancel={() => { setPendingImageUri(null); setPendingMediaType('photo'); setPendingIsMirrored(false); }}
      />

      {/* Protected Media Viewer (Convex mode) */}
      {viewerMessageId && token && !isDemo && (
        <ProtectedMediaViewer
          visible={!!viewerMessageId}
          messageId={viewerMessageId}
          authToken={token}
          viewerName={currentUser?.name || activeConversation.otherUser.name}
          onClose={() => { setViewerMessageId(null); setViewerIsMirrored(false); setViewerIsHoldMode(false); }}
          onReport={() => {
            setViewerMessageId(null);
            setViewerIsMirrored(false);
            setViewerIsHoldMode(false);
            setReportModalVisible(true);
          }}
          isMirrored={viewerIsMirrored}
          isHoldMode={viewerIsHoldMode}
        />
      )}

      {/* Demo Protected Media Viewer (demo mode — uses Phase2ProtectedMediaViewer) */}
      {demoSecurePhotoId && conversationId && isDemo && (
        <Phase2ProtectedMediaViewer
          visible={!!demoSecurePhotoId}
          conversationId={conversationId}
          messageId={demoSecurePhotoId}
          onClose={() => {
            // Sync timerEndsAt and isExpired from privateChatStore to demoDmStore
            const privateMsg = privateMessages?.find((m) => m.id === demoSecurePhotoId);
            if (privateMsg?.timerEndsAt) {
              syncTimerEndsAt(conversationId, demoSecurePhotoId, privateMsg.timerEndsAt);
              logSecure('timerEndsAt synced', { messageId: demoSecurePhotoId, timerEndsAt: privateMsg.timerEndsAt });
            }
            if (privateMsg?.isExpired) {
              markDemoSecurePhotoExpired(conversationId, demoSecurePhotoId);
              logSecure('expired synced', { messageId: demoSecurePhotoId });
            }
            setDemoSecurePhotoId(null);
          }}
        />
      )}

      {/* Report Modal (for protected media) */}
      {token && (
        <ReportModal
          visible={reportModalVisible}
          authToken={token}
          reportedUserId={(activeConversation as any).otherUser?.id || ''}
          chatId={conversationId || ''}
          onClose={() => setReportModalVisible(false)}
        />
      )}

      {/* Block / Report Modal (from header 3-dot menu) */}
      <ReportBlockModal
        visible={showReportBlock}
        onClose={() => setShowReportBlock(false)}
        reportedUserId={(activeConversation as any).otherUser?.id || ''}
        reportedUserName={activeConversation.otherUser?.name || ''}
        currentUserId={userId || getDemoUserId()}
        authToken={token || undefined}
        conversationId={conversationId}
        // matchId: For Convex mode, use conversation.matchId. For demo mode, derive from conversation if it's a match.
        matchId={
          isDemo
            ? (!activeConversation.isPreMatch && !activeConversation.isConfessionChat
                ? `demo_match_${(activeConversation as any).otherUser?.id}`
                : undefined)
            : (conversation as any)?.matchId
        }
        onBlockSuccess={() => router.back()}
        onUnmatchSuccess={() => router.back()}
      />

      {/* Truth/Dare Invite Modal (first-tap flow) */}
      <Modal
        visible={showTruthDareInvite}
        animationType="fade"
        transparent
        onRequestClose={() => setShowTruthDareInvite(false)}
      >
        <View style={styles.tdInviteOverlay}>
          <View style={styles.tdInviteContainer}>
            <View style={styles.tdInviteHeader}>
              <View style={styles.tdInviteIconContainer}>
                <Ionicons name="wine" size={28} color={COLORS.white} />
              </View>
              <Text style={styles.tdInviteTitle}>Truth or Dare</Text>
            </View>
            <Text style={styles.tdInviteMessage}>
              Invite {activeConversation.otherUser.name} to play Truth or Dare?
            </Text>
            <View style={styles.tdInviteActions}>
              <TouchableOpacity
                style={[styles.tdInviteButton, styles.tdInviteCancelButton]}
                onPress={() => setShowTruthDareInvite(false)}
              >
                <Text style={styles.tdInviteCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tdInviteButton, styles.tdInviteSendButton]}
                onPress={handleSendInvite}
              >
                <Text style={styles.tdInviteSendText}>Invite</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Truth/Dare Pending Invite Card (for invitee) */}
      {gameSession?.state === 'pending' && gameSession?.inviteeId === userId && (
        <View style={styles.tdPendingInviteWrapper}>
          <TruthDareInviteCard
            inviterName={activeConversation.otherUser.name}
            isInvitee={true}
            onAccept={() => handleRespondToInvite(true)}
            onReject={() => handleRespondToInvite(false)}
          />
        </View>
      )}

      {/* Truth/Dare Bottle Spin Game */}
      <BottleSpinGame
        visible={showTruthDareGame}
        onClose={() => setShowTruthDareGame(false)}
        currentUserName={isDemo ? 'You' : (currentUser?.name || 'You')}
        otherUserName={activeConversation.otherUser.name}
        conversationId={conversationId || ''}
        userId={userId || getDemoUserId()}
        onSendResultMessage={handleSendTruthDareResult}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  kavContainer: {
    flex: 1,
  },
  chatArea: {
    flex: 1,
  },
  composerWrapper: {
    backgroundColor: COLORS.background,
  },
  typingIndicatorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: COLORS.background,
  },
  typingIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  typingIndicatorText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    padding: 24,
  },
  notFoundEmoji: {
    fontSize: 56,
    marginBottom: 8,
  },
  loadingText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 8,
  },
  loadingSubtext: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textMuted,
    textAlign: 'center',
    maxWidth: 280,
  },
  errorBackButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
  },
  errorBackText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    marginRight: 4,
    width: 40,
    height: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  avatarButton: {
    marginRight: 8,
  },
  // PRESENCE-DOT: Container for avatar + dot overlay
  avatarContainer: {
    position: 'relative' as const,
  },
  // AVATAR-ENLARGE: Increased from 36 to 40 for better visibility
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
  },
  headerAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  headerAvatarInitials: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: COLORS.white,
  },
  // PRESENCE-DOT: Small indicator dot on avatar
  presenceDot: {
    position: 'absolute' as const,
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  presenceDotOnline: {
    backgroundColor: '#22C55E', // Soft green for online
  },
  presenceDotOffline: {
    backgroundColor: COLORS.textLight, // Neutral gray for offline
    opacity: 0.5,
  },
  headerInfo: {
    flex: 1,
    minWidth: 0, // Required for text truncation in flexbox
    marginRight: 8,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: COLORS.text,
    lineHeight: 20,
    flexShrink: 1,
  },
  headerVerifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexShrink: 0,
  },
  headerStatus: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 1,
    lineHeight: 14,
  },
  // Right section container for T/D button and menu
  headerRightSection: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flexShrink: 0, // Prevent right section from shrinking
  },
  gameButton: {
    padding: 4,
    width: 44,
    height: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  truthDareButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 4,
    minWidth: 52, // Prevent shrinking
  },
  truthDareLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: COLORS.white,
    flexShrink: 0,
  },
  truthDareLabelWaiting: {
    fontSize: 10,
  },
  truthDareButtonWithBadge: {
    position: 'relative' as const,
  },
  truthDareBadge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.error,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  truthDareButtonWaiting: {
    opacity: 0.6,
    backgroundColor: COLORS.textLight,
  },
  truthDareButtonCooldown: {
    opacity: 0.5,
    backgroundColor: COLORS.textMuted,
  },
  // TD-UX: Special style for inviter when accepted but not started
  truthDareButtonReadyToStart: {
    backgroundColor: '#E67E22', // Orange - attention-grabbing
    borderWidth: 2,
    borderColor: '#F39C12',
  },
  truthDareButtonActive: {
    backgroundColor: '#27AE60', // Green for active game
  },
  truthDareStartBadge: {
    position: 'absolute' as const,
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F39C12', // Orange badge
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  cooldownBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: 'rgba(255, 152, 0, 0.12)',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cooldownBannerText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: COLORS.warning || '#FF9800',
  },
  // TD-UX: Waiting for inviter to start banner
  waitingStartBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: '#E8F5E9', // Light green tint
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#81C784',
  },
  waitingStartBannerText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#2E7D32', // Dark green
  },
  // Truth/Dare Invite Modal styles
  tdInviteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 24,
  },
  tdInviteContainer: {
    backgroundColor: COLORS.background,
    borderRadius: 18,
    padding: 24,
    width: '90%',
    maxWidth: 320,
    alignItems: 'center' as const,
  },
  tdInviteHeader: {
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  tdInviteIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.secondary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 12,
  },
  tdInviteTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: COLORS.text,
  },
  tdInviteMessage: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center' as const,
    marginBottom: 24,
    lineHeight: 22,
  },
  tdInviteActions: {
    flexDirection: 'row' as const,
    gap: 12,
    width: '100%',
  },
  tdInviteButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center' as const,
  },
  tdInviteCancelButton: {
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tdInviteSendButton: {
    backgroundColor: COLORS.primary,
  },
  tdInviteCancelText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: COLORS.text,
  },
  tdInviteSendText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: COLORS.white,
  },
  tdPendingInviteWrapper: {
    position: 'absolute' as const,
    bottom: 80,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  moreButton: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // EMPTY STATE - Friendly, engaging, clear CTA
  // ═══════════════════════════════════════════════════════════════════════════
  emptyChat: {
    alignItems: 'center',
    padding: 32,
    paddingTop: 48,
  },
  emptyChatIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyChatEmoji: {
    fontSize: 32,
  },
  emptyChatText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyChatHint: {
    fontSize: 15,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  dayDivider: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  dayDividerText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    backgroundColor: COLORS.backgroundDark,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  matchContextBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: COLORS.primary + '10',
    borderRadius: 16,
  },
  matchContextText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.primary,
  },
  loadOlderContainer: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 12,
  },
  loadOlderButton: {
    minWidth: 152,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  loadOlderButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  loadOlderDoneText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  loadOlderErrorText: {
    marginTop: 6,
    fontSize: 11,
    color: COLORS.error,
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(153,153,153,0.12)',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  expiredBannerText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  terminalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 179, 0, 0.10)',
  },
  terminalBannerTextWrap: {
    flex: 1,
  },
  terminalBannerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.warning,
  },
  terminalBannerText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textMuted,
  },
  justUnblockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(76, 175, 80, 0.12)',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  justUnblockedBannerText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.success,
  },
  failedSendNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(244, 67, 54, 0.08)',
  },
  failedSendTextWrap: {
    flex: 1,
  },
  failedSendTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.error,
  },
  failedSendText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textMuted,
  },
  failedSendAction: {
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
  },
  failedSendActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  failedSendDismiss: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  failedSendDismissText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  // CONFESSION CHAT: Anonymous privacy styles
  confessionBanner: {
    backgroundColor: 'rgba(233, 30, 99, 0.08)',
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  confessionBannerInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
  },
  confessionBannerText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: COLORS.primary,
  },
  confessionBannerHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center' as const,
    marginTop: 2,
  },
  headerAvatarAnonymous: {
    backgroundColor: COLORS.backgroundDark,
  },
});
