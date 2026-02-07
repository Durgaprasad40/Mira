import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';

interface LocationState {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  error: string | null;
  isLoading: boolean;
}

// ── Module-level location cache ─────────────────────────────────
// Persists across hook instances and component remounts
interface CachedLocation {
  latitude: number;
  longitude: number;
  city: string | null;
  timestamp: number;
}

let __cachedLocation: CachedLocation | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FORCE_LOCATION_TIMEOUT_MS = 10000; // 10 seconds timeout for forced location fetch

/** Get the cached location if available and not stale. */
export function getCachedLocation(): CachedLocation | null {
  if (!__cachedLocation) return null;
  const age = Date.now() - __cachedLocation.timestamp;
  if (age > CACHE_TTL_MS) return null;
  return __cachedLocation;
}

/** Check if we have a valid cached location. */
export function hasCachedLocation(): boolean {
  return getCachedLocation() !== null;
}

export function useLocation() {
  // Initialize with cached location if available
  const cached = getCachedLocation();
  const [location, setLocation] = useState<LocationState>({
    latitude: cached?.latitude ?? null,
    longitude: cached?.longitude ?? null,
    city: cached?.city ?? null,
    error: null,
    isLoading: false,
  });

  const requestPermission = async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      return false;
    }
  };

  const requestBackgroundPermission = async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      return false;
    }
  };

  const getCurrentLocation = useCallback(async () => {
    setLocation((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocation((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Location permission not granted',
        }));
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // Reverse geocode to get city
      let city = null;
      try {
        const [address] = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        city = address?.city || address?.subregion || address?.region || null;
      } catch (e) {
        // Geocoding failed, but we still have coordinates
      }

      const newLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city,
      };

      // Update cache
      __cachedLocation = {
        ...newLocation,
        timestamp: Date.now(),
      };

      setLocation({
        ...newLocation,
        error: null,
        isLoading: false,
      });

      return newLocation;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get location';
      setLocation((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return null;
    }
  }, []);

  /**
   * Force get a fresh GPS location bypassing cache.
   * Uses high accuracy and includes a timeout wrapper.
   * Returns the new location or null if failed/denied.
   */
  const forceGetCurrentLocation = useCallback(async (
    timeoutMs: number = FORCE_LOCATION_TIMEOUT_MS,
  ): Promise<{ latitude: number; longitude: number; city: string | null } | null> => {
    // 6-1: Clear previous error state when re-requesting
    setLocation((prev) => ({ ...prev, isLoading: true, error: null }));

    // 6-2: Track timeout ID for cleanup
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    try {
      // Check permission first
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Try to request permission
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        if (newStatus !== 'granted') {
          setLocation((prev) => ({
            ...prev,
            isLoading: false,
            error: 'Location permission denied',
          }));
          return null;
        }
        // 6-1: Permission was granted, don't keep denied error
      }

      // Create a promise race between location fetch and timeout
      const locationPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: true,
      });

      // 6-2: Properly clean up timeout when location resolves
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!resolved) {
            reject(new Error('Location request timed out'));
          }
        }, timeoutMs);
      });

      const position = await Promise.race([locationPromise, timeoutPromise]);

      // 6-2: Mark resolved and clear timeout to prevent stray callback
      resolved = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // 6-4: Validate coordinates are not NaN
      if (
        typeof position.coords.latitude !== 'number' ||
        typeof position.coords.longitude !== 'number' ||
        Number.isNaN(position.coords.latitude) ||
        Number.isNaN(position.coords.longitude)
      ) {
        setLocation((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Invalid location coordinates received',
        }));
        return null;
      }

      // Reverse geocode to get city
      let city = null;
      try {
        const [address] = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        city = address?.city || address?.subregion || address?.region || null;
      } catch {
        // Geocoding failed, but we still have coordinates
      }

      const newLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city,
      };

      // Update cache with fresh location
      __cachedLocation = {
        ...newLocation,
        timestamp: Date.now(),
      };

      setLocation({
        ...newLocation,
        error: null,
        isLoading: false,
      });

      return newLocation;
    } catch (error) {
      // 6-2: Clean up timeout on error path as well
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const errorMessage = error instanceof Error ? error.message : 'Failed to get location';
      setLocation((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return null;
    }
  }, []);

  const watchLocation = useCallback(async (
    onUpdate: (location: { latitude: number; longitude: number }) => void
  ) => {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }

    return Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 100, // Update every 100 meters
        timeInterval: 60000, // Or every minute
      },
      (position) => {
        onUpdate({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      }
    );
  }, []);

  return {
    ...location,
    requestPermission,
    requestBackgroundPermission,
    getCurrentLocation,
    forceGetCurrentLocation,
    watchLocation,
  };
}
