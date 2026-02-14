/**
 * Chat Room Layout
 *
 * This layout applies ONLY to chat-room routes.
 * It disables iOS swipe-back gesture to enforce the rule that
 * users can only exit a chat room via "Leave Room" in their profile.
 *
 * - gestureEnabled: false → blocks iOS swipe-back
 * - Android hardware back is handled by BackHandler in [roomId].tsx
 * - Tab switching remains allowed (this only affects stack navigation)
 */
import { Stack } from 'expo-router';

export default function ChatRoomLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Disable iOS swipe-back gesture for all chat room screens
        gestureEnabled: false,
        // Prevent any animation that might suggest "back" is possible
        animation: 'fade',
      }}
    >
      <Stack.Screen
        name="[roomId]"
        options={{
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
}
