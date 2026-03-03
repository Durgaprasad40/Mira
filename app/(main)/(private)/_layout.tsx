import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, BackHandler, Platform } from 'react-native';
import { Stack, useRouter, useNavigation, usePathname, useSegments, useRootNavigationState } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useIncognitoStore } from '@/stores/incognitoStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { PrivateConsentGate } from '@/components/private/PrivateConsentGate';
import { setPhase2Active } from '@/hooks/useNotifications';
import { prewarmTodCache } from './(tabs)/truth-or-dare';

const C = INCOGNITO_COLORS;

// Phase-2 Back Navigation Constants
const PHASE2_HOME_ROUTE = '/(main)/(private)/(tabs)/desire-land';
const PHASE1_DISCOVER_ROUTE = '/(main)/(tabs)/home';

// Phase-2 tab root screens (BackGuard ONLY intercepts on these)
// Nested screens (chat detail, etc.) use normal back behavior
const PHASE2_TAB_ROOTS = new Set([
  'desire-land',
  'chats',
  'chat-rooms',
  'truth-or-dare',
  'private-profile',
  'confess',
  'rooms',
]);

// PERF: Track mount time for latency measurement
let _privateLayoutMountTime = 0;

export default function PrivateLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const ageConfirmed18Plus = useIncognitoStore((s) => s.ageConfirmed18Plus);
  const acceptPrivateTerms = useIncognitoStore((s) => s.acceptPrivateTerms);
  // H-001/C-001 FIX: Wait for incognito store hydration before checking consent
  const incognitoHydrated = useIncognitoStore((s) => s._hasHydrated);
  const userId = useAuthStore((s) => s.userId);
  // B1 FIX: Need hasHydrated early for phantom "/" normalization effect
  const hasHydrated = usePrivateProfileStore((s) => s._hasHydrated);

  // PERF: Log mount time
  useEffect(() => {
    _privateLayoutMountTime = Date.now();
    if (__DEV__) console.log('[PERF] PrivateLayout mounted', { t: _privateLayoutMountTime });
  }, []);

  // Get the parent (main) stack navigator — beforeRemove fires here
  // when this screen is about to be popped from the (main) stack.
  const navigation = useNavigation();
  const isExitingRef = useRef(false);

  // Back navigation guards (Android only)
  const lastBackAtRef = useRef(0);
  const isNavigatingRef = useRef(false);

  // CRASH FIX: Proper mount lifecycle tracking
  const didRedirectRef = useRef(false);
  const mountedRef = useRef(false);

  // B1 FIX: Track phantom "/" normalization state to show loading UI
  const [isNormalizingRoot, setIsNormalizingRoot] = useState(false);
  const normalizationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // B1.1 FIX: Add router readiness check
  const rootNavState = useRootNavigationState();

  // CRASH FIX: Track mount lifecycle
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 🚨 CRITICAL: Collapse phantom "/" route inside Phase-2
  // Expo Router creates an implicit "/" entry before the real Phase-2 home.
  // This causes double back gestures. Normalize immediately to desire-land.
  // B1 FIX: Added hydration check, try/catch, and timeout fallback for safety
  // B1.1 FIX: Added router readiness check to prevent "navigate before root layout" error
  useEffect(() => {
    // B1 FIX: Wait for hydration before normalizing to prevent blank screen
    if (!hasHydrated) return;
    if (!mountedRef.current) return;
    // B1.1 FIX: Wait for router to be ready before navigating
    if (!rootNavState?.key) return;

    const segmentStrings = segments as string[];
    if (pathname === '/' && segmentStrings.includes('(private)')) {
      setIsNormalizingRoot(true);

      // B1.1 FIX: Timeout fallback - escape to Phase-1 if normalization fails (2s)
      // Uses safer setTimeout for navigation with router readiness check
      normalizationTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        // B1.1 FIX: Check router readiness in fallback too
        if (!rootNavState?.key) {
          if (__DEV__) console.warn('[PrivateLayout] Timeout fallback: router not ready, retrying...');
          // Retry once after brief delay
          setTimeout(() => {
            if (rootNavState?.key) {
              setIsNormalizingRoot(false);
              router.replace(PHASE1_DISCOVER_ROUTE);
            }
          }, 250);
          return;
        }
        if (__DEV__) console.warn('[PrivateLayout] Phantom root normalization timeout - exiting to Phase-1');
        setIsNormalizingRoot(false);
        router.replace(PHASE1_DISCOVER_ROUTE);
      }, 2000);

      // B1.1 FIX: Use setTimeout instead of requestAnimationFrame for safer scheduling
      setTimeout(() => {
        if (!mountedRef.current) return;
        // B1.1 FIX: Double-check router readiness before navigating
        if (!rootNavState?.key) {
          if (__DEV__) console.warn('[PrivateLayout] Router not ready for normalization');
          return;
        }

        // B1 FIX: Try/catch for safe navigation
        try {
          router.replace(PHASE2_HOME_ROUTE);
          setIsNormalizingRoot(false);
          if (normalizationTimeoutRef.current) {
            clearTimeout(normalizationTimeoutRef.current);
            normalizationTimeoutRef.current = null;
          }
        } catch (error) {
          if (__DEV__) console.error('[PrivateLayout] Phantom root normalization failed:', error);
          setIsNormalizingRoot(false);
          // Timeout will handle fallback navigation
        }
      }, 0);
    }

    // B1 FIX: Cleanup timeout on unmount
    return () => {
      if (normalizationTimeoutRef.current) {
        clearTimeout(normalizationTimeoutRef.current);
        normalizationTimeoutRef.current = null;
      }
    };
  }, [pathname, segments, router, hasHydrated, rootNavState]);

  // Phase 2 isolation: Set module-level flag to block Phase 1-only notifications
  useEffect(() => {
    setPhase2Active(true);
    return () => setPhase2Active(false);
  }, []);

  const exitToHome = () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    // FIX: Use replace() instead of back() to exit in ONE action
    // back() caused double-swipe because of stacked route entries
    router.replace(PHASE1_DISCOVER_ROUTE);
  };

  // 1) Intercept any navigation that would remove Private from the stack
  //    (iOS swipe-back, header back, programmatic back). Navigate back
  //    so Private is removed without remounting the tab navigator.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (isExitingRef.current) return; // prevent loop
      e.preventDefault();
      exitToHome();
    });
    return unsub;
  }, [navigation, router]);

  // 2) Android hardware back — Phase-2 Tab-to-Tab Back Controller
  //    ONLY intercepts back on Phase-2 TAB ROOT screens.
  //    Nested screens (chat detail, modals, etc.) use normal back behavior.
  //
  //    Tab root behavior:
  //    - From any Phase-2 tab root (except desire-land) → go to desire-land
  //    - From desire-land → go to Phase-1 Discover
  //
  //    Note: segments/pathname are captured in closure; useEffect re-registers handler when they change.
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // Verify we're actually inside Phase-2 using segments
    const segmentStrings = segments as string[];
    const isInPhase2 = segmentStrings.includes('(private)');
    if (!isInPhase2) return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Get the last segment to check if we're on a tab root
      const lastSegment = segmentStrings[segmentStrings.length - 1];
      const isOnPhase2TabRoot = PHASE2_TAB_ROOTS.has(lastSegment);

      // If NOT on a tab root (e.g., chat detail, nested screen), let normal back happen
      if (!isOnPhase2TabRoot) {
        return false; // Let native/router handle it
      }

      const now = Date.now();

      // Debounce: ignore rapid back presses (< 600ms apart)
      if (now - lastBackAtRef.current < 600) {
        return true; // Consume but don't act
      }

      // Transition lock: ignore if already navigating
      if (isNavigatingRef.current) {
        return true; // Consume but don't act
      }

      // Determine target based on current tab root
      const isOnPhase2Home = lastSegment === 'desire-land';
      const targetRoute = isOnPhase2Home ? PHASE1_DISCOVER_ROUTE : PHASE2_HOME_ROUTE;

      // Prevent redundant navigation to same route
      if (pathname === targetRoute) {
        return true; // Consume but don't act
      }

      // Set locks
      lastBackAtRef.current = now;
      isNavigatingRef.current = true;

      // Navigate using replace() for tab-to-tab (no extra stack entries)
      router.replace(targetRoute);

      // Release transition lock after navigation settles
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 400);

      return true; // We handled it
    });

    return () => handler.remove();
  }, [router, pathname, segments]);

  // B1.1 FIX: Move ALL hooks before any conditional returns to fix "Rendered fewer hooks" error
  const isSetupComplete = usePrivateProfileStore((s) => s.isSetupComplete);
  const phase2OnboardingCompleted = usePrivateProfileStore((s) => s.phase2OnboardingCompleted);
  // B1 FIX: hasHydrated moved to top of component (line 49) for use in normalization effect

  // NOTE: Nav lock reset is handled ONLY by explicit exit actions (X button in onboarding)
  // No automatic segment-based or focus-based reset here to prevent double-entry bugs

  const convexPrivateProfile = useQuery(
    api.privateProfiles.getByUserId,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  // PREWARM: Start T/D queries early so data is cached when user opens T/D tab
  const prewarmPromptsData = useQuery(
    api.truthDare.listActivePromptsWithTop2Answers,
    { viewerUserId: userId ?? undefined }
  );
  const prewarmTrendingData = useQuery(api.truthDare.getTrendingTruthAndDare);

  // Push data into module-level cache as soon as it arrives
  useEffect(() => {
    if (prewarmPromptsData !== undefined || prewarmTrendingData !== undefined) {
      prewarmTodCache(prewarmPromptsData, prewarmTrendingData);
    }
  }, [prewarmPromptsData, prewarmTrendingData]);

  // B1.1 FIX: Compute onboarding state BEFORE any returns (was after early returns before)
  // Check if Phase-2 onboarding has been completed (permanent flag)
  // This runs ONE TIME ONLY - after completion, onboarding never shows again
  // P2-002 FIX: Use OR logic so local completion is respected even if Convex hasn't synced yet
  // This prevents re-triggering onboarding when server returns false due to sync lag
  const onboardingComplete = isDemoMode
    ? phase2OnboardingCompleted
    : (phase2OnboardingCompleted || convexPrivateProfile?.isSetupComplete === true);

  // CRASH FIX: Single-pass redirect with proper lifecycle checks
  // Uses requestAnimationFrame to ensure previous screen is fully unmounted
  useEffect(() => {
    if (!mountedRef.current) return;
    if (didRedirectRef.current) return;
    if (!hasHydrated) return; // Wait for hydration

    if (!onboardingComplete) {
      didRedirectRef.current = true;
      requestAnimationFrame(() => {
        if (!mountedRef.current) return; // Guard against unmount during frame delay
        router.replace('/(main)/phase2-onboarding' as any);
      });
    }
  }, [onboardingComplete, hasHydrated, router]);

  // B1.1 FIX: ALL hooks must be called before any conditional returns
  // Compute blocking spinner condition as a boolean
  const shouldShowBlockingSpinner = !incognitoHydrated || !hasHydrated || isNormalizingRoot;

  // B1.1 FIX: Conditional rendering moved to END after ALL hooks
  // H-001/C-001 FIX: Wait for incognito store hydration before checking consent
  // Prevents showing consent gate to already-consented users on cold start
  if (!incognitoHydrated || !hasHydrated || isNormalizingRoot) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  // B1.1 FIX: Consent gate (checked after spinner check above)
  if (!ageConfirmed18Plus) {
    return <PrivateConsentGate onAccept={acceptPrivateTerms} />;
  }

  // B1.1 FIX: FLASH FIX - Render null while redirecting to avoid visual flash
  // The tab press handler routes directly to onboarding, so this is just a safety net
  if (!onboardingComplete) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  setupPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  setupTitle: { fontSize: 26, fontWeight: '700', color: C.text, textAlign: 'center', marginTop: 16, marginBottom: 8 },
  setupSubtitle: { fontSize: 15, color: C.textLight, textAlign: 'center', marginBottom: 24 },
  setupBtn: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16,
    paddingHorizontal: 32, alignItems: 'center',
  },
  setupBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
