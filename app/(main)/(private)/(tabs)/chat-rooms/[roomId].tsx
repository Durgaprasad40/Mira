/*
 * UNLOCKED FOR AUDIT (PRIVATE ROOM CHAT)
 * Temporarily unlocked for deep audit and bug-fixing work.
 *
 * STATUS:
 * - Under active audit
 * - Fixes allowed during audit period
 * - Will be re-locked after audit completion
 */
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
  AppState,
  AppStateStatus,
  Keyboard,
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
// P2-001/002: Import responsive utilities
import { CHAT_FONTS, SPACING, SIZES } from '@/lib/responsive';
import {
  DEMO_CHAT_ROOMS,
  getDemoMessagesForRoom,
  DEMO_CURRENT_USER,
  DEMO_ONLINE_USERS,
  DemoChatMessage,
  DemoDM,
  DemoAnnouncement,
  DemoOnlineUser,
} from '@/lib/demoData';

import ChatRoomsHeader from '@/components/chatroom/ChatRoomsHeader';
import ChatMessageItem from '@/components/chatroom/ChatMessageItem';
import SystemMessageItem from '@/components/chatroom/SystemMessageItem';
import ChatComposer, { type ComposerPanel, type MentionMember, type MentionData } from '@/components/chatroom/ChatComposer';
import MessagesPopover from '@/components/chatroom/MessagesPopover';
import NotificationsPopover from '@/components/chatroom/NotificationsPopover';
import ProfilePopover from '@/components/chatroom/ProfilePopover';
import OnlineUsersPanel from '@/components/chatroom/OnlineUsersPanel';
import MessageActionsSheet from '@/components/chatroom/MessageActionsSheet';
import { ReactionEmoji } from '@/components/chatroom/ReactionBar';
import ReactionChips, { ReactionGroup } from '@/components/chatroom/ReactionChips';
import CoinFeedback from '@/components/chatroom/CoinFeedback';
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
import * as Sentry from '@sentry/react-native';
import { setCurrentFeature, SENTRY_FEATURES } from '@/lib/sentry';
import { preloadVideos } from '@/lib/videoCache';

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

  // ─────────────────────────────────────────────────────────────────────────
  // CHAT ROOM IDENTITY (Convex-backed - separate from main profile)
  // ─────────────────────────────────────────────────────────────────────────
  const chatRoomProfile = useQuery(
    api.chatRooms.getChatRoomProfile,
    authUserId ? { authUserId } : 'skip'
  );
  // Use chat room profile for display (NEVER fall back to main profile)
  const myNickname = chatRoomProfile?.nickname ?? 'Anonymous';
  const myAvatarUrl = chatRoomProfile?.avatarUrl ?? null;
  const myBio = chatRoomProfile?.bio ?? null;

  // Legacy store references (kept for backwards compatibility during transition)
  const persistedDisplayName = useChatRoomProfileStore((s) => s.displayName);
  const persistedAvatarUri = useChatRoomProfileStore((s) => s.avatarUri);
  const persistedBio = useChatRoomProfileStore((s) => s.bio);

  // DATA-SOURCE FIX: Get real user identity from privateProfileStore (for age/gender only)
  // NOTE: We NO LONGER use realDisplayName, realPhotoUrls, realBio in Chat Rooms!
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
  const clearRoomPresenceMutation = useMutation(api.chatRooms.clearRoomPresence);

  // Query real-time online count (only users with recent heartbeat)
  const roomOnlineCountQuery = useQuery(
    api.chatRooms.getRoomOnlineCount,
    hasValidRoomId && !isDemoMode ? { roomId: roomIdStr as Id<'chatRooms'> } : 'skip'
  );
  const roomOnlineCount = roomOnlineCountQuery?.onlineCount ?? 0;

  // Query room presence with profiles (for member list Online/Recently Left sections)
  const roomPresenceQuery = useQuery(
    api.chatRooms.getRoomPresenceWithProfiles,
    shouldSkipProtectedQueries ? 'skip' : { roomId: roomIdStr as Id<'chatRooms'>, authUserId: authUserId! }
  );

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

  // P0-FIX: Query reactions for visible messages (batched for efficiency)
  // Extract message IDs from convex messages for the query
  const messageIdsForReactions = useMemo(() => {
    if (isDemoMode || !convexMessagesResult?.messages) return [];
    return convexMessagesResult.messages.map(m => m._id);
  }, [isDemoMode, convexMessagesResult?.messages]);

  const reactionsQuery = useQuery(
    api.chatRooms.getReactionsForMessages,
    !isDemoMode && messageIdsForReactions.length > 0 && authUserId && hasValidRoomId
      ? { roomId: roomIdStr as Id<'chatRooms'>, messageIds: messageIdsForReactions as Id<'chatRoomMessages'>[], authUserId }
      : 'skip'
  );

  // P0-FIX: Create a map of reactions by message ID for efficient lookup
  // P3-FIX: Include isUserReaction for proper typing
  const reactionsMap = useMemo(() => {
    if (!reactionsQuery) return new Map<string, { emoji: string; count: number; userIds: string[]; isUserReaction: boolean }[]>();
    const map = new Map<string, { emoji: string; count: number; userIds: string[]; isUserReaction: boolean }[]>();
    for (const [messageId, reactions] of Object.entries(reactionsQuery)) {
      // Map reactions with isUserReaction computed from userIds
      const mappedReactions = reactions.map((r) => ({
        ...r,
        isUserReaction: authUserId ? r.userIds.includes(authUserId) : false,
      }));
      map.set(messageId, mappedReactions);
    }
    return map;
  }, [reactionsQuery, authUserId]);

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
            age: realAge ?? 0,
            gender: realGender ?? '',
            profilePicture: myAvatarUrl ?? '',
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
  }, [roomIdStr, enterRoom, authUserId, hasValidRoomId, setPreferredRoom, setPreferredRoomMutation, myNickname, myAvatarUrl, realAge, realGender]);

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

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGES: Transform Convex messages to UI format
  // Uses senderAvatarUrl directly from message (includes primary photo fallback)
  // ─────────────────────────────────────────────────────────────────────────
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
      senderName: m.senderNickname ?? 'User',
      // AVATAR-FIX: Use senderAvatarUrl from message (includes primary photo fallback)
      senderAvatar: m.senderAvatarUrl ?? undefined,
      type: m.type as DemoChatMessage['type'],
      text: m.text,
      mediaUrl: m.imageUrl,
      audioUrl: m.audioUrl,
      createdAt: m.createdAt,
      // P0-FIX: Include reply data
      replyToMessageId: m.replyToMessageId,
      replyToSenderNickname: m.replyToSenderNickname,
      replyToSnippet: m.replyToSnippet,
      replyToType: m.replyToType,
      // P0-FIX: Include mentions for highlighting
      mentions: m.mentions?.map(mention => ({
        userId: mention.userId,
        nickname: mention.nickname,
        startIndex: mention.startIndex,
        endIndex: mention.endIndex,
      })),
    }));
    return [...converted, ...pendingMessages];
  }, [isDemoMode, demoMessages, convexMessagesResult, pendingMessages]);

  // ─────────────────────────────────────────────────────────────────────────
  // VIDEO PRELOADING: Cache videos from visible messages for instant playback
  // This ensures hold-to-view feels immediate for already-visible videos
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    // Extract video URLs from recent messages (last 10 for performance)
    const videoUrls: string[] = [];
    const recentMessages = messages.slice(-10);

    for (const msg of recentMessages) {
      if (msg.type === 'video' && msg.mediaUrl) {
        const url = msg.mediaUrl;
        if (url.startsWith('http://') || url.startsWith('https://')) {
          videoUrls.push(url);
        }
      }
    }

    // Preload unique video URLs (non-blocking, max 2 concurrent)
    if (videoUrls.length > 0) {
      const uniqueUrls = [...new Set(videoUrls)];
      if (__DEV__) console.log('[ChatRoom] Preloading', uniqueUrls.length, 'videos');
      preloadVideos(uniqueUrls, 2);
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
  // ROOM-SPECIFIC PRESENCE: Heartbeat every 12 seconds while viewing room
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Skip in demo mode or without valid auth/room
    if (isDemoMode || !hasValidRoomId || !authUserId || !hasMemberAccess) return;

    // Send initial heartbeat immediately
    heartbeatPresenceMutation({
      roomId: roomIdStr as Id<'chatRooms'>,
      authUserId,
    }).catch(() => {
      // Silently ignore heartbeat errors (non-critical)
    });

    // Set up interval for periodic heartbeats (every 12 seconds)
    const HEARTBEAT_INTERVAL_MS = 12 * 1000;
    const heartbeatInterval = setInterval(() => {
      if (!mountedRef.current) return;
      heartbeatPresenceMutation({
        roomId: roomIdStr as Id<'chatRooms'>,
        authUserId,
      }).catch(() => {
        // Silently ignore heartbeat errors
      });
    }, HEARTBEAT_INTERVAL_MS);

    // Cleanup: clear presence when leaving room
    return () => {
      clearInterval(heartbeatInterval);
      // Clear presence on unmount (fire-and-forget)
      clearRoomPresenceMutation({
        roomId: roomIdStr as Id<'chatRooms'>,
        authUserId,
      }).catch(() => {
        // Silently ignore cleanup errors
      });
    };
  }, [roomIdStr, hasValidRoomId, authUserId, hasMemberAccess, heartbeatPresenceMutation, clearRoomPresenceMutation]);

  // ─────────────────────────────────────────────────────────────────────────
  // APP STATE HANDLING: Clear presence when app goes background
  // This ensures users are immediately removed from active count when backgrounding
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isDemoMode || !hasValidRoomId || !authUserId) return;

    const appStateRef = { current: AppState.currentState };

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (!mountedRef.current) return;

      // App going to background → clear presence immediately
      if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        clearRoomPresenceMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          authUserId,
        }).catch(() => {
          // Silently ignore errors
        });
      }

      // App coming to foreground → send heartbeat immediately
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        heartbeatPresenceMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          authUserId,
        }).catch(() => {
          // Silently ignore errors
        });
      }

      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [roomIdStr, hasValidRoomId, authUserId, heartbeatPresenceMutation, clearRoomPresenceMutation]);

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

  // @Mention members for ChatComposer suggestions
  // Transform room members to MentionMember shape
  // SAFETY: Use empty array if roomMembers undefined
  const mentionMembers: MentionMember[] = useMemo(() => {
    return (roomMembers ?? []).map((m) => ({
      id: m.id,
      nickname: m.username,
      avatar: m.avatar,
      age: m.age,
      gender: m.gender,
    }));
  }, [roomMembers]);

  // ─────────────────────────────────────────────────────────────────────────
  // DM / NOTIFICATIONS STATE
  // NO DEMO DATA: Private DMs start empty - no fake inbox entries
  // Backend for Chat Room DMs does not exist yet - shows truthful empty state
  // ─────────────────────────────────────────────────────────────────────────
  const [dms, setDMs] = useState<DemoDM[]>([]);
  const unreadDMs = dms.filter((dm) => dm.visible && !dm.hiddenUntilNextMessage && dm.unreadCount > 0).length;

  // NO DEMO DATA: Announcements start empty - no fake notifications
  const [announcements, setAnnouncements] = useState<DemoAnnouncement[]>([]);
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

  // @Mentions state
  const [currentMentions, setCurrentMentions] = useState<MentionData[]>([]);

  // Coin feedback animation state
  const [showCoinFeedback, setShowCoinFeedback] = useState(false);
  const [coinFeedbackY, setCoinFeedbackY] = useState(0);
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
                clearPreferredRoomMutation({ authUserId }).catch((e) => console.warn('[ClearRoom] Silent fail:', e));
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
        senderName: myNickname,
        type: 'text',
        text: trimmed,
        createdAt: Date.now(),
      };
      addStoreMessage(roomIdStr, newMessage);
      setInputText('');
      // Demo mode: local coin increment (no backend)
      incrementCoins();
      // P0-FIX: Show coin feedback animation in demo mode too
      setCoinFeedbackY(composerHeight + 100);
      setShowCoinFeedback(true);
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
      // Clear reply state before sending (will be attached to message)
      const replyToId = replyToMessage?.id;
      setReplyToMessage(null);

      // WALLET-FIX: Coin increment is handled atomically in Convex mutation
      // UI reads from reactive getUserWalletCoins query (auto-updates)
      try {
        await sendMessageMutation({
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
        });
        // Success: remove pending message (real message arrives via subscription)
        if (mountedRef.current) {
          setPendingMessages((prev) => prev.filter((m) => m.id !== pendingId));
          // Show coin feedback animation
          setCoinFeedbackY(composerHeight + 100);
          setShowCoinFeedback(true);
          // Clear mentions after successful send
          setCurrentMentions([]);
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
  }, [inputText, roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, myNickname, replyToMessage, currentMentions, composerHeight]);

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
          senderName: myNickname,
          type: mediaType,
          text: `[${labelMap[mediaType]}]`,
          mediaUrl: persistentUri,
          createdAt: Date.now(),
        };
        // B2-HIGH FIX: Guard setState after async (ensureStableFile)
        if (mountedRef.current) {
          addStoreMessage(roomIdStr, newMessage);
          // P0-FIX: Demo mode coin increment + feedback for media messages
          incrementCoins();
          setCoinFeedbackY(composerHeight + 100);
          setShowCoinFeedback(true);
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
    [roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, generateUploadUrlMutation, myNickname]
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
          senderName: myNickname,
          type: 'audio',
          audioUrl: result.audioUri,
          createdAt: Date.now(),
        };
        addStoreMessage(roomIdStr, newMessage);
        incrementCoins();
        // P0-FIX: Show coin feedback animation for voice messages in demo mode
        setCoinFeedbackY(composerHeight + 100);
        setShowCoinFeedback(true);
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
    [roomIdStr, hasValidRoomId, addStoreMessage, authUserId, sendMessageMutation, generateUploadUrlMutation, myNickname, incrementCoins]
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
  // Type that works for both demo users and presence users
  type PanelUser = { id: string; username?: string; avatar?: string; isOnline?: boolean; age?: number; gender?: string; lastSeen?: number };
  // SELF-PROFILE FIX: If tapping own user in online panel, open photo viewer directly
  const handleOnlineUserPress = useCallback((user: PanelUser) => {
    if (__DEV__) console.log('[TAP] online user pressed', { id: user.id, t: Date.now() });

    // Convert PanelUser to DemoOnlineUser format for state
    const userAsDemoUser: DemoOnlineUser = {
      id: user.id,
      username: user.username || 'Anonymous',
      avatar: user.avatar,
      isOnline: user.isOnline ?? false,
      age: user.age,
      gender: user.gender as 'male' | 'female' | undefined,
      lastSeen: user.lastSeen,
    };

    // SELF-PROFILE FIX: Check if this is the current user
    const currentUserId = isDemoMode ? DEMO_CURRENT_USER.id : authUserId;
    const isSelf = user.id === currentUserId;

    if (isSelf) {
      // SELF-PROFILE FIX: Open photo viewer directly, skip action popup
      setViewProfileUser(userAsDemoUser);
      setOverlay('viewProfile');
      if (__DEV__) console.log('[TAP] self-online → viewProfile (no actions)', { t: Date.now() });
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
        // P3-FIX: removeReaction finds reaction by message+user, not by emoji
        await removeReactionMutation({
          roomId: roomIdStr as Id<'chatRooms'>,
          messageId: messageId as Id<'chatRoomMessages'>,
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
  const handleScrollToMessage = useCallback((messageId: string) => {
    // Find the index of the message in the inverted list
    const index = invertedListItems.findIndex(
      (item) => item.type === 'message' && item.id === messageId
    );
    if (index !== -1 && listRef.current) {
      // Scroll to the message
      listRef.current.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5, // Center the message in view
      });

      // Highlight the message briefly
      setHighlightedMessageId(messageId);
      // Clear highlight after animation completes (1.2s = 200ms fade in + 600ms hold + 400ms fade out)
      setTimeout(() => {
        if (mountedRef.current) {
          setHighlightedMessageId(null);
        }
      }, 1300);
    }
  }, [invertedListItems]);

  // ─────────────────────────────────────────────────────────────────────────
  // PERF-FIX: Use refs for frequently changing data to avoid renderItem re-creation
  // ─────────────────────────────────────────────────────────────────────────
  const invertedListItemsRef = useRef(invertedListItems);
  const reactionsMapRef = useRef(reactionsMap);
  const highlightedMessageIdRef = useRef(highlightedMessageId);

  // Keep refs in sync
  useEffect(() => {
    invertedListItemsRef.current = invertedListItems;
  }, [invertedListItems]);
  useEffect(() => {
    reactionsMapRef.current = reactionsMap;
  }, [reactionsMap]);
  useEffect(() => {
    highlightedMessageIdRef.current = highlightedMessageId;
  }, [highlightedMessageId]);

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
        const isJoin = (msg.text || '').includes('joined');
        return <SystemMessageItem text={msg.text || ''} isJoin={isJoin} />;
      }

      const isMuted = mutedUserIds.has(msg.senderId);
      const isMe = (isDemoMode ? DEMO_CURRENT_USER.id : authUserId) === msg.senderId;
      // CHAT ROOM IDENTITY: Use myAvatarUrl for outgoing messages (self)
      // For other users, use senderAvatar from message (fetched from chatRoomProfiles)
      const avatarUri = isMe ? (myAvatarUrl ?? '') : msg.senderAvatar;

      // ─── CONSECUTIVE MESSAGE GROUPING ───
      // In inverted FlatList: index 0 = newest (bottom), higher index = older (top)
      // For grouping: show avatar only on FIRST message of a group (top-most visually)
      // Check if the message ABOVE (index + 1, older) is from the same sender
      // PERF-FIX: Use ref to avoid dependency on invertedListItems
      const currentList = invertedListItemsRef.current;
      let showAvatar = true;
      if (index < currentList.length - 1) {
        const itemAbove = currentList[index + 1];
        if (itemAbove.type === 'message' && itemAbove.message.senderId === msg.senderId) {
          // Message above is from same sender, so this is NOT first in group
          showAvatar = false;
        }
      }

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

      return (
        <ChatMessageItem
          messageId={msg.id}
          senderName={msg.senderName}
          senderId={msg.senderId}
          senderAvatar={avatarUri}
          senderAge={msg.senderAge}
          senderGender={msg.senderGender}
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
          showAvatar={showAvatar}
          replyTo={replyTo}
          onReplyTap={handleScrollToMessage}
          onSwipeReply={handleSwipeReply}
          isHighlighted={highlightedMessageIdRef.current === msg.id}
          mentions={msg.mentions}
          currentUserId={authUserId ?? undefined}
          reactions={reactionsMapRef.current.get(msg.id) || []}
          onReactionTap={(emoji) => handleReactionChipTap(msg.id, emoji)}
        />
      );
    },
    // PERF-FIX: Removed invertedListItems, highlightedMessageId, reactionsMap from deps (using refs)
    [mutedUserIds, authUserId, myAvatarUrl, handleMessageLongPress, handleAvatarPress, handleMediaHoldStart, handleMediaHoldEnd, handleScrollToMessage, handleReactionChipTap]
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
          <Ionicons name="alert-circle-outline" size={40} color={C.textLight} />
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
      // P1-004 FIX: Remove inline paddingTop - header handles topInset internally
      <View style={styles.container}>
        <ChatRoomsHeader title="Invalid Room" hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={40} color={C.textLight} />
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
      // P1-004 FIX: Remove inline paddingTop - header handles topInset internally
      <View style={styles.container}>
        <ChatRoomsHeader title={errorTitle} hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons
            name={isAccessDenied ? 'lock-closed-outline' : 'search-outline'}
            size={40}
            color={C.textLight}
          />
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
        onlineCount={isDemoMode ? undefined : roomOnlineCount}
        hideLeftButton
        topInset={insets.top}
        onRefreshPress={handleReload}
        onInboxPress={() => setOverlay('messages')}
        onNotificationsPress={() => setOverlay('notifications')}
        onProfilePress={() => setOverlay('profile')}
        profileAvatar={isDemoMode ? (myAvatarUrl ?? '') : (myAvatarUrl ?? '')}
        unreadInbox={unreadDMs}
        unseenNotifications={unseenNotifications}
        showCloseButton={!!canCloseRoom}
        onClosePress={handleCloseRoom}
        hideInboxAndNotifications={isPrivateRoom}
      />

      {/* ─── ACTIVE USERS STRIP ─── */}
      {/* Room screen strip: ONLY show currently online users, no offline/recently-left */}
      {/* Hide label - room header already shows online count */}
      <ActiveUsersStrip
        users={
          isDemoMode
            ? (roomMembers ?? []).filter((u) => u.isOnline).map((u) => ({
                id: u.id,
                avatar: u.avatar,
                isOnline: true,
                joinedAt: (u as any).joinedAt ?? Date.now(), // Demo fallback
              }))
            : (roomPresenceQuery?.online ?? []).map((u) => ({
                id: u.id,
                avatar: u.avatar,
                isOnline: true,
                joinedAt: u.joinedAt, // Convex provides this
              }))
        }
        theme="dark"
        hideLabel
        onPress={() => setOverlay('onlineUsers')}
      />

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
                <Ionicons name="chatbubble-outline" size={28} color={C.textLight} />
              </View>
              <Text style={styles.emptyText}>No messages yet</Text>
              <Text style={styles.emptySubtext}>Be the first to say something</Text>
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
            />
          )}

          {/* ─── COMPOSER ─── Hidden when Private Chat sheet is open */}
          {!isPrivateChatOpen && (
            <View
              style={styles.composerWrapper}
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
          ? (myNickname)
          : (myNickname)}
        avatar={isDemoMode
          ? (myAvatarUrl ?? '')
          : (myAvatarUrl ?? '')}
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

      {/* MEMBER-DATA FIX: Use room presence data in real mode, roomMembers for demo */}
      {/* SAFETY: Use empty array if roomMembers undefined */}
      <OnlineUsersPanel
        visible={overlay === 'onlineUsers'}
        onClose={closeOverlay}
        users={isDemoMode ? (roomMembers ?? []) : undefined}
        presenceOnline={isDemoMode ? undefined : roomPresenceQuery?.online}
        presenceRecentlyLeft={isDemoMode ? undefined : roomPresenceQuery?.recentlyLeft}
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

      {/* Coin feedback animation */}
      <CoinFeedback
        visible={showCoinFeedback}
        onComplete={() => setShowCoinFeedback(false)}
        startY={coinFeedbackY}
      />
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
    // Ensure chat area doesn't overflow - contains FlatList and composer
    overflow: 'hidden',
  },
  composerWrapper: {
    backgroundColor: C.background,
    // Ensure composer is always at bottom of chatArea, never overlapping tab bar
    flexShrink: 0,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  notFoundText: {
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.emptyTitle,
    fontWeight: '600',
    color: C.textLight,
    textAlign: 'center',
  },
  backToRoomsBtn: {
    // P2-002: Use SPACING constants
    marginTop: SPACING.base,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: '#6D28D9',
    borderRadius: SIZES.radius.sm + 2,
  },
  backToRoomsBtnText: {
    fontSize: CHAT_FONTS.buttonText,
    fontWeight: '600',
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
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.dateSeparator,
    color: C.textLight,
    marginHorizontal: SPACING.md,
  },
  // P2-010: Improved empty state styling
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xxl,
  },
  emptyIconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    // P2-010: Add subtle border for definition
    borderWidth: 1,
    borderColor: 'rgba(109, 40, 217, 0.2)',
  },
  emptyText: {
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.emptyTitle,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  emptySubtext: {
    // P2-001: Use responsive typography with proper line height
    fontSize: CHAT_FONTS.emptySubtitle,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: Math.round(CHAT_FONTS.emptySubtitle * 1.5),
  },
  // P2-012: Improved read-only notice styling
  readOnlyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md + 2,
    paddingHorizontal: SPACING.base,
    gap: SPACING.sm,
    // P2-012: More serious appearance
    backgroundColor: 'rgba(255, 152, 0, 0.08)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 152, 0, 0.2)',
  },
  readOnlyText: {
    fontSize: CHAT_FONTS.buttonText,
    // P2-012: More visible warning color
    color: '#FF9800',
    fontWeight: '600',
  },
});
