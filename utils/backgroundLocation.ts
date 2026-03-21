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
 */

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

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
 */
export async function startBackgroundLocation(): Promise<boolean> {
  try {
    // Request foreground permission first
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      console.log('[BG][FG_DENIED]');
      return false;
    }

    // Request background permission
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      console.log('[BG][BG_DENIED]');
      return false;
    }

    // Check if already running
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

    return true;
  } catch (e: any) {
    console.log('[BG][START_ERROR]', e?.message || e);
    return false;
  }
}

/**
 * Stop background location tracking.
 * Call this on logout.
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
