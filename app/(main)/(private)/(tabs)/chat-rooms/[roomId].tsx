import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  FlatList,
  TouchableOpacity,
  Pressable,
  AppState,
  AppStateStatus,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useConvex, useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS, FONT_SIZE, lineHeight, moderateScale } from '@/lib/constants';
// P2-001/002: Import responsive utilities
import { SPACING, SIZES } from '@/lib/responsive';
import { useChatThemeColors } from '@/stores/chatThemeStore';
// Public room uses a constant premium background (NOT theme-controlled).
// Theme picker continues to apply to private DM only.
import RoomBackground from '@/components/chatroom/RoomBackground';
import {
  DEMO_CHAT_ROOMS,
  getDemoMessagesForRoom,
  DEMO_CURRENT_USER,
  DEMO_ONLINE_USERS,
  DemoChatMessage,
  DemoDM,
  DemoOnlineUser,
} from '@/lib/demoData';

import ChatRoomsHeader from '@/components/chatroom/ChatRoomsHeader';
import ChatMessageItem from '@/components/chatroom/ChatMessageItem';
import SystemMessageItem from '@/components/chatroom/SystemMessageItem';
import ChatComposer, { type ComposerPanel, type MentionMember, type MentionData } from '@/components/chatroom/ChatComposer';
import MessagesPopover from '@/components/chatroom/MessagesPopover';
import MentionsPopover, { MentionItem } from '@/components/chatroom/MentionsPopover';
import ProfilePopover from '@/components/chatroom/ProfilePopover';
import OnlineUsersPanel from '@/components/chatroom/OnlineUsersPanel';
import MessageActionsSheet from '@/components/chatroom/MessageActionsSheet';
import { ReactionEmoji } from '@/components/chatroom/ReactionBar';
import ReactionChips, { ReactionGroup } from '@/components/chatroom/ReactionChips';
// COIN-FLASH-FIX: CoinFeedback import removed - was causing yellow flash during send
import UserProfilePopup from '@/components/chatroom/UserProfilePopup';
import ViewProfileModal from '@/components/chatroom/ViewProfileModal';
import ReportUserModal, { ReportReason } from '@/components/chatroom/ReportUserModal';
import AttachmentPopup from '@/components/chatroom/AttachmentPopup';
import DoodleCanvas from '@/components/chatroom/DoodleCanvas';
import SecureMediaViewer from '@/components/chatroom/SecureMediaViewer';
import ActiveUsersStrip from '@/components/chatroom/ActiveUsersStrip';
import { useDemoChatRoomStore } from '@/stores/demoChatRoomStore';
import { useChatRoomSessionStore } from '@/stores/chatRoomSessionStore';
import { useChatRoomDmStore } from '@/stores/chatRoomDmStore';
import { usePreferredChatRoomStore } from '@/stores/preferredChatRoomStore';
import { useVoiceRecorder, VoiceRecorderResult } from '@/hooks/useVoiceRecorder';
// DATA-SOURCE FIX: Import privateProfileStore for real user identity (age, gender, name)
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import PrivateChatView from '@/components/chatroom/PrivateChatView';
import ChatSheet from '@/components/chatroom/ChatSheet';
import { ensureStableFile, uploadMediaToConvex, uploadMediaToConvexWithProgress, UploadError, validateFileSize, FILE_SIZE_LIMITS_DISPLAY } from '@/lib/uploadUtils';
import * as Sentry from '@sentry/react-native';
import { setCurrentFeature, SENTRY_FEATURES } from '@/lib/sentry';
import { preloadVideos } from '@/lib/videoCache';
import { Image as ExpoImage } from 'expo-image';
// CACHE-BUST-FIX: Import avatar utility for cache-busted URLs
import { buildCacheBustedAvatarUrl } from '@/lib/avatarUtils';
// GROUP-TIMESTAMP: Import timestamp utility
import { shouldShowTimestamp } from '@/utils/chatTime';

const C = INCOGNITO_COLORS;
const EMPTY_MESSAGES: DemoChatMessage[] = [];
const TEXT_MAX_SCALE = 1.2;
const ROOM_STATUS_ICON_SIZE = moderateScale(38, 0.25);
const EMPTY_STATE_ICON_SIZE = moderateScale(28, 0.25);
const FAILED_STATUS_TEXT_SIZE = FONT_SIZE.caption;
const MENTION_INDICATOR_SIZE = moderateScale(36, 0.25);
const MENTION_INDICATOR_OFFSET = moderateScale(34, 0.25);
const EMPTY_ICON_WRAPPER_SIZE = moderateScale(68, 0.25);

// ═══════════════════════════════════════════════════════════════════════════
// CONVEX-BACKED PERSISTENCE (Room muting + Reports)
// ═══════════════════════════════════════════════════════════════════════════

// Room muting and reports are now persisted via Convex (userRoomPrefs, userRoomReports tables)
// No more session-only in-memory storage

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS (P0 fixes)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lightweight check if a string looks like a valid Convex ID.
 * Convex IDs are base64-like strings (alphanumeric + some symbols).
 * This prevents crash from casting invalid strings as Id<'chatRooms'>.
 */
