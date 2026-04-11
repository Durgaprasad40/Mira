/**
 * Demo Auth Mode - Frontend Helpers
 *
 * Centralized demo authentication logic for local/dev testing.
 * Works with convex/demoAuth.ts backend counterpart.
 *
 * USAGE:
 * 1. Set EXPO_PUBLIC_DEMO_AUTH_MODE=true in .env.local
 * 2. Any email + any password will work for login/signup
 * 3. Stable demo user identity is created/reused
 * 4. Onboarding progress is preserved across app restarts
 *
 * REMOVAL:
 * 1. Delete this file
 * 2. Delete convex/demoAuth.ts
 * 3. Remove isDemoAuthMode exports from config/demo.ts
 * 4. Remove demo auth handling from app/index.tsx and auth screens
 */

import { isDemoAuthMode, DEMO_USER_STABLE_ID, DEMO_TOKEN_STABLE } from '@/config/demo';
import { useAuthStore } from '@/stores/authStore';
import { saveAuthBootCache } from '@/stores/authBootCache';
import { convex } from '@/hooks/useConvex';
import { api } from '@/convex/_generated/api';

// =============================================================================
// DEMO AUTH HELPERS
// =============================================================================

/**
 * Check if demo auth mode is currently active.
 * Safe to call anywhere - returns false in production.
 */
export function isDemoAuthEnabled(): boolean {
  return isDemoAuthMode;
}

/**
 * Get the stable demo user credentials.
 * These are the same every time - ensuring consistent identity.
 */
export function getDemoCredentials() {
  return {
    userId: DEMO_USER_STABLE_ID,
    token: DEMO_TOKEN_STABLE,
  };
}

/**
 * Check if a token is a demo token.
 * Used by backend to identify demo sessions.
 */
export function isDemoToken(token: string | null): boolean {
  if (!token) return false;
  return token.startsWith('demo_');
}

/**
 * Login or create a demo user.
 * Calls backend to ensure demo user exists and returns session.
 *
 * @param email - Any email (not validated in demo mode)
 * @param password - Any password (not validated in demo mode)
 * @returns Session data with userId and token
 */
export async function loginDemoUser(
  email: string,
  _password: string
): Promise<{
  success: boolean;
  userId: string;
  token: string;
  onboardingCompleted: boolean;
  isNewUser: boolean;
}> {
  if (!isDemoAuthMode) {
    throw new Error('Demo auth mode is not enabled');
  }

  if (__DEV__) {
    console.log('[DEMO_AUTH] loginDemoUser called for:', email);
  }

  try {
    // Call backend to create/get demo user
    const result = await convex.mutation(api.demoAuth.loginOrCreateDemoUser, {
      email: email.toLowerCase().trim(),
      demoUserId: DEMO_USER_STABLE_ID,
    });

    if (!result.success) {
      throw new Error(result.message || 'Demo login failed');
    }

    // Save to SecureStore for persistence across app restarts
    const saved = await saveAuthBootCache(result.token, result.userId, {
      onboardingCompleted: result.onboardingCompleted,
    });

    if (!saved && __DEV__) {
      console.warn('[DEMO_AUTH] Failed to save demo auth to SecureStore');
    }

    // Update auth store
    const authVersion = useAuthStore.getState().authVersion;
    useAuthStore.getState().setAuthenticatedSession(
      result.userId,
      result.token,
      result.onboardingCompleted,
      authVersion
    );

    if (__DEV__) {
      console.log('[DEMO_AUTH] Demo user authenticated:', {
        userId: result.userId.substring(0, 8),
        onboardingCompleted: result.onboardingCompleted,
        isNewUser: result.isNewUser,
      });
    }

    return {
      success: true,
      userId: result.userId,
      token: result.token,
      onboardingCompleted: result.onboardingCompleted,
      isNewUser: result.isNewUser,
    };
  } catch (error) {
    if (__DEV__) {
      console.error('[DEMO_AUTH] loginDemoUser error:', error);
    }
    throw error;
  }
}

/**
 * Register a demo user (same as login in demo mode).
 * In demo mode, signup and login are essentially the same operation.
 */
export async function registerDemoUser(
  email: string,
  password: string,
  _name?: string
): Promise<{
  success: boolean;
  userId: string;
  token: string;
  onboardingCompleted: boolean;
  isNewUser: boolean;
}> {
  // In demo mode, register is the same as login
  return loginDemoUser(email, password);
}

/**
 * Validate if a demo session is still valid.
 * Demo sessions are always valid as long as demo mode is enabled.
 */
export async function validateDemoSession(token: string): Promise<{
  valid: boolean;
  userId: string | null;
  onboardingCompleted: boolean;
}> {
  if (!isDemoAuthMode) {
    return { valid: false, userId: null, onboardingCompleted: false };
  }

  if (!isDemoToken(token)) {
    return { valid: false, userId: null, onboardingCompleted: false };
  }

  try {
    // Call backend to validate demo session
    const result = await convex.query(api.demoAuth.validateDemoSession, {
      token,
    });

    return {
      valid: result.valid,
      userId: result.userId || null,
      onboardingCompleted: result.onboardingCompleted ?? false,
    };
  } catch (error) {
    if (__DEV__) {
      console.error('[DEMO_AUTH] validateDemoSession error:', error);
    }
    return { valid: false, userId: null, onboardingCompleted: false };
  }
}

/**
 * Get demo user's onboarding status.
 * Returns the same structure as the real getOnboardingStatus query.
 */
export async function getDemoOnboardingStatus(token: string): Promise<any> {
  if (!isDemoAuthMode || !isDemoToken(token)) {
    return null;
  }

  try {
    const result = await convex.query(api.demoAuth.getDemoOnboardingStatus, {
      token,
    });
    return result;
  } catch (error) {
    if (__DEV__) {
      console.error('[DEMO_AUTH] getDemoOnboardingStatus error:', error);
    }
    return null;
  }
}

/**
 * Check if we should use demo auth for a given operation.
 * Returns true if demo mode is enabled AND the token is a demo token.
 */
export function shouldUseDemoAuth(token: string | null): boolean {
  return isDemoAuthMode && isDemoToken(token);
}

/**
 * Ensure demo user has consent set before photo upload.
 * This MUST be called before any photo upload operation in demo mode.
 *
 * ROOT CAUSE FIX: When app resumes with existing demo session, the consent
 * may not be set (user created before fix or via different code path).
 * This mutation guarantees consent exists before upload.
 */
export async function ensureDemoUserConsent(token: string): Promise<boolean> {
  if (!isDemoAuthMode || !isDemoToken(token)) {
    return false;
  }

  try {
    const result = await convex.mutation(api.demoAuth.ensureDemoUserConsent, {
      token,
    });

    if (__DEV__) {
      console.log('[DEMO_AUTH] ensureDemoUserConsent result:', result.success);
    }

    return result.success;
  } catch (error) {
    if (__DEV__) {
      console.error('[DEMO_AUTH] ensureDemoUserConsent error:', error);
    }
    return false;
  }
}
