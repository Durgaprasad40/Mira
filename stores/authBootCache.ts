/**
 * authBootCache - Fast minimal auth data read for routing decisions
 *
 * Reads only the essential auth data needed for routing directly from AsyncStorage,
 * bypassing the full Zustand hydration middleware overhead.
 *
 * SAFETY:
 * - READ-ONLY: Never writes to AsyncStorage
 * - Does NOT modify any stores or user data
 * - Just provides fast access to minimal auth boot state
 * - Never stores or exposes passwords
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AuthBootCacheData {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  onboardingCompleted: boolean;
  faceVerificationPassed: boolean;
  faceVerificationPending: boolean;
}

let _authBootCache: AuthBootCacheData | null = null;
let _authBootCachePromise: Promise<AuthBootCacheData> | null = null;

// Default state when no persisted data exists
const DEFAULT_AUTH_BOOT: AuthBootCacheData = {
  isAuthenticated: false,
  userId: null,
  token: null,
  onboardingCompleted: false,
  faceVerificationPassed: false,
  faceVerificationPending: false,
};

/**
 * Read minimal auth data from AsyncStorage (fast, ~10-50ms)
 * Caches result so subsequent calls are instant.
 */
export async function getAuthBootCache(): Promise<AuthBootCacheData> {
  // Return cached result if available
  if (_authBootCache) return _authBootCache;

  // Return pending promise if already loading
  if (_authBootCachePromise) return _authBootCachePromise;

  // Start loading
  _authBootCachePromise = (async () => {
    const startTime = Date.now();
    try {
      const raw = await AsyncStorage.getItem('auth-storage');
      if (__DEV__) {
        // Log payload size for debugging slow hydration
        const payloadSize = raw?.length ?? 0;
        console.log(`[HYDRATION] auth-storage payload: ${payloadSize} bytes`);
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        const state = parsed?.state;
        _authBootCache = {
          isAuthenticated: state?.isAuthenticated ?? false,
          userId: state?.userId ?? null,
          token: state?.token ?? null,
          onboardingCompleted: state?.onboardingCompleted ?? false,
          faceVerificationPassed: state?.faceVerificationPassed ?? false,
          faceVerificationPending: state?.faceVerificationPending ?? false,
        };
      } else {
        _authBootCache = { ...DEFAULT_AUTH_BOOT };
      }
    } catch {
      _authBootCache = { ...DEFAULT_AUTH_BOOT };
    }
    if (__DEV__) {
      console.log(`[HYDRATION] authBootCache: ${Date.now() - startTime}ms`);
    }
    return _authBootCache;
  })();

  return _authBootCachePromise;
}

/**
 * Synchronous access to auth boot cache (returns null if not yet loaded)
 */
export function getAuthBootCacheSync(): AuthBootCacheData | null {
  return _authBootCache;
}

/**
 * Check if auth boot cache has been loaded
 */
export function isAuthBootCacheReady(): boolean {
  return _authBootCache !== null;
}

/**
 * Clear auth boot cache (call on logout to prevent stale routing)
 */
export function clearAuthBootCache(): void {
  _authBootCache = null;
  _authBootCachePromise = null;
}