function isValidConvexId(id: string | undefined): id is string {
  if (!id || typeof id !== 'string') return false;
  // Convex IDs are typically 20+ chars, alphanumeric with some special chars
  // Reject obviously invalid: empty, too short, or containing path chars
  if (id.length < 10) return false;
  if (id.includes('/') || id.includes('\\')) return false;
  // Basic format check: should be mostly alphanumeric
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatDateLabel(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  if (isSameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// List item types for FlatList
// AVATAR-STABILITY: showAvatar is pre-computed during list building for determinism
// GROUP-TIMESTAMP: showTimestamp is pre-computed for time grouping
type ListItem =
  | { type: 'date'; id: string; label: string }
  | { type: 'message'; id: string; message: DemoChatMessage; showAvatar: boolean; showTimestamp: boolean };

interface ConvexRoomListMessage {
  _id: string;
  roomId: string;
  senderId: string;
  senderNickname?: string | null;
  senderAvatarUrl?: string | null;
  senderAvatarVersion?: number;
  senderGender?: 'male' | 'female' | 'other' | null;
  type: DemoChatMessage['type'];
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  createdAt: number;
  clientId?: string;
  replyToMessageId?: string;
  replyToSenderNickname?: string;
  replyToSnippet?: string;
  replyToType?: DemoChatMessage['replyToType'] | 'system';
  mentions?: Array<{
    userId: string;
    nickname: string;
    startIndex: number;
    endIndex: number;
  }>;
}

type RoomRole = 'owner' | 'admin' | 'member';

interface ConvexMessagesPage {
  messages: ConvexRoomListMessage[];
  hasMore: boolean;
  nextCursor?: { createdAt: number; creationTime: number } | null;
}

interface ConvexRoomPresenceEntry {
  id: string;
  displayName: string;
  avatar?: string;
  age: number;
  gender: string;
  bio?: string;
  role: RoomRole;
  lastHeartbeatAt: number;
  joinedAt: number;
}

interface ConvexRoomPresenceResult {
  online: ConvexRoomPresenceEntry[];
  recentlyLeft: ConvexRoomPresenceEntry[];
  onlineCount?: number;
}

interface ConvexMemberWithProfile {
  id: string;
  displayName: string;
  avatar?: string;
  avatarVersion?: number;
  age: number;
  gender: string;
  bio?: string;
  joinedAt: number;
  role: RoomRole;
  isOnline: boolean;
  lastActive: number;
}

interface CanonicalRoomIdentity {
  nickname: string;
  avatarUrl: string | null;
  bio: string | null;
  age?: number;
  gender?: string;
}

interface CanonicalRoomIdentityResult {
  selfUserId: string | null;
  byUserId: Record<string, CanonicalRoomIdentity>;
}

interface ConvexDmThread {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  peerGender?: 'male' | 'female' | 'other';
  lastMessage: string;
  lastMessageAt: number;
  unreadCount: number;
}

interface ConvexReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

type ConvexReactionsByMessage = Record<string, ConvexReaction[]>;

interface EffectiveUserIdResult {
  userId: string | null;
}

interface PresenceUserView {
  id: string;
  displayName: string;
  avatar?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other' | '';
  bio?: string;
  role: RoomRole;
  lastHeartbeatAt: number;
  joinedAt: number;
}

function toUiChatMessage(message: ConvexRoomListMessage): DemoChatMessage {
  return {
    id: message._id,
    roomId: message.roomId,
    senderId: message.senderId,
    senderName: message.senderNickname ?? 'User',
    senderAvatar: buildCacheBustedAvatarUrl(
      message.senderAvatarUrl,
      message.senderAvatarVersion
    ) ?? undefined,
    type: message.type,
    text: message.text,
    mediaUrl: message.imageUrl,
    audioUrl: message.audioUrl,
    createdAt: message.createdAt,
    replyToMessageId: message.replyToMessageId,
    replyToSenderNickname: message.replyToSenderNickname,
    replyToSnippet: message.replyToSnippet,
    replyToType:
      message.replyToType === 'system' ? undefined : message.replyToType,
    mentions: message.mentions?.map((mention) => ({
      userId: mention.userId,
      nickname: mention.nickname,
      startIndex: mention.startIndex,
      endIndex: mention.endIndex,
    })),
    senderGender: message.senderGender ?? undefined,
  };
}

function mergeMessagesById(messages: DemoChatMessage[]): DemoChatMessage[] {
  const byId = new Map<string, DemoChatMessage>();
  for (const message of messages) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
}

// Build list items with date separators (normal order, NOT reversed)
// P1 CR-006: Use index in date separator ID to avoid key collisions
// AVATAR-STABILITY: Pre-compute showAvatar for each message based on grouping rule:
// Show avatar on the FIRST message of a consecutive group (visually at top in inverted list)
// In chronological order: show avatar when PREVIOUS message is from different sender OR it's the first message
// GROUP-TIMESTAMP: Pre-compute showTimestamp using shouldShowTimestamp utility
function buildListItems(messages: DemoChatMessage[]): ListItem[] {
  const items: ListItem[] = [];
  let lastDateLabel = '';
  let dateIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const label = formatDateLabel(msg.createdAt);
    if (label !== lastDateLabel) {
      items.push({ type: 'date', id: `date_${dateIndex++}_${msg.createdAt}`, label });
      lastDateLabel = label;
    }

    // AVATAR-GROUPING-FIX: Compute showAvatar deterministically
    // Show avatar on FIRST message of consecutive group from same sender
    // In chronological order: show avatar when PREVIOUS message is from different sender OR it's the first message
    // This places the avatar at the TOP of each sender's consecutive group in the visual inverted list
    const prevMsg = i > 0 ? messages[i - 1] : null;
    const isFirstInGroup = !prevMsg || prevMsg.senderId !== msg.senderId;
    const showAvatar = isFirstInGroup;

    // GROUP-TIMESTAMP: Compute showTimestamp for group chat (show every 5+ minutes or day change)
    const showTimestamp = shouldShowTimestamp(msg.createdAt, prevMsg?.createdAt);

    items.push({ type: 'message', id: msg.id, message: msg, showAvatar, showTimestamp });
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERLAY TYPE
// ═══════════════════════════════════════════════════════════════════════════

type Overlay =
  | 'none'
  | 'profile'
  | 'messages'
  | 'mentions'
  | 'onlineUsers'
  | 'messageActions'
  | 'userProfile'
  | 'viewProfile'
  | 'report'
  | 'attachment'
  | 'doodle';

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function ChatRoomScreen() {
  // B2-HIGH FIX: Prevent setState-after-unmount
  const mountedRef = useRef(true);
  // Synchronous guard against double-tap send (React state is async and race-prone)
  const isSendingRef = useRef(false);
  // MEDIA-RELIABILITY: Synchronous guard against double-tap media send
  const isSendingMediaRef = useRef(false);
  // MEDIA-RELIABILITY: Track currently uploading media URI to prevent duplicate uploads
  const uploadingMediaUriRef = useRef<string | null>(null);
  // MEDIA-RELIABILITY: Synchronous guard against double-tap voice send
  const isSendingVoiceRef = useRef(false);
  // CHATROOM_ACTIVITY_HEARTBEAT_REMOVED: Activity-based heartbeat removed, using timer-based only

  // ISSUE B: Read route params for instant render fallback
  // MENTION-NAV: Added targetMessageId for navigating to specific message from mention tap
  const { roomId, roomName: routeRoomName, isPrivate: routeIsPrivate, targetMessageId: routeTargetMessageId } = useLocalSearchParams<{
    roomId: string;
    roomName?: string;
    isPrivate?: string;
    targetMessageId?: string;
  }>();
  const router = useRouter();
  const convex = useConvex();
  const insets = useSafeAreaInsets();
  // The Phase-2 tab bar already reserves the bottom safe-area inset.
  // Adding it again here double-counts the inset and creates a visible
  // gap between the composer and tab bar, especially on Samsung devices.
  const footerInsetSpacing = 0;

  // ─────────────────────────────────────────────────────────────────────────
  // P0 FIX: Normalize and validate roomId before any usage
  // ─────────────────────────────────────────────────────────────────────────
  // Normalize: useLocalSearchParams can return string | string[] | undefined
  const roomIdStr = typeof roomId === 'string' ? roomId : Array.isArray(roomId) ? roomId[0] : undefined;

  if (__DEV__) console.log('ROOM ID SENT', roomIdStr);

  /** Basic sanity for getRoom — avoids calling Convex with garbage / too-short strings */
  const isValidRoomId =
    typeof roomIdStr === 'string' &&
    roomIdStr.length > 10;

  // For demo mode: any non-empty string is valid (demo rooms use simple IDs like "room_global")
  // For Convex mode: must pass isValidConvexId check
  const hasValidRoomId = !!roomIdStr && (isDemoMode || isValidConvexId(roomIdStr));

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH & SESSION
  // ─────────────────────────────────────────────────────────────────────────
  const authUserId = useAuthStore((s) => s.userId);

  /** listMessages only — same sanity as getRoom; independent of membership gate */
  const canLoadMessages =
    typeof roomIdStr === 'string' &&
    roomIdStr.length > 10 &&
    !!authUserId;

  const themeColors = useChatThemeColors();
  const enterRoom = useChatRoomSessionStore((s) => s.enterRoom);
  const exitRoom = useChatRoomSessionStore((s) => s.exitRoom);
  const incrementCoins = useChatRoomSessionStore((s) => s.incrementCoins);
  const userCoinsFromStore = useChatRoomSessionStore((s) => s.coins);

  // ─────────────────────────────────────────────────────────────────────────
  // CHAT ROOM IDENTITY (Convex-backed - separate from main profile)
  // ─────────────────────────────────────────────────────────────────────────
  const chatRoomProfile = useQuery(
    api.chatRooms.getChatRoomProfile,
    authUserId ? { authUserId } : 'skip'
  );
  // Use chat room profile for display (NEVER fall back to main profile)
  const myNickname = chatRoomProfile?.nickname ?? 'Anonymous';
  // CACHE-BUST-FIX: Use cache-busted avatar URL to ensure updated avatars display immediately
  const myAvatarUrl = buildCacheBustedAvatarUrl(
    chatRoomProfile?.avatarUrl,
    chatRoomProfile?.avatarVersion
  ) ?? null;
  const myBio = chatRoomProfile?.bio ?? null;

  // CHATROOM_IDENTITY_STORE_RENDER_BLOCKED:
  // Local store persistence is disabled for strict canonical identity.

  // (store rehydrate disabled)

  // CHATROOM_IDENTITY_CACHE: Stable identity values (prefer Convex, fallback to store)
  // This is the single source of truth for current user's chat-room identity
  // CHATROOM_IDENTITY_FALLBACK_BLOCKED: No store fallback for name/photo/bio rendering.
  // Convex chatRoomProfile is canonical for self; placeholders are used until it loads.
  const stableNickname = chatRoomProfile?.nickname || null;
  const stableAvatarUrl = myAvatarUrl || null;
  const stableBio = chatRoomProfile?.bio || null;

  // Canonical surface check.
  useEffect(() => {
    if (__DEV__) console.log('CHATROOM_IDENTITY_CANONICAL_SURFACE_CHECK', {
      surface: '[roomId]_self_identity',
      nicknameSource: chatRoomProfile?.nickname ? 'convex_chatRoomProfile' : 'placeholder',
      avatarSource: chatRoomProfile?.avatarUrl ? 'convex_chatRoomProfile' : 'placeholder',
      bioSource: chatRoomProfile?.bio ? 'convex_chatRoomProfile' : 'none',
    });
  }, [chatRoomProfile]);

  // DATA-SOURCE FIX: Get real user identity from privateProfileStore (for age/gender only)
  // NOTE: We NO LONGER use realDisplayName, realPhotoUrls, realBio in Chat Rooms!
  const realAge = usePrivateProfileStore((s) => s.age);
  const realGender = usePrivateProfileStore((s) => s.gender);
  // CHATROOM_IDENTITY_FALLBACK_BLOCKED: Main profile name/photo/bio must never be used in Chat Rooms.

  // DM store - for Modal-based private chat (no navigation, just state)
  // DM-ID-FIX: Now includes threadId for Convex backend sync
  const activeDm = useChatRoomDmStore((s) => s.activeDm);
  const activeThreadId = useChatRoomDmStore((s) => s.activeThreadId);
  const setActiveDm = useChatRoomDmStore((s) => s.setActiveDm);
  const clearActiveDm = useChatRoomDmStore((s) => s.clearActiveDm);
  // Track if Private Chat DM modal is open (hides chat room composer)
  const isPrivateChatOpen = activeDm !== null;

  // DM-ID-FIX: Mutation to get/create DM thread
  const getOrCreateDmThread = useMutation(api.chatRooms.getOrCreateDmThread);

  // Demo mode: first try local room data
  const demoRoom = roomIdStr ? DEMO_CHAT_ROOMS.find((r) => r.id === roomIdStr) : undefined;

  // Phase-2 FIX: In demo mode, if room not found in DEMO_CHAT_ROOMS but roomId looks like
  // a valid Convex ID, query Convex (for private rooms created in demo mode)
  const shouldQueryConvexInDemo = isDemoMode && !demoRoom && isValidConvexId(roomIdStr);

  // Convex queries: skip if (demo mode AND found in demo data) OR invalid roomId OR auth missing
  // Query Convex if: (1) not demo mode, or (2) demo mode but room not in demo list
  // LOGOUT-RACE FIX: Also skip when auth is missing to prevent "Unauthorized" errors during logout
  const shouldSkipConvex = (isDemoMode && !!demoRoom) || !hasValidRoomId || (!isDemoMode && !authUserId);

  // ─────────────────────────────────────────────────────────────────────────
  // MEMBERSHIP GATE: Check access status BEFORE running protected queries
  // This query is lightweight and doesn't require membership - it CHECKS membership.
  // Protected queries will only run once membership is confirmed (either existing or after join).
  // ─────────────────────────────────────────────────────────────────────────
  const accessStatusQuery = useQuery(
    api.chatRooms.checkRoomAccess,
    shouldSkipConvex ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  );
  // Phase-2: Route param is the earliest reliable public/private hint (set by the list screen).
  const isPublicFromRoute = routeIsPrivate === '0';

  // Core room doc: only call getRoom with sane id + auth (never rely on membership gate here;
  // backend returns null for no access — avoids invalid id reaching Convex)
  const convexRoom = useQuery(
    api.chatRooms.getRoom,
    isValidRoomId && authUserId
      ? { roomId: roomIdStr, authUserId }
      : 'skip'
  ) as Doc<'chatRooms'> | null | undefined;
  const convexMessagesResult = useQuery(
    api.chatRooms.listMessages,
    canLoadMessages
      ? { roomId: roomIdStr, authUserId, limit: 50 }
      : 'skip'
  ) as ConvexMessagesPage | undefined;

  const isPublicFromQuery = !!convexRoom && convexRoom.isPublic === true;
  const isPublicRoom = isPublicFromQuery || isPublicFromRoute;

  // PUBLIC ROOM BOOTSTRAP: allow access/presence earlier for known-public rooms.
  const optimisticPublicAccess = !isDemoMode && isPublicRoom && !!authUserId && hasValidRoomId;

  if (__DEV__) console.log('CHATROOM_PUBLIC_PRIVATE_BOOTSTRAP_DIFF', {
    roomId: roomIdStr,
    isPublicRoom,
    optimisticPublicAccess,
    accessStatus: accessStatusQuery?.status ?? null,
  });

  // Membership confirmed when checkRoomAccess returns 'member'/'owner_bypass'
  // OR optimistically for public rooms (public rooms don't require membership to read presence).
  const hasMemberAccess =
    accessStatusQuery?.status === 'member' ||
    accessStatusQuery?.status === 'owner_bypass' ||
    optimisticPublicAccess;

  // Protected queries require membership - skip until access confirmed
  // This prevents "must join first" errors during the join race condition
  const shouldSkipProtectedQueries = shouldSkipConvex || !hasMemberAccess;

  // Convex mutations
  const sendMessageMutation = useMutation(api.chatRooms.sendMessage);
  const generateUploadUrlMutation = useMutation(api.chatRooms.generateUploadUrl); // CR-009: For media upload
  const joinRoomMutation = useMutation(api.chatRooms.joinRoom);
  const leaveRoomMutation = useMutation(api.chatRooms.leaveRoom);
  const closeRoomMutation = useMutation(api.chatRooms.closeRoom);
  const deleteMessageMutation = useMutation(api.chatRooms.deleteMessage);
  const addReactionMutation = useMutation(api.chatRooms.addReaction);
  const removeReactionMutation = useMutation(api.chatRooms.removeReaction);

  // Room preferences (muting) and reports - Convex-backed persistence
  const setUserRoomMutedMutation = useMutation(api.chatRooms.setUserRoomMuted);
  const markReportedRoomMutation = useMutation(api.chatRooms.markReportedRoom);
  const submitChatRoomReportMutation = useMutation(api.chatRooms.submitChatRoomReport);

  // ─────────────────────────────────────────────────────────────────────────
  // ROOM-SPECIFIC PRESENCE: Heartbeat system for real-time online tracking
  // ─────────────────────────────────────────────────────────────────────────
  const heartbeatPresenceMutation = useMutation(api.chatRooms.heartbeatPresence);
  // NOTE: clearRoomPresence removed - we rely on 2-minute timeout for offline transition
  // HIDE-VS-DELETE-FIX: Mutation to hide DM thread from list (not delete)
  const hideDmThreadMutation = useMutation(api.chatRooms.hideDmThread);

  // FIX 1 — PUBLIC ROOM INSTANT PRESENCE
  // Presence can start immediately for known-public rooms (route param), without waiting for hasMemberAccess.
  const canFetchPresenceEarly = !isDemoMode && hasValidRoomId && !!authUserId && isPublicFromRoute;
  const shouldSkipPresence = shouldSkipConvex || (!canFetchPresenceEarly && !hasMemberAccess);

  if (__DEV__) console.log('CHATROOM_BOOTSTRAP_PARALLEL', {
    roomId: roomIdStr,
    isPublicFromRoute,
    isPublicFromQuery,
    canFetchPresenceEarly,
    hasMemberAccess,
    shouldSkipPresence,
  });

  // Query room presence state (for member list Online/Recently Left sections)
  const roomPresenceQuery = useQuery(
    api.chatRooms.getRoomPresence,
    shouldSkipPresence ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  ) as ConvexRoomPresenceResult | undefined;
  const roomOnlineCount = roomPresenceQuery?.onlineCount ?? roomPresenceQuery?.online.length ?? 0;

  // Skip queries that require userId in demo mode (no real user identity)
  const shouldSkipUserIdQueries = isDemoMode || !authUserId;

  // Query room mute preference (Convex-backed)
  const roomPrefQuery = useQuery(
    api.chatRooms.getUserRoomPref,
    shouldSkipProtectedQueries ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  );
  const isRoomMutedFromConvex = roomPrefQuery?.muted ?? false;

  // Query if room has been reported (Convex-backed)
  const reportedQuery = useQuery(
    api.chatRooms.hasReportedRoom,
    shouldSkipProtectedQueries ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  );
  const hasReportedRoom = reportedQuery?.reported ?? false;

  // Phase-2: Query user's penalty status in this room
  // SECURITY: getUserPenalty requires membership - use protected skip
  const userPenalty = useQuery(
    api.chatRooms.getUserPenalty,
    shouldSkipProtectedQueries ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  );

  // MEMBER-DATA FIX: Query real room members with profile data from Convex
  // Requires membership - use protected skip
  const convexMembersWithProfiles = useQuery(
    api.chatRooms.listMembersWithProfiles,
    shouldSkipProtectedQueries ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  ) as ConvexMemberWithProfile[] | undefined;

  const canonicalRoomIdentities = useQuery(
    api.chatRooms.getRoomUserIdentities,
    !isDemoMode && authUserId && hasValidRoomId
      ? { roomId: roomIdStr, authUserId }
      : 'skip'
  ) as CanonicalRoomIdentityResult | undefined;

  const selfUserIdFromCanonical = !isDemoMode
    ? ((canonicalRoomIdentities as any)?.selfUserId as string | null | undefined) ?? null
    : null;

  useEffect(() => {
    if (!isDemoMode && isPublicRoom) {
      if (__DEV__) console.log('CHATROOM_PUBLIC_ROOM_SELF_BOOTSTRAP', {
        roomId: roomIdStr,
        canonicalSelfUserId: selfUserIdFromCanonical ? selfUserIdFromCanonical.slice(0, 12) : null,
        hasCurrentUserChatProfile: !!chatRoomProfile,
        currentUserHasAvatar: !!myAvatarUrl,
      });
    }
  }, [chatRoomProfile, isDemoMode, isPublicRoom, myAvatarUrl, roomIdStr, selfUserIdFromCanonical]);

  // ─────────────────────────────────────────────────────────────────────────
  // PER-USER MUTING: Query muted users from Convex (persistent, per-room)
  // ─────────────────────────────────────────────────────────────────────────
  const mutedUsersQuery = useQuery(
    api.chatRooms.getMutedUsersInRoom,
    shouldSkipProtectedQueries ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  );
  const toggleMuteUserMutation = useMutation(api.chatRooms.toggleMuteUserInRoom);

  // Unified room object: prefer demoRoom if found, else use convexRoom
  const room = demoRoom ?? convexRoom;

  // Phase-2: Determine if this is a private room (for hiding inbox/notifications)
  // ISSUE B: Use route param as fallback for instant render
  const isPrivateRoom = convexRoom
    ? convexRoom.isPublic === false
    : routeIsPrivate === '1';

  // Phase-2: Get effective userId (for demo mode owner detection)
  // CONTRACT FIX: getEffectiveUserId expects { isDemo?, demoUserId? }, not { authUserId }
  const effectiveUserIdQuery = useQuery(
    api.chatRooms.getEffectiveUserId,
    authUserId
      ? (isDemoMode
        ? { isDemo: true, demoUserId: authUserId }
        : { isDemo: false }) // Non-demo: backend uses ctx.auth.getUserIdentity()
      : 'skip'
  ) as EffectiveUserIdResult | undefined;
  const effectiveUserId = effectiveUserIdQuery?.userId ?? null;

  useEffect(() => {
    if (__DEV__) console.log('CHATROOM_EFFECTIVE_USER_ID_REASON', {
      roomId: roomIdStr,
      authUserIdPresent: !!authUserId,
      effectiveUserId: effectiveUserId ? String(effectiveUserId).slice(0, 12) : null,
      canonicalSelfUserId: selfUserIdFromCanonical ? selfUserIdFromCanonical.slice(0, 12) : null,
      hasCurrentUserChatProfile: !!chatRoomProfile,
      currentUserNickname: myNickname,
      currentUserHasAvatar: !!myAvatarUrl,
    });
  }, [authUserId, chatRoomProfile, effectiveUserId, myAvatarUrl, myNickname, roomIdStr, selfUserIdFromCanonical]);

  // Phase-2: Check if current user is the room creator (use effectiveUserId for demo mode)
  const isRoomCreator = effectiveUserId
    ? convexRoom?.createdBy === effectiveUserId
    : convexRoom?.createdBy === authUserId;

  // ROLE SYSTEM: Query current user's role and moderation capability
  const memberRoleQuery = useQuery(
    api.chatRooms.getMemberRole,
    hasValidRoomId && authUserId
      ? { roomId: roomIdStr as Id<'chatRooms'>, authUserId }
      : 'skip'
  );
  // canModerate: true if user can delete others' messages / kick users
  // - In public/platform rooms: platform admins can moderate
  // - In private rooms: owners and admins can moderate
  // Default to true for room creator (for UI responsiveness before query loads)
  const canModerate: boolean = memberRoleQuery?.canModerate ?? isRoomCreator;

  // Phase-2: Check if user has an active send-blocking penalty (muted, readOnly, send_blocked)
  // L-002 FIX: Renamed from isReadOnly to hasSendPenalty for clarity
  const hasSendPenalty = userPenalty !== null && userPenalty !== undefined;

  // Phase-2: Query room password (owner only, for display in profile menu)
  // AUTH-FIX: Pass authUserId for custom session-based auth in non-demo mode
  const roomPasswordQuery = useQuery(
    api.chatRooms.getRoomPassword,
    isPrivateRoom && isRoomCreator && hasValidRoomId && authUserId
      ? {
          roomId: roomIdStr as Id<'chatRooms'>,
          ...(isDemoMode
            ? { isDemo: true, demoUserId: authUserId }
            : { authUserId }), // AUTH-FIX: Pass authUserId in non-demo mode
        }
      : 'skip'
  );
  const roomPassword = roomPasswordQuery?.password ?? null;

  // WALLET-FIX: Query user's wallet coins from Convex (source of truth in real mode)
  // This reactive query auto-updates when walletCoins changes in backend
  const walletCoinsQuery = useQuery(
    api.chatRooms.getUserWalletCoins,
    !isDemoMode && authUserId ? { authUserId } : 'skip'
  );
  const convexWalletCoins = walletCoinsQuery?.walletCoins ?? 0;

  // B2-HIGH FIX: Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // SENTRY-FILTER: Set feature tag on mount, clear on unmount
  useEffect(() => {
    // Set current feature to chat_rooms for Sentry filtering
    setCurrentFeature(SENTRY_FEATURES.CHAT_ROOMS);
    Sentry.setTag('feature', SENTRY_FEATURES.CHAT_ROOMS);
    Sentry.setContext('chat_rooms', {
      screen: 'room',
      roomId: roomIdStr,
    });

    return () => {
      // Clear feature on unmount
      setCurrentFeature(null);
    };
  }, [roomIdStr]);

  // LOGOUT-RACE FIX: Navigate away when auth is lost while screen is mounted
  // This prevents protected queries from erroring during logout transition
  useEffect(() => {
    // Only applies in non-demo mode when auth is lost
    if (isDemoMode) return;
    if (authUserId) return; // Auth still present, nothing to do

    // Auth is missing - user logged out while viewing this screen
    // Navigate to a safe route (phase-2 home which doesn't require room auth)
    router.replace('/(main)/(private)/(tabs)/deep-connect');
  }, [authUserId, router]);

  // ─────────────────────────────────────────────────────────────────────────
  // COUNTDOWN TIMER (for expiring rooms)
  // ST-003 FIX: Use ref to ensure only one interval exists at a time
  // ─────────────────────────────────────────────────────────────────────────
  const [nowMs, setNowMs] = useState(Date.now());
  const expiresAt = convexRoom?.expiresAt;
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // ST-003 FIX: Always clear previous interval before creating new one
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    if (!expiresAt) return;

    countdownIntervalRef.current = setInterval(() => {
      if (mountedRef.current) setNowMs(Date.now());
    }, 1000);

    // ST-003 FIX: Guaranteed cleanup on unmount or expiresAt change
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [expiresAt]);

  // Format remaining time as HH:MM:SS
  const countdownText = useMemo(() => {
    if (!expiresAt) return null;
    const remainingMs = Math.max(0, expiresAt - nowMs);
    if (remainingMs <= 0) return '00:00:00';
    const totalSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [expiresAt, nowMs]);

  // ─────────────────────────────────────────────────────────────────────────
  // MOUNTED GUARD (M-002 FIX: Removed duplicate - using mountedRef from line 172)
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // PREFERRED ROOM STORE (for auto-redirect on next visit)
  // MEMBERSHIP LIFECYCLE: setCurrentRoom tracks which room user is viewing
  // ─────────────────────────────────────────────────────────────────────────
  const setPreferredRoom = usePreferredChatRoomStore((s) => s.setPreferredRoom);
  const clearPreferredRoom = usePreferredChatRoomStore((s) => s.clearPreferredRoom);
  const setCurrentRoom = usePreferredChatRoomStore((s) => s.setCurrentRoom);
  const setHasRedirectedInSession = usePreferredChatRoomStore((s) => s.setHasRedirectedInSession);
  const setPreferredRoomMutation = useMutation(api.users.setPreferredChatRoom);
  const clearPreferredRoomMutation = useMutation(api.users.clearPreferredChatRoom);

  // ─────────────────────────────────────────────────────────────────────────
  // ENTER ROOM SESSION + SAVE AS PREFERRED
  // ─────────────────────────────────────────────────────────────────────────
  const enteredRoomRef = useRef<string | null>(null);
  useEffect(() => {
    const canEnterRoom = isDemoMode || hasMemberAccess;
    if (roomIdStr && canEnterRoom) {
      if (enteredRoomRef.current === roomIdStr) return;
      enteredRoomRef.current = roomIdStr;

      // CHAT ROOM IDENTITY: Use myNickname/myAvatarUrl from Convex chatRoomProfiles
      // NOT main profile data (realDisplayName, realPhotoUrls, etc.)
      const identity = isDemoMode
        ? {
            userId: DEMO_CURRENT_USER.id,
            name: myNickname,
            age: DEMO_CURRENT_USER.age ?? 25,
            gender: DEMO_CURRENT_USER.gender ?? 'Unknown',
            profilePicture: myAvatarUrl ?? '',
          }
        : {
            userId: authUserId ?? 'unknown',
            name: myNickname,
            age: 0,
            gender: '',
            profilePicture: myAvatarUrl ?? '',
          };
      enterRoom(roomIdStr, identity);
      setCurrentRoom(roomIdStr);

      // Save as preferred room (for auto-redirect on next visit)
      if (isDemoMode) {
        setPreferredRoom(roomIdStr);
      } else if (authUserId && hasValidRoomId && hasMemberAccess) {
        // Convex mode: save to server (fire-and-forget)
        // CR-017 FIX: Use authUserId for server-side verification
        setPreferredRoomMutation({
          authUserId: authUserId,
          roomId: roomIdStr as Id<'chatRooms'>,
        }).catch(() => {
          // Ignore errors - preferred room is a nice-to-have
        });
      }
    }
  }, [roomIdStr, isDemoMode, hasMemberAccess, enterRoom, authUserId, hasValidRoomId, setPreferredRoom, setPreferredRoomMutation, myNickname, myAvatarUrl, setCurrentRoom]);

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE-2 BACK NAVIGATION: Go to Deep Connect (not chat-rooms list)
  // This prevents the "loading" flash when backing out of auto-opened room.
  // Policy: Any Phase-2 screen → back → Deep Connect → back → Phase-1 Discover
  // ─────────────────────────────────────────────────────────────────────────
  const navigation = useNavigation();
  const PHASE2_HOME_ROUTE = '/(main)/(private)/(tabs)/deep-connect';

  // Android hardware back → go to Deep Connect
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBackPress = () => {
      router.replace(PHASE2_HOME_ROUTE);
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [router]);

  // iOS swipe-back / header back:
  // Minimal-risk perf fix: do NOT intercept native back. Interception can add latency.
  // Unmount lifecycle already stops heartbeat; leave mutation is fire-and-forget.


  // ─────────────────────────────────────────────────────────────────────────
  // FLATLIST REF & COMPOSER HEIGHT
  // ─────────────────────────────────────────────────────────────────────────
  const listRef = useRef<FlatList<ListItem>>(null);
  const [composerHeight, setComposerHeight] = useState(56);

  // ─────────────────────────────────────────────────────────────────────────
  // KEYBOARD HANDLING (Android fix: force layout reset when keyboard hides)
  // ─────────────────────────────────────────────────────────────────────────
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // Key to force re-render of KeyboardAvoidingView when keyboard hides on Android
  const [kavKey, setKavKey] = useState(0);

  useEffect(() => {
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setKeyboardVisible(true);
      }
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardVisible(false);
        // Android fix: Force KeyboardAvoidingView to recalculate layout
        if (Platform.OS === 'android') {
          setKavKey((k) => k + 1);
        }
      }
    );

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  // Near-bottom tracking for smart auto-scroll (don't jump when user reads older messages)
  const isNearBottomRef = useRef(true);
  const SCROLL_THRESHOLD = 120;

  // AUTO-SCROLL: Track if user just sent a message (should always scroll to see it)
  const justSentMessageRef = useRef(false);
  const prevMessagesLengthRef = useRef(0);

  // ─────────────────────────────────────────────────────────────────────────
  // SCROLL TRACKING (for inverted list, "near bottom" is near top of offset)
  // ─────────────────────────────────────────────────────────────────────────
  const handleScroll = useCallback((event: any) => {
    const { contentOffset } = event.nativeEvent;
    // In inverted list, offset near 0 means we're at the "bottom" (latest messages)
    const wasNearBottom = isNearBottomRef.current;
    isNearBottomRef.current = contentOffset.y < SCROLL_THRESHOLD;
    // CHATROOM_ACTIVITY_HEARTBEAT_REMOVED: Activity heartbeat on scroll removed, using timer-based only
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGES (Demo store or Convex)
  // ─────────────────────────────────────────────────────────────────────────
  const seedRoom = useDemoChatRoomStore((s) => s.seedRoom);
  const addStoreMessage = useDemoChatRoomStore((s) => s.addMessage);
  const setStoreMessages = useDemoChatRoomStore((s) => s.setMessages);
  const demoMessages = useDemoChatRoomStore((s) => (roomIdStr ? s.rooms[roomIdStr] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  // P1 CR-004: Track hydration state to prevent seeding before store is ready
  const storeHasHydrated = useDemoChatRoomStore((s) => s._hasHydrated);

  const [pendingMessages, setPendingMessages] = useState<DemoChatMessage[]>([]);
  const [pendingMediaMessages, setPendingMediaMessages] = useState<DemoChatMessage[]>([]);
  const lastProgressUpdateAtRef = useRef<Map<string, number>>(new Map());
  const PROGRESS_UPDATE_INTERVAL_MS = 100;
  const [olderMessages, setOlderMessages] = useState<DemoChatMessage[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
  const olderMessagesRef = useRef<DemoChatMessage[]>([]);
  const hasOlderMessagesRef = useRef(false);
  const isLoadingOlderMessagesRef = useRef(false);
  const liveMessagesRef = useRef<DemoChatMessage[]>([]);

  // SEND-FLICKER-FIX: Track pending clientIds that have been "sent" (mutation succeeded)
  // but we're waiting for server message to arrive before removing from UI
  const pendingSentClientIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    olderMessagesRef.current = olderMessages;
  }, [olderMessages]);

  useEffect(() => {
    hasOlderMessagesRef.current = hasOlderMessages;
  }, [hasOlderMessages]);

  useEffect(() => {
    isLoadingOlderMessagesRef.current = isLoadingOlderMessages;
  }, [isLoadingOlderMessages]);

  useEffect(() => {
    if (isDemoMode) {
      olderMessagesRef.current = [];
      hasOlderMessagesRef.current = false;
      isLoadingOlderMessagesRef.current = false;
      setOlderMessages([]);
      setHasOlderMessages(false);
      setLoadOlderError(null);
      return;
    }

    olderMessagesRef.current = [];
    hasOlderMessagesRef.current = false;
    isLoadingOlderMessagesRef.current = false;
    setOlderMessages([]);
    setHasOlderMessages(false);
    setLoadOlderError(null);
  }, [roomIdStr, isDemoMode]);

  useEffect(() => {
    if (isDemoMode || olderMessagesRef.current.length > 0) {
      return;
    }
    setHasOlderMessages(convexMessagesResult?.hasMore ?? false);
  }, [isDemoMode, convexMessagesResult?.hasMore]);

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGES: Transform Convex messages to UI format
  // SEND-FLICKER-FIX: Improved dedup to prevent ghost/duplicate frames during send
  // ─────────────────────────────────────────────────────────────────────────
  const liveMessages: DemoChatMessage[] = useMemo(() => {
    if (isDemoMode) return demoMessages;
    const convexMsgs: ConvexRoomListMessage[] = convexMessagesResult?.messages ?? [];

    // Build set of pending clientIds for dedup (text + media)
    const pendingClientIds = new Set(
      [...pendingMessages, ...pendingMediaMessages].map((m) => m.id.replace('pending_', ''))
    );

    // SEND-FLICKER-FIX: Check which pending messages now have server equivalents
    // Remove pending messages whose server message has arrived
    const serverClientIds = new Set(
      convexMsgs.filter((m) => m.clientId).map((m) => m.clientId!)
    );
    const arrivedClientIds: string[] = [];
    pendingClientIds.forEach((clientId) => {
      if (serverClientIds.has(clientId)) {
        arrivedClientIds.push(clientId);
      }
    });

    // SEND-FLICKER-FIX: Auto-cleanup pending messages whose server equivalent has arrived
    // This is done via effect to avoid setState during render
    if (arrivedClientIds.length > 0) {
      arrivedClientIds.forEach(id => pendingSentClientIdsRef.current.add(id));
    }

    // Dedup: filter out server messages that match pending clientIds (pending takes precedence during optimistic window)
    // BUT if the server message has arrived, prefer the server message (don't show both)
    const deduped = convexMsgs.filter((m) => {
      if (!m.clientId) return true; // No clientId means not from optimistic send
      const isPending = pendingClientIds.has(m.clientId);
      const hasArrived = arrivedClientIds.includes(m.clientId);
      // Show server message only if: not pending OR has arrived (will clean up pending in effect)
      return !isPending || hasArrived;
    });

    return deduped.map((message) => toUiChatMessage(message));
  }, [isDemoMode, demoMessages, convexMessagesResult, pendingMessages, pendingMediaMessages]);

  useEffect(() => {
    liveMessagesRef.current = liveMessages;
  }, [liveMessages]);

  const messages: DemoChatMessage[] = useMemo(() => {
    if (isDemoMode) {
      return demoMessages;
    }

    const filteredPending = pendingMessages.filter((message) => {
      const clientId = message.id.replace('pending_', '');
      return !pendingSentClientIdsRef.current.has(clientId);
    });
    const filteredPendingMedia = pendingMediaMessages.filter((message) => {
      const clientId = message.id.replace('pending_', '');
      return !pendingSentClientIdsRef.current.has(clientId);
    });

    return mergeMessagesById([
      ...olderMessages,
      ...liveMessages,
      ...filteredPending,
      ...filteredPendingMedia,
    ]);
  }, [isDemoMode, demoMessages, olderMessages, liveMessages, pendingMessages, pendingMediaMessages]);

  const messageIdsForReactions = useMemo(() => {
    if (isDemoMode) return [];
    return messages
      .map((message) => message.id)
      .filter((messageId): messageId is Id<'chatRoomMessages'> =>
        !messageId.startsWith('pending_') && isValidConvexId(messageId)
      );
  }, [isDemoMode, messages]);

  const reactionsQuery = useQuery(
    api.chatRooms.getReactionsForMessages,
    !isDemoMode && messageIdsForReactions.length > 0 && !shouldSkipProtectedQueries
      ? { roomId: roomIdStr as Id<'chatRooms'>, messageIds: messageIdsForReactions, authUserId: authUserId! }
      : 'skip'
  ) as ConvexReactionsByMessage | undefined;

  // P0-FIX: Create a map of reactions by message ID for efficient lookup
  // P3-FIX: Include isUserReaction for proper typing
  const reactionsMap = useMemo(() => {
    if (!reactionsQuery) return new Map<string, { emoji: string; count: number; userIds: string[]; isUserReaction: boolean }[]>();
    const map = new Map<string, { emoji: string; count: number; userIds: string[]; isUserReaction: boolean }[]>();
    for (const [messageId, reactions] of Object.entries(reactionsQuery)) {
      const mappedReactions = reactions.map((r) => ({
        ...r,
        isUserReaction: effectiveUserId ? r.userIds.includes(effectiveUserId) : false,
      }));
      map.set(messageId, mappedReactions);
    }
    return map;
  }, [effectiveUserId, reactionsQuery]);

  // SEND-FLICKER-FIX: Effect to clean up pending messages after server messages arrive
  // This runs after render to avoid setState during render
  useEffect(() => {
    if (pendingSentClientIdsRef.current.size === 0) return;

    const toCleanup = Array.from(pendingSentClientIdsRef.current);
    pendingSentClientIdsRef.current.clear();

    // Schedule cleanup for next tick to ensure stable render
    requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      setPendingMessages(prev => {
        const cleaned = prev.filter(m => {
          const clientId = m.id.replace('pending_', '');
          return !toCleanup.includes(clientId);
        });
        return cleaned;
      });
      setPendingMediaMessages(prev => {
        const cleaned = prev.filter(m => {
          const clientId = m.id.replace('pending_', '');
          return !toCleanup.includes(clientId);
        });
        return cleaned;
      });
    });
  }, [convexMessagesResult]);

  const fetchOlderMessagesPage = useCallback(
    async (before: number) => {
      if (isDemoMode || !canLoadMessages || !hasValidRoomId) {
        return null;
      }

      const page = await convex.query(api.chatRooms.listMessages, {
        roomId: roomIdStr,
        authUserId,
        limit: 50,
      }) as ConvexMessagesPage;

      const converted = page.messages.map((message) =>
        toUiChatMessage(message)
      );

      const nextOlderMessages = mergeMessagesById([
        ...converted,
        ...olderMessagesRef.current,
      ]);
      olderMessagesRef.current = nextOlderMessages;
      hasOlderMessagesRef.current = page.hasMore;

      setOlderMessages(nextOlderMessages);
      setHasOlderMessages(page.hasMore);
      setLoadOlderError(null);

      return {
        messages: converted,
        hasMore: page.hasMore,
      };
    },
    [authUserId, convex, canLoadMessages, hasValidRoomId, isDemoMode, roomIdStr]
  );

  const handleLoadOlderMessages = useCallback(async () => {
    if (isLoadingOlderMessagesRef.current || !hasOlderMessagesRef.current) {
      return;
    }

    const before =
      olderMessagesRef.current[0]?.createdAt !== undefined
        ? olderMessagesRef.current[0].createdAt + 1
        : liveMessagesRef.current[0]?.createdAt !== undefined
          ? liveMessagesRef.current[0].createdAt + 1
          : undefined;
    if (!before) {
      return;
    }

    setIsLoadingOlderMessages(true);
    isLoadingOlderMessagesRef.current = true;
    setLoadOlderError(null);

    try {
      await fetchOlderMessagesPage(before);
    } catch (error) {
      if (__DEV__) {
        console.warn('[CHAT_ROOM] Failed to load older messages:', error);
      }
      if (mountedRef.current) {
        setLoadOlderError("Couldn't load older messages.");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoadingOlderMessages(false);
      }
      isLoadingOlderMessagesRef.current = false;
    }
  }, [fetchOlderMessagesPage]);

  // ─────────────────────────────────────────────────────────────────────────
  // MEDIA PRELOADING: Cache all media from visible messages for instant open
  // Handles videos, images, doodles, and audio for premium feel
  //
  // LOAD-FIRST UX (Option A): When `LOAD_FIRST_MEDIA` is enabled, eager
  // prefetch of remote photos/videos is disabled. Each MediaMessage tile
  // shows a "Tap to load" arrow and downloads on demand via mediaCache —
  // matches WhatsApp/Telegram behavior and avoids burning bandwidth on
  // media the user never opens. DOODLES are intentionally kept on the
  // fast path (they're tiny and the "preserve doodle paths" rule asks
  // for instant render).
  // ─────────────────────────────────────────────────────────────────────────
  const LOAD_FIRST_MEDIA = true;
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    // Extract media URLs from recent messages (last 15 for good coverage)
    const videoUrls: string[] = [];
    const imageUrls: string[] = [];
    const doodleUrls: string[] = [];
    const recentMessages = messages.slice(-15);

    for (const msg of recentMessages) {
      const url = msg.mediaUrl || msg.audioUrl;
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        continue;
      }

      switch (msg.type) {
        case 'video':
          videoUrls.push(url);
          break;
        case 'image':
          imageUrls.push(url);
          break;
        case 'doodle':
          doodleUrls.push(url);
          break;
      }
    }

    // Preload videos (non-blocking, max 2 concurrent) — skipped under LOAD_FIRST.
    if (!LOAD_FIRST_MEDIA && videoUrls.length > 0) {
      const uniqueUrls = [...new Set(videoUrls)];
      preloadVideos(uniqueUrls, 2);
    }

    // Prefetch images to expo-image cache — skipped under LOAD_FIRST.
    if (!LOAD_FIRST_MEDIA && imageUrls.length > 0) {
      const uniqueUrls = [...new Set(imageUrls)];
      ExpoImage.prefetch(uniqueUrls);
    }

    // Doodles ALWAYS prefetch (small payload + fast doodle path preserved).
    if (doodleUrls.length > 0) {
      const uniqueUrls = [...new Set(doodleUrls)];
      ExpoImage.prefetch(uniqueUrls);
    }
  }, [messages]);

  // ─────────────────────────────────────────────────────────────────────────
  // INVERTED FLATLIST: Build list items in reverse order (newest first)
  // This ensures the list always opens at the latest message without scrolling
  // ─────────────────────────────────────────────────────────────────────────
  const invertedListItems = useMemo(() => {
    // Build items in normal order, then reverse for inverted FlatList
    const items = buildListItems(messages);
    return items.slice().reverse();
  }, [messages]);

  // ─────────────────────────────────────────────────────────────────────────
  // PERF-FIX: Use refs for frequently changing data to avoid renderItem re-creation
  // ─────────────────────────────────────────────────────────────────────────
  const invertedListItemsRef = useRef(invertedListItems);
  const reactionsMapRef = useRef(reactionsMap);
  const highlightedMessageIdRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => {
    invertedListItemsRef.current = invertedListItems;
  }, [invertedListItems]);
  useEffect(() => {
    reactionsMapRef.current = reactionsMap;
  }, [reactionsMap]);

  // ─────────────────────────────────────────────────────────────────────────
  // AUTO-SCROLL: Scroll to latest message when:
  // 1. User just sent a message (always scroll to see their own message)
  // 2. New message received AND user is near bottom (don't interrupt reading old messages)
  // SEND-FLICKER-FIX: Use requestAnimationFrame to ensure scroll happens after render settles
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const currentLength = messages.length;
    const prevLength = prevMessagesLengthRef.current;
    const hasNewMessages = currentLength > prevLength;
    const justSent = justSentMessageRef.current;

    // Update previous length
    prevMessagesLengthRef.current = currentLength;

    // Scroll conditions:
    // - User just sent a message (always scroll)
    // - New message received AND near bottom (smart scroll)
    const shouldScroll = justSent || (hasNewMessages && isNearBottomRef.current);

    if (shouldScroll && listRef.current && invertedListItems.length > 0) {
      // SEND-FLICKER-FIX: Use double-RAF to ensure scroll happens AFTER layout and paint
      // First RAF gets us to "after layout", second RAF gets us to "after paint"
      let rafId1: number;
      let rafId2: number;

      rafId1 = requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        rafId2 = requestAnimationFrame(() => {
          if (!mountedRef.current) return;
          try {
            listRef.current?.scrollToIndex({
              index: 0,
              animated: true,
            });
          } catch {
            // Fallback: scroll to offset 0
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
          }
        });
      });

      // Reset the justSent flag after scrolling is scheduled
      justSentMessageRef.current = false;

      return () => {
        cancelAnimationFrame(rafId1);
        cancelAnimationFrame(rafId2);
      };
    }

    // Reset justSent flag even if we didn't scroll
    justSentMessageRef.current = false;
  }, [messages.length, invertedListItems.length]);

  // Seed demo room on mount
  // P1 CR-004: Wait for store hydration before seeding to prevent race conditions
  // P1 CR-005: Sort messages after merging to ensure correct order
  // CR-002 FIX: Single ref-based guard with deterministic fallback path
  const seedAttemptedRef = useRef(false);
  const hydrationFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDemoMode || !roomIdStr) return;
    // CR-002 FIX: Single guard prevents all double-seeding
    if (seedAttemptedRef.current) return;

    // Check if already hydrated - seed immediately
    if (storeHasHydrated) {
      seedAttemptedRef.current = true;
      const base = getDemoMessagesForRoom(roomIdStr);
      const joinMsg: DemoChatMessage = {
        id: `sys_join_${DEMO_CURRENT_USER.id}_${Date.now()}`,
        roomId: roomIdStr,
        senderId: 'system',
        senderName: 'System',
        type: 'system',
        text: `${DEMO_CURRENT_USER.username} joined the room`,
        createdAt: Date.now(),
      };
      const sorted = [...base, joinMsg].sort((a, b) => a.createdAt - b.createdAt);
      seedRoom(roomIdStr, sorted);
      return;
    }

    // CR-002 FIX: Single fallback timeout - only runs if not hydrated
    hydrationFallbackTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      if (seedAttemptedRef.current) return; // Already seeded via hydration path
      seedAttemptedRef.current = true;
      const base = getDemoMessagesForRoom(roomIdStr);
      const joinMsg: DemoChatMessage = {
        id: `sys_join_${DEMO_CURRENT_USER.id}_${Date.now()}`,
        roomId: roomIdStr,
        senderId: 'system',
        senderName: 'System',
        type: 'system',
        text: `${DEMO_CURRENT_USER.username} joined the room`,
        createdAt: Date.now(),
      };
      const sorted = [...base, joinMsg].sort((a, b) => a.createdAt - b.createdAt);
      seedRoom(roomIdStr, sorted);
    }, 3000);

    // CR-002 FIX: Guaranteed cleanup
    return () => {
      if (hydrationFallbackTimerRef.current) {
        clearTimeout(hydrationFallbackTimerRef.current);
        hydrationFallbackTimerRef.current = null;
      }
    };
  }, [roomIdStr, seedRoom, storeHasHydrated]);

  // SECURITY: Track join attempt status for access denied detection
  const [joinAttempted, setJoinAttempted] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);
  const joinTriggeredRef = useRef<string | null>(null);

  // Auto-join Convex room (skip if invalid ID)
  useEffect(() => {
    if (isDemoMode || !hasValidRoomId || !authUserId) return;
    if (!convexRoom || convexRoom.isPublic !== true) return;
    if (joinTriggeredRef.current === roomIdStr) return;
    joinTriggeredRef.current = roomIdStr;

    if (__DEV__) console.log('CHATROOM_PUBLIC_ROOM_BOOTSTRAP_START', {
      roomId: roomIdStr,
      authReady: true,
      hasCurrentUserChatProfile: !!chatRoomProfile,
    });

    if (__DEV__) console.log('CHATROOM_PUBLIC_ROOM_JOIN_DECISION', {
      roomId: roomIdStr,
      decision: 'joinRoom_idempotent',
      reason: 'ensure_membership_row_for_public_room_bootstrap',
    });

    joinRoomMutation({
      roomId: roomIdStr as Id<'chatRooms'>,
      authUserId: authUserId!, // CR-010: Pass auth for server-side verification
    })
      .then(() => {
        // Join succeeded - user now has membership
        if (mountedRef.current) {
          setJoinAttempted(true);
          setJoinFailed(false);
        }
      })
      .catch(() => {
        // Join failed - banned, room not found, or other error
        if (mountedRef.current) {
          setJoinAttempted(true);
          setJoinFailed(true);
        }
      });
  }, [roomIdStr, hasValidRoomId, authUserId, joinRoomMutation, convexRoom]);

  // ─────────────────────────────────────────────────────────────────────────
  // PRESENCE: Heartbeat timer while mounted (NOT activity-based)
  // Product rule: if user is inside the room screen, they must remain Online even when idle.
  // ─────────────────────────────────────────────────────────────────────────
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstHeartbeatAckAtRef = useRef<number | null>(null);
  const HEARTBEAT_INTERVAL_MS = 30 * 1000; // must be < backend online threshold (2 min)

  if (__DEV__) console.log('CHATROOM_PUBLIC_ROOM_MEMBER_ACCESS', {
    roomId: roomIdStr,
    accessStatus: accessStatusQuery?.status ?? null,
    hasMemberAccess,
  });

  // Heartbeat should run for public rooms immediately once isPublic is known (optimisticPublicAccess),
  // and for private rooms only after membership access is confirmed.
  const isPublicForHeartbeat = !!authUserId && hasValidRoomId && !isDemoMode && (
    (convexRoom ? convexRoom.isPublic === true : routeIsPrivate === '0')
  );
  const canHeartbeat = !isDemoMode && hasValidRoomId && !!authUserId && (isPublicForHeartbeat ? true : !!hasMemberAccess);

  const sendHeartbeatNow = useCallback((reason: string) => {
    if (!canHeartbeat) return;
    if (!mountedRef.current) return;
    if (__DEV__) console.log('CHATROOM_HEARTBEAT_SENT', { roomId: roomIdStr, reason });
    if (__DEV__) console.log('CHATROOM_PRESENCE_HEARTBEAT_TICK', {
      roomId: roomIdStr,
      reason,
      ts: Date.now(),
    });
    heartbeatPresenceMutation({
      roomId: roomIdStr as Id<'chatRooms'>,
      authUserId: authUserId!,
    }).then(() => {
      // Presence propagation gap fix: track the FIRST successful heartbeat ack
      // so we can avoid a hard-empty top-strip flash for a very short window.
      if (!firstHeartbeatAckAtRef.current) {
        firstHeartbeatAckAtRef.current = Date.now();
      }
    }).catch((err) => {
      console.log('CHATROOM_OFFLINE_REASON', {
        roomId: roomIdStr,
        reason: 'heartbeat_failed',
        message: err?.message ?? String(err),
      });
    });
  }, [authUserId, canHeartbeat, heartbeatPresenceMutation, hasMemberAccess, hasValidRoomId, isDemoMode, roomIdStr]);

  const startHeartbeatTimer = useCallback((reason: string) => {
    if (!canHeartbeat) return;
    if (heartbeatIntervalRef.current) return;
    if (__DEV__) console.log('CHATROOM_PRESENCE_HEARTBEAT_START', { roomId: roomIdStr, reason, intervalMs: HEARTBEAT_INTERVAL_MS });
    sendHeartbeatNow('start_immediate');
    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeatNow('interval');
    }, HEARTBEAT_INTERVAL_MS);
  }, [canHeartbeat, roomIdStr, sendHeartbeatNow]);

  const stopHeartbeatTimer = useCallback((reason: string) => {
    if (!heartbeatIntervalRef.current) return;
    clearInterval(heartbeatIntervalRef.current);
    heartbeatIntervalRef.current = null;
    if (__DEV__) console.log('CHATROOM_PRESENCE_HEARTBEAT_STOP', { roomId: roomIdStr, reason });
  }, [roomIdStr]);

  // CHATROOM_ACTIVITY_HEARTBEAT_REMOVED: Activity-based ref assignment removed, using timer-based only

  // Public rooms: start heartbeat as early as possible (do not wait for access query).
  useEffect(() => {
    if (!isPublicForHeartbeat) return;
    if (!canHeartbeat) return;
    if (__DEV__) console.log('CHATROOM_BOOTSTRAP_PARALLEL', { roomId: roomIdStr, isPublicForHeartbeat, hasMemberAccess });
    if (__DEV__) console.log('CHATROOM_HEARTBEAT_STARTED_EARLY_PUBLIC', { roomId: roomIdStr });
    startHeartbeatTimer('early_public_mount');
  }, [canHeartbeat, hasMemberAccess, isPublicForHeartbeat, roomIdStr, startHeartbeatTimer]);

  // Room mount/unmount lifecycle
  useEffect(() => {
    if (__DEV__) console.log('CHATROOM_ROOM_MOUNT_PRESENCE', {
      roomId: roomIdStr,
      canHeartbeat,
      hasMemberAccess,
      hasValidRoomId,
      hasAuth: !!authUserId,
    });
    startHeartbeatTimer('room_mount');
    return () => {
      if (__DEV__) console.log('CHATROOM_ROOM_UNMOUNT_PRESENCE', { roomId: roomIdStr });
      stopHeartbeatTimer('room_unmount');
    };
  }, [authUserId, canHeartbeat, hasMemberAccess, hasValidRoomId, roomIdStr, startHeartbeatTimer, stopHeartbeatTimer]);

  // ─────────────────────────────────────────────────────────────────────────
  // APP STATE HANDLING
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const appStateRef = { current: AppState.currentState };

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (!mountedRef.current) return;

      console.log('CHATROOM_APPSTATE_PRESENCE', {
        roomId: roomIdStr,
        from: appStateRef.current,
        to: nextAppState,
      });

      // Foreground: resume heartbeats immediately
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        startHeartbeatTimer('app_foreground');
        sendHeartbeatNow('app_foreground_tick');
      }

      // Background/inactive: stop timer (backend will transition to recently-left after expiry)
      if (nextAppState.match(/inactive|background/)) {
        stopHeartbeatTimer('app_background');
        console.log('CHATROOM_OFFLINE_REASON', { roomId: roomIdStr, reason: 'app_background_timer_stopped' });
      }

      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [roomIdStr, sendHeartbeatNow, startHeartbeatTimer, stopHeartbeatTimer]);

  // TAB / FOCUS transitions: log only (we keep heartbeat while mounted+foreground)
  useFocusEffect(
    useCallback(() => {
      console.log('CHATROOM_TAB_SWITCH_PRESENCE', { roomId: roomIdStr, event: 'focus' });
      console.log('CHATROOM_ONLINE_REASON', { roomId: roomIdStr, reason: 'screen_focused' });
      // Ensure timer is running (idempotent)
      startHeartbeatTimer('screen_focus');
      return () => {
        console.log('CHATROOM_TAB_SWITCH_PRESENCE', { roomId: roomIdStr, event: 'blur' });
        // Do NOT stop timer here; screen remains mounted in tab flows.
      };
    }, [roomIdStr, startHeartbeatTimer])
  );

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [inputText, setInputText] = useState('');
  // Reply-to state: track message being replied to
  const [replyToMessage, setReplyToMessage] = useState<{
    id: string;
    senderNickname: string;
    snippet: string;
  } | null>(null);
  // Highlight state: track message to highlight after scroll-to-message
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  useEffect(() => {
    highlightedMessageIdRef.current = highlightedMessageId;
  }, [highlightedMessageId]);
  // WALLET-FIX: In real mode, use Convex walletCoins (source of truth, auto-updates reactively)
  // In demo mode, use session store coins (no backend persistence)
  const userCoins = isDemoMode
    ? (userCoinsFromStore > 0 ? userCoinsFromStore : DEMO_CURRENT_USER.coins)
    : convexWalletCoins;

  // ─────────────────────────────────────────────────────────────────────────
  // PRESENCE TRUTH: Membership and presence are separate sources.
  // roomPresenceQuery drives online/recently-left state; member query drives who
  // is actually in the room and available for mentions/profile actions.
  // ─────────────────────────────────────────────────────────────────────────
  const presenceStateByUserId = useMemo(() => {
    const byUserId = new Map<string, { isOnline: boolean; lastSeen?: number }>();
    if (isDemoMode) {
      return byUserId;
    }

    roomPresenceQuery?.recentlyLeft?.forEach((member) => {
      byUserId.set(String(member.id), {
        isOnline: false,
        lastSeen: member.lastHeartbeatAt,
      });
    });

    roomPresenceQuery?.online?.forEach((member) => {
      byUserId.set(String(member.id), {
        isOnline: true,
        lastSeen: member.lastHeartbeatAt,
      });
    });

    return byUserId;
  }, [isDemoMode, roomPresenceQuery?.online, roomPresenceQuery?.recentlyLeft]);

  // ─────────────────────────────────────────────────────────────────────────
  // MEMBER-DATA FIX: Transform Convex member data for UI components
  // In demo mode: use DEMO_ONLINE_USERS
  // In real mode: use Convex-backed member data with profiles
  // ─────────────────────────────────────────────────────────────────────────
  const roomMembers: DemoOnlineUser[] = useMemo(() => {
    if (isDemoMode) {
      return DEMO_ONLINE_USERS;
    }
    // Real mode: transform Convex data to DemoOnlineUser shape (CANONICAL identity)
    if (!convexMembersWithProfiles) {
      return []; // Still loading or no members
    }
    const byUserId = (canonicalRoomIdentities as any)?.byUserId ?? {};

    console.log('CHATROOM_IDENTITY_CANONICAL_BUILD', {
      roomId: roomIdStr,
      memberCount: convexMembersWithProfiles.length,
      canonicalCount: Object.keys(byUserId).length,
      hasCanonical: !!canonicalRoomIdentities,
    });

    return convexMembersWithProfiles.map((m) => {
      const uid = String(m.id);
      const canon = byUserId[uid];

      if (!canon) {
        console.log('CHATROOM_IDENTITY_FALLBACK_BLOCKED', {
          userId: uid.slice(0, 12),
          reason: 'missing_canonical_identity',
          blocked: ['member.displayName', 'member.avatar', 'member.bio'],
        });
      }

      console.log('CHATROOM_IDENTITY_SOURCE_DECISION', {
        userId: uid.slice(0, 12),
        nicknameSource: canon?.nickname ? 'canonical' : 'placeholder',
        avatarSource: canon?.avatarUrl ? 'canonical' : 'placeholder',
        bioSource: canon?.bio ? 'canonical' : 'none',
        ageSource: typeof canon?.age === 'number' ? 'main_user' : 'none',
        genderSource: typeof canon?.gender === 'string' ? 'main_user' : 'none',
      });

      const username = canon?.nickname || 'User';
      const avatar = canon?.avatarUrl
        ? (buildCacheBustedAvatarUrl(canon.avatarUrl, m.avatarVersion) ?? undefined)
        : undefined;

      return {
        id: m.id,
        username,
        avatar,
        isOnline: presenceStateByUserId.get(uid)?.isOnline ?? false,
        age: typeof canon?.age === 'number' && canon.age > 0 ? canon.age : undefined,
        gender: (typeof canon?.gender === 'string' ? (canon.gender as any) : undefined),
        chatBio: canon?.bio ?? null,
        lastSeen: presenceStateByUserId.get(uid)?.lastSeen,
      };
    });
  }, [canonicalRoomIdentities, convexMembersWithProfiles, isDemoMode, presenceStateByUserId, roomIdStr]);

  const roomIdentityByUserId = useMemo(() => {
    const map = new Map<string, { nickname: string; avatar?: string; age?: number; gender?: 'male' | 'female' | 'other'; bio?: string }>();
    for (const m of roomMembers ?? []) {
      map.set(String(m.id), {
        nickname: m.username,
        avatar: m.avatar,
        age: m.age,
        gender: m.gender as any,
        bio: (m as any).chatBio,
      });
    }
    return map;
  }, [roomMembers]);

  // TEMP DEBUG: Trace age end-to-end for a single member (raw -> normalized -> map).
  const didLogAgeTraceRef = useRef(false);
  useEffect(() => {
    if (didLogAgeTraceRef.current) return;
    if (isDemoMode) return;
    if (!convexMembersWithProfiles || convexMembersWithProfiles.length === 0) return;
    if (!roomMembers || roomMembers.length === 0) return;

    const raw = convexMembersWithProfiles[0];
    const normalized = roomMembers.find((m) => String(m.id) === String(raw.id));
    const mapped = roomIdentityByUserId.get(String(raw.id));

    // PRIVATE-ROOM-ACCESS-FIX: Instrumentation for age flow
    console.log('CHATROOM_AGE_RAW', { age: raw?.age, gender: raw?.gender, id: String(raw?.id) });
    console.log('CHATROOM_AGE_NORMALIZED', { age: normalized?.age, gender: normalized?.gender, id: String(normalized?.id) });
    console.log('CHATROOM_MEMBER_LIST_COUNT', { count: roomMembers.length });

    didLogAgeTraceRef.current = true;
  }, [convexMembersWithProfiles, isDemoMode, roomIdentityByUserId, roomMembers]);

  const presenceUsers: { online: PresenceUserView[]; recentlyLeft: PresenceUserView[] } = useMemo(() => {
    // CHATROOM_IMMEDIATE_USER_BOOTSTRAP: Use presence data directly for immediate render
    // Don't wait for convexMembersWithProfiles to load - presence entries have complete data
    if (isDemoMode) {
      return { online: [], recentlyLeft: [] };
    }

    const hasPresenceData = (roomPresenceQuery?.online?.length ?? 0) > 0 || (roomPresenceQuery?.recentlyLeft?.length ?? 0) > 0;
    const hasMemberData = convexMembersWithProfiles && convexMembersWithProfiles.length > 0;

    // CHATROOM_IDENTITY_SOURCE_SHARED: Log shared identity sources
    console.log('CHATROOM_IDENTITY_SOURCE_SHARED', {
      presenceOnlineCount: roomPresenceQuery?.online?.length ?? 0,
      presenceRecentlyLeftCount: roomPresenceQuery?.recentlyLeft?.length ?? 0,
      membersWithProfilesCount: convexMembersWithProfiles?.length ?? 0,
      hasCanonicalRoomIdentities: !!canonicalRoomIdentities,
      hasCurrentUserChatProfile: !!chatRoomProfile,
      currentUserNickname: myNickname,
      currentUserHasAvatar: !!myAvatarUrl,
      effectiveUserId: effectiveUserId?.slice(0, 12) ?? null,
    });

    // Build member lookup map (may be empty if not loaded yet)
    const memberByUserId = new Map<string, ConvexMemberWithProfile>(
      (convexMembersWithProfiles ?? []).map((member) => [String(member.id), member])
    );

    const enrichPresence = (
      entries:
        | NonNullable<typeof roomPresenceQuery>['online']
        | NonNullable<typeof roomPresenceQuery>['recentlyLeft']
        | undefined
    ) =>
      (entries ?? []).map((entry) => {
        const member = memberByUserId.get(String(entry.id));
        const entryIdStr = String(entry.id);
        const selfUserIdStr = selfUserIdFromCanonical ?? (effectiveUserId ? String(effectiveUserId) : null);
        const isCurrentUser = !!selfUserIdStr && entryIdStr === selfUserIdStr;

        const canon = (canonicalRoomIdentities as any)?.byUserId?.[entryIdStr];

        // Hard guarantee: canonical identity wins for name/photo/bio whenever present.
        // If backend presence payload contains identity, we explicitly ignore it.
        if (canon) {
          const backendDisplayName = (entry as any).displayName;
          const backendAvatar = (entry as any).avatar;
          const backendBio = (entry as any).bio;
          const wouldOverride =
            (typeof backendDisplayName === 'string' && backendDisplayName && backendDisplayName !== canon.nickname) ||
            (typeof backendAvatar === 'string' && backendAvatar && backendAvatar !== canon.avatarUrl) ||
            (typeof backendBio === 'string' && backendBio && backendBio !== canon.bio);

          if (wouldOverride) {
            console.log('CHATROOM_PRESENCE_IDENTITY_OVERRIDE_BLOCKED', {
              userId: entryIdStr.slice(0, 12),
              blockedFields: {
                displayName: backendDisplayName ?? null,
                avatar: backendAvatar ?? null,
                bio: backendBio ?? null,
              },
            });
          }

          console.log('CHATROOM_CANONICAL_IDENTITY_WIN', {
            userId: entryIdStr.slice(0, 12),
            hasAvatar: !!canon.avatarUrl,
            hasBio: !!canon.bio,
          });
        } else {
          console.log('CHATROOM_CANONICAL_IDENTITY_MISSING', {
            userId: entryIdStr.slice(0, 12),
            reason: 'no_canonicalRoomIdentities_entry',
          });
        }

        // CHATROOM_FALLBACK_REASON: Log why fallback might occur
        console.log('CHATROOM_SELF_ID_MATCH_INPUTS', {
          userId: entryIdStr.slice(0, 12),
          selfUserIdStr: selfUserIdStr?.slice(0, 12) ?? 'NULL',
          entryIdStr: entryIdStr.slice(0, 12),
          isCurrentUser: !!isCurrentUser,
          authUserIdPresent: !!authUserId,
          hasCurrentUserChatProfile: !!chatRoomProfile,
          canonicalLoaded: !!canon,
          canonicalNickname: canon?.nickname ?? 'UNDEFINED',
          canonicalAvatarUrl: canon?.avatarUrl ? 'SET' : 'UNDEFINED',
        });

        console.log('CHATROOM_SELF_ID_MATCH_RESULT', {
          entryId: entryIdStr.slice(0, 12),
          selfUserId: selfUserIdStr?.slice(0, 12) ?? 'NULL',
          isCurrentUser: !!isCurrentUser,
        });

        // Canonical identity: name/photo/bio ONLY from chat-room profile (canonicalRoomIdentities).
        const chatRoomNickname = canon?.nickname ?? null;
        const chatRoomAvatar = canon?.avatarUrl ?? null;
        const chatRoomBioValue = canon?.bio ?? null;

        // hasChatProfile = true if we have identity from any source (Convex or store)
        const hasChatProfile = !!canon;

        // CHATROOM_PROFILE_CARD_IDENTITY: Log profile card identity source (current user)
        if (isCurrentUser) {
          console.log('CHATROOM_PROFILE_CARD_IDENTITY', {
            userId: String(entry.id).slice(0, 12),
            source: canon ? 'canonical' : 'none',
            nickname: chatRoomNickname,
            hasAvatar: !!chatRoomAvatar,
            hasBio: !!chatRoomBioValue,
          });
        }

        // CHATROOM_IDENTITY_SOURCE_FIX: Strict data source rules
        // - Name: ONLY from chat-room profile (Convex or store), placeholder "Member" if truly not set
        // - Photo: ONLY from chat-room profile (Convex or store), placeholder if truly not set
        // - Bio: ONLY from chat-room profile (Convex or store)
        // - Age/Gender: From main user data (allowed) or presence entry (fallback)
        // NEVER use main profile name/photo/bio!

        // CHATROOM_TOP_ROW_IDENTITY_SOURCE / CHATROOM_USERS_PANEL_IDENTITY_SOURCE: Log identity source
        const identitySource = canon ? 'canonical' : 'placeholder';

        console.log('CHATROOM_TOP_ROW_IDENTITY_SOURCE', {
          userId: entryIdStr.slice(0, 12),
          isCurrentUser: !!isCurrentUser,
          source: identitySource,
          nickname: chatRoomNickname ?? 'NULL',
          hasAvatar: !!chatRoomAvatar,
        });
        console.log('CHATROOM_USERS_PANEL_IDENTITY_SOURCE', {
          userId: entryIdStr.slice(0, 12),
          isCurrentUser: !!isCurrentUser,
          source: identitySource,
          nickname: chatRoomNickname ?? 'NULL',
          hasAvatar: !!chatRoomAvatar,
        });

        // Name: Use chat-room nickname from stable source, fallback to "Member" only if truly not set
        let finalDisplayName: string;
        let nameSource: string;
        if (chatRoomNickname) {
          finalDisplayName = chatRoomNickname;
          nameSource = identitySource;
        } else {
          finalDisplayName = 'User';
          nameSource = 'placeholder';
          console.log('CHATROOM_IDENTITY_FALLBACK_BLOCKED', {
            userId: entryIdStr.slice(0, 12),
            reason: 'missing_chat_room_nickname',
            blocked: ['users.name', 'userPrivateProfiles.displayName'],
          });
        }

        // Avatar: Use stable chat-room avatar (chatRoomAvatar already includes store fallback for current user)
        // chatRoomAvatar = stableAvatarUrl for current user, chatProfileFromBulk?.avatarUrl for others
        let finalAvatar: string | undefined;
        let avatarSource: string;
        if (chatRoomAvatar) {
          finalAvatar = buildCacheBustedAvatarUrl(chatRoomAvatar, (member as any)?.avatarVersion) ?? undefined;
          avatarSource = identitySource;
        } else {
          finalAvatar = undefined;
          avatarSource = 'placeholder';
          console.log('CHATROOM_IDENTITY_FALLBACK_BLOCKED', {
            userId: entryIdStr.slice(0, 12),
            reason: 'missing_chat_room_avatar',
            blocked: ['users.photo', 'userPrivateProfiles.privatePhotoUrls[0]'],
          });
        }

        // CHATROOM_TOP_ROW_IDENTITY_APPLY: Log identity applied to top row
        console.log('CHATROOM_TOP_ROW_IDENTITY_APPLY', {
          userId: entryIdStr.slice(0, 12),
          isCurrentUser: !!isCurrentUser,
          nameSource,
          displayName: finalDisplayName,
          avatarSource,
          hasAvatar: !!finalAvatar,
        });

        // CHATROOM_USERS_PANEL_IDENTITY_APPLY: Log identity applied to users panel
        console.log('CHATROOM_USERS_PANEL_IDENTITY_APPLY', {
          userId: entryIdStr.slice(0, 12),
          isCurrentUser: !!isCurrentUser,
          nameSource,
          displayName: finalDisplayName,
          avatarSource,
          hasAvatar: !!finalAvatar,
        });

        // Age: From main user data (allowed per rules) or presence entry for immediate render
        const rawAge = canon?.age ?? 0;
        const finalAge = rawAge > 0 ? rawAge : undefined;

        // Gender: From main user data (allowed per rules) or presence entry for immediate render
        const rawGender = canon?.gender ?? '';
        const gender = rawGender ? (rawGender as 'male' | 'female' | 'other') : undefined;

        // Role: prefer member data, fallback to presence entry data
        const role: RoomRole = member?.role ?? entry.role ?? 'member';

        // CHATROOM_IDENTITY_SYNC_RESULT: Log sync result
        console.log('CHATROOM_IDENTITY_SYNC_RESULT', {
          userId: entryIdStr.slice(0, 12),
          isCurrentUser: !!isCurrentUser,
          displayName: finalDisplayName,
          hasAvatar: !!finalAvatar,
          hasBio: !!chatRoomBioValue,
          ageFromMainProfile: finalAge,
          genderFromMainProfile: gender,
          identitySynced: hasChatProfile,
          nameSource,
          avatarSource,
          identitySource,
        });

        return {
          id: entryIdStr,
          displayName: finalDisplayName,
          avatar: finalAvatar,
          age: finalAge,
          gender,
          bio: chatRoomBioValue ?? undefined, // ONLY from chat-room profile (Convex or store)
          role,
          lastHeartbeatAt: entry.lastHeartbeatAt,
          joinedAt: entry.joinedAt,
        };
      });

    let online = enrichPresence(roomPresenceQuery?.online);
    const recentlyLeft = enrichPresence(roomPresenceQuery?.recentlyLeft);

    return { online, recentlyLeft };
  }, [canonicalRoomIdentities, chatRoomProfile, convexMembersWithProfiles, effectiveUserId, isDemoMode, myAvatarUrl, myNickname, roomIdStr, roomPresenceQuery?.online, roomPresenceQuery?.recentlyLeft, selfUserIdFromCanonical, stableAvatarUrl, stableBio, stableNickname]);

  useEffect(() => {
    if (isDemoMode) return;
    console.log('CHATROOM_BACKEND_COUNT_ONLY', {
      roomId: roomIdStr,
      backendOnlineCount: roomPresenceQuery?.onlineCount ?? (roomPresenceQuery?.online?.length ?? 0),
    });
  }, [
    isDemoMode,
    roomIdStr,
    roomPresenceQuery?.onlineCount,
    roomPresenceQuery?.online?.length,
  ]);

  // @Mention members for ChatComposer suggestions
  // Transform room members to MentionMember shape
  // SAFETY: Use empty array if roomMembers undefined
  // MENTION-FIX: Exclude current user from suggestions (can't mention yourself)
  const mentionMembers: MentionMember[] = useMemo(() => {
    return (roomMembers ?? [])
      .filter((m) => m.id !== effectiveUserId) // Exclude current user
      .map((m) => ({
        id: m.id,
        nickname: m.username,
        avatar: m.avatar,
        age: m.age,
        gender: m.gender,
      }));
  }, [effectiveUserId, roomMembers]);

  // ─────────────────────────────────────────────────────────────────────────
  // DM / NOTIFICATIONS STATE
  // DM-ID-FIX: Now uses Convex query for real DM threads
  // ─────────────────────────────────────────────────────────────────────────
  // DM threads: only after membership is confirmed (same gate as room queries) so we
  // never hit Convex with a half-ready session; backend getDmThreads also returns [] on errors.
  const dmThreadsQuery = useQuery(
    api.chatRooms.getDmThreads,
    authUserId && hasMemberAccess ? { authUserId } : 'skip'
  ) as ConvexDmThread[] | undefined;
  const dmThreads: ConvexDmThread[] = dmThreadsQuery ?? [];
  const unreadDMs = dmThreads.filter((dm) => dm.unreadCount > 0).length;

  // DM-ID-FIX: Convert Convex DM threads to format compatible with MessagesPopover
  const dmsForPopover = useMemo(() => {
    return dmThreads.map((t) => ({
      id: t.id,
      peerId: t.peerId as string,
      peerName: t.peerName,
      peerAvatar: t.peerAvatar,
      // AVATAR-BORDER-FIX: Include gender for consistent avatar border color
      peerGender: t.peerGender as 'male' | 'female' | 'other' | undefined,
      lastMessage: t.lastMessage,
      lastMessageAt: t.lastMessageAt,
      unreadCount: t.unreadCount,
      visible: true,
      hiddenUntilNextMessage: false,
    }));
  }, [dmThreads]);

  // ─────────────────────────────────────────────────────────────────────────
  // @MENTIONS STATE & QUERIES
  // ─────────────────────────────────────────────────────────────────────────
  const mentionsQuery = useQuery(
    api.chatRooms.getUserMentions,
    authUserId && hasMemberAccess ? { authUserId, limit: 50 } : 'skip'
  );
  const mentions = (mentionsQuery ?? []) as MentionItem[];

  // Mutations for marking mentions as read
  const markMentionReadMutation = useMutation(api.chatRooms.markMentionRead);
  const markAllMentionsReadMutation = useMutation(api.chatRooms.markAllMentionsRead);

  // State for navigating to a specific message (from mention tap)
  const [targetMessageId, setTargetMessageId] = useState<Id<'chatRoomMessages'> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // OVERLAY STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<Overlay>('none');
  const closeOverlay = useCallback(() => setOverlay('none'), []);

  // Required logs: Users panel final render + sync check (no UI impact)
  useEffect(() => {
    if (overlay !== 'onlineUsers') return;
    if (isDemoMode) return;

    console.log('CHATROOM_USERS_PANEL_RENDER_FINAL', {
      roomId: roomIdStr,
      onlineCount: presenceUsers.online.length,
      recentlyLeftCount: presenceUsers.recentlyLeft.length,
    });

    console.log('CHATROOM_USERS_PANEL_SYNC_CHECK', {
      roomId: roomIdStr,
      sample: presenceUsers.online.slice(0, 8).map((u) => {
        const canon = (canonicalRoomIdentities as any)?.byUserId?.[String(u.id)];
        return {
          id: String(u.id).slice(0, 12),
          displayName: u.displayName,
          canonNickname: canon?.nickname ?? null,
          hasAvatar: !!u.avatar,
          canonHasAvatar: !!canon?.avatarUrl,
          age: u.age,
        };
      }),
    });

    if (presenceUsers.online.length === 0 && presenceUsers.recentlyLeft.length === 0) {
      console.log('CHATROOM_USERS_PANEL_FALLBACK_REASON', {
        roomId: roomIdStr,
        reason: 'no_presence_data',
      });
    }
  }, [canonicalRoomIdentities, isDemoMode, overlay, presenceUsers.online, presenceUsers.recentlyLeft, roomIdStr]);

  const [selectedMessage, setSelectedMessage] = useState<DemoChatMessage | null>(null);
  // Position for anchored message actions popup
  const [messageActionPosition, setMessageActionPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedUser, setSelectedUser] = useState<DemoOnlineUser | null>(null);

  // @Mentions state
  const [currentMentions, setCurrentMentions] = useState<MentionData[]>([]);

  // COIN-FLASH-FIX: Coin feedback state removed - was causing yellow flash during send
  const [viewProfileUser, setViewProfileUser] = useState<DemoOnlineUser | null>(null);
  const [reportTargetUser, setReportTargetUser] = useState<DemoOnlineUser | null>(null);

  // Secure media viewer state (hold-to-view)
  const [secureMediaState, setSecureMediaState] = useState<{
    visible: boolean;
    isHolding: boolean;
    uri: string;
    type: 'image' | 'video';
  }>({ visible: false, isHolding: false, uri: '', type: 'image' });

  // ─────────────────────────────────────────────────────────────────────────
  // MUTE STATE (Convex-backed persistence)
  // ─────────────────────────────────────────────────────────────────────────
  // Use Convex query result for room mute status
  const isRoomMuted = isRoomMutedFromConvex;

  // Per-user muting: derive from Convex query (persistent, per-room)
  // In demo mode, fall back to local state (no backend persistence)
  const [demoMutedUserIds, setDemoMutedUserIds] = useState<Set<string>>(new Set());
  const mutedUserIds = useMemo(() => {
    if (isDemoMode) {
      return demoMutedUserIds;
    }
    // Real mode: derive from Convex query result
    const ids = mutedUsersQuery?.mutedUserIds ?? [];
    return new Set(ids);
  }, [mutedUsersQuery, demoMutedUserIds]);

  const handleToggleMuteUser = useCallback(async (userId: string) => {
    if (isDemoMode) {
      // Demo mode: local state only (no backend)
      setDemoMutedUserIds((prev) => {
        const next = new Set(prev);
        next.has(userId) ? next.delete(userId) : next.add(userId);
        return next;
      });
      return;
    }

    // Real mode: call Convex mutation (backend persists, query auto-updates via subscription)
    if (!authUserId || !roomIdStr || !hasValidRoomId) return;
    try {
      await toggleMuteUserMutation({
        roomId: roomIdStr as Id<'chatRooms'>,
        targetUserId: userId as Id<'users'>,
        authUserId,
      });
      // No local state update needed - Convex subscription will auto-refresh mutedUsersQuery
    } catch (error: any) {
      console.error('[MUTE] Toggle mute failed:', error);
      Alert.alert('Error', error.message || 'Failed to update mute status');
    }
  }, [authUserId, roomIdStr, hasValidRoomId, toggleMuteUserMutation]);

  // Auto-clear join messages after 1 minute
  // P0 FIX: Check mountedRef before state update to prevent unmounted warning
  // M-002 FIX: Consolidated to single mountedRef (was isMountedRef)
  useEffect(() => {
    if (!roomIdStr) return;
    const currentMsgs = useDemoChatRoomStore.getState().rooms[roomIdStr] ?? [];
    if (!currentMsgs.some((m) => m.id.startsWith('sys_join_'))) return;

    const timer = setTimeout(() => {
      if (!mountedRef.current) return; // P0 FIX: guard against unmounted update
      const latest = useDemoChatRoomStore.getState().rooms[roomIdStr] ?? [];
      setStoreMessages(roomIdStr, latest.filter((m) => !m.id.startsWith('sys_join_')));
    }, 60000);

    return () => clearTimeout(timer);
  }, [roomIdStr, setStoreMessages]);

  // ─────────────────────────────────────────────────────────────────────────
  // NAVIGATION HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const performLeaveRoom = useCallback(() => {
    closeOverlay();

    if (!isDemoMode) {
      if (!authUserId || !roomIdStr || !hasValidRoomId) {
        // Do not block navigation on leave errors; unmount stops heartbeat and backend expiry cleans up.
        console.log('CHATROOM_LEAVE_SENT', { roomId: roomIdStr ?? null, reason: 'missing_auth_or_room' });
      } else {
        console.log('CHATROOM_LEAVE_SENT', { roomId: roomIdStr });
        leaveRoomMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          authUserId,
        }).catch((err: any) => {
          console.log('CHATROOM_OFFLINE_REASON', {
            roomId: roomIdStr,
            reason: 'leave_mutation_failed',
            message: err?.message ?? String(err),
          });
        });
      }
    }

    exitRoom();
    setCurrentRoom(null);
    setHasRedirectedInSession(true);
    clearPreferredRoom();

    if (!isDemoMode && authUserId) {
      clearPreferredRoomMutation({ authUserId }).catch(() => {
        // Ignore errors - clearing preference is best-effort
      });
    }

    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, isDemoMode, authUserId, roomIdStr, hasValidRoomId, leaveRoomMutation, exitRoom, setCurrentRoom, setHasRedirectedInSession, clearPreferredRoom, clearPreferredRoomMutation, router]);

  const handleLeaveRoom = useCallback(() => {
    void performLeaveRoom();
  }, [performLeaveRoom]);

  const handleLeavePrivateRoom = useCallback(() => {
    void performLeaveRoom();
  }, [performLeaveRoom]);

  // Phase-2: End room handler (private room owner only) - deletes room permanently
  const handleEndRoom = useCallback(() => {
    if (!isRoomCreator || !authUserId || !roomIdStr) return;

    Alert.alert(
      'End Room',
      'Are you sure? This will permanently delete the room and all messages. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Room',
          style: 'destructive',
          onPress: async () => {
            try {
              // CR-016 FIX: Pass authUserId for server-side verification
              await closeRoomMutation({
                roomId: roomIdStr as Id<'chatRooms'>,
                authUserId: authUserId!,
              });
              // Clear preferred room to avoid stale redirect
              setCurrentRoom(null);
              exitRoom();
              clearPreferredRoom();
              if (!isDemoMode && authUserId) {
                // CR-017 FIX: Use authUserId for server-side verification
                clearPreferredRoomMutation({ authUserId }).catch(() => {
                  // Ignore errors - clearing preference is best-effort
                });
              }
              setHasRedirectedInSession(true);
              router.replace('/(main)/(private)/(tabs)/chat-rooms');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to end room');
            }
          },
        },
      ]
    );
  }, [isRoomCreator, authUserId, roomIdStr, closeRoomMutation, router, clearPreferredRoom, clearPreferredRoomMutation, setHasRedirectedInSession, setCurrentRoom, exitRoom]);

  // ─────────────────────────────────────────────────────────────────────────
  // RELOAD HANDLER (resets local state)
  // ─────────────────────────────────────────────────────────────────────────
  const handleReload = useCallback(() => {
    if (!roomIdStr) return;
    // Reload room messages (demo mode only has local store)
    if (isDemoMode) {
      const baseMessages = getDemoMessagesForRoom(roomIdStr);
      const currentMessages = useDemoChatRoomStore.getState().rooms[roomIdStr] ?? [];
      const baseIds = new Set(baseMessages.map((m) => m.id));
      const userSent = currentMessages.filter((m) => !baseIds.has(m.id) && !m.id.startsWith('sys_join_'));
      const merged = [...baseMessages, ...userSent].sort((a, b) => a.createdAt - b.createdAt);
      setStoreMessages(roomIdStr, merged);
    }
    // DMs: No demo data to restore - DMs start empty (no backend yet)
    // Announcements: Keep current state
  }, [roomIdStr, setStoreMessages]);

  // ─────────────────────────────────────────────────────────────────────────
  // SEND MESSAGE
  // P1 CR-003: Use try/finally to guarantee pending message cleanup
  // ─────────────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    console.log('SEND_HANDLER_START', { inputTextLen: inputText.length, roomIdStr, isSendingRef: isSendingRef.current, isDemoMode, authUserId, hasValidRoomId });
    const trimmed = inputText.trim();
    if (!trimmed || !roomIdStr) {
      console.log('SEND_HANDLER_GUARD_BLOCKED', { reason: 'empty_text_or_no_roomId', trimmedLen: trimmed.length, roomIdStr });
      return;
    }
    // Synchronous double-tap guard (ChatComposer's isSending state is async)
    if (isSendingRef.current) {
      console.log('SEND_HANDLER_GUARD_BLOCKED', { reason: 'isSendingRef_true' });
      return;
    }
    isSendingRef.current = true;
    // CHATROOM_ACTIVITY_HEARTBEAT_REMOVED: Activity heartbeat on send removed, using timer-based only

    // AUTO-SCROLL: Mark that user just sent a message (will trigger scroll after render)
    justSentMessageRef.current = true;

    if (isDemoMode) {
      console.log('SEND_HANDLER_DEMO_MODE_PATH');
      const newMessage: DemoChatMessage = {
        id: `cm_me_${Date.now()}`,
        roomId: roomIdStr,
        senderId: DEMO_CURRENT_USER.id,
        senderName: myNickname,
        type: 'text',
        text: trimmed,
        createdAt: Date.now(),
      };
      addStoreMessage(roomIdStr, newMessage);
      setInputText('');
      // Demo mode: local coin increment (no backend)
      incrementCoins();
      // COIN-FLASH-FIX: Coin feedback animation removed
      isSendingRef.current = false;
    } else {
      if (!authUserId || !hasValidRoomId) {
        console.log('SEND_HANDLER_GUARD_BLOCKED', { reason: 'no_authUserId_or_invalid_roomId', authUserId, hasValidRoomId });
        isSendingRef.current = false;
        return;
      }
      const clientId = generateUUID();
      const now = Date.now();
      const pendingId = `pending_${clientId}`;
      const textToRestore = trimmed; // Save text before clearing for retry on failure

      // P0-005 FINAL FIX: Include status and clientId for failed message persistence
      const pendingMsg: DemoChatMessage = {
        id: pendingId,
        roomId: roomIdStr,
        senderId: authUserId,
        senderName: 'You',
        type: 'text',
        text: trimmed,
        createdAt: now,
        status: 'sending',
        _clientId: clientId,
        _retryText: trimmed, // Preserve original text for retry
      };
      setPendingMessages((prev) => [...prev, pendingMsg]);
      setInputText('');
      // Clear reply state before sending (will be attached to message)
      const replyToId = replyToMessage?.id;
      setReplyToMessage(null);

      // WALLET-FIX: Coin increment is handled atomically in Convex mutation
      // UI reads from reactive getUserWalletCoins query (auto-updates)
      const mutationPayload = {
        roomId: roomIdStr as Id<'chatRooms'>,
        authUserId: authUserId!,
        senderId: authUserId as Id<'users'>,
        text: trimmed,
        clientId,
        // Reply-to-message support
        replyToMessageId: replyToId ? (replyToId as Id<'chatRoomMessages'>) : undefined,
        // @mentions support
        mentions: currentMentions.length > 0 ? currentMentions.map(m => ({
          userId: m.userId as Id<'users'>,
          nickname: m.nickname,
          startIndex: m.startIndex,
          endIndex: m.endIndex,
        })) : undefined,
      };
      console.log('SEND_MUTATION_CALL_START', { mutation: 'api.chatRooms.sendMessage', roomId: mutationPayload.roomId, authUserId: mutationPayload.authUserId, senderId: mutationPayload.senderId, textLen: trimmed.length });
      try {
        await sendMessageMutation(mutationPayload);
        console.log('SEND_MUTATION_CALL_SUCCESS');
        // SEND-FLICKER-FIX: Don't remove pending message here - let the cleanup effect handle it
        // when the server message arrives. This prevents the ghost/flicker frame.
        if (mountedRef.current) {
          // COIN-FLASH-FIX: Coin feedback animation removed
          // Clear mentions after successful send
          setCurrentMentions([]);
        }
      } catch (error: any) {
        console.log('SEND_MUTATION_CALL_FAIL', { errorMessage: error?.message, errorStack: error?.stack?.slice?.(0, 500) });
        // P0-005 FINAL FIX: Mark message as failed instead of removing
        // Message stays visible with failed state; user can retry via tap
        if (mountedRef.current) {
          setPendingMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId ? { ...m, status: 'failed' as const } : m
            )
          );
        }
        Alert.alert('Send Failed', error?.message || 'Message could not be sent. Tap the message to retry.');
      } finally {
        isSendingRef.current = false;
      }
    }
  }, [inputText, roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, myNickname, replyToMessage, currentMentions, composerHeight]);

  // ─────────────────────────────────────────────────────────────────────────
  // P0-005 FINAL FIX: Retry handler for failed messages
  // ─────────────────────────────────────────────────────────────────────────
  const handleRetryMessage = useCallback(
    async (failedMsg: DemoChatMessage) => {
      if (!roomIdStr || !authUserId || !failedMsg._retryText || !failedMsg._clientId) {
        return;
      }
      // Prevent double-retry
      if (failedMsg.status !== 'failed') return;

      // Mark as sending again
      setPendingMessages((prev) =>
        prev.map((m) =>
          m.id === failedMsg.id ? { ...m, status: 'sending' as const } : m
        )
      );

      try {
        await sendMessageMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          authUserId: authUserId!,
          senderId: authUserId as Id<'users'>,
          text: failedMsg._retryText,
          clientId: failedMsg._clientId,
        });
        // Success: remove pending message (server message will appear)
        if (mountedRef.current) {
          setPendingMessages((prev) => prev.filter((m) => m.id !== failedMsg.id));
        }
      } catch (error: any) {
        // Still failed: mark as failed again
        if (mountedRef.current) {
          setPendingMessages((prev) =>
            prev.map((m) =>
              m.id === failedMsg.id ? { ...m, status: 'failed' as const } : m
            )
          );
        }
        Alert.alert('Retry Failed', error?.message || 'Could not send message. Please try again.');
      }
    },
    [roomIdStr, authUserId, sendMessageMutation]
  );

  const handleRetryMediaMessage = useCallback(
    async (msg: DemoChatMessage) => {
      if (isDemoMode) return;
      if (!roomIdStr || !authUserId || !hasValidRoomId) return;
      const uploadStatus = (msg as any).uploadStatus as
        | 'uploading'
        | 'sending'
        | 'upload_failed'
        | 'send_failed'
        | undefined;
      const clientId = (msg as any)._clientId as string | undefined;
      const localUri = (msg as any).localUri as string | undefined;
      const mediaType = (msg as any)._mediaType as 'image' | 'video' | 'doodle' | undefined;
      const storageId = (msg as any)._storageId as Id<'_storage'> | undefined;

      if (!clientId || !localUri || !mediaType) return;
      if (uploadStatus !== 'upload_failed' && uploadStatus !== 'send_failed') return;

      // upload_failed -> re-upload then send
      if (uploadStatus === 'upload_failed') {
        setPendingMediaMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? ({ ...(m as any), uploadStatus: 'uploading' as const } as any) : m
          )
        );
        try {
          const uploadTypeMap = { image: 'photo' as const, video: 'video' as const, doodle: 'doodle' as const };
          const newStorageId = await uploadMediaToConvexWithProgress(
            localUri,
            generateUploadUrlMutation,
            uploadTypeMap[mediaType],
            (progressPct) => {
              const now = Date.now();
              const last = lastProgressUpdateAtRef.current.get(msg.id) ?? 0;
              const p = Math.max(0, Math.min(100, progressPct));
              const shouldUpdate =
                p === 0 ||
                p === 100 ||
                now - last >= PROGRESS_UPDATE_INTERVAL_MS;
              if (!shouldUpdate) return;
              lastProgressUpdateAtRef.current.set(msg.id, now);
              if (!mountedRef.current) return;
              setPendingMediaMessages((prev) =>
                prev.map((m) =>
                  m.id === msg.id
                    ? ({ ...(m as any), uploadProgress: p } as any)
                    : m
                )
              );
            }
          );
          if (!mountedRef.current) return;
          setPendingMediaMessages((prev) =>
            prev.map((m) =>
              m.id === msg.id
                ? ({ ...(m as any), uploadStatus: 'sending' as const, _storageId: newStorageId } as any)
                : m
            )
          );
          await sendMessageMutation({
            roomId: roomIdStr as Id<'chatRooms'>,
            authUserId: authUserId!,
            senderId: authUserId as Id<'users'>,
            imageStorageId: newStorageId,
            mediaType,
            clientId,
          });
          if (mountedRef.current) {
            setPendingMediaMessages((prev) => prev.filter((m) => m.id !== msg.id));
          }
        } catch {
          if (mountedRef.current) {
            setPendingMediaMessages((prev) =>
              prev.map((m) =>
                m.id === msg.id ? ({ ...(m as any), uploadStatus: 'upload_failed' as const } as any) : m
              )
            );
          }
        }
      }

      // send_failed -> resend using existing storageId (no re-upload)
      if (uploadStatus === 'send_failed' && storageId) {
        setPendingMediaMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? ({ ...(m as any), uploadStatus: 'sending' as const } as any) : m
          )
        );
        try {
          await sendMessageMutation({
            roomId: roomIdStr as Id<'chatRooms'>,
            authUserId: authUserId!,
            senderId: authUserId as Id<'users'>,
            imageStorageId: storageId,
            mediaType,
            clientId,
          });
          if (mountedRef.current) {
            setPendingMediaMessages((prev) => prev.filter((m) => m.id !== msg.id));
          }
        } catch {
          if (mountedRef.current) {
            setPendingMediaMessages((prev) =>
              prev.map((m) =>
                m.id === msg.id ? ({ ...(m as any), uploadStatus: 'send_failed' as const } as any) : m
              )
            );
          }
        }
      }
    },
    [authUserId, generateUploadUrlMutation, hasValidRoomId, isDemoMode, roomIdStr, sendMessageMutation]
  );

  const handlePanelChange = useCallback((_panel: ComposerPanel) => {}, []);

  // ─────────────────────────────────────────────────────────────────────────
  // SEND MEDIA (CR-009 FIX: Upload to cloud storage before sending)
  // MEDIA-RELIABILITY: Added duplicate protection, file size validation, and retry-friendly errors
  // ─────────────────────────────────────────────────────────────────────────
  const handleSendMedia = useCallback(
    async (uri: string, mediaType: 'image' | 'video' | 'doodle') => {
      if (!roomIdStr) return;

      // MEDIA-RELIABILITY: Prevent duplicate sends from rapid taps
      if (isSendingMediaRef.current) {
        return;
      }
      // MEDIA-RELIABILITY: Prevent re-upload of same media file
      if (uploadingMediaUriRef.current === uri) {
        return;
      }

      isSendingMediaRef.current = true;
      // CHATROOM_ACTIVITY_HEARTBEAT_REMOVED: Activity heartbeat on media send removed, using timer-based only
      uploadingMediaUriRef.current = uri;

      const labelMap = { image: 'Photo', video: 'Video', doodle: 'Doodle' };
      const uploadTypeMap = { image: 'photo' as const, video: 'video' as const, doodle: 'doodle' as const };
      let pendingClientId: string | undefined;

      try {
        if (isDemoMode) {
          // Demo mode: Copy media to persistent location so it survives app restart
          let persistentUri = uri;
          try {
            const mediaTypeHint = mediaType === 'video' ? 'video' : 'photo';
            persistentUri = await ensureStableFile(uri, mediaTypeHint);
          } catch (err) {
            console.warn('[ChatRoom] Failed to persist media, using original URI:', err);
          }

          const newMessage: DemoChatMessage = {
            id: `cm_me_${Date.now()}`,
            roomId: roomIdStr,
            senderId: DEMO_CURRENT_USER.id,
            senderName: myNickname,
            type: mediaType,
            text: `[${labelMap[mediaType]}]`,
            mediaUrl: persistentUri,
            createdAt: Date.now(),
          };
          // B2-HIGH FIX: Guard setState after async (ensureStableFile)
          if (mountedRef.current) {
            addStoreMessage(roomIdStr, newMessage);
            // P0-FIX: Demo mode coin increment
            incrementCoins();
          }
        } else {
          // CR-009 FIX: Real mode - upload to cloud storage first, then send with storage ID
          if (!authUserId || !hasValidRoomId) return;
          const clientId = generateUUID();
          pendingClientId = clientId;
          const pendingId = `pending_${clientId}`;
          const createdAtLocal = Date.now();

          // PHASE 1: Insert pending media message immediately (shows upload state)
          const pendingMedia: DemoChatMessage = {
            id: pendingId,
            roomId: roomIdStr,
            senderId: authUserId,
            senderName: 'You',
            type: mediaType,
            text: `[${labelMap[mediaType]}]`,
            createdAt: createdAtLocal,
            ...( {
              uploadStatus: 'uploading',
              uploadProgress: 0,
              localUri: uri,
              _clientId: clientId,
              _mediaType: mediaType,
            } as any ),
          };
          setPendingMediaMessages((prev) => [...prev, pendingMedia]);

          // MEDIA-RELIABILITY: Validate file size before upload attempt
          // This provides immediate feedback without starting the upload
          try {
            await validateFileSize(uri, uploadTypeMap[mediaType]);
          } catch (sizeError) {
            if (sizeError instanceof UploadError) {
              if (mountedRef.current) {
                setPendingMediaMessages((prev) =>
                  prev.map((m) =>
                    m.id === pendingId ? ({ ...(m as any), uploadStatus: 'upload_failed' as const } as any) : m
                  )
                );
              }
              return;
            }
            throw sizeError;
          }

          // Step 1: Upload media to Convex storage
          const uploadHint = uploadTypeMap[mediaType];
          const storageId = await uploadMediaToConvexWithProgress(
            uri,
            generateUploadUrlMutation,
            uploadHint,
            (progressPct) => {
              const now = Date.now();
              const last = lastProgressUpdateAtRef.current.get(pendingId) ?? 0;
              const p = Math.max(0, Math.min(100, progressPct));
              const shouldUpdate =
                p === 0 ||
                p === 100 ||
                now - last >= PROGRESS_UPDATE_INTERVAL_MS;
              if (!shouldUpdate) return;
              lastProgressUpdateAtRef.current.set(pendingId, now);
              if (!mountedRef.current) return;
              setPendingMediaMessages((prev) =>
                prev.map((m) =>
                  m.id === pendingId
                    ? ({ ...(m as any), uploadProgress: p } as any)
                    : m
                )
              );
            }
          );

          if (mountedRef.current) {
            setPendingMediaMessages((prev) =>
              prev.map((m) =>
                m.id === pendingId
                  ? ({ ...(m as any), uploadStatus: 'sending' as const, _storageId: storageId } as any)
                  : m
              )
            );
          }

          // Step 2: Send message with storage ID (backend resolves to URL)
          await sendMessageMutation({
            roomId: roomIdStr as Id<'chatRooms'>,
            authUserId: authUserId!,
            senderId: authUserId as Id<'users'>,
            imageStorageId: storageId, // CR-009: Pass storage ID, not local URI
            mediaType: mediaType,
            clientId,
          });

          // Success: remove pending media message (server message will appear)
          if (mountedRef.current) {
            setPendingMediaMessages((prev) => prev.filter((m) => m.id !== pendingId));
          }
        }
      } catch (err: any) {
        console.error('[ChatRoom] Media upload/send failed:', err);

        // MEDIA-RELIABILITY: Show specific error messages based on error type
        if (err instanceof UploadError) {
          const title = err.type === 'FILE_TOO_LARGE' ? 'File Too Large' :
                        err.type === 'NETWORK_ERROR' ? 'Connection Error' :
                        err.type === 'FILE_NOT_FOUND' ? 'File Not Found' :
                        'Upload Failed';
          const retryHint = err.retryable ? '\n\nPlease try again.' : '';
          // Keep message visible for retry
          if (mountedRef.current) {
            setPendingMediaMessages((prev) =>
              prev.map((m) => {
                const cid = (m as any)._clientId as string | undefined;
                return cid === pendingClientId ? ({ ...(m as any), uploadStatus: 'upload_failed' as const } as any) : m;
              })
            );
          }
        } else {
          if (mountedRef.current) {
            setPendingMediaMessages((prev) =>
              prev.map((m) => {
                const cid = (m as any)._clientId as string | undefined;
                return cid === pendingClientId ? ({ ...(m as any), uploadStatus: 'send_failed' as const } as any) : m;
              })
            );
          }
        }
      } finally {
        // MEDIA-RELIABILITY: Always reset guards
        isSendingMediaRef.current = false;
        uploadingMediaUriRef.current = null;
      }
    },
    [roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, generateUploadUrlMutation, myNickname, incrementCoins]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // VOICE RECORDING (CR-009 FIX: Upload to cloud storage before sending)
  // Wires up the mic button in ChatComposer to record and send voice messages
  // ─────────────────────────────────────────────────────────────────────────
  const handleVoiceRecordingComplete = useCallback(
    async (result: VoiceRecorderResult) => {
      if (!roomIdStr || !result.audioUri) return;

      // MEDIA-RELIABILITY: Synchronous guard against double-tap voice send
      if (isSendingVoiceRef.current) {
        return;
      }
      // CHATROOM_ACTIVITY_HEARTBEAT_REMOVED: Activity heartbeat on voice send removed, using timer-based only

      if (isDemoMode) {
        // Demo mode: add voice message to local store (local URI OK for demo)
        const newMessage: DemoChatMessage = {
          id: `cm_voice_${Date.now()}`,
          roomId: roomIdStr,
          senderId: DEMO_CURRENT_USER.id,
          senderName: myNickname,
          type: 'audio',
          audioUrl: result.audioUri,
          createdAt: Date.now(),
        };
        addStoreMessage(roomIdStr, newMessage);
        incrementCoins();
        // COIN-FLASH-FIX: Coin feedback animation removed
      } else {
        // CR-009 FIX: Real mode - upload to cloud storage first, then send with storage ID
        if (!authUserId || !hasValidRoomId) return;

        // MEDIA-RELIABILITY: Set guard before async operation
        isSendingVoiceRef.current = true;
        const clientId = generateUUID();

        try {
          // MEDIA-RELIABILITY: Validate file size before upload
          try {
            await validateFileSize(result.audioUri, 'audio');
          } catch (sizeError) {
            if (sizeError instanceof UploadError) {
              Alert.alert('File Too Large', sizeError.message);
              return;
            }
            throw sizeError;
          }

          // Step 1: Upload audio to Convex storage
          const storageId = await uploadMediaToConvex(
            result.audioUri,
            generateUploadUrlMutation,
            'audio'
          );

          // Step 2: Send message with storage ID (backend resolves to URL)
          await sendMessageMutation({
            roomId: roomIdStr as Id<'chatRooms'>,
            authUserId: authUserId!,
            senderId: authUserId as Id<'users'>,
            audioStorageId: storageId, // CR-009: Pass storage ID, not local URI
            clientId,
          });
        } catch (err: any) {
          console.error('[ChatRoom] Audio upload/send failed:', err);
          // MEDIA-RELIABILITY: Better error handling with UploadError type checks
          if (err instanceof UploadError) {
            const title = err.type === 'FILE_TOO_LARGE' ? 'File Too Large' :
                          err.type === 'NETWORK_ERROR' ? 'Network Error' :
                          'Upload Failed';
            const retryHint = err.retryable ? '\n\nPlease try again.' : '';
            Alert.alert(title, err.message + retryHint);
          } else {
            Alert.alert('Error', err.message || 'Failed to send voice message. Please try again.');
          }
        } finally {
          // MEDIA-RELIABILITY: Always reset guard
          isSendingVoiceRef.current = false;
        }
      }
    },
    [roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, generateUploadUrlMutation, myNickname, incrementCoins]
  );

  const { toggleRecording, isRecording, elapsedMs } = useVoiceRecorder({
    onRecordingComplete: handleVoiceRecordingComplete,
    onError: (msg) => Alert.alert('Recording Error', msg),
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TAP-TO-VIEW-FIX: Media tap opens viewer, close button dismisses
  // ─────────────────────────────────────────────────────────────────────────
  const handleMediaPress = useCallback((_messageId: string, mediaUrl: string, type: 'image' | 'video') => {
    // Open viewer on tap (stays open until dismissed)
    setSecureMediaState({ visible: true, isHolding: true, uri: mediaUrl, type });
  }, []);

  const handleMediaClose = useCallback(() => {
    // Close viewer when user taps close or backdrop
    setSecureMediaState({ visible: false, isHolding: false, uri: '', type: 'image' });
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // DM HANDLERS
  // DM-ID-FIX: Marking read now happens in PrivateChatView via markDmMessagesRead mutation
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // @MENTION HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleOpenMention = useCallback(async (mention: MentionItem) => {
    // Close the mentions popover
    setOverlay('none');

    // Check if we're already in the correct room
    const currentRoomId = roomIdStr;
    const mentionRoomId = mention.roomId as string;

    if (currentRoomId === mentionRoomId) {
      // Same room - just scroll to message and highlight
      setTargetMessageId(mention.messageId as Id<'chatRoomMessages'>);
    } else {
      // mention.roomId is Convex chatRooms _id from server — must match dynamic segment
      router.push({
        pathname: '/(main)/(private)/(tabs)/chat-rooms/[roomId]',
        params: {
          roomId: mention.roomId as string,
          targetMessageId: mention.messageId as string,
        },
      });
    }

    // Mark as read (don't await to avoid blocking UI)
    if (!mention.isRead && authUserId) {
      markMentionReadMutation({
        authUserId,
        mentionId: mention.id as Id<'chatRoomMentionNotifications'>,
      }).catch((err) => {
        console.warn('[CHAT_MENTION_READ] Failed to mark mention as read:', err);
      });
    }
  }, [roomIdStr, router, authUserId, markMentionReadMutation]);

  // HIDE-VS-DELETE-FIX: Handler to hide DM thread from private list (not delete)
  const handleHideDmThread = useCallback(async (threadId: string) => {
    if (!authUserId) return;
    try {
      await hideDmThreadMutation({
        authUserId,
        threadId: threadId as Id<'conversations'>,
      });
    } catch (err) {
      if (__DEV__) console.error('[DM] Hide thread failed:', err);
    }
  }, [authUserId, hideDmThreadMutation]);

  const handleMarkAllMentionsRead = useCallback(async () => {
    if (!authUserId) return;
    try {
      await markAllMentionsReadMutation({ authUserId });
    } catch (err) {
      console.warn('[CHAT_MENTION_READ_ALL] Failed:', err);
    }
  }, [authUserId, markAllMentionsReadMutation]);

  // ─────────────────────────────────────────────────────────────────────────
  // MENTION INDICATOR: Jump to newest unread mention in current room
  // ─────────────────────────────────────────────────────────────────────────
  // Filter mentions for current room only (for the indicator)
  const currentRoomUnreadMentions = useMemo(() => {
    if (!roomIdStr) return [];
    return mentions.filter(m => !m.isRead && m.roomId === roomIdStr);
  }, [mentions, roomIdStr]);

  const handleMentionIndicatorTap = useCallback(() => {
    // Find the newest unread mention in current room
    if (currentRoomUnreadMentions.length === 0) return;

    // Mentions are sorted by createdAt desc (newest first), so take first
    const newestMention = currentRoomUnreadMentions[0];
    handleOpenMention(newestMention);
  }, [currentRoomUnreadMentions, handleOpenMention]);

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE LONG PRESS - captures position for anchored popup
  // ─────────────────────────────────────────────────────────────────────────
  const handleMessageLongPress = useCallback((message: DemoChatMessage, pageX: number, pageY: number) => {
    setSelectedMessage(message);
    setMessageActionPosition({ x: pageX, y: pageY });
    setOverlay('messageActions');
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // AVATAR PRESS
  // ─────────────────────────────────────────────────────────────────────────
  // MEMBER-DATA FIX: Use roomMembers (unified source for both demo and real mode)
  // SELF-PROFILE FIX: If tapping own avatar, open photo viewer directly (no action popup)
  const handleAvatarPress = useCallback((senderId: string) => {
    // SELF-PROFILE FIX: Check if this is the current user's own avatar
    const currentUserId = isDemoMode ? DEMO_CURRENT_USER.id : authUserId;
    const isSelf = senderId === currentUserId;

    // Look up user in roomMembers (Convex-backed in real mode, demo in demo mode)
    // SAFETY: Use empty array if roomMembers undefined
    const memberUser = (roomMembers ?? []).find((u) => u.id === senderId);
    const userToShow = memberUser ?? {
      id: senderId,
      username: messages.find((m) => m.senderId === senderId)?.senderName || 'Unknown',
      avatar: messages.find((m) => m.senderId === senderId)?.senderAvatar,
      isOnline: false,
    };

    if (isSelf) {
      // SELF-PROFILE FIX: Open photo viewer directly, skip action popup
      setViewProfileUser(userToShow);
      setOverlay('viewProfile');
    } else {
      // Other user: show action popup (View Profile, Private Message, Mute, Report)
      setSelectedUser(userToShow);
      setOverlay('userProfile');
    }
  }, [messages, roomMembers, authUserId]);

  // ─────────────────────────────────────────────────────────────────────────
  // ONLINE USER PRESS
  // ─────────────────────────────────────────────────────────────────────────
  // Type that works for both demo users and presence users
  type PanelUser = { id: string; username?: string; avatar?: string; isOnline?: boolean; age?: number; gender?: string; lastSeen?: number };
  // SELF-PROFILE FIX: If tapping own user in online panel, open photo viewer directly
  const handleOnlineUserPress = useCallback((user: PanelUser) => {
    // Convert PanelUser to DemoOnlineUser format for state
    const userAsDemoUser: DemoOnlineUser = {
      id: user.id,
      username: user.username || 'Anonymous',
      avatar: user.avatar,
      isOnline: user.isOnline ?? false,
      age: user.age,
      gender: user.gender as 'male' | 'female' | 'other' | undefined,
      lastSeen: user.lastSeen,
    };

    // SELF-PROFILE FIX: Check if this is the current user
    const currentUserId = isDemoMode ? DEMO_CURRENT_USER.id : authUserId;
    const isSelf = user.id === currentUserId;

    if (isSelf) {
      // SELF-PROFILE FIX: Open photo viewer directly, skip action popup
      setViewProfileUser(userAsDemoUser);
      setOverlay('viewProfile');
    } else {
      // Other user: show action popup
      setSelectedUser(userAsDemoUser);
      setOverlay('userProfile');
    }
  }, [authUserId]);

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW PROFILE
  // ─────────────────────────────────────────────────────────────────────────
  const handleViewProfile = useCallback(() => {
    setViewProfileUser(selectedUser);
    setOverlay('viewProfile');
  }, [selectedUser]);

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE MESSAGE - Opens Modal (no navigation, just state)
  // DM-ID-FIX: Now creates/finds thread in Convex backend for real-time sync
  // ─────────────────────────────────────────────────────────────────────────
  const handlePrivateMessage = useCallback(async (userId: string) => {
    if (!authUserId) {
      Alert.alert('Error', 'Not authenticated');
      return;
    }

    const user = selectedUser;

    // DM-ID-FIX: Resolve room ID for sourceRoomId parameter
    // roomIdStr is the Convex room ID string from route params
    const resolvedRoomId = roomIdStr && isValidConvexId(roomIdStr)
      ? (roomIdStr as Id<'chatRooms'>)
      : undefined;

    try {
      // DM-ID-FIX: Create or get thread from Convex backend
      // userId from presence is already the canonical Convex ID
      const { threadId } = await getOrCreateDmThread({
        authUserId,
        peerUserId: userId as Id<'users'>,
        sourceRoomId: resolvedRoomId,
      });

      // Create DM info for display
      const dmInfo = {
        id: `dm_${threadId}`,
        peerId: userId,
        peerName: user?.username || 'Anonymous',
        peerAvatar: user?.avatar,
        peerGender: user?.gender as 'male' | 'female' | 'other' | undefined,
      };

      // Set DM in store with threadId - Modal will open automatically
      setActiveDm(dmInfo, threadId, roomIdStr!);
      setSelectedUser(null);
      setOverlay('none');
    } catch (error: any) {
      if (__DEV__) console.error('[CHAT_DM_ERROR]', error);
      Alert.alert('Error', error?.message || 'Failed to open private chat. Please try again.');
    }
  }, [authUserId, selectedUser, roomIdStr, getOrCreateDmThread, setActiveDm]);

  // ─────────────────────────────────────────────────────────────────────────
  // REPORT (Convex-backed persistence)
  // ─────────────────────────────────────────────────────────────────────────
  const handleReport = useCallback(() => {
    setReportTargetUser(selectedUser);
    setOverlay('report');
  }, [selectedUser]);

  // Store report in Convex (reports table with full details)
  const handleSubmitReport = useCallback(
    async (data: { reportedUserId: string; reason: ReportReason; details?: string; roomId?: string }) => {
      if (!authUserId) {
        Alert.alert('Error', 'You must be signed in to submit a report.', [{ text: 'OK' }]);
        return;
      }

      try {
        // Submit detailed report to Convex (persists all report details)
        await submitChatRoomReportMutation({
          authUserId,
          reportedUserId: data.reportedUserId,
          roomId: roomIdStr ?? undefined,
          reason: data.reason,
          details: data.details,
        });

        // UNMOUNT-GUARD: Check mounted before setState after async
        if (mountedRef.current) {
          setOverlay('none');
          setReportTargetUser(null);
        }
        Alert.alert('Report submitted', 'Thank you. We will review this report.', [{ text: 'OK' }]);
      } catch (error: any) {
        console.error('[REPORT] Failed to submit report:', error);
        Alert.alert('Error', error.message || 'Failed to submit report. Please try again.', [{ text: 'OK' }]);
      }
    },
    [roomIdStr, authUserId, submitChatRoomReportMutation]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE ACTION: DELETE (with confirmation)
  // ─────────────────────────────────────────────────────────────────────────
  const handleDeleteMessage = useCallback(() => {
    if (!selectedMessage || !roomIdStr) return;

    // Show confirmation dialog before deleting
    Alert.alert(
      'Delete message?',
      'This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            setSelectedMessage(null);
            setOverlay('none');
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Demo mode: remove from local store
            if (isDemoMode) {
              const currentMessages = useDemoChatRoomStore.getState().rooms[roomIdStr] ?? [];
              setStoreMessages(roomIdStr, currentMessages.filter((m) => m.id !== selectedMessage.id));
              // UNMOUNT-GUARD: Check mounted before setState after store update
              if (mountedRef.current) {
                setSelectedMessage(null);
                setOverlay('none');
              }
              return;
            }

            // Real mode: call Convex mutation
            if (!authUserId) return;
            try {
              await deleteMessageMutation({
                roomId: roomIdStr as Id<'chatRooms'>,
                messageId: selectedMessage.id as Id<'chatRoomMessages'>,
                authUserId,
              });
              // UNMOUNT-GUARD: Check mounted before setState after async
              if (mountedRef.current) {
                setSelectedMessage(null);
                setOverlay('none');
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete message');
            }
          },
        },
      ]
    );
  }, [selectedMessage, roomIdStr, authUserId, deleteMessageMutation, setStoreMessages]);

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE ACTION: REPORT (for message, not user)
  // ─────────────────────────────────────────────────────────────────────────
  const handleReportMessage = useCallback(() => {
    if (!selectedMessage) return;
    // Find the user who sent the message to open report modal
    // SAFETY: Use empty array if roomMembers undefined
    const senderUser = (roomMembers ?? []).find((u) => u.id === selectedMessage.senderId);
    if (senderUser) {
      setReportTargetUser(senderUser);
    } else {
      // Fallback for users not in member list
      setReportTargetUser({
        id: selectedMessage.senderId,
        username: selectedMessage.senderName || 'Unknown',
        isOnline: false,
      });
    }
    setSelectedMessage(null);
    setOverlay('report');
  }, [selectedMessage, roomMembers]);

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE ACTION: REPLY (sets reply state for composer)
  // FLATTEN-REPLY: Always use only the message's OWN content, never nested reply data
  // This ensures single-level reply preview (no stacking of quote bars)
  // ─────────────────────────────────────────────────────────────────────────
  const handleReplyToMessage = useCallback(() => {
    if (!selectedMessage) return;

    // FLATTEN-REPLY: Extract ONLY the message's own text, ignoring any replyToSnippet
    // This prevents nested replies from appearing in the preview
    let snippet = '';
    if (selectedMessage.text) {
      // Use only the message's own text content (not any quoted/nested content)
      const ownText = selectedMessage.text;
      snippet = ownText.length > 50 ? ownText.slice(0, 47) + '...' : ownText;
    } else if (selectedMessage.type === 'image') {
      snippet = '📷 Photo';
    } else if (selectedMessage.type === 'video') {
      snippet = '🎥 Video';
    } else if (selectedMessage.type === 'doodle') {
      snippet = '🎨 Doodle';
    } else if (selectedMessage.type === 'audio') {
      snippet = '🎤 Voice message';
    }

    // FLATTEN-REPLY: Use only this message's sender name, not any referenced sender
    setReplyToMessage({
      id: selectedMessage.id,
      senderNickname: selectedMessage.senderName || 'Anonymous',
      snippet,
    });

    // Close the action sheet and clear selection
    setSelectedMessage(null);
    setOverlay('none');

    // Focus the input after a brief delay (let overlay close)
    setTimeout(() => {
      Keyboard.dismiss();
    }, 50);
  }, [selectedMessage]);

  // Clear reply state
  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE ACTION: REACT (add emoji reaction)
  // ─────────────────────────────────────────────────────────────────────────
  const handleReact = useCallback(async (emoji: ReactionEmoji) => {
    if (!selectedMessage || !authUserId || !roomIdStr || isDemoMode) {
      setSelectedMessage(null);
      setOverlay('none');
      return;
    }

    try {
      await addReactionMutation({
        roomId: roomIdStr as Id<'chatRooms'>,
        messageId: selectedMessage.id as Id<'chatRoomMessages'>,
        emoji,
        authUserId,
      });
    } catch (error) {
      console.error('[Reaction] Failed to add reaction:', error);
    }

    setSelectedMessage(null);
    setOverlay('none');
  }, [selectedMessage, authUserId, roomIdStr, addReactionMutation]);

  // ─────────────────────────────────────────────────────────────────────────
  // P0-FIX: REACTION CHIP TAP - Toggle reaction from message chips
  // ─────────────────────────────────────────────────────────────────────────
  const handleReactionChipTap = useCallback(async (messageId: string, emoji: string) => {
    if (!authUserId || !roomIdStr || isDemoMode) return;

    // Check if user already reacted with this emoji
    const messageReactions = reactionsMap.get(messageId) || [];
    const existingReaction = messageReactions.find(r => r.emoji === emoji);
    const userAlreadyReacted = existingReaction?.userIds.includes(authUserId);

    try {
      if (userAlreadyReacted) {
        // P2-18: removeReaction now targets a specific emoji.
        await removeReactionMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          messageId: messageId as Id<'chatRoomMessages'>,
          emoji: emoji as ReactionEmoji,
          authUserId,
        });
      } else {
        await addReactionMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          messageId: messageId as Id<'chatRoomMessages'>,
          emoji: emoji as ReactionEmoji,
          authUserId,
        });
      }
    } catch (error) {
      console.error('[Reaction] Failed to toggle reaction:', error);
    }
  }, [authUserId, roomIdStr, isDemoMode, reactionsMap, addReactionMutation, removeReactionMutation]);

  // ─────────────────────────────────────────────────────────────────────────
  // SCROLL TO MESSAGE (for tap-to-jump on reply quote)
  // ─────────────────────────────────────────────────────────────────────────
  const highlightMessage = useCallback((messageId: string) => {
    setHighlightedMessageId(messageId);
    setTimeout(() => {
      if (mountedRef.current) {
        setHighlightedMessageId(null);
      }
    }, 1300);
  }, []);

  const scrollToLoadedMessage = useCallback((messageId: string) => {
    const index = invertedListItemsRef.current.findIndex(
      (item) => item.type === 'message' && item.id === messageId
    );

    if (index === -1 || !listRef.current) {
      return false;
    }

    listRef.current.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.5,
    });
    highlightMessage(messageId);
    return true;
  }, [highlightMessage]);

  const handleScrollToMessage = useCallback(async (messageId: string) => {
    if (!messageId) {
      return;
    }

    if (scrollToLoadedMessage(messageId)) {
      return;
    }

    let hasMore = hasOlderMessagesRef.current;
    let before =
      olderMessagesRef.current[0]?.createdAt !== undefined
        ? olderMessagesRef.current[0].createdAt + 1
        : liveMessagesRef.current[0]?.createdAt !== undefined
          ? liveMessagesRef.current[0].createdAt + 1
          : undefined;

    while (hasMore && before) {
      if (isLoadingOlderMessagesRef.current) {
        break;
      }

      setIsLoadingOlderMessages(true);
      isLoadingOlderMessagesRef.current = true;
      setLoadOlderError(null);

      try {
        const page = await fetchOlderMessagesPage(before);
        if (!page || page.messages.length === 0) {
          hasMore = false;
          break;
        }

        hasMore = page.hasMore;
        before =
          page.messages[0]?.createdAt !== undefined
            ? page.messages[0].createdAt + 1
            : undefined;

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });

        if (scrollToLoadedMessage(messageId)) {
          return;
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('[CHAT_ROOM] Failed to load target message:', error);
        }
        if (mountedRef.current) {
          setLoadOlderError("Couldn't load older messages.");
        }
        break;
      } finally {
        if (mountedRef.current) {
          setIsLoadingOlderMessages(false);
        }
        isLoadingOlderMessagesRef.current = false;
      }
    }

    Alert.alert('Message unavailable', 'That message is no longer available.');
  }, [fetchOlderMessagesPage, scrollToLoadedMessage]);

  // ─────────────────────────────────────────────────────────────────────────
  // MENTION-NAV: Handle navigation to specific message (from mention tap or route param)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Check route param first (for cross-room navigation)
    const messageIdToScrollTo = routeTargetMessageId || (targetMessageId as string);

    if (messageIdToScrollTo && invertedListItems.length > 0) {
      // Small delay to ensure FlatList is ready
      const timer = setTimeout(() => {
        void handleScrollToMessage(messageIdToScrollTo);

        if (routeTargetMessageId) {
          router.setParams({ targetMessageId: undefined });
        }

        // Clear the target after scrolling
        if (targetMessageId) {
          setTargetMessageId(null);
        }
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [routeTargetMessageId, targetMessageId, invertedListItems.length, handleScrollToMessage, router]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER MESSAGE ITEM (reuses existing components)
  // Implements consecutive message grouping - avatar shown only on first message of group
  // PERF-FIX: Uses refs for frequently changing data to minimize re-renders
  // ─────────────────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: ListItem; index: number }) => {
      // Hide date separators - return null for date items
      if (item.type === 'date') {
        return null;
      }

      const msg = item.message;

      if (msg.type === 'system') {
        // SYSTEM JOIN EVENT: Check systemEventType field for join messages
        const isJoin = (msg as any).systemEventType === 'join' || (msg.text || '').includes('joined');
        return <SystemMessageItem text={msg.text || ''} isJoin={isJoin} />;
      }

      const isMuted = mutedUserIds.has(msg.senderId);
      const isMe = (isDemoMode ? DEMO_CURRENT_USER.id : authUserId) === msg.senderId;
      const senderIdentity = roomIdentityByUserId.get(String(msg.senderId));

      // CHAT ROOM IDENTITY: Use myAvatarUrl for outgoing messages (self).
      // For others: prefer normalized chat-room avatar from member identity, fall back to message payload.
      const avatarUri = isMe ? (myAvatarUrl ?? '') : (senderIdentity?.avatar ?? msg.senderAvatar);
      const senderAge = msg.senderAge ?? senderIdentity?.age;
      const senderGender = msg.senderGender ?? senderIdentity?.gender;
      const uploadStatus = (msg as any).uploadStatus as
        | 'uploading'
        | 'sending'
        | 'upload_failed'
        | 'send_failed'
        | undefined;
      const localUri = (msg as any).localUri as string | undefined;
      const uploadProgress = (msg as any).uploadProgress as number | undefined;

      // PRIVATE-ROOM-ACCESS-FIX: Instrumentation for age render (only log first message to avoid spam)
      if (index === 0 && senderAge) {
        console.log('CHATROOM_AGE_RENDER', { senderId: msg.senderId.slice(0, 12), age: senderAge, source: msg.senderAge ? 'message' : 'identity' });
      }

      // ─── CONSECUTIVE MESSAGE GROUPING ───
      // AVATAR-STABILITY: Use pre-computed showAvatar from ListItem for deterministic grouping
      // This prevents avatar shifting during re-renders
      const showAvatar = item.showAvatar;
      // GROUP-TIMESTAMP: Use pre-computed showTimestamp from ListItem
      const showTimestamp = item.showTimestamp;

      // Build replyTo data if message is a reply
      // Check if original message is deleted (has replyToMessageId but no snippet or type)
      const isOriginalDeleted = !!(msg.replyToMessageId && !msg.replyToSnippet && !msg.replyToType);
      const replyTo = msg.replyToMessageId
        ? {
            messageId: msg.replyToMessageId,
            senderNickname: msg.replyToSenderNickname || 'Anonymous',
            snippet: msg.replyToSnippet || '',
            type: msg.replyToType,
            isDeleted: isOriginalDeleted,
          }
        : null;

      // Handler for swipe-to-reply gesture
      // FLATTEN-REPLY: Always use only the message's OWN content, never nested reply data
      const handleSwipeReply = () => {
        // FLATTEN-REPLY: Extract ONLY the message's own text, ignoring any replyToSnippet
        // This ensures single-level reply preview (no stacking of quote bars)
        let snippet = '';
        if (msg.text) {
          // Use only the message's own text content (not any quoted/nested content)
          const ownText = msg.text;
          snippet = ownText.length > 50 ? ownText.slice(0, 47) + '...' : ownText;
        } else if (msg.type === 'image') {
          snippet = 'Photo';
        } else if (msg.type === 'video') {
          snippet = 'Video';
        } else if (msg.type === 'doodle') {
          snippet = 'Doodle';
        } else if (msg.type === 'audio') {
          snippet = 'Voice message';
        }

        // FLATTEN-REPLY: Use only this message's sender name
        setReplyToMessage({
          id: msg.id,
          senderNickname: msg.senderName || 'Anonymous',
          snippet,
        });
      };

      // P0-005 FINAL FIX: Show failed indicator with retry option
      const isFailed = msg.status === 'failed';
      const isSending = msg.status === 'sending';

      const messageElement = (
        <ChatMessageItem
          messageId={msg.id}
          senderName={msg.senderName}
          senderId={msg.senderId}
          senderAvatar={avatarUri}
          senderAge={senderAge}
          senderGender={senderGender}
          text={msg.text || ''}
          timestamp={msg.createdAt}
          isMe={isMe}
          dimmed={isMuted || isSending}
          messageType={(msg.type || 'text') as 'text' | 'image' | 'video' | 'audio'}
          mediaUrl={msg.mediaUrl}
          localUri={localUri}
          uploadStatus={uploadStatus}
          uploadProgress={uploadProgress}
          onUploadStatusPress={() => handleRetryMediaMessage(msg)}
          audioUrl={msg.audioUrl}
          onLongPress={isFailed ? undefined : (pageX, pageY) => handleMessageLongPress(msg, pageX, pageY)}
          onAvatarPress={() => handleAvatarPress(msg.senderId)}
          onNamePress={() => handleAvatarPress(msg.senderId)}
          onMediaPress={handleMediaPress}
          showTimestamp={showTimestamp}
          showAvatar={showAvatar}
          replyTo={replyTo}
          onReplyTap={handleScrollToMessage}
          onSwipeReply={isFailed ? undefined : handleSwipeReply}
          isHighlighted={highlightedMessageIdRef.current === msg.id}
          mentions={msg.mentions}
          currentUserId={authUserId ?? undefined}
          reactions={reactionsMapRef.current.get(msg.id) || []}
          onReactionTap={(emoji) => handleReactionChipTap(msg.id, emoji)}
        />
      );

      // Wrap failed messages with retry indicator
      if (isFailed) {
        return (
          <Pressable onPress={() => handleRetryMessage(msg)}>
            {messageElement}
            <View style={styles.failedMessageStatus}>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.failedMessageText}>
                Failed to send
              </Text>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.failedRetryText}>
                Tap to retry
              </Text>
            </View>
          </Pressable>
        );
      }

      return messageElement;
    },
    // PERF-FIX: Removed invertedListItems, highlightedMessageId, reactionsMap from deps (using refs)
    [mutedUserIds, authUserId, myAvatarUrl, roomIdentityByUserId, handleMessageLongPress, handleAvatarPress, handleMediaPress, handleScrollToMessage, handleReactionChipTap, handleRetryMessage]
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // PERF-FIX: Estimated item layout for faster scrolling (avoids measuring each item)
  const ESTIMATED_ITEM_HEIGHT = 72; // Average message height
  const getItemLayout = useCallback(
    (_data: ArrayLike<ListItem> | null | undefined, index: number) => ({
      length: ESTIMATED_ITEM_HEIGHT,
      offset: ESTIMATED_ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  // ─────────────────────────────────────────────────────────────────────────
  // P0 FIX: INVALID ROOM ID FALLBACK (CR-001, CR-002)
  // ─────────────────────────────────────────────────────────────────────────
  if (!roomIdStr) {
    return (
      // P1-004 FIX: Remove inline paddingTop - header handles topInset internally
      <View style={styles.container}>
        <ChatRoomsHeader title="Invalid Room" hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={ROOM_STATUS_ICON_SIZE} color={C.textLight} />
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.notFoundText}>
            Room ID is missing
          </Text>
        </View>
      </View>
    );
  }

  // BUG FIX: Safety guard - block invalid roomIds (e.g. fallback_* from UI fallback)
  if (!isDemoMode && !isValidConvexId(roomIdStr)) {
    return (
      // P1-004 FIX: Remove inline paddingTop - header handles topInset internally
      <View style={styles.container}>
        <ChatRoomsHeader title="Invalid Room" hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={ROOM_STATUS_ICON_SIZE} color={C.textLight} />
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.notFoundText}>
            Invalid Room ID
          </Text>
        </View>
      </View>
    );
  }

  // Core room doc (getRoom): while query is in flight (skipped when !isValidRoomId)
  if (
    !isDemoMode &&
    isValidRoomId &&
    !!authUserId &&
    convexRoom === undefined
  ) {
    const loadingTitle =
      typeof routeRoomName === 'string' ? routeRoomName : 'Chat Room';
    return (
      <View style={styles.container}>
        <ChatRoomsHeader title={loadingTitle} hideLeftButton topInset={insets.top} />
        <View style={[styles.notFound, { flex: 1, justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // P2 CR-009: NOT FOUND / ACCESS DENIED CHECK
  // - convexRoom === null → room doesn't exist, expired, or no read access (getRoom returns null)
  // - joinAttempted && joinFailed → user banned or cannot access
  // SECURITY: Show error screen and navigate back safely
  // ─────────────────────────────────────────────────────────────────────────
  const accessStatus = accessStatusQuery?.status;
  const isRoomNotFound =
    !isDemoMode &&
    (convexRoom === null || accessStatus === 'not_found' || accessStatus === 'expired');
  // PRIVATE-ROOM-ACCESS-FIX: Access denied check uses actual backend statuses
  // Backend returns: unauthenticated, not_found, member, expired, banned, pending, rejected, approved_pending_entry, none
  const isAccessDenied =
    !isDemoMode &&
    (
      (joinAttempted && joinFailed) ||
      accessStatus === 'banned' ||
      accessStatus === 'rejected' ||
      accessStatus === 'unauthenticated'
    );

  if (isRoomNotFound || isAccessDenied) {
    const handleBackToRooms = () => {
      // Clear stale preferred room so user doesn't get stuck in a loop
      setCurrentRoom(null);
      exitRoom();
      if (isDemoMode) {
        clearPreferredRoom();
      } else if (authUserId) {
        // CR-017 FIX: Use authUserId for server-side verification
        clearPreferredRoomMutation({ authUserId }).catch((err) => {
          console.error('[ChatRoom] clearPreferredRoomMutation failed:', err);
        });
      }
      router.replace('/(main)/(private)/(tabs)/chat-rooms');
    };

    // PRIVATE-ROOM-ACCESS-FIX: Determine error title and message
    // Removed invite code references - password-only flow
    const errorTitle = isAccessDenied ? 'Access Denied' : 'Room Not Found';
    const errorMessage = isAccessDenied
      ? accessStatus === 'banned'
        ? 'You are banned from this room.'
        : accessStatus === 'rejected'
          ? 'Your join request was rejected.'
          : accessStatus === 'unauthenticated'
            ? 'Please sign in to access this room.'
            : 'You do not have access to this room.'
      : 'Room not found';

    return (
      // P1-004 FIX: Remove inline paddingTop - header handles topInset internally
      <View style={styles.container}>
        <ChatRoomsHeader title={errorTitle} hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons
            name={isAccessDenied ? 'lock-closed-outline' : 'search-outline'}
            size={ROOM_STATUS_ICON_SIZE}
            color={C.textLight}
          />
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.notFoundText}>
            {errorMessage}
          </Text>
          <TouchableOpacity style={styles.backToRoomsBtn} onPress={handleBackToRooms}>
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.backToRoomsBtnText}>
              Back to Chat Rooms
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ISSUE B: Use route param as fallback for instant render
  const roomName = (room as any)?.name ?? routeRoomName ?? 'Chat Room';

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER - KAV + FlatList + flexGrow + justifyContent:flex-end
  // ═══════════════════════════════════════════════════════════════════════
  const Background = isPrivateRoom ? View : RoomBackground;
  const backgroundStyle = isPrivateRoom
    ? [styles.container, { backgroundColor: themeColors.background }]
    : styles.container;

  return (
    <Background style={backgroundStyle}>
      {/* ─── HEADER ─── */}
      <ChatRoomsHeader
        title={roomName}
        subtitle={countdownText ?? undefined}
        onlineCount={isDemoMode ? undefined : roomOnlineCount}
        hideLeftButton
        topInset={insets.top}
        onRefreshPress={handleReload}
        onInboxPress={() => setOverlay('messages')}
        onProfilePress={() => setOverlay('profile')}
        profileAvatar={isDemoMode ? (myAvatarUrl ?? '') : (myAvatarUrl ?? '')}
        unreadInbox={unreadDMs}
        hideInboxAndNotifications={isPrivateRoom}
        showRetentionIndicator
      />

      {/* ─── ACTIVE USERS STRIP ─── */}
      {/* CHATROOM_IDENTITY_FIX: Top strip shows ONLY chat-room photo, gender ring, online dot */}
      {/* NO age per rule 7 */}
      {(() => {
        // CHATROOM_IDENTITY_FIX: Top strip type - NO age field
        let stripUsers: Array<{
          id: string;
          avatar?: string;
          isOnline: boolean;
          joinedAt: number;
          gender?: 'male' | 'female' | 'other';
        }> = [];

        if (isDemoMode) {
          stripUsers = (roomMembers ?? []).filter((u) => u.isOnline).map((u) => ({
            id: u.id,
            avatar: u.avatar, // Demo mode uses demo avatar
            isOnline: true,
            joinedAt: (u as any).joinedAt ?? Date.now(),
            gender: (u as any).gender as 'male' | 'female' | 'other' | undefined,
            // NO age - removed per rule 7
          }));
        } else if (presenceUsers.online.length > 0) {
          // Use presence data if available - avatar comes from chat-room profile
          stripUsers = presenceUsers.online.map((u) => ({
            id: u.id,
            avatar: u.avatar, // This is chat-room avatar (fixed in presenceUsers computation)
            isOnline: true,
            joinedAt: u.joinedAt,
            gender:
              u.gender === 'male' || u.gender === 'female' || u.gender === 'other'
                ? u.gender
                : undefined,
            // NO age - removed per rule 7
          }));
        } else if (convexMembersWithProfiles && convexMembersWithProfiles.length > 0) {
          // Fallback to all members when no presence data
          // CHATROOM_IDENTITY_FIX: Do NOT use main profile avatar in fallback
          // Use chat-room profiles if available
          stripUsers = convexMembersWithProfiles.map((m) => {
            const canon = (canonicalRoomIdentities as any)?.byUserId?.[String(m.id)];
            const chatRoomAvatar = canon?.avatarUrl ?? null;
            return {
              id: m.id,
              // CHATROOM_IDENTITY_FIX: Only use chat-room avatar, NO main profile fallback
              avatar: chatRoomAvatar ? (buildCacheBustedAvatarUrl(chatRoomAvatar, (m as any).avatarVersion) ?? undefined) : undefined,
              isOnline: false, // Unknown online status
              joinedAt: Date.now(), // Fallback timestamp
              gender: m.gender as 'male' | 'female' | 'other' | undefined,
              // NO age - removed per rule 7
            };
          });
        }

        // Presence propagation gap fallback (public rooms only, short window, visual-only):
        // If heartbeat was ACKed but query hasn't reflected it yet, show ONLY self to avoid flashing empty.
        if (
          !isDemoMode &&
          stripUsers.length === 0 &&
          isPublicFromRoute === true &&
          presenceUsers.online.length === 0 &&
          !(convexMembersWithProfiles && convexMembersWithProfiles.length > 0) &&
          firstHeartbeatAckAtRef.current &&
          Date.now() - firstHeartbeatAckAtRef.current < 500
        ) {
          const selfId = selfUserIdFromCanonical ?? (effectiveUserId ? String(effectiveUserId) : null);
          if (selfId) {
            if (__DEV__) console.log('CHATROOM_TOP_STRIP_PROPAGATION_GAP_FALLBACK', {
              roomId: roomIdStr,
              reason: 'self_during_gap',
            });
            stripUsers = [
              {
                id: selfId,
                avatar: myAvatarUrl ?? undefined,
                isOnline: true,
                joinedAt: Date.now(),
                // gender intentionally omitted here; canonical presence will fill it on next update
              },
            ];
          }
        }

        // Required debug logs: final strip + sync check against canonical identity.
        if (__DEV__) console.log('CHATROOM_TOP_STRIP_RENDER_FINAL', {
          roomId: roomIdStr,
          count: stripUsers.length,
          source: isDemoMode ? 'demo' : presenceUsers.online.length > 0 ? 'presence' : (convexMembersWithProfiles?.length ? 'members_fallback' : 'empty'),
        });
        if (__DEV__) console.log('CHATROOM_TOP_STRIP_SYNC_CHECK', {
          roomId: roomIdStr,
          users: stripUsers.slice(0, 8).map((u) => {
            const canon = (canonicalRoomIdentities as any)?.byUserId?.[String(u.id)];
            return {
              id: String(u.id).slice(0, 12),
              hasAvatar: !!u.avatar,
              canonHasAvatar: !!canon?.avatarUrl,
              canonNickname: canon?.nickname ?? null,
              gender: u.gender ?? null,
              isOnline: u.isOnline,
            };
          }),
        });

        if (!isDemoMode && stripUsers.length === 0) {
          if (__DEV__) console.log('CHATROOM_TOP_STRIP_FALLBACK_REASON', {
            roomId: roomIdStr,
            reason: 'no_presence_and_no_members',
            presenceOnlineCount: presenceUsers.online.length,
            memberCount: convexMembersWithProfiles?.length ?? 0,
          });
        }

        return (
          <ActiveUsersStrip
            users={stripUsers}
            theme="dark"
            hideLabel
            onPress={() => {
              if (__DEV__) console.log('CHATROOM_TOP_MEMBER_ROW_TAP', { count: stripUsers.length });
              if (__DEV__) console.log('CHATROOM_MEMBER_LIST_OPEN', { roomId: roomIdStr });
              setOverlay('onlineUsers');
            }}
          />
        );
      })()}

      {/* ─── KEYBOARD AVOIDING VIEW ─── */}
      {/* P1-003 FIX: Use "padding" on iOS, "height" on Android for better keyboard handling */}
      {/* Android with softwareKeyboardLayoutMode="resize" works better with height behavior */}
      {/* Android: Use key to force re-mount when keyboard hides, fixing layout reset */}
      <KeyboardAvoidingView
        key={Platform.OS === 'android' ? kavKey : undefined}
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.chatArea}>
          {messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrapper}>
                <Ionicons name="chatbubble-outline" size={EMPTY_STATE_ICON_SIZE} color={C.textLight} />
              </View>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.emptyText}>
                No messages yet
              </Text>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.emptySubtext}>
                Be the first to say something
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={invertedListItems}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              // P0-004 FIX: Removed getItemLayout - it assumes fixed height (72px)
              // which causes scroll jumps for variable-height content (images, audio, replies)
              // getItemLayout={getItemLayout}
              inverted={true}
              contentContainerStyle={{
                flexGrow: 1,
                paddingHorizontal: SPACING.xs + SPACING.xxs,
                paddingTop: isPrivateChatOpen ? 0 : composerHeight,
                paddingBottom: SPACING.xs,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onScroll={handleScroll}
              scrollEventThrottle={16}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onScrollToIndexFailed={({ index }) => {
                setTimeout(() => {
                  try {
                    listRef.current?.scrollToIndex({
                      index,
                      animated: true,
                      viewPosition: 0.5,
                    });
                  } catch {
                    // Let the user retry by tapping again if the target is still not measurable.
                  }
                }, 120);
              }}
              // P0-004 FIX: Optimized FlatList tuning for variable-height content
              initialNumToRender={15}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={50}
              windowSize={7}
              // P0-004 FIX: Disable removeClippedSubviews on Android to prevent blank cells
              removeClippedSubviews={Platform.OS === 'ios'}
              // P0-004 FIX: Use highlightedMessageId ref only (reactions use ref, not extraData)
              // This prevents full list re-render when reactions change
              extraData={highlightedMessageId}
              onEndReached={() => {
                if (!isDemoMode && hasOlderMessages && !isLoadingOlderMessages) {
                  void handleLoadOlderMessages();
                }
              }}
              onEndReachedThreshold={0.2}
              ListFooterComponent={
                !isDemoMode && (hasOlderMessages || isLoadingOlderMessages || loadOlderError) ? (
                  <View style={styles.olderMessagesStatus}>
                    {isLoadingOlderMessages ? (
                      <ActivityIndicator size="small" color={C.textLight} />
                    ) : loadOlderError ? (
                      <TouchableOpacity
                        style={styles.retryOlderButton}
                        onPress={() => void handleLoadOlderMessages()}
                        activeOpacity={0.7}
                      >
                        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.retryOlderText}>
                          Retry older messages
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.olderMessagesHint}>
                        Older messages available
                      </Text>
                    )}
                  </View>
                ) : null
              }
            />
          )}

          {/* ─── COMPOSER ─── Hidden when Private Chat sheet is open */}
          {!isPrivateChatOpen && (
            <View
              style={[styles.composerWrapper, { paddingBottom: footerInsetSpacing }]}
              onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
            >
              {/* MENTION-INDICATOR: Shows when user has unread mentions in this room */}
              {/* MENTION-UI-CLEAN: Shows only @ symbol, no username - compact and minimal */}
              {currentRoomUnreadMentions.length > 0 && !hasSendPenalty && (
                <TouchableOpacity
                  style={styles.mentionIndicator}
                  onPress={handleMentionIndicatorTap}
                  activeOpacity={0.7}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="at" size={SIZES.icon.md} color="#FFFFFF" />
                </TouchableOpacity>
              )}

              {/* Phase-2: Show send-blocked notice if user has penalty */}
              {hasSendPenalty ? (
                <View style={styles.readOnlyNotice}>
                  <Ionicons name="lock-closed" size={SIZES.icon.sm} color={C.textLight} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.readOnlyText}>
                    Read-only (24h)
                  </Text>
                </View>
              ) : (
                <ChatComposer
                  value={inputText}
                  onChangeText={(text) => {
                    setInputText(text);
                    // CHATROOM_ACTIVITY_HEARTBEAT_REMOVED: Activity heartbeat on typing removed, using timer-based only
                  }}
                  onSend={handleSend}
                  onPlusPress={() => setOverlay('attachment')}
                  onMicPress={toggleRecording}
                  onPanelChange={handlePanelChange}
                  isRecording={isRecording}
                  elapsedMs={elapsedMs}
                  replyPreview={replyToMessage ? {
                    messageId: replyToMessage.id,
                    senderNickname: replyToMessage.senderNickname,
                    snippet: replyToMessage.snippet,
                  } : null}
                  onCancelReply={handleCancelReply}
                  mentionMembers={mentionMembers}
                  onMentionsChange={setCurrentMentions}
                />
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* MODALS / SHEETS / PANELS                                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {/* DM-ID-FIX: Use Convex-backed DM threads */}
      <MessagesPopover
        visible={overlay === 'messages'}
        onClose={closeOverlay}
        dms={dmsForPopover}
        onOpenChat={(dm) => {
          closeOverlay();
          // DM-ID-FIX: dm.id is the threadId from Convex
          const threadId = dm.id as Id<'conversations'>;
          const dmInfo = {
            id: dm.id,
            peerId: dm.peerId,
            peerName: dm.peerName,
            peerAvatar: dm.peerAvatar,
            peerGender: dm.peerGender,
          };
          setActiveDm(dmInfo, threadId, roomIdStr!);
        }}
        onHideDM={(dmId) => {
          // HIDE-VS-DELETE-FIX: Hide DM from list (data persists, reappears on new message)
          handleHideDmThread(dmId);
        }}
      />

      {/* @Mentions Popover */}
      <MentionsPopover
        visible={overlay === 'mentions'}
        onClose={closeOverlay}
        mentions={mentions}
        isLoading={
          mentionsQuery === undefined && !!(authUserId && hasMemberAccess)
        }
        onOpenMention={handleOpenMention}
        onMarkAllRead={handleMarkAllMentionsRead}
      />

      {/* DATA-SOURCE FIX: Use real profile data in non-demo mode */}
      <ProfilePopover
        visible={overlay === 'profile'}
        onClose={closeOverlay}
        username={isDemoMode
          ? (myNickname)
          : (myNickname)}
        avatar={isDemoMode
          ? (myAvatarUrl ?? '')
          : (myAvatarUrl ?? '')}
        isActive={true}
        coins={userCoins}
        age={isDemoMode ? (DEMO_CURRENT_USER.age ?? 25) : undefined}
        gender={isDemoMode ? (DEMO_CURRENT_USER.gender ?? 'Unknown') : undefined}
        bio={isDemoMode ? undefined : (myBio || undefined)}
        onLeaveRoom={isPrivateRoom ? handleLeavePrivateRoom : handleLeaveRoom}
        isPrivateRoom={isPrivateRoom}
        isRoomOwner={isRoomCreator}
        roomPassword={roomPassword}
        onEndRoom={handleEndRoom}
      />

      {/* MEMBER-DATA FIX: Use room presence data in real mode, roomMembers for demo */}
      {/* SAFETY: Use empty array if roomMembers undefined */}
      {/* CACHE-BUST-FIX: Transform presence data to use cache-busted avatar URLs */}
      <OnlineUsersPanel
        visible={overlay === 'onlineUsers'}
        onClose={closeOverlay}
        users={isDemoMode ? (roomMembers ?? []) : undefined}
        presenceOnline={isDemoMode ? undefined : presenceUsers.online}
        presenceRecentlyLeft={isDemoMode ? undefined : presenceUsers.recentlyLeft}
        onUserPress={handleOnlineUserPress}
      />

      <MessageActionsSheet
        visible={overlay === 'messageActions'}
        onClose={() => { closeOverlay(); setSelectedMessage(null); }}
        pressX={messageActionPosition.x}
        pressY={messageActionPosition.y}
        isOwnMessage={selectedMessage ? (isDemoMode ? DEMO_CURRENT_USER.id : authUserId) === selectedMessage.senderId : false}
        canModerate={canModerate}
        onDelete={handleDeleteMessage}
        onReport={handleReportMessage}
        onReply={handleReplyToMessage}
        onReact={handleReact}
      />

      <UserProfilePopup
        visible={overlay === 'userProfile'}
        onClose={() => { closeOverlay(); setSelectedUser(null); }}
        user={selectedUser}
        isMuted={selectedUser ? mutedUserIds.has(selectedUser.id) : false}
        onViewProfile={handleViewProfile}
        onPrivateMessage={handlePrivateMessage}
        onMuteUser={handleToggleMuteUser}
        onReport={handleReport}
      />

      <ViewProfileModal
        visible={overlay === 'viewProfile'}
        onClose={() => { closeOverlay(); setViewProfileUser(null); }}
        user={viewProfileUser}
      />

      {/* Floating attachment menu - positioned above plus button */}
      <AttachmentPopup
        visible={overlay === 'attachment'}
        onClose={closeOverlay}
        onImageCaptured={(uri) => handleSendMedia(uri, 'image')}
        onGalleryImage={(uri) => handleSendMedia(uri, 'image')}
        onVideoSelected={(uri) => handleSendMedia(uri, 'video')}
        onDoodlePress={() => setOverlay('doodle')}
      />

      <DoodleCanvas
        visible={overlay === 'doodle'}
        onClose={closeOverlay}
        onSend={(uri) => handleSendMedia(uri, 'doodle')}
      />

      {/* TAP-TO-VIEW-FIX: Secure Media Viewer (tap to open, tap/button to close) */}
      <SecureMediaViewer
        visible={secureMediaState.visible}
        isHolding={secureMediaState.isHolding}
        mediaUri={secureMediaState.uri}
        type={secureMediaState.type}
        onClose={handleMediaClose}
      />

      <ReportUserModal
        visible={overlay === 'report'}
        onClose={() => { closeOverlay(); setReportTargetUser(null); }}
        reportedUserId={reportTargetUser?.id || ''}
        reportedUserName={reportTargetUser?.username || ''}
        roomId={roomIdStr}
        onSubmit={handleSubmitReport}
      />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PRIVATE CHAT SHEET - Bottom sheet style, ~55-60% collapsed height */}
      {/* - Expands on input focus                                           */}
      {/* - Collapses after sending                                          */}
      {/* - X button to close (no outside tap close)                         */}
      {/* - No background overlay, background remains interactive            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <ChatSheet
        visible={isPrivateChatOpen}
        onClose={clearActiveDm}
        peerId={activeDm?.peerId}
        peerName={activeDm?.peerName}
      >
        {/* Private Chat View - DM-ID-FIX: Pass threadId for Convex backend sync */}
        {activeDm && (
          <PrivateChatView
            dm={activeDm}
            threadId={
              activeThreadId
                ? (activeThreadId as Id<'conversations'>)
                : undefined
            }
            onBack={clearActiveDm}
            topInset={0}
            isModal={true}
          />
        )}
      </ChatSheet>

      {/* COIN-FLASH-FIX: CoinFeedback animation removed - was causing yellow flash during send */}
    </Background>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  chatArea: {
    flex: 1,
    // Ensure chat area doesn't overflow - contains FlatList and composer
    overflow: 'hidden',
  },
  composerWrapper: {
    backgroundColor: C.background,
    // Ensure composer is always at bottom of chatArea, never overlapping tab bar
    flexShrink: 0,
  },
  failedMessageStatus: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingRight: SPACING.base,
    marginTop: -SPACING.xs,
    marginBottom: SPACING.sm,
  },
  failedMessageText: {
    fontSize: FAILED_STATUS_TEXT_SIZE,
    fontWeight: '500',
    lineHeight: lineHeight(FAILED_STATUS_TEXT_SIZE, 1.35),
    color: '#EF4444',
    marginRight: SPACING.xs,
  },
  failedRetryText: {
    fontSize: FAILED_STATUS_TEXT_SIZE,
    fontWeight: '500',
    lineHeight: lineHeight(FAILED_STATUS_TEXT_SIZE, 1.35),
    color: '#3B82F6',
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xxl,
  },
  notFoundText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.2),
    color: C.textLight,
    textAlign: 'center',
  },
  backToRoomsBtn: {
    marginTop: SPACING.base,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: '#6D28D9',
    borderRadius: SIZES.radius.md,
  },
  backToRoomsBtnText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
    color: '#FFFFFF',
  },
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    // P2-002: Use SPACING constants
    marginVertical: SPACING.md,
    paddingHorizontal: SPACING.base,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dateLabel: {
    fontSize: FONT_SIZE.caption,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: C.textLight,
    marginHorizontal: SPACING.md,
  },
  // P2-010: Improved empty state styling
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xxl,
  },
  emptyIconWrapper: {
    width: EMPTY_ICON_WRAPPER_SIZE,
    height: EMPTY_ICON_WRAPPER_SIZE,
    borderRadius: EMPTY_ICON_WRAPPER_SIZE / 2,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    // P2-010: Add subtle border for definition
    borderWidth: 1,
    borderColor: 'rgba(109, 40, 217, 0.2)',
  },
  emptyText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.2),
    color: C.text,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONT_SIZE.body2,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
  },
  olderMessagesStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
  },
  olderMessagesHint: {
    fontSize: FONT_SIZE.caption,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: C.textLight,
  },
  retryOlderButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: SIZES.radius.sm,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.accent,
  },
  retryOlderText: {
    fontSize: FONT_SIZE.caption,
    color: C.text,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.caption, 1.2),
  },
  // P2-012: Improved read-only notice styling
  readOnlyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.base,
    gap: SPACING.sm,
    // P2-012: More serious appearance
    backgroundColor: 'rgba(255, 152, 0, 0.08)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 152, 0, 0.2)',
  },
  readOnlyText: {
    fontSize: FONT_SIZE.body,
    // P2-012: More visible warning color
    color: '#FF9800',
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
  },
  // MENTION-INDICATOR: Clean circular button showing only @ symbol
  // MENTION-UI-CLEAN: Minimal, easy-to-tap, premium appearance
  mentionIndicator: {
    position: 'absolute',
    top: -MENTION_INDICATOR_OFFSET,
    right: SPACING.md,
    width: MENTION_INDICATOR_SIZE,
    height: MENTION_INDICATOR_SIZE,
    borderRadius: SIZES.radius.full,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow for premium feel
    shadowColor: '#6D28D9',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
    zIndex: 10,
  },
});
