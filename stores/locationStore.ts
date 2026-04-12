/**
 * locationStore — Centralized location management for all location needs.
 *
 * FUNCTION RESPONSIBILITIES:
 *
 * 1. getBestLocation()
 *    - Returns current GPS or last known (no network, instant)
 *    - Used for: Immediate distance calculation
 *
 * 2. refreshLocation()
 *    - Forces a fresh GPS acquisition (blocking)
 *    - Updates currentLocation + lastKnownLocation in store
 *    - Used for: Manual refresh, background updates
 *
 * 3. refreshLocationCached({ allowBackgroundFreshen })
 *    - Two-step refresh for screen focus events:
 *      a) Fresh cache (<20s): Return immediately, no GPS call
 *      b) Stale cache (20-45s): Return immediately + silent background freshen
 *      c) Expired cache (>45s) or no cache: Blocking refresh
 *    - Used for: Discover/DeepConnect screen focus
 *
 * 4. startLocationTracking() / stopLocationTracking()
 *    - Manages continuous GPS watch subscription
 *    - Used for: Nearby map, background updates
 *
 * CACHE STATE (store-owned, not module-level):
 * - lastLiveRefreshAt: Timestamp of last successful GPS acquisition
 * - lastBackgroundFreshenAt: Timestamp of last background freshen attempt
 * - isRefreshingLive: Guard against overlapping GPS requests
 *
 * DEBUG TAGS: [LIVE_LOCATION], [LOCATION]
 */
import { create } from 'zustand';
import * as Location from 'expo-location';
import { AppState, AppStateStatus } from 'react-native';
import { log } from '@/utils/logger';
import { markTiming } from '@/utils/startupTiming';

// ---------------------------------------------------------------------------
// GPS Jitter Protection Constants
// ---------------------------------------------------------------------------

/** Maximum acceptable accuracy in meters (reject points worse than this) */
const MAX_ACCEPTABLE_ACCURACY_METERS = 80;

/** Minimum movement in meters to consider as real movement (not jitter) */
const MIN_MOVEMENT_METERS = 30;

/** Maximum realistic speed in meters per second (~200 km/h for edge cases like trains) */
const MAX_SPEED_METERS_PER_SEC = 55; // ~200 km/h

/** Minimum time gap to consider for speed check (avoid division by tiny values) */
const MIN_TIME_GAP_MS = 1000; // 1 second

// ---------------------------------------------------------------------------
// Live Location Cache Constants (for Discover/DeepConnect instant UX)
// ---------------------------------------------------------------------------

/** Cache freshness window: skip GPS fetch if refreshed within this time */
const LIVE_REFRESH_CACHE_MS = 45 * 1000; // 45 seconds

/** Stale-but-usable window: return cached but trigger background freshen */
const LIVE_STALE_THRESHOLD_MS = 20 * 1000; // 20 seconds

/** Minimum gap between background freshens to prevent spam */
const BACKGROUND_FRESHEN_THROTTLE_MS = 10 * 1000; // 10 seconds

// ---------------------------------------------------------------------------
// GPS Jitter Protection Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate distance between two coordinates in meters using Haversine formula.
 */
function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Validate a new location point against the last accepted point.
 * Returns { valid: true } if acceptable, or { valid: false, reason: string } if rejected.
 */
