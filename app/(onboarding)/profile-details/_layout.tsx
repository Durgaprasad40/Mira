/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/profile-details/_layout.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 *
 * UNLOCKED: 2026-03-14 for Life Rhythm page addition (per explicit user request)
 */
import { Stack } from 'expo-router';

export default function ProfileDetailsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="lifestyle" />
      <Stack.Screen name="life-rhythm" />
      <Stack.Screen name="education-religion" />
    </Stack>
  );
}
