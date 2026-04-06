/**
 * usePresenceAndLocation Hook
 *
 * ARCHITECTURE (Clean 3-Layer Design):
 *
 * 1. PRESENCE (Heartbeat) — sendHeartbeat()
 *    - Updates lastActive for "Online Now" display
 *    - Interval: 60 seconds (tight for real-time feel)
 *    - Throttle: Max 1 per 30 seconds
 *    - Threshold: < 5 min = Online Now
 *
 * 2. BACKEND LOCATION SYNC — syncLocationToBackendIfNeeded()
 *    - Updates latitude/longitude for server-side distance calculation
 *    - Triggers: Movement > 300m OR time > 5 minutes OR forced (foreground)
 *    - Used by: Matching engine, fallback distance
 *
 * 3. LIVE LOCATION (Instant UX) — handled by locationStore.refreshLocationCached()
 *    - Client-side GPS for instant Discover/DeepConnect distance
 *    - Triggered on screen focus with 45s cache
 *    - NOT handled here - see DiscoverCardStack focus effect
 *
 * 4. NEARBY PUBLISH — handled separately in nearby.tsx
 *    - Updates publishedLat/publishedLng for crossed paths
 *    - NOT handled here - Nearby has its own controlled refresh
 *
 * DEBUG TAGS:
 * - [PRESENCE] — heartbeat events
 * - [LOCATION_SYNC] — backend sync events
 *
 * Must be called from root _layout.tsx to work globally.
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { useLocationStore, calculateDistanceKm } from '@/stores/locationStore';
import { isDemoMode } from '@/hooks/useConvex';

// Heartbeat interval: 60 seconds (tight for real-time "Online Now" feel)
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

// Location sync throttle: 5 minutes time-based
const LOCATION_SYNC_THROTTLE_MS = 5 * 60 * 1000;

// Movement threshold: 300 meters (sync immediately if moved significantly)
const MOVEMENT_THRESHOLD_METERS = 300;

export function usePresenceAndLocation() {
  const { userId } = useAuthStore();
  const heartbeatMutation = useMutation(api.users.heartbeat);
  const updateLocationMutation = useMutation(api.users.updateLocation);

  const getBestLocation = useLocationStore((s) => s.getBestLocation);
  const refreshLocation = useLocationStore((s) => s.refreshLocation);
  const permissionStatus = useLocationStore((s) => s.permissionStatus);

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncTimeRef = useRef<number>(0);
  const lastSyncedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastHeartbeatRef = useRef<number>(0);

  // Send heartbeat to backend (presence only - no location)
  const sendHeartbeat = useCallback(async () => {
    if (isDemoMode || !userId) return;

    const now = Date.now();
    // Throttle heartbeats to max 1 per 30 seconds (tight for real-time feel)
    if (now - lastHeartbeatRef.current < 30_000) {
      return; // Silent throttle - don't log every time
    }

    try {
      lastHeartbeatRef.current = now;
      await heartbeatMutation({ authUserId: userId });

      if (__DEV__) {
        console.log('[PRESENCE] Heartbeat sent', {
          userId: userId.slice(-8),
          heartbeatAgeMs: 0,
          resolvedStatus: 'online_now',
          source: 'heartbeat_mutation',
          appState: 'active',
        });
      }
    } catch (err) {
      // Silent failure - don't break app
    }
  }, [userId, heartbeatMutation]);

  // Sync location to backend (movement-based + time-based)
  // This updates latitude/longitude for server-side distance calculation
  const syncLocationToBackendIfNeeded = useCallback(async (force = false) => {
    if (isDemoMode || !userId) return;
    if (permissionStatus !== 'granted') {
      if (__DEV__) {
        console.log('[LOCATION_SYNC] Skipped: permission not granted');
      }
      return;
    }

    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTimeRef.current;

    // Get current location
    const coords = getBestLocation();
    if (!coords) {
      if (__DEV__) {
        console.log('[LOCATION_SYNC] No location available');
      }
      return;
    }

    // Check if we should sync (movement-based OR time-based)
    let shouldSync = force;
    let syncReason = force ? 'forced' : '';

    if (!shouldSync && lastSyncedCoordsRef.current) {
      // Movement-based check: sync if moved > 300m
      const distanceMoved = calculateDistanceKm(
        lastSyncedCoordsRef.current.lat,
        lastSyncedCoordsRef.current.lng,
        coords.latitude,
        coords.longitude
      ) * 1000; // Convert to meters

      if (distanceMoved > MOVEMENT_THRESHOLD_METERS) {
        shouldSync = true;
        syncReason = `movement:${Math.round(distanceMoved)}m`;
      }
    }

    if (!shouldSync) {
      // Time-based check: sync if > 5 minutes since last sync
      if (timeSinceLastSync > LOCATION_SYNC_THROTTLE_MS) {
        shouldSync = true;
        syncReason = `time:${Math.round(timeSinceLastSync / 1000)}s`;
      }
    }

    // First sync (no previous coords)
    if (!shouldSync && !lastSyncedCoordsRef.current) {
      shouldSync = true;
      syncReason = 'initial';
    }

    if (!shouldSync) {
      return; // Silent skip - no need to log every time
    }

    try {
      await updateLocationMutation({
        authUserId: userId,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });

      // Update refs on success
      lastSyncTimeRef.current = now;
      lastSyncedCoordsRef.current = { lat: coords.latitude, lng: coords.longitude };

      if (__DEV__) {
        console.log('[LOCATION_SYNC] Backend updated', {
          reason: syncReason,
          lat: coords.latitude.toFixed(4),
          lng: coords.longitude.toFixed(4),
          permission: permissionStatus,
        });
      }
    } catch (err) {
      if (__DEV__) {
        console.warn('[LOCATION_SYNC] Failed', { error: String(err) });
      }
    }
  }, [userId, permissionStatus, getBestLocation, updateLocationMutation]);

  // Handle app state changes
  useEffect(() => {
    if (isDemoMode || !userId) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        if (__DEV__) {
          console.log('[PRESENCE] App became active, sending heartbeat + syncing location');
        }
        // App came to foreground - send heartbeat and sync location to backend
        sendHeartbeat();
        syncLocationToBackendIfNeeded(true); // Force sync on foreground
      }
    };

    // Subscribe to app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Initial heartbeat and location on mount
    if (AppState.currentState === 'active') {
      sendHeartbeat();
      syncLocationToBackendIfNeeded(true); // Force initial sync
    }

    // Start heartbeat interval (presence only)
    heartbeatIntervalRef.current = setInterval(() => {
      if (AppState.currentState === 'active') {
        sendHeartbeat();
        // Also check for location sync (movement-based + time-based)
        syncLocationToBackendIfNeeded(false);
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      subscription.remove();
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [userId, sendHeartbeat, syncLocationToBackendIfNeeded]);

  // No return value - this hook just runs side effects
}
