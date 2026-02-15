/**
 * Chat Rooms Tab Stack Layout
 *
 * This nested stack keeps the tab bar visible when navigating
 * between the room list and individual room screens.
 */
import { Stack } from 'expo-router';

export default function ChatRoomsTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[roomId]"
        options={{
          // Disable iOS swipe-back gesture inside chat room
          gestureEnabled: false,
          animation: 'slide_from_right',
        }}
      />
    </Stack>
  );
}
