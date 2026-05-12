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
import { COLORS, FONT_SIZE, SPACING, SIZES, lineHeight, moderateScale } from '@/lib/constants';
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
import { deriveMyRole } from '@/lib/bottleSpin';
import { useIsFocused } from '@react-navigation/native';
import {
  isUserBlocked,
  isExpiredConfessionThread,
  getOtherUserIdFromMeta,
} from '@/lib/threadsIntegrity';
import { preloadVideos } from '@/lib/videoCache';
import { validateFileSize, uploadMediaToConvexWithProgress, UploadError } from '@/lib/uploadUtils';
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

const truthDarePauseByConversation = new Map<string, number>();

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
  isPreMutualConfessionChat?: boolean;
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

// [P1_MEDIA_UPLOAD] Pending media lifecycle states (ported from Phase-2 chat rooms)
type PendingSecureUploadStatus = 'uploading' | 'sending' | 'upload_failed' | 'send_failed';

// Stored alongside a pending message so a retry after send_failed
// can resubmit with the same secure-photo/video options.
type PendingSecureRetryOptions = {
  mediaType: 'photo' | 'video';
  localUri: string;
  timer: number;
  viewingMode: 'tap' | 'hold';
  isMirrored: boolean;
};

type RenderMessage = BaseRenderMessage & {
  isPending?: true;
  optimisticStatus?: 'sending' | 'failed';
  errorMessage?: string;
  // [P1_MEDIA_UPLOAD] progress overlay fields (pending secure media only)
  localUri?: string;
  uploadStatus?: PendingSecureUploadStatus;
  uploadProgress?: number;
  storageId?: string;
  retryOptions?: PendingSecureRetryOptions;
};
type PendingSecureMessage = RenderMessage & {
  type: 'image' | 'video';
  isPending: true;
  localUri: string;
  uploadStatus: PendingSecureUploadStatus;
  uploadProgress: number;
  retryOptions: PendingSecureRetryOptions;
};
type OptimisticTextMessage = RenderMessage & {
  clientMessageId: string;
  type: 'text' | 'template';
  optimisticStatus: 'sending' | 'failed';
};
type CurrentUserSummary = Pick<Doc<'users'>, '_id' | 'name' | 'gender' | 'subscriptionTier'>;
type BottleSpinSessionView = {
  state: 'none' | 'pending' | 'active' | 'cooldown' | 'expired';
  inviterId?: string;
  inviteeId?: string;
  currentTurnRole?: 'inviter' | 'invitee';
  spinTurnRole?: 'inviter' | 'invitee';
  turnPhase?: 'idle' | 'spinning' | 'choosing' | 'complete';
  gameStartedAt?: number;
  acceptedAt?: number;
  lastActionAt?: number;
  cooldownUntil?: number;
  remainingMs?: number;
  endedReason?: 'invite_expired' | 'not_started' | 'timeout';
};

const PHOTO_UPLOAD_COMPRESSION_THRESHOLD_BYTES = 4 * 1024 * 1024;
const PHOTO_UPLOAD_MAX_WIDTH = 1600;
const MAX_MESSAGE_CONTENT_LENGTH = 400;
const SYSTEM_MESSAGE_ROW_RE = /^\[SYSTEM:[a-z_]+\]/i;
const EXPIRED_MEDIA_ROW_HIDE_AFTER_MS = 60_000;

const asConversationId = (value: string): ConversationId => value as ConversationId;
const asMessageId = (value: string): MessageId => value as MessageId;
const asUserId = (value: string): UserId => value as UserId;

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';

const isNonBubbleMessageRow = (message: RenderMessage | undefined | null): boolean => {
  if (!message) return false;
  if (message.type === 'system') return true;
  if (message.type === 'text' && SYSTEM_MESSAGE_ROW_RE.test(message.content)) {
    return true;
  }
  if (
    (message.isProtected || message.mediaId) &&
    message.isExpired &&
    typeof message.expiredAt === 'number' &&
    Date.now() - message.expiredAt > EXPIRED_MEDIA_ROW_HIDE_AFTER_MS
  ) {
    return true;
  }
  return false;
};

const getSafeLogId = (value?: string | null): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(-6) : undefined;

const sanitizeChatDebugPayload = (data: Record<string, unknown>) => {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (typeof value === 'string' && lowerKey.includes('id')) {
      safe[key] = getSafeLogId(value);
    } else if (typeof value === 'string' && (lowerKey.includes('url') || lowerKey.includes('token'))) {
      safe[key] = true;
    } else {
      safe[key] = value;
    }
  }
  return safe;
};

