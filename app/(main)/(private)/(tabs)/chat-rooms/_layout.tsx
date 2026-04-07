/*
 * UNLOCKED FOR AUDIT (PRIVATE CHAT ROOMS LAYOUT)
 * Temporarily unlocked for deep audit and bug-fixing work.
 *
 * STATUS:
 * - Under active audit
 * - Fixes allowed during audit period
 * - Will be re-locked after audit completion
 */

/**
 * Chat Rooms Tab Stack Layout
 *
 * This nested stack keeps the tab bar visible when navigating
 * between the room list and individual room screens.
 *
 * The DM route is presented as a transparent modal (half-screen overlay)
 * so the chat room remains visible underneath.
 */
import { Stack } from 'expo-router';

export default function ChatRoomsTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[roomId]" />
      {/* DM route as transparent modal - half-screen overlay over chat room */}
      <Stack.Screen
        name="dm/[dmId]"
        options={{
          presentation: 'transparentModal',
          animation: 'slide_from_bottom',
          headerShown: false,
        }}
      />
    </Stack>
  );
}