function validateLocationUpdate(
  newCoords: LocationCoords,
  lastAccepted: LocationCoords | null
): { valid: true } | { valid: false; reason: string } {
  // 1. Accuracy filter: reject low-accuracy points
  if (newCoords.accuracy !== undefined && newCoords.accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) {
    return { valid: false, reason: `accuracy_too_low:${newCoords.accuracy?.toFixed(0)}m` };
  }

  // If no previous point, accept this one (with accuracy check above)
  if (!lastAccepted) {
    return { valid: true };
  }

  // 2. Timestamp ordering: reject points older than last accepted
  if (newCoords.timestamp <= lastAccepted.timestamp) {
    return { valid: false, reason: 'out_of_order_timestamp' };
  }

  // Calculate distance and time gap
  const distance = calculateDistanceMeters(
    lastAccepted.latitude,
    lastAccepted.longitude,
    newCoords.latitude,
    newCoords.longitude
  );
  const timeGapMs = newCoords.timestamp - lastAccepted.timestamp;

  // 3. Speed sanity check: reject impossible jumps
  if (timeGapMs >= MIN_TIME_GAP_MS) {
    const speedMps = distance / (timeGapMs / 1000);
    if (speedMps > MAX_SPEED_METERS_PER_SEC) {
      return {
        valid: false,
        reason: `impossible_speed:${(speedMps * 3.6).toFixed(0)}km/h`,
      };
    }
  }

  // 4. Minimum movement threshold: if movement is tiny, it might be jitter
  // We still accept the point, but log it (the caller can decide to not trigger actions)
  // Note: We accept tiny movements for map updates, but the server will filter for crossed paths

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'restricted' | 'services_disabled';

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

  // ---------------------------------------------------------------------------
  // Live Location Cache State (store-owned, not module-level)
  // ---------------------------------------------------------------------------

  /** Timestamp of last successful live location refresh */
  lastLiveRefreshAt: number;

  /** Timestamp of last background freshen attempt */
  lastBackgroundFreshenAt: number;

  /** Whether a live GPS refresh is currently in progress (prevents overlapping) */
  isRefreshingLive: boolean;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

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

  /** Age of the live location cache in milliseconds, or null if unavailable */
  getLocationCacheAgeMs: () => number | null;

  /** Whether the current cached location is still usable for fast screen revisit */
  hasUsableLocationCache: () => boolean;

  /**
   * Two-step refresh for screen focus events (Discover/DeepConnect):
   * 1. Returns cached location immediately if fresh (< 45s) — fast UX
   * 2. If cache is stale-but-usable (20-45s), returns cached + triggers silent background freshen
   * 3. If no cache or expired, performs blocking refresh
   *
   * Options:
   * - allowBackgroundFreshen: If true, triggers silent freshen when cache is stale-but-usable
   */
  refreshLocationCached: (options?: { allowBackgroundFreshen?: boolean }) => Promise<LocationCoords | null>;
}

// ---------------------------------------------------------------------------
// Module-level state for watch subscription
// ---------------------------------------------------------------------------

