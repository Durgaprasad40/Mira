/*
 * Phase-2 Messages tab layout (Stack).
 * Mirrors Phase-1 messages/_layout.tsx so that pushing to chats/[id]
 * keeps the Phase-2 bottom tab bar visible (outer Tabs wraps this Stack).
 */
import { Stack } from 'expo-router';

export default function Phase2ChatsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
