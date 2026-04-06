import { useEffect, useRef, useState, useCallback } from "react";
import { AppState, AppStateStatus, LogBox } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";

// P0-1 STABILITY FIX: Import Sentry for crash reporting
import { initSentry, captureException, setUserContext, clearUserContext } from "@/lib/sentry";

// Initialize Sentry FIRST, before any other code runs
// This ensures we catch errors during app initialization
initSentry();

// Suppress known dev-mode warning: Expo's withDevTools calls useKeepAwake() which can fail
// on Android before activity is ready. This is non-critical (screen may sleep during dev).
if (__DEV__) {
  LogBox.ignoreLogs(["Unable to activate keep awake"]);

  // Also patch console.error to suppress keep-awake messages at the console level
  // This catches errors that appear before ErrorUtils handlers are invoked
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const message = args[0]?.toString?.() || '';
    if (message.includes('Unable to activate keep awake') ||
        message.includes('keep awake') ||
        message.includes('keepAwake')) {
      // Silently suppress - this is expected during lifecycle transitions
      return;
    }
    originalConsoleError.apply(console, args);
  };
}

// P0-1 STABILITY FIX: Global error handlers with Sentry integration
// Set up ONCE at module load, before React renders
(() => {
  // Catch synchronous errors via ErrorUtils
  const originalHandler = (global as any).ErrorUtils?.getGlobalHandler?.();
  if ((global as any).ErrorUtils?.setGlobalHandler) {
    (global as any).ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      // Suppress keep-awake errors (non-fatal, dev-only)
      if (error?.message?.includes("Unable to activate keep awake")) {
        if (__DEV__) {
          console.warn("[KeepAwake] Activation failed (non-critical in dev mode)");
        }
        return;
      }

      // P0-1: Send to Sentry before forwarding to original handler
      captureException(error, {
        tags: {
          type: 'global_error',
          fatal: String(isFatal ?? false),
        },
        level: isFatal ? 'fatal' : 'error',
      });

      // Forward all other errors to original handler
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });
  }

  // Catch unhandled promise rejections
  // React Native uses 'promise/setimmediate/rejection-tracking' internally
  try {
    const rejectionTracking = require('promise/setimmediate/rejection-tracking');
    rejectionTracking.enable({
      allRejections: true,
      onUnhandled: (id: number, error: Error) => {
        if (error?.message?.includes("Unable to activate keep awake")) {
          if (__DEV__) {
            console.warn("[KeepAwake] Async activation failed (non-critical in dev mode)");
          }
          return; // Suppress - do not forward
        }

        // P0-1: Send unhandled promise rejections to Sentry
        captureException(error, {
          tags: {
            type: 'unhandled_promise_rejection',
            rejectionId: String(id),
          },
          level: 'error',
        });

        // Forward other rejections to default handling
        const handler = (global as any).ErrorUtils?.getGlobalHandler?.();
        if (handler) {
          handler(error, false);
        }
      },
      onHandled: () => {
        // Rejection was handled later - do nothing
      },
    });
  } catch {
    // rejection-tracking not available - rely on ErrorUtils handler above
  }
})()
import { ConvexProvider, useMutation, useQuery } from "convex/react";
import { convex, isDemoMode } from "@/hooks/useConvex";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useDemoStore } from "@/stores/demoStore";
import { useBootStore } from "@/stores/bootStore";
import { BootScreen } from "@/components/BootScreen";
import { collectDeviceFingerprint } from "@/lib/deviceFingerprint";
import { markTiming } from "@/utils/startupTiming";
import { autoSyncPhotosOnStartup } from "@/services/photoSync";
import { checkAndHandleResetEpoch } from "@/lib/resetEpochCheck";
import { startBackgroundLocation } from "@/utils/backgroundLocation";
import { usePresenceAndLocation } from "@/hooks/usePresenceAndLocation";
import { Toast } from "@/components/ui/Toast";
import { safePush } from "@/lib/safeRouter";
import { asUserId } from "@/convex/id";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { log } from "@/utils/logger";