const TEXT_MAX_SCALE = 1.2;
const TEXT_PROPS = { maxFontSizeMultiplier: TEXT_MAX_SCALE } as const;
const HEADER_NAME_SIZE = FONT_SIZE.lg;
const EMPTY_CHAT_TEXT_SIZE = moderateScale(15, 0.4);
// TD-BUTTON-BIGGER: slight bump for a more premium, substantial feel while
// still fitting alongside the 3-dot menu in the header right slot.
const TD_BUTTON_LABEL_SIZE = moderateScale(14, 0.25);
const TD_INVITE_BODY_SIZE = moderateScale(15, 0.4);
const BANNER_TEXT_SIZE = FONT_SIZE.body2;
const LOADING_ICON_SIZE = moderateScale(48, 0.3);
const EMPTY_CHAT_ICON_SIZE = moderateScale(40, 0.3);
const TD_MODAL_ICON_SIZE = moderateScale(28, 0.25);
const HEADER_ICON_SIZE = SIZES.icon.lg;
const TD_ICON_SIZE = moderateScale(18, 0.25);
const BANNER_ICON_SIZE = SIZES.icon.sm;
const STATUS_ICON_SIZE = moderateScale(14, 0.25);
const HEADER_AVATAR_SIZE = SIZES.avatar.md;
const HEADER_PRESENCE_DOT_SIZE = moderateScale(10, 0.25);
const TD_INVITE_MODAL_RADIUS = moderateScale(18, 0.25);
const TD_INVITE_MAX_WIDTH = moderateScale(320, 0.25);

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
      console.warn('[P1ChatHeader] missing otherUserId', { convoRef: getSafeLogId(conversationId) });
    }
  }, [router, conversationId]);

  const { userId, token } = useAuthStore();
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
  // COOLDOWN-ANCHOR-FIX: Snapshot absolute cooldown expiry at press time so
  // the floating toast always shows remaining time even if the backend only
  // populates `remainingMs` (not `cooldownUntil`).
  const cooldownAnchorRef = useRef<number | null>(null);
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
  const logSecure = (action: string, data: Record<string, unknown>) => {
    if (__DEV__) console.log(`[SECURE_SYNC] ${action}`, sanitizeChatDebugPayload(data));
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
    !isDemo && token ? { token } : 'skip'
  ) as CurrentUserSummary | null | undefined;

  // Live typing presence — backend returns `{ isTyping }` for the OTHER participant
  const otherUserTyping = useQuery(
    api.messages.getTypingStatus,
    !isDemo && liveConversationId && userId
      ? { conversationId: liveConversationId, authUserId: userId }
      : 'skip'
  ) as { isTyping?: boolean } | undefined;

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
        isPreMutualConfessionChat: storedMeta.isConfessionChat,
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

  const showExpiredChatAlert = useCallback(() => {
    Alert.alert('Chat Expired', 'This chat has expired and can no longer receive messages.');
  }, []);

  const ensureChatActionAllowed = useCallback(() => {
    if (!isExpiredChat) return true;
    showExpiredChatAlert();
    return false;
  }, [isExpiredChat, showExpiredChatAlert]);

  const showUploadValidationAlert = useCallback((error: unknown, fallback: string) => {
    Alert.alert('Media Unavailable', error instanceof UploadError ? error.message : fallback);
  }, []);

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
  const [viewerPrefetchedLocalUri, setViewerPrefetchedLocalUri] = useState<string | undefined>(undefined);
  const [viewerIsMirrored, setViewerIsMirrored] = useState(false); // VIDEO-MIRROR-FIX: Track mirrored state for viewer
  const [viewerIsHoldMode, setViewerIsHoldMode] = useState(false); // HOLD-MODE-FIX: Track if viewer was opened via hold
  // SECURE_TIMER: Track whether the current user is the sender of the message
  // being viewed. Passed to ProtectedMediaViewer to suppress timer UI + mutations.
  const [viewerIsSender, setViewerIsSender] = useState(false);
  const [demoSecurePhotoId, setDemoSecurePhotoId] = useState<string | null>(null); // Demo mode viewer
  const [demoViewerIsHoldMode, setDemoViewerIsHoldMode] = useState(false); // HOLD-MODE-FIX: Demo mode hold tracking
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [showReportBlock, setShowReportBlock] = useState(false);

  // PARALLEL-SEND-FIX: Support multiple concurrent secure photo/video sends
  // Changed from single object to array to allow back-to-back sends
  const [pendingSecureMessages, setPendingSecureMessages] = useState<PendingSecureMessage[]>([]);
  // [P1_MEDIA_UPLOAD] throttle progress state updates per-pending-message
  const PROGRESS_UPDATE_INTERVAL_MS = 50;
  const lastProgressUpdateAtRef = useRef<Map<string, number>>(new Map());
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
  // TD_PAUSE: when the user cancels the Bottle Spin modal (X / backdrop), we
  // flip this flag so the auto-open effect below will NOT force the modal
  // back open while the user is intentionally away. Cleared the moment the
  // user taps the T/D button again (treated as explicit resume intent).
  const [isTruthDarePaused, setIsTruthDarePaused] = useState(false);
  const [showSpinHint, setShowSpinHint] = useState(false);
  const spinHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpinHintKeyRef = useRef<string | null>(null);

  // Query game session status from backend
  const gameSession = useQuery(
    api.games.getBottleSpinSession,
    !isDemo && conversationId && userId ? { conversationId, authUserId: userId } : 'skip'
  );
  const gameSessionView = gameSession as BottleSpinSessionView | undefined;
  const truthDareLastActionAt = gameSessionView?.lastActionAt;
  const truthDareSpinTurnRole = gameSessionView?.spinTurnRole;
  const truthDareRole = deriveMyRole(gameSession, userId);
  const isTruthDareInviter = truthDareRole === 'inviter';
  const isTruthDareInvitee = truthDareRole === 'invitee';

  // Game session mutations
  const sendInviteMutation = useMutation(api.games.sendBottleSpinInvite);
  const respondToInviteMutation = useMutation(api.games.respondToBottleSpinInvite);
  const endGameMutation = useMutation(api.games.endBottleSpinGame);
  // TD-LIFECYCLE: Mutations for proper session lifecycle (manual start + cleanup)
  const startGameMutation = useMutation(api.games.startBottleSpinGame);
  const cleanupExpiredMutation = useMutation(api.games.cleanupExpiredSession);

  // Get other user's ID for invite
  const truthDareOtherUserId = activeConversation?.otherUser?.id;

  // Track cooldown state for inline UI feedback (instead of Alert spam)
  const [showCooldownMessage, setShowCooldownMessage] = useState(false);
  const [cooldownRemainingMin, setCooldownRemainingMin] = useState(0);
  // COOLDOWN-RETRIGGER-FIX: Bump this counter on every T/D tap during cooldown
  // so repeated taps reliably re-trigger the toast + reset the auto-hide
  // timer. Using `showCooldownMessage` alone fails because React bails out
  // when setState is called with the same value, so a second tap while the
  // toast is already visible would silently do nothing.
  const [cooldownToastNonce, setCooldownToastNonce] = useState(0);
  // COOLDOWN-OVERLAY-FIX-V2: Measure the HEADER directly (always-rendered,
  // stable sibling) instead of relying on KAV.onLayout (unreliable / often 0
  // on Android). The cooldown toast overlay sits at
  //   `insets.top + measuredHeaderHeight (or fallback) + small gap`
  // so it can never be hidden behind the header — regardless of when
  // layout measurements settle.
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState(0);
  // COOLDOWN-LIVE: tick every second so the "Cooldown ends in XXm XXs" banner
  // updates in real-time while gameSession.state === 'cooldown'.
  const [cooldownTick, setCooldownTick] = useState(0);

  // TD-UX: Banner shown to invitee while waiting for inviter to manually start the accepted game
  const [showWaitingForStartToast, setShowWaitingForStartToast] = useState(false);

  // Live typing indicator state (driven by other side's typing presence)
  const [showTypingIndicator, setShowTypingIndicator] = useState(false);

  useEffect(() => {
    if (isDemo) {
      setShowTypingIndicator(false);
      return;
    }
    setShowTypingIndicator(otherUserTyping?.isTyping === true);
  }, [isDemo, otherUserTyping?.isTyping]);

  useEffect(() => {
    if (gameSession?.state !== 'cooldown') {
      cooldownAnchorRef.current = null;
    }
  }, [gameSession?.state]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TD-LIFECYCLE: Watch game session state changes for cross-device sync
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isDemo || !gameSession) return;

    // Auto-close game modal when game is ended/rejected/expired on either device.
    // TD-MESSAGES-FIX: Previously this list included 'none'. That was wrong —
    // 'none' is the IDLE state (no session exists yet) and is exactly the
    // state in which the user opens the invite modal. Because this effect has
    // `showTruthDareInvite` in its deps, calling setShowTruthDareInvite(true)
    // re-fired this effect with state='none', which then slammed the modal
    // back to false the same render tick, making T/D appear completely
    // unresponsive on tap. 'none' must NOT auto-close anything.
    if (gameSession.state === 'cooldown' || gameSession.state === 'expired') {
      if (showTruthDareGame) {
        setShowTruthDareGame(false);
      }
      if (showTruthDareInvite) {
        setShowTruthDareInvite(false);
      }
    }

    // TD-LIFECYCLE: Handle expired session - cleanup and show message
    if (gameSession.state === 'expired' && gameSession.endedReason && userId && conversationId) {
      if (__DEV__) {
        console.log('[TD_END_TRACE] cleanup_expired_session', {
          endedReason: gameSession.endedReason,
          conversationRef: getSafeLogId(conversationId),
          note: 'backend will set cooldownUntil on this path',
        });
      }
      const cooldownUntil = gameSessionView?.cooldownUntil;
      if (typeof cooldownUntil === 'number' && cooldownUntil <= Date.now()) {
        return;
      }
      // Cleanup the expired session in backend
      const expiredReason = gameSession.endedReason as 'invite_expired' | 'not_started' | 'timeout';
      cleanupExpiredMutation({
        authUserId: userId,
        conversationId,
        endedReason: expiredReason,
      })
        .then((result) => {
          if (__DEV__) {
            console.log('[TD_END_TRACE] cooldown_set', {
              via: 'cleanupExpiredSession',
              endedReason: gameSession.endedReason,
            });
          }
          // PHASE-1 T/D CHIP RESTORE: Phase-1 conversations have no canonical
          // backend chip (insertTodSystemMessage targets privateMessages only).
          // When cleanup actually transitioned a session, surface a transient
          // expiry chip via the [SYSTEM:truthdare] marker so the chat reflects
          // the timeout. cleanedCount > 0 mirrors the backend's idempotency
          // guard so retries do not spam duplicate chips.
          const cleanedCount = (result as { cleanedCount?: number } | undefined)?.cleanedCount ?? 0;
          if (cleanedCount > 0) {
            const expiryCopy =
              expiredReason === 'invite_expired'
                ? 'Game invite expired'
                : 'Game ended due to inactivity';
            sendMessage({
              conversationId: asConversationId(conversationId),
              authUserId: userId,
              content: `[SYSTEM:truthdare]${expiryCopy}`,
              type: 'text',
            }).catch((chipErr) => {
              if (__DEV__) console.warn('[TD_SYSTEM_MSG] expiry_chip_failed', chipErr);
            });
          }
        })
        .catch((err) => {
          if (__DEV__) console.warn('[TD_END_TRACE] cleanup_expired_failed', err);
        });
    }

    // TD-LIFECYCLE: Close invite modal when game becomes active
    // Do NOT auto-open game modal - inviter must manually start via T/D button
    if (gameSession.state === 'active') {
      if (showTruthDareInvite) {
        setShowTruthDareInvite(false);
        // DO NOT open game modal - inviter must click T/D button to start
      }
    }

    // TD-UX: Show "waiting for inviter to start" banner to invitee while accepted-but-not-started
    const isInviteeWaitingForStart =
      gameSession.state === 'active' &&
      !gameSession.gameStartedAt &&
      isTruthDareInvitee;
    setShowWaitingForStartToast(isInviteeWaitingForStart);

    // Clear cooldown message when cooldown expires
    if (gameSession.state !== 'cooldown') {
      setShowCooldownMessage(false);
    }
  }, [isDemo, gameSession?.state, gameSession?.endedReason, gameSession?.gameStartedAt, isTruthDareInvitee, showTruthDareGame, showTruthDareInvite, userId, conversationId, cleanupExpiredMutation, sendMessage]);

  useEffect(() => {
    return () => {
      if (spinHintTimerRef.current) {
        clearTimeout(spinHintTimerRef.current);
        spinHintTimerRef.current = null;
      }
    };
  }, []);

  // TD_HINT: Phase-1 Messages nudge when the round is idle and it is my spin.
  useEffect(() => {
    if (isDemo) return;
    if (!gameSession || !userId) return;
    if (gameSession.state !== 'active') return;
    if (gameSession.turnPhase !== 'idle') return;
    if (!gameSession.gameStartedAt) return;
    if (showTruthDareGame) return;
    if (isTruthDarePaused) return;

    const myRole = deriveMyRole(gameSession, userId);
    const spinTurnRole = truthDareSpinTurnRole || 'inviter';
    if (!myRole || spinTurnRole !== myRole) return;

    const hintKey = `${spinTurnRole}:${truthDareLastActionAt}`;
    if (lastSpinHintKeyRef.current === hintKey) return;
    lastSpinHintKeyRef.current = hintKey;

    if (spinHintTimerRef.current) {
      clearTimeout(spinHintTimerRef.current);
    }

    setShowSpinHint(true);
    if (__DEV__) {
      console.log('[TD_HINT] my_spin_turn_show', {
        conversationRef: getSafeLogId(conversationId),
        spinTurnRole,
        lastActionAt: truthDareLastActionAt,
      });
    }

    spinHintTimerRef.current = setTimeout(() => {
      setShowSpinHint(false);
      spinHintTimerRef.current = null;
    }, 3000);
  }, [
    isDemo,
    gameSession?.state,
    gameSession?.turnPhase,
    gameSession?.gameStartedAt,
    truthDareSpinTurnRole,
    truthDareLastActionAt,
    userId,
    conversationId,
    showTruthDareGame,
    isTruthDarePaused,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-OPEN MODAL WHEN IT'S MY TURN TO CHOOSE
  // This is the critical fix: when backend says it's my turn (choosing phase),
  // automatically open the game modal so I can see Truth/Dare/Skip buttons.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isDemo || !gameSession || !userId) return;

    const pausedAt = truthDarePauseByConversation.get(conversationId);
    const lastActionAt = truthDareLastActionAt || gameSession?.gameStartedAt || 0;
    if (pausedAt && lastActionAt && lastActionAt > pausedAt) {
      truthDarePauseByConversation.delete(conversationId);
      setIsTruthDarePaused(false);
      if (__DEV__) {
        console.log('[TD_PAUSE] pause_cleared_new_action', {
          conversationRef: getSafeLogId(conversationId),
          pausedAt,
          lastActionAt,
        });
      }
    }

    // Only care about active games in choosing phase
    if (gameSession.state !== 'active') return;
    // TD-LIFECYCLE: Do NOT auto-open until inviter has manually started the game
    if (!gameSession.gameStartedAt) return;
    if (gameSession.turnPhase !== 'choosing') return;
    if (!gameSession.currentTurnRole) return;

    const myRole = deriveMyRole(gameSession, userId);

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
      if (pausedAt && pausedAt > lastActionAt) {
        if (__DEV__) {
          console.log('[TD_PAUSE] pause_persisted_until_new_action', {
            conversationRef: getSafeLogId(conversationId),
            pausedAt,
            lastActionAt,
          });
        }
        return;
      }
      // TD_PAUSE: respect an explicit user cancel — do NOT force the modal
      // back open until the user taps the T/D button again (which clears the
      // paused flag). Backend game state is intentionally unchanged here.
      if (isTruthDarePaused) {
        if (__DEV__) {
          console.log('[TD_PAUSE] skip_auto_open', {
            turnPhase: gameSession.turnPhase,
            currentTurnRole: gameSession.currentTurnRole,
            myRole,
          });
        }
        return;
      }
      if (__DEV__) {
        console.log('[BOTTLE_SPIN_AUTO_OPEN] Opening modal - it is my turn to choose!');
      }
      setShowTruthDareGame(true);
    }
  }, [isDemo, gameSession?.state, gameSession?.turnPhase, gameSession?.currentTurnRole, gameSession?.inviterId, gameSession?.inviteeId, gameSession?.gameStartedAt, truthDareLastActionAt, conversationId, userId, showTruthDareGame, isTruthDarePaused]);

  // TD-LIFECYCLE: Handle T/D button press with manual start support
  const handleTruthDarePress = useCallback(async () => {
    if (__DEV__) {
      console.log('[TD_MESSAGES][button_press]', {
        isDemo,
        hasUserId: !!userId,
        hasConversationId: !!conversationId,
        sessionLoaded: gameSession !== undefined,
        sessionState: gameSession?.state,
      });
    }

    if (showSpinHint) {
      setShowSpinHint(false);
      if (spinHintTimerRef.current) {
        clearTimeout(spinHintTimerRef.current);
        spinHintTimerRef.current = null;
      }
    }

    // TD_RESUME: tapping the T/D button is explicit user intent to re-enter
    // the game. Clear the paused flag so the auto-open effect (and the normal
    // open paths below) can surface the current backend phase without the
    // pause gate blocking them. Log the phase we are resuming from so device
    // verification can correlate with the previous [TD_PAUSE] entry.
    if (isTruthDarePaused) {
      if (__DEV__) {
        console.log('[TD_RESUME] reopening_from_phase', {
          turnPhase: gameSession?.turnPhase,
          currentTurnRole: gameSession?.currentTurnRole,
          state: gameSession?.state,
        });
      }
      setIsTruthDarePaused(false);
    }

    if (!ensureChatActionAllowed()) {
      return;
    }

    if (isDemo) {
      // Demo mode: skip invite flow, go directly to game
      setShowTruthDareGame(true);
      return;
    }

    if (!userId || !conversationId) {
      if (__DEV__) {
        console.log('[TD_MESSAGES][guard_blocked]', {
          reason: !userId ? 'missing_userId' : 'missing_conversationId',
        });
      }
      return;
    }

    if (__DEV__) {
      console.log('[TD_MESSAGES][handler_start]', { state: gameSession?.state ?? 'loading' });
    }

    // TD-MESSAGES-FIX: When the Convex session query is still loading
    // (gameSession === undefined), previously the handler bailed silently and
    // the T/D button appeared dead. Treat "loading" the same as "no session
    // yet" so the invite modal opens; the backend mutation still enforces
    // cooldown / active / pending rules.
    if (!gameSession) {
      if (__DEV__) {
        console.log('[TD_MESSAGES][open_modal] session_still_loading → open invite');
      }
      setShowTruthDareInvite(true);
      return;
    }

    // Priority 1: Cooldown active - show inline message instead of Alert
    if (gameSession.state === 'cooldown') {
      const remainingMs = gameSessionView?.remainingMs || 0;
      if (remainingMs <= 0) {
        cooldownAnchorRef.current = null;
        setShowCooldownMessage(false);
      } else {
        const cooldownUntil = gameSessionView?.cooldownUntil;
        // COOLDOWN-ANCHOR-FIX: capture absolute expiry at press time so the
        // floating toast can countdown even when only `remainingMs` is present.
        const anchor = typeof cooldownUntil === 'number' && cooldownUntil > 0
          ? cooldownUntil
          : Date.now() + remainingMs;
        cooldownAnchorRef.current = anchor;
        const remainingMin = Math.ceil(remainingMs / 60000);
        if (__DEV__) {
          console.log('[TD_COOLDOWN_TAP]', {
            anchor,
            remainingMs,
            remainingMin,
            cooldownUntil,
          });
        }
        setCooldownRemainingMin(remainingMin);
        setShowCooldownMessage(true);
        // COOLDOWN-RETRIGGER-FIX: Bump nonce to guarantee the auto-hide useEffect
        // re-runs (and resets its timer) on every tap — even when the toast is
        // already visible from a previous tap.
        setCooldownToastNonce((n) => n + 1);
        return;
      }
    }

    // Priority 2: Expired session - handled by useEffect cleanup, no-op here
    if (gameSession.state === 'expired') {
      return;
    }

    // Priority 3: Active game exists
    if (gameSession.state === 'active') {
      const myRole = deriveMyRole(gameSession, userId);
      const isInviter = myRole === 'inviter';
      const hasGameStarted = !!gameSession.gameStartedAt;

      // TD-LIFECYCLE: If game not started yet, handle based on role
      if (!hasGameStarted) {
        if (isInviter) {
          // Inviter: Start the game manually
          try {
            const result = await startGameMutation({
              authUserId: userId,
              conversationId,
            });
            if (result.success) {
              // PHASE-1 T/D CHIP RESTORE: emit transient "Game started" chip
              // for Phase-1 conversations only on the first successful start
              // (skip on idempotent retries where alreadyStarted === true).
              // Phase-2 backend writes its own chip via insertTodSystemMessage.
              if (!('alreadyStarted' in result) || result.alreadyStarted !== true) {
                sendMessage({
                  conversationId: asConversationId(conversationId),
                  authUserId: userId,
                  content: '[SYSTEM:truthdare]Game started',
                  type: 'text',
                }).catch((chipErr) => {
                  if (__DEV__) console.warn('[TD_SYSTEM_MSG] start_chip_failed', chipErr);
                });
              }
              setShowTruthDareGame(true);
            }
          } catch (err) {
            if (__DEV__) console.warn('[TD_MANUAL_START] Error starting game:', err);
          }
        } else {
          // Invitee: game accepted but inviter hasn't started yet - no-op,
          // wait for inviter to manually start the game.
        }
        return;
      }

      const turnPhase = gameSession.turnPhase ?? 'idle';
      const spinTurnRole = gameSession.spinTurnRole || 'inviter';

      if (turnPhase === 'idle') {
        if (myRole && spinTurnRole === myRole) {
          setShowTruthDareGame(true);
        }
        return;
      }

      if (turnPhase === 'choosing') {
        if (myRole && gameSession.currentTurnRole === myRole) {
          setShowTruthDareGame(true);
        }
        return;
      }

      return;
    }

    // Priority 4: Pending invite exists - no action (button is disabled or visual feedback)
    if (gameSession.state === 'pending') {
      // Invitee sees the invite card below chat
      // Inviter sees "Waiting..." indicator - no action needed
      return;
    }

    // Priority 5: No game - show invite modal
    if (__DEV__) {
      console.log('[TD_MESSAGES][open_modal] state_none_open_invite');
    }
    setShowTruthDareInvite(true);
  }, [isDemo, gameSession, userId, conversationId, startGameMutation, isTruthDarePaused, showSpinHint, ensureChatActionAllowed, sendMessage]);

  // Send game invite
  const handleSendInvite = useCallback(async () => {
    if (!ensureChatActionAllowed()) return;
    if (!userId || !conversationId || !truthDareOtherUserId) {
      if (__DEV__) {
        console.log('[TD_MESSAGES][guard_blocked] handleSendInvite', {
          hasUserId: !!userId,
          hasConversationId: !!conversationId,
          hasOtherUserId: !!truthDareOtherUserId,
        });
      }
      // TD-MESSAGES-FIX: Surface the problem instead of dying silently, so the
      // "Invite" button never appears dead when profile data is slow to load.
      Alert.alert('Please wait', 'Still loading chat details — try again in a moment.');
      return;
    }

    try {
      if (__DEV__) console.log('[TD_MESSAGES][mutation_start] sendBottleSpinInvite');
      await sendInviteMutation({
        authUserId: userId,
        conversationId,
        otherUserId: String(truthDareOtherUserId),
      });
      if (__DEV__) console.log('[TD_MESSAGES][mutation_success] sendBottleSpinInvite');
      setShowTruthDareInvite(false);
    } catch (error) {
      if (__DEV__) console.warn('[TD_MESSAGES][mutation_error] sendBottleSpinInvite', error);
      Alert.alert('Error', getErrorMessage(error, 'Failed to send invite'));
    }
  }, [userId, conversationId, truthDareOtherUserId, sendInviteMutation, ensureChatActionAllowed]);

  // Respond to game invite
  const handleRespondToInvite = useCallback(async (accept: boolean) => {
    if (!userId || !conversationId) return;
    if (!ensureChatActionAllowed()) return;

    try {
      await respondToInviteMutation({
        authUserId: userId,
        conversationId,
        accept,
      });
      // PHASE-1 T/D CHIP RESTORE: Phase-1 conversations have no canonical
      // backend chip, so emit a transient accept/decline chip here. The
      // popup-after-accept fix is preserved — this only writes a chat chip
      // and never opens the game modal.
      const responderName = currentUser?.name || 'Someone';
      const responseText = accept
        ? `${responderName} accepted the invite`
        : `${responderName} declined the invite`;
      sendMessage({
        conversationId: asConversationId(conversationId),
        authUserId: userId,
        content: `[SYSTEM:truthdare]${responseText}`,
        type: 'text',
      }).catch((chipErr) => {
        if (__DEV__) console.warn('[TD_SYSTEM_MSG] respond_chip_failed', chipErr);
      });
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error, 'Failed to respond to invite'));
    }
  }, [userId, conversationId, respondToInviteMutation, ensureChatActionAllowed, sendMessage, currentUser?.name]);

  // End game (called from BottleSpinGame)
  // TD_END_TRACE: centralised instrumentation so any future accidental
  // cooldown trigger is immediately attributable from the device log.
  const handleEndGame = useCallback(async () => {
    if (__DEV__) {
      console.log('[TD_END_TRACE] end_game_called', {
        isDemo,
        hasUserId: !!userId,
        hasConversationId: !!conversationId,
        caller: 'handleEndGame',
      });
    }
    if (isDemo) return; // Demo mode doesn't track game sessions

    if (!userId || !conversationId) return;

    try {
      await endGameMutation({
        authUserId: userId,
        conversationId,
      });
      if (__DEV__) {
        console.log('[TD_END_TRACE] cooldown_set', {
          via: 'endBottleSpinGame',
          conversationRef: getSafeLogId(conversationId),
        });
      }
    } catch (error) {
      // Silent fail - UI will close anyway
      if (__DEV__) {
        console.warn('[TD_END_TRACE] end_game_failed', error);
      }
    }
  }, [isDemo, userId, conversationId, endGameMutation]);

  // Handler for BottleSpinGame result callbacks. BottleSpinGame composes the
  // user-facing string ("X chose TRUTH", "X skipped their turn", "X ended the
  // game"). For Phase-1 conversations the backend insertTodSystemMessage
  // helper silently no-ops (it targets privateMessages only), so we re-emit
  // the chip here via the [SYSTEM:...] marker. Permanent chips
  // ([SYSTEM:tod_perm]) for "chose TRUTH/DARE" so the transcript records the
  // choice; transient chips ([SYSTEM:truthdare]) for "skipped"/"ended" so the
  // chat does not accumulate noisy history.
  const handleSendTruthDareResult = useCallback(async (message: string) => {
    if (!conversationId) return;
    if (!ensureChatActionAllowed()) return;

    // TD_END_TRACE: tighten "ended the game" detection. The previous
    // `message.includes('ended the game')` was a substring match and would
    // fire for any future message that happens to contain that phrase.
    // Switch to an exact suffix match against the deliberate format produced
    // by handleEndGameConfirm (`${currentUserName} ended the game`) so only
    // an explicit End Game confirmation triggers the backend mutation.
    const isEndGameSystemMessage = /^[^\s].* ended the game$/.test(message);
    if (isEndGameSystemMessage) {
      if (__DEV__) {
        console.log('[TD_END_TRACE] end_game_message_detected', { messageKind: 'end_game' });
      }
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
        // PHASE-1 T/D CHIP RESTORE: classify result strings produced by
        // BottleSpinGame so the transcript shows compact chips. "chose
        // TRUTH"/"chose DARE" stay permanent (tod_perm); "skipped"/"ended"
        // are transient (truthdare → 1 min after readAt, 3 min hard cap via
        // MessageBubble's marker auto-hide).
        const isPermanentResult = / chose (TRUTH|DARE)$/.test(message);
        const subtype = isPermanentResult ? 'tod_perm' : 'truthdare';
        await sendMessage({
          conversationId: asConversationId(conversationId),
          authUserId: userId,
          content: `[SYSTEM:${subtype}]${message}`,
          type: 'text',
        });
      }
    } catch (chipErr) {
      // Silent fail - game continues even if chip insertion fails
      if (__DEV__) console.warn('[TD_SYSTEM_MSG] result_chip_failed', chipErr);
    }
  }, [conversationId, isDemo, userId, addDemoMessage, handleEndGame, ensureChatActionAllowed, sendMessage]);

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

  // COOLDOWN-LIVE: 1-second tick while in T/D cooldown so the banner countdown
  // updates in real-time. Stops when not in cooldown to save renders.
  useEffect(() => {
    if (isDemo) return;
    if (gameSessionView?.state !== 'cooldown') return;
    const id = setInterval(() => setCooldownTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isDemo, gameSessionView?.state]);

  // COOLDOWN-TOAST-AUTOHIDE: Each tap bumps `cooldownToastNonce`, which
  // re-runs this effect and resets the 3.5s auto-hide timer. This guarantees
  // repeated taps during cooldown always show the toast for a fresh window,
  // even if it was already visible from a previous tap.
  useEffect(() => {
    if (cooldownToastNonce === 0) return;
    if (!showCooldownMessage) return;
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setShowCooldownMessage(false);
      }
    }, 3500);
    return () => clearTimeout(timer);
  }, [cooldownToastNonce, showCooldownMessage]);

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
      if (!ensureChatActionAllowed()) return;
      const validateCapturedMedia = async () => {
        try {
          await validateFileSize(capturedMedia.uri, capturedMedia.type);
          if (!mountedRef.current) return;
          // Set pending media to trigger secure photo sheet
          setPendingImageUri(capturedMedia.uri);
          setPendingMediaType(capturedMedia.type);
          setPendingIsMirrored(capturedMedia.isMirrored === true); // Track front-camera video mirroring
        } catch (error) {
          showUploadValidationAlert(error, 'This media cannot be sent. Please choose a smaller file.');
        }
      };
      void validateCapturedMedia();
    }
  }, [isFocused, conversationId, ensureChatActionAllowed, showUploadValidationAlert]);

  const submitOptimisticTextMessage = useCallback(async (message: OptimisticTextMessage) => {
    if (!activeConversation || !userId) return false;
    if (isSendingRef.current) return false;
    if (!ensureChatActionAllowed()) {
      updateOptimisticTextMessage(message.clientMessageId, (current) => ({
        ...current,
        optimisticStatus: 'failed',
        errorMessage: 'This chat has expired.',
      }));
      return false;
    }
    if (message.content.trim().length > MAX_MESSAGE_CONTENT_LENGTH) {
      updateOptimisticTextMessage(message.clientMessageId, (current) => ({
        ...current,
        optimisticStatus: 'failed',
        errorMessage: 'Message is too long.',
      }));
      Alert.alert('Message Too Long', 'Message is too long.');
      return false;
    }

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
    ensureChatActionAllowed,
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
    const normalizedText = text.trim();

    if (!ensureChatActionAllowed()) {
      return;
    }
    if (normalizedText.length > MAX_MESSAGE_CONTENT_LENGTH) {
      Alert.alert('Message Too Long', 'Message is too long.');
      return;
    }

    if (isDemo) {
      // C9 fix: use unique ID to prevent collision on rapid sends
      const uniqueId = `dm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      addDemoMessage(conversationId, {
        _id: uniqueId,
        content: normalizedText,
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
      content: normalizedText,
      createdAt: now,
      optimisticStatus: 'sending',
    };

    addOptimisticTextMessage(optimisticMessage);
    await submitOptimisticTextMessage(optimisticMessage);
  };

  // Voice message sending - supports both demo and production
  const handleSendVoice = useCallback(async (audioUri: string, durationMs: number) => {
    if (!activeConversation || !conversationId) return;
    if (!ensureChatActionAllowed()) return;

    try {
      await validateFileSize(audioUri, 'audio');
    } catch (error) {
      showUploadValidationAlert(error, 'Voice message is too large to send.');
      return;
    }

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
    ensureChatActionAllowed,
    generateUploadUrl,
    releaseAbortController,
    sendMessage,
    showUploadValidationAlert,
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
    if (!ensureChatActionAllowed()) return;

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
  }, [activeConversation, conversationId, ensureChatActionAllowed, router, showPermissionSettingsAlert]);

  // Gallery handler: launch system gallery picker for photos and videos
  const handleSendGallery = useCallback(async () => {
    if (!activeConversation) return;
    if (!ensureChatActionAllowed()) return;

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

      try {
        await validateFileSize(asset.uri, isVideo ? 'video' : 'photo');
      } catch (error) {
        showUploadValidationAlert(error, 'This media cannot be sent. Please choose a smaller file.');
        return;
      }

      setPendingIsMirrored(false);
      setPendingImageUri(asset.uri);
      setPendingMediaType(isVideo ? 'video' : 'photo');
    }
  }, [activeConversation, ensureChatActionAllowed, showPermissionSettingsAlert, showUploadValidationAlert]);

  const handleSecurePhotoConfirm = async (imageUri: string, options: CameraPhotoOptions) => {
    if (!userId || !conversationId) return;
    if (!ensureChatActionAllowed()) return;

    const isVideo = pendingMediaType === 'video';
    const isMirrored = pendingIsMirrored; // Capture before clearing
    try {
      await validateFileSize(imageUri, isVideo ? 'video' : 'photo');
    } catch (error) {
      showUploadValidationAlert(error, 'This media cannot be sent. Please choose a smaller file.');
      return;
    }
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
      // [P1_MEDIA_UPLOAD] Insert optimistic placeholder with local preview
      // so the bubble appears instantly with progress %.
      // VIDEO-FIX: Use correct type for video
      if (!liveConversationId) {
        throw new Error('Conversation unavailable');
      }
      pendingId = `pending_secure_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const mediaType = isVideo ? 'video' : 'photo';
      const retryOptions: PendingSecureRetryOptions = {
        mediaType,
        localUri: imageUri,
        timer: options.timer,
        viewingMode: options.viewingMode,
        isMirrored: isVideo && isMirrored,
      };
      addPendingSecureMessage({
        _id: pendingId,
        senderId: userId,
        type: isVideo ? 'video' : 'image',
        content: isVideo ? 'Uploading secure video...' : 'Uploading secure photo...',
        createdAt: Date.now(),
        isPending: true,
        localUri: imageUri,
        uploadStatus: 'uploading',
        uploadProgress: 0,
        retryOptions,
      });
      if (__DEV__) {
        console.log('[P1_MEDIA_UPLOAD] optimistic_insert', {
          pendingRef: getSafeLogId(pendingId),
          mediaType,
          timer: options.timer,
          viewMode: options.viewingMode,
        });
      }

      // Optimize photo before upload (video goes straight through)
      const preparedAsset = await prepareSecureUploadAsset(imageUri, mediaType);
      cleanupUploadUri = preparedAsset.cleanupUri;

      // 1+2. Upload with real progress via FileSystem.createUploadTask
      const storageId = await uploadMediaToConvexWithProgress(
        preparedAsset.uploadUri,
        async () => await generateUploadUrl(),
        mediaType,
        (pct) => {
          if (!mountedRef.current) return;
          const now = Date.now();
          const last = lastProgressUpdateAtRef.current.get(pendingId) ?? 0;
          // Always let 0% and 100% through; throttle intermediate updates.
          if (pct > 0 && pct < 100 && now - last < PROGRESS_UPDATE_INTERVAL_MS) return;
          lastProgressUpdateAtRef.current.set(pendingId, now);
          updatePendingSecureMessage(pendingId, (m) => ({
            ...m,
            uploadProgress: pct,
          }));
          if (__DEV__ && (pct === 0 || pct === 100 || Math.floor(pct) % 10 === 0)) {
            console.log('[P1_MEDIA_UPLOAD] progress', {
              pendingRef: getSafeLogId(pendingId),
              pct: Math.round(pct),
            });
          }
        }
      );
      lastProgressUpdateAtRef.current.delete(pendingId);

      // Upload succeeded — transition to 'sending' while we commit the message.
      updatePendingSecureMessage(pendingId, (m) => ({
        ...m,
        uploadStatus: 'sending',
        uploadProgress: 100,
        storageId: storageId as unknown as string,
        content: isVideo ? 'Finalizing secure video...' : 'Finalizing secure photo...',
      }));

      // 3. Send protected media message
      // MSG-003 FIX: Use authUserId for server-side verification
      // HOLD-TAP-FIX: Pass viewMode to backend for consistent rendering
      // VIDEO-FIX: Pass mediaType to distinguish photo vs video
      // VIDEO-MIRROR-FIX: Pass isMirrored for front-camera video correction
      await sendProtectedImage({
        conversationId: liveConversationId,
        authUserId: userId,
        imageStorageId: storageId,
        timer: options.timer,
        screenshotAllowed: false,
        viewOnce: options.timer === 0,
        watermark: false,
        viewMode: options.viewingMode,
        mediaType: isVideo ? 'video' : 'image',
        isMirrored: isVideo && isMirrored,
      });
      if (__DEV__) {
        console.log('[P1_MEDIA_UPLOAD] success', { pendingRef: getSafeLogId(pendingId) });
        console.log('[P1_MEDIA_UPLOAD] replace_optimistic', { pendingRef: getSafeLogId(pendingId) });
      }
      removePendingSecureMessage(pendingId);
    } catch (error) {
      // [P1_MEDIA_UPLOAD] Keep pending message visible with retry UI.
      // Distinguish upload_failed (retry must re-upload) vs send_failed
      // (retry can reuse the already-uploaded storageId).
      if (pendingId && mountedRef.current) {
        const isUploadError = error instanceof UploadError;
        // If we got a storageId already, the failure is in sendProtectedImage,
        // i.e. a send_failed; otherwise it's an upload_failed.
        setPendingSecureMessages((prev) =>
          prev.map((m) => {
            if (m._id !== pendingId) return m;
            const alreadyUploaded = !!m.storageId;
            const nextStatus: PendingSecureUploadStatus = alreadyUploaded
              ? 'send_failed'
              : 'upload_failed';
            if (__DEV__) {
              console.log('[P1_MEDIA_UPLOAD] failed', {
                pendingRef: getSafeLogId(pendingId),
                nextStatus,
                uploadErrorType: isUploadError ? (error as UploadError).type : undefined,
                errorMessage: getErrorMessage(error, 'Failed'),
              });
            }
            return {
              ...m,
              uploadStatus: nextStatus,
              errorMessage: getErrorMessage(
                error,
                alreadyUploaded ? 'Failed to send.' : 'Upload failed.'
              ),
            };
          })
        );
      }
      // For file-too-large / invalid-file, show a one-time alert so the user
      // knows why it failed; the bubble itself shows "Tap to retry".
      if (error instanceof UploadError && !error.retryable && mountedRef.current) {
        Alert.alert('Error', error.message);
      } else if (!isAbortError(error) && __DEV__) {
        console.warn('[P1_MEDIA_UPLOAD] error', error);
      }
    } finally {
      if (pendingId) lastProgressUpdateAtRef.current.delete(pendingId);
      if (readController) {
        releaseAbortController(readController);
      }
      if (uploadController) {
        releaseAbortController(uploadController);
      }
      if (cleanupUploadUri) {
        FileSystem.deleteAsync(cleanupUploadUri, { idempotent: true }).catch(() => {});
      }
    }
  };

  // [P1_MEDIA_UPLOAD] Retry a failed pending secure message.
  // - upload_failed  → re-run the full upload + send with the stored retryOptions
  // - send_failed    → re-run only sendProtectedImage with the stored storageId
  const retryingPendingIdsRef = useRef<Set<string>>(new Set());
  const handleRetrySecurePhotoMessage = useCallback(async (pendingId: string) => {
    if (!userId || !liveConversationId) return;
    if (retryingPendingIdsRef.current.has(pendingId)) return;
    retryingPendingIdsRef.current.add(pendingId);

    const pending = pendingSecureMessages.find((m) => m._id === pendingId);
    if (!pending) {
      retryingPendingIdsRef.current.delete(pendingId);
      return;
    }
    const { retryOptions } = pending;
    const isVideoRetry = retryOptions.mediaType === 'video';

    // send_failed → we already have a storageId; just resend.
    if (pending.uploadStatus === 'send_failed' && pending.storageId) {
      updatePendingSecureMessage(pendingId, (m) => ({
        ...m,
        uploadStatus: 'sending',
        errorMessage: undefined,
        content: isVideoRetry ? 'Finalizing secure video...' : 'Finalizing secure photo...',
      }));
      try {
        await sendProtectedImage({
          conversationId: liveConversationId,
          authUserId: userId,
          imageStorageId: pending.storageId as Id<'_storage'>,
          timer: retryOptions.timer,
          screenshotAllowed: false,
          viewOnce: retryOptions.timer === 0,
          watermark: false,
          viewMode: retryOptions.viewingMode,
          mediaType: isVideoRetry ? 'video' : 'image',
          isMirrored: retryOptions.isMirrored,
        });
        if (__DEV__) {
          console.log('[P1_MEDIA_UPLOAD] success', { pendingRef: getSafeLogId(pendingId), via: 'retry_send_failed' });
          console.log('[P1_MEDIA_UPLOAD] replace_optimistic', { pendingRef: getSafeLogId(pendingId) });
        }
        removePendingSecureMessage(pendingId);
      } catch (error) {
        if (__DEV__) {
          console.log('[P1_MEDIA_UPLOAD] failed', {
            pendingRef: getSafeLogId(pendingId),
            nextStatus: 'send_failed',
            via: 'retry_send_failed',
            errorMessage: getErrorMessage(error, 'Failed'),
          });
        }
        if (mountedRef.current) {
          updatePendingSecureMessage(pendingId, (m) => ({
            ...m,
            uploadStatus: 'send_failed',
            errorMessage: getErrorMessage(error, 'Failed to send.'),
          }));
        }
      } finally {
        retryingPendingIdsRef.current.delete(pendingId);
      }
      return;
    }

    // upload_failed (or any other state) → full re-upload + resend.
    let cleanupUri: string | null = null;
    updatePendingSecureMessage(pendingId, (m) => ({
      ...m,
      uploadStatus: 'uploading',
      uploadProgress: 0,
      errorMessage: undefined,
      storageId: undefined,
      content: isVideoRetry ? 'Uploading secure video...' : 'Uploading secure photo...',
    }));
    try {
      const preparedAsset = await prepareSecureUploadAsset(
        retryOptions.localUri,
        retryOptions.mediaType
      );
      cleanupUri = preparedAsset.cleanupUri;
      const storageId = await uploadMediaToConvexWithProgress(
        preparedAsset.uploadUri,
        async () => await generateUploadUrl(),
        retryOptions.mediaType,
        (pct) => {
          if (!mountedRef.current) return;
          const now = Date.now();
          const last = lastProgressUpdateAtRef.current.get(pendingId) ?? 0;
          if (pct > 0 && pct < 100 && now - last < PROGRESS_UPDATE_INTERVAL_MS) return;
          lastProgressUpdateAtRef.current.set(pendingId, now);
          updatePendingSecureMessage(pendingId, (m) => ({ ...m, uploadProgress: pct }));
        }
      );
      lastProgressUpdateAtRef.current.delete(pendingId);

      updatePendingSecureMessage(pendingId, (m) => ({
        ...m,
        uploadStatus: 'sending',
        uploadProgress: 100,
        storageId: storageId as unknown as string,
        content: isVideoRetry ? 'Finalizing secure video...' : 'Finalizing secure photo...',
      }));
      await sendProtectedImage({
        conversationId: liveConversationId,
        authUserId: userId,
        imageStorageId: storageId,
        timer: retryOptions.timer,
        screenshotAllowed: false,
        viewOnce: retryOptions.timer === 0,
        watermark: false,
        viewMode: retryOptions.viewingMode,
        mediaType: isVideoRetry ? 'video' : 'image',
        isMirrored: retryOptions.isMirrored,
      });
      if (__DEV__) {
        console.log('[P1_MEDIA_UPLOAD] success', { pendingRef: getSafeLogId(pendingId), via: 'retry_upload_failed' });
        console.log('[P1_MEDIA_UPLOAD] replace_optimistic', { pendingRef: getSafeLogId(pendingId) });
      }
      removePendingSecureMessage(pendingId);
    } catch (error) {
      if (mountedRef.current) {
        setPendingSecureMessages((prev) =>
          prev.map((m) => {
            if (m._id !== pendingId) return m;
            const alreadyUploaded = !!m.storageId;
            const nextStatus: PendingSecureUploadStatus = alreadyUploaded
              ? 'send_failed'
              : 'upload_failed';
            if (__DEV__) {
              console.log('[P1_MEDIA_UPLOAD] failed', {
                pendingRef: getSafeLogId(pendingId),
                nextStatus,
                via: 'retry_upload_failed',
                errorMessage: getErrorMessage(error, 'Failed'),
              });
            }
            return {
              ...m,
              uploadStatus: nextStatus,
              errorMessage: getErrorMessage(
                error,
                alreadyUploaded ? 'Failed to send.' : 'Upload failed.'
              ),
            };
          })
        );
      }
    } finally {
      lastProgressUpdateAtRef.current.delete(pendingId);
      if (cleanupUri) {
        FileSystem.deleteAsync(cleanupUri, { idempotent: true }).catch(() => {});
      }
      retryingPendingIdsRef.current.delete(pendingId);
    }
  }, [
    userId,
    liveConversationId,
    pendingSecureMessages,
    prepareSecureUploadAsset,
    generateUploadUrl,
    sendProtectedImage,
    updatePendingSecureMessage,
    removePendingSecureMessage,
  ]);

  const findDisplayMessageById = useCallback(
    (messageId: string) => displayMessages.find((message) => message._id === messageId),
    [displayMessages]
  );

  const handleProtectedMediaPress = (messageId: string, localUri?: string) => {
    if (isDemo) {
      // Demo mode: use Phase2ProtectedMediaViewer (reads from privateChatStore)
      setDemoViewerIsHoldMode(false); // HOLD-MODE-FIX: Tap mode
      setDemoSecurePhotoId(messageId);
    } else {
      // Convex mode: use ProtectedMediaViewer
      // VIDEO-MIRROR-FIX: Look up message to get isMirrored state
      const msg = findDisplayMessageById(messageId);
      const isMirrored = msg?.protectedMedia?.isMirrored === true;
      // SECURE_TIMER: determine if current user sent this message. When true,
      // the viewer suppresses the countdown and all consuming mutations.
      const isSender = !!(msg?.senderId && userId && msg.senderId === userId);
      if (__DEV__) console.log('[SECURE_TIMER] viewer_open', {
        messageRef: getSafeLogId(messageId),
        hasCurrentUser: !!userId,
        senderRef: getSafeLogId(msg?.senderId ?? null),
        isSender,
        trigger: 'tap',
      });
      setViewerIsMirrored(isMirrored);
      setViewerIsSender(isSender);
      setViewerIsHoldMode(false); // HOLD-MODE-FIX: Tap mode
      setViewerPrefetchedLocalUri(localUri);
      setViewerMessageId(messageId);
    }
  };

  // HOLD-MODE-FIX: Hold mode works for both demo and Convex
  // Hold mode: press in => open viewer
  const handleProtectedMediaHoldStart = (messageId: string, localUri?: string) => {
    if (isDemo) {
      logSecure('holdStart', { messageId });
      setDemoViewerIsHoldMode(true); // HOLD-MODE-FIX: Hold mode
      setDemoSecurePhotoId(messageId);
    } else {
      // Convex mode: open viewer on hold start
      // VIDEO-MIRROR-FIX: Look up message to get isMirrored state
      const msg = findDisplayMessageById(messageId);
      const isMirrored = msg?.protectedMedia?.isMirrored === true;
      // SECURE_TIMER: same sender detection as tap path.
      const isSender = !!(msg?.senderId && userId && msg.senderId === userId);
      if (__DEV__) console.log('[HOLD-MODE] Convex holdStart', {
        messageRef: getSafeLogId(messageId),
        isMirrored,
      });
      if (__DEV__) console.log('[SECURE_TIMER] viewer_open', {
        messageRef: getSafeLogId(messageId),
        hasCurrentUser: !!userId,
        senderRef: getSafeLogId(msg?.senderId ?? null),
        isSender,
        trigger: 'hold',
      });
      setViewerIsMirrored(isMirrored);
      setViewerIsSender(isSender);
      setViewerIsHoldMode(true); // HOLD-MODE-FIX: Hold mode
      setViewerPrefetchedLocalUri(localUri);
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
        if (__DEV__) console.log('[HOLD-MODE] Convex holdEnd', {
          messageRef: getSafeLogId(messageId),
        });
        // P1_ONCE_VIEW_FIX: For view-once ("Once") media, hold release on the
        // receiver side is the moment the media has been seen — it must be
        // expired immediately so the bubble redacts to the "expired" state
        // and the blob is removed by the cleanup cron. Previously this path
        // only cleared the local viewer, leaving the media re-openable until
        // the next mount/refresh. Sender viewing their own media must NEVER
        // expire it (mirrors handleProtectedMediaExpire's sender skip and the
        // viewer's handleClose isSender guard).
        const msg = findDisplayMessageById(messageId);
        const isSender = !!(msg?.senderId && userId && msg.senderId === userId);
        if (msg?.viewOnce && !isSender && userId) {
          if (__DEV__) console.log('[SECURE_TIMER] markExpired', {
            messageRef: getSafeLogId(messageId),
            reason: 'viewonce_hold_release',
          });
          markMediaExpired({
            messageId: asMessageId(messageId),
            authUserId: userId,
          }).catch((err) => {
            if (__DEV__) console.error('[P1_ONCE_VIEW_FIX] hold-release markExpired failed:', err);
          });
        } else if (msg?.viewOnce && isSender) {
          if (__DEV__) console.log('[SECURE_TIMER] skip_sender_timer', {
            messageRef: getSafeLogId(messageId),
            reason: 'viewonce_hold_release',
          });
        }
        setViewerMessageId(null);
        setViewerPrefetchedLocalUri(undefined);
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
      // SECURE_TIMER: the bubble countdown is visible to both sides (sender
      // sees recipient's wall-clock timer). Only the receiver should call
      // markExpired from the bubble — sender must never consume the timer.
      const msg = findDisplayMessageById(messageId);
      const isSender = !!(msg?.senderId && userId && msg.senderId === userId);
      if (isSender) {
        if (__DEV__) console.log('[SECURE_TIMER] skip_sender_timer', {
          messageRef: getSafeLogId(messageId),
          reason: 'bubble_countdown_zero',
        });
        return;
      }
      // Convex mode: call backend to mark expired
      if (userId) {
        if (__DEV__) console.log('[EXPIRY] Marking media expired from bubble', {
          messageRef: getSafeLogId(messageId),
        });
        if (__DEV__) console.log('[SECURE_TIMER] markExpired', {
          messageRef: getSafeLogId(messageId),
          reason: 'bubble_countdown_zero',
        });
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
    if (!ensureChatActionAllowed()) return;
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

  // COOLDOWN-LIVE: derive "XXm XXs" countdown text.
  // HOOK-ORDER FIX: this useMemo MUST live above the early-return paths below
  // (`!activeConversation`, `!otherUser`) so the hook list stays stable
  // across renders. The body itself returns `null` when not applicable, so
  // the visual behavior is unchanged. Primary source: gameSession.cooldownUntil
  // (absolute timestamp). Fallback: cooldownAnchorRef captured at press time
  // from remainingMs. cooldownTick (1s interval) drives re-render.
  const cooldownLiveText = useMemo(() => {
    if (isDemo || gameSession?.state !== 'cooldown') return null;
    const gs: any = gameSession;
    let expiry: number | null = null;
    if (typeof gs.cooldownUntil === 'number' && gs.cooldownUntil > 0) {
      expiry = gs.cooldownUntil;
    } else if (cooldownAnchorRef.current && cooldownAnchorRef.current > Date.now()) {
      expiry = cooldownAnchorRef.current;
    } else if (typeof gs.remainingMs === 'number' && gs.remainingMs > 0) {
      // Last-resort: approximate from live remainingMs snapshot.
      expiry = Date.now() + gs.remainingMs;
    }
    if (!expiry) return null;
    const remaining = Math.max(0, expiry - Date.now());
    if (remaining <= 0) return null;
    const totalSec = Math.floor(remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }, [cooldownTick, gameSession, isDemo]);

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
            <Text {...TEXT_PROPS} style={styles.loadingText}>Opening your conversation...</Text>
          </>
        ) : (
          <>
            <Ionicons name="chatbubble-ellipses-outline" size={LOADING_ICON_SIZE} color={COLORS.textLight} />
            <Text {...TEXT_PROPS} style={styles.loadingText}>This chat is no longer available.</Text>
            <TouchableOpacity
              style={styles.errorBackButton}
              onPress={handleBack}
            >
              <Text {...TEXT_PROPS} style={styles.errorBackText}>Go back</Text>
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
        <Text {...TEXT_PROPS} style={styles.loadingText}>Syncing your conversation...</Text>
      </View>
    );
  }

  const otherUserId = typeof otherUser.id === 'string' && otherUser.id.length > 0
    ? otherUser.id
    : undefined;
  // PRIVACY-RESTORE: Confession DMs are anonymous on the recipient's side until
  // the confessor opts to reveal. Detect both flags up-front and use them to
  // gate avatar/name rendering and profile-tap navigation.
  const otherUserPrivacy = otherUser as typeof otherUser & { isAnonymous?: boolean };
  const isOtherUserAnonymous = !isDemo && otherUserPrivacy.isAnonymous === true;
  // Confess metadata can remain on a promoted mutual conversation. Only the
  // backend's pre-mutual mode flag should trigger anonymous Confess UI.
  const isPreMutualConfessionChat =
    !isDemo && activeConversation.isPreMutualConfessionChat === true;
  const isConfessionChat = isPreMutualConfessionChat;
  const otherUserName = otherUser.name;
  const otherUserPhotoUrl = isOtherUserAnonymous ? undefined : otherUser.photoUrl;
  const otherUserLastActive = otherUser.lastActive ?? 0;
  const activeMatchId = !isDemo ? conversation?.matchId : undefined;

  // FLUSH-COMPOSER: The chat screen renders INSIDE the bottom tab navigator,
  // which means the tab bar itself already sits below our composer. We must
  // NOT add any extra bottom padding here — not safe-area, not hairline —
  // or there will be a visible gap between the input bar and the tabs.
  // Keyboard-open stays at 0 (KAV handles keyboard offset internally).
  const composerBottomPadding = 0;

  // cooldownLiveText is computed above the early-return paths to keep hook
  // order stable across renders (see HOOK-ORDER FIX comment near its
  // declaration). It is consumed by the cooldown banner JSX below.
  const pendingInviteBottom = composerHeight + composerBottomPadding + SPACING.sm;

  const canSendCustom = isDemo
    ? true
    : currentUser
      ? currentUser.gender === 'female' ||
        currentUser.subscriptionTier === 'premium' ||
        (!activeConversation.isPreMatch && currentUser.subscriptionTier !== 'free')
      : false;

  const isTruthDarePendingSentByMe =
    !isDemo && gameSession?.state === 'pending' && isTruthDareInviter;
  const isTruthDarePendingReceivedByMe =
    !isDemo && gameSession?.state === 'pending' && isTruthDareInvitee;
  const isTruthDareActive = !isDemo && gameSession?.state === 'active';
  const isTruthDareStarted = isTruthDareActive && !!gameSessionView?.gameStartedAt;
  const isTruthDareAwaitingStart = isTruthDareActive && !gameSessionView?.gameStartedAt;
  const isTruthDareMyStartAction = isTruthDareAwaitingStart && isTruthDareInviter;
  const currentTruthDareSpinRole = truthDareSpinTurnRole || 'inviter';
  const isTruthDareMySpinAction =
    isTruthDareStarted &&
    gameSessionView?.turnPhase === 'idle' &&
    !!truthDareRole &&
    currentTruthDareSpinRole === truthDareRole;
  const isTruthDareMyChooseAction =
    isTruthDareStarted &&
    gameSessionView?.turnPhase === 'choosing' &&
    !!truthDareRole &&
    gameSessionView?.currentTurnRole === truthDareRole;
  const isTruthDareWaitingAction =
    (isTruthDareAwaitingStart && isTruthDareInvitee) ||
    (isTruthDareStarted &&
      !isTruthDareMySpinAction &&
      !isTruthDareMyChooseAction &&
      (gameSessionView?.turnPhase === 'idle' ||
        gameSessionView?.turnPhase === 'spinning' ||
        gameSessionView?.turnPhase === 'choosing'));
  const truthDareHeaderButtonLabel = isTruthDarePendingSentByMe
    ? 'Sent'
    : isTruthDareMyStartAction
      ? 'Start'
      : isTruthDareMySpinAction
        ? 'Spin'
        : isTruthDareMyChooseAction
          ? 'Choose'
          : isTruthDareWaitingAction
            ? 'Waiting'
            : 'T/D';
  const isTruthDareHeaderButtonDisabled =
    isTruthDarePendingSentByMe || isTruthDareWaitingAction;

  return (
    <View style={styles.container}>
      {/* LOCKED: P1 chat header avatar + open profile. Do not modify without explicit approval. */}
      {/* PRIVACY-RESTORE: Confession-chat safety banner sits ABOVE the header
          and replaces the normal top inset, signaling that this is an
          anonymous chat originated from a confession. */}
      {isConfessionChat && (
        <View style={[styles.confessionBanner, { paddingTop: insets.top + 8 }]}>
          <View style={styles.confessionBannerInner}>
            <Ionicons name="eye-off" size={14} color={COLORS.primary} />
            <Text {...TEXT_PROPS} style={styles.confessionBannerText}>
              Anonymous Chat from Confess
            </Text>
          </View>
          <Text {...TEXT_PROPS} style={styles.confessionBannerHint}>
            Be kind. Do not share personal info.
          </Text>
        </View>
      )}
      {/* Header — sits above KAV (does not move when keyboard opens) */}
      <View
        style={[styles.header, !isConfessionChat && { paddingTop: insets.top }]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && Math.abs(h - measuredHeaderHeight) > 0.5) {
            setMeasuredHeaderHeight(h);
          }
        }}
      >
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={HEADER_ICON_SIZE} color={COLORS.text} />
        </TouchableOpacity>
        {/* Avatar with presence dot - tappable to open profile (disabled for anonymous users) */}
        {isOtherUserAnonymous ? (
          // PRIVACY: Non-tappable anonymous avatar with eye-off glyph.
          <View style={styles.avatarButton}>
            <View style={styles.avatarContainer}>
              <View style={[styles.headerAvatarPlaceholder, styles.headerAvatarAnonymous]}>
                <Ionicons name="eye-off" size={18} color={COLORS.textMuted} />
              </View>
            </View>
          </View>
        ) : (
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
                  <Text {...TEXT_PROPS} style={styles.headerAvatarInitials}>{avatarInitials}</Text>
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
        )}
        {/* Name + status - tappable to open profile (disabled for anonymous users) */}
        {isOtherUserAnonymous ? (
          // PRIVACY: Non-tappable anonymous name display.
          <View style={styles.headerInfo}>
            <Text {...TEXT_PROPS} style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
              Anonymous
            </Text>
            <Text {...TEXT_PROPS} style={styles.headerStatus}>From a confession</Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => handleOpenProfile(otherUserId)}
            style={styles.headerInfo}
            activeOpacity={0.7}
          >
            {/* LONG-NAME-FIX: Truncate long names with ellipsis */}
            <Text {...TEXT_PROPS} style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
              {otherUserName}
            </Text>
            {/* ONLINE-STATUS-FIX: Show "Online" for very recent activity */}
            <Text {...TEXT_PROPS} style={styles.headerStatus}>
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
        )}
        {/* Right section: T/D button + menu with stable spacing */}
        <View style={styles.headerRightSection}>
        {/* Truth/Dare game button - only for matched users (non-pre-match) */}
        {!activeConversation.isPreMatch && (
          <TouchableOpacity
            onPress={handleTruthDarePress}
            // TD-MESSAGES-FIX: Widen tap surface so no near-miss tap is lost.
            // The wrapping gameButton already hugs the pill visually, but we
            // give +12 on all sides so even a 48pt finger pad around the pill
            // edges always registers a press on the visible T/D button.
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.gameButton}
            disabled={isTruthDareHeaderButtonDisabled}
            testID="chat-header-truthdare-button"
            accessibilityRole="button"
            accessibilityLabel={`Truth or Dare ${truthDareHeaderButtonLabel}`}
          >
            <View style={[
              styles.truthDareButton,
              // BUTTON-CONSISTENCY: T/D button keeps the SAME visual treatment in
              // every state (normal / pending / cooldown / active). Only the
              // contextual badge + label text change. No opacity dimming, no
              // color flips — the button must never look "disabled".
              gameSession?.state === 'pending' && isTruthDareInvitee && styles.truthDareButtonWithBadge,
            ]}>
              {/* TD-ICON-FIX: Removed inline icon — the pill was overflowing
                  the fixed-size gameButton slot and clipping into the 3-dot
                  menu. Clean text-only label is both readable and premium. */}
              <Text
                {...TEXT_PROPS}
                style={styles.truthDareLabel}
                numberOfLines={1}
              >
                {truthDareHeaderButtonLabel}
              </Text>
              {/* Pending invite indicator (for invitee) */}
              {isTruthDarePendingReceivedByMe && (
                <View style={styles.truthDareBadge} />
              )}
              {/* TD-UX: Badge dot for inviter when ready to start */}
              {isTruthDareMyStartAction && (
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
          <Ionicons name="ellipsis-vertical" size={SIZES.icon.md} color={COLORS.textLight} />
        </TouchableOpacity>
        </View>
      </View>

      {/* TD_HINT: Short-lived nudge when it is my turn to spin */}
      {showSpinHint && (
        <View
          style={[styles.spinHintAnchor, { top: measuredHeaderHeight + 4 }]}
          pointerEvents="none"
        >
          <View style={styles.spinHintCaret} />
          <View style={styles.spinHintChip}>
            <View style={styles.spinHintDot} />
            <Text {...TEXT_PROPS} style={styles.spinHintText}>
              Your turn — tap to spin
            </Text>
          </View>
        </View>
      )}

      {/* TD-UX: Waiting for inviter to start banner (for invitee) */}
      {showWaitingForStartToast && (
        <View style={styles.waitingStartBanner}>
          <Ionicons name="hourglass-outline" size={BANNER_ICON_SIZE} color="#2E7D32" />
          <Text {...TEXT_PROPS} style={styles.waitingStartBannerText}>
            Waiting for {otherUserName} to start the game
          </Text>
        </View>
      )}

      {/* Expired chat banner */}
      {isExpiredChat && (
        <View style={styles.expiredBanner}>
          <Ionicons name="time-outline" size={BANNER_ICON_SIZE} color={COLORS.textMuted} />
          <Text {...TEXT_PROPS} style={styles.expiredBannerText}>This chat has expired.</Text>
        </View>
      )}

      {/* Just unblocked banner - one-time indicator */}
      {showJustUnblockedBanner && (
        <View style={styles.justUnblockedBanner}>
          <Ionicons name="checkmark-circle" size={BANNER_ICON_SIZE} color={COLORS.success} />
          <Text {...TEXT_PROPS} style={styles.justUnblockedBannerText}>Unblocked just now</Text>
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

            // AVATAR GROUPING: system/hidden rows do not consume grouping.
            // Show avatar only on the LAST visible received bubble in a run.
            let nextBubbleIndex = index + 1;
            while (
              nextBubbleIndex < displayMessages.length &&
              isNonBubbleMessageRow(displayMessages[nextBubbleIndex])
            ) {
              nextBubbleIndex += 1;
            }
            const nextVisibleBubble = displayMessages[nextBubbleIndex];
            const currentIsNonBubble = isNonBubbleMessageRow(item);
            const isLastInGroup = !nextVisibleBubble || nextVisibleBubble.senderId !== item.senderId;
            const showAvatar = !isMessageOwn && !currentIsNonBubble && isLastInGroup;

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
                    timerEndsAt: item.timerEndsAt ?? undefined,
                    expiredAt: item.expiredAt ?? undefined,
                    viewedAt: item.viewedAt,
                    systemSubtype: item.systemSubtype,
                    mediaId: item.mediaId,
                    // SENDER-TIMER-FIX: Pass viewOnce and recipientOpened for sender status
                    viewOnce: item.viewOnce,
                    recipientOpened: item.recipientOpened,
                    // VOICE-FIX: Pass both demo and production audio fields
                    audioUri: item.audioUri,
                    durationMs: item.durationMs,
                    audioUrl: item.audioUrl ?? undefined,
                    audioDurationMs: item.audioDurationMs,
                    // [P1_MEDIA_UPLOAD] Forward optimistic media preview + progress state
                    isPending: item.isPending,
                    localUri: item.localUri,
                    uploadStatus: item.uploadStatus,
                    uploadProgress: item.uploadProgress,
                    errorMessage: item.errorMessage,
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
                  // [P1_MEDIA_UPLOAD] Tap-to-retry for failed pending secure media
                  onRetryPendingMedia={handleRetrySecurePhotoMessage}
                  // AVATAR GROUPING: Pass grouping info for Instagram/Tinder style layout
                  showAvatar={showAvatar}
                  avatarUrl={otherUserPhotoUrl}
                  isLastInGroup={isLastInGroup}
                  // PROFILE-TAP: Avatar tap opens profile
                  // PRIVACY-RESTORE: Disable profile tap for anonymous confession sender.
                  onAvatarPress={isOtherUserAnonymous ? undefined : () => handleOpenProfile(otherUserId)}
                  // LOAD-FIRST UX (Option A): Show a tap-to-load arrow on
                  // remote photo/video tiles instead of auto-downloading
                  // every message. MediaMessage caches via mediaCache and
                  // only opens the lightbox on the second tap. Doodles
                  // bypass the gate internally.
                  requireMediaDownloadBeforeOpen
                  autoDownloadMedia={false}
                  compactTruthDareSystemMessages
                />
                {isMessageOwn && optimisticStatus === 'sending' && (
                  <View style={styles.optimisticStatusRow}>
                    <ActivityIndicator size="small" color={COLORS.textLight} />
                    <Text {...TEXT_PROPS} style={styles.optimisticStatusText}>Sending...</Text>
                  </View>
                )}
                {isMessageOwn && optimisticStatus === 'failed' && (
                  <TouchableOpacity
                    style={[styles.optimisticStatusRow, styles.optimisticFailedRow]}
                    onPress={() => {
                      if (item.clientMessageId) {
                        handleRetryOptimisticTextMessage(item.clientMessageId);
                      }
                    }}
                    disabled={isSending}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="alert-circle-outline" size={STATUS_ICON_SIZE} color={COLORS.error} />
                    <Text {...TEXT_PROPS} style={[styles.optimisticStatusText, styles.optimisticFailedText]}>
                      {item.errorMessage ? `${item.errorMessage} Tap to retry.` : 'Failed to send. Tap to retry.'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <View style={styles.emptyChatIconContainer}>
                <Ionicons name="chatbubble-outline" size={EMPTY_CHAT_ICON_SIZE} color={COLORS.primary} />
              </View>
              <Text {...TEXT_PROPS} style={styles.emptyChatText}>
                Start the conversation with {otherUserName}.
              </Text>
              <Text {...TEXT_PROPS} style={styles.emptyChatHint}>
                Say hi, share a moment, or break the ice with a Truth/Dare.
              </Text>
              {activeConversation.isPreMatch && (
                <View style={styles.matchContextBadge}>
                  <Ionicons name="sparkles" size={12} color={COLORS.primary} />
                  <Text {...TEXT_PROPS} style={styles.emptyChatHint}>
                    Pre-match chat — make it count
                  </Text>
                </View>
              )}
            </View>
          }
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: displayMessages.length > 0 ? 'flex-end' as const : 'center' as const,
            paddingTop: SPACING.sm,
            paddingHorizontal: SPACING.md,
            // ANCHOR-FIX: composer is a sibling of FlashList inside chatArea
            // (NOT an absolute overlay), so it already has its own slot below.
            // Adding composerHeight here just creates dead empty space and
            // floats the last message above the input. Use a tiny bottom
            // breathing-room instead so the last message anchors right above
            // the composer (WhatsApp/iMessage feel).
            paddingBottom: SPACING.xs,
          }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={onContentSizeChange}
        />
          {showTypingIndicator && (
            <View
              pointerEvents="none"
              style={[
                styles.typingIndicatorFloating,
                { bottom: composerHeight + composerBottomPadding + SPACING.xs },
              ]}
            >
              <View style={styles.typingIndicatorBar}>
                <View style={styles.typingIndicatorDot} />
                <Text {...TEXT_PROPS} style={styles.typingIndicatorText}>
                  {otherUserName} is typing…
                </Text>
              </View>
            </View>
          )}

          {/* ─── COMPOSER (fixed to bottom of chatArea — sibling of FlashList) ─── */}
          <View
            onLayout={onComposerLayout}
            style={[styles.composerWrapper, { paddingBottom: composerBottomPadding }]}
          >
            {/* COOLDOWN-UI: persistent pill removed — replaced with a floating
                top notification rendered absolutely below the header (see
                cooldownToastFloating below). Composer no longer reserves space. */}
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
                disabledPlaceholder={isExpiredChat ? 'This chat has expired' : undefined}
              />
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* COOLDOWN-TOAST-OVERLAY-V2: True top-level overlay rendered OUTSIDE
          the KAV, anchored directly below the chat header. `top` is derived
          from the measured header height (which already includes the
          `paddingTop: insets.top` baked in) plus a small gap. If the header
          measurement hasn't settled yet, we fall back to
          `insets.top + HEADER_FALLBACK_HEIGHT` so the toast is always
          visible below the header — never hidden behind it. */}
      {showCooldownMessage && (() => {
        const HEADER_FALLBACK_HEIGHT = 64;
        const topOffset = measuredHeaderHeight > 0
          ? measuredHeaderHeight + 8
          : insets.top + HEADER_FALLBACK_HEIGHT + 8;
        return (
          <View
            style={[styles.cooldownToastFloating, { top: topOffset }]}
            pointerEvents="box-none"
          >
            <View style={styles.cooldownToastPill} pointerEvents="none">
              <Ionicons name="timer-outline" size={14} color={COLORS.warning || '#FF9800'} />
              <Text {...TEXT_PROPS} style={styles.cooldownToastText}>
                {cooldownLiveText
                  ? `Cooldown ends in ${cooldownLiveText}`
                  : cooldownRemainingMin > 0
                    ? `Cooldown: ${cooldownRemainingMin} min${cooldownRemainingMin === 1 ? '' : 's'} remaining`
                    : 'Cooldown active — try again shortly'}
              </Text>
            </View>
          </View>
        );
      })()}

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
          onClose={() => {
            setViewerMessageId(null);
            setViewerPrefetchedLocalUri(undefined);
            setViewerIsMirrored(false);
            setViewerIsHoldMode(false);
            setViewerIsSender(false);
          }}
          onReport={() => {
            setViewerMessageId(null);
            setViewerPrefetchedLocalUri(undefined);
            setViewerIsMirrored(false);
            setViewerIsHoldMode(false);
            setViewerIsSender(false);
            setReportModalVisible(true);
          }}
          isMirrored={viewerIsMirrored}
          isHoldMode={viewerIsHoldMode}
          isSender={viewerIsSender}
          prefetchedLocalUri={viewerPrefetchedLocalUri}
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
                <Ionicons name="wine" size={TD_MODAL_ICON_SIZE} color={COLORS.white} />
              </View>
              <Text {...TEXT_PROPS} style={styles.tdInviteTitle}>Truth or Dare</Text>
            </View>
            <Text {...TEXT_PROPS} style={styles.tdInviteMessage}>
              Invite {otherUserName} to play Truth or Dare?
            </Text>
            <View style={styles.tdInviteActions}>
              <TouchableOpacity
                style={[styles.tdInviteButton, styles.tdInviteCancelButton]}
                onPress={() => setShowTruthDareInvite(false)}
              >
                <Text {...TEXT_PROPS} style={styles.tdInviteCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tdInviteButton, styles.tdInviteSendButton]}
                onPress={handleSendInvite}
              >
                <Text {...TEXT_PROPS} style={styles.tdInviteSendText}>Invite</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Truth/Dare Pending Invite Card (for invitee) */}
      {gameSession?.state === 'pending' && isTruthDareInvitee && (
        <View style={[styles.tdPendingInviteWrapper, { bottom: pendingInviteBottom }]}>
          <TruthDareInviteCard
            inviterName={otherUserName}
            isInvitee={true}
            onAccept={() => handleRespondToInvite(true)}
            onReject={() => handleRespondToInvite(false)}
          />
        </View>
      )}

      {/* Truth/Dare Bottle Spin Game */}
      {/* TD-FLOW (Option B): autoAdvance enables non-blocking result toast +
          automatic return to idle for Phase-1 Messages. Phase-2 Truth/Dare
          tab intentionally leaves this off to preserve its [Again]/[Done] UI. */}
      <BottleSpinGame
        visible={showTruthDareGame}
        onClose={() => setShowTruthDareGame(false)}
        // TD_PAUSE: Cancel (X / backdrop / Android back) closes the modal
        // and flips the paused flag so the auto-open effect does not force
        // the modal back open. Backend game state is intentionally untouched.
        onCancel={() => {
          const pausedAt = Date.now();
          truthDarePauseByConversation.set(conversationId, pausedAt);
          if (__DEV__) {
            console.log('[TD_PAUSE] pause_persisted_until_new_action', {
              conversationRef: getSafeLogId(conversationId),
              pausedAt,
            });
          }
          setIsTruthDarePaused(true);
          setShowTruthDareGame(false);
        }}
        currentUserName={isDemo ? 'You' : (currentUser?.name || 'You')}
        otherUserName={otherUserName}
        conversationId={conversationId || ''}
        userId={userId || getDemoUserId()}
        onSendResultMessage={handleSendTruthDareResult}
        autoAdvance={true}
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
  // PREMIUM-BG: subtle tint behind the message thread (separates bubbles from
  // pure-white app background) — like WhatsApp/iMessage chat surface.
  chatArea: {
    flex: 1,
    position: 'relative' as const,
    backgroundColor: '#F5F5F7',
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
    fontSize: FONT_SIZE.lg,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    marginTop: SPACING.md,
  },
  errorBackButton: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + SPACING.xxs,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.primary,
  },
  errorBackText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600' as const,
    color: COLORS.white,
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
  },
  optimisticStatusRow: {
    alignSelf: 'flex-end' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: moderateScale(6, 0.25),
    marginTop: -SPACING.xs,
    marginBottom: moderateScale(6, 0.25),
    paddingHorizontal: SPACING.sm + SPACING.xxs,
  },
  optimisticStatusText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
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
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    marginRight: SPACING.xs,
    width: SIZES.button.md,
    height: SIZES.button.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  avatarButton: {
    marginRight: SPACING.sm,
  },
  // PRESENCE-DOT: Container for avatar + dot overlay
  avatarContainer: {
    position: 'relative' as const,
  },
  // AVATAR-ENLARGE: Increased from 36 to 40 for better visibility
  headerAvatar: {
    width: HEADER_AVATAR_SIZE,
    height: HEADER_AVATAR_SIZE,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.backgroundDark,
  },
  headerAvatarPlaceholder: {
    width: HEADER_AVATAR_SIZE,
    height: HEADER_AVATAR_SIZE,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  headerAvatarInitials: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600' as const,
    color: COLORS.white,
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
  },
  // PRESENCE-DOT: Small indicator dot on avatar
  presenceDot: {
    position: 'absolute' as const,
    bottom: 0,
    right: 0,
    width: HEADER_PRESENCE_DOT_SIZE,
    height: HEADER_PRESENCE_DOT_SIZE,
    borderRadius: SIZES.radius.full,
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
    marginRight: SPACING.sm,
  },
  headerName: {
    fontSize: HEADER_NAME_SIZE,
    fontWeight: '600' as const,
    color: COLORS.text,
    lineHeight: lineHeight(HEADER_NAME_SIZE, 1.2),
  },
  headerStatus: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textLight,
    marginTop: moderateScale(1, 0.25),
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
  },
  // Right section container for T/D button and menu
  headerRightSection: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flexShrink: 0, // Prevent right section from shrinking
  },
  // TD-ICON-FIX: Previously a fixed SIZES.button.md square — the premium
  // pill (paddingHorizontal: 14 + label) overflowed its bounds and clipped
  // into the 3-dot menu. Now the slot fits the pill's natural width and
  // reserves a small right margin so there is always clear space before
  // the ellipsis-vertical button.
  gameButton: {
    paddingVertical: SPACING.xs,
    marginRight: SPACING.xs,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // PREMIUM-TD-BUTTON: A single, unchanging visual treatment — used for every
  // T/D state so the button never looks "disabled". Two-layer elevation
  // (secondary-tinted soft glow + crisp shadow), hairline inner border for
  // depth, tightened padding, refined typography with slight letterSpacing.
  truthDareButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: COLORS.secondary,
    // TD-BUTTON-BIGGER: slightly larger pill (was 12×7) for more premium
    // presence. Still fits alongside the 3-dot menu thanks to gameButton
    // marginRight and the text-only label.
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 9,
    elevation: 6,
  },
  truthDareLabel: {
    fontSize: TD_BUTTON_LABEL_SIZE,
    fontWeight: '800' as const,
    color: COLORS.white,
    lineHeight: lineHeight(TD_BUTTON_LABEL_SIZE, 1.15),
    letterSpacing: 0.5,
  },
  truthDareButtonWithBadge: {
    position: 'relative' as const,
  },
  truthDareBadge: {
    position: 'absolute' as const,
    top: -SPACING.xs,
    right: -SPACING.xs,
    width: HEADER_PRESENCE_DOT_SIZE,
    height: HEADER_PRESENCE_DOT_SIZE,
    borderRadius: SIZES.radius.full,
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
  truthDareButtonReadyToStart: {
    backgroundColor: '#FF9800',
  },
  truthDareButtonActive: {
    backgroundColor: '#2E7D32',
  },
  truthDareLabelWaiting: {
    color: COLORS.background,
  },
  truthDareStartBadge: {
    position: 'absolute' as const,
    top: -SPACING.xxs,
    right: -SPACING.xxs,
    width: SPACING.sm,
    height: SPACING.sm,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.warning || '#FF9800',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  waitingStartBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    backgroundColor: 'rgba(46, 125, 50, 0.12)',
    paddingVertical: SPACING.sm + SPACING.xxs,
    paddingHorizontal: SPACING.base,
  },
  waitingStartBannerText: {
    fontSize: BANNER_TEXT_SIZE,
    fontWeight: '500' as const,
    color: '#2E7D32',
    lineHeight: lineHeight(BANNER_TEXT_SIZE, 1.35),
  },
  spinHintAnchor: {
    position: 'absolute' as const,
    right: SPACING.base,
    zIndex: 30,
    elevation: 30,
    alignItems: 'flex-end' as const,
  },
  spinHintCaret: {
    width: 10,
    height: 10,
    marginRight: 34,
    marginBottom: -5,
    backgroundColor: COLORS.white,
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.08)',
    transform: [{ rotate: '45deg' }],
  },
  spinHintChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.sm + SPACING.xxs,
    paddingVertical: SPACING.xs + 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  spinHintDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  spinHintText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600' as const,
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.25),
  },
  typingIndicatorFloating: {
    position: 'absolute' as const,
    left: SPACING.md,
    right: SPACING.md,
    zIndex: 20,
    elevation: 20,
    alignItems: 'flex-start' as const,
  },
  typingIndicatorBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: SPACING.sm + SPACING.xxs,
    paddingVertical: SPACING.xs,
    borderRadius: SIZES.radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  typingIndicatorDot: {
    width: SPACING.xs,
    height: SPACING.xs,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.primary,
  },
  typingIndicatorText: {
    fontSize: BANNER_TEXT_SIZE,
    fontStyle: 'italic' as const,
    color: COLORS.textLight,
    lineHeight: lineHeight(BANNER_TEXT_SIZE, 1.35),
  },
  cooldownBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    backgroundColor: 'rgba(255, 152, 0, 0.12)',
    paddingVertical: SPACING.sm + SPACING.xxs,
    paddingHorizontal: SPACING.base,
  },
  cooldownBannerText: {
    fontSize: BANNER_TEXT_SIZE,
    fontWeight: '500' as const,
    color: COLORS.warning || '#FF9800',
    lineHeight: lineHeight(BANNER_TEXT_SIZE, 1.35),
  },
  // COOLDOWN-TOAST-FLOATING: premium, rounded, floating top notification
  // shown only on T/D-during-cooldown press. Absolute-positioned at
  // container level (sibling of KAV) so it always overlays FlashList.
  // `top` is set dynamically from the measured chatTopY. Does NOT occupy
  // permanent space — overlays the chat without shifting messages.
  cooldownToastFloating: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    alignItems: 'center' as const,
    zIndex: 999,
    elevation: 999,
  },
  cooldownToastPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: COLORS.background,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.35)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  cooldownToastText: {
    fontSize: 12.5,
    fontWeight: '600' as const,
    color: COLORS.warning || '#FF9800',
    letterSpacing: 0.1,
  },
  // Truth/Dare Invite Modal styles
  tdInviteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: SPACING.xl,
  },
  tdInviteContainer: {
    backgroundColor: COLORS.background,
    borderRadius: TD_INVITE_MODAL_RADIUS,
    padding: SPACING.xl,
    width: '90%',
    maxWidth: TD_INVITE_MAX_WIDTH,
    alignItems: 'center' as const,
  },
  tdInviteHeader: {
    alignItems: 'center' as const,
    marginBottom: SPACING.base,
  },
  tdInviteIconContainer: {
    width: SIZES.avatar.lg,
    height: SIZES.avatar.lg,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.secondary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.md,
  },
  tdInviteTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700' as const,
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.xxl, 1.2),
  },
  tdInviteMessage: {
    fontSize: TD_INVITE_BODY_SIZE,
    color: COLORS.textLight,
    textAlign: 'center' as const,
    marginBottom: SPACING.xl,
    lineHeight: lineHeight(TD_INVITE_BODY_SIZE, 1.35),
  },
  tdInviteActions: {
    flexDirection: 'row' as const,
    gap: SPACING.md,
    width: '100%',
  },
  tdInviteButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: SIZES.radius.xl,
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
    fontSize: TD_INVITE_BODY_SIZE,
    fontWeight: '600' as const,
    color: COLORS.text,
    lineHeight: lineHeight(TD_INVITE_BODY_SIZE, 1.2),
  },
  tdInviteSendText: {
    fontSize: TD_INVITE_BODY_SIZE,
    fontWeight: '600' as const,
    color: COLORS.white,
    lineHeight: lineHeight(TD_INVITE_BODY_SIZE, 1.2),
  },
  tdPendingInviteWrapper: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  moreButton: {
    padding: SPACING.xs,
    minWidth: SIZES.button.md,
    minHeight: SIZES.button.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  emptyChat: {
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyChatIconContainer: {
    width: SIZES.avatar.lg,
    height: SIZES.avatar.lg,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.primarySubtle,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.sm,
  },
  emptyChatText: {
    fontSize: EMPTY_CHAT_TEXT_SIZE,
    color: COLORS.textMuted,
    marginTop: SPACING.md,
    textAlign: 'center',
    lineHeight: lineHeight(EMPTY_CHAT_TEXT_SIZE, 1.35),
  },
  emptyChatHint: {
    fontSize: BANNER_TEXT_SIZE,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
    textAlign: 'center' as const,
    lineHeight: lineHeight(BANNER_TEXT_SIZE, 1.35),
  },
  matchContextBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.primarySubtle,
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(153,153,153,0.12)',
    paddingVertical: SPACING.sm + SPACING.xxs,
    paddingHorizontal: SPACING.base,
  },
  expiredBannerText: {
    fontSize: BANNER_TEXT_SIZE,
    fontWeight: '500',
    color: COLORS.textMuted,
    lineHeight: lineHeight(BANNER_TEXT_SIZE, 1.35),
  },
  justUnblockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(76, 175, 80, 0.12)',
    paddingVertical: SPACING.sm + SPACING.xxs,
    paddingHorizontal: SPACING.base,
  },
  justUnblockedBannerText: {
    fontSize: BANNER_TEXT_SIZE,
    fontWeight: '500',
    color: COLORS.success,
    lineHeight: lineHeight(BANNER_TEXT_SIZE, 1.35),
  },
  // PRIVACY-RESTORE: Anonymous-confession privacy header styles.
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
