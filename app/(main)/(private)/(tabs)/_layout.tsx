/**
 * PRIVATE TABS LAYOUT - STABILIZED
 *
 * BLOCKED FEATURES: All queries removed to prevent crashes from missing API modules:
 * - api.privateConversations (doesn't exist)
 * - api.chatRooms.getUnreadDmCountsByRoom (doesn't exist)
 * - api.truthDare.getPendingConnectRequests (wrong args)
 *
 * This layout only provides tab navigation. Badge counts are disabled until
 * backend modules are implemented.
 *
 * DO NOT add queries back until backend is ready.
 */
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { getTabLabelFontSize, SCREEN } from '@/lib/responsive';

const C = INCOGNITO_COLORS;

export default function PrivateTabsLayout() {
  const insets = useSafeAreaInsets();

  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'private_tabs_layout_queries', {
      message: 'All queries disabled - privateConversations, chatRooms.getUnreadDmCountsByRoom, truthDare.getPendingConnectRequests',
    });
  }

  // Tab bar height calculation for Android
  const TAB_BAR_CONTENT_HEIGHT = 56;
  const tabBarHeight = Platform.OS === 'android'
    ? TAB_BAR_CONTENT_HEIGHT + insets.bottom
    : TAB_BAR_CONTENT_HEIGHT;
  const tabBarPaddingBottom = Platform.OS === 'android'
    ? insets.bottom
    : 0;

  return (
    <Tabs
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
        name="desire-land"
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
          // Badge disabled - api.truthDare.getPendingConnectRequests has wrong args
        }}
      />
      <Tabs.Screen
        name="chat-rooms"
        options={{
          title: 'Chat Rooms',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
          // Badge disabled - api.chatRooms.getUnreadDmCountsByRoom doesn't exist
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="mail" size={size} color={color} />
          ),
          // Badge disabled - api.privateConversations doesn't exist
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
