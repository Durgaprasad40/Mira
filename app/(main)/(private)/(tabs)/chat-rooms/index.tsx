import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
  Image,
  ImageSourcePropType,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useRootNavigationState } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import {
  INCOGNITO_COLORS,
  FONT_SIZE,
  SPACING,
  SIZES,
  lineHeight,
  moderateScale,
} from '@/lib/constants';
import { useChatRoomSessionStore } from '@/stores/chatRoomSessionStore';
import { useAuthStore } from '@/stores/authStore';
import { usePreferredChatRoomStore } from '@/stores/preferredChatRoomStore';
import * as Sentry from '@sentry/react-native';
import * as Haptics from 'expo-haptics';
import { setCurrentFeature, SENTRY_FEATURES } from '@/lib/sentry';
import ChatRoomIdentitySetup from '@/components/chatroom/ChatRoomIdentitySetup';
import PasswordEntryModal from '@/components/chatroom/PasswordEntryModal';

const C = INCOGNITO_COLORS;
const TEXT_MAX_SCALE = 1.2;
const ROOM_ICON_SIZE = moderateScale(46, 0.25);
const ROOM_ACTIVE_DOT_SIZE = moderateScale(12, 0.25);
const SEARCH_ICON_SIZE = moderateScale(18, 0.3);
const EMPTY_STATE_ICON_SIZE = moderateScale(44, 0.25);
const CTA_ICON_SIZE = moderateScale(18, 0.3);
const SMALL_BADGE_ICON_SIZE = moderateScale(10, 0.3);
const ROOM_CARD_RADIUS = moderateScale(14, 0.25);
const CTA_CONTAINER_SIZE = moderateScale(24, 0.25);
const PRIVATE_BADGE_SIZE = moderateScale(20, 0.25);
const UNREAD_BADGE_HEIGHT = moderateScale(18, 0.25);
const LIVE_INDICATOR_SIZE = moderateScale(6, 0.25);
const HEADER_BOTTOM_PADDING = moderateScale(18, 0.4);

// P3-004: Navigation guard delay - prevents double-tap race conditions
const NAV_SETTLE_DELAY_MS = 500;

// ─────────────────────────────────────────────────────────────────────────────
// ROOM ICONS - Local image assets for each room
// Add images to: assets/chatrooms/ (PNG, ~256x256, square)
// ─────────────────────────────────────────────────────────────────────────────
// Recommended images per room:
//   global.png    -> Globe/world icon
//   india.png     -> India map outline or tricolor themed
//   hindi.png     -> Taj Mahal silhouette
//   telugu.png    -> Charminar silhouette
//   tamil.png     -> Meenakshi Temple or Tamil temple
//   malayalam.png -> Kerala backwaters / houseboat
//   bengali.png   -> Howrah Bridge or Victoria Memorial
//   kannada.png   -> Vidhana Soudha or Karnataka emblem
//   marathi.png   -> Gateway of India
//   gujarati.png  -> Somnath Temple or Rann of Kutch
//   punjabi.png   -> Golden Temple
//   urdu.png      -> Calligraphy or crescent moon
// ─────────────────────────────────────────────────────────────────────────────

// Local asset mapping - require() for bundled images
// Uncomment each line after adding the corresponding image file
const ROOM_ICON_ASSETS: Record<string, ImageSourcePropType | null> = {
  // global: require('@/assets/chatrooms/global.png'),
  // india: require('@/assets/chatrooms/india.png'),
  // hindi: require('@/assets/chatrooms/hindi.png'),
  // telugu: require('@/assets/chatrooms/telugu.png'),
  // tamil: require('@/assets/chatrooms/tamil.png'),
  // malayalam: require('@/assets/chatrooms/malayalam.png'),
  // bengali: require('@/assets/chatrooms/bengali.png'),
  // kannada: require('@/assets/chatrooms/kannada.png'),
  // marathi: require('@/assets/chatrooms/marathi.png'),
  // gujarati: require('@/assets/chatrooms/gujarati.png'),
  // punjabi: require('@/assets/chatrooms/punjabi.png'),
  // urdu: require('@/assets/chatrooms/urdu.png'),

  // Fallback: null means use Ionicons fallback
  global: null,
  india: null,
  hindi: null,
  telugu: null,
  tamil: null,
  malayalam: null,
  bengali: null,
  kannada: null,
  marathi: null,
  gujarati: null,
  punjabi: null,
  urdu: null,
};

// Fallback colors for when images are not available
const ROOM_FALLBACK_COLORS: Record<string, string> = {
  global: '#4A90D9',
  india: '#FF9933',
  hindi: '#E94560',
  telugu: '#9C27B0',
  tamil: '#2196F3',
  malayalam: '#4CAF50',
  kannada: '#FF5722',
  marathi: '#795548',
  bengali: '#009688',
  gujarati: '#FFC107',
  punjabi: '#3F51B5',
  urdu: '#607D8B',
};

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK PUBLIC ROOMS - Always available even if backend returns empty
// Used as safety net for fresh deployments or when backend is seeding
// ─────────────────────────────────────────────────────────────────────────────
const FALLBACK_PUBLIC_ROOMS = [
  { id: 'fallback_global', name: 'Global', slug: 'global', category: 'general' as const, activeUserCount: 0 },
  { id: 'fallback_hindi', name: 'Hindi', slug: 'hindi', category: 'language' as const, activeUserCount: 0 },
  { id: 'fallback_telugu', name: 'Telugu', slug: 'telugu', category: 'language' as const, activeUserCount: 0 },
  { id: 'fallback_tamil', name: 'Tamil', slug: 'tamil', category: 'language' as const, activeUserCount: 0 },
  { id: 'fallback_malayalam', name: 'Malayalam', slug: 'malayalam', category: 'language' as const, activeUserCount: 0 },
  { id: 'fallback_bengali', name: 'Bengali', slug: 'bengali', category: 'language' as const, activeUserCount: 0 },
  { id: 'fallback_gujarati', name: 'Gujarati', slug: 'gujarati', category: 'language' as const, activeUserCount: 0 },
  { id: 'fallback_marathi', name: 'Marathi', slug: 'marathi', category: 'language' as const, activeUserCount: 0 },
];

