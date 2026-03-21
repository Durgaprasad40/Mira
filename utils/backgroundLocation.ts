/**
 * Background Location Tracking
 *
 * Enables periodic background location updates so user location is refreshed
 * even when the Nearby tab is NOT opened.
 *
 * SAFETY:
 * - Does NOT modify existing feature logic
 * - Respects battery + OS limitations
 * - Reuses existing publishLocation mutation
 * - Keeps interval >= 20 minutes
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
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.log('[BG][ERROR]', error.message);
    return;
  }

  const locations = (data as any)?.locations;
  const location = locations?.[0];

  if (!location?.coords) {
    console.log('[BG][NO_COORDS]');
    return;
  }

  const { latitude, longitude } = location.coords;

  console.log('[BG][LOCATION]', {
    lat: latitude.toFixed(6),
    lng: longitude.toFixed(6),
  });

  try {
    // Get auth userId from SecureStore
    const authUserId = await SecureStore.getItemAsync(USER_ID_KEY);

    if (!authUserId || !authUserId.trim()) {
      console.log('[BG][NO_AUTH]');
      return;
    }

    // Create HTTP client (no React needed)
    const convex = new ConvexHttpClient(CONVEX_URL);

    // Call publishLocation mutation
    const result = await convex.mutation(api.crossedPaths.publishLocation, {
      authUserId,
      latitude,
      longitude,
    });

    if (result?.published) {
      console.log('[BG][LOCATION_PUBLISHED]');
    } else {
      console.log('[BG][THROTTLED]', result?.reason);
    }
  } catch (e: any) {
    console.log('[BG][SEND_ERROR]', e?.message || e);
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
    // Get user's preferred mode
    const preferredMode = await getPreferredLocationMode();
    console.log('[BG][MODE]', preferredMode);

    // Request permissions based on mode (handles fallback internally)
    const permResult = await requestLocationPermissions(preferredMode);

    if (!permResult.success) {
      console.log('[BG][PERMISSION_FAILED]');
      return {
        success: false,
        effectiveMode: 'foreground',
      };
    }

    // If effective mode is foreground, ensure background task is stopped
    if (permResult.effectiveMode === 'foreground') {
      await stopBackgroundLocation();
      console.log('[BG][FOREGROUND_MODE]', {
        preferredMode,
        backgroundDenied: permResult.backgroundDenied,
      });
      return {
        success: true,
        effectiveMode: 'foreground',
        backgroundDenied: permResult.backgroundDenied,
      };
    }

    // Background mode with permission granted - start background task
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);

    if (!isRunning) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 20 * 60 * 1000, // 20 minutes
        distanceInterval: 200, // 200 meters
        showsBackgroundLocationIndicator: false,
        foregroundService: {
          notificationTitle: 'Mira',
          notificationBody: 'Finding nearby people',
          notificationColor: '#FF69B4',
        },
      });

      console.log('[BG][STARTED]');
    } else {
      console.log('[BG][ALREADY_RUNNING]');
    }

    return {
      success: true,
      effectiveMode: 'background',
    };
  } catch (e: any) {
    console.log('[BG][START_ERROR]', e?.message || e);
    await setEffectiveLocationMode('foreground');
    return {
      success: false,
      effectiveMode: 'foreground',
    };
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
      console.log('[BG][STOPPED]');
    }
  } catch (e: any) {
    console.log('[BG][STOP_ERROR]', e?.message || e);
  }
}

/**
 * Full cleanup for logout.
 * Stops background task AND clears location mode settings.
 */
export async function cleanupBackgroundLocation(): Promise<void> {
  await stopBackgroundLocation();
  await clearLocationModeSettings();
  console.log('[BG][CLEANUP_COMPLETE]');
}