// ══════════════════════════════════════════════════════════════════════════════
// STARTUP LOG: Visible in adb logcat even in standalone APK
// ══════════════════════════════════════════════════════════════════════════════
log.info('[APP]', '═══════════════════════════════════════════════════');
log.info('[APP]', 'Mira app starting', { env: __DEV__ ? 'DEV' : 'PROD' });
log.info('[APP]', '═══════════════════════════════════════════════════');

/**
 * ResetEpochChecker - Clears stale demo caches on database reset (non-blocking)
 *
 * SAFE BEHAVIOR:
 * - Does NOT logout users
 * - Does NOT clear auth or onboarding state
 * - Only clears demo-related stores
 * - Runs asynchronously, does not block UI render
 *
 * This prevents bugs where:
 * - Demo users/messages still appear after demo mode disabled
 * - Stale demo data shows despite backend changes
 */
function ResetEpochChecker() {
  const hasCheckedRef = useRef(false);

  // Fetch current reset epoch from server
  const serverResetEpoch = useQuery(api.system.getResetEpoch, {});

  useEffect(() => {
    // Wait for server epoch to load
    if (serverResetEpoch === undefined) return;

    // Only check once per app launch
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    // NON-BLOCKING: Run async without awaiting - don't delay UI
    checkAndHandleResetEpoch(serverResetEpoch)
      .then((didClear) => {
        if (didClear) {
          console.log('[RESET_EPOCH] Demo caches cleared (no logout, no navigation)');
        }
      })
      .catch((error) => {
        console.error('[RESET_EPOCH] Error during reset epoch check:', error);
      });
  }, [serverResetEpoch]);

  return null;
}

function DemoBanner() {
  return null;
}

/**
 * BootStateTracker - Syncs hydration states to bootStore
 *
 * SAFETY:
 * - READ-ONLY: Only reads from authStore/demoStore, writes to bootStore
 * - Does NOT modify any user data, auth state, or messages
 * - Does NOT affect onboarding completion status
 */
function BootStateTracker() {
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const setAuthHydrated = useBootStore((s) => s.setAuthHydrated);
  const setDemoHydrated = useBootStore((s) => s.setDemoHydrated);

  // Sync auth hydration state
  useEffect(() => {
    setAuthHydrated(authHydrated);
  }, [authHydrated, setAuthHydrated]);

  // Sync demo hydration state (or mark as ready if not in demo mode)
  useEffect(() => {
    // In live mode, demo hydration is always "ready"
    // In demo mode, wait for actual hydration
    const ready = isDemoMode ? demoHydrated : true;
    setDemoHydrated(ready);
  }, [demoHydrated, setDemoHydrated]);

  return null;
}

/**
 * BootScreenWrapper - Shows boot screen until app is ready
 *
 * FAST BOOT STRATEGY:
 * - Hide BootScreen after 250ms from app start (module load time)
 * - Does NOT wait for hydration - Index.tsx handles that with inline loading
 * - Module-level timestamp ensures consistent timing across re-renders
 *
 * SAFETY:
 * - Does NOT modify any user data, auth state, or messages
 * - Pure UI gating only
 */
const BOOT_MIN_TIME_MS = 250;

// Module-level timestamp: captured when this file loads (same as bundle start)
const BOOT_START_TIME = Date.now();

// Module-level flag to prevent double-marking
let _hasMarkedBootHidden = false;

