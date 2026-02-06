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
    watchLocation,
  };
}
