/**
 * locationStore — Centralized location management for instant Nearby tab opening.
 *
 * This store prewarms location data on app boot so that Nearby can render
 * immediately without blocking on GPS acquisition.
 *
 * Flow:
 * 1. App boots → startLocationTracking() is called
 * 2. Immediately fetches lastKnownPosition (fast, cached GPS)
 * 3. Starts watchPosition for live updates
 * 4. Nearby screen reads from this store — no local GPS calls needed
 */
import { create } from 'zustand';
import * as Location from 'expo-location';
import { AppState, AppStateStatus } from 'react-native';
import { log } from '@/utils/logger';
import { markTiming } from '@/utils/startupTiming';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionStatus = 'unknown' | 'granted' | 'denied';

export interface LocationCoords {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number;
}

interface LocationState {
  /** Current permission status */
  permissionStatus: PermissionStatus;

  /** Last known position (fast, from cache) — available almost instantly */
  lastKnownLocation: LocationCoords | null;

  /** Current GPS position (from watch) — updated continuously */
  currentLocation: LocationCoords | null;

  /** City name from reverse geocoding (optional) */
  city: string | null;

  /** Whether location tracking is active */
  isTracking: boolean;

  /** Error message if location fails */
  error: string | null;

  /** Fetch last known position only (fast, no continuous tracking) */
  fetchLastKnownOnly: () => Promise<void>;

  /** Start full location tracking — call when Nearby tab opens */
  startLocationTracking: () => Promise<void>;

  /** Stop location tracking — call on app unmount (optional) */
  stopLocationTracking: () => void;

  /** Force refresh current location (manual refresh button) */
  refreshLocation: () => Promise<LocationCoords | null>;

  /** Get best available location (current > lastKnown > null) */
  getBestLocation: () => LocationCoords | null;
}

// ---------------------------------------------------------------------------
// Module-level state for watch subscription
// ---------------------------------------------------------------------------