function BootScreenWrapper() {
  const routeDecisionMade = useBootStore((s) => s.routeDecisionMade);
  const authHydrated = useBootStore((s) => s.authHydrated);
  const demoHydrated = useBootStore((s) => s.demoHydrated);
  const reset = useBootStore((s) => s.reset);
  const [, forceUpdate] = useState(0);
  const timerStarted = useRef(false);

  // Calculate elapsed time from module load (not component mount)
  const elapsedMs = Date.now() - BOOT_START_TIME;
  const minTimeElapsed = elapsedMs >= BOOT_MIN_TIME_MS;

  // Start a timer to trigger re-render when 250ms elapses (if not already elapsed)
  useEffect(() => {
    if (minTimeElapsed || timerStarted.current) return;
    timerStarted.current = true;

    const remainingMs = BOOT_MIN_TIME_MS - elapsedMs;
    const timer = setTimeout(() => {
      forceUpdate((n) => n + 1); // Trigger re-render to check elapsed time
    }, Math.max(0, remainingMs));

    return () => clearTimeout(timer);
  }, [minTimeElapsed, elapsedMs]);

  // Hide when: minimum time passed AND hydration complete (safety timeout in bootStore guarantees resolution)
  const isReady = (minTimeElapsed || routeDecisionMade) && authHydrated && demoHydrated;

  // Mark boot_hidden timing milestone once (module-level guard)
  if (isReady && !_hasMarkedBootHidden) {
    _hasMarkedBootHidden = true;
    markTiming('boot_hidden');
  }

  const handleRetry = () => {
    reset();
  };

  return <BootScreen isReady={isReady} onRetry={handleRetry} />;
}

/**
 * 3A1-1: Validate session on app launch AND resume
 *
 * HYDRATION FLOW:
 * 1. On mount: Validate session token against server
 * 2. On app resume: Re-validate session
 * 3. If invalid: Clear LOCAL token only, navigate to login
 * 4. If valid: Sync onboarding state from server (READ-ONLY)
 *
 * SAFETY:
 * - Uses validateSessionFull for detailed error reasons
 * - NEVER modifies server data
 * - NEVER resets onboarding (syncs FROM server, never overwrites)
 * - logout() clears LOCAL state only
 */