// Unified room type for Convex backend
// LIVE PRESENCE: Uses activeUserCount (real-time presence) instead of memberCount for display
interface ChatRoom {
  id: string;
  name: string;
  slug: string;
  category: 'language' | 'general';
  activeUserCount: number;  // LIVE: Real-time presence count (users currently in room)
  lastMessageText?: string;
  // Icon support (admin-set, optional)
  iconKey?: string;   // Maps to ROOM_ICON_CONFIG or local asset
  iconUrl?: string;   // Remote image URL (takes priority over iconKey)
  // Private room flag for compact rendering
  isPrivate?: boolean;
  // LOCKED-ROOM-FIX: Password protection flags
  hasPassword?: boolean;  // Room requires password to join
  isMember?: boolean;     // Current user is already a member (can skip password)
  wasAuthorized?: boolean; // RE-ENTRY-FIX: User was previously authorized (can rejoin without password)
  role?: 'owner' | 'admin' | 'member'; // PRIVATE-ROOM-ACCESS-FIX: User's role in room
}

type RoomCategory = 'language' | 'general';
type RoomRole = 'owner' | 'admin' | 'member';

interface ConvexListedRoom {
  _id: string;
  name: string;
  slug: string;
  category: RoomCategory;
  onlineCount?: number;
  lastMessageText?: string;
}

interface ConvexPrivateRoom extends ConvexListedRoom {
  isMember?: boolean;
  role?: RoomRole;
}

function AccessPrefetcher({ roomId, authUserId }: { roomId: string; authUserId: string | null }) {
  const access = useQuery(
    api.chatRooms.checkRoomAccess,
    authUserId ? { roomId: roomId as Id<'chatRooms'>, authUserId } : 'skip'
  );

  useEffect(() => {
    if (!authUserId) return;
    if (access === undefined) return;
    console.log('CHATROOM_ACCESS_PREFETCH_USED', { roomId, status: (access as any)?.status ?? null });
  }, [access, authUserId, roomId]);

  return null;
}

