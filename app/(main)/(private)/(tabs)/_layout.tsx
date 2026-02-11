import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

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