function SessionValidator() {
  const router = useRouter();
  const segments = useSegments();
  const token = useAuthStore((s) => s.token);
  // M2 FIX: Normalized token check - empty string and whitespace-only are invalid
  const hasValidToken = typeof token === 'string' && token.trim().length > 0;
  const userId = useAuthStore((s) => s.userId); // TASK D: Get userId for demo migration detection
  const logout = useAuthStore((s) => s.logout);
  const syncFromServerValidation = useAuthStore((s) => s.syncFromServerValidation);
  const setSessionValidated = useAuthStore((s) => s.setSessionValidated);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isValidatingRef = useRef(false);
  const hasInitialValidation = useRef(false);
  // M1 FIX: State to force query re-subscription on app resume
  const [sessionRefreshTrigger, setSessionRefreshTrigger] = useState(false);
  // M1 FIX: Timer ref for cleanup of refresh re-enable
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // STABILITY FIX: C-16 - Track mounted state to prevent navigation/setState after unmount
  const mountedRef = useRef(true);

  // STABILITY FIX: C-16 - Track mounted state
  // M1 FIX: Clean up refresh timer on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // Use Convex query to validate session with FULL checks
  // validateSessionFull checks: expiry, revocation, user status, deletedAt
  // M2 FIX: Use hasValidToken to skip query for empty/whitespace tokens
  // M1 FIX: sessionRefreshTrigger gates query to force re-subscription on app resume
  const sessionStatus = useQuery(
    api.auth.validateSessionFull,
    sessionRefreshTrigger ? 'skip' : (!isDemoMode && hasValidToken ? { token } : 'skip')
  );

  // Handle session validation result
  useEffect(() => {
    // M2 FIX: Use hasValidToken for early return; only mark validated if token is truly null
    if (isDemoMode || !hasValidToken) {
      // Only mark as validated if token is truly absent (null), not empty/whitespace
      if (token === null) {
        setSessionValidated(true);
      }
      // For empty/whitespace token: don't mark as validated, don't run query
      // This leaves session in unvalidated state, which will prevent protected routes
      return;
    }
    if (sessionStatus === undefined) return; // Still loading

    // Mark validation as complete
    hasInitialValidation.current = true;

    if (sessionStatus.valid) {
      // STABILITY FIX: C-16 - Guard state operations after unmount
      if (!mountedRef.current) return;

      // Session is valid — sync onboarding state from server
      // SAFETY: This only updates LOCAL state, never modifies server
      if (sessionStatus.userInfo) {
        syncFromServerValidation({
          onboardingCompleted: sessionStatus.userInfo.onboardingCompleted,
          isVerified: sessionStatus.userInfo.isVerified,
          name: sessionStatus.userInfo.name,
        });
      }
      setSessionValidated(true);

      // P0-1 STABILITY FIX: Attach user context to Sentry for error attribution
      if (userId) {
        setUserContext(userId, {
          onboardingCompleted: sessionStatus.userInfo?.onboardingCompleted,
        });
      }
    } else {
      // Session is invalid
      console.warn(`[SessionValidator] Session invalid: ${sessionStatus.reason}`);

      // TASK D: Handle demo user migration case
      // When user switches from demo mode to production mode, they have a demo userId
      // but no backend session record. This is EXPECTED - don't force logout.
      // PhotoSyncManager's ensureCurrentUser will create the user record.
      const isDemoUserMigration = userId?.startsWith('demo_') && sessionStatus.reason === 'session_not_found';

      if (isDemoUserMigration) {
        if (__DEV__) {
          console.log('[SessionValidator] Demo user migration detected - skipping logout, user will be bootstrapped');
        }
        // Mark as validated (non-fatal for demo migration)
        // The ensureCurrentUser mutation will create the user record
        setSessionValidated(true);
        return;
      }

      // STABILITY FIX: C-16 - Guard navigation and state operations after unmount
      if (!mountedRef.current) return;

      // For non-migration cases (truly invalid sessions), proceed with logout
      // STABILITY FIX: Wrap in async IIFE to properly await logout before navigation
      (async () => {
        // P0-1 STABILITY FIX: Clear Sentry user context on logout
        clearUserContext();

        // Clear all LOCAL state (server data untouched)
        await logout();
        useOnboardingStore.getState().reset();
        if (isDemoMode) {
          useDemoStore.getState().demoLogout();
        }

        // Guard: check mounted again after async operation
        if (!mountedRef.current) return;

        setSessionValidated(false, sessionStatus.reason);

        // Navigate to login (only if currently in main/protected area)
        const inProtectedRoute = segments[0] === '(main)';
        if (inProtectedRoute) {
          router.replace('/(auth)/welcome');
        }
      })();
    }
  }, [sessionStatus, token, userId, logout, syncFromServerValidation, setSessionValidated, router, segments]);

  // Validate on app resume
  useEffect(() => {
    if (isDemoMode) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // If app was in background and is now active
      // M2 FIX: Use hasValidToken to skip resume validation for empty/whitespace tokens
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        hasValidToken &&
        !isValidatingRef.current
      ) {
        // M1 FIX: Force query re-subscription by cycling through skip -> active
        // Clear any pending re-enable timer
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }
        // Temporarily skip query
        setSessionRefreshTrigger(true);
        // Re-enable on next tick to force re-subscription
        refreshTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            setSessionRefreshTrigger(false);
          }
        }, 0);

        // Debounce: prevent rapid repeated refresh triggers
        isValidatingRef.current = true;
        setTimeout(() => {
          isValidatingRef.current = false;
        }, 2000);
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [token]);

  return null;
}

/**
 * TASK 3: Photo sync manager - Auto-sync photos from backend on app startup
 *
 * BACKEND-FIRST STORAGE:
 * - Convex backend is the SOURCE OF TRUTH for profile photos
 * - On app startup (after hydration), sync photos FROM backend TO local stores
 * - Downloads missing files to local cache
 * - ONE-WAY sync: backend → local (never local → backend)
 *
 * SAFETY:
 * - READ-ONLY: Only reads from backend, writes to local cache
 * - Does NOT upload or modify backend data
 * - Runs AFTER hydration completes
 *
 * P2 STABILITY:
 * - Uses _hasHydrated for Convex hydration readiness
 * - Adds 10s timeout fallback to prevent infinite wait if hydration hangs
 */
// P2 STABILITY: Hydration timeout constant
const HYDRATION_TIMEOUT_MS = 10000;

