import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useDemoDmStore, computeUnreadDmCountsByRoom } from '@/stores/demoDmStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;

/**
 * Phase-2 Private Tabs Layout
 *
 * Note: Android back navigation is handled by the parent PrivateLayout
 * at app/(main)/(private)/_layout.tsx which enforces the 2-step back behavior:
 * - From any Phase-2 screen → back to Desired Land
 * - From Desired Land → back to Phase-1 Discover
 */
export default function PrivateTabsLayout() {
  // Calculate total unread count for Messages tab badge
  const conversations = usePrivateChatStore((s) => s.conversations);
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  // Phase-2: Calculate rooms-with-unread count for Chat Rooms tab badge
  const dmConversations = useDemoDmStore((s) => s.conversations);
  const dmMeta = useDemoDmStore((s) => s.meta);
  const authUserId = useAuthStore((s) => s.userId);
  const currentUserId = authUserId || 'demo_user_1';

  // Compute rooms with unread DMs (demo mode only for now)
  const roomsWithUnread = isDemoMode
    ? computeUnreadDmCountsByRoom({ conversations: dmConversations, meta: dmMeta }, currentUserId).roomsWithUnread
    : 0;

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
          title: 'Desire Land',
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
        }}
      />
      <Tabs.Screen
        name="confess"
        options={{
          href: null,
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
        name="rooms"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="mail" size={size} color={color} />
          ),
          tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
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
