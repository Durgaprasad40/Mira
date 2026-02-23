/**
 * bootCache - Fast minimal data read for routing decisions
 *
 * Reads only the essential data needed for routing directly from AsyncStorage,
 * bypassing the full Zustand hydration which includes heavy data like profiles,
 * matches, crossedPaths, etc.
 *
 * SAFETY:
 * - READ-ONLY: Never writes to AsyncStorage
 * - Does NOT modify any stores or user data
 * - Just provides fast access to minimal boot state
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

interface BootCacheData {
  currentDemoUserId: string | null;
  demoOnboardingComplete: Record<string, boolean>;
}

let _bootCache: BootCacheData | null = null;
let _bootCachePromise: Promise<BootCacheData> | null = null;

/**
 * Read minimal boot data from AsyncStorage (fast, ~10-50ms)
 * Caches result so subsequent calls are instant.
 */
export async function getBootCache(): Promise<BootCacheData> {
  // Return cached result if available
  if (_bootCache) return _bootCache;

  // Return pending promise if already loading
  if (_bootCachePromise) return _bootCachePromise;

  // Start loading
  _bootCachePromise = (async () => {
    const startTime = Date.now();
    try {
      const raw = await AsyncStorage.getItem('demo-store');
      if (raw) {
        const parsed = JSON.parse(raw);
        const state = parsed?.state;
        _bootCache = {
          currentDemoUserId: state?.currentDemoUserId ?? null,
          demoOnboardingComplete: state?.demoOnboardingComplete ?? {},
        };
      } else {
        _bootCache = {
          currentDemoUserId: null,
          demoOnboardingComplete: {},
        };
      }
    } catch {
      _bootCache = {
        currentDemoUserId: null,
        demoOnboardingComplete: {},
      };
    }
    if (__DEV__) {
      console.log(`[HYDRATION] bootCache: ${Date.now() - startTime}ms`);
    }
    return _bootCache;
  })();

  return _bootCachePromise;
}

/**
 * Synchronous access to boot cache (returns null if not yet loaded)
 */
export function getBootCacheSync(): BootCacheData | null {
  return _bootCache;
}

/**
 * Check if boot cache has been loaded
 */
export function isBootCacheReady(): boolean {
  return _bootCache !== null;
}

/**
 * Clear boot cache (call on logout to prevent stale routing)
 */
export function clearBootCache(): void {
  _bootCache = null;
  _bootCachePromise = null;
}
