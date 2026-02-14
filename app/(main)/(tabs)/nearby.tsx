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
import ClusteredMapView from 'react-native-map-clustering';
import { getDemoMarkerImage } from '@/components/map/demoMarkerIndex';
import { getDemoClusterImage } from '@/components/map/demoClusterIndex';

// Native pin image — rendered via Marker `image` prop to avoid Android snapshot OOM
// Using image prop instead of React children eliminates bitmap snapshotting
const PIN_PINK_IMAGE = require('../../../assets/map/pin_pink.png');
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LoadingGuard } from '@/components/safety';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { useLocationStore, useBestLocation } from '@/stores/locationStore';
import { COLORS } from '@/lib/constants';
import { DEMO_PROFILES } from '@/lib/demoData';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { useDemoNotifStore } from '@/hooks/useNotifications';
import { api } from '@/convex/_generated/api';
import { useScreenSafety } from '@/hooks/useScreenSafety';
import { rankNearbyProfiles } from '@/lib/rankProfiles';
import { isWithinAllowedDistance } from '@/lib/distanceRules';
import { logDebugEvent } from '@/lib/debugEventLogger';
import { log } from '@/utils/logger';
import { markTiming } from '@/utils/startupTiming';

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

/**
 * BUGFIX #12: Validate coordinates before passing to map.
 * Checks for NaN, Infinity, and out-of-range values.
 * Invalid coords cause react-native-maps to crash on Android.
 */
