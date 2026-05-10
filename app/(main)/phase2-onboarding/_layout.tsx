import React, { Component, ReactNode, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, router as globalRouter, usePathname, useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { buildPhase1ImportData } from '@/lib/phase2Onboarding';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

// M-1: Session invalidation detection (NARROWED - does NOT match resource-level auth errors)
// Only triggers logout for TRUE session invalidation, not room/resource access denials
function isSessionInvalidationError(msg: string) {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return l.includes('token expired') ||
         l.includes('session expired') ||
         l.includes('invalid token') ||
         l.includes('session invalid') ||
         l.includes('session has expired') ||
         l.includes('token has expired') ||
         l.includes('auth token invalid');
}

class Phase2ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isSessionInvalidationError(error?.message || '')) {
      if (__DEV__) console.log('[Phase2ErrorBoundary] Session invalidation detected, logging out:', error?.message);
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
      throw this.state.error;
    }
    return this.props.children;
  }
}

function Phase2OnboardingNavigator() {
  const router = useRouter();
  const pathname = usePathname();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  // FIX: Use getCurrentUser with userId instead of getCurrentUserFromToken with token
  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId } : 'skip'
  );
  // FIX: Use getByAuthUserId with authUserId instead of getCurrentOnboardingProfile with token
  const currentPrivateProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    userId && token ? { token, authUserId: userId } : 'skip'
  );
  // FIX: Use users.getOnboardingStatus with userId for Phase-2 routing state
  const onboardingState = useQuery(
    api.users.getOnboardingStatus,
    userId ? { userId } : 'skip'
  );

  const importPhase1Data = usePrivateProfileStore((s) => s.importPhase1Data);
  const hydrateFromConvex = usePrivateProfileStore((s) => s.hydrateFromConvex);
  const setAcceptedTermsAt = usePrivateProfileStore((s) => s.setAcceptedTermsAt);
  const hydrationKeyRef = useRef<string | null>(null);
  const routeCorrectionKeyRef = useRef<string | null>(null);

  // NOTE: Removed clearOnboardingProgress() on mount - it was wiping valid progress
  // and causing the flow to restart from Step 1. Backend state is now authoritative.

  useEffect(() => {
    if (!currentUser || currentPrivateProfile === undefined) {
      return;
    }

    const hydrationKey = JSON.stringify({
      userId: currentUser._id,
      profileId: currentPrivateProfile?._id ?? null,
      profileUpdatedAt: currentPrivateProfile?.updatedAt ?? null,
      consentAcceptedAt: currentUser.consentAcceptedAt ?? null,
    });

    if (hydrationKeyRef.current === hydrationKey) {
      return;
    }

    if (__DEV__) {
      console.log('[P2_ONB_LAYOUT] hydrating from backend (this should NOT happen after finalize)', {
        userId: currentUser._id?.substring(0, 8),
        hasPrivateProfile: !!currentPrivateProfile,
      });
    }

    importPhase1Data(buildPhase1ImportData(currentUser));
    hydrateFromConvex(currentPrivateProfile ?? null);

    if (currentUser.consentAcceptedAt) {
      setAcceptedTermsAt(currentUser.consentAcceptedAt);
    }

    hydrationKeyRef.current = hydrationKey;
  }, [currentPrivateProfile, currentUser, hydrateFromConvex, importPhase1Data, setAcceptedTermsAt]);

  const pendingRoute = useMemo(() => {
    if (!onboardingState) {
      return null;
    }

    // FIX: getOnboardingStatus returns phase2OnboardingCompleted, not nextStep
    // If Phase-2 onboarding is completed, redirect to Private Mode main screen
    if (onboardingState.phase2OnboardingCompleted) {
      return pathname === '/(main)/(private)/(tabs)/deep-connect'
        ? null
        : '/(main)/(private)/(tabs)/deep-connect';
    }

    // Phase-2 onboarding not completed - allow current flow without redirect
    // The individual screens handle their own navigation progression
    return null;
  }, [onboardingState, pathname]);

  useEffect(() => {
    if (!userId || !pendingRoute) {
      return;
    }

    const correctionKey = `${pathname}->${pendingRoute}`;
    if (routeCorrectionKeyRef.current === correctionKey) {
      return;
    }

    routeCorrectionKeyRef.current = correctionKey;
    router.replace(pendingRoute as any);
  }, [pathname, pendingRoute, router, userId]);

  const isLoading = !!userId && (
    currentUser === undefined ||
    currentPrivateProfile === undefined ||
    onboardingState === undefined
  );

  if (isLoading || !!pendingRoute) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Loading your Private Mode setup…</Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="select-photos" />
      <Stack.Screen name="profile-edit" />
      <Stack.Screen name="prompts" />
      <Stack.Screen name="profile-setup" />
    </Stack>
  );
}

export default function Phase2OnboardingLayout() {
  return (
    <Phase2ErrorBoundary>
      <Phase2OnboardingNavigator />
    </Phase2ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
  },
});