function PhotoSyncManager() {
  const userId = useAuthStore((s) => s.userId);
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  // P2 STABILITY FIX: Use _hasHydrated for Convex hydration readiness
  const convexHydrated = useOnboardingStore((s) => s._hasHydrated);
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const hasSyncedRef = useRef(false);
  const hasEnsuredUserRef = useRef<string | null>(null);
  // P2 STABILITY: Track hydration timeout
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false);
  const ensureUser = useMutation(api.users.ensureCurrentUser);

  // TASK C: Bootstrap - Ensure Convex user record exists BEFORE any queries run
  // This prevents "Cannot create user from query context" errors
  useEffect(() => {
    // Only in production mode (not demo)
    if (isDemoMode) return;

    // Wait for auth hydration
    if (!authHydrated || !userId) return;

    // Only run once per userId (prevent duplicate calls on re-renders)
    if (hasEnsuredUserRef.current === userId) return;
    hasEnsuredUserRef.current = userId;

    // Call ensureCurrentUser mutation to create user record if missing
    (async () => {
      try {
        if (__DEV__) console.log('[BOOTSTRAP] Ensuring Convex user exists for:', userId);
        const result = await ensureUser({ authUserId: userId });
        if (__DEV__) console.log('[BOOTSTRAP] User ensured, convexUserId:', result.userId);
        // Note: result.userId is the Convex Id<"users"> for this authUserId
        // We could optionally store it in authStore, but not needed since
        // all queries/mutations handle the mapping automatically
      } catch (error: any) {
        console.error('[BOOTSTRAP] Failed to ensure user:', error.message);
        // Non-fatal: queries will handle missing user gracefully
      }
    })();
  }, [userId, authHydrated, ensureUser]);

  // P2 STABILITY: Hydration timeout fallback - don't wait forever
  useEffect(() => {
    // Only set timeout if not already hydrated and not in demo mode
    if (isDemoMode || convexHydrated || hydrationTimedOut) return;

    const timer = setTimeout(() => {
      if (!useOnboardingStore.getState()._hasHydrated) {
        console.warn('[PHOTO_SYNC] Convex hydration timeout after', HYDRATION_TIMEOUT_MS, 'ms - proceeding anyway');
        setHydrationTimedOut(true);
      }
    }, HYDRATION_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [convexHydrated, hydrationTimedOut]);

  useEffect(() => {
    // Wait for all stores to hydrate
    // P2 STABILITY FIX: Use convexHydrated (or timeout) instead of legacy _hasHydrated
    const onboardingReady = isDemoMode || convexHydrated || hydrationTimedOut;
    if (!authHydrated || !onboardingReady || !demoHydrated) return;

    // Only sync once
    if (hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    // Run auto-sync
    if (userId) {
      autoSyncPhotosOnStartup(userId);
    }
  }, [userId, authHydrated, convexHydrated, demoHydrated, hydrationTimedOut]);

  return null;
}

/**
 * Onboarding Draft Hydrator - Restore incomplete onboarding progress
 *
 * BACKEND-FIRST PERSISTENCE:
 * - Convex backend is the SOURCE OF TRUTH for onboarding draft
 * - On app startup (after hydration), load draft FROM backend TO onboardingStore
 * - ONE-WAY sync: backend → local (for hydration only)
 * - Screens persist progress TO backend as user fills forms
 *
 * SAFETY:
 * - READ-ONLY: Only reads from backend, writes to local store
 * - Does NOT overwrite fields already set in current session
 * - Runs AFTER hydration completes, BEFORE onboarding screens mount
 * - LIVE MODE ONLY: Demo mode uses demoStore
 */
function OnboardingDraftHydrator() {
  const userId = useAuthStore((s) => s.userId);
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  const onboardingHydrated = useOnboardingStore((s) => s._hasHydrated);
  const hydrateFromDraft = useOnboardingStore((s) => s.hydrateFromDraft);
  const setFaceVerificationPassed = useAuthStore((s) => s.setFaceVerificationPassed);
  const setFaceVerificationPending = useAuthStore((s) => s.setFaceVerificationPending);
  const hasHydratedRef = useRef(false);
  // P0 FIX: Add mounted guard to prevent setState after unmount
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // BUG FIX: Use getOnboardingStatus to get comprehensive data including basicInfo from user document
  const onboardingStatus = useQuery(
    api.users.getOnboardingStatus,
    !isDemoMode && userId && authHydrated && onboardingHydrated
      ? { userId }
      : 'skip'
  );

  useEffect(() => {
    // Only in production mode (not demo)
    if (isDemoMode) {
      // Demo mode doesn't use Convex for onboarding draft, mark as hydrated immediately
      useOnboardingStore.getState().setConvexHydrated();
      return;
    }

    // Wait for auth and onboarding stores to hydrate
    if (!authHydrated || !onboardingHydrated || !userId) return;

    // Wait for status data to load
    if (onboardingStatus === undefined) return;

    // Only hydrate once per session
    if (hasHydratedRef.current) return;

    // P0 FIX #1: Check mounted before proceeding
    if (!mountedRef.current) return;

    // P0 FIX #1: If no status found, mark hydration complete so screens don't wait indefinitely
    if (!onboardingStatus) {
      if (__DEV__) console.log('[ONB_DRAFT] No onboarding status found');
      // No status, but hydration attempt complete - mark as hydrated so screens don't wait
      hydrateFromDraft(null);
      return;
    }

    // P0 FIX #2: STEP 1 - Hydrate from draft FIRST (resets store, applies draft data)
    // This must happen BEFORE user doc hydration so user doc can override stale draft data
    if (onboardingStatus.onboardingDraft) {
      const draft = onboardingStatus.onboardingDraft;
      const draftKeys = Object.keys(draft).filter(
        key => (draft as any)[key] != null
      );
      if (__DEV__) {
        console.log(`[BASIC_HYDRATE] source=draft fields=${JSON.stringify(draftKeys)}`);
      }
      hydrateFromDraft(draft);
    } else {
      if (__DEV__) {
        console.log('[ONB_DRAFT] No draft found in Convex');
      }
      // Still call hydrateFromDraft with null to reset state properly
      hydrateFromDraft(null);
    }

    // P0 FIX #2: STEP 2 - Apply user document data AFTER draft (user doc is authoritative)
    // This overrides any stale draft data with the canonical user record
    if (onboardingStatus.basicInfo) {
      const { name, nickname, dateOfBirth, gender } = onboardingStatus.basicInfo;
      const store = useOnboardingStore.getState();
      const hydratedFields: string[] = [];

      // P0 FIX #2: Always apply user doc data if present (user doc is authoritative, not draft)
      // Remove the check for empty store fields - user doc should always win
      if (name) {
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) {
          store.setFirstName(parts[0]);
          store.setLastName('');
        } else {
          store.setFirstName(parts[0]);
          store.setLastName(parts.slice(1).join(' '));
        }
        hydratedFields.push('firstName', 'lastName');
      }
      if (nickname) {
        store.setNickname(nickname);
        hydratedFields.push('nickname');
      }
      if (dateOfBirth) {
        store.setDateOfBirth(dateOfBirth);
        hydratedFields.push('dateOfBirth');
      }
      // Type guard: only set gender if it's a valid Gender type
      if (gender) {
        const validGenders = ['male', 'female', 'non_binary'];
        if (validGenders.includes(gender)) {
          store.setGender(gender as any);
          hydratedFields.push('gender');
        }
      }

      if (__DEV__ && hydratedFields.length > 0) {
        console.log(`[BASIC_HYDRATE] source=user (authoritative) fields=${JSON.stringify(hydratedFields)}`);
      }
    }

    // Hydrate face verification status flags
    if (onboardingStatus.faceVerificationPassed) {
      setFaceVerificationPassed(true);
      if (__DEV__) console.log('[ONB_DRAFT] Hydrated faceVerificationPassed=true');
    }
    if (onboardingStatus.faceVerificationPending) {
      setFaceVerificationPending(true);
      if (__DEV__) console.log('[ONB_DRAFT] Hydrated faceVerificationPending=true');
    }

    // BUG FIX: Hydrate verification reference photo as primary display photo
    // This ensures the reference photo is used as primary even when normalPhotoCount=0
    if (onboardingStatus.referencePhotoExists && onboardingStatus.verificationReferencePhotoId) {
      const store = useOnboardingStore.getState();
      // Only hydrate if not already set (don't overwrite user changes)
      if (!store.verificationReferencePrimary) {
        store.setVerificationReferencePrimary({
          storageId: onboardingStatus.verificationReferencePhotoId,
          url: '', // Will be fetched in UI via getUrl() if needed
        });
        if (__DEV__) {
          console.log('[REF_PRIMARY] Hydrated verification reference photo', {
            exists: true,
            source: 'backend',
            storageId: onboardingStatus.verificationReferencePhotoId.substring(0, 12) + '...',
          });
        }
      }
    }

    // P0 FIX #1: Only mark hydration complete AFTER all steps succeed
    hasHydratedRef.current = true;
    if (__DEV__) console.log('[ONB_DRAFT] Hydration complete');
  }, [userId, authHydrated, onboardingHydrated, onboardingStatus, hydrateFromDraft, setFaceVerificationPassed, setFaceVerificationPending]);

  return null;
}

function DeviceFingerprintCollector() {
  const userId = useAuthStore((s) => s.userId);
  const registerFingerprint = useMutation(api.deviceFingerprint.registerDeviceFingerprint);

  useEffect(() => {
    if (isDemoMode || !userId) return;

    (async () => {
      try {
        const data = await collectDeviceFingerprint();
        await registerFingerprint({
          userId: userId as any,
          ...data,
        });
      } catch {
        // Silent failure — fingerprinting is non-critical
      }
    })();
  }, [userId]);

  return null;
}

/**
 * PresenceAndLocationManager - Handles presence heartbeat and location publish
 *
 * PRESENCE FIX: Ensures "Online now" is displayed correctly on Discover cards.
 * LOCATION FIX: Ensures fresh location is published to backend for distance calculation.
 *
 * This component:
 * 1. Sends heartbeat to backend on app foreground (updates lastActive)
 * 2. Sends heartbeat periodically while app is active (every 2 minutes)
 * 3. Publishes location to backend when available (updates latitude/longitude for distance)
 */
function PresenceAndLocationManager() {
  // This hook handles all the presence and location logic
  usePresenceAndLocation();
  return null;
}

/**
 * BackgroundLocationManager - Starts background location tracking
 *
 * SAFETY:
 * - Only starts when user is authenticated
 * - Respects OS permissions (requests if needed)
 * - Does NOT modify existing Nearby logic
 * - Uses existing publishLocation mutation
 * - Updates every ~20 min with 200m distance filter
 *
 * HARDENING (v2):
 * - Respects user's preferred location mode (foreground vs background)
 * - Only requests background permission if user selected background mode
 * - Gracefully falls back to foreground-only if background denied
 */
function BackgroundLocationManager() {
  const userId = useAuthStore((s) => s.userId);
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    // Wait for auth hydration
    if (!authHydrated) return;

    // Only start once per session and when user is logged in
    if (hasStartedRef.current || !userId) return;
    hasStartedRef.current = true;

    // Start background location (respects user's preferred mode)
    startBackgroundLocation().then((result) => {
      if (__DEV__) {
        console.log('[BG_MANAGER] Location initialized:', {
          success: result.success,
          effectiveMode: result.effectiveMode,
          backgroundDenied: result.backgroundDenied,
        });
      }
    }).catch((error) => {
      console.warn('[BG_MANAGER] Failed to start location:', error?.message);
    });
  }, [userId, authHydrated]);

  return null;
}