function isValidMapCoordinate(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
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

// DEBUG FLAG: Set to true to disable MapView for crash isolation testing
// When true, the map will not render, showing a placeholder instead
// To re-enable the map, set this to false
const DEBUG_DISABLE_MAP = false;

// OOM PREVENTION: Hard limit on rendered markers to prevent Android native memory exhaustion
// Markers with React children cause bitmap snapshotting; even with image prop, limit as safety net
const MAX_NEARBY_MARKERS = 30;

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
  // Check if we arrived from tapping a notification — if so, skip creating new notification
  // Also check for focus=crossed_paths to center map on specific crossed path marker
  const { source, dedupeKey, focus, profileId: focusProfileId } = useLocalSearchParams<{
    source?: string;
    dedupeKey?: string;
    focus?: string;
    profileId?: string;
  }>();
  const arrivedFromNotification = source === 'notification';
  const tabBarHeight = useBottomTabBarHeight();
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  // Centralized location store — prewarmed on app boot for instant display
  const bestLocation = useBestLocation();
  const permissionStatus = useLocationStore((s) => s.permissionStatus);
  const refreshLocation = useLocationStore((s) => s.refreshLocation);
  const startLocationTracking = useLocationStore((s) => s.startLocationTracking);
  const locationError = useLocationStore((s) => s.error);

  // Extract coordinates from best available location
  const latitude = bestLocation?.latitude ?? null;
  const longitude = bestLocation?.longitude ?? null;

  // Note: Heading is handled by native showsUserLocation={true} on the map
  // which provides Google Maps style blue dot with direction cone automatically

  const userId = useAuthStore((s) => s.userId);
  const mapRef = useRef<MapView>(null);
  const { safeTimeout } = useScreenSafety();

  // BUGFIX #12: Track if we've warned about invalid coords (avoid log spam)
  const hasWarnedInvalidCoordsRef = useRef(false);

  // Demo store — read mutable profiles for nearby display
  const demoStoreProfiles = useDemoStore((s) => s.profiles);
  const demoCrossedPaths = useDemoStore((s) => s.crossedPaths);
  const getVisibleCrossedPaths = useDemoStore((s) => s.getVisibleCrossedPaths);
  const demoSeed = useDemoStore((s) => s.seed);
  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);
  const demoMatches = useDemoStore((s) => s.matches);
  const markCrossedPathSeen = useDemoStore((s) => s.markCrossedPathSeen);
  const hideCrossedPath = useDemoStore((s) => s.hideCrossedPath);
  const seedCrossedPathsWithLocation = useDemoStore((s) => s.seedCrossedPathsWithLocation);
  const crossedPathsSeeded = useDemoStore((s) => s.crossedPathsSeeded);
  // BUGFIX #34: Subscribe to hydration status to prevent seed before hydration
  const demoHasHydrated = useDemoStore((s) => s._hasHydrated);

  // Demo DM store — to check for existing conversations
  const demoConversations = useDemoDmStore((s) => s.conversations);
  useEffect(() => {
    // BUGFIX #34: Only seed after hydration completes
    if (isDemoMode && demoHasHydrated) demoSeed();
  }, [demoSeed, demoHasHydrated]);

  // Mark focused crossed path as seen when navigating from notification
  useEffect(() => {
    if (focusProfileId && isDemoMode) {
      markCrossedPathSeen(focusProfileId);
    }
  }, [focusProfileId, markCrossedPathSeen]);

  // GUARD: Filter crossed paths with valid coordinates to prevent map crash
  // Maps crash if Marker receives null/undefined/NaN/Infinity latitude or longitude
  // Also filters out hidden and expired entries via getVisibleCrossedPaths
  // BUGFIX #12: Use isValidMapCoordinate for comprehensive validation
  // SAFETY FIX: Exclude blocked users from crossed paths (critical safety requirement)
  const validCrossedPaths = useMemo(() => {
    // Use getVisibleCrossedPaths to filter out hidden/expired entries
    const visiblePaths = getVisibleCrossedPaths();
    return visiblePaths.filter((cp) => {
      // SAFETY: Exclude blocked users - they must NEVER appear on map
      if (blockedUserIds.includes(cp.otherUserId)) return false;
      // Exclude current user
      if (userId && cp.otherUserId === userId) return false;
      // Validate coordinates
      return isValidMapCoordinate(cp.latitude, cp.longitude);
    });
  }, [demoCrossedPaths, getVisibleCrossedPaths, userId, blockedUserIds]);

  // DEV: Log invalid crossed paths so we can debug seed/creation issues
  useEffect(() => {
    if (__DEV__ && demoCrossedPaths.length > 0) {
      const invalid = demoCrossedPaths.filter((cp) =>
        typeof cp.latitude !== 'number' ||
        typeof cp.longitude !== 'number' ||
        Number.isNaN(cp.latitude) ||
        Number.isNaN(cp.longitude)
      );
      if (invalid.length > 0) {
        log.error('[MAP]', 'Invalid crossedPath coordinates - skipping markers', {
          count: invalid.length,
          ids: invalid.map((cp) => cp.id).join(','),
        });
      }
    }
  }, [demoCrossedPaths]);

  // User location — ALWAYS use live GPS location (no hardcoded fallbacks)
  // In demo mode, we still require real GPS to place crossed paths near the user
  const userLat = latitude;
  const userLng = longitude;

  // Seed crossed paths with bestLocation (once location is available)
  // This generates crossed paths relative to where the user actually is
  const hasSeededWithLiveLocation = useRef(false);
  useEffect(() => {
    if (
      isDemoMode &&
      !hasSeededWithLiveLocation.current &&
      bestLocation &&
      !Number.isNaN(bestLocation.latitude) &&
      !Number.isNaN(bestLocation.longitude)
    ) {
      hasSeededWithLiveLocation.current = true;
      // Only seed if not already seeded OR if we have no valid crossed paths
      if (!crossedPathsSeeded || demoCrossedPaths.length === 0) {
        seedCrossedPathsWithLocation(bestLocation.latitude, bestLocation.longitude);
      }
    }
  }, [isDemoMode, bestLocation, crossedPathsSeeded, demoCrossedPaths.length, seedCrossedPathsWithLocation]);

  // Permission and loading states — minimal since location is prewarmed
  // If we have any location (lastKnown or current), show map immediately
  const hasLocation = bestLocation != null;
  const permissionDenied = permissionStatus === 'denied';
  // Only show brief "locating" overlay if no location at all and permission not denied
  const showLocatingOverlay = !hasLocation && !permissionDenied && permissionStatus !== 'unknown';
  const hasAnimatedToLocation = useRef(false);
  const hasCenteredOnBestLocation = useRef(false);


  // Bottom sheet state
  const [selectedProfile, setSelectedProfile] = useState<NearbyProfile | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // Check if selected profile has an existing match or conversation
  // If yes, we show "Message" CTA instead of "View Profile"
  const selectedProfileConversationId = useMemo(() => {
    if (!selectedProfile) return null;
    const profileId = selectedProfile._id;
    // Check for existing match
    const existingMatch = demoMatches.find((m) => m.otherUser?.id === profileId);
    if (existingMatch) return existingMatch.conversationId;
    // Check for existing conversation in demoDmStore
    const convoId = `demo_convo_${profileId}`;
    if (demoConversations[convoId] && demoConversations[convoId].length > 0) {
      return convoId;
    }
    return null;
  }, [selectedProfile, demoMatches, demoConversations]);

  // Refresh button state (simplified — store handles auto-refresh)
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Toast state for cooldown message
  const [showCooldownToast, setShowCooldownToast] = useState(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeouts on unmount
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
  // Recenter button handler: INSTANT using stored locations
  // Only calls refreshLocation() if no location exists at all
  // ------------------------------------------------------------------
  const handleRecenterMap = useCallback(() => {
    // Use stored location for instant recenter
    const loc = bestLocation;

    // BUGFIX #12: Validate coords before animateToRegion (prevents Android crash)
    if (loc && mapRef.current && isValidMapCoordinate(loc.latitude, loc.longitude)) {
      const d = radiusToLatDelta(FIXED_RADIUS_METERS);
      mapRef.current.animateToRegion({
        latitude: loc.latitude,
        longitude: loc.longitude,
        latitudeDelta: d,
        longitudeDelta: d * (SCREEN_WIDTH / Dimensions.get('window').height),
      }, 400);
      return;
    }

    // Invalid coords or no location — log warning once and try refresh
    if (loc && !isValidMapCoordinate(loc.latitude, loc.longitude)) {
      if (!hasWarnedInvalidCoordsRef.current) {
        hasWarnedInvalidCoordsRef.current = true;
        log.warn('[MAP]', 'Invalid coords in handleRecenterMap, skipping animate', {
          lat: loc.latitude,
          lng: loc.longitude,
        });
      }
    }

    // No stored location or invalid — trigger refresh (rare case)
    setIsRefreshing(true);
    refreshLocation().then((newLoc) => {
      setIsRefreshing(false);
      // BUGFIX #12: Validate refreshed coords before animateToRegion
      if (newLoc && mapRef.current && isValidMapCoordinate(newLoc.latitude, newLoc.longitude)) {
        const d = radiusToLatDelta(FIXED_RADIUS_METERS);
        mapRef.current.animateToRegion({
          latitude: newLoc.latitude,
          longitude: newLoc.longitude,
          latitudeDelta: d,
          longitudeDelta: d * (SCREEN_WIDTH / Dimensions.get('window').height),
        }, 400);
      }
    }).catch(() => {
      setIsRefreshing(false);
    });
  }, [bestLocation, refreshLocation]);

  // ------------------------------------------------------------------
  // Publish location to Convex when available (live mode only)
  // Location tracking is handled by the centralized store
  // ------------------------------------------------------------------
  const hasPublishedRef = useRef(false);
  useEffect(() => {
    if (
      !hasPublishedRef.current &&
      bestLocation &&
      userId &&
      !isDemoMode
    ) {
      hasPublishedRef.current = true;
      (async () => {
        try {
          // Publish location (respects 6-hour window on server)
          await publishLocation({
            userId: userId as any,
            latitude: bestLocation.latitude,
            longitude: bestLocation.longitude,
          });

          // Record location for crossed paths detection
          await recordLocation({
            userId: userId as any,
            latitude: bestLocation.latitude,
            longitude: bestLocation.longitude,
          });

          // Detect "Someone crossed you" alert
          const detectResult = await detectCrossedUsers({
            userId: userId as any,
            myLat: bestLocation.latitude,
            myLng: bestLocation.longitude,
          });

          if (detectResult?.triggered) {
            logDebugEvent('NEARBY_CROSSED', 'Crossed paths alert triggered');
          }
        } catch {
          // Silently fail — user can still view map
        }
      })();
    }
  }, [bestLocation, userId, publishLocation, recordLocation, detectCrossedUsers]);

  // ------------------------------------------------------------------
  // Center map on bestLocation when it becomes available (FIRST time only)
  // This ensures map centers on Jamnagar (actual location), not Mumbai default
  // ------------------------------------------------------------------
  useEffect(() => {
    if (
      bestLocation &&
      !hasCenteredOnBestLocation.current &&
      mapRef.current &&
      // BUGFIX #12: Validate coords before animateToRegion (prevents Android crash)
      isValidMapCoordinate(bestLocation.latitude, bestLocation.longitude)
    ) {
      hasCenteredOnBestLocation.current = true;
      const d = radiusToLatDelta(FIXED_RADIUS_METERS);
      mapRef.current.animateToRegion({
        latitude: bestLocation.latitude,
        longitude: bestLocation.longitude,
        latitudeDelta: d,
        longitudeDelta: d * (SCREEN_WIDTH / Dimensions.get('window').height),
      }, 600);
    }
  }, [bestLocation]);

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
        // FIX: Exclude current user from nearby profiles (don't show "me")
        if (userId && p._id === userId) return false;
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
      // FIX: Exclude current user from nearby profiles
      .filter((u) => !(userId && u.id === userId))
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
  // DEBUG: Log marker counts for OOM debugging
  // "You" marker is now native (showsUserLocation), not counted in custom markers
  // ------------------------------------------------------------------
  useEffect(() => {
    const renderedNearby = Math.min(nearbyProfiles.length, MAX_NEARBY_MARKERS);
    const renderedCrossed = validCrossedPaths.length;
    const totalCustomMarkers = renderedNearby + renderedCrossed; // "You" is native, not counted
    log.info('[MAP_OOM_DEBUG]', 'Marker counts (excluding native "You" marker)', {
      nearbyTotal: nearbyProfiles.length,
      nearbyRendered: renderedNearby,
      crossedPaths: renderedCrossed,
      totalCustomMarkers,
      maxAllowed: MAX_NEARBY_MARKERS,
      truncated: nearbyProfiles.length > MAX_NEARBY_MARKERS,
    });
    // Milestone G: map markers ready
    if (totalCustomMarkers > 0) {
      markTiming('map_ready');
    }
  }, [nearbyProfiles.length, validCrossedPaths.length]);

  // ------------------------------------------------------------------
  // Fire "Someone just crossed you" notification once per session (demo mode)
  // Privacy-safe: no identity revealed, just generic alert
  // System notification only — no in-app banner
  // SKIP if we arrived from tapping a notification (prevents unseenCount bounce-back)
  // ------------------------------------------------------------------
  const crossedPathsNotifiedRef = useRef(false);
  useEffect(() => {
    if (!isDemoMode || crossedPathsNotifiedRef.current) return;
    if (nearbyProfiles.length === 0) return;
    // Skip creating notification if we arrived from a notification tap
    // This prevents the unseenCount from bouncing back up after marking as read
    if (arrivedFromNotification) {
      crossedPathsNotifiedRef.current = true;
      return;
    }
    crossedPathsNotifiedRef.current = true;

    // Add to demo notification store (system notification, no in-app banner)
    useDemoNotifStore.getState().addNotification({
      type: 'crossed_paths',
      title: 'Mira',
      body: 'Someone just crossed you',
      data: {}, // No identity data — privacy-safe
    });
  }, [nearbyProfiles, arrivedFromNotification]);

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
  // BUGFIX #12: Validate coordinates before building region (prevents Android crash)
  // ------------------------------------------------------------------
  const buildRegion = (): Region | null => {
    // Validate coords first — NaN/Infinity/out-of-range will crash react-native-maps
    if (!isValidMapCoordinate(userLat, userLng)) {
      return null;
    }
    const d = radiusToLatDelta(FIXED_RADIUS_METERS);
    return {
      latitude: userLat!,
      longitude: userLng!,
      latitudeDelta: d,
      longitudeDelta: d * (SCREEN_WIDTH / Dimensions.get('window').height),
    };
  };
  const initialRegion = buildRegion();

  // ------------------------------------------------------------------
  // Bottom sheet transform
  // ------------------------------------------------------------------
  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [BOTTOM_SHEET_HEIGHT + 40, 0],
  });

  // ------------------------------------------------------------------
  // Crossed path marker handlers (must be before any early returns)
  // ------------------------------------------------------------------

  // Handle crossed path marker tap — mark seen and open profile
  const handleCrossedPathMarkerPress = useCallback((cp: typeof demoCrossedPaths[0]) => {
    markCrossedPathSeen(cp.otherUserId);
    router.push(`/(main)/profile/${cp.otherUserId}`);
  }, [markCrossedPathSeen, router]);

  // Deep link: animate to focused crossed path marker
  useEffect(() => {
    if (focusProfileId && mapRef.current && isDemoMode) {
      // Use validCrossedPaths to ensure we only animate to entries with valid coordinates
      const crossedPath = validCrossedPaths.find((cp) => cp.otherUserId === focusProfileId);
      // BUGFIX #12: Extra validation before animateToRegion
      if (crossedPath && isValidMapCoordinate(crossedPath.latitude, crossedPath.longitude)) {
        // Animate map to the crossed path location
        const d = radiusToLatDelta(FIXED_RADIUS_METERS);
        mapRef.current.animateToRegion({
          latitude: crossedPath.latitude,
          longitude: crossedPath.longitude,
          latitudeDelta: d * 0.5, // Zoom in closer
          longitudeDelta: d * 0.5 * (SCREEN_WIDTH / Dimensions.get('window').height),
        }, 500);
      }
    }
  }, [focusProfileId, validCrossedPaths]);

  // Format crossed time (e.g., "5m ago", "1h ago") - helper function
  const formatCrossedTime = useCallback((timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }, []);

  // ------------------------------------------------------------------
  // Render — map shown immediately, no heavy loading screens
  // ------------------------------------------------------------------

  // Permission denied — show overlay but still render map underneath
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
            onPress={() => {
              // Re-trigger location tracking (will request permission)
              startLocationTracking();
            }}
          >
            <Text style={styles.permissionButtonText}>Enable Location</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Default region for map when no location yet (center of India as safe default)
  const defaultRegion: Region = {
    latitude: 20.5937,
    longitude: 78.9629,
    latitudeDelta: 10,
    longitudeDelta: 10,
  };

  // Use real location region if available, else default
  const mapRegion = initialRegion || defaultRegion;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* DEBUG: Map disabled for crash isolation */}
      {DEBUG_DISABLE_MAP ? (
        <View style={styles.debugMapPlaceholder}>
          <Ionicons name="map-outline" size={48} color={COLORS.textLight} />
          <Text style={styles.debugMapText}>Map temporarily disabled for debugging</Text>
          <Text style={styles.debugMapSubtext}>Testing Android crash isolation</Text>
        </View>
      ) : (
      /* Full-screen map with clustering — shown immediately with prewarmed location */
      <ClusteredMapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={mapRegion}
        showsUserLocation={true}
        followsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={closeSheet}
        onRegionChangeComplete={(region) => {
          // Update zoom bucket when user zooms — causes pins to shift (anti-triangulation)
          const newBucket = getZoomBucket(region.latitudeDelta);
          if (newBucket !== zoomBucket) {
            setZoomBucket(newBucket);
          }
        }}
        // Clustering configuration — cluster until city zoom, then show individual pins
        // maxZoom=11 shows profiles earlier (less zoom needed)
        clusterColor={COLORS.primary}
        clusterTextColor={COLORS.white}
        clusterFontFamily="System"
        radius={50} // Cluster nearby points
        minZoom={1}
        maxZoom={11} // Stop clustering at zoom 11 — profiles appear earlier
        minPoints={2} // Minimum points to form a cluster
        extent={512}
        nodeSize={64}
        // Single pre-composited cluster marker (pin + count number baked in)
        // No React children inside Marker — 100% Android stable
        renderCluster={(cluster) => {
          const { id, geometry, onPress, properties } = cluster;
          const points = properties.point_count;

          return (
            <Marker
              key={`cluster-${id}`}
              coordinate={{
                latitude: geometry.coordinates[1],
                longitude: geometry.coordinates[0],
              }}
              image={getDemoClusterImage(points)}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
              onPress={onPress}
            />
          );
        }}
      >
        {/* "You" marker — handled by native showsUserLocation={true} above */}
        {/* This provides Google Maps style: blue dot + accuracy circle + heading indicator */}

        {/* Nearby profile markers — OOM FIX: use image prop, limit count, no React children */}
        {nearbyProfiles.slice(0, MAX_NEARBY_MARKERS).map((p) => (
          <Marker
            key={p._id}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            anchor={{ x: 0.5, y: 1 }}
            image={PIN_PINK_IMAGE}
            tracksViewChanges={false}
            opacity={p.freshness === 'faded' ? 0.5 : 1}
            onPress={(e) => {
              e.stopPropagation();
              openSheet(p);
            }}
          />
        ))}

        {/* Crossed paths markers — SINGLE pre-composited image (pin + avatar baked in) */}
        {/* No overlay marker, no drift, no delay — instant stable rendering */}
        {isDemoMode && validCrossedPaths.map((cp) => (
          <Marker
            key={`crossed-${cp.id}`}
            coordinate={{ latitude: cp.latitude, longitude: cp.longitude }}
            image={getDemoMarkerImage(cp.otherUserId)}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            onPress={(e) => {
              e.stopPropagation();
              handleCrossedPathMarkerPress(cp);
            }}
          />
        ))}
      </ClusteredMapView>
      )}

      {/* Locating overlay — shown briefly when no location yet */}
      {showLocatingOverlay && (
        <View style={styles.locatingOverlay}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.locatingText}>Locating...</Text>
        </View>
      )}

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
              isRefreshing && styles.fabButtonLoading,
            ]}
            onPress={handleRecenterMap}
            disabled={isRefreshing}
            activeOpacity={0.8}
          >
            {isRefreshing ? (
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
                {selectedProfileConversationId ? (
                  // Existing match/conversation: show "Message" CTA
                  <TouchableOpacity
                    style={[styles.viewProfileButton, styles.messageButton]}
                    onPress={() => {
                      closeSheet();
                      router.push(`/(main)/(tabs)/messages/chat/${selectedProfileConversationId}`);
                    }}
                  >
                    <Ionicons name="chatbubble" size={14} color={COLORS.white} style={{ marginRight: 6 }} />
                    <Text style={styles.viewProfileText}>Message</Text>
                  </TouchableOpacity>
                ) : (
                  // No existing thread: show "View Profile"
                  <TouchableOpacity
                    style={styles.viewProfileButton}
                    onPress={() => {
                      closeSheet();
                      router.push(`/(main)/profile/${selectedProfile._id}`);
                    }}
                  >
                    <Text style={styles.viewProfileText}>View Profile</Text>
                  </TouchableOpacity>
                )}
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

  // DEBUG: Placeholder when map is disabled for crash isolation
  debugMapPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  debugMapText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    textAlign: 'center',
  },
  debugMapSubtext: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 6,
  },

  // Locating overlay — small, non-blocking indicator
  locatingOverlay: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    gap: 8,
  },
  locatingText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
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
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewProfileText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },

});