let watchSubscription: Location.LocationSubscription | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useLocationStore = create<LocationState>((set, get) => ({
  permissionStatus: 'unknown',
  lastKnownLocation: null,
  currentLocation: null,
  city: null,
  isTracking: false,
  error: null,

  // Fast: fetch last known position only, no continuous tracking
  // Called on app boot for quick map display without blocking startup
  fetchLastKnownOnly: async () => {
    try {
      // Check permission first (don't request, just check)
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        set({ permissionStatus: 'denied' });
        return;
      }
      set({ permissionStatus: 'granted' });

      // Get cached/last known position (very fast, no GPS wait)
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown) {
        const coords: LocationCoords = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          timestamp: lastKnown.timestamp,
          accuracy: lastKnown.coords.accuracy ?? undefined,
        };
        set({ lastKnownLocation: coords });
        log.info('[LOCATION]', 'lastKnown fetched (fast path)', {
          lat: coords.latitude.toFixed(4),
          lng: coords.longitude.toFixed(4),
        });
      }
    } catch (e) {
      // Silent failure — this is non-blocking
      log.info('[LOCATION]', 'fetchLastKnownOnly failed (non-critical)');
    }
  },

  startLocationTracking: async () => {
    const state = get();

    // Prevent double-start
    if (state.isTracking) {
      log.info('[LOCATION]', 'tracking already active, skipping start');
      return;
    }

    // BUGFIX #4: Clean up any orphaned subscriptions from previous runs
    // (e.g., hot reload, store recreation). This prevents GPS listener leaks.
    if (watchSubscription) {
      watchSubscription.remove();
      watchSubscription = null;
      log.info('[LOCATION]', 'cleaned up orphaned watch subscription');
    }
    if (appStateSubscription) {
      appStateSubscription.remove();
      appStateSubscription = null;
      log.info('[LOCATION]', 'cleaned up orphaned appState subscription');
    }

    set({ isTracking: true, error: null });
    log.info('[LOCATION]', 'starting location tracking');
    // Milestone F: location start
    markTiming('location_start');

    try {
      // 1. Check/request permission
      let { status } = await Location.getForegroundPermissionsAsync();

      if (status !== 'granted') {
        const result = await Location.requestForegroundPermissionsAsync();
        status = result.status;
      }

      if (status !== 'granted') {
        set({
          permissionStatus: 'denied',
          isTracking: false,
          error: 'Location permission denied',
        });
        log.warn('[LOCATION]', 'permission denied');
        return;
      }

      set({ permissionStatus: 'granted' });

      // 2. Get last known position immediately (fast, cached)
      try {
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown) {
          const coords: LocationCoords = {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
            timestamp: lastKnown.timestamp,
            accuracy: lastKnown.coords.accuracy ?? undefined,
          };
          set({ lastKnownLocation: coords });
          log.info('[LOCATION]', 'lastKnown acquired', {
            lat: coords.latitude.toFixed(4),
            lng: coords.longitude.toFixed(4),
          });
        }
      } catch (e) {
        // lastKnown may not be available, that's okay
        log.info('[LOCATION]', 'lastKnown not available');
      }

      // 3. Start watching position for live updates
      watchSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 50, // Update every 50 meters
          timeInterval: 10000, // Or every 10 seconds
        },
        (position) => {
          const coords: LocationCoords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: position.timestamp,
            accuracy: position.coords.accuracy ?? undefined,
          };

          // Validate coordinates
          if (
            Number.isNaN(coords.latitude) ||
            Number.isNaN(coords.longitude)
          ) {
            log.warn('[LOCATION]', 'received invalid coordinates, ignoring');
            return;
          }

          set({ currentLocation: coords, error: null });

          // Also update lastKnown for persistence across app restarts
          set({ lastKnownLocation: coords });
        }
      );

      // 4. Also fetch current position once for faster initial display
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const coords: LocationCoords = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
          timestamp: current.timestamp,
          accuracy: current.coords.accuracy ?? undefined,
        };

        // Validate
        if (!Number.isNaN(coords.latitude) && !Number.isNaN(coords.longitude)) {
          set({ currentLocation: coords, lastKnownLocation: coords });
          log.info('[LOCATION]', 'current position acquired', {
            lat: coords.latitude.toFixed(4),
            lng: coords.longitude.toFixed(4),
          });
          // Milestone F: location first fix
          markTiming('location_fix');

          // Reverse geocode for city name
          try {
            const [address] = await Location.reverseGeocodeAsync({
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
            const city = address?.city || address?.subregion || address?.region || null;
            set({ city });
          } catch {
            // Geocoding failed, no city name
          }
        }
      } catch (e) {
        // Current position failed but watch is still running
        log.warn('[LOCATION]', 'getCurrentPosition failed', { error: String(e) });
      }

      // 5. Setup AppState listener for foreground resume
      if (!appStateSubscription) {
        appStateSubscription = AppState.addEventListener(
          'change',
          (nextAppState: AppStateStatus) => {
            if (nextAppState === 'active') {
              // App came to foreground — refresh location
              get().refreshLocation();
            }
          }
        );
      }

      log.info('[LOCATION]', 'tracking started successfully');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to start location tracking';
      set({ error: errorMsg, isTracking: false });
      log.error('[LOCATION]', 'startTracking failed', { error: errorMsg });
    }
  },

  stopLocationTracking: () => {
    if (watchSubscription) {
      watchSubscription.remove();
      watchSubscription = null;
    }

    if (appStateSubscription) {
      appStateSubscription.remove();
      appStateSubscription = null;
    }

    set({ isTracking: false });
    log.info('[LOCATION]', 'tracking stopped');
  },

  refreshLocation: async () => {
    const state = get();

    if (state.permissionStatus !== 'granted') {
      return null;
    }

    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const coords: LocationCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: position.timestamp,
        accuracy: position.coords.accuracy ?? undefined,
      };

      // Validate
      if (Number.isNaN(coords.latitude) || Number.isNaN(coords.longitude)) {
        return null;
      }

      set({ currentLocation: coords, lastKnownLocation: coords, error: null });

      // Update city name
      try {
        const [address] = await Location.reverseGeocodeAsync({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        const city = address?.city || address?.subregion || address?.region || null;
        set({ city });
      } catch {
        // Geocoding failed
      }

      return coords;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to refresh location';
      set({ error: errorMsg });
      return null;
    }
  },

  getBestLocation: () => {
    const state = get();
    return state.currentLocation || state.lastKnownLocation;
  },
}));

/**
 * Hook to get the best available location for immediate use.
 * Returns currentLocation if available, else lastKnownLocation.
 */
export function useBestLocation(): LocationCoords | null {
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const lastKnownLocation = useLocationStore((s) => s.lastKnownLocation);
  return currentLocation || lastKnownLocation;
}
