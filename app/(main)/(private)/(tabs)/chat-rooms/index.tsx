import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
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
import { INCOGNITO_COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import {
  DEMO_CHAT_ROOMS,
  DEMO_JOINED_ROOMS,
  DemoChatRoom,
} from '@/lib/demoData';
import { useChatRoomSessionStore } from '@/stores/chatRoomSessionStore';
import { useAuthStore } from '@/stores/authStore';
import { useDemoDmStore, computeUnreadDmCountsByRoom } from '@/stores/demoDmStore';
import { usePreferredChatRoomStore } from '@/stores/preferredChatRoomStore';

const C = INCOGNITO_COLORS;

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

// Unified room type for both demo and Convex modes
interface ChatRoom {
  id: string;
  name: string;
  slug: string;
  category: 'language' | 'general';
  memberCount: number;
  lastMessageText?: string;
  // Icon support (admin-set, optional)
  iconKey?: string;   // Maps to ROOM_ICON_CONFIG or local asset
  iconUrl?: string;   // Remote image URL (takes priority over iconKey)
}

export default function ChatRoomsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [joinedRooms, setJoinedRooms] = useState(DEMO_JOINED_ROOMS);

  // Phase-2: Private rooms state
  const [joinCode, setJoinCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Navigation readiness check - prevent "navigate before mounting Root Layout" warning
  const rootNavState = useRootNavigationState();
  const isNavigationReady = !!rootNavState?.key;

  // Track if user manually navigated (tapped a room) - skip preferred redirect if so
  const userNavigatedRef = useRef(false);

  // P2-AUD-005: Ref for refresh timeout cleanup
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session store for lastVisitedAt tracking
  const lastVisitedAt = useChatRoomSessionStore((s) => s.lastVisitedAt);
  const markRoomVisited = useChatRoomSessionStore((s) => s.markRoomVisited);

  // Current user ID for filtering out own messages
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = userId || 'demo_user_1';

  // ─────────────────────────────────────────────────────────────────────────────
  // PREFERRED ROOM REDIRECT LOGIC (zero-flash)
  // Gate UI render until we know if user has a preferred room.
  // If preferred room exists → redirect immediately, never show homepage.
  // If no preferred room → show homepage.
  // ─────────────────────────────────────────────────────────────────────────────
  const [checkingPreferred, setCheckingPreferred] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const preferredRoomId = usePreferredChatRoomStore((s) => s.preferredRoomId);
  const preferredHasHydrated = usePreferredChatRoomStore((s) => s._hasHydrated);
  const clearPreferredRoom = usePreferredChatRoomStore((s) => s.clearPreferredRoom);
  const hasRedirectedRef = useRef(false);

  // Convex query for preferred room (live mode only)
  const convexPreferredRoom = useQuery(
    api.users.getPreferredChatRoom,
    isDemoMode || !userId ? 'skip' : { userId: userId as Id<'users'> }
  );

  // Determine if we're still loading preferred room data
  const isPreferredLoading = isDemoMode
    ? !preferredHasHydrated
    : convexPreferredRoom === undefined;

  // Determine effective preferred room ID (only valid after loading complete)
  const effectivePreferredRoomId = isDemoMode
    ? preferredRoomId
    : convexPreferredRoom?.preferredChatRoomId ?? null;

  // Validate preferred room exists before redirecting (prevents stale room redirect)
  const preferredRoomValidation = useQuery(
    api.chatRooms.getRoom,
    effectivePreferredRoomId && !isDemoMode
      ? { roomId: effectivePreferredRoomId as Id<'chatRooms'> }
      : 'skip'
  );

  // For demo mode, check if room exists in demo data
  const isDemoRoomValid = isDemoMode && effectivePreferredRoomId
    ? DEMO_CHAT_ROOMS.some((r) => r.id === effectivePreferredRoomId)
    : true;

  // Room is valid if: (1) demo mode and room in demo list, or (2) convex mode and room exists
  const isPreferredRoomValid = isDemoMode
    ? isDemoRoomValid
    : preferredRoomValidation !== null;

  // Still loading validation if convex query is undefined (not yet resolved)
  const isValidationLoading = !isDemoMode && effectivePreferredRoomId && preferredRoomValidation === undefined;

  // Use useEffect (not useLayoutEffect) to avoid "navigate before mounting Root Layout"
  // P2 STABILITY: Add safety timeout to prevent infinite spinner if navigation fails
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Wait for navigation to be ready before any redirect
    if (!isNavigationReady) return;

    // User manually tapped a room → skip preferred redirect
    if (userNavigatedRef.current) {
      setCheckingPreferred(false);
      return;
    }

    // Still loading preferred room data → keep checkingPreferred true
    if (isPreferredLoading) return;

    // Already redirected in this session → don't redirect again
    if (hasRedirectedRef.current) {
      setCheckingPreferred(false);
      return;
    }

    // Has preferred room → validate before redirect
    if (effectivePreferredRoomId) {
      // Still validating if room exists → wait
      if (isValidationLoading) return;

      // Room does NOT exist (stale ID) → clear and skip redirect
      if (!isPreferredRoomValid) {
        if (__DEV__) console.log('[ChatRooms] Skipping redirect; stale roomId cleared', effectivePreferredRoomId);
        clearPreferredRoom();
        setCheckingPreferred(false);
        return;
      }

      // Room exists → redirect
      if (__DEV__) console.log('[ChatRooms] Initial redirect to', effectivePreferredRoomId);
      hasRedirectedRef.current = true;
      setIsRedirecting(true);

      // P2 STABILITY: Safety timeout - if navigation doesn't complete within 2s, clear spinner
      redirectTimeoutRef.current = setTimeout(() => {
        setCheckingPreferred(false);
        setIsRedirecting(false);
      }, 2000);

      router.replace(`/(main)/(private)/(tabs)/chat-rooms/${effectivePreferredRoomId}` as any);
      return;
    }

    // No preferred room → show homepage
    setCheckingPreferred(false);
  }, [isNavigationReady, isPreferredLoading, effectivePreferredRoomId, isValidationLoading, isPreferredRoomValid, clearPreferredRoom, router]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
      // P2-AUD-005: Clear refresh timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  // Also check on screen focus (returning to tab after navigating away)
  // Allow redirect every time screen focuses if preferredRoom exists
  useFocusEffect(
    useCallback(() => {
      // Skip if still loading or no preferred room
      if (isPreferredLoading || !effectivePreferredRoomId) return;

      // Skip if already redirected in this mount cycle (useEffect handled it)
      if (hasRedirectedRef.current) return;

      // Skip if still validating room existence
      if (isValidationLoading) return;

      // Room does NOT exist (stale ID) → clear and skip redirect
      if (!isPreferredRoomValid) {
        if (__DEV__) console.log('[ChatRooms] Focus: stale roomId cleared', effectivePreferredRoomId);
        clearPreferredRoom();
        return;
      }

      if (__DEV__) console.log('[ChatRooms] Focus redirect to', effectivePreferredRoomId);
      hasRedirectedRef.current = true;
      setIsRedirecting(true);
      router.replace(`/(main)/(private)/(tabs)/chat-rooms/${effectivePreferredRoomId}` as any);

      // Cleanup: reset flag when screen loses focus so we can redirect again next time
      return () => {
        hasRedirectedRef.current = false;
        setIsRedirecting(false);
      };
    }, [isPreferredLoading, effectivePreferredRoomId, isValidationLoading, isPreferredRoomValid, clearPreferredRoom, router])
  );

  // Phase-2: Get DM store state for per-room unread counts
  const dmConversations = useDemoDmStore((s) => s.conversations);
  const dmMeta = useDemoDmStore((s) => s.meta);

  // Convex query for live mode (skipped in demo mode)
  const convexRooms = useQuery(
    api.chatRooms.listRooms,
    isDemoMode ? 'skip' : {}
  );

  // Phase-2: Query for user's private rooms
  // In demo mode: pass demo args to resolve userId
  const myPrivateRooms = useQuery(
    api.chatRooms.getMyPrivateRooms,
    isDemoMode && userId
      ? { isDemo: true, demoUserId: userId }
      : {}
  );

  // Phase-2: Mutations for private rooms
  const joinRoomByCodeMut = useMutation(api.chatRooms.joinRoomByCode);
  const createPrivateRoomMut = useMutation(api.chatRooms.createPrivateRoom);
  const resetMyPrivateRoomsMut = useMutation(api.chatRooms.resetMyPrivateRooms);

  // Filter private rooms into ChatRoom format
  // Phase-2 FIX: Include private rooms in demo mode too (for rooms created by demo user)
  const privateRooms: ChatRoom[] = useMemo(() => {
    if (!myPrivateRooms) return [];
    return myPrivateRooms.map((r) => ({
      id: r._id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      memberCount: r.memberCount,
      lastMessageText: r.lastMessageText,
      iconKey: r.slug,
    }));
  }, [myPrivateRooms]);

  // P2 CR-010: Track loading state for Convex mode
  const isConvexLoading = !isDemoMode && convexRooms === undefined;

  // Phase-2: Calculate DM unread counts per room (NOT group messages)
  // Badge shows DISTINCT SENDERS with unseen DMs from that room
  // Computed directly (not memoized) to ensure re-render on store changes
  const unreadCounts = isDemoMode
    ? computeUnreadDmCountsByRoom(
        { conversations: dmConversations, meta: dmMeta },
        currentUserId
      ).byRoomId
    : {};

  // Unified rooms list: demo or Convex
  // Filter out "English" room - users can chat in English inside Global
  // P2-AUD-006: Memoize to prevent re-computation on every render
  const rooms: ChatRoom[] = useMemo(
    () =>
      (isDemoMode
        ? DEMO_CHAT_ROOMS.map((r) => ({
            id: r.id,
            name: r.name,
            slug: r.slug,
            category: r.category,
            memberCount: r.memberCount,
            lastMessageText: r.lastMessageText,
            iconKey: r.slug, // Use slug as iconKey for demo rooms
          }))
        : (convexRooms ?? []).map((r) => ({
            id: r._id,
            name: r.name,
            slug: r.slug,
            category: r.category,
            memberCount: r.memberCount,
            lastMessageText: r.lastMessageText,
            iconKey: r.slug, // Use slug as iconKey fallback
            // iconUrl: r.iconUrl, // Enable when schema supports it
          }))
      ).filter((r) => r.name.toLowerCase() !== 'english'),
    [isDemoMode, convexRooms]
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // In live mode, Convex auto-refreshes. For demo mode, simulate delay.
    // P2-AUD-005: Track timeout in ref for cleanup
    refreshTimeoutRef.current = setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleOpenRoom = useCallback(
    (roomId: string) => {
      if (__DEV__) console.log('[TAP] room pressed', { roomId, t: Date.now() });
      // Mark user navigated to cancel any pending preferred room redirect
      userNavigatedRef.current = true;
      // Clear any pending redirect timeout
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }

      // ISSUE B: Find room to get name and private status for instant render
      // Check in rooms (general/language) first, then privateRooms
      const foundRoom = rooms.find((r) => r.id === roomId);
      const foundPrivateRoom = privateRooms.find((r) => r.id === roomId);
      const roomName = foundRoom?.name ?? foundPrivateRoom?.name ?? '';
      // Private rooms are in privateRooms array (or from myPrivateRooms query which has joinCode)
      const isPrivate = !!foundPrivateRoom ? '1' : '0';

      // Navigate FIRST (instant) with route params for instant render
      router.push({
        pathname: `/(main)/(private)/(tabs)/chat-rooms/${roomId}`,
        params: { roomName, isPrivate },
      } as any);
      if (__DEV__) console.log('[NAV] room push scheduled', { roomName, isPrivate, t: Date.now() });
      // Defer non-critical state updates
      if (isDemoMode && !joinedRooms[roomId]) {
        setJoinedRooms((prev) => ({ ...prev, [roomId]: true }));
      }
      // Mark room as visited to clear unread badge
      markRoomVisited(roomId);
    },
    [router, joinedRooms, markRoomVisited, rooms, privateRooms]
  );

  const handleCreateRoom = useCallback(() => {
    router.push('/(main)/create-room' as any);
  }, [router]);

  // Phase-2: Handle join by code
  const handleJoinByCode = useCallback(async () => {
    if (!joinCode.trim() || isJoining) return;
    setIsJoining(true);
    try {
      const result = await joinRoomByCodeMut({ joinCode: joinCode.trim() });
      setJoinCode('');
      if (result.alreadyMember) {
        Alert.alert('Already a Member', 'You are already a member of this room.');
      }
      // ISSUE B: Navigate with route params for instant render (private room)
      router.push({
        pathname: `/(main)/(private)/(tabs)/chat-rooms/${result.roomId}`,
        params: { roomName: '', isPrivate: '1' },
      } as any);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to join room');
    } finally {
      setIsJoining(false);
    }
  }, [joinCode, isJoining, joinRoomByCodeMut, router]);

  // Phase-2: Handle reset private rooms (demo mode only)
  const handleResetPrivateRooms = useCallback(async () => {
    if (!isDemoMode) return;

    Alert.alert(
      'Reset Private Rooms',
      'This will delete ALL your private rooms and their messages. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset All',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await resetMyPrivateRoomsMut({
                isDemo: true,
                demoUserId: userId || '',
              });
              Alert.alert(
                'Rooms Deleted',
                `Successfully deleted ${result.deletedRooms} private room${result.deletedRooms === 1 ? '' : 's'}.`
              );
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to reset rooms');
            }
          },
        },
      ]
    );
  }, [resetMyPrivateRoomsMut, userId]);

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
      const args: { name: string; password?: string } = { name: newRoomName.trim() };
      if (pwd.length > 0) {
        args.password = pwd;
      }
      const result = await createPrivateRoomMut(args);

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
      setIsCreating(false);
    }
  }, [newRoomName, newRoomPassword, isCreating, createPrivateRoomMut, router]);

  const renderRoom = useCallback(
    ({ item }: { item: ChatRoom }) => {
      // Get icon key for this room (by slug/iconKey)
      const iconKey = item.iconKey ?? item.slug;
      const localAsset = ROOM_ICON_ASSETS[iconKey];
      const fallbackColor = ROOM_FALLBACK_COLORS[iconKey];

      // Get unread count for this room
      const unreadCount = unreadCounts[item.id] ?? 0;

      // Render room icon
      const renderRoomIcon = () => {
        // Priority 1: Remote URL (admin-set)
        if (item.iconUrl) {
          return (
            <Image
              source={{ uri: item.iconUrl }}
              style={styles.roomIconImage}
              resizeMode="cover"
            />
          );
        }

        // Priority 2: Local asset image (when available)
        if (localAsset) {
          return (
            <Image
              source={localAsset}
              style={styles.roomIconImage}
              resizeMode="cover"
            />
          );
        }

        // Fallback: Colored circle with icon based on category
        const isGeneral = item.category === 'general';
        const bgColor = fallbackColor ? fallbackColor + '20' : (isGeneral ? 'rgba(100,181,246,0.12)' : 'rgba(233,69,96,0.12)');
        const iconColor = fallbackColor ?? (isGeneral ? '#64B5F6' : C.primary);

        return (
          <View style={[styles.roomIcon, { backgroundColor: bgColor }]}>
            <Ionicons
              name={isGeneral ? 'globe' : 'language'}
              size={22}
              color={iconColor}
            />
          </View>
        );
      };

      return (
        <TouchableOpacity
          style={styles.roomCard}
          onPress={() => handleOpenRoom(item.id)}
          activeOpacity={0.7}
        >
          {renderRoomIcon()}

          <View style={styles.roomInfo}>
            <View style={styles.roomNameRow}>
              <Text style={styles.roomName}>{item.name}</Text>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </View>
            {item.lastMessageText ? (
              <Text style={styles.roomPreview} numberOfLines={1}>
                {item.lastMessageText}
              </Text>
            ) : (
              <Text style={styles.roomPreviewEmpty}>No messages yet</Text>
            )}
            <View style={styles.roomMeta}>
              <Ionicons name="people" size={11} color={C.textLight} />
              <Text style={styles.roomMembers}>{item.memberCount}</Text>
            </View>
          </View>

          <Ionicons name="chevron-forward" size={16} color={C.textLight} />
        </TouchableOpacity>
      );
    },
    [handleOpenRoom, unreadCounts]
  );

  const generalRooms = rooms.filter((r) => r.category === 'general');
  const languageRooms = rooms.filter((r) => r.category === 'language');

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

  // Gate 2: Convex mode - wait for data to load
  if (!isDemoMode && (checkingPreferred || isConvexLoading)) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chat Rooms</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Simple heading - NO icons on HOME screen */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chat Rooms</Text>
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <>
            {/* Section 1: General */}
            <Text style={styles.sectionTitle}>General</Text>
            {generalRooms.map((room) => (
              <React.Fragment key={room.id}>
                {renderRoom({ item: room })}
              </React.Fragment>
            ))}

            {/* Section 2: Languages */}
            <Text style={styles.sectionTitle}>Languages</Text>
            {languageRooms.map((room) => (
              <React.Fragment key={room.id}>
                {renderRoom({ item: room })}
              </React.Fragment>
            ))}

            {/* Section 3: Create Private Room CTA */}
            <View style={styles.createPrivateSection}>
              <TouchableOpacity
                style={styles.addRoomButton}
                onPress={handleCreateRoom}
                activeOpacity={0.7}
              >
                <View style={styles.addRoomIcon}>
                  <Ionicons name="lock-closed" size={22} color={C.primary} />
                </View>
                <Text style={styles.addRoomText}>Create Private Room</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textLight} />
              </TouchableOpacity>
            </View>

            {/* Section 4: Private Rooms - show if any private rooms exist */}
            {privateRooms.length > 0 && (
              <>
                {/* Private Rooms header with optional Reset button (demo mode only) */}
                <View style={styles.privateRoomsSectionHeader}>
                  <Text style={styles.sectionTitle}>Private Rooms</Text>
                  {isDemoMode && (
                    <TouchableOpacity
                      style={styles.resetPrivateRoomsButton}
                      onPress={handleResetPrivateRooms}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={14} color={C.textLight} />
                      <Text style={styles.resetPrivateRoomsText}>Reset</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Join by Code Input (only in live mode) */}
                {!isDemoMode && (
                  <View style={styles.joinCodeRow}>
                    <TextInput
                      style={styles.joinCodeInput}
                      placeholder="Enter room code..."
                      placeholderTextColor={C.textLight}
                      value={joinCode}
                      onChangeText={setJoinCode}
                      autoCapitalize="characters"
                      maxLength={6}
                    />
                    <TouchableOpacity
                      style={[styles.joinCodeButton, (!joinCode.trim() || isJoining) && styles.joinCodeButtonDisabled]}
                      onPress={handleJoinByCode}
                      disabled={!joinCode.trim() || isJoining}
                    >
                      {isJoining ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Text style={styles.joinCodeButtonText}>Join</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* Private Rooms List */}
                {privateRooms.map((room) => (
                  <React.Fragment key={room.id}>
                    {renderRoom({ item: room })}
                  </React.Fragment>
                ))}
              </>
            )}
          </>
        }
        ListFooterComponent={<View style={styles.footerSpacer} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  roomIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(233,69,96,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomIconGeneral: {
    backgroundColor: 'rgba(100,181,246,0.12)',
  },
  roomIconImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  roomInfo: {
    flex: 1,
  },
  roomNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  roomName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  roomPreview: {
    fontSize: 14,
    color: C.textLight,
    marginBottom: 4,
  },
  roomPreviewEmpty: {
    fontSize: 14,
    color: C.textLight,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  roomMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  roomMembers: {
    fontSize: 12,
    color: C.textLight,
  },
  footerSection: {
    paddingTop: 16,
    paddingHorizontal: 12,
  },
  footerSpacer: {
    height: 24,
  },
  createPrivateSection: {
    paddingTop: 16,
    paddingHorizontal: 12,
    paddingBottom: 4,
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
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: C.surface,
  },
  resetPrivateRoomsText: {
    fontSize: 12,
    fontWeight: '500',
    color: C.textLight,
  },
  addRoomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: C.accent,
    borderStyle: 'dashed',
  },
  addRoomIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(233,69,96,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRoomText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: C.primary,
  },
  // P2 CR-010: Loading state styles
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: C.textLight,
  },
  // Phase-2: Private rooms styles
  joinCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  joinCodeInput: {
    flex: 1,
    height: 44,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: C.text,
    letterSpacing: 2,
  },
  joinCodeButton: {
    height: 44,
    paddingHorizontal: 20,
    backgroundColor: C.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinCodeButtonDisabled: {
    opacity: 0.5,
  },
  joinCodeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  emptyPrivateRooms: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
    marginHorizontal: 12,
    backgroundColor: C.surface,
    borderRadius: 12,
    marginBottom: 8,
  },
  emptyPrivateText: {
    fontSize: 14,
    color: C.textLight,
  },
  createPrivateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginHorizontal: 12,
    marginBottom: 16,
  },
  createPrivateText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.primary,
  },
  createRoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  createRoomInput: {
    flex: 1,
    height: 44,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: C.text,
  },
  createRoomButton: {
    width: 44,
    height: 44,
    backgroundColor: C.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRoomCancel: {
    width: 44,
    height: 44,
    backgroundColor: C.surface,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Phase-2: Create room with password styles
  createRoomContainer: {
    marginHorizontal: 12,
    marginBottom: 16,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
  },
  showPasswordButton: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRoomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  createRoomSubmit: {
    flex: 1,
    height: 44,
    backgroundColor: C.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRoomSubmitText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  createRoomCancelBtn: {
    paddingHorizontal: 16,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRoomCancelText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.textLight,
  },
});