/**
 * CrossedPathToastManager - Shows in-app toast for crossed-path events globally
 *
 * BEHAVIOR:
 * - Queries crossed-path history when app is foregrounded
 * - Compares latest createdAt with AsyncStorage lastSeen timestamp
 * - Shows tappable toast if new crossings detected
 * - Uses 10-minute cooldown to prevent spam
 * - Only triggers when user is authenticated and not on crossed-paths screen
 *
 * SAFETY:
 * - READ-ONLY: Only reads from backend, no mutations
 * - Non-blocking: silent failures don't affect app
 */
const CROSSED_PATHS_LAST_SEEN_KEY = 'mira_crossed_paths_last_seen';
const TOAST_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function CrossedPathToastManager() {
  const router = useRouter();
  const segments = useSegments();
  const userId = useAuthStore((s) => s.userId);
  const authHydrated = useAuthStore((s) => s._hasHydrated);
  const convexUserId = userId ? asUserId(userId) : undefined;
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastToastTimeRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const hasCheckedOnMountRef = useRef(false);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Query crossed-path history (live mode only)
  const crossedPathsQuery = useQuery(
    api.crossedPaths.getCrossPathHistory,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Check for new crossed paths and show toast
  const checkAndShowToast = useCallback(async () => {
    // Guard: must be authenticated and have data
    if (!crossedPathsQuery || crossedPathsQuery.length === 0) return;
    if (!mountedRef.current) return;

    // Guard: don't show if already on crossed-paths screen
    const currentPath = segments.join('/');
    if (currentPath.includes('crossed-paths')) return;

    // Find the latest createdAt timestamp
    const latestCreatedAt = Math.max(
      ...crossedPathsQuery.map((item: any) => item.createdAt || 0)
    );
    if (!latestCreatedAt) return;

    try {
      // Get last seen timestamp from AsyncStorage
      const lastSeenStr = await AsyncStorage.getItem(CROSSED_PATHS_LAST_SEEN_KEY);
      const lastSeen = lastSeenStr ? parseInt(lastSeenStr, 10) : 0;

      // Check if there are new crossings
      if (latestCreatedAt > lastSeen) {
        const now = Date.now();
        const timeSinceLastToast = now - lastToastTimeRef.current;

        // Check cooldown
        if (timeSinceLastToast >= TOAST_COOLDOWN_MS) {
          lastToastTimeRef.current = now;

          // Show toast with navigation callback
          Toast.show(
            'You crossed paths with someone nearby',
            undefined,
            () => safePush(router, '/(main)/crossed-paths' as any, 'global-toast->crossed-paths')
          );

          // Update lastSeen to prevent duplicate toasts
          // (Note: User will still see badge until they actually visit the screen)
          // We intentionally do NOT update lastSeen here - let the crossed-paths screen do that
          // This ensures the badge remains visible until user actually views the screen
        }
      }
    } catch (error) {
      // Silent failure - AsyncStorage errors are non-critical
      if (__DEV__) {
        console.warn('[CROSSED_TOAST] Failed to check lastSeen:', error);
      }
    }
  }, [crossedPathsQuery, segments, router]);

  // Check on initial data load (after mount)
  useEffect(() => {
    if (!authHydrated || !convexUserId) return;
    if (hasCheckedOnMountRef.current) return;
    if (!crossedPathsQuery || crossedPathsQuery.length === 0) return;

    hasCheckedOnMountRef.current = true;
    checkAndShowToast();
  }, [authHydrated, convexUserId, crossedPathsQuery, checkAndShowToast]);

  // Check on app resume (foreground)
  useEffect(() => {
    if (isDemoMode) return;
    if (!authHydrated || !convexUserId) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // If app was in background and is now active
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // Give a small delay for query to potentially refresh
        setTimeout(() => {
          if (mountedRef.current) {
            checkAndShowToast();
          }
        }, 500);
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [authHydrated, convexUserId, checkAndShowToast]);

  return null;
}

export default function RootLayout() {
  // Milestone A: RootLayout first render
  markTiming('root_layout');
  log.info('[APP]', 'RootLayout rendering');

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ConvexProvider client={convex}>
          <StatusBar style="light" />
          <DemoBanner />
          <ResetEpochChecker />
          <BootStateTracker />
          <BootScreenWrapper />
          <SessionValidator />
          <PhotoSyncManager />
          <OnboardingDraftHydrator />
          <DeviceFingerprintCollector />
          <PresenceAndLocationManager />
          <BackgroundLocationManager />
          <CrossedPathToastManager />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="demo-profile" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(main)" options={{ gestureEnabled: false }} />
          </Stack>
        </ConvexProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