export default function ChatRoomsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const footerBottomSpacing = Math.max(insets.bottom, SPACING.md);
  const [refreshing, setRefreshing] = useState(false);
  const [countSmoothing, setCountSmoothing] = useState<{
    fromRoomId: string | null;
    toRoomId: string;
    expiresAt: number;
  } | null>(null);
  const smoothingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase-2: Private rooms state
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ROOM SEARCH: Search query state
  const [searchQuery, setSearchQuery] = useState('');

  // LOCKED-ROOM-FIX: Password entry modal state
  const [passwordModalRoom, setPasswordModalRoom] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Navigation readiness check - prevent "navigate before mounting Root Layout" warning
  const rootNavState = useRootNavigationState();
  const isNavigationReady = !!rootNavState?.key;

  // Track if user manually navigated (tapped a room) - skip preferred redirect if so
  const userNavigatedRef = useRef(false);

  // NAV-RACE FIX: Synchronous guard to prevent double-tap duplicate navigation
  const isNavigatingToRoomRef = useRef(false);

  // M-006/M-007 FIX: Track mount state to prevent setState after unmount
  const mountedRef = useRef(true);

  // P2-AUD-005: Ref for refresh timeout cleanup
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // BUG FIX: Auto-seeding state for empty backend rooms
  const [isSeedingRooms, setIsSeedingRooms] = useState(false);
  const seedingAttemptedRef = useRef(false);

  // Session store for lastVisitedAt tracking
  const lastVisitedAt = useChatRoomSessionStore((s) => s.lastVisitedAt);
  const markRoomVisited = useChatRoomSessionStore((s) => s.markRoomVisited);

  // Current user ID for filtering out own messages
  const userId = useAuthStore((s) => s.userId);
  const currentRoomId = usePreferredChatRoomStore((s) => s.currentRoomId);
  const leaveRoomMutation = useMutation(api.chatRooms.leaveRoom);

  // ─────────────────────────────────────────────────────────────────────────────
  // CHAT ROOM IDENTITY CHECK
  // Users MUST have a chat room profile before entering any room.
  // This is separate from their main profile (nickname instead of real name).
  // ─────────────────────────────────────────────────────────────────────────────
  const chatRoomProfile = useQuery(
    api.chatRooms.getChatRoomProfile,
    userId ? { authUserId: userId } : 'skip'
  );
  const [profileSetupComplete, setProfileSetupComplete] = useState(false);

  // Determine if we need to show setup (profile doesn't exist)
  const isProfileLoading = chatRoomProfile === undefined;
  const needsProfileSetup = !isProfileLoading && chatRoomProfile === null && !profileSetupComplete;

  // ─────────────────────────────────────────────────────────────────────────────
  // PREFERRED ROOM REDIRECT LOGIC (zero-flash)
  // Gate UI render until we know if user has a preferred room.
  // If preferred room exists → redirect immediately, never show homepage.
  // If no preferred room → show homepage.
  // ─────────────────────────────────────────────────────────────────────────────
  const [checkingPreferred, setCheckingPreferred] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const clearPreferredRoom = usePreferredChatRoomStore((s) => s.clearPreferredRoom);
  const clearPreferredRoomMut = useMutation(api.users.clearPreferredChatRoom);
  // NAV-TRAP FIX: Use session-level flag instead of ref (persists across remounts)
  const hasRedirectedInSession = usePreferredChatRoomStore((s) => s.hasRedirectedInSession);

  // Convex query for preferred room
  const convexPreferredRoom = useQuery(
    api.users.getPreferredChatRoom,
    userId ? { authUserId: userId } : 'skip'
  );

  // Determine if we're still loading preferred room data (always use Convex)
  const isPreferredLoading = convexPreferredRoom === undefined;

  // Determine effective preferred room ID (only valid after loading complete)
  const effectivePreferredRoomId = convexPreferredRoom?.preferredChatRoomId ?? null;

  // Validate preferred room access before redirecting (prevents stale/unauthorized room redirect)
  // Uses checkRoomAccess which returns status object without throwing (unlike getRoom)
  const preferredRoomAccess = useQuery(
    api.chatRooms.checkRoomAccess,
    effectivePreferredRoomId && userId
      ? { roomId: effectivePreferredRoomId as Id<'chatRooms'>, authUserId: userId }
      : 'skip'
  );

  // Room is valid for redirect if user is a member (has access)
  // Invalid statuses: not_found, expired, banned, none, unauthenticated, pending, rejected
  const isPreferredRoomValid = preferredRoomAccess?.status === 'member';

  // Still loading validation if convex query is undefined (not yet resolved)
  const isValidationLoading = effectivePreferredRoomId && preferredRoomAccess === undefined;

  // CRITICAL FIX M-001: Removed duplicate useEffect redirect logic
  // All redirects now handled by useFocusEffect below to prevent
  // "child already has a parent" Android crashes from concurrent navigation

  // Simple loading state management - set checkingPreferred to false once data loads
  useEffect(() => {
    if (!isPreferredLoading) {
      setCheckingPreferred(false);
    }
  }, [isPreferredLoading]);

  // M-006/M-007 FIX: Cleanup timeouts and mark unmounted on unmount
  useEffect(() => {
    return () => {
      // Mark component unmounted to prevent setState after unmount
      mountedRef.current = false;

      // Clear all timeouts
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }

      if (smoothingTimerRef.current) {
        clearTimeout(smoothingTimerRef.current);
        smoothingTimerRef.current = null;
      }
    };
  }, []);

  // UX smoothing: expire visual-only smoothing window
  useEffect(() => {
    if (!countSmoothing) return;
    const ms = Math.max(0, countSmoothing.expiresAt - Date.now());
    if (smoothingTimerRef.current) {
      clearTimeout(smoothingTimerRef.current);
      smoothingTimerRef.current = null;
    }
    smoothingTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      console.log('CHATROOM_UI_SMOOTHING_EXPIRED', {
        fromRoomId: countSmoothing.fromRoomId,
        toRoomId: countSmoothing.toRoomId,
      });
      setCountSmoothing(null);
    }, ms);
    return () => {
      if (smoothingTimerRef.current) {
        clearTimeout(smoothingTimerRef.current);
        smoothingTimerRef.current = null;
      }
    };
  }, [countSmoothing]);

  const getSmoothedCount = useCallback(
    (roomId: string, backendCount: number) => {
      // Backend remains the ONLY source of truth; this is a short-lived visual-only adjustment.
      if (!countSmoothing) return backendCount;
      if (Date.now() >= countSmoothing.expiresAt) return backendCount;

      if (roomId === countSmoothing.toRoomId) {
        return Math.max(0, backendCount + 1);
      }
      if (countSmoothing.fromRoomId && roomId === countSmoothing.fromRoomId) {
        return Math.max(0, backendCount - 1);
      }
      return backendCount;
    },
    [countSmoothing]
  );

  // SENTRY-FILTER: Set feature tag on mount, clear on unmount
  useEffect(() => {
    // Set current feature to chat_rooms for Sentry filtering
    setCurrentFeature(SENTRY_FEATURES.CHAT_ROOMS);
    Sentry.setTag('feature', SENTRY_FEATURES.CHAT_ROOMS);
    Sentry.setContext('chat_rooms', {
      screen: 'list',
    });

    return () => {
      // Clear feature on unmount
      setCurrentFeature(null);
    };
  }, []);

  // M-002/M-003 FIX: Preferred room redirect with navigation guards
  // NAV-TRAP FIX: Redirect fires ONCE per SESSION (not per mount) to prevent
  // navigation trap when user backs out of a room
  useFocusEffect(
    useCallback(() => {
      // M-002 FIX: Wait for navigation to be ready before router.replace
      if (!isNavigationReady) return;

      // Skip if still loading or no preferred room
      if (isPreferredLoading || !effectivePreferredRoomId) return;

      // Read hasRedirectedInSession from store at focus time to ensure current value
      const storeHasRedirected = usePreferredChatRoomStore.getState().hasRedirectedInSession;

      // NAV-TRAP FIX: Skip if already redirected in this SESSION (persists across remounts)
      if (storeHasRedirected) return;

      // Skip if still validating room existence
      if (isValidationLoading) return;

      // Room does NOT exist (stale ID) → clear and skip redirect
      if (!isPreferredRoomValid) {
        clearPreferredRoom();
        if (userId) {
          clearPreferredRoomMut({ authUserId: userId }).catch(() => {
            // Ignore errors - cleanup is best-effort
          });
        }
        return;
      }

      // NAV-TRAP FIX: Set session-level flag (persists across remounts, resets on app restart)
      usePreferredChatRoomStore.getState().setHasRedirectedInSession(true);
      setIsRedirecting(true);
      router.replace(`/(main)/(private)/(tabs)/chat-rooms/${effectivePreferredRoomId}` as any);

      // M-003 FIX: Only reset isRedirecting in cleanup
      return () => {
        setIsRedirecting(false);
      };
    }, [isNavigationReady, isPreferredLoading, effectivePreferredRoomId, isValidationLoading, isPreferredRoomValid, clearPreferredRoom, clearPreferredRoomMut, router, userId])
  );

  // Convex query for public rooms
  const convexRooms = useQuery(api.chatRooms.listRooms, {}) as ConvexListedRoom[] | undefined;

  // Phase-2: Query for user's private rooms
  // AUTH FIX: Pass authUserId so query can authenticate in real mode
  const myPrivateRooms = useQuery(
    api.chatRooms.getMyPrivateRooms,
    userId ? { authUserId: userId } : 'skip'
  ) as ConvexPrivateRoom[] | undefined;

  // Phase-2: Mutations for private rooms
  const createPrivateRoomMut = useMutation(api.chatRooms.createPrivateRoom);
  const resetMyPrivateRoomsMut = useMutation(api.chatRooms.resetMyPrivateRooms);

  // BUG FIX: Mutation to seed default public rooms
  const ensureDefaultRoomsMut = useMutation(api.chatRooms.ensureDefaultRooms);

  // Auto-seed default public rooms if backend returns empty
  // This ensures rooms always exist and have real Convex IDs (prevents fallback_* navigation crash)
  useEffect(() => {
    // Skip if already seeding, already attempted, or still loading
    if (isSeedingRooms || seedingAttemptedRef.current || convexRooms === undefined) {
      return;
    }

    // If backend returns empty array, seed default rooms
    if (Array.isArray(convexRooms) && convexRooms.length === 0) {
      seedingAttemptedRef.current = true;
      setIsSeedingRooms(true);

      ensureDefaultRoomsMut({})
        .then(() => {
          // Convex will auto-refresh the query, no manual refetch needed
          if (mountedRef.current) {
            setIsSeedingRooms(false);
          }
        })
        .catch((error) => {
          console.error('[CHAT_ROOMS] Auto-seed failed:', error);
          if (mountedRef.current) {
            setIsSeedingRooms(false);
          }
        });
    }
  }, [convexRooms, isSeedingRooms, ensureDefaultRoomsMut]);

  // Filter private rooms into ChatRoom format
  // ISSUE 2 FIX: Mark as private so renderRoom skips message preview
  // LIVE PRESENCE: Use activeUserCount for display
  // LOCKED-ROOM-FIX: Include hasPassword and isMember for password validation
  // PRIVATE-ROOM-ACCESS-FIX: Include role for owner bypass
  const privateRooms: ChatRoom[] = useMemo(() => {
    if (!myPrivateRooms) return [];
    return myPrivateRooms.map((r: ConvexPrivateRoom) => ({
      id: r._id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      activeUserCount: getSmoothedCount(r._id, r.onlineCount ?? 0),
      iconKey: r.slug,
      isPrivate: true, // Flag for compact rendering
      hasPassword: false,
      isMember: r.isMember ?? false, // LOCKED-ROOM-FIX
      // PRIVATE-ROOM-ACCESS-FIX: Track role for owner bypass
      role: r.role,
    }));
  }, [getSmoothedCount, myPrivateRooms]);

  // Track loading state for Convex queries
  const isConvexLoading = convexRooms === undefined;

  // Phase-2: Calculate DM unread counts per room (NOT group messages)
  // Badge shows unread DM count from that room
  // UNREAD-BADGE-FIX: Query unread counts from backend
  const unreadDmsByRoom = useQuery(
    api.chatRooms.getUnreadDmCountsByRoom,
    userId ? { authUserId: userId } : 'skip'
  );

  // Use backend counts, or empty object if not available
  const unreadCounts: Record<string, number> = unreadDmsByRoom?.byRoomId ?? {};

  // Rooms list from Convex backend
  // Filter out "English" room - users can chat in English inside Global
  // P2-AUD-006: Memoize to prevent re-computation on every render
  // Use fallback if backend returns empty (ensures public rooms always show while seeding)
  // LIVE PRESENCE: Use activeUserCount for display (real-time presence count)
  const rooms: ChatRoom[] = useMemo(() => {
    // Always use backend rooms
    const backendRooms = (convexRooms ?? []).map((r: ConvexListedRoom) => ({
      id: r._id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      activeUserCount: getSmoothedCount(r._id, r.onlineCount ?? 0),
      lastMessageText: r.lastMessageText,
      iconKey: r.slug,
    })).filter((r: ChatRoom) => r.name.toLowerCase() !== 'english');

    // If backend returns empty, use fallback to ensure UI never shows empty
    // Fallback rooms displayed but tapping is disabled (see handleOpenRoom)
    if (backendRooms.length === 0) {
      return FALLBACK_PUBLIC_ROOMS;
    }

    return backendRooms;
  }, [convexRooms, getSmoothedCount, isSeedingRooms]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Convex auto-refreshes queries - this just provides UI feedback
    // P2-AUD-005: Track timeout in ref for cleanup
    refreshTimeoutRef.current = setTimeout(() => {
      // M-006 FIX: Guard setState after unmount
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }, 800);
  }, []);

  const handleOpenRoom = useCallback(
    async (roomId: string) => {
      // NAV-RACE FIX: Prevent double-tap duplicate navigation (synchronous guard)
      if (isNavigatingToRoomRef.current) {
        return;
      }

      // BUG FIX: Prevent navigation with fallback IDs (not real Convex IDs)
      // Fallback IDs crash when passed to Convex mutations/queries
      if (roomId.startsWith('fallback_')) {
        Alert.alert(
          'Syncing Rooms',
          isSeedingRooms
            ? 'Setting up chat rooms... Please wait a moment and try again.'
            : 'Chat rooms are being set up. Please try again in a moment.',
          [{ text: 'OK' }]
        );
        return;
      }

      // ISSUE B: Find room to get name and private status for instant render
      // Check in rooms (general/language) first, then privateRooms
      const foundRoom = rooms.find((r) => r.id === roomId);
      const foundPrivateRoom = privateRooms.find((r) => r.id === roomId);
      const roomName = foundRoom?.name ?? foundPrivateRoom?.name ?? '';
      const isPrivate = !!foundPrivateRoom ? '1' : '0';

      // UX smoothing (visual only): make counts feel instant for a single transition.
      // This does NOT modify backend counts and cannot drift (auto-expires, never accumulates).
      const SMOOTHING_MS = 400;
      if (userId) {
        console.log('CHATROOM_UI_SMOOTHING_APPLIED', {
          fromRoomId: currentRoomId,
          toRoomId: roomId,
          durationMs: SMOOTHING_MS,
        });
        setCountSmoothing({
          fromRoomId: currentRoomId,
          toRoomId: roomId,
          expiresAt: Date.now() + SMOOTHING_MS,
        });
      }

      // BACKEND COUNT ONLY: Explicitly leave the previous room before switching.
      if (userId && currentRoomId && currentRoomId !== roomId) {
        console.log('CHATROOM_LEAVE_SENT', { roomId: currentRoomId, nextRoomId: roomId });
        leaveRoomMutation({ roomId: currentRoomId as Id<'chatRooms'>, authUserId: userId }).catch(() => {
          // Best-effort; backend expiry still cleans up eventually.
        });
      }

      // PRIVATE-ROOM-ACCESS-FIX: No invite-code flow for private rooms
      // Navigation is always allowed - room screen handles access checks
      if (foundPrivateRoom) {
        const isOwner = foundPrivateRoom.role === 'owner';
        const isApprovedMember = foundPrivateRoom.isMember;

        if (isOwner) {
          console.log('PRIVATE_ROOM_OWNER_BYPASS', { roomId, role: 'owner' });
        } else if (isApprovedMember) {
          console.log('PRIVATE_ROOM_APPROVED_MEMBER_REENTRY', { roomId, isMember: true });
        } else {
          // First-time entrant - room screen will handle password
          console.log('PRIVATE_ROOM_FIRST_TIME_PASSWORD_REQUIRED', { roomId, isMember: false, isOwner: false });
        }
        // Always allow navigation - no blocking
      }

      // NAV-RACE FIX: Set synchronous lock before navigation
      isNavigatingToRoomRef.current = true;

      // Mark user navigated to cancel any pending preferred room redirect
      userNavigatedRef.current = true;

      // Path segment must be Convex chatRooms document id (ChatRoom.id from listRooms._id), never slug/name
      router.push({
        pathname: `/(main)/(private)/(tabs)/chat-rooms/${roomId}`,
        params: { roomName, isPrivate },
      } as any);
      // Mark room as visited to clear unread badge
      markRoomVisited(roomId);

      // NAV-RACE FIX: Reset lock after navigation settles (allows future navigations)
      setTimeout(() => {
        isNavigatingToRoomRef.current = false;
      }, NAV_SETTLE_DELAY_MS);
    },
    [router, markRoomVisited, rooms, privateRooms, isSeedingRooms, userId, currentRoomId, leaveRoomMutation]
  );

  const handleCreateRoom = useCallback(() => {
    router.push('/(main)/create-room' as any);
  }, [router]);

  // Phase-2: Handle create private room
  const handleCreatePrivateRoom = useCallback(async () => {
    if (!newRoomName.trim() || isCreating) return;

    // Validate password if provided (min 4 chars)
    const pwd = newRoomPassword.trim();
    if (pwd.length > 0 && pwd.length < 4) {
      Alert.alert('Invalid Password', 'Password must be at least 4 characters.');
      return;
    }

    setIsCreating(true);
    try {
      // Only send password if provided
      const args: { name: string; password?: string; authUserId: string } = {
        name: newRoomName.trim(),
        authUserId: userId!,
      };
      if (pwd.length > 0) {
        args.password = pwd;
      }

      const result = await createPrivateRoomMut(args);

      // UNMOUNT-GUARD: Check mounted before setState after async
      if (!mountedRef.current) return;

      // Clear inputs on success
      setNewRoomName('');
      setNewRoomPassword('');
      setShowPassword(false);
      setShowCreateInput(false);

      const hasPassword = pwd.length > 0;
      // ISSUE B: Navigate with route params for instant render (use args.name which was captured before clearing)
      Alert.alert(
        'Room Created',
        hasPassword
          ? `Your room is password-protected.\n\nRoom code: ${result.joinCode}\nPassword: ${pwd}\n\nShare these with friends to invite them!`
          : `Your room code is: ${result.joinCode}\n\nShare this code with friends to invite them!`,
        [
          {
            text: 'Go to Room',
            onPress: () => router.push({
              pathname: `/(main)/(private)/(tabs)/chat-rooms/${result.roomId}`,
              params: { roomName: args.name, isPrivate: '1' },
            } as any),
          },
        ]
      );
    } catch (error: any) {
      // Keep inputs on error so user can edit
      Alert.alert('Error', error.message || 'Failed to create room');
    } finally {
      // UNMOUNT-GUARD: Check mounted before setState in finally
      if (mountedRef.current) {
        setIsCreating(false);
      }
    }
  }, [newRoomName, newRoomPassword, isCreating, createPrivateRoomMut, router]);

  // LOCKED-ROOM-FIX: Handle successful password entry
  const handlePasswordSuccess = useCallback(() => {
    if (!passwordModalRoom) return;

    const roomId = passwordModalRoom.id;
    const roomName = passwordModalRoom.name;

    // Close modal
    setPasswordModalRoom(null);

    // NAV-RACE FIX: Set synchronous lock before navigation
    isNavigatingToRoomRef.current = true;

    // Mark user navigated to cancel any pending preferred room redirect
    userNavigatedRef.current = true;

    // passwordModalRoom.id is Convex room _id (set when opening password modal for that room)
    router.push({
      pathname: `/(main)/(private)/(tabs)/chat-rooms/${roomId}`,
      params: { roomName, isPrivate: '1' },
    } as any);

    // Mark room as visited
    markRoomVisited(roomId);

    // Reset navigation lock after settle delay
    setTimeout(() => {
      isNavigatingToRoomRef.current = false;
    }, NAV_SETTLE_DELAY_MS);
  }, [passwordModalRoom, router, markRoomVisited]);

  // LOCKED-ROOM-FIX: Handle password modal cancel
  const handlePasswordCancel = useCallback(() => {
    setPasswordModalRoom(null);
  }, []);

  // Room Card component with simple opacity press feedback
  const RoomCard = useCallback(
    ({ item, isGeneral = false }: { item: ChatRoom; isGeneral?: boolean }) => {
      // Get icon key for this room (by slug/iconKey)
      const iconKey = item.iconKey ?? item.slug;
      const localAsset = ROOM_ICON_ASSETS[iconKey];
      const fallbackColor = ROOM_FALLBACK_COLORS[iconKey];

      // Get unread count for this room
      const unreadCount = unreadCounts[item.id] ?? 0;

      // Determine activity state for styling
      const isActive = item.activeUserCount > 0;

      // Activity-based copy (truthful, no fabrication)
      const getActivityCopy = () => {
        if (item.activeUserCount === 0) return 'Quiet right now';
        if (item.activeUserCount === 1) return '1 active';
        if (item.activeUserCount >= 5) return `${item.activeUserCount} active now`;
        return `${item.activeUserCount} active`;
      };

      // Render room icon
      const renderRoomIcon = () => {
        const categoryIsGeneral = item.category === 'general';

        // Priority 1: Remote URL (admin-set)
        if (item.iconUrl) {
          return (
            <View style={styles.iconContainer}>
              <Image
                source={{ uri: item.iconUrl }}
                style={styles.roomIconImage}
                resizeMode="cover"
              />
              {isActive && <View style={styles.iconActiveDot} />}
            </View>
          );
        }

        // Priority 2: Local asset image (when available)
        if (localAsset) {
          return (
            <View style={styles.iconContainer}>
              <Image
                source={localAsset}
                style={styles.roomIconImage}
                resizeMode="cover"
              />
              {isActive && <View style={styles.iconActiveDot} />}
            </View>
          );
        }

        // Fallback: Clean icon container
        const bgColor = fallbackColor
          ? `${fallbackColor}15`
          : (categoryIsGeneral ? 'rgba(99,102,241,0.1)' : 'rgba(236,72,153,0.1)');
        const borderColor = fallbackColor
          ? `${fallbackColor}25`
          : (categoryIsGeneral ? 'rgba(99,102,241,0.2)' : 'rgba(236,72,153,0.2)');
        const iconColor = fallbackColor ?? (categoryIsGeneral ? '#818CF8' : '#F472B6');

        return (
          <View style={styles.iconContainer}>
            <View style={[styles.roomIcon, { backgroundColor: bgColor, borderColor }]}>
              <Ionicons
                name={categoryIsGeneral ? 'globe' : 'chatbubbles'}
                size={SIZES.icon.lg}
                color={iconColor}
              />
            </View>
            {isActive && <View style={styles.iconActiveDot} />}
          </View>
        );
      };

      const isPrivateRoom = item.isPrivate === true;

      return (
        <Pressable
          style={({ pressed }) => [
            styles.roomCard,
            isGeneral && styles.roomCardGeneral,
            isPrivateRoom && styles.privateRoomCard,
            pressed && styles.roomCardPressed,
          ]}
          onPress={() => handleOpenRoom(item.id)}
        >
          {renderRoomIcon()}

          <View style={styles.roomInfo}>
            <View style={styles.roomNameRow}>
              {isPrivateRoom && (
                <View style={styles.privateBadge}>
                  <Ionicons name="lock-closed" size={SMALL_BADGE_ICON_SIZE} color="#A78BFA" />
                </View>
              )}
              {/* P1-002 FIX: Add numberOfLines for consistent truncation */}
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.roomName, isGeneral && styles.roomNameGeneral]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.unreadText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>

            {/* Activity status */}
            <View style={styles.activityRow}>
              <View style={[styles.liveIndicator, isActive && styles.liveIndicatorActive]} />
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.activityText, isActive && styles.activityTextActive]}
              >
                {getActivityCopy()}
              </Text>
            </View>
          </View>

          {/* CTA arrow */}
          <View style={styles.ctaArrow}>
            {/* P2-009: Improved chevron contrast */}
            <Ionicons name="chevron-forward" size={CTA_ICON_SIZE} color="rgba(255,255,255,0.45)" />
          </View>
        </Pressable>
      );
    },
    [handleOpenRoom, unreadCounts]
  );

  // ROOM SEARCH: Filter rooms by search query (case-insensitive)
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRooms = useMemo(() => {
    if (!normalizedQuery) return rooms;
    return rooms.filter((r) => r.name.toLowerCase().includes(normalizedQuery));
  }, [rooms, normalizedQuery]);

  const filteredPrivateRooms = useMemo(() => {
    if (!normalizedQuery) return privateRooms;
    return privateRooms.filter((r) => r.name.toLowerCase().includes(normalizedQuery));
  }, [privateRooms, normalizedQuery]);

  const generalRooms = filteredRooms.filter((r) => r.category === 'general');
  const languageRooms = filteredRooms.filter((r) => r.category === 'language');

  // EMPTY STATES: Check if search has no results
  const hasSearchResults = generalRooms.length > 0 || languageRooms.length > 0 || filteredPrivateRooms.length > 0;
  const isSearchActive = normalizedQuery.length > 0;

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER GATING: Show loading while redirecting or checking preferred room
  // This prevents flash of list UI when auto-navigating to last room
  // ─────────────────────────────────────────────────────────────────────────────

  // Gate 1: If actively redirecting, show blank screen (prevents flash)
  if (isRedirecting) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  // Gate 2: Wait for Convex data to load AND preferred room validation
  // FLICKER FIX: Include isValidationLoading to prevent flash while validating preferred room access
  if (checkingPreferred || isConvexLoading || isProfileLoading || isValidationLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.headerTitle}>
            Chat Rooms
          </Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.loadingText}>
            Loading rooms...
          </Text>
        </View>
      </View>
    );
  }

  // Gate 3: PENDING REDIRECT - All conditions met, waiting for useFocusEffect to fire
  // This catches the gap between "validation complete" and "redirect effect fired"
  // Without this gate, homepage flashes for one frame before redirect
  const willRedirectToPreferredRoom =
    isNavigationReady &&
    effectivePreferredRoomId &&
    isPreferredRoomValid &&
    !hasRedirectedInSession;

  if (willRedirectToPreferredRoom) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  // Gate: Show profile setup if user doesn't have a chat room identity
  if (needsProfileSetup) {
    return (
      <ChatRoomIdentitySetup
        onComplete={() => setProfileSetupComplete(true)}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* PREMIUM: Refined header */}
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.headerTitle}>
          Chat Rooms
        </Text>
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.headerSubtitle}>
          Join the conversation
        </Text>
      </View>

      {/* ROOM SEARCH: Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={SEARCH_ICON_SIZE} color="rgba(255,255,255,0.4)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search rooms..."
            placeholderTextColor="rgba(255,255,255,0.35)"
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={SEARCH_ICON_SIZE} color="rgba(255,255,255,0.4)" />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <>
            {/* EMPTY STATE: No search results */}
            {isSearchActive && !hasSearchResults && (
              <View style={styles.emptyStateContainer}>
                <Ionicons name="search-outline" size={EMPTY_STATE_ICON_SIZE} color="rgba(255,255,255,0.2)" />
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.emptyStateTitle}>
                  No results found
                </Text>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.emptyStateSubtitle}>
                  Try a different search term
                </Text>
              </View>
            )}

            {/* EMPTY STATE: No rooms at all */}
            {!isSearchActive && rooms.length === 0 && (
              <View style={styles.emptyStateContainer}>
                <Ionicons name="chatbubbles-outline" size={EMPTY_STATE_ICON_SIZE} color="rgba(255,255,255,0.2)" />
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.emptyStateTitle}>
                  No rooms yet
                </Text>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.emptyStateSubtitle}>
                  Create a private room to get started
                </Text>
              </View>
            )}

            {/* Section 1: General - Featured rooms */}
            {generalRooms.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionDot} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.sectionTitle}>
                    Featured
                  </Text>
                </View>
                {generalRooms.map((room) => (
                  <React.Fragment key={room.id}>
                    <AccessPrefetcher roomId={room.id} authUserId={userId} />
                    <RoomCard item={room} isGeneral={true} />
                  </React.Fragment>
                ))}
              </>
            )}

            {/* Section 2: Languages */}
            {languageRooms.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionDot, styles.sectionDotLanguage]} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.sectionTitle}>
                    Languages
                  </Text>
                </View>
                {languageRooms.map((room) => (
                  <React.Fragment key={room.id}>
                    <AccessPrefetcher roomId={room.id} authUserId={userId} />
                    <RoomCard item={room} isGeneral={false} />
                  </React.Fragment>
                ))}
              </>
            )}

            {/* Section 3: Create Private Room CTA - hide during search */}
            {!isSearchActive && (
              <View style={styles.createPrivateSection}>
                <Pressable
                  style={({ pressed }) => [
                    styles.addRoomButton,
                    pressed && styles.addRoomButtonPressed,
                  ]}
                  onPress={handleCreateRoom}
                >
                  <View style={styles.addRoomIcon}>
                    <Ionicons name="add" size={SIZES.icon.lg} color="#A78BFA" />
                  </View>
                  <View style={styles.addRoomContent}>
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.addRoomText}>
                      Create Private Room
                    </Text>
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.addRoomHint}>
                      Invite-only conversation
                    </Text>
                  </View>
                  <View style={styles.ctaArrow}>
                    <Ionicons name="chevron-forward" size={CTA_ICON_SIZE} color="rgba(255,255,255,0.45)" />
                  </View>
                </Pressable>
              </View>
            )}

            {/* Section 4: Private Rooms - show if any exist (filtered by search) */}
            {filteredPrivateRooms.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionDot, styles.sectionDotPrivate]} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.sectionTitle}>
                    Your Private Rooms
                  </Text>
                </View>
                {filteredPrivateRooms.map((room) => (
                  <React.Fragment key={room.id}>
                    <AccessPrefetcher roomId={room.id} authUserId={userId} />
                    <RoomCard item={room} />
                  </React.Fragment>
                ))}
              </>
            )}
          </>
        }
        ListFooterComponent={<View style={[styles.footerSpacer, { height: footerBottomSpacing + SPACING.base }]} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      {/* LOCKED-ROOM-FIX: Password entry modal for locked rooms */}
      <PasswordEntryModal
        visible={!!passwordModalRoom}
        roomId={passwordModalRoom?.id ?? ''}
        roomName={passwordModalRoom?.name ?? ''}
        authUserId={userId ?? ''}
        onSuccess={handlePasswordSuccess}
        onCancel={handlePasswordCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F14', // Softer dark base
  },
  // ─── HEADER ───
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.base,
    paddingBottom: HEADER_BOTTOM_PADDING,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#111116', // Slightly elevated
  },
  headerTitle: {
    fontSize: FONT_SIZE.h1,
    fontWeight: '700',
    lineHeight: lineHeight(FONT_SIZE.h1, 1.2),
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    color: 'rgba(255,255,255,0.45)',
    marginTop: SPACING.xs,
  },
  // ─── SEARCH BAR ───
  searchContainer: {
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    backgroundColor: '#111116',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: SIZES.radius.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: moderateScale(10, 0.4),
    gap: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: FONT_SIZE.md,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    color: '#FFFFFF',
    padding: 0,
  },
  // ─── EMPTY STATES ───
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxxl + SPACING.sm,
    paddingHorizontal: SPACING.xxl,
  },
  emptyStateTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.2),
    color: 'rgba(255,255,255,0.6)',
    marginTop: SPACING.base,
  },
  emptyStateSubtitle: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    color: 'rgba(255,255,255,0.35)',
    marginTop: moderateScale(6, 0.3),
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: SPACING.md,
  },
  // ─── SECTION HEADERS ───
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  sectionDot: {
    width: SPACING.xs,
    height: SPACING.xs,
    borderRadius: SIZES.radius.xs,
    backgroundColor: '#818CF8', // Indigo for featured
  },
  sectionDotLanguage: {
    backgroundColor: '#F472B6', // Pink for languages
  },
  sectionDotPrivate: {
    backgroundColor: '#A78BFA', // Purple for private
  },
  sectionTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  // ─── ROOM CARDS ───
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1F', // Slightly lighter surface
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    borderRadius: ROOM_CARD_RADIUS,
    paddingHorizontal: moderateScale(14, 0.4),
    paddingVertical: moderateScale(14, 0.4),
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  roomCardGeneral: {
    backgroundColor: '#1C1C24', // Slightly tinted for featured
    borderColor: 'rgba(99,102,241,0.1)',
  },
  roomCardPressed: {
    opacity: 0.7,
  },
  privateRoomCard: {
    paddingVertical: SPACING.md,
    backgroundColor: '#1A1A22',
    borderColor: 'rgba(167,139,250,0.08)',
  },
  // ─── ROOM ICONS ───
  iconContainer: {
    position: 'relative',
  },
  roomIcon: {
    width: ROOM_ICON_SIZE,
    height: ROOM_ICON_SIZE,
    borderRadius: SIZES.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  roomIconImage: {
    width: ROOM_ICON_SIZE,
    height: ROOM_ICON_SIZE,
    borderRadius: SIZES.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  iconActiveDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: ROOM_ACTIVE_DOT_SIZE,
    height: ROOM_ACTIVE_DOT_SIZE,
    borderRadius: SIZES.radius.full,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#0F0F14',
  },
  roomInfo: {
    flex: 1,
    gap: SPACING.xs,
  },
  roomNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  roomName: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.2),
    color: '#FFFFFF',
    letterSpacing: -0.2,
    // P1-002 FIX: Enable text shrinking for truncation
    flexShrink: 1,
  },
  roomNameGeneral: {
    fontSize: moderateScale(17, 0.4),
    fontWeight: '700',
    lineHeight: lineHeight(moderateScale(17, 0.4), 1.2),
  },
  // P2-016: Improved private room badge - slightly larger for visibility
  privateBadge: {
    width: PRIVATE_BADGE_SIZE,
    height: PRIVATE_BADGE_SIZE,
    borderRadius: SIZES.radius.sm,
    backgroundColor: 'rgba(167,139,250,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ─── UNREAD BADGE ───
  unreadBadge: {
    minWidth: UNREAD_BADGE_HEIGHT,
    height: UNREAD_BADGE_HEIGHT,
    borderRadius: SIZES.radius.full,
    backgroundColor: '#EC4899',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: moderateScale(5, 0.3),
  },
  unreadText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    lineHeight: lineHeight(FONT_SIZE.xs, 1.2),
    color: '#FFFFFF',
  },
  // ─── ACTIVITY STATUS ───
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(6, 0.3),
  },
  // P2-017: Improved section dots - slightly larger for visibility
  liveIndicator: {
    width: LIVE_INDICATOR_SIZE,
    height: LIVE_INDICATOR_SIZE,
    borderRadius: SIZES.radius.full,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  liveIndicatorActive: {
    backgroundColor: '#22C55E',
  },
  activityText: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    color: 'rgba(255,255,255,0.4)',
  },
  activityTextActive: {
    color: '#22C55E',
  },
  // P2-009: Improved chevron contrast
  ctaArrow: {
    width: CTA_CONTAINER_SIZE,
    height: CTA_CONTAINER_SIZE,
    borderRadius: SIZES.radius.sm,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerSection: {
    paddingTop: SPACING.base,
    paddingHorizontal: SPACING.md,
  },
  // P2-018: Footer spacer using safe area aware value
  footerSpacer: {
    height: 0,
  },
  // ─── CREATE PRIVATE SECTION ───
  createPrivateSection: {
    paddingTop: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  privateRoomsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 14,
  },
  resetPrivateRoomsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: moderateScale(6, 0.3),
    paddingHorizontal: moderateScale(10, 0.4),
    borderRadius: SIZES.radius.sm,
    backgroundColor: 'rgba(167,139,250,0.1)',
  },
  resetPrivateRoomsText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.caption, 1.2),
    color: '#A78BFA',
  },
  // ─── ADD ROOM BUTTON ───
  addRoomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A22',
    borderRadius: ROOM_CARD_RADIUS,
    paddingHorizontal: moderateScale(14, 0.4),
    paddingVertical: moderateScale(14, 0.4),
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.12)',
    borderStyle: 'dashed',
  },
  addRoomButtonPressed: {
    opacity: 0.7,
  },
  addRoomIcon: {
    width: ROOM_ICON_SIZE,
    height: ROOM_ICON_SIZE,
    borderRadius: SIZES.radius.md,
    backgroundColor: 'rgba(167,139,250,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.15)',
  },
  addRoomContent: {
    flex: 1,
    gap: SPACING.xxs,
  },
  addRoomText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.2),
    color: '#A78BFA',
    letterSpacing: -0.2,
  },
  addRoomHint: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: 'rgba(167,139,250,0.6)',
  },
  // ─── LOADING STATE ───
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: '#0F0F14',
  },
  loadingText: {
    fontSize: FONT_SIZE.body,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    color: 'rgba(255,255,255,0.5)',
  },
  // Phase-2: Private rooms styles
  emptyPrivateRooms: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xl,
    marginHorizontal: SPACING.md,
    backgroundColor: C.surface,
    borderRadius: SIZES.radius.md,
    marginBottom: SPACING.sm,
  },
  emptyPrivateText: {
    fontSize: FONT_SIZE.body,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    color: C.textLight,
  },
  createPrivateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: moderateScale(6, 0.3),
    paddingVertical: SPACING.md,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.base,
  },
  createPrivateText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    color: C.primary,
  },
  createRoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  createRoomInput: {
    flex: 1,
    height: SIZES.button.md,
    backgroundColor: C.accent,
    borderRadius: SIZES.radius.md,
    paddingHorizontal: moderateScale(14, 0.4),
    fontSize: FONT_SIZE.md,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    color: C.text,
  },
  createRoomButton: {
    width: SIZES.button.md,
    height: SIZES.button.md,
    backgroundColor: C.primary,
    borderRadius: SIZES.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRoomCancel: {
    width: SIZES.button.md,
    height: SIZES.button.md,
    backgroundColor: C.surface,
    borderRadius: SIZES.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Phase-2: Create room with password styles
  createRoomContainer: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.base,
    backgroundColor: C.surface,
    borderRadius: SIZES.radius.md,
    padding: SPACING.md,
  },
  showPasswordButton: {
    width: moderateScale(40, 0.25),
    height: SIZES.button.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRoomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  createRoomSubmit: {
    flex: 1,
    height: SIZES.button.md,
    backgroundColor: C.primary,
    borderRadius: SIZES.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRoomSubmitText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.md, 1.2),
    color: '#FFF',
  },
  createRoomCancelBtn: {
    paddingHorizontal: SPACING.base,
    height: SIZES.button.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRoomCancelText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    color: C.textLight,
  },
});
