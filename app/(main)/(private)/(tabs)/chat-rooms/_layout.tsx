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
 * Room-scoped DMs render inside the room screen modal flow.
 */
import { Stack } from 'expo-router';

export default function ChatRoomsTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[roomId]" />
    </Stack>
  );
}
