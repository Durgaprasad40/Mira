import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
  ActivityIndicator,
  PanResponder,
  AppState,
  AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import MapView, { Marker, Region } from 'react-native-maps';
import { useRouter, useFocusEffect } from 'expo-router';
import { LoadingGuard } from '@/components/safety';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { useLocation, hasCachedLocation } from '@/hooks/useLocation';
import { COLORS } from '@/lib/constants';
import { DEMO_PROFILES, getDemoCurrentUser } from '@/lib/demoData';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';
import { useDemoNotifStore } from '@/hooks/useNotifications';
import { api } from '@/convex/_generated/api';
import { useScreenSafety } from '@/hooks/useScreenSafety';
import { rankNearbyProfiles } from '@/lib/rankProfiles';
import { isWithinAllowedDistance } from '@/lib/distanceRules';
import { logDebugEvent } from '@/lib/debugEventLogger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NearbyProfile {
  _id: string;
  name: string;
  age: number;
  latitude: number;
  longitude: number;
  lastSeenArea?: string;
  lastLocationUpdatedAt?: number;
  photoUrl?: string;
  photos?: { url: string }[];
  isVerified?: boolean;
  freshness: 'solid' | 'faded';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Haversine distance in meters between two lat/lng points. */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Convert a radius in meters to a rough latitudeDelta for the MapView region. */
function radiusToLatDelta(meters: number): number {
  return (meters * 2.5) / 111320;
}

/** Simple deterministic hash for client-side demo jitter. */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Offset a lat/lng by a distance (meters) and bearing (radians). */
function offsetCoords(
  lat: number,
  lng: number,
  distanceMeters: number,
  bearingRad: number,
): { lat: number; lng: number } {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const latRad = toRad(lat);
  const lngRad = toRad(lng);
  const d = distanceMeters / R;

  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(d) +
    Math.cos(latRad) * Math.sin(d) * Math.cos(bearingRad),
  );
  const newLng = lngRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(d) * Math.cos(latRad),
    Math.cos(d) - Math.sin(latRad) * Math.sin(newLat),
  );

  return {
    lat: newLat * (180 / Math.PI),
    lng: newLng * (180 / Math.PI),
  };
}

/** Compute freshness tier from lastLocationUpdatedAt. */
function computeFreshness(timestamp: number): 'solid' | 'faded' | 'hidden' {
  const ageMs = Date.now() - timestamp;
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const SIX_DAYS = 6 * 24 * 60 * 60 * 1000;
  if (ageMs <= THREE_DAYS) return 'solid';
  if (ageMs <= SIX_DAYS) return 'faded';
  return 'hidden';
}

// ---------------------------------------------------------------------------
// Anti-Zoom Shifting: Zoom buckets + client-side fuzz
// ---------------------------------------------------------------------------

/** Get zoom bucket from latitudeDelta (0-4, smaller = more zoomed in) */
function getZoomBucket(latitudeDelta: number): number {
  if (latitudeDelta > 0.30) return 0;
  if (latitudeDelta > 0.15) return 1;
  if (latitudeDelta > 0.08) return 2;
  if (latitudeDelta > 0.04) return 3;
  return 4;
}

/** Apply client-side fuzz with anti-zoom shifting.
 * Jitter changes when zoom bucket or session changes, preventing triangulation.
 *
 * @param hideDistance - If true, use larger fuzz radius (200-400m) for privacy
 */
