import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Alert,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  FlatList,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  DEMO_CHAT_ROOMS,
  getDemoMessagesForRoom,
  DEMO_DM_INBOX,
  DEMO_FRIEND_REQUESTS,
  DEMO_ANNOUNCEMENTS,
  DEMO_CURRENT_USER,
  DEMO_ONLINE_USERS,
  DemoChatMessage,
  DemoDM,
  DemoFriendRequest,
  DemoAnnouncement,
  DemoOnlineUser,
} from '@/lib/demoData';

import ChatRoomsHeader from '@/components/chatroom/ChatRoomsHeader';
import ChatMessageItem from '@/components/chatroom/ChatMessageItem';
import SystemMessageItem from '@/components/chatroom/SystemMessageItem';
import ChatComposer, { type ComposerPanel } from '@/components/chatroom/ChatComposer';
import MessagesPopover from '@/components/chatroom/MessagesPopover';
import FriendRequestsPopover from '@/components/chatroom/FriendRequestsPopover';
import NotificationsPopover from '@/components/chatroom/NotificationsPopover';
import ProfilePopover from '@/components/chatroom/ProfilePopover';
import OnlineUsersPanel from '@/components/chatroom/OnlineUsersPanel';
import MessageActionsSheet from '@/components/chatroom/MessageActionsSheet';
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
import { useChatRoomProfileStore } from '@/stores/chatRoomProfileStore';
import { useVoiceRecorder, VoiceRecorderResult } from '@/hooks/useVoiceRecorder';
// DATA-SOURCE FIX: Import privateProfileStore for real user identity (age, gender, name)
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import PrivateChatView from '@/components/chatroom/PrivateChatView';
import { ensureStableFile, uploadMediaToConvex } from '@/lib/uploadUtils';

const C = INCOGNITO_COLORS;
const EMPTY_MESSAGES: DemoChatMessage[] = [];

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
type ListItem =
  | { type: 'date'; id: string; label: string }
  | { type: 'message'; id: string; message: DemoChatMessage };

