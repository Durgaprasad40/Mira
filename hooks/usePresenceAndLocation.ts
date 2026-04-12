/**
 * usePresenceAndLocation Hook
 *
 * ARCHITECTURE (Clean 3-Layer Design):
 *
 * 1. PRESENCE (P0 Unified System) — usePresenceHeartbeat()
 *    - Uses new unified presence table (convex/presence.ts)
 *    - Updates presence.lastSeenAt AND presence.appState
 *    - Interval: 30 seconds (as specified in P0 requirements)
 *    - Thresholds: < 10 min foreground = Online Now, < 24h = Active Today
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
 * - [PRESENCE] — heartbeat events (now uses P0 unified system)
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
import { DEBUG_PRESENCE, DEBUG_LOCATION } from '@/lib/debugFlags';

// P0: Heartbeat interval: 30 seconds (unified presence system)
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Location sync throttle: 5 minutes time-based
const LOCATION_SYNC_THROTTLE_MS = 5 * 60 * 1000;

// Movement threshold: 300 meters (sync immediately if moved significantly)
const MOVEMENT_THRESHOLD_METERS = 300;

export function usePresenceAndLocation() {
  const { userId, token } = useAuthStore();
  // P0: Use new unified presence mutations
  const markActiveMutation = useMutation(api.presence.markActive);
  const markBackgroundMutation = useMutation(api.presence.markBackground);
  const updateLocationMutation = useMutation(api.users.updateLocation);

  const getBestLocation = useLocationStore((s) => s.getBestLocation);
  const refreshLocation = useLocationStore((s) => s.refreshLocation);
  const permissionStatus = useLocationStore((s) => s.permissionStatus);

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncTimeRef = useRef<number>(0);
  const lastSyncedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastHeartbeatRef = useRef<number>(0);
  const currentAppStateRef = useRef<AppStateStatus>(AppState.currentState);

  // P0: Send presence heartbeat (markActive) to unified presence table
  const sendHeartbeat = useCallback(async () => {
    if (isDemoMode || !userId || !token) return;

    const now = Date.now();
    // Throttle heartbeats to max 1 per 20 seconds
    if (now - lastHeartbeatRef.current < 20_000) {
      return; // Silent throttle - don't log every time
    }

    try {
      lastHeartbeatRef.current = now;
      await markActiveMutation({ token });

      // LOG_NOISE_FIX: Heartbeat logging gated behind DEBUG_PRESENCE
      if (__DEV__ && DEBUG_PRESENCE) {
        console.log(`[PRESENCE] markActive: ${userId.slice(-6)}`);
      }
    } catch (err) {
      // Silent failure - don't break app
      if (__DEV__ && DEBUG_PRESENCE) {
        console.warn('[PRESENCE] markActive failed:', String(err).slice(0, 50));
      }
    }
  }, [userId, token, markActiveMutation]);

  // P0: Mark user as in background state
  const markBackground = useCallback(async () => {
    if (isDemoMode || !userId || !token) return;

    try {
      await markBackgroundMutation({ token });

      if (__DEV__ && DEBUG_PRESENCE) {
        console.log(`[PRESENCE] markBackground: ${userId.slice(-6)}`);
      }
    } catch (err) {
      // Silent failure
      if (__DEV__ && DEBUG_PRESENCE) {
        console.warn('[PRESENCE] markBackground failed:', String(err).slice(0, 50));
      }
    }
  }, [userId, token, markBackgroundMutation]);

  // Sync location to backend (movement-based + time-based)
  // This updates latitude/longitude for server-side distance calculation
  const syncLocationToBackendIfNeeded = useCallback(async (force = false) => {
    if (isDemoMode || !userId || !token) return;
    if (permissionStatus !== 'granted') {
      // LOG_NOISE_FIX: Gated behind DEBUG_LOCATION
      if (__DEV__ && DEBUG_LOCATION) {
        console.log('[LOCATION] skip: no permission');
      }
      return;
    }

    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTimeRef.current;

    // Get current location
    const coords = getBestLocation();
    if (!coords) {
      // LOG_NOISE_FIX: Gated behind DEBUG_LOCATION
      if (__DEV__ && DEBUG_LOCATION) {
        console.log('[LOCATION] skip: no coords');
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
        token,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });

      // Update refs on success
      lastSyncTimeRef.current = now;
      lastSyncedCoordsRef.current = { lat: coords.latitude, lng: coords.longitude };

      // LOG_NOISE_FIX: Gated behind DEBUG_LOCATION
      if (__DEV__ && DEBUG_LOCATION) {
        console.log(`[LOCATION] synced: ${syncReason}`);
      }
    } catch (err) {
      // Keep warning - actual error is important
      if (__DEV__) {
        console.warn('[LOCATION] sync failed:', String(err).slice(0, 50));
      }
    }
  }, [userId, token, permissionStatus, getBestLocation, updateLocationMutation]);

  // Handle app state changes
  useEffect(() => {
    if (isDemoMode || !userId) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const prevAppState = currentAppStateRef.current;
      currentAppStateRef.current = nextAppState;

      if (nextAppState === 'active') {
        // LOG_NOISE_FIX: App foreground is very frequent - gated
        if (__DEV__ && DEBUG_PRESENCE) {
          console.log('[PRESENCE] app → foreground');
        }
        // App came to foreground - send heartbeat and sync location to backend
        sendHeartbeat();
        syncLocationToBackendIfNeeded(true); // Force sync on foreground
      } else if (nextAppState === 'background' && prevAppState === 'active') {
        // P0: App went to background - mark as background state
        if (__DEV__ && DEBUG_PRESENCE) {
          console.log('[PRESENCE] app → background');
        }
        markBackground();
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
  }, [userId, sendHeartbeat, markBackground, syncLocationToBackendIfNeeded]);

  // No return value - this hook just runs side effects
}
