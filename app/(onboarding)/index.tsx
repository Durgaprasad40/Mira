/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/index.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import { Redirect } from 'expo-router';

export default function OnboardingIndex() {
  // NEVER auto-navigate from this screen
  // Users should only reach onboarding screens by explicit button press from welcome screen
  // If somehow navigated here directly, redirect back to welcome
  return <Redirect href="/(auth)/welcome" />;
}