// Build list items with date separators (normal order, NOT reversed)
// P1 CR-006: Use index in date separator ID to avoid key collisions
function buildListItems(messages: DemoChatMessage[]): ListItem[] {
  const items: ListItem[] = [];
  let lastDateLabel = '';
  let dateIndex = 0;
  for (const msg of messages) {
    const label = formatDateLabel(msg.createdAt);
    if (label !== lastDateLabel) {
      items.push({ type: 'date', id: `date_${dateIndex++}_${msg.createdAt}`, label });
      lastDateLabel = label;
    }
    items.push({ type: 'message', id: msg.id, message: msg });
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERLAY TYPE
// ═══════════════════════════════════════════════════════════════════════════

type Overlay =
  | 'none'
  | 'profile'
  | 'notifications'
  | 'friendRequests'
  | 'messages'
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

  // ISSUE B: Read route params for instant render fallback
  const { roomId, roomName: routeRoomName, isPrivate: routeIsPrivate } = useLocalSearchParams<{
    roomId: string;
    roomName?: string;
    isPrivate?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ─────────────────────────────────────────────────────────────────────────
  // P0 FIX: Normalize and validate roomId before any usage
  // ─────────────────────────────────────────────────────────────────────────
  // Normalize: useLocalSearchParams can return string | string[] | undefined
  const roomIdStr = typeof roomId === 'string' ? roomId : Array.isArray(roomId) ? roomId[0] : undefined;
  // For demo mode: any non-empty string is valid (demo rooms use simple IDs like "room_global")
  // For Convex mode: must pass isValidConvexId check
  const hasValidRoomId = !!roomIdStr && (isDemoMode || isValidConvexId(roomIdStr));

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH & SESSION
  // ─────────────────────────────────────────────────────────────────────────
  const authUserId = useAuthStore((s) => s.userId);
  const enterRoom = useChatRoomSessionStore((s) => s.enterRoom);
  const exitRoom = useChatRoomSessionStore((s) => s.exitRoom);
  const incrementCoins = useChatRoomSessionStore((s) => s.incrementCoins);
  const userCoinsFromStore = useChatRoomSessionStore((s) => s.coins);

  // Persisted chat room profile (name/avatar/bio - separate from main profile)
  const persistedDisplayName = useChatRoomProfileStore((s) => s.displayName);
  const persistedAvatarUri = useChatRoomProfileStore((s) => s.avatarUri);
  const persistedBio = useChatRoomProfileStore((s) => s.bio);

  // DATA-SOURCE FIX: Get real user identity from privateProfileStore (Convex-backed)
  const realDisplayName = usePrivateProfileStore((s) => s.displayName);
  const realAge = usePrivateProfileStore((s) => s.age);
  const realGender = usePrivateProfileStore((s) => s.gender);
  const realPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const realBio = usePrivateProfileStore((s) => s.privateBio);

  // DM store - for Modal-based private chat (no navigation, just state)
  const activeDm = useChatRoomDmStore((s) => s.activeDm);
  const setActiveDm = useChatRoomDmStore((s) => s.setActiveDm);
  const clearActiveDm = useChatRoomDmStore((s) => s.clearActiveDm);
  // Track if Private Chat DM modal is open (hides chat room composer)
  const isPrivateChatOpen = activeDm !== null;

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
  // Membership confirmed when checkRoomAccess returns 'member' status
  const hasMemberAccess = accessStatusQuery?.status === 'member';

  // Protected queries require membership - skip until access confirmed
  // This prevents "must join first" errors during the join race condition
  const shouldSkipProtectedQueries = shouldSkipConvex || !hasMemberAccess;

  const convexRoom = useQuery(
    api.chatRooms.getRoom,
    shouldSkipProtectedQueries ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  );
  const convexMessagesResult = useQuery(
    api.chatRooms.listMessages,
    shouldSkipProtectedQueries ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId!, limit: 50 }
  );

  // Convex mutations
  const sendMessageMutation = useMutation(api.chatRooms.sendMessage);
  const generateUploadUrlMutation = useMutation(api.chatRooms.generateUploadUrl); // CR-009: For media upload
  const joinRoomMutation = useMutation(api.chatRooms.joinRoom);
  const closeRoomMutation = useMutation(api.chatRooms.closeRoom);
  const deleteMessageMutation = useMutation(api.chatRooms.deleteMessage);

  // Room preferences (muting) and reports - Convex-backed persistence
  const setUserRoomMutedMutation = useMutation(api.chatRooms.setUserRoomMuted);
  const markReportedRoomMutation = useMutation(api.chatRooms.markReportedRoom);
  const submitChatRoomReportMutation = useMutation(api.chatRooms.submitChatRoomReport);

  // Skip queries that require userId in demo mode (no real user identity)
  const shouldSkipUserIdQueries = isDemoMode || !authUserId;

  // Query room mute preference (Convex-backed)
  // LOGOUT-RACE FIX: Skip when auth is missing to prevent errors during logout
  // NOTE: This query uses optional auth so it's OK to run before membership confirmed
  const roomPrefQuery = useQuery(
    api.chatRooms.getUserRoomPref,
    shouldSkipConvex ? 'skip' : { roomId: roomIdStr!, authUserId: authUserId ?? undefined }
  );
  const isRoomMutedFromConvex = roomPrefQuery?.muted ?? false;

  // Query if room has been reported (Convex-backed)
  // LOGOUT-RACE FIX: Skip when auth is missing to prevent errors during logout
  // NOTE: This query uses optional auth so it's OK to run before membership confirmed
  const reportedQuery = useQuery(
    api.chatRooms.hasReportedRoom,
    shouldSkipConvex ? 'skip' : { roomId: roomIdStr!, authUserId: authUserId ?? undefined }
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
  );

  // Unified room object: prefer demoRoom if found, else use convexRoom
  const room = demoRoom ?? convexRoom;

  // Phase-2: Determine if this is a private room (for hiding inbox/notifications)
  // Private rooms have a joinCode field
  // ISSUE B: Use route param as fallback for instant render
  const isPrivateRoom = convexRoom?.joinCode
    ? true
    : routeIsPrivate === '1';

  // Phase-2: Get effective userId (for demo mode owner detection)
  const effectiveUserIdQuery = useQuery(
    api.chatRooms.getEffectiveUserId,
    isDemoMode && authUserId
      ? { isDemo: true, demoUserId: authUserId }
      : {}
  );
  const effectiveUserId = effectiveUserIdQuery?.userId ?? null;

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

  // Phase-2: Check if room can be closed (has expiresAt, meaning not permanent)
  const canCloseRoom = isRoomCreator && convexRoom?.expiresAt;
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

  // LOGOUT-RACE FIX: Navigate away when auth is lost while screen is mounted
  // This prevents protected queries from erroring during logout transition
  useEffect(() => {
    // Only applies in non-demo mode when auth is lost
    if (isDemoMode) return;
    if (authUserId) return; // Auth still present, nothing to do

    // Auth is missing - user logged out while viewing this screen
    // Navigate to a safe route (phase-2 home which doesn't require room auth)
    router.replace('/(main)/(private)/(tabs)/desire-land');
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
  useEffect(() => {
    if (roomIdStr) {
      // DATA-SOURCE FIX: Use real profile data in non-demo mode, demo data only in demo mode
      const identity = isDemoMode
        ? {
            userId: DEMO_CURRENT_USER.id,
            name: persistedDisplayName ?? DEMO_CURRENT_USER.username,
            age: DEMO_CURRENT_USER.age ?? 25,
            gender: DEMO_CURRENT_USER.gender ?? 'Unknown',
            profilePicture: persistedAvatarUri ?? DEMO_CURRENT_USER.avatar ?? '',
          }
        : {
            userId: authUserId ?? 'unknown',
            name: persistedDisplayName ?? realDisplayName ?? 'User',
            age: realAge ?? 0,
            gender: realGender ?? '',
            profilePicture: persistedAvatarUri ?? '',
          };
      enterRoom(roomIdStr, identity);

      // Save as preferred room (for auto-redirect on next visit)
      if (isDemoMode) {
        setPreferredRoom(roomIdStr);
      } else if (authUserId && hasValidRoomId) {
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
  }, [roomIdStr, enterRoom, authUserId, hasValidRoomId, setPreferredRoom, setPreferredRoomMutation, persistedDisplayName, persistedAvatarUri, realDisplayName, realAge, realGender]);

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE-2 BACK NAVIGATION: Go to Desire Land (not chat-rooms list)
  // This prevents the "loading" flash when backing out of auto-opened room.
  // Policy: Any Phase-2 screen → back → Desire Land → back → Phase-1 Discover
  // ─────────────────────────────────────────────────────────────────────────
  const navigation = useNavigation();
  const PHASE2_HOME_ROUTE = '/(main)/(private)/(tabs)/desire-land';

  // Android hardware back → go to Desire Land
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBackPress = () => {
      router.replace(PHASE2_HOME_ROUTE);
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [router]);

  // iOS swipe-back / header back → go to Desire Land
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      // Only intercept GO_BACK and POP actions (not NAVIGATE, REPLACE, etc.)
      const actionType = e.data?.action?.type;
      if (actionType !== 'GO_BACK' && actionType !== 'POP') return;

      // Prevent default back behavior
      e.preventDefault();

      // Navigate to Desire Land instead
      router.replace(PHASE2_HOME_ROUTE);
    });
    return unsubscribe;
  }, [navigation, router]);


  // ─────────────────────────────────────────────────────────────────────────
  // FLATLIST REF & COMPOSER HEIGHT
  // ─────────────────────────────────────────────────────────────────────────
  const listRef = useRef<FlatList<ListItem>>(null);
  const [composerHeight, setComposerHeight] = useState(56);

  // Near-bottom tracking for smart auto-scroll (don't jump when user reads older messages)
  const isNearBottomRef = useRef(true);
  const SCROLL_THRESHOLD = 120;

  // ─────────────────────────────────────────────────────────────────────────
  // SCROLL TRACKING (for inverted list, "near bottom" is near top of offset)
  // ─────────────────────────────────────────────────────────────────────────
  const handleScroll = useCallback((event: any) => {
    const { contentOffset } = event.nativeEvent;
    // In inverted list, offset near 0 means we're at the "bottom" (latest messages)
    isNearBottomRef.current = contentOffset.y < SCROLL_THRESHOLD;
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

  const messages: DemoChatMessage[] = useMemo(() => {
    if (isDemoMode) return demoMessages;
    const convexMsgs = convexMessagesResult?.messages ?? [];
    // P1 FIX: Filter out server messages whose clientId matches a pending message (dedup)
    const pendingClientIds = new Set(pendingMessages.map((m) => m.id.replace('pending_', '')));
    const deduped = convexMsgs.filter((m) => !m.clientId || !pendingClientIds.has(m.clientId));
    const converted: DemoChatMessage[] = deduped.map((m) => ({
      id: m._id,
      roomId: m.roomId,
      senderId: m.senderId,
      senderName: 'User',
      type: m.type as DemoChatMessage['type'],
      text: m.text,
      mediaUrl: m.imageUrl,
      audioUrl: m.audioUrl,
      createdAt: m.createdAt,
    }));
    return [...converted, ...pendingMessages];
  }, [isDemoMode, demoMessages, convexMessagesResult, pendingMessages]);

  // ─────────────────────────────────────────────────────────────────────────
  // INVERTED FLATLIST: Build list items in reverse order (newest first)
  // This ensures the list always opens at the latest message without scrolling
  // ─────────────────────────────────────────────────────────────────────────
  const invertedListItems = useMemo(() => {
    // Build items in normal order, then reverse for inverted FlatList
    const items = buildListItems(messages);
    return items.slice().reverse();
  }, [messages]);

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
      if (__DEV__) {
        console.warn('[ChatRoom] Store hydration timeout - proceeding with demo seeding');
      }
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

  // Auto-join Convex room (skip if invalid ID)
  // MEMBERSHIP LIFECYCLE: Also track currentRoomId for leave-on-homepage logic
  useEffect(() => {
    if (isDemoMode || !hasValidRoomId || !authUserId) return;

    // Track that user is currently viewing this room
    setCurrentRoom(roomIdStr);

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
  }, [roomIdStr, hasValidRoomId, authUserId, joinRoomMutation, setCurrentRoom]);

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [inputText, setInputText] = useState('');
  // WALLET-FIX: In real mode, use Convex walletCoins (source of truth, auto-updates reactively)
  // In demo mode, use session store coins (no backend persistence)
  const userCoins = isDemoMode
    ? (userCoinsFromStore > 0 ? userCoinsFromStore : DEMO_CURRENT_USER.coins)
    : convexWalletCoins;

  // ─────────────────────────────────────────────────────────────────────────
  // MEMBER-DATA FIX: Transform Convex member data for UI components
  // In demo mode: use DEMO_ONLINE_USERS
  // In real mode: use Convex-backed member data with profiles
  // ─────────────────────────────────────────────────────────────────────────
  const roomMembers: DemoOnlineUser[] = useMemo(() => {
    if (isDemoMode) {
      return DEMO_ONLINE_USERS;
    }
    // Real mode: transform Convex data to DemoOnlineUser shape
    if (!convexMembersWithProfiles) {
      return []; // Still loading or no members
    }
    return convexMembersWithProfiles.map((m) => ({
      id: m.id,
      username: m.displayName,
      avatar: m.avatar,
      isOnline: m.isOnline,
      gender: m.gender as 'male' | 'female' | undefined,
      age: m.age,
      chatBio: m.bio,
      // MEMBER-STRIP FIX: Provide lastSeen for OnlineUsersPanel categorization
      lastSeen: m.lastActive,
    }));
  }, [convexMembersWithProfiles]);

  // ─────────────────────────────────────────────────────────────────────────
  // DM / FRIEND REQUESTS / NOTIFICATIONS STATE
  // DATA-SOURCE FIX: Only use demo data in demo mode, empty arrays in real mode
  // ─────────────────────────────────────────────────────────────────────────
  const [dms, setDMs] = useState<DemoDM[]>(isDemoMode ? DEMO_DM_INBOX : []);
  const unreadDMs = dms.filter((dm) => dm.visible && !dm.hiddenUntilNextMessage && dm.unreadCount > 0).length;

  const [friendRequests, setFriendRequests] = useState<DemoFriendRequest[]>(isDemoMode ? DEMO_FRIEND_REQUESTS : []);
  const [announcements, setAnnouncements] = useState<DemoAnnouncement[]>(isDemoMode ? DEMO_ANNOUNCEMENTS : []);
  const unseenNotifications = announcements.filter((a) => !a.seen).length;

  // ─────────────────────────────────────────────────────────────────────────
  // OVERLAY STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<Overlay>('none');
  const closeOverlay = useCallback(() => setOverlay('none'), []);

  const [selectedMessage, setSelectedMessage] = useState<DemoChatMessage | null>(null);
  // Position for anchored message actions popup
  const [messageActionPosition, setMessageActionPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedUser, setSelectedUser] = useState<DemoOnlineUser | null>(null);
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
  const [mutedUserIds, setMutedUserIds] = useState<Set<string>>(new Set());

  const handleToggleMuteUser = useCallback((userId: string) => {
    setMutedUserIds((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }, []);

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

  // Standard leave (public rooms): clears session and preferred room
  const handleLeaveRoom = useCallback(() => {
    closeOverlay();
    exitRoom();

    // Set hasRedirectedInSession before navigation to prevent redirect race
    setHasRedirectedInSession(true);

    // Clear preferred room so user sees homepage next time
    if (isDemoMode) {
      clearPreferredRoom();
    } else if (authUserId) {
      // CR-017 FIX: Use authUserId for server-side verification
      clearPreferredRoomMutation({ authUserId }).catch(() => {
        // Ignore errors - clearing preference is best-effort
      });
    }

    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, exitRoom, router, authUserId, clearPreferredRoom, clearPreferredRoomMutation, setHasRedirectedInSession]);

  // Phase-2: Private room leave - just navigate back, don't clear membership or preferred
  const handleLeavePrivateRoom = useCallback(() => {
    closeOverlay();
    setHasRedirectedInSession(true);
    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, router, setHasRedirectedInSession]);

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
              clearPreferredRoom();
              if (!isDemoMode && authUserId) {
                // CR-017 FIX: Use authUserId for server-side verification
                clearPreferredRoomMutation({ authUserId }).catch(() => {});
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
  }, [isRoomCreator, authUserId, roomIdStr, closeRoomMutation, router, clearPreferredRoom, clearPreferredRoomMutation, setHasRedirectedInSession]);

  // Phase-2: Close room handler (creator only)
  const handleCloseRoom = useCallback(() => {
    if (!canCloseRoom || !authUserId || !roomIdStr) return;

    Alert.alert(
      'Close Room',
      'Close room? This deletes the room and all messages permanently.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Room',
          style: 'destructive',
          onPress: async () => {
            try {
              // CR-016 FIX: Pass authUserId for server-side verification
              await closeRoomMutation({
                roomId: roomIdStr as Id<'chatRooms'>,
                authUserId: authUserId!,
              });
              setHasRedirectedInSession(true);
              router.replace('/(main)/(private)/(tabs)/chat-rooms');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to close room');
            }
          },
        },
      ]
    );
  }, [canCloseRoom, authUserId, roomIdStr, closeRoomMutation, router, setHasRedirectedInSession]);

  // ─────────────────────────────────────────────────────────────────────────
  // RELOAD HANDLER (demo mode only - resets demo state)
  // ─────────────────────────────────────────────────────────────────────────
  const handleReload = useCallback(() => {
    if (!isDemoMode || !roomIdStr) return;
    const baseMessages = getDemoMessagesForRoom(roomIdStr);
    const currentMessages = useDemoChatRoomStore.getState().rooms[roomIdStr] ?? [];
    const baseIds = new Set(baseMessages.map((m) => m.id));
    const userSent = currentMessages.filter((m) => !baseIds.has(m.id) && !m.id.startsWith('sys_join_'));
    const merged = [...baseMessages, ...userSent].sort((a, b) => a.createdAt - b.createdAt);
    setStoreMessages(roomIdStr, merged);

    setDMs((prev) =>
      prev.map((dm) => {
        const source = DEMO_DM_INBOX.find((s) => s.id === dm.id);
        if (!source) return dm;
        return { ...dm, unreadCount: dm.hiddenUntilNextMessage ? dm.unreadCount : source.unreadCount };
      })
    );
    setFriendRequests(DEMO_FRIEND_REQUESTS);
    setAnnouncements((prev) => {
      const seenIds = new Set(prev.filter((a) => a.seen).map((a) => a.id));
      return DEMO_ANNOUNCEMENTS.map((a) => ({ ...a, seen: seenIds.has(a.id) ? true : a.seen }));
    });
  }, [roomIdStr, setStoreMessages]);

  // ─────────────────────────────────────────────────────────────────────────
  // SEND MESSAGE
  // P1 CR-003: Use try/finally to guarantee pending message cleanup
  // ─────────────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || !roomIdStr) return;
    // Synchronous double-tap guard (ChatComposer's isSending state is async)
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    if (isDemoMode) {
      const newMessage: DemoChatMessage = {
        id: `cm_me_${Date.now()}`,
        roomId: roomIdStr,
        senderId: DEMO_CURRENT_USER.id,
        senderName: persistedDisplayName ?? DEMO_CURRENT_USER.username,
        type: 'text',
        text: trimmed,
        createdAt: Date.now(),
      };
      addStoreMessage(roomIdStr, newMessage);
      setInputText('');
      // Demo mode: local coin increment (no backend)
      incrementCoins();
      isSendingRef.current = false;
    } else {
      if (!authUserId || !hasValidRoomId) {
        isSendingRef.current = false;
        return;
      }
      const clientId = generateUUID();
      const now = Date.now();
      const pendingId = `pending_${clientId}`;
      const textToRestore = trimmed; // Save text before clearing for retry on failure

      const pendingMsg: DemoChatMessage = {
        id: pendingId,
        roomId: roomIdStr,
        senderId: authUserId,
        senderName: 'You',
        type: 'text',
        text: trimmed,
        createdAt: now,
      };
      setPendingMessages((prev) => [...prev, pendingMsg]);
      setInputText('');

      // WALLET-FIX: Coin increment is handled atomically in Convex mutation
      // UI reads from reactive getUserWalletCoins query (auto-updates)
      try {
        await sendMessageMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          authUserId: authUserId!,
          senderId: authUserId as Id<'users'>,
          text: trimmed,
          clientId,
        });
        // Success: remove pending message (real message arrives via subscription)
        if (mountedRef.current) {
          setPendingMessages((prev) => prev.filter((m) => m.id !== pendingId));
        }
      } catch (error: any) {
        // STABILITY FIX: On failure, restore text and show error alert
        if (mountedRef.current) {
          setPendingMessages((prev) => prev.filter((m) => m.id !== pendingId));
          setInputText(textToRestore);
        }
        Alert.alert('Send Failed', error?.message || 'Message could not be sent. Please try again.');
      } finally {
        isSendingRef.current = false;
      }
    }
  }, [inputText, roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, persistedDisplayName]);

  const handlePanelChange = useCallback((_panel: ComposerPanel) => {}, []);

  // ─────────────────────────────────────────────────────────────────────────
  // SEND MEDIA (CR-009 FIX: Upload to cloud storage before sending)
  // ─────────────────────────────────────────────────────────────────────────
  const handleSendMedia = useCallback(
    async (uri: string, mediaType: 'image' | 'video' | 'doodle') => {
      if (!roomIdStr) return;
      const labelMap = { image: 'Photo', video: 'Video', doodle: 'Doodle' };

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
          senderName: persistedDisplayName ?? DEMO_CURRENT_USER.username,
          type: mediaType,
          text: `[${labelMap[mediaType]}]`,
          mediaUrl: persistentUri,
          createdAt: Date.now(),
        };
        // B2-HIGH FIX: Guard setState after async (ensureStableFile)
        if (mountedRef.current) {
          addStoreMessage(roomIdStr, newMessage);
        }
      } else {
        // CR-009 FIX: Real mode - upload to cloud storage first, then send with storage ID
        if (!authUserId || !hasValidRoomId) return;
        const clientId = generateUUID();

        try {
          // Step 1: Upload media to Convex storage
          const uploadHint = mediaType === 'video' ? 'video' : 'photo';
          const storageId = await uploadMediaToConvex(
            uri,
            generateUploadUrlMutation,
            uploadHint
          );

          // Step 2: Send message with storage ID (backend resolves to URL)
          await sendMessageMutation({
            roomId: roomIdStr as Id<'chatRooms'>,
            authUserId: authUserId!,
            senderId: authUserId as Id<'users'>,
            imageStorageId: storageId, // CR-009: Pass storage ID, not local URI
            mediaType: mediaType,
            clientId,
          });
        } catch (err: any) {
          console.error('[ChatRoom] Media upload/send failed:', err);
          Alert.alert('Error', err.message || 'Failed to send media. Please try again.');
        }
      }
    },
    [roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, generateUploadUrlMutation, persistedDisplayName]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // VOICE RECORDING (CR-009 FIX: Upload to cloud storage before sending)
  // Wires up the mic button in ChatComposer to record and send voice messages
  // ─────────────────────────────────────────────────────────────────────────
  const handleVoiceRecordingComplete = useCallback(
    async (result: VoiceRecorderResult) => {
      if (!roomIdStr || !result.audioUri) return;

      if (isDemoMode) {
        // Demo mode: add voice message to local store (local URI OK for demo)
        const newMessage: DemoChatMessage = {
          id: `cm_voice_${Date.now()}`,
          roomId: roomIdStr,
          senderId: DEMO_CURRENT_USER.id,
          senderName: persistedDisplayName ?? DEMO_CURRENT_USER.username,
          type: 'audio',
          audioUrl: result.audioUri,
          createdAt: Date.now(),
        };
        addStoreMessage(roomIdStr, newMessage);
        incrementCoins();
      } else {
        // CR-009 FIX: Real mode - upload to cloud storage first, then send with storage ID
        if (!authUserId || !hasValidRoomId) return;
        const clientId = generateUUID();

        try {
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
          Alert.alert('Error', err.message || 'Failed to send voice message. Please try again.');
        }
      }
    },
    [roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, generateUploadUrlMutation, persistedDisplayName, incrementCoins]
  );

  const { toggleRecording, isRecording, elapsedMs } = useVoiceRecorder({
    onRecordingComplete: handleVoiceRecordingComplete,
    onError: (msg) => Alert.alert('Recording Error', msg),
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MEDIA HOLD (Secure hold-to-view - immediate open/close)
  // ─────────────────────────────────────────────────────────────────────────
  const handleMediaHoldStart = useCallback((_messageId: string, mediaUrl: string, type: 'image' | 'video') => {
    // Immediately open viewer with holding=true
    setSecureMediaState({ visible: true, isHolding: true, uri: mediaUrl, type });
  }, []);

  const handleMediaHoldEnd = useCallback(() => {
    // Immediately close viewer
    setSecureMediaState({ visible: false, isHolding: false, uri: '', type: 'image' });
  }, []);

  // Called when user touches the viewer surface directly (to enable hold-to-view on viewer)
  const handleViewerHoldStart = useCallback(() => {
    setSecureMediaState((prev) => ({ ...prev, isHolding: true }));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // DM HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleMarkDMRead = useCallback((dmId: string) => {
    setDMs((prev) => prev.map((dm) => (dm.id === dmId ? { ...dm, unreadCount: 0 } : dm)));
  }, []);

  const handleHideDM = useCallback((dmId: string) => {
    setDMs((prev) =>
      prev.map((dm) => (dm.id === dmId ? { ...dm, hiddenUntilNextMessage: true, unreadCount: 0 } : dm))
    );
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // FRIEND REQUEST HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleAcceptFriendRequest = useCallback((requestId: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  const handleRejectFriendRequest = useCallback((requestId: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // NOTIFICATION HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleMarkAllNotificationsSeen = useCallback(() => {
    setAnnouncements((prev) => prev.map((a) => ({ ...a, seen: true })));
  }, []);

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
    if (__DEV__) console.log('[TAP] avatar pressed', { senderId, t: Date.now() });

    // SELF-PROFILE FIX: Check if this is the current user's own avatar
    const currentUserId = isDemoMode ? DEMO_CURRENT_USER.id : authUserId;
    const isSelf = senderId === currentUserId;

    // Look up user in roomMembers (Convex-backed in real mode, demo in demo mode)
    const memberUser = roomMembers.find((u) => u.id === senderId);
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
      if (__DEV__) console.log('[TAP] self-avatar → viewProfile (no actions)', { t: Date.now() });
    } else {
      // Other user: show action popup (View Profile, Private Message, Mute, Report)
      setSelectedUser(userToShow);
      setOverlay('userProfile');
      if (__DEV__) console.log('[TAP] other-avatar → userProfile popup', { t: Date.now() });
    }
  }, [messages, roomMembers, authUserId]);

  // ─────────────────────────────────────────────────────────────────────────
  // ONLINE USER PRESS
  // ─────────────────────────────────────────────────────────────────────────
  // SELF-PROFILE FIX: If tapping own user in online panel, open photo viewer directly
  const handleOnlineUserPress = useCallback((user: DemoOnlineUser) => {
    if (__DEV__) console.log('[TAP] online user pressed', { id: user.id, t: Date.now() });

    // SELF-PROFILE FIX: Check if this is the current user
    const currentUserId = isDemoMode ? DEMO_CURRENT_USER.id : authUserId;
    const isSelf = user.id === currentUserId;

    if (isSelf) {
      // SELF-PROFILE FIX: Open photo viewer directly, skip action popup
      setViewProfileUser(user);
      setOverlay('viewProfile');
      if (__DEV__) console.log('[TAP] self-online → viewProfile (no actions)', { t: Date.now() });
    } else {
      // Other user: show action popup
      setSelectedUser(user);
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
  // ─────────────────────────────────────────────────────────────────────────
  const handlePrivateMessage = useCallback((userId: string) => {
    let existingDM = dms.find((dm) => dm.peerId === userId);
    if (!existingDM) {
      const user = selectedUser;
      const newDM: DemoDM = {
        id: `dm_new_${userId}`,
        peerId: userId,
        peerName: user?.username || 'Unknown',
        peerAvatar: user?.avatar,
        lastMessage: '',
        lastMessageAt: Date.now(),
        unreadCount: 0,
        visible: true,
        hiddenUntilNextMessage: false,
      };
      setDMs((prev) => [newDM, ...prev]);
      existingDM = newDM;
    }
    // Set DM in store - Modal will open automatically
    setActiveDm(existingDM, roomIdStr!);
    setSelectedUser(null);
    setOverlay('none');
    // NO navigation - Modal renders based on activeDm state
  }, [dms, selectedUser, roomIdStr, setActiveDm]);

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

        setOverlay('none');
        setReportTargetUser(null);
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
              setSelectedMessage(null);
              setOverlay('none');
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
              setSelectedMessage(null);
              setOverlay('none');
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
    const senderUser = roomMembers.find((u) => u.id === selectedMessage.senderId);
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
  // RENDER MESSAGE ITEM (reuses existing components)
  // ─────────────────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      // Hide date separators - return null for date items
      if (item.type === 'date') {
        return null;
      }

      const msg = item.message;

      if (msg.type === 'system') {
        const isJoin = (msg.text || '').includes('joined');
        return <SystemMessageItem text={msg.text || ''} isJoin={isJoin} />;
      }

      const isMuted = mutedUserIds.has(msg.senderId);
      const isMe = (isDemoMode ? DEMO_CURRENT_USER.id : authUserId) === msg.senderId;
      // DATA-SOURCE FIX: Use current user's avatar for outgoing messages (self)
      // Fallback chain: persistedAvatarUri → realPhotoUrls[0] (Convex profile) → empty
      // This matches the same source used in ProfilePopover and other places
      const avatarUri = isMe
        ? (isDemoMode ? (persistedAvatarUri ?? DEMO_CURRENT_USER.avatar) : (persistedAvatarUri ?? realPhotoUrls?.[0] ?? ''))
        : msg.senderAvatar;

      return (
        <ChatMessageItem
          messageId={msg.id}
          senderName={msg.senderName}
          senderId={msg.senderId}
          senderAvatar={avatarUri}
          text={msg.text || ''}
          timestamp={msg.createdAt}
          isMe={isMe}
          dimmed={isMuted}
          messageType={(msg.type || 'text') as 'text' | 'image' | 'video' | 'audio'}
          mediaUrl={msg.mediaUrl}
          audioUrl={msg.audioUrl}
          onLongPress={(pageX, pageY) => handleMessageLongPress(msg, pageX, pageY)}
          onAvatarPress={() => handleAvatarPress(msg.senderId)}
          onNamePress={() => handleAvatarPress(msg.senderId)}
          onMediaHoldStart={handleMediaHoldStart}
          onMediaHoldEnd={handleMediaHoldEnd}
        />
      );
    },
    [mutedUserIds, authUserId, persistedAvatarUri, realPhotoUrls, handleMessageLongPress, handleAvatarPress, handleMediaHoldStart, handleMediaHoldEnd]
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // ─────────────────────────────────────────────────────────────────────────
  // P0 FIX: INVALID ROOM ID FALLBACK (CR-001, CR-002)
  // ─────────────────────────────────────────────────────────────────────────
  if (!roomIdStr) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ChatRoomsHeader title="Invalid Room" hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.notFoundText}>Room ID is missing</Text>
        </View>
      </View>
    );
  }

  // BUG FIX: Safety guard - block invalid roomIds (e.g. fallback_* from UI fallback)
  if (!isDemoMode && !isValidConvexId(roomIdStr)) {
    if (__DEV__) {
      console.log('[CHAT_ROOM] Blocked invalid roomId:', { roomIdStr });
    }
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ChatRoomsHeader title="Invalid Room" hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.notFoundText}>Invalid Room ID</Text>
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // P2 CR-009: NOT FOUND / ACCESS DENIED CHECK
  // - convexRoom === null → room doesn't exist or expired
  // - joinAttempted && joinFailed → user banned or cannot access
  // SECURITY: Show error screen and navigate back safely
  // ─────────────────────────────────────────────────────────────────────────
  const isRoomNotFound = !isDemoMode && convexRoom === null;
  // SECURITY: Access denied if join was attempted but failed
  const isAccessDenied = !isDemoMode && joinAttempted && joinFailed;

  if (isRoomNotFound || isAccessDenied) {
    const handleBackToRooms = () => {
      // Clear stale preferred room so user doesn't get stuck in a loop
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

    // Determine error title and message
    const errorTitle = isAccessDenied ? 'Access Denied' : 'Room Not Found';
    const errorMessage = isAccessDenied
      ? 'You do not have access to this room'
      : 'Room not found';

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ChatRoomsHeader title={errorTitle} hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.notFoundText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.backToRoomsBtn} onPress={handleBackToRooms}>
            <Text style={styles.backToRoomsBtnText}>Back to Chat Rooms</Text>
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
  return (
    <View style={styles.container}>
      {/* ─── HEADER ─── */}
      <ChatRoomsHeader
        title={roomName}
        subtitle={countdownText ?? undefined}
        hideLeftButton
        topInset={insets.top}
        onRefreshPress={handleReload}
        onInboxPress={() => setOverlay('messages')}
        onNotificationsPress={() => setOverlay('notifications')}
        onProfilePress={() => setOverlay('profile')}
        profileAvatar={isDemoMode ? (persistedAvatarUri ?? DEMO_CURRENT_USER.avatar) : (persistedAvatarUri ?? realPhotoUrls?.[0] ?? '')}
        unreadInbox={unreadDMs}
        unseenNotifications={unseenNotifications}
        showCloseButton={!!canCloseRoom}
        onClosePress={handleCloseRoom}
        hideInboxAndNotifications={isPrivateRoom}
      />

      {/* ─── ACTIVE USERS STRIP ─── */}
      {/* MEMBER-DATA FIX: Use roomMembers (Convex-backed in real mode, demo in demo mode) */}
      <ActiveUsersStrip
        users={roomMembers.map((u) => ({ id: u.id, avatar: u.avatar, isOnline: u.isOnline }))}
        theme="dark"
        onPress={() => setOverlay('onlineUsers')}
      />

      {/* ─── KEYBOARD AVOIDING VIEW ─── */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatArea}>
          {messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubble-outline" size={40} color={C.textLight} />
              <Text style={styles.emptyText}>No messages yet</Text>
              <Text style={styles.emptySubtext}>Be the first to say something!</Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={invertedListItems}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              inverted={true}
              contentContainerStyle={{
                flexGrow: 1,
                paddingHorizontal: 6,
                paddingTop: isPrivateChatOpen ? 0 : composerHeight,
                paddingBottom: 4,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              onScroll={handleScroll}
              scrollEventThrottle={16}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              // P2 Performance: FlatList tuning props
              initialNumToRender={15}
              maxToRenderPerBatch={8}
              updateCellsBatchingPeriod={50}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
            />
          )}

          {/* ─── COMPOSER ─── Hidden when Private Chat sheet is open */}
          {!isPrivateChatOpen && (
            <View
              style={[styles.composerWrapper, { paddingBottom: Platform.OS === 'ios' ? insets.bottom : 0 }]}
              onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
            >
              {/* Phase-2: Show send-blocked notice if user has penalty */}
              {hasSendPenalty ? (
                <View style={styles.readOnlyNotice}>
                  <Ionicons name="lock-closed" size={16} color={C.textLight} />
                  <Text style={styles.readOnlyText}>Read-only (24h)</Text>
                </View>
              ) : (
                <ChatComposer
                  value={inputText}
                  onChangeText={setInputText}
                  onSend={handleSend}
                  onPlusPress={() => setOverlay('attachment')}
                  onMicPress={toggleRecording}
                  onPanelChange={handlePanelChange}
                  isRecording={isRecording}
                  elapsedMs={elapsedMs}
                />
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* MODALS / SHEETS / PANELS                                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      <MessagesPopover
        visible={overlay === 'messages'}
        onClose={closeOverlay}
        dms={dms}
        onOpenChat={(dm) => {
          handleMarkDMRead(dm.id);
          closeOverlay();
          // Set DM in store - Modal will open automatically (no navigation)
          setActiveDm(dm, roomIdStr!);
        }}
        onHideDM={handleHideDM}
      />

      <FriendRequestsPopover
        visible={overlay === 'friendRequests'}
        onClose={closeOverlay}
        requests={friendRequests}
        onAccept={handleAcceptFriendRequest}
        onReject={handleRejectFriendRequest}
      />

      <NotificationsPopover
        visible={overlay === 'notifications'}
        onClose={closeOverlay}
        announcements={announcements}
        onMarkAllSeen={handleMarkAllNotificationsSeen}
      />

      {/* DATA-SOURCE FIX: Use real profile data in non-demo mode */}
      <ProfilePopover
        visible={overlay === 'profile'}
        onClose={closeOverlay}
        username={isDemoMode
          ? (persistedDisplayName ?? DEMO_CURRENT_USER.username)
          : (persistedDisplayName ?? realDisplayName ?? 'User')}
        avatar={isDemoMode
          ? (persistedAvatarUri ?? DEMO_CURRENT_USER.avatar)
          : (persistedAvatarUri ?? realPhotoUrls?.[0] ?? '')}
        isActive={true}
        coins={userCoins}
        age={isDemoMode ? (DEMO_CURRENT_USER.age ?? 25) : (realAge ?? 0)}
        gender={isDemoMode ? (DEMO_CURRENT_USER.gender ?? 'Unknown') : (realGender ?? '')}
        bio={isDemoMode ? undefined : (persistedBio || undefined)}
        onLeaveRoom={isPrivateRoom ? handleLeavePrivateRoom : handleLeaveRoom}
        isPrivateRoom={isPrivateRoom}
        isRoomOwner={isRoomCreator}
        roomPassword={roomPassword}
        onEndRoom={handleEndRoom}
      />

      {/* MEMBER-DATA FIX: Use roomMembers (Convex-backed in real mode) */}
      <OnlineUsersPanel
        visible={overlay === 'onlineUsers'}
        onClose={closeOverlay}
        users={roomMembers}
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

      {/* Secure Media Viewer (hold-to-view for images and videos) */}
      <SecureMediaViewer
        visible={secureMediaState.visible}
        isHolding={secureMediaState.isHolding}
        mediaUri={secureMediaState.uri}
        type={secureMediaState.type}
        onClose={handleMediaHoldEnd}
        onHoldStart={handleViewerHoldStart}
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
      {/* PRIVATE CHAT MODAL - FULLSCREEN, Android handles keyboard resize  */}
      {/* No KeyboardAvoidingView, no manual height logic                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={isPrivateChatOpen}
        animationType="slide"
        transparent={false}
        onRequestClose={clearActiveDm}
      >
        {/* Private Chat View - fullscreen with safe area */}
        {activeDm && (
          <PrivateChatView
            dm={activeDm}
            onBack={clearActiveDm}
            topInset={insets.top}
            isModal={true}
            keyboardVisible={false}
          />
        )}
      </Modal>
    </View>
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
  },
  composerWrapper: {
    backgroundColor: C.background,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  notFoundText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textLight,
  },
  backToRoomsBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: C.primary,
    borderRadius: 8,
  },
  backToRoomsBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    paddingHorizontal: 16,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dateLabel: {
    fontSize: 12,
    color: C.textLight,
    marginHorizontal: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textLight,
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: C.textLight,
    opacity: 0.7,
  },
  // Phase-2: Read-only notice styles
  readOnlyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.accent,
  },
  readOnlyText: {
    fontSize: 14,
    color: C.textLight,
    fontWeight: '500',
  },
});
