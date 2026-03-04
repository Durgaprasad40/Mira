/**
 * authBootCache - Fast minimal auth data read for routing decisions
 *
 * STORAGE POLICY ENFORCEMENT:
 * NO local persistence. This now returns default empty state immediately.
 * Auth state must be rehydrated from Convex on app boot.
 *
 * Kept for compatibility with existing routing code, but no longer reads AsyncStorage.
 */

export interface AuthBootCacheData {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  onboardingCompleted: boolean;
  faceVerificationPassed: boolean;
  faceVerificationPending: boolean;
}

// Default state - always unauthenticated on fresh app launch
const DEFAULT_AUTH_BOOT: AuthBootCacheData = {
  isAuthenticated: false,
  userId: null,
  token: null,
  onboardingCompleted: false,
  faceVerificationPassed: false,
  faceVerificationPending: false,
};

/**
 * Returns default unauthenticated state immediately.
 * No AsyncStorage read - routing must wait for Convex hydration.
 */
export async function getAuthBootCache(): Promise<AuthBootCacheData> {
  return { ...DEFAULT_AUTH_BOOT };
}

/**
 * Synchronous access - always returns default state
 */
export function getAuthBootCacheSync(): AuthBootCacheData {
  return { ...DEFAULT_AUTH_BOOT };
}

/**
 * Always ready since no async loading
 */
export function isAuthBootCacheReady(): boolean {
  return true;
}

/**
 * No-op for compatibility
 */
export function clearAuthBootCache(): void {
  // No-op - no cache to clear
}
