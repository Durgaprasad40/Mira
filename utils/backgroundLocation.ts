/**
 * Background Location Tracking
 *
 * Legacy background location wrapper.
 * Shipped Phase-1 Nearby is foreground-only.
 *
 * SAFETY:
 * - Does NOT modify existing feature logic
 * - Any existing background task is stopped
 * - Foreground Nearby continues to work normally
 *
 * SAFE SHIPPING PATH:
 * - Do not request background permission
 * - Do not start background updates
 * - Normalize all callers to foreground mode
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import { DEBUG_BACKGROUND_LOCATION } from '@/lib/debugFlags';
import {
  setEffectiveLocationMode,
  requestLocationPermissions,
  clearLocationModeSettings,
  type NearbyLocationMode,
} from './nearbyLocationMode';

// Re-export for convenience
export { type NearbyLocationMode } from './nearbyLocationMode';
export {
  getLocationModeStatus,
} from './nearbyLocationMode';

// Task name - must be unique and consistent
const LOCATION_TASK = 'mira-background-location-task';

// SecureStore key for auth userId (same as authBootCache.ts)
const USER_ID_KEY = 'mira_auth_user_id';

// Convex URL
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL!;

/**
 * Define the background task at TOP LEVEL (required by expo-task-manager)
 * This runs when the OS delivers location updates in background.
 * It refreshes Nearby visibility only; crossed-path detection remains foreground-only.
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] error:', error.message);
    return;
  }

  const locations = (data as any)?.locations;
  const location = locations?.[0];

  if (!location?.coords) {
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] no coords');
    return;
  }

  const { latitude, longitude } = location.coords;

  if (__DEV__ && DEBUG_BACKGROUND_LOCATION) {
    console.log(`[BG] loc: ${latitude.toFixed(4)},${longitude.toFixed(4)}`);
  }

  try {
    const userId = await SecureStore.getItemAsync(USER_ID_KEY);

    if (!userId || !userId.trim()) {
      if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] no auth');
      return;
    }

    const convex = new ConvexHttpClient(CONVEX_URL);

    const result = await convex.mutation(api.crossedPaths.publishLocation, {
      userId,
      latitude,
      longitude,
    });

    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) {
      console.log('[BG]', result?.published ? 'published' : `throttled:${result?.reason}`);
    }
  } catch (e: any) {
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] error:', e?.message || e);
  }
});

/**
 * Normalize startup to foreground-only shipping behavior.
 *
 * @returns Object with success flag and effective mode
 */
export async function startBackgroundLocation(): Promise<{
  success: boolean;
  effectiveMode: NearbyLocationMode;
  backgroundDenied?: boolean;
}> {
  try {
    await stopBackgroundLocation();
    await setEffectiveLocationMode('foreground');
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] foreground-only shipping path');
    return {
      success: true,
      effectiveMode: 'foreground',
      backgroundDenied: false,
    };
  } catch (e: any) {
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] start error:', e?.message || e);
    await setEffectiveLocationMode('foreground');
    return { success: false, effectiveMode: 'foreground' };
  }
}

/**
 * Apply a foreground-only location permission request from Nearby settings.
 */
export async function applyBackgroundLocationModeChange(): Promise<{
  success: boolean;
  effectiveMode: NearbyLocationMode;
  backgroundDenied?: boolean;
}> {
  try {
    const permResult = await requestLocationPermissions('foreground');

    if (!permResult.success) {
      if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] permission failed');
      return { success: false, effectiveMode: 'foreground' };
    }

    await stopBackgroundLocation();
    await setEffectiveLocationMode('foreground');
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] applied foreground mode');
    return {
      success: true,
      effectiveMode: 'foreground',
      backgroundDenied: false,
    };
  } catch (e: any) {
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] apply error:', e?.message || e);
    await setEffectiveLocationMode('foreground');
    return { success: false, effectiveMode: 'foreground' };
  }
}

/**
 * Legacy wrapper for backward compatibility.
 * Returns simple boolean for existing callers.
 * @deprecated Use startBackgroundLocation() which returns detailed result
 */
export async function startBackgroundLocationLegacy(): Promise<boolean> {
  await startBackgroundLocation();
  return false;
}

/**
 * Stop background location tracking.
 * Call this on logout or when switching to foreground-only mode.
 */
export async function stopBackgroundLocation(): Promise<void> {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] stopped');
    }
  } catch (e: any) {
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] stop error:', e?.message || e);
  }
}

/**
 * Full cleanup for logout.
 * Stops background task AND clears location mode settings.
 */
export async function cleanupBackgroundLocation(): Promise<void> {
  await stopBackgroundLocation();
  await clearLocationModeSettings();
  if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] cleanup complete');
}
