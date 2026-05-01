/*
 * Phase-2 Messages tab layout (Stack).
 * Mirrors Phase-1 messages/_layout.tsx so that pushing to chats/[id]
 * keeps the Phase-2 bottom tab bar visible (outer Tabs wraps this Stack).
 *
 * P2_THREAD_FIRST_PAINT (transition flash fix):
 * Both `chats/index` and `chats/[id]` paint a dark `LinearGradient`
 * (top stop `#101426`). Without an explicit `contentStyle.backgroundColor`
 * on this Stack, React Navigation's native screen container defaults to
 * the platform background (white on Android), which is briefly visible
 * for one frame during the push slide between the two screens. Users
 * perceive this as: row tap → content appears → blank/white flash →
 * loading → real thread. Pinning the Stack container's background to
 * the gradient's top color makes the slide a single in-place transition
 * with no white flash. Phase-1 doesn't need this because its chat uses
 * the platform-default light theme (`COLORS.background = '#FFFFFF'`),
 * which already matches the native Stack default.
 */
import { Stack } from 'expo-router';

export default function Phase2ChatsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#101426' },
      }}
    />
  );
}
