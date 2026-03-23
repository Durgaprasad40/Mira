/**
 * Nearby Tab - Full Implementation
 *
 * Features:
 * - Permission state UI (checking/denied/settings/ready)
 * - Safe current-location map render with coordinate validation
 * - Demo mode fallback
 * - Nearby user markers with privacy fuzzing
 * - Marker tap → full profile view (Discover-style)
 * - Clustering: overlapping markers merge into single marker
 * - Cluster tap → zooms into cluster area
 * - Uses Discovery preferences for filtering (no separate Nearby filters)
 *
 * ============================================================================
 * IMPLEMENTATION NOTES
 * ============================================================================
 *
 * 1. PINK PIN MARKERS (RESTORED - STABLE VERSION)
 *    - Uses image={pinPink} prop for reliable Android rendering
 *    - Same appearance on Metro (Samsung) and standalone APK (OnePlus)
 *    - Tap opens profile via Discover-style flow
 *
 * 2. CLUSTERING BEHAVIOR (LOCKED)
 *    - Uses supercluster (JS) with react-native-maps for Fabric compatibility
 *    - Cluster tap zooms into cluster area to reveal individual markers
 *    - Do NOT change clustering radius or behavior without testing
 *
 * 3. RECENTER BUTTON (LOCKED)
 *    - Tap-once recenter only
 *    - No follow mode
 *    - No second-state behavior
 *
 * ANDROID MARKER NOTE:
 * Using image={pinPink} prop ensures consistent rendering across all builds.
 * View-based markers had inconsistent rendering on Android.
 * ============================================================================
 *
 * FUTURE PHASES (documented for later):
 * - Live area pulse animation
 * - "Seen around you" horizontal card strip
 * - Advanced subscription/privacy rules
 * - Freshness ring indicators
 */
import React, { useState, useEffect, useCallback, useMemo, useRef, Component, ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import MapView, { Region, Marker } from 'react-native-maps';
import Supercluster from 'supercluster';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useLocationStore, useBestLocation } from '@/stores/locationStore';
import { useAuthStore } from '@/stores/authStore';
import { asUserId } from '@/convex/id';
import { safePush } from '@/lib/safeRouter';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_USER, DEMO_PROFILES } from '@/lib/demoData';
import { log } from '@/utils/logger';
import { Toast } from '@/components/ui/Toast';
import { Badge } from '@/components/ui/Badge';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Key for storing when user last viewed crossed paths
const CROSSED_PATHS_LAST_SEEN_KEY = 'mira_crossed_paths_last_seen';

// ---------------------------------------------------------------------------
// STABILITY FIX S4: Error boundary for map crash containment
// ---------------------------------------------------------------------------
interface MapErrorBoundaryState {
  hasError: boolean;
}

class MapErrorBoundary extends Component<
  { children: ReactNode; onRetry?: () => void },
  MapErrorBoundaryState
