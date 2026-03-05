/**
 * authBootCache - Minimal auth persistence for boot routing decisions
 *
 * STORAGE POLICY:
 * - Persists ONLY auth essentials (token + userId) in SecureStore
 * - Does NOT persist profile data, photos, messages, or onboarding drafts
 * - onboardingCompleted is fetched from Convex (backend is source of truth)
 */

import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'mira_auth_token';
const USER_ID_KEY = 'mira_auth_user_id';
const ONBOARDING_COMPLETED_KEY = 'mira_auth_onboarding_completed';
const ONBOARDING_UPDATED_AT_KEY = 'mira_auth_onboarding_updated_at';

export interface AuthBootCacheData {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  onboardingCompleted: boolean;
  onboardingCompletedUpdatedAt?: number;
  faceVerificationPassed: boolean;
  faceVerificationPending: boolean;
}

// Default state - unauthenticated
const DEFAULT_AUTH_BOOT: AuthBootCacheData = {
  isAuthenticated: false,
  userId: null,
  token: null,
  onboardingCompleted: false,
  faceVerificationPassed: false,
  faceVerificationPending: false,
};

/**
 * Read auth token, userId, and onboardingCompleted from SecureStore.
 * Returns cached auth data if persisted, or default empty state.
 */
export async function getAuthBootCache(): Promise<AuthBootCacheData> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const userId = await SecureStore.getItemAsync(USER_ID_KEY);
    const onboardingCompletedStr = await SecureStore.getItemAsync(ONBOARDING_COMPLETED_KEY);
    const updatedAtStr = await SecureStore.getItemAsync(ONBOARDING_UPDATED_AT_KEY);

    if (token && userId) {
      const onboardingCompleted = onboardingCompletedStr === '1';
      const onboardingCompletedUpdatedAt = updatedAtStr ? parseInt(updatedAtStr, 10) : undefined;

      if (__DEV__) {
        console.log('[AUTH_BOOT] Token found in SecureStore, userId:', userId.substring(0, 10) + '...', 'onboardingCompleted:', onboardingCompleted);
      }
      return {
        isAuthenticated: true,
        userId,
        token,
        onboardingCompleted,
        onboardingCompletedUpdatedAt,
        // These will be fetched from Convex during boot
        faceVerificationPassed: false,
        faceVerificationPending: false,
      };
    }

    if (__DEV__) {
      console.log('[AUTH_BOOT] No token in SecureStore, returning default state');
    }
    return { ...DEFAULT_AUTH_BOOT };
  } catch (error) {
    console.error('[AUTH_BOOT] Failed to read from SecureStore:', error);
    return { ...DEFAULT_AUTH_BOOT };
  }
}

/**
 * Save auth token, userId, and optionally onboardingCompleted to SecureStore.
 * Call ONLY after confirmed auth success (user clicked Continue, login succeeded).
 * @param opts.onboardingCompleted - If provided, persists onboarding completion flag
 */
export async function saveAuthBootCache(
  token: string,
  userId: string,
  opts?: { onboardingCompleted?: boolean }
): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_ID_KEY, userId);

    // Optionally persist onboardingCompleted flag
    if (opts?.onboardingCompleted !== undefined) {
      await SecureStore.setItemAsync(ONBOARDING_COMPLETED_KEY, opts.onboardingCompleted ? '1' : '0');
      await SecureStore.setItemAsync(ONBOARDING_UPDATED_AT_KEY, Date.now().toString());
      if (__DEV__) {
        console.log('[AUTH_BOOT] Saved token + onboardingCompleted to SecureStore, userId:', userId.substring(0, 10) + '...', 'onboardingCompleted:', opts.onboardingCompleted);
      }
    } else {
      if (__DEV__) {
        console.log('[AUTH_BOOT] Saved token to SecureStore, userId:', userId.substring(0, 10) + '...');
      }
    }
  } catch (error) {
    // STABILITY FIX: C-3 - SecureStore save failure must not leave partial cache
    if (__DEV__) {
      console.warn('[AUTH_BOOT_CACHE] SecureStore save failed - cleaning up partial state:', error);
    }
    console.error('[AUTH_BOOT] Failed to save to SecureStore:', error);
    // Clean up any partial cache to prevent ghost login sessions
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(USER_ID_KEY);
      if (opts?.onboardingCompleted !== undefined) {
        await SecureStore.deleteItemAsync(ONBOARDING_COMPLETED_KEY);
        await SecureStore.deleteItemAsync(ONBOARDING_UPDATED_AT_KEY);
      }
    } catch {
      // Cleanup failed - nothing more we can do
    }
  }
}

/**
 * Clear auth token, userId, and onboardingCompleted from SecureStore.
 * Call on logout or when session validation fails.
 */
export async function clearAuthBootCache(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_ID_KEY);
    await SecureStore.deleteItemAsync(ONBOARDING_COMPLETED_KEY);
    await SecureStore.deleteItemAsync(ONBOARDING_UPDATED_AT_KEY);
    if (__DEV__) {
      console.log('[AUTH_BOOT] Cleared token + onboardingCompleted from SecureStore');
    }
  } catch (error) {
    console.error('[AUTH_BOOT] Failed to clear SecureStore:', error);
  }
}

/**
 * Synchronous access - returns default state (use getAuthBootCache for real data)
 */
export function getAuthBootCacheSync(): AuthBootCacheData {
  return { ...DEFAULT_AUTH_BOOT };
}

/**
 * Always ready since async loading happens in getAuthBootCache
 */
export function isAuthBootCacheReady(): boolean {
  return true;
}
