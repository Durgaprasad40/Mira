/*
 * LOCKED (PRIVATE TABS LAYOUT)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 *
 * P2-GLOBAL-FIX: Added global delivery reconciliation and badge updates
 * - Delivery marks happen on reconnect/foreground (not just tab focus)
 * - Badge updates globally via Convex subscription (not just when Messages tab focused)
 */
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useDemoDmStore, computeUnreadDmCountsByRoom } from '@/stores/demoDmStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import type { ConnectionSource, IncognitoConversation } from '@/types';

const C = INCOGNITO_COLORS;

/**
 * Phase-2 Private Tabs Layout
 *
 * Note: Android back navigation is handled by the parent PrivateLayout
 * at app/(main)/(private)/_layout.tsx which enforces the 2-step back behavior:
 * - From any Phase-2 screen → back to Desired Land
 * - From Desired Land → back to Phase-1 Discover
 */
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
  // Auth for queries and mutations
  const authUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const currentUserId = authUserId || 'demo_user_1';

  // Store selectors and actions
  const conversations = usePrivateChatStore((s) => s.conversations);
  const reconcileConversations = usePrivateChatStore((s) => s.reconcileConversations);

  // ═══════════════════════════════════════════════════════════════════════════
  // P2-GLOBAL-FIX: Global Convex subscription for real-time badge updates
  // This runs ALWAYS (not just when Messages tab is focused)
  // ═══════════════════════════════════════════════════════════════════════════
  const backendConversations = useQuery(
    api.privateConversations.getUserPrivateConversations,
    currentUserId && !isDemoMode ? { authUserId: currentUserId } : 'skip'
  );

  // Delivery mutation (global, not tab-specific)
  const markAllDeliveredMutation = useMutation(api.privateConversations.markAllPrivateMessagesDelivered);

  // ═══════════════════════════════════════════════════════════════════════════
  // P2-GLOBAL-FIX: Reconcile backend conversations to store (global sync)
  // This ensures badge always reflects latest backend state
  // ═══════════════════════════════════════════════════════════════════════════
  const normalizedBackend = useMemo(() => {
    if (!backendConversations) return null;

    return backendConversations
      .filter((bc) => isPhase2Source(bc.connectionSource as string))
      .map((bc) => {
        const source = bc.connectionSource as string;
        return {
          id: bc.id as string,
          participantId: bc.participantId as string,
          participantName: bc.participantName,
          participantAge: bc.participantAge || 0,
          participantPhotoUrl: bc.participantPhotoUrl || '',
          participantIntentKey: (bc as any).participantIntentKey ?? null,
          participantLastActive: (bc as any).participantLastActive ?? 0,
          lastMessage: bc.lastMessage || 'Say hi!',
          lastMessageAt: bc.lastMessageAt,
          unreadCount: bc.unreadCount,
          connectionSource: normalizeConnectionSource(source),
          matchSource: source === 'desire_super_like' ? 'super_like' as const : undefined,
          // PHOTO-BLUR-FIX: Include blur flags from backend for consistent photo display
          isPhotoBlurred: (bc as any).isPhotoBlurred ?? false,
          canViewClearPhoto: (bc as any).canViewClearPhoto ?? true,
        };
      }) as IncognitoConversation[];
  }, [backendConversations]);

  useEffect(() => {
    if (!normalizedBackend) return;
    reconcileConversations(normalizedBackend);
  }, [normalizedBackend, reconcileConversations]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P2-GLOBAL-FIX: Mark messages delivered on reconnect/subscription change
  // ROOT CAUSE FIX: Delivery now happens when Convex subscription updates
  // (not just when Messages tab is focused)
  // ═══════════════════════════════════════════════════════════════════════════
  const lastUnreadHashRef = useRef<string>('');
  useEffect(() => {
    if (!backendConversations || !token) return;

    // Calculate hash of unread messages across all conversations
    const unreadHash = backendConversations
      .filter((c) => (c.unreadCount || 0) > 0)
      .map((c) => `${c.id}:${c.unreadCount}`)
      .join('|');

    // If unread hash changed (new messages arrived via reconnect), mark delivered
    if (unreadHash && unreadHash !== lastUnreadHashRef.current) {
      if (__DEV__) {
        console.log('[P2_DELIVERY_RECONNECT] Subscription detected new unread, marking delivered globally', {
          conversationCount: backendConversations.length,
          pendingUndeliveredCount: backendConversations.filter(c => (c.unreadCount || 0) > 0).length,
          networkState: 'reconnected',
        });
      }
      markAllDeliveredMutation({ token })
        .then((result) => {
          const count = (result as any)?.count || 0;
          if (__DEV__) console.log('[P2_DELIVERY_RECONNECT] Global delivered count:', count);
        })
        .catch(() => {});
    }
    lastUnreadHashRef.current = unreadHash;
  }, [backendConversations, token, markAllDeliveredMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P2-GLOBAL-FIX: Mark messages delivered on app foreground
  // Handles case where user backgrounds app, receives messages, then returns
  // ═══════════════════════════════════════════════════════════════════════════
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!token) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // Only trigger on returning to foreground (background/inactive → active)
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        if (__DEV__) {
          console.log('[P2_DELIVERY_RECONNECT] App foregrounded, marking all delivered', {
            currentUserId: currentUserId?.slice(-8),
            appState: nextAppState,
          });
        }
        markAllDeliveredMutation({ token })
          .then((result) => {
            const count = (result as any)?.count || 0;
            if (__DEV__) console.log('[P2_DELIVERY_RECONNECT] Foreground delivered count:', count);
          })
          .catch(() => {});
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [token, currentUserId, markAllDeliveredMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // BADGE-FIX: Count conversations WITH unread, not total unread messages
  // Example: 1 user sends 10 messages → badge = 1 (not 10)
  // ═══════════════════════════════════════════════════════════════════════════
  const conversationsWithUnread = conversations.filter(c => (c.unreadCount || 0) > 0).length;

  // DEBUG: Log badge computation for troubleshooting
  if (__DEV__ && conversations.length > 0) {
    console.log('[P2_BADGE_DEBUG] Global badge update:', {
      totalConversations: conversations.length,
      unreadConversationIds: conversations.filter(c => (c.unreadCount || 0) > 0).map(c => c.id?.slice(-6)),
      badgeCount: conversationsWithUnread,
      source: 'phase2-global',
    });
  }

  // Phase-2: Calculate rooms-with-unread count for Chat Rooms tab badge
  const dmConversations = useDemoDmStore((s) => s.conversations);
  const dmMeta = useDemoDmStore((s) => s.meta);

  // Compute rooms with unread DMs (demo mode only for now)
  const roomsWithUnread = isDemoMode
    ? computeUnreadDmCountsByRoom({ conversations: dmConversations, meta: dmMeta }, currentUserId).roomsWithUnread
    : 0;

  // P0-FIX: Query pending T/D connect requests for badge
  const pendingConnectRequests = useQuery(
    api.truthDare.getPendingConnectRequests,
    currentUserId ? { authUserId: currentUserId } : 'skip'
  );
  const todPendingCount = pendingConnectRequests?.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.surface,
          borderTopColor: C.accent,
        },
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.textLight,
      }}
    >
      <Tabs.Screen
        name="desire-land"
        options={{
          title: 'Deep Connect',
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
          // P0-FIX: Badge for pending connect requests
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
          // Phase-2: Show count of rooms with unread DMs (not total messages)
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
          tabBarBadge: conversationsWithUnread > 0 ? conversationsWithUnread : undefined,
          tabBarBadgeStyle: {
            backgroundColor: C.primary,
            fontSize: 10,
            minWidth: 18,
            height: 18,
          },
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