> {
  state: MapErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    log.error('[Nearby] Map render error caught by boundary:', String(error), String(errorInfo?.componentStack || ''));
  }

  handleRetry = () => {
    this.setState({ hasError: false });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={mapErrorStyles.container}>
          <Ionicons name="map-outline" size={48} color={COLORS.textLight} />
          <Text style={mapErrorStyles.title}>Map unavailable</Text>
          <Text style={mapErrorStyles.subtitle}>
            Something went wrong loading the map
          </Text>
          <TouchableOpacity style={mapErrorStyles.retryButton} onPress={this.handleRetry}>
            <Text style={mapErrorStyles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const mapErrorStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  retryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

// PNG marker for Android stability (relative path for reliable loading)
const pinPink = require('../../../assets/map/pin_pink.png');

// Cluster marker images with count (Android-safe)
const clusterImages = {
  2: require('../../../assets/demo/cluster/cluster_2.png'),
  3: require('../../../assets/demo/cluster/cluster_3.png'),
  4: require('../../../assets/demo/cluster/cluster_4.png'),
  5: require('../../../assets/demo/cluster/cluster_5.png'),
  6: require('../../../assets/demo/cluster/cluster_6.png'),
  7: require('../../../assets/demo/cluster/cluster_7.png'),
  8: require('../../../assets/demo/cluster/cluster_8.png'),
  9: require('../../../assets/demo/cluster/cluster_9.png'),
  10: require('../../../assets/demo/cluster/cluster_10.png'),
  20: require('../../../assets/demo/cluster/cluster_20.png'),
  50: require('../../../assets/demo/cluster/cluster_50.png'),
  99: require('../../../assets/demo/cluster/cluster_99.png'),
} as const;

/**
 * Get the appropriate cluster image based on point count.
 * Uses exact match when available, otherwise selects closest lower bound.
 */
function getClusterImage(pointCount: number) {
  if (pointCount <= 2) return clusterImages[2];
  if (pointCount <= 3) return clusterImages[3];
  if (pointCount <= 4) return clusterImages[4];
  if (pointCount <= 5) return clusterImages[5];
  if (pointCount <= 6) return clusterImages[6];
  if (pointCount <= 7) return clusterImages[7];
  if (pointCount <= 8) return clusterImages[8];
  if (pointCount <= 9) return clusterImages[9];
  if (pointCount <= 10) return clusterImages[10];
  if (pointCount <= 20) return clusterImages[20];
  if (pointCount <= 50) return clusterImages[50];
  return clusterImages[99]; // 50+ uses 99 marker
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Explicit location UI states for stability */
type LocationUIState =
  | 'checking'
  | 'permission_required'
  | 'denied_needs_settings'
  | 'restricted'           // iOS parental controls
  | 'services_disabled'    // System-wide location off
  | 'error'
  | 'ready';

/** Nearby user from query */
interface NearbyUser {
  id: string;
  name: string;
  age: number;
  publishedLat: number;
  publishedLng: number;
  publishedAt?: number;
  distance?: number; // Server-side distance in meters (privacy-safe)
  freshness: 'solid' | 'faded';
  photoUrl: string | null;
  isVerified: boolean;
  strongPrivacyMode: boolean;
  hideDistance: boolean;
}

/** Processed nearby user with fuzzed coordinates */
interface ProcessedNearbyUser extends NearbyUser {
  fuzzedLat: number;
  fuzzedLng: number;
}

/** GeoJSON Point properties for supercluster */
interface UserPointProperties {
  id: string;
  user: ProcessedNearbyUser;
}

/** Cluster or point from supercluster - using any for cluster properties to handle library types */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClusterFeature = Supercluster.ClusterFeature<any> | Supercluster.PointFeature<UserPointProperties>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LATITUDE_DELTA = 0.004; // ~2x closer than original 0.008
const DEFAULT_LONGITUDE_DELTA = 0.004;

// Rate limiting constants for crossed paths detection
const DETECTION_MIN_MOVEMENT_METERS = 60; // Only scan if moved 60m+
const DETECTION_MIN_INTERVAL_MS = 30000; // Only scan every 30s+

// P3-NEARBY-002: Query timeout constant (extracted from inline 30000ms)
const QUERY_TIMEOUT_MS = 30000; // 30 seconds before showing error

// Privacy fuzzing constants
const FUZZ_MIN_METERS = 50;  // Minimum offset
const FUZZ_MAX_METERS = 150; // Maximum offset
const STRONG_PRIVACY_FUZZ_MIN = 200; // Larger offset for users with strongPrivacyMode
const STRONG_PRIVACY_FUZZ_MAX = 400;

// Demo fallback location (Mumbai)
const DEMO_LOCATION = {
  latitude: DEMO_USER.latitude,
  longitude: DEMO_USER.longitude,
};

// Supercluster configuration (matches previous react-native-map-clustering behavior)
const CLUSTER_RADIUS = 45;
const CLUSTER_MAX_ZOOM = 20;

// ---------------------------------------------------------------------------
// STABILITY FIX P1: Cryptographically secure session salt
// ---------------------------------------------------------------------------
// Module-level session salt for stable privacy fuzzing across Nearby remounts.
// Generated once per app session (module load), not per component mount.
// Combined with viewerId + otherId for deterministic per-user fuzzing.
//
// FIX: Use crypto API for unpredictable salt instead of Date.now()
// This prevents reverse-engineering of fuzz offsets.
// ---------------------------------------------------------------------------
function generateSecureSessionSalt(): number {
  try {
    // Use Web Crypto API (available in Hermes/React Native)
    const array = new Uint32Array(2);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(array);
      // Combine two 32-bit values into a larger number
      return array[0] * 0x100000000 + array[1];
    }
  } catch {
    // Fallback silently
  }
  // Fallback: combine Math.random with high-resolution time for entropy
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) ^ Date.now();
}

const MODULE_SESSION_SALT = generateSecureSessionSalt();

// ---------------------------------------------------------------------------
// P2-NEARBY-003: Module-level empty state flag
// ---------------------------------------------------------------------------
// DESIGN: Show "no nearby users" empty state only ONCE per app session.
// This prevents repeated display on every navigation back to Nearby tab.
// The flag persists across component remounts within the same JS bundle session.
// It resets only on full app restart (JS context reload / hot reload).
// This is intentional UX behavior - not a bug.
// ---------------------------------------------------------------------------
let hasShownEmptyStateThisSession = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate distance between two coordinates in meters using Haversine formula.
 * Used for rate limiting crossed paths detection.
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
 * Validate coordinates before passing to MapView.
 * Invalid coords (NaN, Infinity, out-of-range) cause crashes on Android.
 */
function isValidMapCoordinate(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/**
 * Simple deterministic hash for stable fuzzing.
 * Same input always produces same output within a session.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Apply client-side privacy fuzzing to coordinates.
 * Deterministic per user+viewer+session so markers stay stable.
 * Never reveals exact location.
 */
function applyPrivacyFuzz(
  lat: number,
  lng: number,
  otherId: string,
  viewerId: string,
  sessionSalt: number,
  strongPrivacyMode: boolean,
): { lat: number; lng: number } {
  // Deterministic seed
  const seed = simpleHash(`${viewerId}:${otherId}:${sessionSalt}`);

  // Random angle (0-360 degrees)
  const angle = ((seed % 36000) / 100) * (Math.PI / 180);

  // Random radius based on strongPrivacyMode preference
  const minMeters = strongPrivacyMode ? STRONG_PRIVACY_FUZZ_MIN : FUZZ_MIN_METERS;
  const maxMeters = strongPrivacyMode ? STRONG_PRIVACY_FUZZ_MAX : FUZZ_MAX_METERS;
  const radiusMeters = minMeters + (seed % (maxMeters - minMeters + 1));

  // Earth radius in meters
  const R = 6371000;
  const latRad = lat * (Math.PI / 180);
  const lngRad = lng * (Math.PI / 180);
  const d = radiusMeters / R;

  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(d) +
    Math.cos(latRad) * Math.sin(d) * Math.cos(angle),
  );
  const newLng = lngRad + Math.atan2(
    Math.sin(angle) * Math.sin(d) * Math.cos(latRad),
    Math.cos(d) - Math.sin(latRad) * Math.sin(newLat),
  );

  return {
    lat: newLat * (180 / Math.PI),
    lng: newLng * (180 / Math.PI),
  };
}

/**
 * Convert map region to zoom level for supercluster.
 * Formula based on how map tiles work at different zoom levels.
 */
function getZoomFromRegion(region: Region): number {
  const angle = region.longitudeDelta;
  // Clamp zoom to reasonable range
  return Math.max(0, Math.min(20, Math.round(Math.log(360 / angle) / Math.LN2)));
}

/**
 * Get map bounding box from region for supercluster.
 * Returns [westLng, southLat, eastLng, northLat]
 */
function getBoundingBox(region: Region): [number, number, number, number] {
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  return [
    longitude - longitudeDelta / 2, // west
    latitude - latitudeDelta / 2,   // south
    longitude + longitudeDelta / 2, // east
    latitude + latitudeDelta / 2,   // north
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NearbyScreen() {
  // ══════════════════════════════════════════════════════════════════════════
  // NEARBY STARTUP LOG - trace rendering/crash point
  // ══════════════════════════════════════════════════════════════════════════
  log.info('[NEARBY]', '═══════════════════════════════════════════════');
  log.info('[NEARBY]', 'NearbyScreen rendering');

  const router = useRouter();
  const isDemo = isDemoMode;
  log.info('[NEARBY]', 'Initial state', { isDemo });

  // Map ref for programmatic control
  const mapRef = useRef<MapView>(null);

  // Supercluster instance ref
  const superclusterRef = useRef<Supercluster<UserPointProperties> | null>(null);

  // Current map region for cluster computation
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);

  // Computed clusters/points to render
  const [clusters, setClusters] = useState<ClusterFeature[]>([]);

  // Auth store
  const userId = useAuthStore((s) => s.userId);
  const convexUserId = userId ? asUserId(userId) : undefined;

  // Location store
  const permissionStatus = useLocationStore((s) => s.permissionStatus);
  const startLocationTracking = useLocationStore((s) => s.startLocationTracking);
  const stopLocationTracking = useLocationStore((s) => s.stopLocationTracking);
  const error = useLocationStore((s) => s.error);
  const bestLocation = useBestLocation();

  // UI state
  const [locationUIState, setLocationUIState] = useState<LocationUIState>('checking');
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [showEmptyState, setShowEmptyState] = useState(false);

  // Mount guard for async operations
  const isMountedRef = useRef(true);

  // Ref to track query timeout (prevents race condition)
  const queryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-retry refs (conservative: max 2 attempts, 5s delay)
  const autoRetryCountRef = useRef(0);
  const autoRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AUTO_RETRY_MAX = 2;
  const AUTO_RETRY_DELAY_MS = 5000;

  // Empty state auto-dismiss timer ref
  const emptyStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const EMPTY_STATE_DISMISS_MS = 3000;

  // P2-NEARBY-002: Centralized unmount cleanup for all timer refs
  // This ensures all timers are cleared on unmount, regardless of effect state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear all timer refs on unmount to prevent leaks
      if (queryTimeoutRef.current) {
        clearTimeout(queryTimeoutRef.current);
        queryTimeoutRef.current = null;
      }
      if (autoRetryTimeoutRef.current) {
        clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }
      if (emptyStateTimerRef.current) {
        clearTimeout(emptyStateTimerRef.current);
        emptyStateTimerRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Query nearby users (live mode only)
  // ---------------------------------------------------------------------------
  const nearbyUsersQuery = useQuery(
    api.crossedPaths.getNearbyUsers,
    !isDemo && userId ? { authUserId: userId } : 'skip' // P2 AUTH FIX: Pass auth ID for server-side resolution
  );

  // ---------------------------------------------------------------------------
  // Crossed Paths Badge - show dot when there are new entries
  // ---------------------------------------------------------------------------
  const crossedPathsQuery = useQuery(
    api.crossedPaths.getCrossPathHistory,
    !isDemo && convexUserId ? { userId: convexUserId } : 'skip'
  );

  const [hasNewCrossedPaths, setHasNewCrossedPaths] = useState(false);

  // Check if there are new crossed paths since last viewed
  useEffect(() => {
    if (!crossedPathsQuery || crossedPathsQuery.length === 0) {
      setHasNewCrossedPaths(false);
      return;
    }

    // Get the latest crossed path timestamp
    const latestTimestamp = Math.max(...crossedPathsQuery.map((cp: any) => cp.createdAt || 0));

    // Get last seen timestamp from storage
    AsyncStorage.getItem(CROSSED_PATHS_LAST_SEEN_KEY).then((lastSeenStr) => {
      const lastSeen = lastSeenStr ? parseInt(lastSeenStr, 10) : 0;
      setHasNewCrossedPaths(latestTimestamp > lastSeen);
    }).catch(() => {
      // On error, assume there are new paths if we have any
      setHasNewCrossedPaths(crossedPathsQuery.length > 0);
    });
  }, [crossedPathsQuery]);

  // Track query loading state for error detection
  const isQueryActive = !isDemo && convexUserId !== undefined;
  const isQueryLoading = isQueryActive && nearbyUsersQuery === undefined;

  // Clear timeout when query succeeds or on unmount
  useEffect(() => {
    if (nearbyUsersQuery !== undefined) {
      // Query succeeded - clear any pending timeout
      if (queryTimeoutRef.current) {
        clearTimeout(queryTimeoutRef.current);
        queryTimeoutRef.current = null;
      }
      // Clear any pending auto-retry
      if (autoRetryTimeoutRef.current) {
        clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }
      // Reset auto-retry counter on success
      autoRetryCountRef.current = 0;
      // Clear error if previously set
      if (queryError) {
        setQueryError(null);
      }
    }
  }, [nearbyUsersQuery, queryError]);

  // Set timeout for query loading (30 seconds)
  useEffect(() => {
    if (!isQueryLoading) {
      return;
    }

    // Clear any existing timeout
    if (queryTimeoutRef.current) {
      clearTimeout(queryTimeoutRef.current);
    }

    queryTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      // Only set error if query is still pending
      if (nearbyUsersQuery === undefined && isQueryActive) {
        setQueryError('Unable to load nearby users. Please check your connection.');
        log.warn('[NEARBY]', 'query timeout - no data after 30s');
      }
      queryTimeoutRef.current = null;
    }, QUERY_TIMEOUT_MS);

    return () => {
      if (queryTimeoutRef.current) {
        clearTimeout(queryTimeoutRef.current);
        queryTimeoutRef.current = null;
      }
    };
  }, [isQueryLoading, isQueryActive, nearbyUsersQuery]);

  // ---------------------------------------------------------------------------
  // Auto-retry on query error (conservative: max 2 attempts, 5s delay)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Only auto-retry if there's an error and we haven't exceeded max attempts
    if (!queryError) {
      return;
    }

    // Check if we've exceeded max auto-retry attempts
    if (autoRetryCountRef.current >= AUTO_RETRY_MAX) {
      if (__DEV__) {
        console.log('[NEARBY] auto-retry limit reached, waiting for manual retry');
      }
      return;
    }

    // Clear any existing auto-retry timer (prevents duplicates)
    if (autoRetryTimeoutRef.current) {
      clearTimeout(autoRetryTimeoutRef.current);
    }

    // Schedule auto-retry
    autoRetryTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;

      // Double-check we still have an error and haven't exceeded limit
      if (queryError && autoRetryCountRef.current < AUTO_RETRY_MAX) {
        autoRetryCountRef.current += 1;
        if (__DEV__) {
          console.log('[NEARBY] auto-retry attempt', autoRetryCountRef.current, 'of', AUTO_RETRY_MAX);
        }
        log.info('[NEARBY]', 'auto-retry attempt', { attempt: autoRetryCountRef.current, max: AUTO_RETRY_MAX });

        // Clear error and trigger retry (same as manual retry)
        setQueryError(null);
        setIsRetrying(true);
        startLocationTracking();

        // Clear retry feedback after delay
        setTimeout(() => {
          if (isMountedRef.current) {
            setIsRetrying(false);
          }
        }, 2000);
      }

      autoRetryTimeoutRef.current = null;
    }, AUTO_RETRY_DELAY_MS);

    // Cleanup on unmount or when error clears
    return () => {
      if (autoRetryTimeoutRef.current) {
        clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }
    };
  }, [queryError, startLocationTracking]);

  // ---------------------------------------------------------------------------
  // Publish location mutation (live mode only)
  // ---------------------------------------------------------------------------
  const publishLocationMutation = useMutation(api.crossedPaths.publishLocation);

  // Track last published coords to avoid spam
  const lastPublishedRef = useRef<{ lat: number; lng: number } | null>(null);
  // Guard to prevent concurrent publish calls during initial mount/focus
  const isPublishingRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Crossed Paths Detection - recordLocation mutation with rate limiting
  // ---------------------------------------------------------------------------
  const recordLocationMutation = useMutation(api.crossedPaths.recordLocation);

  // Rate limiting refs for crossed paths detection
  const lastDetectionTimeRef = useRef<number>(0);
  const lastDetectionLatLngRef = useRef<{ lat: number; lng: number } | null>(null);

  // Anti-spam: Don't show crossed-path toast more than once per 10 minutes
  const TOAST_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
  const lastToastTimeRef = useRef<number>(0);

  // Publish location when screen is ready and location is valid
  useEffect(() => {
    // Skip in demo mode
    if (isDemo) {
      if (__DEV__) console.log('[NEARBY] publishLocation skipped: demo mode');
      return;
    }

    // Skip if no user ID (P1 AUTH FIX: now using userId for server-side resolution)
    if (!userId) {
      if (__DEV__) console.log('[NEARBY] publishLocation skipped: no userId');
      return;
    }

    // Skip if location not ready
    if (locationUIState !== 'ready') {
      return;
    }

    // Skip if no valid location
    if (!bestLocation || !isValidMapCoordinate(bestLocation.latitude, bestLocation.longitude)) {
      if (__DEV__) console.log('[NEARBY] publishLocation skipped: invalid coordinates');
      return;
    }

    // Skip if already publishing (prevents duplicate calls during initial mount/focus)
    if (isPublishingRef.current) {
      if (__DEV__) console.log('[NEARBY] publishLocation skipped: already in progress');
      return;
    }

    const lat = bestLocation.latitude;
    const lng = bestLocation.longitude;

    // Skip if same coordinates already published (within ~10m threshold)
    const last = lastPublishedRef.current;
    if (last) {
      const latDiff = Math.abs(lat - last.lat);
      const lngDiff = Math.abs(lng - last.lng);
      // ~10m threshold (0.0001 degrees ≈ 11m)
      if (latDiff < 0.0001 && lngDiff < 0.0001) {
        if (__DEV__) console.log('[NEARBY] publishLocation skipped: same location');
        return;
      }
    }

    // Mark as publishing to prevent concurrent calls
    isPublishingRef.current = true;

    // Publish location (with mount guard)
    (async () => {
      try {
        const result = await publishLocationMutation({
          authUserId: userId!, // P1 AUTH FIX: Pass auth ID for server-side resolution
          latitude: lat,
          longitude: lng,
        });

        // Guard: skip state updates if unmounted
        if (!isMountedRef.current) return;

        // Update last published ref
        lastPublishedRef.current = { lat, lng };

        if (__DEV__) {
          console.log('[NEARBY] publishLocation success:', result);
        }

        // -----------------------------------------------------------------------
        // Crossed Paths Detection: Call recordLocation with rate limiting
        // Only scan if: moved >= 60m AND >= 30s since last scan
        // -----------------------------------------------------------------------
        const now = Date.now();
        const timeSinceLastDetection = now - lastDetectionTimeRef.current;
        const lastDetectionPos = lastDetectionLatLngRef.current;

        // Check time threshold (30 seconds minimum)
        if (timeSinceLastDetection < DETECTION_MIN_INTERVAL_MS) {
          if (__DEV__) {
            console.log('[NEARBY] recordLocation skipped: too soon', {
              elapsed: Math.round(timeSinceLastDetection / 1000) + 's',
            });
          }
          return;
        }

        // Check movement threshold (60 meters minimum)
        if (lastDetectionPos) {
          const distanceMoved = calculateDistanceMeters(
            lastDetectionPos.lat,
            lastDetectionPos.lng,
            lat,
            lng
          );
          if (distanceMoved < DETECTION_MIN_MOVEMENT_METERS) {
            if (__DEV__) {
              console.log('[NEARBY] recordLocation skipped: not enough movement', {
                moved: Math.round(distanceMoved) + 'm',
                required: DETECTION_MIN_MOVEMENT_METERS + 'm',
              });
            }
            return;
          }
        }

        // Rate limits passed - trigger crossed paths detection
        if (!isMountedRef.current) return;
        try {
          const result = await recordLocationMutation({
            authUserId: userId!, // P1 AUTH FIX: Pass auth ID for server-side resolution
            latitude: lat,
            longitude: lng,
            accuracy: bestLocation.accuracy,
          });

          // Update rate limiting refs on success
          lastDetectionTimeRef.current = now;
          lastDetectionLatLngRef.current = { lat, lng };

          if (__DEV__) {
            console.log('[NEARBY] recordLocation success - crossed paths scan triggered', {
              nearbyCount: result?.nearbyCount,
            });
          }

          // Show crossed-path toast if new crossings detected (with anti-spam)
          if (result?.nearbyCount && result.nearbyCount > 0) {
            const timeSinceLastToast = now - lastToastTimeRef.current;
            if (timeSinceLastToast >= TOAST_COOLDOWN_MS) {
              lastToastTimeRef.current = now;
              Toast.show(
                'You crossed paths with someone nearby',
                undefined,
                () => safePush(router, '/(main)/crossed-paths' as any, 'toast->crossed-paths')
              );
            } else if (__DEV__) {
              console.log('[NEARBY] crossed-path toast suppressed (cooldown)', {
                elapsed: Math.round(timeSinceLastToast / 1000) + 's',
                cooldown: Math.round(TOAST_COOLDOWN_MS / 1000) + 's',
              });
            }
          }
        } catch (recordErr) {
          // recordLocation failure should not affect publishLocation flow
          if (__DEV__) {
            console.warn('[NEARBY] recordLocation failed (non-critical):', recordErr);
          }
        }
      } catch (err) {
        // Guard: skip logging if unmounted
        if (!isMountedRef.current) return;

        if (__DEV__) {
          console.error('[NEARBY] publishLocation failed:', err);
        }
        // Silently fail - don't crash the app
      } finally {
        // Always reset publishing flag to allow future calls
        isPublishingRef.current = false;
      }
    })();
  }, [isDemo, userId, locationUIState, bestLocation, publishLocationMutation, recordLocationMutation, router]);

  // ---------------------------------------------------------------------------
  // Demo mode nearby users - placed around current location
  // ---------------------------------------------------------------------------
  const demoNearbyUsers: NearbyUser[] = useMemo(() => {
    if (!isDemo) return [];

    // Demo marker offsets relative to current location (lat, lng in degrees)
    // ~0.003 degrees ≈ 300m, spread in different directions
    const demoOffsets = [
      { latOff: +0.0030, lngOff: +0.0020, distance: 350 },  // NE ~350m
      { latOff: -0.0025, lngOff: +0.0040, distance: 480 },  // SE ~480m
      { latOff: -0.0035, lngOff: -0.0025, distance: 430 },  // SW ~430m
      { latOff: +0.0020, lngOff: -0.0035, distance: 400 },  // NW ~400m
      { latOff: +0.0045, lngOff: +0.0010, distance: 460 },  // N  ~460m
    ];

    // Use current location as base, fallback to demo location
    const baseLat = bestLocation?.latitude ?? DEMO_LOCATION.latitude;
    const baseLng = bestLocation?.longitude ?? DEMO_LOCATION.longitude;

    return DEMO_PROFILES.slice(0, 5).map((profile, index) => {
      const offset = demoOffsets[index] ?? { latOff: 0, lngOff: 0, distance: 500 };
      return {
        id: profile._id,
        name: profile.name,
        age: profile.age,
        publishedLat: baseLat + offset.latOff,
        publishedLng: baseLng + offset.lngOff,
        publishedAt: Date.now() - index * 60 * 60 * 1000, // Stagger by hours
        distance: offset.distance,
        freshness: 'solid' as const,
        photoUrl: profile.photos?.[0]?.url ?? null,
        isVerified: profile.isVerified ?? false,
        strongPrivacyMode: false,
        hideDistance: false,
      };
    });
  }, [isDemo, bestLocation]);

  // ---------------------------------------------------------------------------
  // Combine and process nearby users with fuzzing
  // ---------------------------------------------------------------------------
  const processedNearbyUsers = useMemo(() => {
    const rawUsers: NearbyUser[] = isDemo
      ? demoNearbyUsers
      : (nearbyUsersQuery ?? []);

    const viewerId = userId || 'anonymous';
    let validCount = 0;
    let skippedCount = 0;

    const processed = rawUsers
      .filter((user) => {
        // Skip invalid coordinates
        if (!isValidMapCoordinate(user.publishedLat, user.publishedLng)) {
          skippedCount++;
          return false;
        }
        // Skip self (shouldn't happen but guard anyway)
        if (user.id === userId) {
          skippedCount++;
          return false;
        }
        validCount++;
        return true;
      })
      .map((user) => {
        // Apply privacy fuzzing (use strongPrivacyMode for larger fuzz radius)
        const fuzzed = applyPrivacyFuzz(
          user.publishedLat,
          user.publishedLng,
          user.id,
          viewerId,
          MODULE_SESSION_SALT,
          user.strongPrivacyMode,
        );

        return {
          ...user,
          fuzzedLat: fuzzed.lat,
          fuzzedLng: fuzzed.lng,
        };
      });

    // DEV-only logging
    if (__DEV__) {
      console.log('[NEARBY] Query count:', rawUsers.length);
      console.log('[NEARBY] Rendered markers:', validCount);
      console.log('[NEARBY] Skipped invalid:', skippedCount);
    }

    return processed;
  }, [isDemo, demoNearbyUsers, nearbyUsersQuery, userId]);

  // ---------------------------------------------------------------------------
  // Sort and limit visible markers for performance (max 30)
  // Filtering is handled by Discovery preferences at the backend level
  // ---------------------------------------------------------------------------
  const visibleUsers = useMemo(() => {
    const sorted = [...processedNearbyUsers];

    // Sort: verified users first, then by freshness, then by distance
    sorted.sort((a, b) => {
      // Verified first
      if (a.isVerified && !b.isVerified) return -1;
      if (!a.isVerified && b.isVerified) return 1;
      // Fresh first
      if (a.freshness === 'solid' && b.freshness === 'faded') return -1;
      if (a.freshness === 'faded' && b.freshness === 'solid') return 1;
      // Closer first
      return (a.distance ?? 1000) - (b.distance ?? 1000);
    });

    return sorted.slice(0, 30);
  }, [processedNearbyUsers]);

  // Alias for rendering (visibleUsers are the processed, sorted, limited markers)
  const mapUsers = visibleUsers;

  // ---------------------------------------------------------------------------
  // Supercluster: Initialize and compute clusters
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Create supercluster instance with same settings as previous library
    const cluster = new Supercluster<UserPointProperties>({
      radius: CLUSTER_RADIUS,
      maxZoom: CLUSTER_MAX_ZOOM,
    });

    // Convert users to GeoJSON points
    const points: Supercluster.PointFeature<UserPointProperties>[] = mapUsers
      .filter(user => isValidMapCoordinate(user.fuzzedLat, user.fuzzedLng))
      .map(user => ({
        type: 'Feature' as const,
        properties: {
          id: user.id,
          user,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [user.fuzzedLng, user.fuzzedLat], // GeoJSON is [lng, lat]
        },
      }));

    // Load points into supercluster
    cluster.load(points);
    superclusterRef.current = cluster;

    // Compute initial clusters if we have a region
    if (currentRegion) {
      try {
        const zoom = getZoomFromRegion(currentRegion);
        const bbox = getBoundingBox(currentRegion);
        const newClusters = cluster.getClusters(bbox, zoom);
        setClusters(newClusters);
      } catch (e) {
        log.warn('[NEARBY]', 'Error computing clusters', { error: String(e) });
        setClusters([]);
      }
    }
  }, [mapUsers, currentRegion]);

  // Handler for map region changes - recompute clusters
  const handleRegionChangeComplete = useCallback((region: Region) => {
    setCurrentRegion(region);

    if (!superclusterRef.current) return;

    try {
      const zoom = getZoomFromRegion(region);
      const bbox = getBoundingBox(region);
      const newClusters = superclusterRef.current.getClusters(bbox, zoom);
      setClusters(newClusters);
    } catch (e) {
      log.warn('[NEARBY]', 'Error computing clusters on region change', { error: String(e) });
    }
  }, []);

  // Handler for cluster press - zoom into cluster
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClusterPress = useCallback((cluster: Supercluster.ClusterFeature<any>) => {
    if (!mapRef.current || !superclusterRef.current) return;

    try {
      const clusterId = cluster.properties.cluster_id;
      const expansionZoom = superclusterRef.current.getClusterExpansionZoom(clusterId);
      const [lng, lat] = cluster.geometry.coordinates;

      // Calculate new region based on expansion zoom
      const latDelta = 360 / Math.pow(2, expansionZoom);
      const lngDelta = latDelta;

      mapRef.current.animateToRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: latDelta,
        longitudeDelta: lngDelta,
      }, 300);
    } catch (e) {
      log.warn('[NEARBY]', 'Error handling cluster press', { error: String(e) });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Empty state: show once per app session, auto-dismiss after 3 seconds
  // ---------------------------------------------------------------------------
  const isEmptyStateCondition = locationUIState === 'ready' && mapUsers.length === 0 && !isDemo && !isQueryLoading && !isRetrying;

  useEffect(() => {
    // If conditions for empty state are not met, hide and clear timer
    if (!isEmptyStateCondition) {
      setShowEmptyState(false);
      if (emptyStateTimerRef.current) {
        clearTimeout(emptyStateTimerRef.current);
        emptyStateTimerRef.current = null;
      }
      return;
    }

    // If already shown this session, don't show again
    if (hasShownEmptyStateThisSession) {
      return;
    }

    // Show empty state and mark as shown this session
    hasShownEmptyStateThisSession = true;
    setShowEmptyState(true);

    // Auto-dismiss after 3 seconds
    emptyStateTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setShowEmptyState(false);
      }
      emptyStateTimerRef.current = null;
    }, EMPTY_STATE_DISMISS_MS);

    // Cleanup on unmount
    return () => {
      if (emptyStateTimerRef.current) {
        clearTimeout(emptyStateTimerRef.current);
        emptyStateTimerRef.current = null;
      }
    };
  }, [isEmptyStateCondition]);

  // ---------------------------------------------------------------------------
  // Navigation handlers for header buttons
  // ---------------------------------------------------------------------------
  const handleOpenCrossedPaths = useCallback(() => {
    // Mark crossed paths as seen
    AsyncStorage.setItem(CROSSED_PATHS_LAST_SEEN_KEY, Date.now().toString()).catch(() => {});
    setHasNewCrossedPaths(false);
    safePush(router, '/(main)/crossed-paths' as any, 'nearby->crossed-paths');
  }, [router]);

  const handleOpenNearbySettings = useCallback(() => {
    safePush(router, '/(main)/nearby-settings' as any, 'nearby->nearby-settings');
  }, [router]);

  // ---------------------------------------------------------------------------
  // Marker press handler - opens full profile
  // ---------------------------------------------------------------------------
  const handleMarkerPress = useCallback((user: ProcessedNearbyUser) => {
    if (!user?.id) {
      if (__DEV__) console.warn('[NEARBY] Marker press with no user');
      return;
    }

    log.info('[NEARBY]', 'marker tapped, opening profile', { id: user.id, name: user.name });
    safePush(router, `/(main)/profile/${user.id}` as any, 'nearby->profile');
  }, [router]);

  // ---------------------------------------------------------------------------
  // Map control handlers
  // ---------------------------------------------------------------------------
  // ============================================================================
  // LOCKED: RECENTER BUTTON BEHAVIOR
  // - Tap-once recenter only (no follow mode, no second-state)
  // - Do NOT add tracking mode or other stateful behavior without approval
  // ============================================================================

  /** Recenter map to user's current location */
  const handleRecenterToMyLocation = useCallback(() => {
    if (!mapRef.current) return;

    // Use real location if available
    if (bestLocation && isValidMapCoordinate(bestLocation.latitude, bestLocation.longitude)) {
      mapRef.current.animateToRegion({
        latitude: bestLocation.latitude,
        longitude: bestLocation.longitude,
        latitudeDelta: DEFAULT_LATITUDE_DELTA,
        longitudeDelta: DEFAULT_LONGITUDE_DELTA,
      }, 300);
      log.info('[NEARBY]', 'recentered to my location');
    } else if (__DEV__) {
      console.warn('[NEARBY] No valid location for recenter');
    }
  }, [bestLocation]);

  // ---------------------------------------------------------------------------
  // Permission flow on focus - start/stop GPS tracking
  // ---------------------------------------------------------------------------
  useFocusEffect(
    useCallback(() => {
      log.info('[NEARBY]', 'screen focused, starting location tracking');
      startLocationTracking();

      // Cleanup: stop tracking when leaving Nearby tab (battery optimization)
      return () => {
        log.info('[NEARBY]', 'screen unfocused, stopping location tracking');
        stopLocationTracking();
      };
    }, [startLocationTracking, stopLocationTracking])
  );

  // ---------------------------------------------------------------------------
  // Derive UI state from location store
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Demo mode: always ready with fallback location
    if (isDemo) {
      setLocationUIState('ready');
      return;
    }

    // Check permission status
    if (permissionStatus === 'unknown') {
      setLocationUIState('checking');
      return;
    }

    if (permissionStatus === 'services_disabled') {
      setLocationUIState('services_disabled');
      return;
    }

    if (permissionStatus === 'restricted') {
      setLocationUIState('restricted');
      return;
    }

    if (permissionStatus === 'denied') {
      setLocationUIState('denied_needs_settings');
      return;
    }

    // Permission granted - check if we have valid coordinates
    if (permissionStatus === 'granted') {
      if (error) {
        setLocationUIState('error');
        return;
      }

      if (bestLocation && isValidMapCoordinate(bestLocation.latitude, bestLocation.longitude)) {
        setLocationUIState('ready');
      } else {
        // Still waiting for GPS fix
        setLocationUIState('checking');
      }
    }
  }, [isDemo, permissionStatus, error, bestLocation]);

  // ---------------------------------------------------------------------------
  // Compute map region
  // ---------------------------------------------------------------------------
  const mapRegion: Region | null = useMemo(() => {
    // Use best available location (works for both demo and real mode)
    if (bestLocation && isValidMapCoordinate(bestLocation.latitude, bestLocation.longitude)) {
      return {
        latitude: bestLocation.latitude,
        longitude: bestLocation.longitude,
        latitudeDelta: DEFAULT_LATITUDE_DELTA,
        longitudeDelta: DEFAULT_LONGITUDE_DELTA,
      };
    }

    // Fallback: Demo mode uses DEMO_LOCATION, real mode returns null
    if (isDemo) {
      return {
        latitude: DEMO_LOCATION.latitude,
        longitude: DEMO_LOCATION.longitude,
        latitudeDelta: DEFAULT_LATITUDE_DELTA,
        longitudeDelta: DEFAULT_LONGITUDE_DELTA,
      };
    }

    return null;
  }, [isDemo, bestLocation]);

  // ---------------------------------------------------------------------------
  // Open device settings
  // ---------------------------------------------------------------------------
  const openSettings = useCallback(() => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings().catch(() => {
        log.warn('[NEARBY]', 'Failed to open settings');
      });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Retry query handler (manual)
  // ---------------------------------------------------------------------------
  const handleRetryQuery = useCallback(() => {
    // Clear any pending auto-retry timer
    if (autoRetryTimeoutRef.current) {
      clearTimeout(autoRetryTimeoutRef.current);
      autoRetryTimeoutRef.current = null;
    }

    // Reset auto-retry counter (user gets fresh attempts after manual retry)
    autoRetryCountRef.current = 0;

    // Clear error and show loading feedback
    setQueryError(null);
    setIsRetrying(true);

    // Re-trigger location tracking which will re-run query
    startLocationTracking();

    // Clear retry state after a delay (query will auto-resolve via Convex)
    setTimeout(() => {
      if (isMountedRef.current) {
        setIsRetrying(false);
      }
    }, 2000);
  }, [startLocationTracking]);

  // ---------------------------------------------------------------------------
  // Render: Checking state
  // ---------------------------------------------------------------------------
  log.info('[NEARBY]', 'Render check', { locationUIState, permissionStatus, hasError: !!error });

  if (locationUIState === 'checking') {
    log.info('[NEARBY]', 'Showing checking state');
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Nearby</Text>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.statusText}>Getting your location...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Permission required
  // ---------------------------------------------------------------------------
  if (locationUIState === 'permission_required') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Nearby</Text>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="location-outline" size={64} color={COLORS.textLight} />
          <Text style={styles.title}>Location Access Needed</Text>
          <Text style={styles.subtitle}>
            To see people nearby, please enable location access.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={startLocationTracking}>
            <Text style={styles.primaryButtonText}>Enable Location</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Denied - needs settings
  // ---------------------------------------------------------------------------
  if (locationUIState === 'denied_needs_settings') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Nearby</Text>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="navigate-circle-outline" size={64} color={COLORS.textLight} />
          <Text style={styles.title}>Location Access Denied</Text>
          <Text style={styles.subtitle}>
            Please enable location access in your device settings to see people nearby.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={openSettings}>
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Restricted (iOS parental controls)
  // ---------------------------------------------------------------------------
  if (locationUIState === 'restricted') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Nearby</Text>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={64} color={COLORS.textLight} />
          <Text style={styles.title}>Location Restricted</Text>
          <Text style={styles.subtitle}>
            Location access is restricted on this device, possibly due to parental controls or device management. Contact your device administrator for help.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Location Services Disabled (system-wide)
  // ---------------------------------------------------------------------------
  if (locationUIState === 'services_disabled') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Nearby</Text>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="location-outline" size={64} color={COLORS.textLight} />
          <Text style={styles.title}>Location Services Off</Text>
          <Text style={styles.subtitle}>
            Please enable Location Services in your device settings to see people nearby.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={openSettings}>
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Error state
  // ---------------------------------------------------------------------------
  if (locationUIState === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Nearby</Text>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={64} color={COLORS.warning} />
          <Text style={styles.title}>Location Error</Text>
          <Text style={styles.subtitle}>
            {error || 'Unable to get your location. Please try again.'}
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={startLocationTracking}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Query error state
  // ---------------------------------------------------------------------------
  if (queryError) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Nearby</Text>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={64} color={COLORS.warning} />
          <Text style={styles.title}>Connection Issue</Text>
          <Text style={styles.subtitle}>
            {queryError}
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleRetryQuery}>
            <Text style={styles.primaryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Ready - show map
  // ---------------------------------------------------------------------------
  log.info('[NEARBY]', 'Attempting to render map', {
    hasMapRegion: !!mapRegion,
    locationUIState,
    userCount: mapUsers?.length ?? 0,
  });

  // Final safety check: ensure we have valid region
  if (!mapRegion) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={{ width: 22 }} />
          <Text style={styles.headerTitle}>Nearby</Text>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.statusText}>Preparing map...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ width: 22 }} />

        <Text style={styles.headerTitle}>Nearby</Text>

        <TouchableOpacity
          onPress={handleOpenCrossedPaths}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Crossed paths"
          accessibilityHint="View people you've crossed paths with"
        >
          <View>
            <Ionicons name="footsteps-outline" size={22} color={COLORS.text} />
            {hasNewCrossedPaths && (
              <Badge dot animate style={styles.crossedPathsBadge} />
            )}
          </View>
        </TouchableOpacity>

        {isDemo && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </View>
        )}

              </View>

      {/* STABILITY FIX S4: Error boundary around map for crash containment */}
      <MapErrorBoundary>
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={mapRegion}
          onRegionChangeComplete={handleRegionChangeComplete}
          onMapReady={() => {
            // Set initial region for cluster computation
            if (mapRegion) {
              setCurrentRegion(mapRegion);
            }
          }}
          showsUserLocation={permissionStatus === 'granted'}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={true}
          pitchEnabled={false}
        >
          {/* ================================================================
           * CLUSTERING: Manual implementation with supercluster
           * ================================================================
           * STATUS: LOCKED - Do not change without Durga Prasad approval
           *
           * IMPLEMENTATION:
           * - Uses supercluster (JS) for Fabric/New Architecture compatibility
           * - Image-based cluster markers for Android reliability
           * - Cluster tap → zooms to reveal individual markers
           * - radius={45} matches previous react-native-map-clustering config
           *
           * DO NOT:
           * - Change clustering radius without testing
           * - Switch to View-based cluster markers
           * ================================================================ */}
          {clusters.map((feature) => {
            const [lng, lat] = feature.geometry.coordinates;

            // Safety: validate coordinates
            if (!isValidMapCoordinate(lat, lng)) {
              return null;
            }

            // Check if this is a cluster or individual point
            const isCluster = feature.properties && 'cluster' in feature.properties && feature.properties.cluster;

            if (isCluster) {
              // Render cluster marker
              const clusterFeature = feature as Supercluster.ClusterFeature<UserPointProperties>;
              const pointCount = clusterFeature.properties.point_count ?? 2;
              const clusterImage = getClusterImage(pointCount);

              return (
                <Marker
                  key={`cluster-${clusterFeature.properties.cluster_id}`}
                  coordinate={{ latitude: lat, longitude: lng }}
                  anchor={{ x: 0.5, y: 1 }}
                  onPress={() => handleClusterPress(clusterFeature)}
                  image={clusterImage}
                />
              );
            } else {
              // Render individual user marker
              const pointFeature = feature as Supercluster.PointFeature<UserPointProperties>;
              const user = pointFeature.properties.user;

              return (
                <Marker
                  key={user.id}
                  coordinate={{ latitude: lat, longitude: lng }}
                  anchor={{ x: 0.5, y: 1 }}
                  onPress={() => handleMarkerPress(user)}
                  image={pinPink}
                />
              );
            }
          })}
        </MapView>

        {/* Query loading indicator - shown while fetching nearby users */}
        {(isQueryLoading || isRetrying) && !isDemo && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingText}>
                {isRetrying ? 'Retrying...' : 'Finding people nearby...'}
              </Text>
            </View>
          </View>
        )}

        {/* Empty state overlay - shown once per app session, auto-dismisses after 3s */}
        {showEmptyState && (
          <View style={styles.emptyOverlay}>
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={32} color={COLORS.textLight} />
              <Text style={styles.emptyTitle}>No one nearby right now</Text>
              <Text style={styles.emptySubtitle}>
                Check back later or see who crossed your path
              </Text>
              <TouchableOpacity style={styles.emptyActionButton} onPress={handleOpenCrossedPaths}>
                <Ionicons name="footsteps-outline" size={16} color={COLORS.primary} />
                <Text style={styles.emptyActionText}>Crossed Paths</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* My location button (static, tap-once recenter) */}
        {permissionStatus === 'granted' && bestLocation && (
          <TouchableOpacity
            style={styles.myLocationButton}
            onPress={handleRecenterToMyLocation}
            activeOpacity={0.8}
          >
            <Ionicons name="locate" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        )}
      </View>
      </MapErrorBoundary>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  // CLEANUP: headerSpacer removed - unused
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  crossedPathsBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
  },
  demoBadge: {
    position: 'absolute',
    right: 16,
    backgroundColor: COLORS.warning,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  demoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  statusText: {
    fontSize: 15,
    color: COLORS.textLight,
    marginTop: 12,
  },
  primaryButton: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 25,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  // NOTE: Cluster markers use image={pinPink} for Android reliability.
  // Custom View-based cluster styles removed - they were unreliable on Android.
  // Overlay styles
  loadingOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  emptyOverlay: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  emptyCard: {
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 10,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 4,
  },
  emptyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: `${COLORS.primary}15`,
    gap: 6,
  },
  emptyActionText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.primary,
  },
  // My location button (static, tap-once recenter)
  myLocationButton: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
});
