/**
 * bootCache - Fast minimal data read for routing decisions
 *
 * STORAGE POLICY ENFORCEMENT:
 * NO local persistence. Demo mode data is NOT persisted locally.
 * Returns default empty state immediately.
 *
 * Kept for compatibility with existing routing code, but no longer reads AsyncStorage.
 */

interface BootCacheData {
  currentDemoUserId: null;
  demoOnboardingComplete: Record<string, never>;
}

const DEFAULT_BOOT_CACHE: BootCacheData = {
  currentDemoUserId: null,
  demoOnboardingComplete: {},
};

/**
 * Returns default empty state immediately.
 * No AsyncStorage read.
 */
export async function getBootCache(): Promise<BootCacheData> {
  return { ...DEFAULT_BOOT_CACHE };
}

/**
 * Synchronous access - always returns default state
 */
export function getBootCacheSync(): BootCacheData {
  return { ...DEFAULT_BOOT_CACHE };
}

/**
 * Always ready since no async loading
 */
export function isBootCacheReady(): boolean {
  return true;
}

/**
 * No-op for compatibility
 */
export function clearBootCache(): void {
  // No-op - no cache to clear
}
