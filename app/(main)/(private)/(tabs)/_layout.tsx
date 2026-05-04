/*
 * PRIVATE TABS LAYOUT - RESTORED WITH SAFE BADGE QUERIES
 *
 * P2-GLOBAL-FIX: Badge updates via Convex subscriptions
 * SAFETY: All queries wrapped with safe fallbacks - errors return 0, never crash
 */
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { getTabLabelFontSize, SCREEN } from '@/lib/responsive';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useDemoDmStore, computeUnreadDmCountsByRoom } from '@/stores/demoDmStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import type { ConnectionSource, IncognitoConversation } from '@/types';

const C = INCOGNITO_COLORS;

// P2-GLOBAL-FIX: Helper to normalize connection source
const normalizeConnectionSource = (source: string): ConnectionSource => {
  const validSources: ConnectionSource[] = ['tod', 'room', 'desire', 'desire_match', 'desire_super_like', 'friend'];
  if (validSources.includes(source as ConnectionSource)) {
    return source as ConnectionSource;
  }
  return 'desire';
};

// P2-GLOBAL-FIX: Check if connectionSource is a Phase-2 source
const isPhase2Source = (source: string): boolean => {
  return ['tod', 'room', 'desire', 'desire_match', 'desire_super_like'].includes(source);
};

