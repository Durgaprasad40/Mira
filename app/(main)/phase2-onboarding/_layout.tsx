import React, { Component, ReactNode } from 'react';
import { Stack, router as globalRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

// M-1: Session invalidation detection (NARROWED - does NOT match resource-level auth errors)
// Only triggers logout for TRUE session invalidation, not room/resource access denials
function isSessionInvalidationError(msg: string): boolean {
  if (!msg) return false;
  const l = msg.toLowerCase();
  // Only match explicit session/token invalidation phrases
  // DO NOT match generic "unauthorized" or "unauthenticated" - those come from resource access denials
  return l.includes('token expired') ||
         l.includes('session expired') ||
         l.includes('invalid token') ||
         l.includes('session invalid') ||
         l.includes('session has expired') ||
         l.includes('token has expired') ||
         l.includes('auth token invalid');
}

// M-1: Session Invalidation Error Boundary for Phase-2 onboarding
// SECURITY FIX: Does NOT trigger logout for resource-level auth errors
class Phase2ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // SECURITY FIX: Only logout for true session invalidation (token/session expired)
    if (isSessionInvalidationError(error?.message || '')) {
      if (__DEV__) console.log('[Phase2ErrorBoundary] Session invalidation detected, logging out:', error?.message);
      // H5 FIX: Wrap in async IIFE to await logout before navigation
      (async () => {
        await useAuthStore.getState().logout();
        globalRouter.replace('/(auth)/welcome');
      })();
    }
  }

  render() {
    if (this.state.error) {
      if (isSessionInvalidationError(this.state.error.message || '')) {
        return null;
      }
      // Re-throw non-session errors so they propagate to the screen
      throw this.state.error;
    }
    return this.props.children;
  }
}

export default function Phase2OnboardingLayout() {
  return (
    <Phase2ErrorBoundary>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="profile-edit" />
      <Stack.Screen name="prompts" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="looking-for-edit" />
    </Stack>
    </Phase2ErrorBoundary>
  );
}
