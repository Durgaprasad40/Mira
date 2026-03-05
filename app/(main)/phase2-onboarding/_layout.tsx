import React, { Component, ReactNode } from 'react';
import { Stack, router as globalRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

// M-1: Minimal auth error detection (same as H-3)
function isAuthError(msg: string): boolean {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return l.includes('unauthenticated') || l.includes('unauthorized') ||
         l.includes('token expired') || l.includes('session expired');
}

// M-1: Auth Error Boundary for Phase-2 onboarding
class Phase2ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isAuthError(error?.message || '')) {
      useAuthStore.getState().logout();
      globalRouter.replace('/(auth)/welcome');
    }
  }

  render() {
    if (this.state.error) {
      if (isAuthError(this.state.error.message || '')) {
        return null;
      }
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
      <Stack.Screen name="photo-select" />
      <Stack.Screen name="profile-edit" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="looking-for-edit" />
    </Stack>
    </Phase2ErrorBoundary>
  );
}