function applyClientFuzz(
  lat: number,
  lng: number,
  viewerId: string,
  otherUserId: string,
  sessionSalt: number,
  zoomBucket: number,
  hideDistance: boolean = false,
): { lat: number; lng: number } {
  // Deterministic seed based on viewer, other user, session, and zoom bucket
  const seed = simpleHash(`${viewerId}:${otherUserId}:${sessionSalt}:${zoomBucket}`);

  // Random angle (0-360 degrees)
  const angle = ((seed % 36000) / 100) * (Math.PI / 180);

  // Random radius — larger for hideDistance users (200-400m vs 20-100m)
  const radiusMeters = hideDistance
    ? 200 + (seed % 201)   // 200-400m for hidden users
    : 20 + (seed % 81);    // 20-100m for normal users

  return offsetCoords(lat, lng, radiusMeters, angle);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BOTTOM_SHEET_HEIGHT = 200;
const FIXED_RADIUS_METERS = 1000; // 1km
const FIXED_RADIUS_KM = 1; // 1km for distance rules

// Extract demo "nearby" profiles that have lat/lng.
// Fallback: used when demoStore hasn't seeded yet.
const NEARBY_DEMO_PROFILES = (DEMO_PROFILES as any[]).filter(
  (p) => typeof p.latitude === 'number' && (p._id as string).startsWith('demo_nearby'),
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants for refresh feature
// ---------------------------------------------------------------------------
const REFRESH_COOLDOWN_MS = 10000; // 10 seconds cooldown between manual refreshes
const AUTO_REFRESH_TIMEOUT_MS = 8000; // 8 seconds timeout for location fetch
const AUTO_REFRESH_STALE_MS = 90000; // 90 seconds - auto-refresh if location older than this
const FAB_SIZE = 52; // Size of the floating action button
const FAB_EDGE_MARGIN = 16; // Margin from screen edges (left/right snap positions)
const FAB_SAFE_PADDING = 12; // Extra padding from safe area boundaries
const FAB_STORAGE_KEY = 'nearby_fab_position'; // AsyncStorage key for FAB position
const TOAST_DURATION_MS = 2000; // Duration to show cooldown toast

export default function NearbyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const {
    latitude,
    longitude,
    getCurrentLocation,
    forceGetCurrentLocation,
    requestPermission,
    isLoading: locationLoading,
    error: locationError,
  } = useLocation();
  const userId = useAuthStore((s) => s.userId);
  const mapRef = useRef<MapView>(null);
  const { safeTimeout } = useScreenSafety();

  // Demo store — read mutable profiles for nearby display
  const demoStoreProfiles = useDemoStore((s) => s.profiles);
  const demoSeed = useDemoStore((s) => s.seed);
  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);
  useEffect(() => { if (isDemoMode) demoSeed(); }, [demoSeed]);

  // User location — only use demo coords in demo mode, otherwise require real location
  const demoUser = getDemoCurrentUser();
  const userLat = isDemoMode ? (latitude ?? demoUser.latitude) : latitude;
  const userLng = isDemoMode ? (longitude ?? demoUser.longitude) : longitude;

  // Permission and loading states
  // In demo mode with demo location, skip loading entirely
  // Also skip if we have a cached location
  const hasDemoLocation = isDemoMode && demoUser.latitude != null && demoUser.longitude != null;
  const hasCached = hasCachedLocation();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isInitializing, setIsInitializing] = useState(!hasDemoLocation && !hasCached);
  const [retryKey, setRetryKey] = useState(0); // For LoadingGuard retry
  const hasAnimatedToLocation = useRef(false);

  // Bottom sheet state
  const [selectedProfile, setSelectedProfile] = useState<NearbyProfile | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // Refresh button state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Auto-refresh state
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const lastSuccessfulLocationAt = useRef<number>(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // 6-5: Auto-refresh request ID to cancel stale refreshes
  const autoRefreshRequestIdRef = useRef<number>(0);

  // Toast state for cooldown message
  const [showCooldownToast, setShowCooldownToast] = useState(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup toast timeout on unmount (A1 fix)
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // FAB safe area bounds - computed from real insets and tab bar height
  const fabMinX = FAB_EDGE_MARGIN;
  const fabMaxX = screenWidth - FAB_SIZE - FAB_EDGE_MARGIN;
  const fabMinY = insets.top + FAB_SAFE_PADDING;
  // Bottom bound: screen height minus FAB size, tab bar, and safe padding
  const fabMaxY = screenHeight - FAB_SIZE - tabBarHeight - FAB_SAFE_PADDING;

  // FAB position state - default to bottom-right within safe area
  const defaultFabPosition = {
    x: fabMaxX,
    y: Math.max(fabMinY, fabMaxY),
  };
  const fabPosition = useRef(new Animated.ValueXY(defaultFabPosition)).current;
  const [fabLoaded, setFabLoaded] = useState(false);

  // Load saved FAB position from AsyncStorage (with bounds validation)
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(FAB_STORAGE_KEY);
        if (saved) {
          const { x, y } = JSON.parse(saved);
          // Validate and clamp the position within safe bounds
          const clampedX = Math.max(fabMinX, Math.min(x, fabMaxX));
          const clampedY = Math.max(fabMinY, Math.min(y, fabMaxY));
          fabPosition.setValue({ x: clampedX, y: clampedY });
        }
      } catch {
        // Ignore errors, use default position
      }
      setFabLoaded(true);
    })();
  }, [fabMinX, fabMaxX, fabMinY, fabMaxY, tabBarHeight]);

  // 6-3: Recalculate FAB bounds on orientation/dimension change and clamp position
  useEffect(() => {
    if (!fabLoaded) return;

    // Get current FAB position and clamp to new bounds
    // @ts-ignore - accessing internal animated value
    const currentX = fabPosition.x._value ?? defaultFabPosition.x;
    // @ts-ignore
    const currentY = fabPosition.y._value ?? defaultFabPosition.y;

    const clampedX = Math.max(fabMinX, Math.min(currentX, fabMaxX));
    const clampedY = Math.max(fabMinY, Math.min(currentY, fabMaxY));

    // If position changed due to clamping, update and save
    if (clampedX !== currentX || clampedY !== currentY) {
      fabPosition.setValue({ x: clampedX, y: clampedY });
      saveFabPosition(clampedX, clampedY);
    }
  }, [fabLoaded, fabMinX, fabMaxX, fabMinY, fabMaxY, screenWidth, screenHeight, insets.top, tabBarHeight]);

  // Save FAB position to AsyncStorage
  const saveFabPosition = useCallback(async (x: number, y: number) => {
    try {
      await AsyncStorage.setItem(FAB_STORAGE_KEY, JSON.stringify({ x, y }));
    } catch {
      // Ignore save errors
    }
  }, []);

  // Snap FAB to nearest edge (left or right) with safe area clamping
  const snapToEdge = useCallback((currentX: number, currentY: number) => {
    const centerX = screenWidth / 2;
    const targetX = currentX < centerX ? fabMinX : fabMaxX;

    // Clamp Y within safe bounds
    const targetY = Math.max(fabMinY, Math.min(currentY, fabMaxY));

    Animated.spring(fabPosition, {
      toValue: { x: targetX, y: targetY },
      useNativeDriver: false,
      friction: 7,
      tension: 40,
    }).start(() => {
      saveFabPosition(targetX, targetY);
    });
  }, [screenWidth, fabMinX, fabMaxX, fabMinY, fabMaxY, fabPosition, saveFabPosition]);

  // PanResponder for dragging the FAB
  const panResponder = useMemo(() => {
    let startX = 0;
    let startY = 0;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only become responder if there's significant movement (to allow taps)
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        // Store starting position
        // @ts-ignore - accessing internal value
        startX = fabPosition.x._value;
        // @ts-ignore
        startY = fabPosition.y._value;
      },
      onPanResponderMove: (_, gestureState) => {
        const newX = startX + gestureState.dx;
        const newY = startY + gestureState.dy;

        // Clamp within safe area bounds
        const clampedX = Math.max(fabMinX, Math.min(newX, fabMaxX));
        const clampedY = Math.max(fabMinY, Math.min(newY, fabMaxY));

        fabPosition.setValue({ x: clampedX, y: clampedY });
      },
      onPanResponderRelease: () => {
        // Snap to edge on release
        // @ts-ignore
        const finalX = fabPosition.x._value;
        // @ts-ignore
        const finalY = fabPosition.y._value;
        snapToEdge(finalX, finalY);
      },
    });
  }, [fabMinX, fabMaxX, fabMinY, fabMaxY, fabPosition, snapToEdge]);

  // Anti-zoom shifting: session salt + zoom bucket
  // Session salt changes when screen opens — prevents position prediction across sessions
  const sessionSalt = useRef(Date.now()).current;
  const [zoomBucket, setZoomBucket] = useState(4); // Start at most zoomed in

  // Convex mutation/query (skipped in demo mode)
  const publishLocation = useMutation(api.crossedPaths.publishLocation);
  const recordLocation = useMutation(api.crossedPaths.recordLocation);
  const detectCrossedUsers = useMutation(api.crossedPaths.detectCrossedUsers);
  const convexNearby = useQuery(
    api.crossedPaths.getNearbyUsers,
    !isDemoMode && userId ? { userId: userId as any } : 'skip',
  );

  // ------------------------------------------------------------------
  // Auto-refresh location function (used on focus and app foreground)
  // 6-5: Uses requestId pattern to cancel stale refreshes
  // ------------------------------------------------------------------
  const performAutoRefresh = useCallback(async () => {
    // Check if location is stale
    const timeSinceLastSuccess = Date.now() - lastSuccessfulLocationAt.current;
    if (timeSinceLastSuccess < AUTO_REFRESH_STALE_MS && lastSuccessfulLocationAt.current > 0) {
      // Location is fresh, no need to refresh
      return;
    }

    // Don't auto-refresh if already doing a manual refresh
    if (isRefreshing) {
      return;
    }

    // 6-5: Generate unique request ID for this refresh
    const thisRequestId = Date.now();
    autoRefreshRequestIdRef.current = thisRequestId;

    // 6-5: If another auto-refresh is in progress, it will be stale after we set our ID
    setIsAutoRefreshing(true);
    setRefreshError(null);

    try {
      const loc = await forceGetCurrentLocation(AUTO_REFRESH_TIMEOUT_MS);

      // 6-5: Check if this request is still the latest (not cancelled by a newer one)
      if (autoRefreshRequestIdRef.current !== thisRequestId) {
        // Stale request — discard results
        return;
      }

      if (loc) {
        // 6-4: Validate coordinates before using
        if (Number.isNaN(loc.latitude) || Number.isNaN(loc.longitude)) {
          setRefreshError('Invalid location coordinates');
          return;
        }

        // Update success timestamp
        lastSuccessfulLocationAt.current = Date.now();

        // Reset map animation flag so it re-centers on new location
        hasAnimatedToLocation.current = false;

        // Re-publish location to Convex (live mode only)
        if (userId && !isDemoMode) {
          await publishLocation({
            userId: userId as any,
            latitude: loc.latitude,
            longitude: loc.longitude,
          });

          await recordLocation({
            userId: userId as any,
            latitude: loc.latitude,
            longitude: loc.longitude,
          });
        }
      } else {
        // Location fetch failed - show error but keep old location
        setRefreshError(locationError || 'Could not get location');
      }
    } catch (error) {
      // 6-5: Only set error if this is still the current request
      if (autoRefreshRequestIdRef.current !== thisRequestId) return;
      const errorMessage = error instanceof Error ? error.message : 'Failed to get location';
      setRefreshError(errorMessage);
    } finally {
      // 6-5: Only update state if this is still the current request
      if (autoRefreshRequestIdRef.current === thisRequestId) {
        setIsAutoRefreshing(false);
      }
    }
  }, [isRefreshing, forceGetCurrentLocation, userId, publishLocation, recordLocation, locationError]);

  // ------------------------------------------------------------------
  // Auto-refresh on screen focus
  // ------------------------------------------------------------------
  useFocusEffect(
    useCallback(() => {
      // Trigger auto-refresh when screen gains focus
      performAutoRefresh();
    }, [performAutoRefresh])
  );

  // ------------------------------------------------------------------
  // Auto-refresh when app returns from background (A2 fix: stable listener)
  // ------------------------------------------------------------------
  const performAutoRefreshRef = useRef(performAutoRefresh);
  performAutoRefreshRef.current = performAutoRefresh;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      // If app was in background and is now active
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // Trigger auto-refresh via ref to avoid stale closure
        performAutoRefreshRef.current();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // ------------------------------------------------------------------
  // Cooldown timer: update remaining time every second when active
  // ------------------------------------------------------------------
  useEffect(() => {
    if (cooldownRemaining <= 0) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastRefreshTime;
      const remaining = Math.max(0, REFRESH_COOLDOWN_MS - elapsed);
      setCooldownRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldownRemaining, lastRefreshTime]);

  // ------------------------------------------------------------------
  // Refresh location handler: force-fetch new GPS + re-publish
  // ------------------------------------------------------------------
  const handleRefreshLocation = useCallback(async () => {
    // Check cooldown
    const timeSinceLastRefresh = Date.now() - lastRefreshTime;
    if (timeSinceLastRefresh < REFRESH_COOLDOWN_MS) {
      setCooldownRemaining(REFRESH_COOLDOWN_MS - timeSinceLastRefresh);
      // Show toast message
      setShowCooldownToast(true);
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      toastTimeoutRef.current = setTimeout(() => {
        setShowCooldownToast(false);
      }, TOAST_DURATION_MS);
      return;
    }

    setIsRefreshing(true);
    setRefreshError(null);

    try {
      // Force-fetch fresh GPS location with high accuracy
      const loc = await forceGetCurrentLocation();

      if (!loc) {
        // forceGetCurrentLocation handles permission request internally
        // If it returns null, permission was denied or timeout occurred
        setRefreshError(locationError || 'Could not get location. Please try again.');
        setIsRefreshing(false);
        return;
      }

      // 6-4: Validate coordinates before using
      if (Number.isNaN(loc.latitude) || Number.isNaN(loc.longitude)) {
        setRefreshError('Invalid location coordinates received');
        setIsRefreshing(false);
        return;
      }

      // Update refresh timestamps (both cooldown and success tracking)
      const now = Date.now();
      setLastRefreshTime(now);
      setCooldownRemaining(REFRESH_COOLDOWN_MS);
      lastSuccessfulLocationAt.current = now;

      // Reset map animation flag so it re-centers on new location
      hasAnimatedToLocation.current = false;

      // Re-publish location to Convex (live mode only)
      if (userId && !isDemoMode) {
        await publishLocation({
          userId: userId as any,
          latitude: loc.latitude,
          longitude: loc.longitude,
        });

        await recordLocation({
          userId: userId as any,
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
      }

      setRefreshError(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh location';
      setRefreshError(errorMessage);
    } finally {
      setIsRefreshing(false);
    }
  }, [lastRefreshTime, forceGetCurrentLocation, locationError, userId, publishLocation, recordLocation]);

  // ------------------------------------------------------------------
  // On mount: request location + publish location (max once per 6 hours)
  // In demo mode with demo location, skip loading and just fetch silently in background
  // Also try to get fresh location once on mount (auto-fix)
  // A3 fix: isMountedRef guards async operations
  // ------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    (async () => {
      // If we have demo location or cached location, skip the loading state
      // but still fetch fresh location in background with auto-fix
      const skipLoading = hasDemoLocation || hasCached;

      if (!skipLoading) {
        // Only show loading for real location fetch
        const granted = await requestPermission();
        if (!isMounted) return;
        if (!granted) {
          setPermissionDenied(true);
          setIsInitializing(false);
          return;
        }
        setPermissionDenied(false);
      }

      // Auto-fix: Try to get fresh location on mount with shorter timeout
      // Use forceGetCurrentLocation to bypass cache and get accurate position
      const loc = await forceGetCurrentLocation(AUTO_REFRESH_TIMEOUT_MS);
      if (!isMounted) return;

      if (!skipLoading) {
        setIsInitializing(false);
      }

      // If location was successfully fetched, update the success timestamp
      if (loc) {
        lastSuccessfulLocationAt.current = Date.now();
      }

      // If force location failed but we have cached location, that's okay -
      // user can use the refresh button. Don't show error.
      if (!loc && hasCached) {
        // Keep using cached location, no error shown
      }

      if (loc && userId && !isDemoMode) {
        // Publish location (respects 6-hour window — won't update if already published recently)
        await publishLocation({
          userId: userId as any,
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
        if (!isMounted) return;

        // Record location for crossed paths detection (unlock logic)
        await recordLocation({
          userId: userId as any,
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
        if (!isMounted) return;

        // Detect "Someone crossed you" alert (privacy-safe, uses published locations)
        // Has its own 6h cooldown + 24h per-person dedupe
        const detectResult = await detectCrossedUsers({
          userId: userId as any,
          myLat: loc.latitude,
          myLng: loc.longitude,
        });
        if (!isMounted) return;

        // Log crossed paths detection (system notifications handled separately)
        if (detectResult?.triggered) {
          logDebugEvent('NEARBY_CROSSED', 'Crossed paths alert triggered');
        }
      }
    })();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Animate map to real location when it becomes available
  // ------------------------------------------------------------------
  useEffect(() => {
    if (userLat != null && userLng != null && mapRef.current && !hasAnimatedToLocation.current) {
      hasAnimatedToLocation.current = true;
      const d = radiusToLatDelta(FIXED_RADIUS_METERS);
      mapRef.current.animateToRegion({
        latitude: userLat,
        longitude: userLng,
        latitudeDelta: d,
        longitudeDelta: d * (SCREEN_WIDTH / Dimensions.get('window').height),
      }, 500);
    }
  }, [userLat, userLng]);

  // ------------------------------------------------------------------
  // Build nearby profiles list (memoized to avoid recomputing each render)
  // Applies client-side fuzz that changes with zoom bucket (anti-triangulation)
  // ------------------------------------------------------------------
  const nearbyProfiles: NearbyProfile[] = useMemo(() => {
    // If location is not available, return empty array
    if (userLat == null || userLng == null) {
      return [];
    }

    // 6-4: Validate user coordinates before processing
    if (Number.isNaN(userLat) || Number.isNaN(userLng)) {
      return [];
    }

    const viewerId = userId ?? 'demo_viewer';

    if (isDemoMode || !convexNearby) {
      // Demo mode: use demoStore profiles that have lat/lng within radius,
      // plus the static NEARBY_DEMO_PROFILES as fallback
      const allCandidates = [
        ...demoStoreProfiles.filter((p) => typeof p.latitude === 'number'),
        ...NEARBY_DEMO_PROFILES,
      ];
      // Deduplicate by _id
      const seen = new Set<string>();
      const unique = allCandidates.filter((p: any) => {
        if (seen.has(p._id)) return false;
        seen.add(p._id);
        return true;
      });
      const filtered = unique.filter((p: any) => {
        if (blockedUserIds.includes(p._id)) return false;
        // 6-4: Validate profile coordinates before using
        if (
          typeof p.latitude !== 'number' ||
          typeof p.longitude !== 'number' ||
          Number.isNaN(p.latitude) ||
          Number.isNaN(p.longitude)
        ) {
          return false;
        }
        const distanceMeters = haversineMeters(userLat, userLng, p.latitude, p.longitude);
        const distanceKm = distanceMeters / 1000;
        return isWithinAllowedDistance({ distance: distanceKm }, FIXED_RADIUS_KM);
      });
      // Apply client-side fuzz to demo profiles
      const fuzzedProfiles = filtered.map((p: any) => {
        const ts = p.lastLocationUpdatedAt ?? Date.now();
        const freshness = computeFreshness(ts);
        if (freshness === 'hidden') return null;

        // Apply anti-zoom fuzz
        const { lat, lng } = applyClientFuzz(
          p.latitude,
          p.longitude,
          viewerId,
          p._id,
          sessionSalt,
          zoomBucket,
        );
        return {
          ...p,
          latitude: lat,
          longitude: lng,
          freshness,
        } as NearbyProfile;
      }).filter(Boolean) as NearbyProfile[];

      return rankNearbyProfiles(fuzzedProfiles);
    }

    // Live mode: map Convex query results with client-side fuzz
    return rankNearbyProfiles(convexNearby
      // 6-4: Filter out profiles with invalid coordinates
      .filter((u) =>
        typeof u.publishedLat === 'number' &&
        typeof u.publishedLng === 'number' &&
        !Number.isNaN(u.publishedLat) &&
        !Number.isNaN(u.publishedLng)
      )
      .map((u) => {
        // Apply anti-zoom fuzz to published coordinates
        // hideDistance users get larger fuzz (200-400m vs 20-100m)
        const { lat, lng } = applyClientFuzz(
          u.publishedLat,
          u.publishedLng,
          viewerId,
          u.id,
          sessionSalt,
          zoomBucket,
          u.hideDistance,
        );
        return {
          _id: u.id,
          name: u.name,
          age: u.age,
          latitude: lat,
          longitude: lng,
          freshness: u.freshness as 'solid' | 'faded',
          photoUrl: u.photoUrl ?? undefined,
          isVerified: u.isVerified,
        };
      }));
  }, [demoStoreProfiles, blockedUserIds, userLat, userLng, userId, convexNearby, sessionSalt, zoomBucket]);

  // ------------------------------------------------------------------
  // Fire "Someone just crossed you" notification once per session (demo mode)
  // Privacy-safe: no identity revealed, just generic alert
  // System notification only — no in-app banner
  // ------------------------------------------------------------------
  const crossedPathsNotifiedRef = useRef(false);
  useEffect(() => {
    if (!isDemoMode || crossedPathsNotifiedRef.current) return;
    if (nearbyProfiles.length === 0) return;
    crossedPathsNotifiedRef.current = true;

    // Add to demo notification store (system notification, no in-app banner)
    useDemoNotifStore.getState().addNotification({
      type: 'crossed_paths',
      title: 'Mira',
      body: 'Someone just crossed you',
      data: {}, // No identity data — privacy-safe
    });
  }, [nearbyProfiles]);

  // ------------------------------------------------------------------
  // Bottom sheet animation helpers
  // ------------------------------------------------------------------
  const openSheet = useCallback(
    (profile: NearbyProfile) => {
      setSelectedProfile(profile);
      Animated.spring(sheetAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    },
    [sheetAnim],
  );

  const closeSheet = useCallback(() => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setSelectedProfile(null));
  }, [sheetAnim]);

  // ------------------------------------------------------------------
  // Map region — fixed 1km radius
  // Note: userLat/userLng are guaranteed non-null when map renders (due to early returns)
  // ------------------------------------------------------------------
  const buildRegion = (): Region => {
    const d = radiusToLatDelta(FIXED_RADIUS_METERS);
    return {
      latitude: userLat!,
      longitude: userLng!,
      latitudeDelta: d,
      longitudeDelta: d * (SCREEN_WIDTH / Dimensions.get('window').height),
    };
  };
  const initialRegion = userLat != null && userLng != null ? buildRegion() : null;

  // ------------------------------------------------------------------
  // Bottom sheet transform
  // ------------------------------------------------------------------
  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [BOTTOM_SHEET_HEIGHT + 40, 0],
  });

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  // Loading state while initializing location
  if (isInitializing) {
    return (
      <LoadingGuard
        isLoading={true}
        onRetry={() => {
          setRetryKey((k) => k + 1);
          setIsInitializing(true);
          getCurrentLocation().finally(() => setIsInitializing(false));
        }}
        title="Getting your location…"
        subtitle="This is taking longer than expected. Check your connection and location settings."
      >
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          <View style={styles.permissionOverlay}>
            <Ionicons name="location-outline" size={48} color={COLORS.primary} />
            <Text style={styles.permissionTitle}>Getting your location...</Text>
            <Text style={styles.permissionSubtitle}>
              Please wait while we find your current location.
            </Text>
          </View>
        </SafeAreaView>
      </LoadingGuard>
    );
  }

  // Permission denied overlay
  if (permissionDenied) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.permissionOverlay}>
          <Ionicons name="location-outline" size={48} color={COLORS.textLight} />
          <Text style={styles.permissionTitle}>Enable location to see nearby people</Text>
          <Text style={styles.permissionSubtitle}>
            Your location is only shared as an approximate area, never your exact position.
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={async () => {
              // 6-1: Clear permission denied state before re-requesting
              setPermissionDenied(false);
              setIsInitializing(true);
              const granted = await requestPermission();
              if (granted) {
                await getCurrentLocation();
              } else {
                // 6-1: Only set denied if actually denied after request
                setPermissionDenied(true);
              }
              setIsInitializing(false);
            }}
          >
            <Text style={styles.permissionButtonText}>Enable Location</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // No location available (non-demo mode, location fetch failed)
  if (userLat == null || userLng == null) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.permissionOverlay}>
          <Ionicons name="warning-outline" size={48} color={COLORS.textLight} />
          <Text style={styles.permissionTitle}>Unable to get your location</Text>
          <Text style={styles.permissionSubtitle}>
            We couldn't determine your location. Please check your device settings and try again.
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={async () => {
              setIsInitializing(true);
              hasAnimatedToLocation.current = false;
              await getCurrentLocation();
              setIsInitializing(false);
            }}
          >
            <Text style={styles.permissionButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={initialRegion!}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onPress={closeSheet}
        onRegionChangeComplete={(region) => {
          // Update zoom bucket when user zooms — causes pins to shift (anti-triangulation)
          const newBucket = getZoomBucket(region.latitudeDelta);
          if (newBucket !== zoomBucket) {
            setZoomBucket(newBucket);
          }
        }}
      >
        {/* "You" marker */}
        <Marker
          coordinate={{ latitude: userLat!, longitude: userLng! }}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.youMarkerWrapper}>
            <View style={styles.youMarkerDot} />
            <Text style={styles.youMarkerLabel}>You</Text>
          </View>
        </Marker>

        {/* Nearby profile markers — solid or faded, no text labels */}
        {nearbyProfiles.map((p) => (
          <Marker
            key={p._id}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={(e) => {
              e.stopPropagation();
              openSheet(p);
            }}
          >
            <View style={styles.pinWrapper}>
              <View
                style={[
                  styles.pinDot,
                  p.freshness === 'faded' && styles.pinDotFaded,
                ]}
              >
                <Text
                  style={[
                    styles.pinInitial,
                    p.freshness === 'faded' && styles.pinInitialFaded,
                  ]}
                >
                  {p.name.charAt(0)}
                </Text>
              </View>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Draggable Refresh FAB */}
      {fabLoaded && (
        <Animated.View
          style={[
            styles.fab,
            {
              transform: [
                { translateX: fabPosition.x },
                { translateY: fabPosition.y },
              ],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            style={[
              styles.fabButton,
              (isRefreshing || isAutoRefreshing) && styles.fabButtonLoading,
            ]}
            onPress={handleRefreshLocation}
            disabled={isRefreshing || isAutoRefreshing}
            activeOpacity={0.8}
          >
            {isRefreshing || isAutoRefreshing ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="locate" size={24} color={COLORS.white} />
            )}
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Cooldown toast */}
      {showCooldownToast && (
        <View style={[styles.toast, { bottom: tabBarHeight + FAB_SAFE_PADDING }]}>
          <Text style={styles.toastText}>Please wait a few seconds</Text>
        </View>
      )}

      {/* Refresh error message */}
      {refreshError && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color={COLORS.white} />
          <Text style={styles.errorText} numberOfLines={2}>{refreshError}</Text>
          <TouchableOpacity onPress={() => setRefreshError(null)} style={styles.errorDismiss}>
            <Ionicons name="close" size={16} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      )}

      {/* Crossed paths shortcut */}
      <TouchableOpacity
        style={styles.crossedPathsButton}
        onPress={() => router.push('/(main)/crossed-paths')}
      >
        <Ionicons name="footsteps" size={22} color={COLORS.white} />
      </TouchableOpacity>

      {/* Bottom sheet — no distance, no time text */}
      <Animated.View
        style={[
          styles.bottomSheet,
          { transform: [{ translateY: sheetTranslateY }] },
        ]}
        pointerEvents={selectedProfile ? 'auto' : 'none'}
      >
        {selectedProfile && (
          <>
            <TouchableOpacity style={styles.sheetClose} onPress={closeSheet}>
              <Ionicons name="close" size={20} color={COLORS.textLight} />
            </TouchableOpacity>

            <View style={styles.sheetContent}>
              <Image
                source={{
                  uri: selectedProfile.photoUrl ??
                    selectedProfile.photos?.[0]?.url,
                }}
                style={styles.sheetPhoto}
              />
              <View style={styles.sheetInfo}>
                <Text style={styles.sheetName}>
                  {selectedProfile.name}, {selectedProfile.age}
                </Text>
                <Text style={styles.sheetNearby}>Nearby</Text>
                <TouchableOpacity
                  style={styles.viewProfileButton}
                  onPress={() => {
                    closeSheet();
                    router.push(`/(main)/profile/${selectedProfile._id}`);
                  }}
                >
                  <Text style={styles.viewProfileText}>View Profile</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </Animated.View>

    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // "You" marker
  youMarkerWrapper: {
    alignItems: 'center',
  },
  youMarkerDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#4A90D9',
    borderWidth: 3,
    borderColor: COLORS.white,
  },
  youMarkerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4A90D9',
    marginTop: 2,
  },

  // Profile pin markers — solid state
  pinWrapper: {
    alignItems: 'center',
  },
  pinDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  pinInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },

  // Faded state (3-6 days inactive) — semi-transparent
  pinDotFaded: {
    opacity: 0.45,
  },
  pinInitialFaded: {
    opacity: 0.7,
  },

  // Permission denied overlay
  permissionOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 16,
  },
  permissionSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  permissionButton: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  permissionButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },

  // Draggable FAB (Floating Action Button) for refresh
  fab: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 100,
  },
  fabButton: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  fabButtonLoading: {
    opacity: 0.7,
  },

  // Toast for cooldown message (bottom position set dynamically via inline style)
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    zIndex: 200,
  },
  toastText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '500',
  },

  // Error banner
  errorBanner: {
    position: 'absolute',
    top: 70,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E74C3C',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.white,
  },
  errorDismiss: {
    padding: 4,
  },

  // Crossed paths shortcut
  crossedPathsButton: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },

  // Bottom sheet
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: BOTTOM_SHEET_HEIGHT,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 10,
  },
  sheetClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    padding: 4,
  },
  sheetContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sheetPhoto: {
    width: 90,
    height: 120,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
  },
  sheetInfo: {
    flex: 1,
    marginLeft: 16,
  },
  sheetName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  sheetNearby: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  viewProfileButton: {
    marginTop: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignSelf: 'flex-start',
  },
  viewProfileText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