let watchSubscription: Location.LocationSubscription | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let trackingSessionGeneration = 0;

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

  // Live location cache state (store-owned)
  lastLiveRefreshAt: 0,
  lastBackgroundFreshenAt: 0,
  isRefreshingLive: false,

  // Fast: fetch last known position only, no continuous tracking
  // Called on app boot for quick map display without blocking startup
  fetchLastKnownOnly: async () => {
    try {
      // Check permission first (don't request, just check)
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
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
    const sessionGeneration = ++trackingSessionGeneration;
    const isCurrentSession = () => sessionGeneration === trackingSessionGeneration;
    let pendingWatchSubscription: Location.LocationSubscription | null = null;
    let pendingAppStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

    const cleanupPendingSubscriptions = () => {
      if (pendingWatchSubscription) {
        pendingWatchSubscription.remove();
        pendingWatchSubscription = null;
      }
      if (pendingAppStateSubscription) {
        pendingAppStateSubscription.remove();
        pendingAppStateSubscription = null;
      }
    };

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
      // 0. Check if location services are enabled system-wide
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!isCurrentSession()) {
        cleanupPendingSubscriptions();
        return;
      }
      if (!servicesEnabled) {
        set({
          permissionStatus: 'services_disabled',
          isTracking: false,
          error: 'Location services are disabled on this device',
        });
        log.warn('[LOCATION]', 'location services disabled');
        return;
      }

      // 1. Check/request permission
      let { status } = await Location.getForegroundPermissionsAsync();
      if (!isCurrentSession()) {
        cleanupPendingSubscriptions();
        return;
      }

      if (status !== 'granted') {
        const result = await Location.requestForegroundPermissionsAsync();
        if (!isCurrentSession()) {
          cleanupPendingSubscriptions();
          return;
        }
        status = result.status;
      }

      // Handle iOS restricted status (parental controls)
      if (status === 'denied') {
        // Check if it's actually restricted (iOS-specific)
        const { ios } = await Location.getForegroundPermissionsAsync();
        if (!isCurrentSession()) {
          cleanupPendingSubscriptions();
          return;
        }
        const isRestricted = ios?.scope === 'none';

        set({
          permissionStatus: isRestricted ? 'restricted' : 'denied',
          isTracking: false,
          error: isRestricted
            ? 'Location access is restricted on this device'
            : 'Location permission denied',
        });
        log.warn('[LOCATION]', isRestricted ? 'permission restricted' : 'permission denied');
        return;
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
      // Battery-optimized: 100m distance, 30s time interval
      pendingWatchSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 100, // Update every 100 meters (was 50)
          timeInterval: 30000, // Or every 30 seconds (was 10)
        },
        (position) => {
          if (!isCurrentSession()) {
            return;
          }

          const coords: LocationCoords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: position.timestamp,
            accuracy: position.coords.accuracy ?? undefined,
          };

          // Basic coordinate validation (NaN check)
          if (
            Number.isNaN(coords.latitude) ||
            Number.isNaN(coords.longitude)
          ) {
            log.warn('[LOCATION]', 'received invalid coordinates, ignoring');
            return;
          }

          // GPS jitter protection: validate against last accepted point
          const lastAccepted = get().currentLocation;
          const validation = validateLocationUpdate(coords, lastAccepted);

          if (!validation.valid) {
            log.info('[LOCATION]', `rejected GPS point: ${validation.reason}`, {
              lat: coords.latitude.toFixed(4),
              lng: coords.longitude.toFixed(4),
              accuracy: coords.accuracy?.toFixed(0),
            });
            return;
          }

          set({ currentLocation: coords, error: null });

          // Also update lastKnown for persistence across app restarts
          set({ lastKnownLocation: coords });
        }
      );
      if (!isCurrentSession()) {
        cleanupPendingSubscriptions();
        return;
      }
      watchSubscription = pendingWatchSubscription;
      pendingWatchSubscription = null;

      // 4. Also fetch current position once for faster initial display
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!isCurrentSession()) {
          cleanupPendingSubscriptions();
          return;
        }

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
        if (!isCurrentSession()) {
          cleanupPendingSubscriptions();
          return;
        }
        // Current position failed but watch is still running
        log.warn('[LOCATION]', 'getCurrentPosition failed', { error: String(e) });
      }

      // 5. Setup AppState listener for foreground resume
      if (!appStateSubscription) {
        pendingAppStateSubscription = AppState.addEventListener(
          'change',
          (nextAppState: AppStateStatus) => {
            if (!isCurrentSession()) {
              return;
            }
            if (nextAppState === 'active') {
              // App came to foreground — refresh location
              get().refreshLocation();
            }
          }
        );
        if (!isCurrentSession()) {
          cleanupPendingSubscriptions();
          return;
        }
        appStateSubscription = pendingAppStateSubscription;
        pendingAppStateSubscription = null;
      }

      if (!isCurrentSession()) {
        cleanupPendingSubscriptions();
        return;
      }
      log.info('[LOCATION]', 'tracking started successfully');
    } catch (e) {
      cleanupPendingSubscriptions();
      if (!isCurrentSession()) {
        return;
      }
      const errorMsg = e instanceof Error ? e.message : 'Failed to start location tracking';
      set({ error: errorMsg, isTracking: false });
      log.error('[LOCATION]', 'startTracking failed', { error: errorMsg });
    }
  },

  stopLocationTracking: () => {
    trackingSessionGeneration += 1;

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

  getLocationCacheAgeMs: () => {
    const state = get();
    const cached = state.getBestLocation();
    if (!cached || !state.lastLiveRefreshAt) {
      return null;
    }
    return Date.now() - state.lastLiveRefreshAt;
  },

  hasUsableLocationCache: () => {
    const state = get();
    const cacheAgeMs = state.getLocationCacheAgeMs();
    return cacheAgeMs !== null && cacheAgeMs < LIVE_REFRESH_CACHE_MS;
  },

  // ---------------------------------------------------------------------------
  // LIVE_LOCATION: Two-step cached refresh for screen focus events
  // ---------------------------------------------------------------------------
  // Step 1: Return cached location immediately if fresh (fast UX)
  // Step 2: If stale-but-usable, return cached + trigger silent background freshen
  // Step 3: If no cache or expired, perform blocking refresh
  // ---------------------------------------------------------------------------
  refreshLocationCached: async (options = {}) => {
    const { allowBackgroundFreshen = false } = options;
    const state = get();
    const now = Date.now();
    const timeSinceLastRefresh = now - state.lastLiveRefreshAt;
    const cached = state.getBestLocation();

    // Guard: If already refreshing, return cached immediately (no overlap)
    if (state.isRefreshingLive) {
      if (__DEV__) {
        log.info('[LIVE_LOCATION]', 'refresh already in progress, returning cached');
      }
      return cached;
    }

    // CASE 1: Cache is fresh (< 20s) — return immediately, no freshen needed
    if (cached && timeSinceLastRefresh < LIVE_STALE_THRESHOLD_MS) {
      if (__DEV__) {
        log.info('[LIVE_LOCATION]', 'cache fresh, returning immediately', {
          cacheAgeMs: timeSinceLastRefresh,
          lat: cached.latitude.toFixed(4),
        });
      }
      return cached;
    }

    // CASE 2: Cache is stale-but-usable (20-45s) — return cached + background freshen
    if (cached && timeSinceLastRefresh < LIVE_REFRESH_CACHE_MS) {
      if (__DEV__) {
        log.info('[LIVE_LOCATION]', 'cache stale but usable, returning + scheduling freshen', {
          cacheAgeMs: timeSinceLastRefresh,
          lat: cached.latitude.toFixed(4),
        });
      }

      // Trigger silent background freshen if allowed and not recently done
      if (allowBackgroundFreshen) {
        const timeSinceLastFreshen = now - state.lastBackgroundFreshenAt;
        if (timeSinceLastFreshen >= BACKGROUND_FRESHEN_THROTTLE_MS) {
          set({ lastBackgroundFreshenAt: now });

          // Fire-and-forget background refresh (no await, no blocking)
          (async () => {
            // Double-check guard before starting
            if (get().isRefreshingLive) return;

            set({ isRefreshingLive: true });
            try {
              const freshResult = await get().refreshLocation();
              if (freshResult) {
                set({ lastLiveRefreshAt: Date.now() });
                if (__DEV__) {
                  log.info('[LIVE_LOCATION]', 'background freshen complete', {
                    lat: freshResult.latitude.toFixed(4),
                  });
                }
              }
            } finally {
              set({ isRefreshingLive: false });
            }
          })();
        } else if (__DEV__) {
          log.info('[LIVE_LOCATION]', 'background freshen throttled', {
            timeSinceLastFreshenMs: timeSinceLastFreshen,
          });
        }
      }

      return cached;
    }

    // CASE 3: No cache or cache expired (> 45s) — perform blocking refresh
    set({ isRefreshingLive: true });
    try {
      const result = await get().refreshLocation();

      if (result) {
        set({ lastLiveRefreshAt: now });
        if (__DEV__) {
          log.info('[LIVE_LOCATION]', 'fresh GPS acquired (blocking)', {
            trigger: cached ? 'cache_expired' : 'no_cache',
            lat: result.latitude.toFixed(4),
          });
        }
      }

      return result;
    } finally {
      set({ isRefreshingLive: false });
    }
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

/**
 * Calculate distance in km between two coordinates using Haversine formula.
 * Used for instant client-side distance calculation in Discover/DeepConnect.
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Hook to calculate live distance from current GPS to a profile.
 * Returns distance in km, or undefined if location not available.
 *
 * INSTANT UX: This uses live GPS, not backend distance.
 * Use this in Discover/DeepConnect for instant distance display.
 */
export function useLiveDistance(profileLat?: number, profileLng?: number): number | undefined {
  const bestLocation = useBestLocation();

  if (!bestLocation || profileLat === undefined || profileLng === undefined) {
    return undefined;
  }

  const distance = calculateDistanceKm(
    bestLocation.latitude,
    bestLocation.longitude,
    profileLat,
    profileLng
  );

  return Math.round(distance * 10) / 10; // Round to 1 decimal
}
