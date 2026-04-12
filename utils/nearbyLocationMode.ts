/**
 * Nearby Location Mode - User-selectable location tracking mode
 *
 * This utility manages the user's preferred location tracking mode:
 * - 'foreground': Only track location while app is open (foreground permission only)
 * - 'background': Track location in background (requires background permission)
 *
 * PERSISTENCE:
 * - Uses AsyncStorage for persistence (device-level setting)
 * - The setting survives app restarts
 *
 * FALLBACK BEHAVIOR:
 * - If background mode is selected but permission is denied, falls back to foreground
 * - effectiveMode reflects what's actually active (may differ from preferred)
 *
 * SAFETY:
 * - Does NOT change any Nearby logic
 * - Does NOT affect crossed-path detection
 * - Only controls which permission level is requested
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

// Storage keys
const LOCATION_MODE_KEY = 'mira_nearby_location_mode';
const EFFECTIVE_MODE_KEY = 'mira_nearby_effective_mode';

// Location mode types
export type NearbyLocationMode = 'foreground' | 'background';

// Status for display in settings
export interface LocationModeStatus {
  preferredMode: NearbyLocationMode;
  effectiveMode: NearbyLocationMode;
  backgroundPermissionGranted: boolean;
  foregroundPermissionGranted: boolean;
  statusText: string;
}

/**
 * Get the user's preferred location mode.
 * Defaults to 'foreground' if not set.
 */
export async function getPreferredLocationMode(): Promise<NearbyLocationMode> {
  try {
    const mode = await AsyncStorage.getItem(LOCATION_MODE_KEY);
    if (mode === 'background') return 'background';
    return 'foreground';
  } catch {
    return 'foreground';
  }
}

/**
 * Set the user's preferred location mode.
 */
export async function setPreferredLocationMode(mode: NearbyLocationMode): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCATION_MODE_KEY, mode);
  } catch {
    console.warn('[LOCATION_MODE] Failed to save preferred mode');
  }
}

/**
 * Get the effective (actual) location mode.
 * This may differ from preferred if background permission was denied.
 */
export async function getEffectiveLocationMode(): Promise<NearbyLocationMode> {
  try {
    const mode = await AsyncStorage.getItem(EFFECTIVE_MODE_KEY);
    if (mode === 'background') return 'background';
    return 'foreground';
  } catch {
    return 'foreground';
  }
}

/**
 * Set the effective location mode (internal use).
 */
export async function setEffectiveLocationMode(mode: NearbyLocationMode): Promise<void> {
  try {
    await AsyncStorage.setItem(EFFECTIVE_MODE_KEY, mode);
  } catch {
    console.warn('[LOCATION_MODE] Failed to save effective mode');
  }
}

/**
 * Check current permission status without requesting.
 */
export async function checkPermissionStatus(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    return {
      foreground: fg.status === 'granted',
      background: bg.status === 'granted',
    };
  } catch {
    return { foreground: false, background: false };
  }
}

/**
 * Get full status for display in settings.
 */
export async function getLocationModeStatus(): Promise<LocationModeStatus> {
  const preferredMode = await getPreferredLocationMode();
  const effectiveMode = await getEffectiveLocationMode();
  const permissions = await checkPermissionStatus();

  let statusText: string;

  if (!permissions.foreground) {
    statusText = 'Location permission not granted';
  } else if (preferredMode === 'background' && !permissions.background) {
    statusText = 'Background access not enabled. Nearby works while app is open.';
  } else if (effectiveMode === 'background' && permissions.background) {
    statusText = 'Background Nearby is active';
  } else {
    statusText = 'Using location while app is open';
  }

  return {
    preferredMode,
    effectiveMode,
    backgroundPermissionGranted: permissions.background,
    foregroundPermissionGranted: permissions.foreground,
    statusText,
  };
}

/**
 * Request permissions based on mode.
 * Returns the effective mode after permission request.
 *
 * FALLBACK: If background is requested but denied, returns 'foreground'.
 */
export async function requestLocationPermissions(
  mode: NearbyLocationMode
): Promise<{
  success: boolean;
  effectiveMode: NearbyLocationMode;
  backgroundDenied: boolean;
}> {
  try {
    // Always request foreground first
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      console.log('[LOCATION_MODE] Foreground permission denied');
      await setEffectiveLocationMode('foreground');
      return {
        success: false,
        effectiveMode: 'foreground',
        backgroundDenied: false,
      };
    }

    // If foreground mode requested, we're done
    if (mode === 'foreground') {
      await setEffectiveLocationMode('foreground');
      return {
        success: true,
        effectiveMode: 'foreground',
        backgroundDenied: false,
      };
    }

    // Request background permission
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status === 'granted') {
      await setEffectiveLocationMode('background');
      console.log('[LOCATION_MODE] Background permission granted');
      return {
        success: true,
        effectiveMode: 'background',
        backgroundDenied: false,
      };
    }

    // Background denied - fallback to foreground
    console.log('[LOCATION_MODE] Background denied, falling back to foreground');
    await setEffectiveLocationMode('foreground');
    return {
      success: true, // Foreground still works
      effectiveMode: 'foreground',
      backgroundDenied: true,
    };
  } catch (e: any) {
    console.warn('[LOCATION_MODE] Permission request error:', e?.message);
    await setEffectiveLocationMode('foreground');
    return {
      success: false,
      effectiveMode: 'foreground',
      backgroundDenied: false,
    };
  }
}

/**
 * Clear location mode settings (call on logout).
 */
export async function clearLocationModeSettings(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([LOCATION_MODE_KEY, EFFECTIVE_MODE_KEY]);
  } catch {
    // Silent failure
  }
}