export default function PrivateTabsLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Auth for queries
  const authUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const currentUserId = authUserId || 'demo_user_1';

  // Store selectors and actions
  const reconcileConversations = usePrivateChatStore((s) => s.reconcileConversations);

  // ═══════════════════════════════════════════════════════════════════════════
  // SAFE QUERY 1: Private Conversations (for sync/delivery)
  // Uses authUserId string, not token
  // ═══════════════════════════════════════════════════════════════════════════
  const backendConversations = useQuery(
    api.privateConversations.getUserPrivateConversations,
    currentUserId && !isDemoMode ? { authUserId: currentUserId } : 'skip'
  );
  const privateUnreadConversationCount = useQuery(
    api.privateConversations.getPrivateUnreadConversationCount,
    currentUserId && !isDemoMode ? { authUserId: currentUserId } : 'skip'
  );
  const messagesBadgeCount = privateUnreadConversationCount ?? 0;

  // Delivery mutation
  const markAllDeliveredMutation = useMutation(api.privateConversations.markAllPrivateMessagesDelivered);

  // Reconcile backend conversations to store
  const normalizedBackend = useMemo(() => {
    if (!backendConversations) return null;

    try {
      return backendConversations
        .filter((bc) => isPhase2Source(bc.connectionSource as string))
        .map((bc) => {
          const source = bc.connectionSource as string;
          return {
            id: bc.id as string,
            participantId: bc.participantId as string,
            // ANON-LOADING-FIX: backend may return null when displayName +
            // handle are both missing. Coerce to '' so IncognitoConversation
            // typing (string) is preserved; downstream renderers treat ''
            // as a missing-name placeholder — never as the literal "Anonymous".
            participantName: bc.participantName ?? '',
            participantAge: bc.participantAge || 0,
            participantPhotoUrl: bc.participantPhotoUrl || '',
            participantIntentKey: (bc as any).participantIntentKey ?? null,
            participantLastActive: (bc as any).participantLastActive ?? 0,
            lastMessage: bc.lastMessage || 'Say hi!',
            lastMessageAt: bc.lastMessageAt,
            // P2_TOD_NEWMATCH_PARITY: include the same preview/real-message
            // metadata that chats/index.tsx normalizedBackend writes. Without
            // these fields, a store row added via this layout (which has no
            // 500ms auth-confirm gate) lacks hasRealMessages, so the
            // newMatches/messageThreads split's `(convo as any).hasRealMessages`
            // fallback in chats/index.tsx is non-deterministic until the
            // Messages tab's own normalizedBackend Map populates. For T/D
            // accept flow, that race could push the fresh conversation into
            // the wrong bucket on first paint of the Messages tab.
            lastMessageSenderId: (bc as any).lastMessageSenderId ?? null,
            lastMessageType: (bc as any).lastMessageType ?? null,
            lastMessageIsProtected: (bc as any).lastMessageIsProtected === true,
            hasRealMessages: (bc as any).hasRealMessages === true,
            unreadCount: bc.unreadCount,
            connectionSource: normalizeConnectionSource(source),
            matchSource: source === 'desire_super_like' ? 'super_like' as const : undefined,
            isPhotoBlurred: (bc as any).isPhotoBlurred ?? false,
            canViewClearPhoto: (bc as any).canViewClearPhoto ?? true,
          };
        }) as IncognitoConversation[];
    } catch (err) {
      if (__DEV__) console.warn('[P2_TABS] Failed to normalize conversations:', err);
      return null;
    }
  }, [backendConversations]);

  useEffect(() => {
    if (!normalizedBackend) return;
    reconcileConversations(normalizedBackend);
  }, [normalizedBackend, reconcileConversations]);

  // Mark messages delivered on subscription change
  // CONTRACT FIX: Use authUserId (currentUserId) instead of token
  const lastUnreadHashRef = useRef<string>('');
  useEffect(() => {
    if (!backendConversations || !currentUserId) return;

    try {
      const unreadHash = backendConversations
        .filter((c) => (c.unreadCount || 0) > 0)
        .map((c) => `${c.id}:${c.unreadCount}`)
        .join('|');

      if (unreadHash && unreadHash !== lastUnreadHashRef.current) {
        markAllDeliveredMutation({ authUserId: currentUserId }).catch(() => {});
      }
      lastUnreadHashRef.current = unreadHash;
    } catch {
      // Silent fail - badge will just show stale data
    }
  }, [backendConversations, currentUserId, markAllDeliveredMutation]);

  // Mark messages delivered on app foreground
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    if (!currentUserId) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        markAllDeliveredMutation({ authUserId: currentUserId }).catch(() => {});
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [currentUserId, markAllDeliveredMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SAFE QUERY 2: Truth or Dare Pending Connect Requests (for T/D badge)
  // Uses authUserId string (FIXED from old token-based call)
  // ═══════════════════════════════════════════════════════════════════════════
  const pendingConnectRequests = useQuery(
    api.truthDare.getPendingConnectRequests,
    currentUserId && !isDemoMode ? { authUserId: currentUserId } : 'skip'
  );
  const todPendingCount = useMemo(() => {
    try {
      return pendingConnectRequests?.length ?? 0;
    } catch {
      return 0;
    }
  }, [pendingConnectRequests]);

  // ═══════════════════════════════════════════════════════════════════════════
  // BADGE 3: Chat Rooms - rooms with unread DMs
  // Demo mode uses store, production would need backend query
  // For now, use demo store as fallback (production backend query TBD)
  // ═══════════════════════════════════════════════════════════════════════════
  const dmConversations = useDemoDmStore((s) => s.conversations);
  const dmMeta = useDemoDmStore((s) => s.meta);

  const roomsWithUnread = useMemo(() => {
    try {
      // Use demo store computation for now
      // Production: Will add api.messages.getUnreadDmCountsByRoom when userId resolution is ready
      const result = computeUnreadDmCountsByRoom({ conversations: dmConversations, meta: dmMeta }, currentUserId);
      return result.roomsWithUnread;
    } catch {
      return 0;
    }
  }, [dmConversations, dmMeta, currentUserId]);

  // Tab bar height calculation for Android
  const TAB_BAR_CONTENT_HEIGHT = 56;
  const tabBarHeight = Platform.OS === 'android'
    ? TAB_BAR_CONTENT_HEIGHT + insets.bottom
    : TAB_BAR_CONTENT_HEIGHT;
  const tabBarPaddingBottom = Platform.OS === 'android'
    ? insets.bottom
    : 0;

  const handleChatsTabPress = (e: any) => {
    e.preventDefault();
    router.replace('/(main)/(private)/(tabs)/chats' as any);
  };

  return (
    <Tabs
      initialRouteName="deep-connect"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.surface,
          borderTopColor: C.accent,
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
        },
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textLight,
        tabBarLabelStyle: {
          fontSize: getTabLabelFontSize(),
          flexShrink: 1,
        },
      }}
    >
      <Tabs.Screen
        name="deep-connect"
        options={{
          title: SCREEN.isSmall ? 'Connect' : 'Deep Connect',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="truth-or-dare"
        options={{
          title: 'T or D',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="flame" size={size} color={color} />
          ),
          tabBarBadge: todPendingCount > 0 ? todPendingCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: '#E94560',
            fontSize: 10,
            minWidth: 18,
            height: 18,
          },
        }}
      />
      <Tabs.Screen
        name="chat-rooms"
        options={{
          title: 'Chat Rooms',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
          tabBarBadge: roomsWithUnread > 0 ? roomsWithUnread : undefined,
          tabBarBadgeStyle: {
            backgroundColor: C.primary,
            fontSize: 10,
            minWidth: 18,
            height: 18,
          },
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="mail" size={size} color={color} />
          ),
          tabBarBadge: messagesBadgeCount > 0 ? messagesBadgeCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: C.primary,
            fontSize: 10,
            minWidth: 18,
            height: 18,
          },
        }}
        listeners={{
          tabPress: handleChatsTabPress,
        }}
      />
      <Tabs.Screen
        name="private-profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
