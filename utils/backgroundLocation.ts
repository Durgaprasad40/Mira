/**
 * Background Location Tracking
 *
 * Enables periodic background location updates so user location is refreshed
 * even when the Nearby tab is NOT opened.
 *
 * SAFETY:
 * - Does NOT modify existing feature logic
 * - Respects battery + OS limitations
 * - Reuses existing publishLocation mutation only
 * - Keeps interval >= 20 minutes
 * - Publish-only: does NOT run crossed-path detection in background
 *
 * HARDENING (v2):
 * - User-selectable location mode: 'foreground' or 'background'
 * - Graceful fallback if background permission denied
 * - Does NOT start background task unless user selected background mode
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import { DEBUG_BACKGROUND_LOCATION } from '@/lib/debugFlags';
import {
  getPreferredLocationMode,
  getEffectiveLocationMode,
  setEffectiveLocationMode,
  requestLocationPermissions,
  clearLocationModeSettings,
  type NearbyLocationMode,
} from './nearbyLocationMode';

// Re-export for convenience
export { type NearbyLocationMode } from './nearbyLocationMode';
export {
  getPreferredLocationMode,
  setPreferredLocationMode,
  getEffectiveLocationMode,
  getLocationModeStatus,
  checkPermissionStatus,
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
    const authUserId = await SecureStore.getItemAsync(USER_ID_KEY);

    if (!authUserId || !authUserId.trim()) {
      if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] no auth');
      return;
    }

    const convex = new ConvexHttpClient(CONVEX_URL);

    const result = await convex.mutation(api.crossedPaths.publishLocation, {
      authUserId,
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
 * Start background location tracking.
 * Call this on app startup after user is authenticated.
 *
 * HARDENED BEHAVIOR:
 * - Only starts background task if user has selected 'background' mode
 * - If 'foreground' mode selected, does NOT request background permission
 * - If background permission denied, falls back to foreground-only
 *
 * @returns Object with success flag and effective mode
 */
export async function startBackgroundLocation(): Promise<{
  success: boolean;
  effectiveMode: NearbyLocationMode;
  backgroundDenied?: boolean;
}> {
  try {
    const preferredMode = await getPreferredLocationMode();
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] mode:', preferredMode);

    const permResult = await requestLocationPermissions(preferredMode);

    if (!permResult.success) {
      if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] permission failed');
      return { success: false, effectiveMode: 'foreground' };
    }

    if (permResult.effectiveMode === 'foreground') {
      await stopBackgroundLocation();
      if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] foreground mode');
      return {
        success: true,
        effectiveMode: 'foreground',
        backgroundDenied: permResult.backgroundDenied,
      };
    }

    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);

    if (!isRunning) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 20 * 60 * 1000,
        distanceInterval: 200,
        showsBackgroundLocationIndicator: false,
        foregroundService: {
          notificationTitle: 'Mira',
          notificationBody: 'Updating Nearby visibility',
          notificationColor: '#FF69B4',
        },
      });
      if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] started');
    }

    return { success: true, effectiveMode: 'background' };
  } catch (e: any) {
    if (__DEV__ && DEBUG_BACKGROUND_LOCATION) console.log('[BG] start error:', e?.message || e);
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
  const result = await startBackgroundLocation();
  return result.success && result.effectiveMode === 'background';
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
