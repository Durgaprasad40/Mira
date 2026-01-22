import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';

interface LocationState {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  error: string | null;
  isLoading: boolean;
}

export function useLocation() {
  const [location, setLocation] = useState<LocationState>({
    latitude: null,
    longitude: null,
    city: null,
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

      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city,
        error: null,
        isLoading: false,
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        city,
      };
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
