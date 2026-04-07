/*
 * LOCKED (MESSAGES LAYOUT)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */
import { Stack } from "expo-router";

export default function MessagesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
