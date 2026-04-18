/**
 * Shared chat UI used by both:
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
  BackHandler,
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
  Linking,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
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
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { DEMO_PROFILES } from '@/lib/demoData';
import { useBlockStore } from '@/stores/blockStore';
import { useDemoNotifStore } from '@/hooks/useNotifications';
// Toast import removed — using Alert.alert for guaranteed error visibility
import { logDebugEvent } from '@/lib/debugEventLogger';
import { popHandoff } from '@/lib/memoryHandoff';
import { useIsFocused } from '@react-navigation/native';
import {
  isUserBlocked,
  isExpiredConfessionThread,
  getOtherUserIdFromMeta,
} from '@/lib/threadsIntegrity';
import { preloadVideos } from '@/lib/videoCache';
import { validateFileSize } from '@/lib/uploadUtils';
import type { DemoConversationMeta, DemoDmMessage } from '@/stores/demoDmStore';
import type { Doc, Id } from '@/convex/_generated/dataModel';

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

type ConversationId = Id<'conversations'>;
type MessageId = Id<'messages'>;
type UserId = Id<'users'>;

type LiveConversation = {
  id: string;
  matchId?: string;
  isPreMatch: boolean;
  createdAt: number;
  isConfessionChat?: boolean;
  expiresAt?: number;
  isExpired?: boolean;
  otherUser?: {
    id?: string;
    name?: string;
    photoUrl?: string;
    lastActive?: number;
    isVerified?: boolean;
    isAnonymous?: boolean;
  };
};

type BaseRenderMessage = {
  _id: string;
  senderId: string;
  type: 'text' | 'image' | 'video' | 'template' | 'dare' | 'system' | 'voice';
  content: string;
  createdAt: number;
  readAt?: number;
  readReceiptVisible?: boolean;
  deliveredAt?: number;
  clientMessageId?: string;
  imageUrl?: string;
  mediaUrl?: string | null;
  videoUri?: string;
  videoDurationMs?: number;
  isProtected?: boolean;
  protectedMedia?: {
    localUri?: string;
    mediaType?: 'photo' | 'video';
    timer: number;
    viewingMode?: 'tap' | 'hold';
    screenshotAllowed: boolean;
    viewOnce: boolean;
    watermark: boolean;
    isMirrored?: boolean;
  };
  viewMode?: 'tap' | 'hold';
  isExpired?: boolean;
  timerEndsAt?: number | null;
  expiredAt?: number | null;
  viewedAt?: number;
  systemSubtype?: string;
  mediaId?: string;
  viewOnce?: boolean;
  recipientOpened?: boolean;
  audioUri?: string;
  durationMs?: number;
  audioUrl?: string | null;
  audioDurationMs?: number;
};

type RenderMessage = BaseRenderMessage & {
  isPending?: true;
  optimisticStatus?: 'sending' | 'failed';
  errorMessage?: string;
};
type PendingSecureMessage = RenderMessage & {
  type: 'image' | 'video';
  isPending: true;
};
type OptimisticTextMessage = RenderMessage & {
  clientMessageId: string;
  type: 'text' | 'template';
  optimisticStatus: 'sending' | 'failed';
};
type CurrentUserSummary = Pick<Doc<'users'>, 'name' | 'gender' | 'subscriptionTier'>;

const PHOTO_UPLOAD_COMPRESSION_THRESHOLD_BYTES = 4 * 1024 * 1024;
const PHOTO_UPLOAD_MAX_WIDTH = 1600;

const asConversationId = (value: string): ConversationId => value as ConversationId;
const asMessageId = (value: string): MessageId => value as MessageId;
const asUserId = (value: string): UserId => value as UserId;

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';

export default function ChatScreenInner({ conversationId, source }: ChatScreenInnerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const liveConversationId = useMemo(
    () => (!conversationId || isDemoMode || conversationId.startsWith('match_') || conversationId.startsWith('demo_')
      ? null
      : asConversationId(conversationId)),
    [conversationId]
  );

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
  const handleOpenProfile = useCallback((otherUserId: string | undefined) => {
    if (otherUserId) {
      router.push({
        pathname: '/(main)/profile/[id]',
        params: { id: otherUserId, fromChat: '1' },
      });
    } else if (__DEV__) {
      console.warn('[P1ChatHeader] missing otherUserId', { convoId: conversationId });
    }
  }, [router, conversationId]);

  const { userId } = useAuthStore();
  const flatListRef = useRef<FlashListRef<RenderMessage>>(null);

  // Track screen focus to check for camera-composer handoff data
  const isFocused = useIsFocused();

  useEffect(() => {
    if (Platform.OS !== 'android' || !isFocused) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });

    return () => subscription.remove();
  }, [handleBack, isFocused]);

  // ─── Mounted guard for async safety (stability fix 2.1/2.2) ───
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const androidScrollTaskRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentSizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentSizeFrameRef = useRef<number | null>(null);
  const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadAbortControllersRef = useRef<Set<AbortController>>(new Set());

  const clearManagedTimeouts = useCallback(() => {
    if (androidScrollTaskRef.current) {
      androidScrollTaskRef.current.cancel();
      androidScrollTaskRef.current = null;
    }
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    if (contentSizeTimeoutRef.current) {
      clearTimeout(contentSizeTimeoutRef.current);
      contentSizeTimeoutRef.current = null;
    }
    if (contentSizeFrameRef.current !== null) {
      cancelAnimationFrame(contentSizeFrameRef.current);
      contentSizeFrameRef.current = null;
    }
    if (cooldownTimeoutRef.current) {
      clearTimeout(cooldownTimeoutRef.current);
      cooldownTimeoutRef.current = null;
    }
  }, []);

  const createAbortController = useCallback(() => {
    const controller = new AbortController();
    uploadAbortControllersRef.current.add(controller);
    return controller;
  }, []);

  const releaseAbortController = useCallback((controller: AbortController) => {
    uploadAbortControllersRef.current.delete(controller);
  }, []);

  useEffect(() => {
    return () => {
      clearManagedTimeouts();
      uploadAbortControllersRef.current.forEach((controller) => controller.abort());
      uploadAbortControllersRef.current.clear();
    };
  }, [clearManagedTimeouts]);

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
  useEffect(() => {
    if (!isDemo) return;

    // Guard 1: Blocked user — re-check live when blockedUserIds changes
    if (otherUserIdFromMeta && isUserBlocked(otherUserIdFromMeta, blockedUserIds)) {
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

  // SYNC-FIX: Use authUserId for consistent identity resolution across devices
  const conversation = useQuery(
    api.messages.getConversation,
    !isDemo && liveConversationId && userId
      ? { conversationId: liveConversationId, authUserId: userId }
      : 'skip'
  ) as LiveConversation | null | undefined;

  // SYNC-FIX: Use authUserId for consistent identity resolution across devices
  const convexMessages = useQuery(
    api.messages.getMessages,
    !isDemo && liveConversationId && userId
      ? { conversationId: liveConversationId, authUserId: userId }
      : 'skip'
  ) as BaseRenderMessage[] | undefined;

  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemo && userId ? { userId: asUserId(userId) } : 'skip'
  ) as CurrentUserSummary | null | undefined;

  const messages = (isDemo ? demoMessageList : convexMessages) as BaseRenderMessage[] | undefined;

  // Demo conversation metadata comes from demoDmStore.meta, seeded by
  // simulateMatch() or match-celebration's "Say Hi" flow.
  // Falls back to null → triggers the "not found" empty state.
  const storedMeta: DemoConversationMeta | undefined = conversationId ? demoMeta[conversationId] : undefined;
  const resolvedOtherUserId = storedMeta?.otherUser?.id;
  // Fallback: if photoUrl missing from stored meta, lookup from DEMO_PROFILES
  const resolvedPhotoUrl = storedMeta?.otherUser?.photoUrl
    || DEMO_PROFILES.find((profile) => profile._id === resolvedOtherUserId)?.photos?.[0]?.url;
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

  const activeConversation: LiveConversation | typeof demoConversation =
    (isDemo ? demoConversation : conversation) ?? null;

  // Check if this is an expired confession-based chat
  const now = Date.now();
  const isExpiredChat = activeConversation
    ? (isDemo
        ? !!(activeConversation.isConfessionChat && activeConversation.expiresAt && activeConversation.expiresAt <= now)
        : ('isExpired' in activeConversation && activeConversation.isExpired === true)
      )
    : false;


  // Log when chat is detected as expired
  const hasLoggedExpired = useRef(false);
  useEffect(() => {
    if (isExpiredChat && !hasLoggedExpired.current) {
      hasLoggedExpired.current = true;
      logDebugEvent('CHAT_EXPIRED', 'Confession chat expired');
    }
  }, [isExpiredChat]);

  const sendMessage = useMutation(api.messages.sendMessage);
  const deleteMessage = useMutation(api.messages.deleteMessage);
  const markAsRead = useMutation(api.messages.markAsRead);
  const markAsDelivered = useMutation(api.messages.markAsDelivered); // MESSAGE-TICKS-FIX
  const markNotificationReadForConversation = useMutation(api.notifications.markReadForConversation);
  const updatePresence = useMutation(api.messages.updatePresence); // ONLINE-STATUS-FIX
  const sendPreMatchMessage = useMutation(api.messages.sendPreMatchMessage);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const sendProtectedImage = useMutation(api.protectedMedia.sendProtectedImage);
  const setTypingStatus = useMutation(api.messages.setTypingStatus);
  // EXPIRY-FIX: Add mutation for marking media expired from bubble countdown
  const markMediaExpired = useMutation(api.protectedMedia.markExpired);

  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);

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
  const [pendingSecureMessages, setPendingSecureMessages] = useState<PendingSecureMessage[]>([]);
  const [optimisticTextMessages, setOptimisticTextMessages] = useState<OptimisticTextMessage[]>([]);

  // PARALLEL-SEND-FIX: Helper to add a pending message
  const addPendingSecureMessage = useCallback((msg: PendingSecureMessage) => {
    setPendingSecureMessages((prev) => [...prev, msg]);
  }, []);

  // PARALLEL-SEND-FIX: Helper to remove a pending message by ID
  const removePendingSecureMessage = useCallback((id: string) => {
    setPendingSecureMessages((prev) => prev.filter((m) => m._id !== id));
  }, []);

  const updatePendingSecureMessage = useCallback(
    (id: string, updater: (message: PendingSecureMessage) => PendingSecureMessage) => {
      setPendingSecureMessages((prev) =>
        prev.map((message) => (message._id === id ? updater(message) : message))
      );
    },
    []
  );

  const clearPendingMediaComposerState = useCallback(() => {
    setPendingImageUri(null);
    setPendingMediaType('photo');
    setPendingIsMirrored(false);
  }, []);

  useEffect(() => {
    clearPendingMediaComposerState();
  }, [conversationId, clearPendingMediaComposerState]);

  const openAppSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      if (mountedRef.current) {
        Alert.alert('Settings Unavailable', 'Please open your device settings and grant permission manually.');
      }
    });
  }, []);

  const showPermissionSettingsAlert = useCallback(
    (title: string, message: string) => {
      Alert.alert(title, message, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: openAppSettings },
      ]);
    },
    [openAppSettings]
  );

  const prepareSecureUploadAsset = useCallback(
    async (uri: string, mediaType: 'photo' | 'video') => {
      if (mediaType === 'video') {
        await validateFileSize(uri, 'video');
        return { uploadUri: uri, cleanupUri: null as string | null };
      }

      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new Error('Selected media is no longer available.');
      }

      const fileSize = typeof fileInfo.size === 'number' ? fileInfo.size : 0;

      if (fileSize <= PHOTO_UPLOAD_COMPRESSION_THRESHOLD_BYTES) {
        await validateFileSize(uri, 'photo');
        return { uploadUri: uri, cleanupUri: null as string | null };
      }

      try {
        const optimized = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: PHOTO_UPLOAD_MAX_WIDTH } }],
          {
            compress: 0.82,
            format: ImageManipulator.SaveFormat.JPEG,
          }
        );

        await validateFileSize(optimized.uri, 'photo');
        return {
          uploadUri: optimized.uri,
          cleanupUri: optimized.uri !== uri ? optimized.uri : null,
        };
      } catch {
        await validateFileSize(uri, 'photo');
        return { uploadUri: uri, cleanupUri: null as string | null };
      }
    },
    []
  );

  const addOptimisticTextMessage = useCallback((message: OptimisticTextMessage) => {
    setOptimisticTextMessages((prev) => [
      ...prev.filter((item) => item.clientMessageId !== message.clientMessageId),
      message,
    ]);
  }, []);

  const updateOptimisticTextMessage = useCallback(
    (
      clientMessageId: string,
      updater: (message: OptimisticTextMessage) => OptimisticTextMessage
    ) => {
      setOptimisticTextMessages((prev) =>
        prev.map((message) =>
          message.clientMessageId === clientMessageId ? updater(message) : message
        )
      );
    },
    []
  );

  useEffect(() => {
    setOptimisticTextMessages([]);
  }, [conversationId]);

  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const deliveredClientMessageIds = new Set<string>();
    for (const message of messages) {
      if (typeof message.clientMessageId === 'string' && message.clientMessageId.length > 0) {
        deliveredClientMessageIds.add(message.clientMessageId);
      }
    }

    if (deliveredClientMessageIds.size === 0) return;

    setOptimisticTextMessages((prev) => {
      const next = prev.filter(
        (message) => !deliveredClientMessageIds.has(message.clientMessageId)
      );
      return next.length === prev.length ? prev : next;
    });
  }, [messages]);

  // PARALLEL-SEND-FIX: Compute display messages with all local pending/failed rows merged in.
  const displayMessages = React.useMemo(() => {
    const serverMessages = messages || [];
    const deliveredClientMessageIds = new Set<string>();

    for (const message of serverMessages) {
      if (typeof message.clientMessageId === 'string' && message.clientMessageId.length > 0) {
        deliveredClientMessageIds.add(message.clientMessageId);
      }
    }

    const localTextMessages = optimisticTextMessages.filter(
      (message) => !deliveredClientMessageIds.has(message.clientMessageId)
    );

    if (pendingSecureMessages.length === 0 && localTextMessages.length === 0) {
      return serverMessages;
    }

    return [...serverMessages, ...localTextMessages, ...pendingSecureMessages].sort(
      (a, b) => {
        const createdDiff = (a.createdAt ?? 0) - (b.createdAt ?? 0);
        if (createdDiff !== 0) return createdDiff;
        return String(a._id).localeCompare(String(b._id));
      }
    );
  }, [messages, optimisticTextMessages, pendingSecureMessages]) as RenderMessage[];

  // LIVE-TICK-FIX: Compute a hash of message read/delivered states to force FlashList re-renders
  // When any message's deliveredAt or readAt changes, this hash changes, triggering a re-render
  // This ensures the sender sees tick updates (1 -> 2 -> blue) in real-time without reopening the chat
  const messageStatusHash = React.useMemo(() => {
    if (!displayMessages || displayMessages.length === 0) return '';
    // Include only the last 20 messages for performance (most recent are what users see)
    const recentMessages = displayMessages.slice(-20);
    const hash = recentMessages.map((m) =>
      `${m._id}:${m.deliveredAt ?? 0}:${m.readAt ?? 0}`
    ).join('|');

    // LIVE-TICK-DEBUG: Log when hash changes (tracks sender seeing tick updates)
    if (__DEV__) {
      const lastMsg = recentMessages[recentMessages.length - 1];
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
      // Check for video type messages with URLs
      if (msg.type === 'video') {
        const videoUrl = msg.mediaUrl || msg.videoUri || msg.imageUrl;
        if (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))) {
          videoUrls.push(videoUrl);
        }
      }
      // Check for protected video media
      if (msg.isProtected && msg.protectedMedia?.mediaType === 'video') {
        const protectedUrl = msg.protectedMedia?.localUri || msg.mediaUrl;
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

  // Get other user's ID for invite
  const truthDareOtherUserId = activeConversation?.otherUser?.id;

  // Track cooldown state for inline UI feedback (instead of Alert spam)
  const [showCooldownMessage, setShowCooldownMessage] = useState(false);
  const [cooldownRemainingMin, setCooldownRemainingMin] = useState(0);

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-CLOSE: Watch game session state changes for cross-device sync
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isDemo || !gameSession) return;

    // Auto-close game modal when game is ended/rejected on either device
    if (gameSession.state === 'cooldown' || gameSession.state === 'none') {
      if (showTruthDareGame) {
        setShowTruthDareGame(false);
      }
    }

    // Auto-open game modal when invite is accepted (for inviter)
    if (gameSession.state === 'active') {
      // Only auto-open if we have a pending invite modal open (inviter waiting)
      if (showTruthDareInvite) {
        setShowTruthDareInvite(false);
        setShowTruthDareGame(true);
      }
    }

    // Clear cooldown message when cooldown expires
    if (gameSession.state !== 'cooldown') {
      setShowCooldownMessage(false);
    }
  }, [isDemo, gameSession?.state, showTruthDareGame, showTruthDareInvite]);

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-OPEN MODAL WHEN IT'S MY TURN TO CHOOSE
  // This is the critical fix: when backend says it's my turn (choosing phase),
  // automatically open the game modal so I can see Truth/Dare/Skip buttons.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isDemo || !gameSession || !userId) return;

    // Only care about active games in choosing phase
    if (gameSession.state !== 'active') return;
    if (gameSession.turnPhase !== 'choosing') return;
    if (!gameSession.currentTurnRole) return;

    // Determine my role
    const amIInviter = gameSession.inviterId === userId;
    const amIInvitee = gameSession.inviteeId === userId;
    const myRole = amIInviter ? 'inviter' : (amIInvitee ? 'invitee' : null);

    if (!myRole) return;

    // Check if it's MY turn
    const isMyTurn = gameSession.currentTurnRole === myRole;

    if (__DEV__) {
      console.log('[BOTTLE_SPIN_AUTO_OPEN]', {
        turnPhase: gameSession.turnPhase,
        currentTurnRole: gameSession.currentTurnRole,
        myRole,
        isMyTurn,
        modalCurrentlyOpen: showTruthDareGame,
      });
    }

    // If it's my turn and modal is closed, open it automatically
    if (isMyTurn && !showTruthDareGame) {
      if (__DEV__) {
        console.log('[BOTTLE_SPIN_AUTO_OPEN] Opening modal - it is my turn to choose!');
      }
      setShowTruthDareGame(true);
    }
  }, [isDemo, gameSession?.state, gameSession?.turnPhase, gameSession?.currentTurnRole, gameSession?.inviterId, gameSession?.inviteeId, userId, showTruthDareGame]);

  // Handle T/D button press based on current state
  const handleTruthDarePress = useCallback(() => {
    if (isDemo) {
      // Demo mode: skip invite flow, go directly to game
      setShowTruthDareGame(true);
      return;
    }

    if (!gameSession) return;

    // Priority 1: Cooldown active - show inline message instead of Alert
    if (gameSession.state === 'cooldown') {
      const remainingMin = Math.ceil((gameSession.remainingMs || 0) / 60000);
      setCooldownRemainingMin(remainingMin);
      setShowCooldownMessage(true);
      // Auto-hide after 3 seconds
      if (cooldownTimeoutRef.current) {
        clearTimeout(cooldownTimeoutRef.current);
      }
      cooldownTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setShowCooldownMessage(false);
        }
      }, 3000);
      return;
    }

    // Priority 2: Active game exists
    if (gameSession.state === 'active') {
      setShowTruthDareGame(true);
      return;
    }

    // Priority 3: Pending invite exists - no action (button is disabled or visual feedback)
    if (gameSession.state === 'pending') {
      // Invitee sees the invite card below chat
      // Inviter sees "Waiting..." indicator - no action needed
      return;
    }

    // Priority 4: No game - show invite modal
    setShowTruthDareInvite(true);
  }, [isDemo, gameSession, userId]);

  // Send game invite
  const handleSendInvite = useCallback(async () => {
    if (!userId || !conversationId || !truthDareOtherUserId) return;

    try {
      await sendInviteMutation({
        authUserId: userId,
        conversationId,
        otherUserId: String(truthDareOtherUserId),
      });
      setShowTruthDareInvite(false);

      // Send system message about invite (neutral phrasing that works for both parties)
      // Using inviter's name so recipient sees "[Name] wants to play..." and sender sees their own name
      const inviterName = currentUser?.name || 'Someone';
      const markedMessage = `[SYSTEM:truthdare]${inviterName} wants to play Truth or Dare!`;
      await sendMessage({
        conversationId: asConversationId(conversationId),
        authUserId: userId,
        content: markedMessage,
        type: 'text',
      });
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error, 'Failed to send invite'));
    }
  }, [userId, conversationId, truthDareOtherUserId, sendInviteMutation, currentUser, sendMessage]);

  // Respond to game invite
  const handleRespondToInvite = useCallback(async (accept: boolean) => {
    if (!userId || !conversationId) return;

    try {
      await respondToInviteMutation({
        authUserId: userId,
        conversationId,
        accept,
      });

      // Send system message about response (neutral phrasing)
      const responderName = currentUser?.name || 'Someone';
      const responseText = accept
        ? `${responderName} is ready to play! Game starting...`
        : `${responderName} declined the game invite`;
      const markedMessage = `[SYSTEM:truthdare]${responseText}`;
      await sendMessage({
        conversationId: asConversationId(conversationId),
        authUserId: userId,
        content: markedMessage,
        type: 'text',
      });

      // If accepted, open the game
      if (accept) {
        setShowTruthDareGame(true);
      }
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error, 'Failed to respond to invite'));
    }
  }, [userId, conversationId, respondToInviteMutation, currentUser, sendMessage]);

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
      if (__DEV__) {
        console.warn('[TD] Failed to end game:', error);
      }
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
        const demoSystemMessage: DemoDmMessage & { systemSubtype: 'truthdare'; type: 'system' } = {
          _id: `td_${Date.now()}`,
          content: message,
          senderId: getDemoUserId(),
          type: 'system',
          systemSubtype: 'truthdare',
          createdAt: Date.now(),
        };
        addDemoMessage(conversationId, demoSystemMessage);
      } else if (userId) {
        // Convex mode: prefix with hidden marker (stripped by MessageBubble)
        const markedMessage = `[SYSTEM:truthdare]${message}`;
        // MSG-001 FIX: Use authUserId for server-side verification
        await sendMessage({
          conversationId: asConversationId(conversationId),
          authUserId: userId,
          content: markedMessage,
          type: 'text',
        });
      }
    } catch {
      // Silent fail - game continues even if message fails
    }
  }, [conversationId, isDemo, userId, addDemoMessage, sendMessage, handleEndGame]);

  const markDemoRead = useDemoDmStore((s) => s.markConversationRead);
  const markNotifReadForConvo = useDemoNotifStore((s) => s.markReadForConversation);

  const currentChatUserId = isDemo ? getDemoUserId() : userId;
  const unreadIncomingMessageIds = useMemo(
    () =>
      !messages || !currentChatUserId
        ? []
        : messages
            .filter((message) => message.senderId !== currentChatUserId && !message.readAt)
            .map((message) => message._id),
    [messages, currentChatUserId]
  );
  const undeliveredIncomingMessageIds = useMemo(
    () =>
      isDemo || !messages || !currentChatUserId
        ? []
        : messages
            .filter((message) => message.senderId !== currentChatUserId && !message.deliveredAt)
            .map((message) => message._id),
    [isDemo, messages, currentChatUserId]
  );

  const lastReadSyncKeyRef = useRef<string>('');
  const lastDeliveredSyncKeyRef = useRef<string>('');
  const lastNotificationSyncKeyRef = useRef<string>('');
  const wasFocusedRef = useRef(false);

  useEffect(() => {
    lastReadSyncKeyRef.current = '';
    lastDeliveredSyncKeyRef.current = '';
    lastNotificationSyncKeyRef.current = '';
    wasFocusedRef.current = false;
  }, [conversationId]);

  // ONLINE-STATUS-FIX: Update presence periodically while chat is open
  // This allows the other user to see "Online" status
  useEffect(() => {
    if (isDemo || !userId) return;

    // Update presence immediately on mount
    updatePresence({ authUserId: userId }).catch(() => {
      // Silent fail - presence is best-effort
    });

    // Update every 30 seconds while chat is open
    const interval = setInterval(() => {
      updatePresence({ authUserId: userId }).catch(() => {
        // Silent fail
      });
    }, 30_000);

    return () => clearInterval(interval);
  }, [userId, isDemo, updatePresence]);

  useEffect(() => {
    if (!conversationId || !isFocused) {
      wasFocusedRef.current = false;
      lastReadSyncKeyRef.current = '';
      lastDeliveredSyncKeyRef.current = '';
      lastNotificationSyncKeyRef.current = '';
      return;
    }

    const enteringFocus = !wasFocusedRef.current;
    wasFocusedRef.current = true;

    const unreadSyncKey = unreadIncomingMessageIds.join('|');
    const deliveredSyncKey = undeliveredIncomingMessageIds.join('|');

    if (isDemo) {
      if (enteringFocus || unreadIncomingMessageIds.length > 0) {
        markDemoRead(conversationId, getDemoUserId());
        markNotifReadForConvo(conversationId);
      }
      return;
    }

    if (!liveConversationId || !userId) return;

    if (enteringFocus) {
      const notificationFocusKey = `${conversationId}:focus`;
      if (lastNotificationSyncKeyRef.current !== notificationFocusKey) {
        lastNotificationSyncKeyRef.current = notificationFocusKey;
        void markNotificationReadForConversation({ authUserId: userId, conversationId }).catch((error) => {
          if (__DEV__) {
            console.warn('[ChatScreen] markReadForConversation failed:', error);
          }
        });
      }
    }

    if (deliveredSyncKey && lastDeliveredSyncKeyRef.current !== deliveredSyncKey) {
      lastDeliveredSyncKeyRef.current = deliveredSyncKey;
      void markAsDelivered({ conversationId: liveConversationId, authUserId: userId }).catch((error) => {
        if (__DEV__) {
          console.warn('[ChatScreen] markAsDelivered failed:', error);
        }
      });
    }

    if (unreadSyncKey && lastReadSyncKeyRef.current !== unreadSyncKey) {
      lastReadSyncKeyRef.current = unreadSyncKey;
      void markAsRead({ conversationId: liveConversationId, authUserId: userId }).catch((error) => {
        if (__DEV__) {
          console.warn('[ChatScreen] markAsRead failed:', error);
        }
      });

      const notificationUnreadKey = `${conversationId}:${unreadSyncKey}`;
      if (lastNotificationSyncKeyRef.current !== notificationUnreadKey) {
        lastNotificationSyncKeyRef.current = notificationUnreadKey;
        void markNotificationReadForConversation({ authUserId: userId, conversationId }).catch((error) => {
          if (__DEV__) {
            console.warn('[ChatScreen] markReadForConversation failed:', error);
          }
        });
      }
    }
  }, [
    conversationId,
    isDemo,
    isFocused,
    liveConversationId,
    markAsDelivered,
    markAsRead,
    markDemoRead,
    markNotifReadForConvo,
    markNotificationReadForConversation,
    unreadIncomingMessageIds,
    undeliveredIncomingMessageIds,
    userId,
  ]);

  // Helper: scroll to bottom with reliable Android timing
  const scrollToBottom = useCallback((animated = true) => {
    const doScroll = () => flatListRef.current?.scrollToEnd({ animated });
    if (Platform.OS === 'android') {
      // Android needs extra delay after keyboard animations settle
      if (androidScrollTaskRef.current) {
        androidScrollTaskRef.current.cancel();
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      androidScrollTaskRef.current = InteractionManager.runAfterInteractions(() => {
        scrollTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            doScroll();
          }
        }, 120);
      });
    } else {
      if (contentSizeFrameRef.current !== null) {
        cancelAnimationFrame(contentSizeFrameRef.current);
      }
      contentSizeFrameRef.current = requestAnimationFrame(doScroll);
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

    // Initial scroll: scroll to bottom when content first renders with messages
    if (!hasInitiallyScrolledRef.current && h > 0 && (messages?.length ?? 0) > 0) {
      hasInitiallyScrolledRef.current = true;
      // Use setTimeout(0) + requestAnimationFrame for reliable post-render scroll
      if (contentSizeTimeoutRef.current) {
        clearTimeout(contentSizeTimeoutRef.current);
      }
      if (contentSizeFrameRef.current !== null) {
        cancelAnimationFrame(contentSizeFrameRef.current);
      }
      contentSizeTimeoutRef.current = setTimeout(() => {
        contentSizeFrameRef.current = requestAnimationFrame(() => {
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
    if (isDemo || !liveConversationId || !userId) return;
    // Fire and forget - don't block UI for typing status updates
    setTypingStatus({
      conversationId: liveConversationId,
      authUserId: userId,
      isTyping,
    }).catch(() => {
      // Silently ignore typing status errors
    });
  }, [isDemo, liveConversationId, userId, setTypingStatus]);

  // Clear typing status when leaving the chat
  useEffect(() => {
    return () => {
      if (!isDemo && liveConversationId && userId) {
        setTypingStatus({
          conversationId: liveConversationId,
          authUserId: userId,
          isTyping: false,
        }).catch(() => {});
      }
    };
  }, [isDemo, liveConversationId, userId, setTypingStatus]);

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
      // Set pending media to trigger secure photo sheet
      setPendingImageUri(capturedMedia.uri);
      setPendingMediaType(capturedMedia.type);
      setPendingIsMirrored(capturedMedia.isMirrored === true); // Track front-camera video mirroring
    }
  }, [isFocused, conversationId]);

  const submitOptimisticTextMessage = useCallback(async (message: OptimisticTextMessage) => {
    if (!activeConversation || !userId) return false;
    if (isSendingRef.current) return false;

    isSendingRef.current = true;
    if (mountedRef.current) setIsSending(true);
    handleTypingChange(false);

    updateOptimisticTextMessage(message.clientMessageId, (current) => ({
      ...current,
      optimisticStatus: 'sending',
      errorMessage: undefined,
    }));

    if (__DEV__) console.log('[STABILITY][ChatSend] starting async send');

    try {
      if (activeConversation.isPreMatch) {
        const preMatchRecipientId = activeConversation.otherUser?.id;
        if (!preMatchRecipientId) {
          throw new Error('Recipient unavailable');
        }
        await sendPreMatchMessage({
          authUserId: userId,
          toUserId: asUserId(preMatchRecipientId),
          content: message.content,
          templateId: message.type === 'template' ? 'custom' : undefined,
          clientMessageId: message.clientMessageId,
        });
      } else {
        if (!liveConversationId) {
          throw new Error('Conversation unavailable');
        }
        await sendMessage({
          conversationId: liveConversationId,
          authUserId: userId,
          type: 'text',
          content: message.content,
          clientMessageId: message.clientMessageId,
        });
      }

      if (conversationId) clearDemoDraft(conversationId);
      return true;
    } catch (error) {
      updateOptimisticTextMessage(message.clientMessageId, (current) => ({
        ...current,
        optimisticStatus: 'failed',
        errorMessage: getErrorMessage(error, 'Message could not be sent.'),
      }));

      if (mountedRef.current) {
        Alert.alert(
          'Send Failed',
          getErrorMessage(error, 'Message could not be sent. Tap retry on the failed message.')
        );
      }
      return false;
    } finally {
      isSendingRef.current = false;
      if (mountedRef.current) setIsSending(false);
    }
  }, [
    activeConversation,
    clearDemoDraft,
    conversationId,
    handleTypingChange,
    liveConversationId,
    sendMessage,
    sendPreMatchMessage,
    updateOptimisticTextMessage,
    userId,
  ]);

  const handleRetryOptimisticTextMessage = useCallback((clientMessageId: string) => {
    const message = optimisticTextMessages.find(
      (item) =>
        item.clientMessageId === clientMessageId &&
        item.optimisticStatus === 'failed'
    );

    if (!message) return;

    void submitOptimisticTextMessage(message);
  }, [optimisticTextMessages, submitOptimisticTextMessage]);

  const handleSend = async (text: string, type: 'text' | 'template' = 'text') => {
    if (!activeConversation) return;
    if (isSendingRef.current) return;

    // Block sending if chat is expired
    if (isExpiredChat) {
      Alert.alert('Chat Expired', 'This confession chat has expired and can no longer receive messages.');
      return;
    }

    if (isDemo) {
      // C9 fix: use unique ID to prevent collision on rapid sends
      const uniqueId = `dm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      addDemoMessage(conversationId, {
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

    if (!userId) return;

    const now = Date.now();
    const clientMessageId = `msg_${now}_${Math.random().toString(36).slice(2, 11)}`;
    const optimisticMessage: OptimisticTextMessage = {
      _id: `local_${clientMessageId}`,
      clientMessageId,
      senderId: userId,
      type,
      content: text,
      createdAt: now,
      optimisticStatus: 'sending',
    };

    addOptimisticTextMessage(optimisticMessage);
    await submitOptimisticTextMessage(optimisticMessage);
  };

  // Voice message sending - supports both demo and production
  const handleSendVoice = useCallback(async (audioUri: string, durationMs: number) => {
    if (!activeConversation || !conversationId) return;

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
      if (!userId || !liveConversationId) return;
      const readController = createAbortController();
      let uploadController: AbortController | null = null;
      try {
        // Get upload URL
        const uploadUrl = await generateUploadUrl();

        // Read and upload audio file
        const response = await fetch(audioUri, { signal: readController.signal });
        const blob = await response.blob();
        releaseAbortController(readController);

        const nextUploadController = createAbortController();
        uploadController = nextUploadController;
        const uploadResult = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/m4a' },
          body: blob,
          signal: nextUploadController.signal,
        });
        const { storageId } = await uploadResult.json();

        // Send voice message
        await sendMessage({
          conversationId: liveConversationId,
          authUserId: userId,
          type: 'voice',
          content: 'Voice message',
          audioStorageId: storageId,
          audioDurationMs: durationMs,
        });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (__DEV__) {
          console.warn('[ChatScreenInner] Failed to send voice message:', error);
        }
        if (mountedRef.current) {
          Alert.alert('Error', 'Failed to send voice message. Please try again.');
        }
      } finally {
        releaseAbortController(readController);
        if (uploadController) {
          releaseAbortController(uploadController);
        }
      }
    }
  }, [
    isDemo,
    activeConversation,
    conversationId,
    userId,
    liveConversationId,
    addDemoMessage,
    createAbortController,
    generateUploadUrl,
    releaseAbortController,
    sendMessage,
  ]);

  // Delete voice message
  const handleVoiceDelete = useCallback(async (messageId: string) => {
    if (!conversationId) return;
    if (isDemo) {
      deleteDemoMessage(conversationId, messageId);
      return;
    }
    if (!userId) return;

    try {
      await deleteMessage({
        messageId: asMessageId(messageId),
        authUserId: userId,
      });
    } catch (error) {
      if (__DEV__) {
        console.warn('[ChatScreenInner] Failed to delete voice message:', error);
      }
      if (mountedRef.current) {
        Alert.alert('Error', getErrorMessage(error, 'Failed to delete voice message.'));
      }
    }
  }, [conversationId, deleteDemoMessage, deleteMessage, isDemo, userId]);

  // Camera handler: navigate to camera-composer for photo/video capture
  // This enables: photo/video toggle, 30s video limit, proper front camera handling
  const handleSendCamera = useCallback(async () => {
    if (!activeConversation || !conversationId) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== 'granted') {
      showPermissionSettingsAlert(
        'Camera Permission Needed',
        'Allow camera access in Settings to capture secure photos and videos for chat.'
      );
      return;
    }

    // Navigate to camera-composer in secure capture mode
    router.push({
      pathname: '/(main)/camera-composer',
      params: {
        mode: 'secure_capture',
        conversationId: conversationId,
      },
    });
  }, [activeConversation, conversationId, router, showPermissionSettingsAlert]);

  // Gallery handler: launch system gallery picker for photos and videos
  const handleSendGallery = useCallback(async () => {
    if (!activeConversation) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      showPermissionSettingsAlert(
        'Photo Access Needed',
        'Allow full or limited photo access in Settings to choose secure photos and videos for chat.'
      );
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

      setPendingIsMirrored(false);
      setPendingImageUri(asset.uri);
      setPendingMediaType(isVideo ? 'video' : 'photo');
    }
  }, [activeConversation, showPermissionSettingsAlert]);

  const handleSecurePhotoConfirm = async (imageUri: string, options: CameraPhotoOptions) => {
    if (!userId || !conversationId) return;

    const isVideo = pendingMediaType === 'video';
    const isMirrored = pendingIsMirrored; // Capture before clearing
    clearPendingMediaComposerState();
    // PARALLEL-SEND-FIX: Don't block UI with isSending for media sends
    // The pending messages array provides visual feedback instead
    if (__DEV__) console.log('[STABILITY][SecureConfirm] starting async secure photo/video send');

    // PARALLEL-SEND-FIX: Declare pendingId at function scope for cleanup in catch
    let pendingId = '';
    let readController: AbortController | null = null;
    let uploadController: AbortController | null = null;
    let cleanupUploadUri: string | null = null;

    try {
      // Demo mode: Store in BOTH stores
      // - demoDmStore: for chat list display (bubble rendering)
      // - privateChatStore: for Phase2ProtectedMediaViewer (timer logic)
      if (isDemo) {
        const uniqueId = `secure_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const now = Date.now();
        // Calculate expiry duration in ms (for continuous video resume)
        // timer=0 means "Once" (view once), otherwise timer is in seconds
        const expiresDurationMs = options.timer > 0 ? options.timer * 1000 : 0;

        const protectedMedia = {
          localUri: imageUri,
          mediaType: isVideo ? 'video' as const : 'photo' as const,
          timer: options.timer,
          expiresDurationMs, // Store for wall-clock based video resume
          viewingMode: options.viewingMode,
          screenshotAllowed: false,
          viewOnce: options.timer === 0,
          watermark: false,
          isMirrored: isVideo && isMirrored, // Only videos need render-time flip
        };

        // Add to demoDmStore for chat list (bubble uses isProtected + protectedMedia for display)
        // For videos: use type 'video' and videoUri; for photos: use type 'image'
        addDemoMessage(conversationId, {
          _id: uniqueId,
          content: isVideo ? 'Secure Video' : 'Secure Photo',
          type: isVideo ? 'video' : 'image',
          senderId: getDemoUserId(),
          createdAt: now,
          isProtected: true,
          // For videos, store in videoUri; for photos, the protectedMedia.localUri is used
          ...(isVideo ? { videoUri: imageUri } : {}),
          protectedMedia: {
            timer: options.timer,
            viewingMode: options.viewingMode,
            screenshotAllowed: false,
            viewOnce: options.timer === 0,
            watermark: false,
            isMirrored: isVideo && isMirrored, // For bubble thumbnail flip
          },
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
      if (!liveConversationId) {
        throw new Error('Conversation unavailable');
      }
      pendingId = `pending_secure_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      addPendingSecureMessage({
        _id: pendingId,
        senderId: userId,
        type: isVideo ? 'video' : 'image',
        content: isVideo ? 'Preparing secure video...' : 'Preparing secure photo...',
        createdAt: Date.now(),
        isPending: true,
      });

      const mediaType = isVideo ? 'video' : 'photo';
      if (!isVideo) {
        updatePendingSecureMessage(pendingId, (message) => ({
          ...message,
          content: 'Optimizing secure photo...',
        }));
      }
      const preparedAsset = await prepareSecureUploadAsset(imageUri, mediaType);
      cleanupUploadUri = preparedAsset.cleanupUri;

      // 1. Get upload URL
      updatePendingSecureMessage(pendingId, (message) => ({
        ...message,
        content: isVideo ? 'Uploading secure video...' : 'Uploading secure photo...',
      }));
      const uploadUrl = await generateUploadUrl();

      // 2. Upload the media
      const nextReadController = createAbortController();
      readController = nextReadController;
      const response = await fetch(preparedAsset.uploadUri, { signal: nextReadController.signal });
      const blob = await response.blob();
      releaseAbortController(readController);
      readController = null;
      // VIDEO-FIX: Use correct Content-Type for video
      const contentType = isVideo ? (blob.type || 'video/mp4') : (blob.type || 'image/jpeg');

      const nextUploadController = createAbortController();
      uploadController = nextUploadController;
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: blob,
        signal: nextUploadController.signal,
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

      updatePendingSecureMessage(pendingId, (message) => ({
        ...message,
        content: isVideo ? 'Finalizing secure video...' : 'Finalizing secure photo...',
      }));

      // 3. Send protected media message with Phase-1 options mapped to Convex format
      // MSG-003 FIX: Use authUserId for server-side verification
      // HOLD-TAP-FIX: Pass viewMode to backend for consistent rendering
      // VIDEO-FIX: Pass mediaType to distinguish photo vs video
      // VIDEO-MIRROR-FIX: Pass isMirrored for front-camera video correction
      await sendProtectedImage({
        conversationId: liveConversationId,
        authUserId: userId,
        imageStorageId: storageId,
        timer: options.timer,
        screenshotAllowed: false, // Phase-1 default: no screenshots
        viewOnce: options.timer === 0, // "Once" timer = view once
        watermark: false, // Phase-1 default: no watermark
        viewMode: options.viewingMode, // HOLD-TAP-FIX: Store the actual viewing mode
        mediaType: isVideo ? 'video' : 'image', // VIDEO-FIX: Pass correct media type
        isMirrored: isVideo && isMirrored, // VIDEO-MIRROR-FIX: Pass mirrored flag for front-camera videos
      });
      // PARALLEL-SEND-FIX: Remove specific pending message on success
      removePendingSecureMessage(pendingId);
      releaseAbortController(uploadController);
      uploadController = null;
    } catch (error) {
      // PARALLEL-SEND-FIX: Remove pending message on error too (only if set)
      if (pendingId) removePendingSecureMessage(pendingId);
      if (!isAbortError(error) && mountedRef.current) {
        Alert.alert('Error', getErrorMessage(error, 'Failed to send secure photo'));
      }
    } finally {
      if (readController) {
        releaseAbortController(readController);
      }
      if (uploadController) {
        releaseAbortController(uploadController);
      }
      if (cleanupUploadUri) {
        FileSystem.deleteAsync(cleanupUploadUri, { idempotent: true }).catch(() => {});
      }
      // PARALLEL-SEND-FIX: No isSending state management for media sends
      // The pending messages array handles UI feedback
    }
  };

  const findDisplayMessageById = useCallback(
    (messageId: string) => displayMessages.find((message) => message._id === messageId),
    [displayMessages]
  );

  const handleProtectedMediaPress = (messageId: string) => {
    if (isDemo) {
      // Demo mode: use Phase2ProtectedMediaViewer (reads from privateChatStore)
      setDemoViewerIsHoldMode(false); // HOLD-MODE-FIX: Tap mode
      setDemoSecurePhotoId(messageId);
    } else {
      // Convex mode: use ProtectedMediaViewer
      // VIDEO-MIRROR-FIX: Look up message to get isMirrored state
      const msg = findDisplayMessageById(messageId);
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
      const msg = findDisplayMessageById(messageId);
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
          markDemoSecurePhotoExpired(conversationId, messageId);
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
      if (userId) {
        if (__DEV__) console.log('[EXPIRY] Marking media expired from bubble:', messageId);
        markMediaExpired({
          messageId: asMessageId(messageId),
          authUserId: userId,
        }).catch((err) => {
          if (__DEV__) console.error('[EXPIRY] Failed to mark expired:', err);
        });
      }
    }
  };

  const handleSendDare = () => {
    const dareRecipientId = activeConversation?.otherUser?.id;
    if (!dareRecipientId) return;
    router.push(`/(main)/dare/send?userId=${dareRecipientId}`);
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
      <View style={styles.loadingContainer}>
        {isLoading ? (
          <>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Opening your conversation...</Text>
          </>
        ) : (
          <>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.loadingText}>This chat is no longer available.</Text>
            <TouchableOpacity
              style={styles.errorBackButton}
              onPress={handleBack}
            >
              <Text style={styles.errorBackText}>Go back</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // CRASH FIX: Guard against missing otherUser data
  // Even when activeConversation exists, otherUser might be undefined or partially loaded
  const otherUser = activeConversation.otherUser;
  if (!otherUser || !otherUser.name) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Syncing your conversation...</Text>
      </View>
    );
  }

  const otherUserId = typeof otherUser.id === 'string' && otherUser.id.length > 0
    ? otherUser.id
    : undefined;
  const otherUserName = otherUser.name;
  const otherUserPhotoUrl = otherUser.photoUrl;
  const otherUserLastActive = otherUser.lastActive ?? 0;
  const activeMatchId = !isDemo ? conversation?.matchId : undefined;

  const composerBottomPadding = source === 'messages'
    ? (Platform.OS === 'android' ? 8 : 6)
    : Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 8);

  const canSendCustom = isDemo
    ? true
    : currentUser
      ? currentUser.gender === 'female' ||
        currentUser.subscriptionTier === 'premium' ||
        (!activeConversation.isPreMatch && currentUser.subscriptionTier !== 'free')
      : false;

  return (
    <View style={styles.container}>
      {/* LOCKED: P1 chat header avatar + open profile. Do not modify without explicit approval. */}
      {/* Header — sits above KAV (does not move when keyboard opens) */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        {/* Avatar with presence dot - tappable to open profile */}
        <TouchableOpacity
          onPress={() => handleOpenProfile(otherUserId)}
          style={styles.avatarButton}
          activeOpacity={0.7}
        >
          <View style={styles.avatarContainer}>
            {otherUserPhotoUrl ? (
              <Image
                source={{ uri: otherUserPhotoUrl }}
                style={styles.headerAvatar}
              />
            ) : (
              <View style={styles.headerAvatarPlaceholder}>
                <Text style={styles.headerAvatarInitials}>{avatarInitials}</Text>
              </View>
            )}
            {/* PRESENCE-DOT: Online indicator on avatar */}
            {(() => {
              const isOnline = Date.now() - otherUserLastActive < 60_000;
              return (
                <View style={[
                  styles.presenceDot,
                  isOnline ? styles.presenceDotOnline : styles.presenceDotOffline,
                ]} />
              );
            })()}
          </View>
        </TouchableOpacity>
        {/* Name + status - tappable to open profile */}
        <TouchableOpacity
          onPress={() => handleOpenProfile(otherUserId)}
          style={styles.headerInfo}
          activeOpacity={0.7}
        >
          {/* LONG-NAME-FIX: Truncate long names with ellipsis */}
          <Text style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
            {otherUserName}
          </Text>
          {/* ONLINE-STATUS-FIX: Show "Online" for very recent activity */}
          <Text style={styles.headerStatus}>
            {(() => {
              const diff = Date.now() - otherUserLastActive;
              // Online: within 1 minute (likely still in app)
              if (diff < 60_000) return 'Online';
              // Active now: within 5 minutes
              if (diff < 5 * 60_000) return 'Active now';
              // Recently active: anything else with valid timestamp
              if (otherUserLastActive > 0) return 'Recently active';
              return 'Offline';
            })()}
          </Text>
        </TouchableOpacity>
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
            ]}>
              <Ionicons name="wine" size={18} color={COLORS.white} />
              <Text style={styles.truthDareLabel}>
                {/* Show status on button */}
                {!isDemo && gameSession?.state === 'pending' && gameSession?.inviterId === userId
                  ? 'Wait'
                  : 'T/D'}
              </Text>
              {/* Pending invite indicator (for invitee) */}
              {gameSession?.state === 'pending' && gameSession?.inviteeId === userId && (
                <View style={styles.truthDareBadge} />
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

      {/* Expired chat banner */}
      {isExpiredChat && (
        <View style={styles.expiredBanner}>
          <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.expiredBannerText}>This chat has expired.</Text>
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
          keyExtractor={(item) => item._id}
          // LIVE-TICK-FIX: Force re-render when message read/delivered states change
          // This ensures sender sees tick updates in real-time without reopening chat
          extraData={messageStatusHash}
          renderItem={({ item, index }: { item: RenderMessage; index: number }) => {
            const optimisticStatus = 'optimisticStatus' in item ? item.optimisticStatus : undefined;
            // SECURE-REWRITE: Single source of truth for message ownership
            // Both IDs must be valid non-empty strings for comparison
            const msgSenderId = item.senderId;
            const currentUserId = isDemo ? getDemoUserId() : userId;
            const isMessageOwn = !!(
              msgSenderId &&
              currentUserId &&
              typeof msgSenderId === 'string' &&
              typeof currentUserId === 'string' &&
              msgSenderId === currentUserId
            );

            // AVATAR GROUPING: Determine if this is the last message in a sender group
            // Show avatar only on the LAST message of consecutive messages from the same sender
            const nextMessage = displayMessages[index + 1];
            const isLastInGroup = !nextMessage || nextMessage.senderId !== item.senderId;
            // Show avatar only for received messages (not own) and only on last in group
            const showAvatar = !isMessageOwn && isLastInGroup;

            // SECURE-MEDIA-FIX: Merge backend viewMode into protectedMedia for consistent mode
            // This ensures both sender and receiver use the same viewMode from the single source of truth
            const mergedProtectedMedia = item.protectedMedia
              ? { ...item.protectedMedia, viewingMode: item.protectedMedia.viewingMode ?? item.viewMode }
              : item.viewMode
                ? { viewingMode: item.viewMode, timer: 0, screenshotAllowed: false, viewOnce: false, watermark: false }
                : undefined;

            return (
              <View>
                <MessageBubble
                  message={{
                    id: item._id,
                    content: item.content,
                    type: item.type,
                    senderId: item.senderId,
                    createdAt: item.createdAt,
                    readAt: item.readAt,
                    readReceiptVisible: item.readReceiptVisible,
                    deliveredAt: item.deliveredAt, // MESSAGE-TICKS-FIX: Pass deliveredAt for tick rendering
                    isProtected: item.isProtected ?? false,
                    // SECURE-MEDIA-FIX: Use merged protectedMedia with backend viewMode
                    protectedMedia: mergedProtectedMedia,
                    isExpired: item.isExpired,
                    timerEndsAt: item.timerEndsAt,
                    expiredAt: item.expiredAt,
                    viewedAt: item.viewedAt,
                    systemSubtype: item.systemSubtype,
                    mediaId: item.mediaId,
                    // SENDER-TIMER-FIX: Pass viewOnce and recipientOpened for sender status
                    viewOnce: item.viewOnce,
                    recipientOpened: item.recipientOpened,
                    // VOICE-FIX: Pass both demo and production audio fields
                    audioUri: item.audioUri,
                    durationMs: item.durationMs,
                    audioUrl: item.audioUrl,
                    audioDurationMs: item.audioDurationMs,
                  }}
                  isOwn={isMessageOwn}
                  otherUserName={otherUserName}
                  currentUserId={currentUserId || undefined}
                  onProtectedMediaPress={handleProtectedMediaPress}
                  // HOLD-MODE-FIX: Enable hold handlers for both demo and Convex mode
                  onProtectedMediaHoldStart={handleProtectedMediaHoldStart}
                  onProtectedMediaHoldEnd={handleProtectedMediaHoldEnd}
                  onProtectedMediaExpire={handleProtectedMediaExpire}
                  onVoiceDelete={handleVoiceDelete}
                  // AVATAR GROUPING: Pass grouping info for Instagram/Tinder style layout
                  showAvatar={showAvatar}
                  avatarUrl={otherUserPhotoUrl}
                  isLastInGroup={isLastInGroup}
                  // PROFILE-TAP: Avatar tap opens profile
                  onAvatarPress={() => handleOpenProfile(otherUserId)}
                />
                {isMessageOwn && optimisticStatus === 'sending' && (
                  <View style={styles.optimisticStatusRow}>
                    <ActivityIndicator size="small" color={COLORS.textLight} />
                    <Text style={styles.optimisticStatusText}>Sending...</Text>
                  </View>
                )}
                {isMessageOwn && optimisticStatus === 'failed' && (
                  <TouchableOpacity
                    style={[styles.optimisticStatusRow, styles.optimisticFailedRow]}
                    onPress={() => handleRetryOptimisticTextMessage(item.clientMessageId)}
                    disabled={isSending}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="alert-circle-outline" size={14} color={COLORS.error} />
                    <Text style={[styles.optimisticStatusText, styles.optimisticFailedText]}>
                      {item.errorMessage ? `${item.errorMessage} Tap to retry.` : 'Failed to send. Tap to retry.'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons name="chatbubble-outline" size={40} color={COLORS.border} />
              <Text style={styles.emptyChatText}>
                Start the conversation with {otherUserName}.
              </Text>
            </View>
          }
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: displayMessages.length > 0 ? 'flex-end' as const : 'center' as const,
            paddingTop: 8,
            paddingHorizontal: 12,
            paddingBottom: composerHeight + composerBottomPadding,
          }}
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
            <View style={{ paddingBottom: composerBottomPadding }}>
              {/* L2 FIX: Voice messages only work in demo mode - hide from production UI */}
              <MessageInput
                onSend={handleSend}
                onSendCamera={handleSendCamera}
                onSendGallery={handleSendGallery}
                onSendVoice={handleSendVoice}
                onSendDare={activeConversation.isPreMatch ? handleSendDare : undefined}
                disabled={isSending || isExpiredChat}
                isPreMatch={activeConversation.isPreMatch}
                subscriptionTier={isDemo ? 'premium' : (currentUser?.subscriptionTier || 'free')}
                canSendCustom={canSendCustom}
                recipientName={otherUserName}
                initialText={demoDraft ?? ''}
                onTextChange={handleDraftChange}
                onTypingChange={handleTypingChange}
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
        onCancel={clearPendingMediaComposerState}
      />

      {/* Protected Media Viewer (Convex mode) */}
      {viewerMessageId && userId && !isDemo && (
        <ProtectedMediaViewer
          visible={!!viewerMessageId}
          messageId={viewerMessageId}
          userId={userId}
          viewerName={currentUser?.name || otherUserName}
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
      {userId && (
        <ReportModal
          visible={reportModalVisible}
          reporterId={userId}
          reportedUserId={otherUserId || ''}
          chatId={conversationId || ''}
          onClose={() => setReportModalVisible(false)}
        />
      )}

      {/* Block / Report Modal (from header 3-dot menu) */}
      <ReportBlockModal
        visible={showReportBlock}
        onClose={() => setShowReportBlock(false)}
        reportedUserId={otherUserId || ''}
        reportedUserName={otherUserName}
        currentUserId={userId || getDemoUserId()}
        conversationId={conversationId}
        // matchId: For Convex mode, use conversation.matchId. For demo mode, derive from conversation if it's a match.
        matchId={
          isDemo
            ? (!activeConversation.isPreMatch && !activeConversation.isConfessionChat
                ? (otherUserId ? `demo_match_${otherUserId}` : undefined)
                : undefined)
            : activeMatchId
        }
        onBlockSuccess={handleBack}
        onUnmatchSuccess={handleBack}
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
              Invite {otherUserName} to play Truth or Dare?
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
            inviterName={otherUserName}
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
        otherUserName={otherUserName}
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
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
  optimisticStatusRow: {
    alignSelf: 'flex-end' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: -4,
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  optimisticStatusText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  optimisticFailedRow: {
    maxWidth: '82%',
  },
  optimisticFailedText: {
    color: COLORS.error,
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
  headerName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: COLORS.text,
    lineHeight: 20,
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
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 4,
  },
  truthDareLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: COLORS.white,
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
  emptyChat: {
    alignItems: 'center',
    padding: 24,
  },
  emptyChatText: {
    fontSize: 15,
    color: COLORS.textMuted,
    marginTop: 12,
    textAlign: 'center',
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
});
