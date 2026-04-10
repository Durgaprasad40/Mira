/*
 * PRIVATE AREA LAYOUT (Deep Connect / Phase-2)
 *
 * REWRITTEN: Clean phase isolation to prevent infinite loops
 *
 * KEY PRINCIPLE: Single derived routing decision via usePhaseMode
 * - All effects check phase mode FIRST before running
 * - beforeRemove ONLY intercepts true back gestures, NOT push navigation
 * - Navigation effects are guarded with refs to prevent double-firing
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, BackHandler, Platform } from 'react-native';
import { Stack, useRouter, useNavigation, usePathname, useSegments, useRootNavigationState } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
// REMOVED: setPhase2Active import - no longer toggling phase via module variable
// Notification phase is now derived directly from route in useNotifications
import { prewarmTodCache } from './(tabs)/truth-or-dare';
import { decideNextOnboardingRoute } from '@/lib/onboardingRouting';
import { useRouteTrace } from '@/lib/devTrace';
import { usePhaseMode, isSharedRoute } from '@/lib/usePhaseMode';

const C = INCOGNITO_COLORS;

// Minimum photos required for Phase-2 access
const MIN_PHOTOS_REQUIRED = 2;

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
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  // B1 FIX: Need hasHydrated early for phantom "/" normalization effect
  const hasHydrated = usePrivateProfileStore((s) => s._hasHydrated);

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE MODE: Single derived routing decision
  // - 'phase2': We're in a Phase 2 route - run Phase 2 effects
  // - 'shared': We're in a shared route (incognito-chat) - skip Phase 2 effects
  // - 'phase1': We're in Phase 1 - skip Phase 2 effects (shouldn't happen often)
  // - 'loading': Router not ready - wait
  // ══════════════════════════════════════════════════════════════════════════════
  const phaseMode = usePhaseMode();
  const isInPhase2 = phaseMode === 'phase2';
  // Stable segment check for effects that need it
  const segmentStrings = useMemo(() => segments as string[], [segments]);

  // PERF: Log mount time
  useEffect(() => {
    _privateLayoutMountTime = Date.now();
    if (__DEV__) {
      console.log('[PERF] PrivateLayout mounted', { t: _privateLayoutMountTime });
      // P0 ISOLATION DEBUG: Log when PrivateLayout mounts - should NEVER happen from Phase-1 Discover
      console.log('[P2_LAYOUT_MOUNT] PrivateLayout mounted', {
        pathname,
        segments: segmentStrings,
        phaseMode,
        warning: 'If you see this after P1_PROFILE_ROUTE, there is a routing isolation bug!',
      });
    }
  }, []);

  // Get the parent (main) stack navigator — beforeRemove fires here
  // when this screen is about to be popped from the (main) stack.
  const navigation = useNavigation();
  const isExitingRef = useRef(false);
  const exitResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back navigation guards (Android only)
  const lastBackAtRef = useRef(0);
  const isNavigatingRef = useRef(false);

  // CRASH FIX: Proper mount lifecycle tracking
  const didRedirectRef = useRef(false);
  const mountedRef = useRef(false);

  // B1 FIX: Track phantom "/" normalization state to show loading UI
  const [isNormalizingRoot, setIsNormalizingRoot] = useState(false);
  // PA-001 FIX: Single timeout ref for fallback (removed retryTimeoutRef to eliminate race)
  const normalizationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PA-001 FIX: Single navigation guard - tracks both trigger AND completion
  const didNormalizeRef = useRef(false);

  // B1.1 FIX: Add router readiness check
  const rootNavState = useRootNavigationState();

  // CRASH FIX: Track mount lifecycle
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // B3.2 FIX: Clear exit reset timeout on unmount
      if (exitResetTimeoutRef.current) {
        clearTimeout(exitResetTimeoutRef.current);
        exitResetTimeoutRef.current = null;
      }
    };
  }, []);

  // APP-P1-003 FIX: Auth guard - redirect unauthenticated users
  // PHASE GUARD: Only run when in Phase 2 (prevents navigation when on shared routes)
  useEffect(() => {
    if (!isInPhase2) return; // PHASE GUARD
    if (!mountedRef.current) return;
    if (didRedirectRef.current) return;
    if (isDemoMode) return; // Demo mode uses local state

    if (!userId) {
      didRedirectRef.current = true;
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        router.replace(PHASE1_DISCOVER_ROUTE);
      });
      return;
    }

    if (!hasHydrated) return;
  }, [userId, hasHydrated, router, isInPhase2]);

  // 🚨 CRITICAL: Collapse phantom "/" route inside Phase-2
  // Expo Router creates an implicit "/" entry before the real Phase-2 home.
  // This causes double back gestures. Normalize immediately to desire-land.
  // PA-001 FIX: Simplified to single deterministic path - eliminates race conditions
  useEffect(() => {
    // Wait for all preconditions before normalizing
    if (!hasHydrated) return;
    if (!mountedRef.current) return;
    if (!rootNavState?.key) return;

    const segmentStrings = segments as string[];
    const isPhantomRoot = pathname === '/' && segmentStrings.includes('(private)');
    if (!isPhantomRoot) return;

    // PA-001 FIX: Single guard prevents all redundant triggers
    if (didNormalizeRef.current) return;
    didNormalizeRef.current = true;
    setIsNormalizingRoot(true);

    // PA-001 FIX: Attempt immediate navigation (synchronous within effect)
    try {
      router.replace(PHASE2_HOME_ROUTE);
      setIsNormalizingRoot(false);
      if (__DEV__) console.log('[PrivateLayout] Phantom "/" normalized to Phase-2 home');
      return; // Success - no fallback needed
    } catch (error) {
      if (__DEV__) console.error('[PrivateLayout] Immediate normalization failed:', error);
      // Fall through to timeout fallback
    }

    // PA-001 FIX: Single fallback timeout (2s) - only runs if immediate navigation threw
    normalizationTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setIsNormalizingRoot(false);
      if (__DEV__) console.warn('[PrivateLayout] Normalization fallback - exiting to Phase-1');
      try {
        router.replace(PHASE1_DISCOVER_ROUTE);
      } catch (fallbackError) {
        if (__DEV__) console.error('[PrivateLayout] Fallback navigation failed:', fallbackError);
      }
    }, 2000);

    // PA-001 FIX: Guaranteed cleanup on unmount
    return () => {
      if (normalizationTimeoutRef.current) {
        clearTimeout(normalizationTimeoutRef.current);
        normalizationTimeoutRef.current = null;
      }
    };
  }, [pathname, segments, router, hasHydrated, rootNavState]);

  // REMOVED: Phase 2 isolation toggle (setPhase2Active)
  // This was causing infinite loops when navigating to shared routes.
  // Notification phase is now derived directly from route in useNotifications:
  // - 'phase2' routes → show Phase 2 notifications
  // - 'shared' routes → show Phase 2 notifications (user came from Phase 2)
  // - 'phase1' routes → show Phase 1 notifications

  const exitToHome = () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;

    // B3.2 FIX: Clear any existing timeout before starting new one
    if (exitResetTimeoutRef.current) {
      clearTimeout(exitResetTimeoutRef.current);
      exitResetTimeoutRef.current = null;
    }

    // B3-MEDIUM FIX: Wrap navigation in try/catch to prevent permanent lock on error
    try {
      // FIX: Use replace() instead of back() to exit in ONE action
      // back() caused double-swipe because of stacked route entries
      router.replace(PHASE1_DISCOVER_ROUTE);
    } catch (error) {
      if (__DEV__) console.error('[PrivateLayout] exitToHome navigation failed:', error);
      // On error, reset immediately so user can retry
      isExitingRef.current = false;
      return;
    }

    // B3.2 FIX: Failsafe timeout - reset ref after 2s if we haven't exited yet
    exitResetTimeoutRef.current = setTimeout(() => {
      if (__DEV__) console.warn('[PrivateLayout] Exit timeout - resetting guard');
      isExitingRef.current = false;
      exitResetTimeoutRef.current = null;
    }, 2000);
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // CRITICAL FIX: beforeRemove listener with proper navigation detection
  //
  // PROBLEM: The old listener intercepted ALL navigation that would remove Private,
  // including legitimate push navigation to shared routes like incognito-chat.
  //
  // SOLUTION: Only intercept actual back gestures (POP actions).
  // Allow PUSH/REPLACE navigation to proceed (e.g., navigating to incognito-chat).
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (isExitingRef.current) return; // prevent loop

      // Allow internal normalization navigation
      if (isNormalizingRoot) return;

      // Allow phantom root normalization
      const segmentStrings = segments as string[];
      if (pathname === '/' && segmentStrings.includes('(private)')) {
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // KEY FIX: Only intercept POP actions (back gestures/buttons)
      // Allow PUSH/REPLACE actions to proceed - these are legitimate forward navigation
      // to screens like incognito-chat, match-celebration, etc.
      // ═══════════════════════════════════════════════════════════════════════════
      const actionType = e.data?.action?.type;
      if (actionType !== 'POP' && actionType !== 'GO_BACK') {
        // This is a PUSH, REPLACE, or NAVIGATE action - allow it
        if (__DEV__) {
          console.log('[PrivateLayout] Allowing navigation action:', actionType);
        }
        return;
      }

      // This is a back gesture/button - redirect to Phase-1 home
      e.preventDefault();
      exitToHome();
    });
    return unsub;
  }, [navigation, router, isNormalizingRoot, pathname, segments]);

  // B3.2 FIX: Reset exit guard ONLY after we've actually left Private layout
  // Uses phaseMode for clean decision (not manual segment check)
  useEffect(() => {
    // If we're exiting and we've successfully left Private (now in phase1 or shared), reset the guard
    if (isExitingRef.current && !isInPhase2) {
      if (__DEV__) console.log('[PrivateLayout] Successfully exited - resetting guard');
      isExitingRef.current = false;
      // Clear the failsafe timeout since we exited successfully
      if (exitResetTimeoutRef.current) {
        clearTimeout(exitResetTimeoutRef.current);
        exitResetTimeoutRef.current = null;
      }
    }
  }, [isInPhase2]);

  // 2) Android hardware back — Phase-2 Tab-to-Tab Back Controller
  //    ONLY intercepts back on Phase-2 TAB ROOT screens.
  //    Nested screens (chat detail, modals, etc.) use normal back behavior.
  //
  //    Tab root behavior:
  //    - From any Phase-2 tab root (except desire-land) → go to desire-land
  //    - From desire-land → go to Phase-1 Discover
  //
  //    PHASE GUARD: Only registers handler when actually in Phase 2
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // PHASE GUARD: Use derived phaseMode instead of manual segment check
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
  }, [router, pathname, segmentStrings, isInPhase2]);

  // B1.1 FIX: Move ALL hooks before any conditional returns to fix "Rendered fewer hooks" error
  const isSetupComplete = usePrivateProfileStore((s) => s.isSetupComplete);
  const phase2OnboardingCompleted = usePrivateProfileStore((s) => s.phase2OnboardingCompleted);
  // B1 FIX: hasHydrated moved to top of component (line 49) for use in normalization effect

  // NOTE: Nav lock reset is handled ONLY by explicit exit actions (X button in onboarding)
  // No automatic segment-based or focus-based reset here to prevent double-entry bugs

  const convexPrivateProfile = useQuery(
    api.privateProfiles.getCurrentOnboardingProfile,
    !isDemoMode && token ? { token } : 'skip'
  );

  // PHASE-1 GUARD: Query Phase-1 onboarding status to block Phase-2 access if incomplete
  const phase1OnboardingStatus = useQuery(
    api.users.getOnboardingStatus,
    !isDemoMode && token ? { token } : 'skip'
  );

  // PREWARM: Start T/D queries early so data is cached when user opens T/D tab
  const prewarmPromptsData = useQuery(
    api.truthDare.listActivePromptsWithTop2Answers,
    !isDemoMode && token ? { token } : 'skip'
  );
  // P0 FIX: Prewarm token-authenticated trending data so blocked users stay filtered
  const prewarmTrendingData = useQuery(
    api.truthDare.getTrendingTruthAndDare,
    !isDemoMode && token ? { token } : 'skip'
  );

  // Push data into module-level cache as soon as it arrives
  useEffect(() => {
    if (prewarmPromptsData !== undefined || prewarmTrendingData !== undefined) {
      prewarmTodCache(prewarmPromptsData, prewarmTrendingData);
    }
  }, [prewarmPromptsData, prewarmTrendingData]);

  // ST-001 FIX: Hydrate privateProfileStore from Convex on app restart
  // This ensures Phase-2 profile state survives app restarts
  const hydrateFromConvex = usePrivateProfileStore((s) => s.hydrateFromConvex);
  useEffect(() => {
    // PHASE GUARD: Only hydrate when in Phase 2 (skip on shared routes)
    if (!isInPhase2) return;
    // Skip in demo mode (uses local demo data)
    if (isDemoMode) return;
    // Wait for query to complete (undefined = loading, null = no profile)
    if (convexPrivateProfile === undefined) return;
    // Hydrate store with Convex profile (or null if no profile)
    hydrateFromConvex(convexPrivateProfile);
  }, [convexPrivateProfile, hydrateFromConvex, isInPhase2]);

  // B1.1 FIX: Compute onboarding state BEFORE any returns (was after early returns before)
  // Check if Phase-2 onboarding has been completed (permanent flag)
  // This runs ONE TIME ONLY - after completion, onboarding never shows again
  // P2-002 FIX: Use OR logic so local completion is respected even if Convex hasn't synced yet
  // This prevents re-triggering onboarding when server returns false due to sync lag
  // STABILITY FIX: Now also checks users.phase2OnboardingCompleted from getOnboardingStatus
  // Priority: local store (instant) || users table (durable)
  const onboardingComplete = isDemoMode
    ? phase2OnboardingCompleted
    : (
        phase2OnboardingCompleted ||
        phase1OnboardingStatus?.phase2OnboardingCompleted === true
      );

  // ══════════════════════════════════════════════════════════════════════════════
  // ROUTE TRACE: Only emit when actually in Phase 2 (skip shared routes)
  // This reduces log spam and render overhead on shared routes like incognito-chat
  // ══════════════════════════════════════════════════════════════════════════════
  useRouteTrace(isInPhase2 ? "P2_PRIVATE" : "SKIP", useCallback(() => ({
    userId: userId?.substring(0, 8) ?? null,
    phaseMode,
    phase2OnboardingCompleted_local: !!phase2OnboardingCompleted,
    phase2OnboardingCompleted_backend: phase1OnboardingStatus?.phase2OnboardingCompleted ?? null,
    privateWelcomeConfirmed_backend: phase1OnboardingStatus?.privateWelcomeConfirmed ?? null,
    faceStatus: phase1OnboardingStatus?.faceVerificationStatus ?? null,
    normalPhotoCount: phase1OnboardingStatus?.normalPhotoCount ?? null,
    onboardingComplete,
    isDemoMode,
  }), [userId, phaseMode, phase2OnboardingCompleted, phase1OnboardingStatus, onboardingComplete]));

  // PHASE-1 GUARD: Redirect to Phase-1 onboarding if incomplete
  // This check happens BEFORE Phase-2 onboarding check
  // STABILITY FIX: Skip guard entirely if Phase-2 is already complete
  // PHASE GUARD: Only run when in Phase 2 (prevents navigation when on shared routes)
  useEffect(() => {
    if (!isInPhase2) return; // PHASE GUARD
    if (!mountedRef.current) return;
    if (didRedirectRef.current) return;
    if (!hasHydrated) return;
    if (isDemoMode) return; // Skip guard in demo mode
    if (onboardingComplete) return; // Skip if Phase-2 already complete
    if (!phase1OnboardingStatus) return; // Wait for query to load

    // Check Phase-1 onboarding requirements
    // Allow 'verified' OR 'pending' (users can proceed while manual review is pending)
    const isPhase1Complete =
      phase1OnboardingStatus.onboardingCompleted === true &&
      (
        phase1OnboardingStatus.faceVerificationStatus === 'verified' ||
        phase1OnboardingStatus.faceVerificationStatus === 'pending'
      ) &&
      phase1OnboardingStatus.normalPhotoCount >= MIN_PHOTOS_REQUIRED;

    if (__DEV__) {
      console.log('[PRIVATE_GUARD]', {
        onboardingCompleted: phase1OnboardingStatus.onboardingCompleted,
        faceStatus: phase1OnboardingStatus.faceVerificationStatus,
        normalPhotoCount: phase1OnboardingStatus.normalPhotoCount,
        action: isPhase1Complete ? 'allow_private' : 'redirect_to_onboarding',
      });
    }

    if (!isPhase1Complete) {
      didRedirectRef.current = true;
      // Redirect to appropriate onboarding step
      const nextRoute = decideNextOnboardingRoute(phase1OnboardingStatus);
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        router.replace(nextRoute as any);
      });
    }
  }, [phase1OnboardingStatus, hasHydrated, router, onboardingComplete, isInPhase2]);

  // CRASH FIX: Single-pass redirect with proper lifecycle checks
  // Uses requestAnimationFrame to ensure previous screen is fully unmounted
  // PHASE GUARD: Only run when in Phase 2 (prevents navigation when on shared routes)
  useEffect(() => {
    if (!isInPhase2) return; // PHASE GUARD
    if (!mountedRef.current) return;
    if (didRedirectRef.current) return;
    if (!hasHydrated) return; // Wait for hydration
    // STABILITY FIX: Wait for backend query before checking onboardingComplete
    // This prevents premature redirect when local store is false but backend is true
    // (local store is in-memory only, so phase2OnboardingCompleted resets to false on app restart)
    if (!isDemoMode && !phase1OnboardingStatus) return;

    if (!onboardingComplete) {
      didRedirectRef.current = true;
      requestAnimationFrame(() => {
        if (!mountedRef.current) return; // Guard against unmount during frame delay
        router.replace('/(main)/phase2-onboarding' as any);
      });
    }
  }, [onboardingComplete, hasHydrated, router, phase1OnboardingStatus, isInPhase2]);

  if (!hasHydrated) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  // B3.4 FIX: For phantom "/" normalization, render null (no spinner flash)
  // This reduces the visible loading flash during Phase-2 entry
  if (isNormalizingRoot) {
    return null;
  }

  // B1.1 FIX: FLASH FIX - Render null while redirecting to avoid visual flash
  // The tab press handler routes directly to onboarding, so this is just a safety net
  if (!onboardingComplete) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="p2-profile/[userId]" />
      <Stack.Screen name="phase2-likes" />
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
