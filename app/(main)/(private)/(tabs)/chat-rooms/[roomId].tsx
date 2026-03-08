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
import PrivateChatView from '@/components/chatroom/PrivateChatView';
import { ensureStableFile } from '@/lib/uploadUtils';

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

  // Persisted chat room profile (name/avatar)
  const persistedDisplayName = useChatRoomProfileStore((s) => s.displayName);
  const persistedAvatarUri = useChatRoomProfileStore((s) => s.avatarUri);

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

  // Convex queries: skip if (demo mode AND found in demo data) OR invalid roomId
  // Query Convex if: (1) not demo mode, or (2) demo mode but room not in demo list
  const shouldSkipConvex = (isDemoMode && !!demoRoom) || !hasValidRoomId;
  const convexRoom = useQuery(
    api.chatRooms.getRoom,
    shouldSkipConvex ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'> }
  );
  const convexMessagesResult = useQuery(
    api.chatRooms.listMessages,
    shouldSkipConvex ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, limit: 50 }
  );

  // Convex mutations
  const sendMessageMutation = useMutation(api.chatRooms.sendMessage);
  const joinRoomMutation = useMutation(api.chatRooms.joinRoom);
  const closeRoomMutation = useMutation(api.chatRooms.closeRoom);

  // Room preferences (muting) and reports - Convex-backed persistence
  const setUserRoomMutedMutation = useMutation(api.chatRooms.setUserRoomMuted);
  const markReportedRoomMutation = useMutation(api.chatRooms.markReportedRoom);

  // Skip queries that require userId in demo mode (no real user identity)
  const shouldSkipUserIdQueries = isDemoMode || !authUserId;

  // Query room mute preference (Convex-backed)
  const roomPrefQuery = useQuery(
    api.chatRooms.getUserRoomPref,
    !roomIdStr ? 'skip' : { roomId: roomIdStr }
  );
  const isRoomMutedFromConvex = roomPrefQuery?.muted ?? false;

  // Query if room has been reported (Convex-backed)
  const reportedQuery = useQuery(
    api.chatRooms.hasReportedRoom,
    !roomIdStr ? 'skip' : { roomId: roomIdStr }
  );
  const hasReportedRoom = reportedQuery?.reported ?? false;

  // Phase-2: Query user's penalty status in this room
  const userPenalty = useQuery(
    api.chatRooms.getUserPenalty,
    shouldSkipConvex || shouldSkipUserIdQueries
      ? 'skip'
      : { roomId: roomIdStr as Id<'chatRooms'>, userId: authUserId as Id<'users'> }
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
  // Phase-2: Check if room can be closed (has expiresAt, meaning not permanent)
  const canCloseRoom = isRoomCreator && convexRoom?.expiresAt;
  // Phase-2: Check if user is in read-only mode
  const isReadOnly = userPenalty !== null && userPenalty !== undefined;

  // Phase-2: Query room password (owner only, for display in profile menu)
  // Pass demo args for demo mode
  const roomPasswordQuery = useQuery(
    api.chatRooms.getRoomPassword,
    isPrivateRoom && isRoomCreator && hasValidRoomId
      ? {
          roomId: roomIdStr as Id<'chatRooms'>,
          ...(isDemoMode && authUserId ? { isDemo: true, demoUserId: authUserId } : {}),
        }
      : 'skip'
  );
  const roomPassword = roomPasswordQuery?.password ?? null;

  // B2-HIGH FIX: Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // COUNTDOWN TIMER (for expiring rooms)
  // ─────────────────────────────────────────────────────────────────────────
  const [nowMs, setNowMs] = useState(Date.now());
  const expiresAt = convexRoom?.expiresAt;

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      // B2-HIGH FIX: Guard setState after async
      if (mountedRef.current) setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
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
  // MOUNTED GUARD
  // ─────────────────────────────────────────────────────────────────────────
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // PREFERRED ROOM STORE (for auto-redirect on next visit)
  // ─────────────────────────────────────────────────────────────────────────
  const setPreferredRoom = usePreferredChatRoomStore((s) => s.setPreferredRoom);
  const clearPreferredRoom = usePreferredChatRoomStore((s) => s.clearPreferredRoom);
  const setPreferredRoomMutation = useMutation(api.users.setPreferredChatRoom);
  const clearPreferredRoomMutation = useMutation(api.users.clearPreferredChatRoom);

  // ─────────────────────────────────────────────────────────────────────────
  // ENTER ROOM SESSION + SAVE AS PREFERRED
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (roomIdStr) {
      // Use persisted profile if available, otherwise fall back to demo defaults
      const identity = {
        userId: isDemoMode ? DEMO_CURRENT_USER.id : (authUserId ?? 'unknown'),
        name: persistedDisplayName ?? DEMO_CURRENT_USER.username,
        age: DEMO_CURRENT_USER.age ?? 25,
        gender: DEMO_CURRENT_USER.gender ?? 'Unknown',
        profilePicture: persistedAvatarUri ?? DEMO_CURRENT_USER.avatar ?? '',
      };
      enterRoom(roomIdStr, identity);

      // Save as preferred room (for auto-redirect on next visit)
      if (isDemoMode) {
        setPreferredRoom(roomIdStr);
      } else if (authUserId && hasValidRoomId) {
        // Convex mode: save to server (fire-and-forget)
        setPreferredRoomMutation({
          userId: authUserId as Id<'users'>,
          roomId: roomIdStr as Id<'chatRooms'>,
        }).catch(() => {
          // Ignore errors - preferred room is a nice-to-have
        });
      }
    }
  }, [roomIdStr, enterRoom, authUserId, hasValidRoomId, setPreferredRoom, setPreferredRoomMutation, persistedDisplayName, persistedAvatarUri]);

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
      type: m.type as 'text' | 'image' | 'system',
      text: m.text,
      mediaUrl: m.imageUrl,
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
  // P2 STABILITY: Add hydration fallback timeout (3 seconds) if AsyncStorage fails
  const hydrationFallbackTriggeredRef = useRef(false);
  const seedAttemptedRef = useRef(false);
  const [hydrationFallback, setHydrationFallback] = useState(false);

  useEffect(() => {
    if (!isDemoMode || !roomIdStr) return;
    if (storeHasHydrated || hydrationFallbackTriggeredRef.current) return;

    // P2 STABILITY: If hydration takes longer than 3 seconds, allow seeding anyway
    const fallbackTimer = setTimeout(() => {
      if (!useDemoChatRoomStore.getState()._hasHydrated) {
        if (__DEV__) {
          console.warn('[ChatRoom] Store hydration timeout - proceeding with demo seeding');
        }
        hydrationFallbackTriggeredRef.current = true;
        // B2-HIGH FIX: Guard setState after async
        if (mountedRef.current) setHydrationFallback(true);
      }
    }, 3000);

    return () => clearTimeout(fallbackTimer);
  }, [roomIdStr, storeHasHydrated]);

  useEffect(() => {
    if (!isDemoMode || !roomIdStr) return;
    // P2 STABILITY: Proceed if hydrated OR fallback triggered
    if (!storeHasHydrated && !hydrationFallback) return;
    // P1 FIX: Atomic guard to prevent double-seeding
    if (seedAttemptedRef.current) return;
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
    // Sort by createdAt to ensure correct ordering regardless of merge order
    const sorted = [...base, joinMsg].sort((a, b) => a.createdAt - b.createdAt);
    seedRoom(roomIdStr, sorted);
  }, [roomIdStr, seedRoom, storeHasHydrated, hydrationFallback]);

  // Auto-join Convex room (skip if invalid ID)
  useEffect(() => {
    if (isDemoMode || !hasValidRoomId || !authUserId) return;
    joinRoomMutation({
      roomId: roomIdStr as Id<'chatRooms'>,
      userId: authUserId as Id<'users'>,
    }).catch((err) => {
      if (__DEV__) console.warn('[ChatRooms] joinRoom failed:', err);
    });
  }, [roomIdStr, hasValidRoomId, authUserId, joinRoomMutation]);

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [inputText, setInputText] = useState('');
  const userCoins = userCoinsFromStore > 0 ? userCoinsFromStore : DEMO_CURRENT_USER.coins;

  // ─────────────────────────────────────────────────────────────────────────
  // DM / FRIEND REQUESTS / NOTIFICATIONS STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [dms, setDMs] = useState<DemoDM[]>(DEMO_DM_INBOX);
  const unreadDMs = dms.filter((dm) => dm.visible && !dm.hiddenUntilNextMessage && dm.unreadCount > 0).length;

  const [friendRequests, setFriendRequests] = useState<DemoFriendRequest[]>(DEMO_FRIEND_REQUESTS);
  const [announcements, setAnnouncements] = useState<DemoAnnouncement[]>(DEMO_ANNOUNCEMENTS);
  const unseenNotifications = announcements.filter((a) => !a.seen).length;

  // ─────────────────────────────────────────────────────────────────────────
  // OVERLAY STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<Overlay>('none');
  const closeOverlay = useCallback(() => setOverlay('none'), []);

  const [selectedMessage, setSelectedMessage] = useState<DemoChatMessage | null>(null);
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
  // P0 FIX: Check isMountedRef before state update to prevent unmounted warning
  useEffect(() => {
    if (!roomIdStr) return;
    const currentMsgs = useDemoChatRoomStore.getState().rooms[roomIdStr] ?? [];
    if (!currentMsgs.some((m) => m.id.startsWith('sys_join_'))) return;

    const timer = setTimeout(() => {
      if (!isMountedRef.current) return; // P0 FIX: guard against unmounted update
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

    // Clear preferred room so user sees homepage next time
    if (isDemoMode) {
      clearPreferredRoom();
    } else if (authUserId) {
      clearPreferredRoomMutation({ userId: authUserId as Id<'users'> }).catch(() => {
        // Ignore errors - clearing preference is best-effort
      });
    }

    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, exitRoom, router, authUserId, clearPreferredRoom, clearPreferredRoomMutation]);

  // Phase-2: Private room leave - just navigate back, don't clear membership or preferred
  const handleLeavePrivateRoom = useCallback(() => {
    closeOverlay();
    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, router]);

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
              // Use demo args in demo mode, userId in live mode
              await closeRoomMutation({
                roomId: roomIdStr as Id<'chatRooms'>,
                ...(isDemoMode
                  ? { isDemo: true, demoUserId: authUserId }
                  : { userId: authUserId as Id<'users'> }),
              });
              // Clear preferred room to avoid stale redirect
              clearPreferredRoom();
              if (!isDemoMode && authUserId) {
                clearPreferredRoomMutation({ userId: authUserId as Id<'users'> }).catch((err) => {
                  console.error('[ChatRoom] clearPreferredRoomMutation failed:', err);
                });
              }
              router.replace('/(main)/(private)/(tabs)/chat-rooms');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to end room');
            }
          },
        },
      ]
    );
  }, [isRoomCreator, authUserId, roomIdStr, closeRoomMutation, router, clearPreferredRoom, clearPreferredRoomMutation]);

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
              await closeRoomMutation({
                roomId: roomIdStr as Id<'chatRooms'>,
                userId: authUserId as Id<'users'>,
              });
              router.replace('/(main)/(private)/(tabs)/chat-rooms');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to close room');
            }
          },
        },
      ]
    );
  }, [canCloseRoom, authUserId, roomIdStr, closeRoomMutation, router]);

  // ─────────────────────────────────────────────────────────────────────────
  // RELOAD HANDLER
  // ─────────────────────────────────────────────────────────────────────────
  const handleReload = useCallback(() => {
    if (!roomIdStr) return;
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
      incrementCoins();
    } else {
      if (!authUserId || !hasValidRoomId) return;
      const clientId = generateUUID();
      const now = Date.now();
      const pendingId = `pending_${clientId}`;

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

      let success = false;
      try {
        await sendMessageMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          senderId: authUserId as Id<'users'>,
          text: trimmed,
          clientId,
        });
        success = true;
      } finally {
        // P1 CR-003: Always remove pending message, regardless of success/failure
        // B2-HIGH FIX: Guard setState after async
        if (mountedRef.current) {
          setPendingMessages((prev) => prev.filter((m) => m.id !== pendingId));
        }
      }
      if (success) {
        // B2-HIGH FIX: Guard setState after async
        if (mountedRef.current) incrementCoins();
      }
    }
  }, [inputText, roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, incrementCoins, persistedDisplayName]);

  const handlePanelChange = useCallback((_panel: ComposerPanel) => {}, []);

  // ─────────────────────────────────────────────────────────────────────────
  // SEND MEDIA
  // ─────────────────────────────────────────────────────────────────────────
  const handleSendMedia = useCallback(
    async (uri: string, mediaType: 'image' | 'video' | 'doodle') => {
      if (!roomIdStr) return;
      const labelMap = { image: 'Photo', video: 'Video', doodle: 'Doodle' };

      if (isDemoMode) {
        // Copy media to persistent location so it survives app restart
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
          incrementCoins();
        }
      } else {
        if (!authUserId || !hasValidRoomId) return;
        const clientId = generateUUID();
        try {
          await sendMessageMutation({
            roomId: roomIdStr as Id<'chatRooms'>,
            senderId: authUserId as Id<'users'>,
            imageUrl: uri,
            mediaType: mediaType,
            clientId,
          });
          // B2-HIGH FIX: Guard setState after async
          if (mountedRef.current) incrementCoins();
        } catch (err: any) {
          Alert.alert('Error', err.message || 'Failed to send media');
        }
      }
    },
    [roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, incrementCoins, persistedDisplayName]
  );

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
  // MESSAGE LONG PRESS
  // ─────────────────────────────────────────────────────────────────────────
  const handleMessageLongPress = useCallback((message: DemoChatMessage) => {
    setSelectedMessage(message);
    setOverlay('messageActions');
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // AVATAR PRESS
  // ─────────────────────────────────────────────────────────────────────────
  const handleAvatarPress = useCallback((senderId: string) => {
    if (__DEV__) console.log('[TAP] avatar pressed', { senderId, t: Date.now() });
    const onlineUser = DEMO_ONLINE_USERS.find((u) => u.id === senderId);
    if (onlineUser) {
      setSelectedUser(onlineUser);
    } else {
      const msg = messages.find((m) => m.senderId === senderId);
      setSelectedUser({
        id: senderId,
        username: msg?.senderName || 'Unknown',
        avatar: msg?.senderAvatar,
        isOnline: false,
      });
    }
    setOverlay('userProfile');
    if (__DEV__) console.log('[TAP] avatar overlay set', { t: Date.now() });
  }, [messages]);

  // ─────────────────────────────────────────────────────────────────────────
  // ONLINE USER PRESS
  // ─────────────────────────────────────────────────────────────────────────
  const handleOnlineUserPress = useCallback((user: DemoOnlineUser) => {
    if (__DEV__) console.log('[TAP] online user pressed', { id: user.id, t: Date.now() });
    setSelectedUser(user);
    setOverlay('userProfile');
  }, []);

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

  // Store report in Convex (userRoomReports table)
  const handleSubmitReport = useCallback(
    async (data: { reportedUserId: string; reason: ReportReason; details?: string; roomId?: string }) => {
      try {
        // Mark room as reported in Convex (idempotent)
        if (roomIdStr) {
          await markReportedRoomMutation({ roomId: roomIdStr });
        }

        setOverlay('none');
        setReportTargetUser(null);
        Alert.alert('Report submitted', 'Thank you. We will review this report.', [{ text: 'OK' }]);
      } catch (error) {
        console.error('[REPORT] Failed to submit report:', error);
        Alert.alert('Error', 'Failed to submit report. Please try again.', [{ text: 'OK' }]);
      }
    },
    [roomIdStr, markReportedRoomMutation]
  );

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
      // Use current user's avatar for outgoing messages (self)
      const avatarUri = isMe
        ? (persistedAvatarUri ?? DEMO_CURRENT_USER.avatar)
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
          messageType={(msg.type || 'text') as 'text' | 'image' | 'video'}
          mediaUrl={msg.mediaUrl}
          onLongPress={() => handleMessageLongPress(msg)}
          onAvatarPress={() => handleAvatarPress(msg.senderId)}
          onNamePress={() => handleAvatarPress(msg.senderId)}
          onMediaHoldStart={handleMediaHoldStart}
          onMediaHoldEnd={handleMediaHoldEnd}
        />
      );
    },
    [mutedUserIds, authUserId, persistedAvatarUri, handleMessageLongPress, handleAvatarPress, handleMediaHoldStart, handleMediaHoldEnd]
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
  // P2 CR-009: NOT FOUND CHECK
  // In Convex mode: undefined = loading (render UI with fallbacks), null = not found
  // ISSUE B: Don't block render - use route params as fallback for instant display
  // ─────────────────────────────────────────────────────────────────────────
  // Only show "not found" if convexRoom is explicitly null (not undefined/loading)
  const isRoomNotFound = !isDemoMode && convexRoom === null;

  if (isRoomNotFound) {
    const handleBackToRooms = () => {
      // Clear stale preferred room so user doesn't get stuck in a loop
      if (isDemoMode) {
        clearPreferredRoom();
      } else if (authUserId) {
        clearPreferredRoomMutation({ userId: authUserId as Id<'users'> }).catch((err) => {
          console.error('[ChatRoom] clearPreferredRoomMutation failed:', err);
        });
      }
      router.replace('/(main)/(private)/(tabs)/chat-rooms');
    };

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ChatRoomsHeader title="Room Not Found" hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.notFoundText}>Room not found</Text>
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
        profileAvatar={persistedAvatarUri ?? DEMO_CURRENT_USER.avatar}
        unreadInbox={unreadDMs}
        unseenNotifications={unseenNotifications}
        showCloseButton={!!canCloseRoom}
        onClosePress={handleCloseRoom}
        hideInboxAndNotifications={isPrivateRoom}
      />

      {/* ─── ACTIVE USERS STRIP ─── */}
      {/* Tapping anywhere on the strip opens the full members list */}
      <ActiveUsersStrip
        users={DEMO_ONLINE_USERS.map((u) => ({ id: u.id, avatar: u.avatar, isOnline: u.isOnline }))}
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
              {/* Phase-2: Show read-only notice if user has penalty */}
              {isReadOnly ? (
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
                  onPanelChange={handlePanelChange}
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

      <ProfilePopover
        visible={overlay === 'profile'}
        onClose={closeOverlay}
        username={persistedDisplayName ?? DEMO_CURRENT_USER.username}
        avatar={persistedAvatarUri ?? DEMO_CURRENT_USER.avatar}
        isActive={true}
        coins={userCoins}
        age={DEMO_CURRENT_USER.age ?? 25}
        gender={DEMO_CURRENT_USER.gender ?? 'Unknown'}
        onLeaveRoom={isPrivateRoom ? handleLeavePrivateRoom : handleLeaveRoom}
        isPrivateRoom={isPrivateRoom}
        isRoomOwner={isRoomCreator}
        roomPassword={roomPassword}
        onEndRoom={handleEndRoom}
      />

      <OnlineUsersPanel
        visible={overlay === 'onlineUsers'}
        onClose={closeOverlay}
        users={DEMO_ONLINE_USERS}
        onUserPress={handleOnlineUserPress}
      />

      <MessageActionsSheet
        visible={overlay === 'messageActions'}
        onClose={() => { closeOverlay(); setSelectedMessage(null); }}
        messageText={selectedMessage?.text || ''}
        senderName={selectedMessage?.senderName || ''}
        onReply={() => { closeOverlay(); setSelectedMessage(null); }}
        onReport={() => { closeOverlay(); setSelectedMessage(null); }}
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
