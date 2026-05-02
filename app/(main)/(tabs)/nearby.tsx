/*
 * LOCKED (NEARBY TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */

/**
 * Nearby Tab - Full Implementation
 *
 * Features:
 * - Permission state UI (checking/denied/settings/ready)
 * - Safe map render with coordinate validation
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
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import MapView, { Region, Marker } from 'react-native-maps';
import Supercluster from 'supercluster';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useLocationStore, useBestLocation } from '@/stores/locationStore';
import { useAuthStore } from '@/stores/authStore';
import { safePush } from '@/lib/safeRouter';
import {
  COLORS,
  SPACING,
  SIZES,
  FONT_SIZE,
  FONT_WEIGHT,
  lineHeight,
  moderateScale,
} from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_USER, DEMO_PROFILES } from '@/lib/demoData';
import { log } from '@/utils/logger';
import { Toast } from '@/components/ui/Toast';
import { Badge } from '@/components/ui/Badge';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { getPrimaryPhotoUrl } from '@/lib/photoUtils';
import { NearbyPreviewCard, NearbyPreviewData } from '@/components/nearby/NearbyPreviewCard';
import { trackEvent } from '@/lib/analytics';
import { useScreenProtection } from '@/hooks/useScreenProtection';

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
          <Ionicons name="map-outline" size={moderateScale(48, 0.3)} color={COLORS.textLight} />
          <Text style={mapErrorStyles.title} maxFontSizeMultiplier={1.2}>Map unavailable</Text>
          <Text style={mapErrorStyles.subtitle} maxFontSizeMultiplier={1.2}>
            Something went wrong loading the map
          </Text>
          <TouchableOpacity style={mapErrorStyles.retryButton} onPress={this.handleRetry}>
            <Text style={mapErrorStyles.retryText} maxFontSizeMultiplier={1.2}>Try Again</Text>
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
    padding: SPACING.xxl,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: FONT_SIZE.xl,
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.text,
    marginTop: SPACING.base,
  },
  subtitle: {
    fontSize: FONT_SIZE.md,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  retryButton: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: moderateScale(20, 0.25),
  },
  retryText: {
    color: '#fff',
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    fontWeight: FONT_WEIGHT.semibold,
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
  | 'denied_needs_settings'
  | 'restricted'           // iOS parental controls
  | 'services_disabled'    // System-wide location off
  | 'error'
  | 'ready';

/** Nearby user from query (crossed-path payload contract).
 *
 * No raw/stored coordinates or numeric distance are transported. The server
 * emits only:
 *   - cellId: stable coarse crossed-path grid cell identifier (~300m)
 *   - displayLat/displayLng: per-request randomized point INSIDE that crossed-path cell
 *   - distanceBucket: 'very_close' | 'nearby' | 'in_your_area'
 *   - freshnessLabel: 'recent' | 'earlier' | 'stale'
 */
interface NearbyUser {
  id: string;
  name: string;
  age: number;
  cellId: string;
  displayLat: number;
  displayLng: number;
  distanceBucket?: 'very_close' | 'nearby' | 'in_your_area';
  freshness: 'solid' | 'faded';
  // Three-tier coarse crossed-path recency label.
  // 'recent' = <=24h, 'earlier' = <=7d, 'stale' = <=14d.
  freshnessLabel?: 'recent' | 'earlier' | 'stale';
  photoUrl: string | null;
  isVerified: boolean;
  strongPrivacyMode: boolean;
  hideDistance: boolean;
  // Phase-3 preview payload (server-provided, privacy-safe).
  //   - tagline: short (<= 80 chars) teaser drawn from the target's own
  //     profile fields (prompt answer → first activity → bio snippet).
  //   - sharedInterests: up to 3 prettified interest keys the viewer and
  //     target have in common.
  // Both are optional and render nothing when absent.
  tagline?: string;
  sharedInterests?: string[];
}

type NearbyQueryStatus = 'ok' | 'viewer_unverified' | 'location_required';

interface NearbyUsersQueryResult {
  status: NearbyQueryStatus;
  users: NearbyUser[];
}

/** Processed nearby user — alias of the Phase-2.5 payload.
 *
 * We keep this named type because supercluster and downstream render
 * code reference it, but we no longer carry any separate "fuzzed" coords
 * on the client: the server already emits a per-request randomized
 * displayLat/displayLng and that is what the map renders. */
type ProcessedNearbyUser = NearbyUser;

interface NearbyMapNotice {
  message: string;
  actionLabel?: string;
  onPress?: () => void;
}

interface NearbySyncIssue {
  kind: 'publish' | 'record';
  message: string;
  actionLabel: string;
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

// Rate limiting constants for crossed paths detection.
// PRODUCT FIX: unified with server MIN_MOVEMENT_FOR_CROSSING_METERS (25m).
// Prior 60m client / 30m server mismatch meant the server value never applied.
// 25m is permissive enough to catch real crossings on short walks between
// shops/cafes while still filtering stationary GPS jitter.
const DETECTION_MIN_MOVEMENT_METERS = 25; // Aligned with server; catches real crossings
const DETECTION_MIN_INTERVAL_MS = 30000; // Only scan every 30s+
const PUBLISH_REFRESH_INTERVAL_MS = 30000; // Refresh publishedAt at least every 30s while Nearby is active

// P3-NEARBY-002: Query timeout constant (extracted from inline 30000ms)
const QUERY_TIMEOUT_MS = 30000; // 30 seconds before showing error
const LOCATION_ACQUIRE_TIMEOUT_MS = 15000; // 15 seconds before fallback error
const LOADING_OVERLAY_DELAY_MS = 180;
const MAP_FADE_IN_DURATION_MS = 220;

// Demo fallback location (Mumbai)
const DEMO_LOCATION = {
  latitude: DEMO_USER.latitude,
  longitude: DEMO_USER.longitude,
};

// P0 MAP-RECOVERY: Safe fallback region used for initialRegion when live
// location hasn't resolved yet. Ensures MapView always mounts with a valid
// Region object (never undefined / NaN), preventing blank-map regressions.
// The map re-centers to the user's real location as soon as it's available.
const FALLBACK_REGION: Region = {
  latitude: DEMO_LOCATION.latitude,
  longitude: DEMO_LOCATION.longitude,
  latitudeDelta: DEFAULT_LATITUDE_DELTA,
  longitudeDelta: DEFAULT_LONGITUDE_DELTA,
};

// Supercluster configuration (matches previous react-native-map-clustering behavior)
const CLUSTER_RADIUS = 45;
const CLUSTER_MAX_ZOOM = 20;

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

/** Convert map region to zoom level for supercluster. */
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
  const router = useRouter();
  const isDemo = isDemoMode;
  const insets = useSafeAreaInsets();

  // Safe Nearby v2 — Android FLAG_SECURE on this tab only.
  // Blocks screenshots + screen recording while Nearby is mounted, preventing
  // coarse-pin leakage via screen capture. iOS is intentionally left untouched
  // (optional hardening for a later pass).
  useScreenProtection(Platform.OS === 'android');

  // Map ref for programmatic control
  const mapRef = useRef<MapView>(null);

  // Supercluster instance ref
  const superclusterRef = useRef<Supercluster<UserPointProperties> | null>(null);

  // Current map region for cluster computation
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);
  const [isNearbyFocused, setIsNearbyFocused] = useState(false);
  const [publishRefreshTick, setPublishRefreshTick] = useState(0);

  // Computed clusters/points to render
  const [clusters, setClusters] = useState<ClusterFeature[]>([]);

  // Auth store
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  // Location store
  const permissionStatus = useLocationStore((s) => s.permissionStatus);
  const startLocationTracking = useLocationStore((s) => s.startLocationTracking);
  const stopLocationTracking = useLocationStore((s) => s.stopLocationTracking);
  const error = useLocationStore((s) => s.error);
  const bestLocation = useBestLocation();

  // UI state
  const [locationUIState, setLocationUIState] = useState<LocationUIState>('checking');
  const [locationTimeoutMessage, setLocationTimeoutMessage] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [showEmptyState, setShowEmptyState] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [retainedNearbyUsersResult, setRetainedNearbyUsersResult] = useState<NearbyUsersQueryResult | null>(null);
  const [nearbyRefreshKey, setNearbyRefreshKey] = useState(0);
  // Phase-3: preview card state. When non-null, the single-step preview
  // modal is shown and the user has not yet committed to opening the full
  // profile. All preview data comes from the already-fetched payload — no
  // additional network call.
  const [previewUser, setPreviewUser] = useState<NearbyPreviewData | null>(null);

  // Mount guard for async operations
  const isMountedRef = useRef(true);

  // Ref to track query timeout (prevents race condition)
  const queryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationAcquireTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingOverlayDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P1-003 FIX: Ref to track query completion for timeout callback
  // This provides fresh state check inside setTimeout, avoiding stale closure values
  const queryCompletedRef = useRef(false);

  // Auto-retry refs (conservative: max 2 attempts, 5s delay)
  const autoRetryCountRef = useRef(0);
  const autoRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AUTO_RETRY_MAX = 2;
  const AUTO_RETRY_DELAY_MS = 5000;

  // ---------------------------------------------------------------------------
  // P3 POLISH: Animation refs for premium feel
  // ---------------------------------------------------------------------------
  // Empty state is persistent: the card stays visible as long as the empty
  // condition is true. An earlier iteration auto-hid the card after a few
  // seconds, which left users staring at an empty map with no explanation
  // or recovery affordance. Hybrid-UX restoration keeps the card in view
  // until new users appear (handled by the show/clear effects below).
  // P3-002: Recenter button press scale animation
  const recenterScale = useRef(new Animated.Value(1)).current;
  // P3-003: Loading overlay fade animation
  const loadingOpacity = useRef(new Animated.Value(0)).current;
  // P3-004: Subtle pulse on empty state (center of map, low CPU, native driver)
  const emptyPulseScale = useRef(new Animated.Value(1)).current;
  const emptyPulseOpacity = useRef(new Animated.Value(0.28)).current;
  // P3-005: Empty card entry animation (fade + slight rise)
  const emptyCardOpacity = useRef(new Animated.Value(0)).current;
  const emptyCardTranslateY = useRef(new Animated.Value(10)).current;
  // P2-FIX-4: Removed mapOpacity Animated.Value — the fade-in caused the
  // map to remain invisible when onMapReady didn't fire reliably on Android
  // (a known react-native-maps issue when mounted inside opacity:0 parent).
  // Map now renders at full opacity from mount; isMapReady still drives the
  // boot overlay for UX.
  const lastNearbyRefreshAtRef = useRef(0);
  const [nearbySyncIssue, setNearbySyncIssue] = useState<NearbySyncIssue | null>(null);
  const requestNearbyRefresh = useCallback(
    (options?: { force?: boolean; minIntervalMs?: number }) => {
      const force = options?.force ?? false;
      const minIntervalMs = options?.minIntervalMs ?? 1500;
      const now = Date.now();

      if (!force && now - lastNearbyRefreshAtRef.current < minIntervalMs) {
        return false;
      }

      lastNearbyRefreshAtRef.current = now;
      setNearbyRefreshKey((current) => current + 1);
      return true;
    },
    [],
  );

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
      if (locationAcquireTimeoutRef.current) {
        clearTimeout(locationAcquireTimeoutRef.current);
        locationAcquireTimeoutRef.current = null;
      }
      if (publishRefreshIntervalRef.current) {
        clearInterval(publishRefreshIntervalRef.current);
        publishRefreshIntervalRef.current = null;
      }
      if (loadingOverlayDelayRef.current) {
        clearTimeout(loadingOverlayDelayRef.current);
        loadingOverlayDelayRef.current = null;
      }
      if (autoRetryTimeoutRef.current) {
        clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }
    };
  }, []);

  // DEV-only startup log (runs once on mount, not on every render)
  useEffect(() => {
    if (__DEV__) {
      log.info('[NEARBY]', 'NearbyScreen mounted', { isDemo });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Query nearby users (live mode only)
  // ---------------------------------------------------------------------------
  const hasValidBestLocation = !!(
    bestLocation &&
    isValidMapCoordinate(bestLocation.latitude, bestLocation.longitude)
  );
  const blockingLocationErrorMessage = !hasValidBestLocation
    ? (locationTimeoutMessage ?? error)
    : null;
  const passiveLocationErrorMessage = hasValidBestLocation
    ? (locationTimeoutMessage ?? error)
    : null;
  const authToken =
    typeof token === 'string' && token.trim().length > 0 ? token : null;
  const shouldRunNearbyUsersQuery = Boolean(
    !isDemo &&
    authToken &&
    isNearbyFocused &&
    permissionStatus === 'granted' &&
    !blockingLocationErrorMessage
  );
  const shouldRunCrossedPathSummaryQuery = Boolean(
    !isDemo &&
    authToken &&
    isNearbyFocused
  );

  const nearbyUsersQuery = useQuery(
    api.crossedPaths.getNearbyUsers,
    shouldRunNearbyUsersQuery && userId
      ? { userId }
      : 'skip'
  );

  // ---------------------------------------------------------------------------
  // Crossed Paths Badge - show dot when there are new entries
  // ---------------------------------------------------------------------------
  const crossedPathSummaryQuery = useQuery(
    api.crossedPaths.getCrossedPathSummary,
    shouldRunCrossedPathSummaryQuery && userId ? { userId } : 'skip'
  );

  const [hasNewCrossedPaths, setHasNewCrossedPaths] = useState(false);

  // Check if there are new crossed paths since last viewed
  useEffect(() => {
    if (!crossedPathSummaryQuery || crossedPathSummaryQuery.count === 0) {
      setHasNewCrossedPaths(false);
      return;
    }

    const latestTimestamp = crossedPathSummaryQuery.latestCreatedAt ?? 0;
    if (!latestTimestamp) {
      setHasNewCrossedPaths(false);
      return;
    }

    // Get last seen timestamp from storage
    // P1-005 FIX: Add mount guard to prevent state update after unmount
    AsyncStorage.getItem(CROSSED_PATHS_LAST_SEEN_KEY).then((lastSeenStr) => {
      if (!isMountedRef.current) return;
      const lastSeen = lastSeenStr ? parseInt(lastSeenStr, 10) : 0;
      setHasNewCrossedPaths(latestTimestamp > lastSeen);
    }).catch(() => {
      if (!isMountedRef.current) return;
      // On error, assume there are new paths if we have any
      setHasNewCrossedPaths(crossedPathSummaryQuery.count > 0);
    });
  }, [crossedPathSummaryQuery]);

  // Track query loading state for error detection
  const isQueryActive = shouldRunNearbyUsersQuery;
  const isQueryLoading = isQueryActive && nearbyUsersQuery === undefined;
  // NEARBY_ENTRY fix: when we still have a previous good result retained in
  // state, a focus-triggered refresh must stay silent — we keep showing the
  // retained data instead of flashing the loading overlay. Only a true cold
  // start (no retained data) may show it.
  const hasRetainedGoodResult =
    retainedNearbyUsersResult != null && retainedNearbyUsersResult.status === 'ok';
  const shouldShowLoadingState =
    (isQueryLoading || isRetrying) && !isDemo && !hasRetainedGoodResult;

  // [NEARBY_ENTRY] loading_state trace — emitted whenever the decision changes.
  useEffect(() => {
    if (!__DEV__) return;
    console.log('[NEARBY_ENTRY][loading_state]', {
      isQueryLoading,
      isRetrying,
      hasRetainedGoodResult,
      shouldShowLoadingState,
      mode: hasRetainedGoodResult && isQueryLoading ? 'background_refresh' : (shouldShowLoadingState ? 'cold_start_loader' : 'idle'),
    });
  }, [isQueryLoading, isRetrying, hasRetainedGoodResult, shouldShowLoadingState]);

  useEffect(() => {
    if (userId) {
      setRetainedNearbyUsersResult(null);
    }
  }, [userId]);

  // Clear timeout when query succeeds or on unmount
  useEffect(() => {
    if (nearbyUsersQuery !== undefined) {
      // P1-003 FIX: Mark query as completed (checked by timeout callback)
      queryCompletedRef.current = true;
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
      if (isRetrying) {
        setIsRetrying(false);
      }
    }
  }, [nearbyUsersQuery, queryError, isRetrying]);

  // Set timeout for query loading (30 seconds)
  useEffect(() => {
    if (!isQueryLoading) {
      return;
    }

    // Clear any existing timeout
    if (queryTimeoutRef.current) {
      clearTimeout(queryTimeoutRef.current);
    }

    // P1-003 FIX: Reset completion flag when starting new query timeout
    queryCompletedRef.current = false;

    queryTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      // P1-003 FIX: Check ref for fresh state instead of stale closure value
      // If query completed between timeout set and callback execution, skip error
      if (queryCompletedRef.current) {
        queryTimeoutRef.current = null;
        return;
      }
      // Only set error if query is still pending
      if (isQueryActive) {
        setQueryError('Nearby is taking longer than usual to refresh.');
        setIsRetrying(false);
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
  }, [isQueryLoading, isQueryActive]);

  // P3-003: Delay + fade the loading overlay so quick refreshes do not flash
  useEffect(() => {
    if (loadingOverlayDelayRef.current) {
      clearTimeout(loadingOverlayDelayRef.current);
      loadingOverlayDelayRef.current = null;
    }

    if (shouldShowLoadingState) {
      if (showLoadingOverlay) {
        return;
      }

      loadingOverlayDelayRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setShowLoadingOverlay(true);
        loadingOpacity.setValue(0);
        Animated.timing(loadingOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }).start();
      }, LOADING_OVERLAY_DELAY_MS);
    } else {
      Animated.timing(loadingOpacity, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && isMountedRef.current) {
          setShowLoadingOverlay(false);
        }
      });
    }

    return () => {
      if (loadingOverlayDelayRef.current) {
        clearTimeout(loadingOverlayDelayRef.current);
        loadingOverlayDelayRef.current = null;
      }
    };
  }, [loadingOpacity, shouldShowLoadingState, showLoadingOverlay]);

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
        requestNearbyRefresh({ force: true });
        startLocationTracking();
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
  }, [queryError, requestNearbyRefresh, startLocationTracking]);

  // ---------------------------------------------------------------------------
  // Publish location mutation (live mode only)
  // ---------------------------------------------------------------------------
  const publishLocationMutation = useMutation(api.crossedPaths.publishLocation);

  // Track last published coords to avoid spam
  const lastPublishedRef = useRef<{ lat: number; lng: number; publishedAt: number } | null>(null);
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

  useEffect(() => {
    if (publishRefreshIntervalRef.current) {
      clearInterval(publishRefreshIntervalRef.current);
      publishRefreshIntervalRef.current = null;
    }

    if (!isNearbyFocused || isDemo || !token || locationUIState !== 'ready') {
      return;
    }

    publishRefreshIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      setPublishRefreshTick((current) => current + 1);
    }, PUBLISH_REFRESH_INTERVAL_MS);

    return () => {
      if (publishRefreshIntervalRef.current) {
        clearInterval(publishRefreshIntervalRef.current);
        publishRefreshIntervalRef.current = null;
      }
    };
  }, [isNearbyFocused, isDemo, token, locationUIState]);

  // Publish location when screen is ready and location is valid
  useEffect(() => {
    // Skip in demo mode
    if (isDemo) {
      if (__DEV__) console.log('[NEARBY] publishLocation skipped: demo mode');
      return;
    }

    if (!isNearbyFocused) {
      return;
    }

    // Skip if no token
    if (!token) {
      if (__DEV__) console.log('[NEARBY] publishLocation skipped: no token');
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
    const now = Date.now();

    // Skip if same coordinates were published recently (within ~10m threshold + refresh window)
    const last = lastPublishedRef.current;
    if (last) {
      const latDiff = Math.abs(lat - last.lat);
      const lngDiff = Math.abs(lng - last.lng);
      const timeSinceLastPublish = now - last.publishedAt;
      // ~10m threshold (0.0001 degrees ≈ 11m)
      if (
        latDiff < 0.0001 &&
        lngDiff < 0.0001 &&
        timeSinceLastPublish < PUBLISH_REFRESH_INTERVAL_MS
      ) {
        if (__DEV__) console.log('[NEARBY] publishLocation skipped: same location');
        return;
      }
    }

    // Mark as publishing to prevent concurrent calls
    isPublishingRef.current = true;

    // Publish location (with mount guard)
    (async () => {
      if (!userId) return;
      try {
        const result = await publishLocationMutation({
          userId,
          latitude: lat,
          longitude: lng,
        });

        // Guard: skip state updates if unmounted
        if (!isMountedRef.current) return;

        // Only treat the current coordinates as published if the backend actually refreshed them
        if (result?.published) {
          lastPublishedRef.current = {
            lat,
            lng,
            publishedAt: result.publishedAt ?? Date.now(),
          };
          requestNearbyRefresh();
          setNearbySyncIssue((currentIssue) =>
            currentIssue?.kind === 'publish' ? null : currentIssue
          );
        }

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
        if (!isMountedRef.current || !userId) return;
        try {
          const result = await recordLocationMutation({
            userId,
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
          setNearbySyncIssue((currentIssue) =>
            currentIssue?.kind === 'record' ? null : currentIssue
          );
        } catch (recordErr) {
          if (__DEV__) {
            console.warn('[NEARBY] recordLocation failed:', recordErr);
          }
          setNearbySyncIssue({
            kind: 'record',
            message: 'Crossed Paths will catch up as soon as your location refresh finishes.',
            actionLabel: 'Retry now',
          });
        }
      } catch (err) {
        // Guard: skip logging if unmounted
        if (!isMountedRef.current) return;

        if (__DEV__) {
          console.error('[NEARBY] publishLocation failed:', err);
        }
        setNearbySyncIssue({
          kind: 'publish',
          message: 'Using your last good location while Nearby refreshes.',
          actionLabel: 'Retry now',
        });
      } finally {
        // Always reset publishing flag to allow future calls
        isPublishingRef.current = false;
      }
    })();
  }, [
    isDemo,
    isNearbyFocused,
    token,
    locationUIState,
    bestLocation,
    publishRefreshTick,
    publishLocationMutation,
    requestNearbyRefresh,
    recordLocationMutation,
    router,
  ]);

  // ---------------------------------------------------------------------------
  // Demo mode nearby users - placed around current location
  // ---------------------------------------------------------------------------
  const demoNearbyUsers: NearbyUser[] = useMemo(() => {
    if (!isDemo) return [];

    // Demo marker offsets relative to current location (lat, lng in degrees)
    // ~0.003 degrees ≈ 300m, spread in different directions.
    // Phase-2.5: demo uses the same payload shape as the backend — displayLat/Lng
    // are the on-map points and distanceBucket replaces numeric distance.
    const demoOffsets = [
      { latOff: +0.0030, lngOff: +0.0020, bucket: 'nearby' as const },      // NE
      { latOff: -0.0025, lngOff: +0.0040, bucket: 'nearby' as const },      // SE
      { latOff: -0.0035, lngOff: -0.0025, bucket: 'nearby' as const },      // SW
      { latOff: +0.0020, lngOff: -0.0035, bucket: 'nearby' as const },      // NW
      { latOff: +0.0045, lngOff: +0.0010, bucket: 'in_your_area' as const },// N
    ];

    // Use current location as base, fallback to demo location
    const baseLat = bestLocation?.latitude ?? DEMO_LOCATION.latitude;
    const baseLng = bestLocation?.longitude ?? DEMO_LOCATION.longitude;

    return DEMO_PROFILES.slice(0, 5).map((profile, index) => {
      const offset = demoOffsets[index] ?? { latOff: 0, lngOff: 0, bucket: 'in_your_area' as const };
      const dLat = baseLat + offset.latOff;
      const dLng = baseLng + offset.lngOff;
      // Phase-3: fabricate preview payload from demo profile fields so the
      // preview card has something to show without touching the network.
      const demoTagline =
        (profile as any)?.prompts?.[0]?.answer ??
        ((profile as any)?.bio ? String((profile as any).bio).slice(0, 80) : undefined);
      const demoInterests = Array.isArray((profile as any)?.activities)
        ? ((profile as any).activities as string[]).slice(0, 3)
        : undefined;
      return {
        id: profile._id,
        name: profile.name,
        age: profile.age,
        cellId: `demo:${index}`,
        displayLat: dLat,
        displayLng: dLng,
        distanceBucket: offset.bucket,
        freshness: 'solid' as const,
        // Phase-2.5: demo profiles are <24h old, so tag them recent.
        freshnessLabel: 'recent' as const,
        photoUrl: getPrimaryPhotoUrl(profile.photos),
        isVerified: profile.isVerified ?? false,
        strongPrivacyMode: false,
        hideDistance: false,
        tagline: demoTagline,
        sharedInterests: demoInterests,
      };
    });
  }, [isDemo, bestLocation]);

  // ---------------------------------------------------------------------------
  // Combine and process nearby users using backend-fuzzed coordinates
  // ---------------------------------------------------------------------------
  const nearbyUsersResult = useMemo<NearbyUsersQueryResult | null>(() => {
    if (isDemo) {
      return {
        status: 'ok',
        users: demoNearbyUsers,
      };
    }

    if (!nearbyUsersQuery) {
      return null;
    }

    if (Array.isArray(nearbyUsersQuery)) {
      return {
        status: 'ok',
        users: nearbyUsersQuery as NearbyUser[],
      };
    }

    return nearbyUsersQuery as NearbyUsersQueryResult;
  }, [demoNearbyUsers, isDemo, nearbyUsersQuery]);

  useEffect(() => {
    if (nearbyUsersResult?.status === 'ok') {
      setRetainedNearbyUsersResult(nearbyUsersResult);
    }
  }, [nearbyUsersResult]);

  const displayNearbyUsersResult = nearbyUsersResult ?? retainedNearbyUsersResult;
  const hasRetainedNearbyResult =
    nearbyUsersResult == null && retainedNearbyUsersResult?.status === 'ok';
  const nearbyQueryStatus = displayNearbyUsersResult?.status ?? null;

  const processedNearbyUsers = useMemo(() => {
    const rawUsers: NearbyUser[] = displayNearbyUsersResult?.users ?? [];
    let validCount = 0;
    let skippedCount = 0;

    const processed: ProcessedNearbyUser[] = rawUsers.filter((user) => {
      // Skip invalid coordinates. Only the per-request displayLat/displayLng
      // is validated — the server does not send any other coord.
      if (!isValidMapCoordinate(user.displayLat, user.displayLng)) {
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
    });

    // DEV-only logging. Phase-2.5: counts only, never coords or cellIds, to
    // avoid leaking even coarse location primitives into app logs.
    if (__DEV__) {
      console.log('[NEARBY] markers: %d rendered, %d skipped', validCount, skippedCount);
    }

    return processed;
  }, [displayNearbyUsersResult, userId]);

  // ---------------------------------------------------------------------------
  // Sort visible markers fairly before clustering
  // Filtering is handled by the backend so every eligible user is represented
  // ---------------------------------------------------------------------------
  const mapUsers = useMemo(() => {
    // Phase-2.5: the server already orders the payload (verified →
    // freshness → random tiebreak) AND does not expose numeric distance.
    // The client must therefore not re-sort by distance; we preserve the
    // server-provided order as-is so we don't reintroduce a precision
    // signal via ranking. The original array is cloned so downstream
    // mutations (if any) don't touch React state.
    return [...processedNearbyUsers];
  }, [processedNearbyUsers]);

  // Phase-3: soft fade-in whenever the visible marker set size changes.
  // Uses a numeric state because react-native-maps <Marker> takes a plain
  // `opacity` prop (not Animated). We only force a fade when markers first
  // appear (empty -> non-empty). For subsequent count changes on refreshed
  // data we leave opacity at 1 to avoid a visible blink on background refresh.
  const [markerFadeOpacity, setMarkerFadeOpacity] = useState(0);
  const prevMapUsersLenRef = useRef(0);
  useEffect(() => {
    const prevLen = prevMapUsersLenRef.current;
    const nextLen = mapUsers.length;
    prevMapUsersLenRef.current = nextLen;

    if (nextLen === 0) {
      // No markers to show — keep opacity at 0 so the next empty->non-empty
      // transition can fade in cleanly.
      setMarkerFadeOpacity(0);
      return;
    }

    // Only fade in on the initial empty -> non-empty transition.
    if (prevLen === 0) {
      setMarkerFadeOpacity(0);
      const raf = requestAnimationFrame(() => {
        if (isMountedRef.current) {
          setMarkerFadeOpacity(1);
        }
      });
      return () => cancelAnimationFrame(raf);
    }

    // Subsequent recomputations on already-visible markers: stay fully
    // opaque. This prevents a flash on focus/background refresh when the
    // same or refreshed user set is returned.
    setMarkerFadeOpacity(1);
  }, [mapUsers.length]);

  // Phase-3: fire a single nearby_map_open analytics event the first time a
  // non-loading payload is available after the tab gains focus. Guarded by
  // a ref so repeated re-renders don't spam the event bus.
  const nearbyMapOpenFiredRef = useRef(false);
  useEffect(() => {
    if (!isNearbyFocused) {
      nearbyMapOpenFiredRef.current = false;
      return;
    }
    if (nearbyMapOpenFiredRef.current) return;
    if (!displayNearbyUsersResult) return;
    nearbyMapOpenFiredRef.current = true;
    trackEvent({
      name: 'nearby_map_open',
      userCount: mapUsers.length,
      isDemo,
    });
  }, [isNearbyFocused, displayNearbyUsersResult, mapUsers.length, isDemo]);

  const clusterPoints = useMemo<Supercluster.PointFeature<UserPointProperties>[]>(() => {
    return mapUsers
      .filter((user) => isValidMapCoordinate(user.displayLat, user.displayLng))
      .map((user) => ({
        type: 'Feature' as const,
        properties: {
          id: user.id,
          user,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [user.displayLng, user.displayLat],
        },
      }));
  }, [mapUsers]);

  const recomputeClusters = useCallback((region: Region | null) => {
    if (!region || !superclusterRef.current) {
      setClusters([]);
      return;
    }

    try {
      const zoom = getZoomFromRegion(region);
      const bbox = getBoundingBox(region);
      const newClusters = superclusterRef.current.getClusters(bbox, zoom);
      setClusters(newClusters);
    } catch (e) {
      log.warn('[NEARBY]', 'Error computing clusters', { error: String(e) });
      setClusters([]);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Supercluster: Initialize and compute clusters
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Create supercluster instance with same settings as previous library
    const cluster = new Supercluster<UserPointProperties>({
      radius: CLUSTER_RADIUS,
      maxZoom: CLUSTER_MAX_ZOOM,
    });
    cluster.load(clusterPoints);
    superclusterRef.current = cluster;
  }, [clusterPoints]);

  useEffect(() => {
    recomputeClusters(currentRegion);
  }, [clusterPoints, currentRegion, recomputeClusters]);

  // Handler for map region changes - recompute clusters
  const handleRegionChangeComplete = useCallback((region: Region) => {
    setCurrentRegion(region);
  }, []);

  // Handler for cluster press - zoom into cluster
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClusterPress = useCallback((cluster: Supercluster.ClusterFeature<any>) => {
    if (!mapRef.current || !superclusterRef.current) return;

    try {
      Haptics.selectionAsync().catch(() => {});
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
  // Empty state: stay visible whenever Nearby is truthfully empty
  // ---------------------------------------------------------------------------
  const isEmptyStateCondition =
    locationUIState === 'ready' &&
    nearbyQueryStatus === 'ok' &&
    mapUsers.length === 0 &&
    !isDemo &&
    (!shouldShowLoadingState || hasRetainedNearbyResult);

  // Show empty-state card whenever the empty condition is truthy, then
  // auto-hide it after 5 seconds. If the empty condition toggles (e.g. user
  // refreshes, moves the map, or users appear and disappear again) the
  // effect re-runs, clears the prior timer, and re-shows the card.
  useEffect(() => {
    if (!isEmptyStateCondition) return;

    setShowEmptyState(true);

    const timer = setTimeout(() => {
      setShowEmptyState(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, [isEmptyStateCondition]);

  // P3-004: Subtle pulse loop while empty card is visible. Native driver,
  // single Animated.loop, auto-stops on unmount / when card hides.
  useEffect(() => {
    if (!showEmptyState) {
      emptyPulseScale.setValue(1);
      emptyPulseOpacity.setValue(0.28);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(emptyPulseScale, {
            toValue: 1.6,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(emptyPulseScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(emptyPulseOpacity, {
            toValue: 0,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(emptyPulseOpacity, {
            toValue: 0.28,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [showEmptyState, emptyPulseScale, emptyPulseOpacity]);

  // P3-005: Empty card entry — fade + slight upward motion (native-driven, ~280 ms)
  useEffect(() => {
    if (!showEmptyState) {
      emptyCardOpacity.setValue(0);
      emptyCardTranslateY.setValue(10);
      return;
    }
    Animated.parallel([
      Animated.timing(emptyCardOpacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(emptyCardTranslateY, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, [showEmptyState, emptyCardOpacity, emptyCardTranslateY]);

  // ---------------------------------------------------------------------------
  // Navigation handlers for header buttons
  // ---------------------------------------------------------------------------
  const handleOpenCrossedPaths = useCallback(() => {
    // Mark crossed paths as seen
    AsyncStorage.setItem(CROSSED_PATHS_LAST_SEEN_KEY, Date.now().toString()).catch(() => {});
    setHasNewCrossedPaths(false);
    safePush(router, '/(main)/crossed-paths' as any, 'nearby->crossed-paths');
  }, [router]);

  const handleOpenVerification = useCallback(() => {
    safePush(router, '/(main)/verification' as any, 'nearby->verification');
  }, [router]);

  // Phase-3: actionable empty state. When Nearby is empty the user can open
  // their discovery preferences to widen filters — existing screen, we only
  // add the navigation entry.
  const handleOpenPreferences = useCallback(() => {
    safePush(router, '/(main)/discovery-preferences' as any, 'nearby->preferences');
  }, [router]);

  // ---------------------------------------------------------------------------
  // Marker press handler — Phase-3: open the lightweight preview card first.
  // The full profile is only opened after the user taps "View profile" on
  // the preview. Everything shown in the preview is already in the payload
  // (no extra query).
  // ---------------------------------------------------------------------------
  const handleMarkerPress = useCallback((user: ProcessedNearbyUser) => {
    if (!user?.id) {
      if (__DEV__) console.warn('[NEARBY] Marker press with no user');
      return;
    }

    // P2-002: Add haptic feedback on marker tap for premium feel
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Haptics not available on device
    }

    trackEvent({
      name: 'nearby_pin_tap',
      targetUserId: user.id,
      freshnessLabel: user.freshnessLabel,
      distanceBucket: user.distanceBucket,
    });

    const preview: NearbyPreviewData = {
      id: user.id,
      name: user.name,
      age: user.age,
      photoUrl: user.photoUrl,
      freshnessLabel: user.freshnessLabel,
      tagline: user.tagline,
      sharedInterests: user.sharedInterests,
      isVerified: user.isVerified,
    };
    setPreviewUser(preview);
    trackEvent({
      name: 'nearby_preview_open',
      targetUserId: user.id,
      freshnessLabel: user.freshnessLabel,
    });
    log.info('[NEARBY]', 'marker tapped, opening preview', { id: user.id });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewUser(null);
  }, []);

  const handlePreviewViewProfile = useCallback((user: NearbyPreviewData) => {
    // Phase-2.5: pass coarse freshness label to the profile screen so it can
    // show the small recency chip. No exact timestamp is passed — only the
    // three-state label.
    const freshnessParam = user.freshnessLabel
      ? `?source=nearby&freshness=${user.freshnessLabel}`
      : '?source=nearby';
    trackEvent({
      name: 'nearby_profile_open',
      targetUserId: user.id,
      via: 'preview',
    });
    setPreviewUser(null);
    log.info('[NEARBY]', 'preview → profile', { id: user.id });
    safePush(router, `/(main)/profile/${user.id}${freshnessParam}` as any, 'nearby->profile');
  }, [router]);

  const handlePreviewLike = useCallback((user: NearbyPreviewData) => {
    // Micro-conversion hook: from the preview surface, "Like" takes the user
    // into the full profile (which carries the swipe affordances). Liking
    // without viewing the profile is intentionally not a standalone action
    // here so we don't bypass the user's ability to read the bio / photos.
    const freshnessParam = user.freshnessLabel
      ? `?source=nearby&freshness=${user.freshnessLabel}&intent=like`
      : '?source=nearby&intent=like';
    trackEvent({ name: 'nearby_to_like', targetUserId: user.id });
    trackEvent({
      name: 'nearby_profile_open',
      targetUserId: user.id,
      via: 'preview',
    });
    setPreviewUser(null);
    log.info('[NEARBY]', 'preview → like (profile)', { id: user.id });
    safePush(router, `/(main)/profile/${user.id}${freshnessParam}` as any, 'nearby->profile-like');
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

    // P2-003: Add haptic feedback on recenter for premium feel
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Haptics not available on device
    }

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

  // P3-002: Recenter button press animation handlers
  const handleRecenterPressIn = useCallback(() => {
    Animated.spring(recenterScale, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  }, [recenterScale]);

  const handleRecenterPressOut = useCallback(() => {
    Animated.spring(recenterScale, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [recenterScale]);

  // ---------------------------------------------------------------------------
  // Permission flow on focus - start/stop GPS tracking
  // ---------------------------------------------------------------------------
  useFocusEffect(
    useCallback(() => {
      setIsNearbyFocused(true);
      requestNearbyRefresh({ force: true });
      log.info('[NEARBY]', 'screen focused, starting location tracking');
      if (__DEV__) {
        console.log('[NEARBY_ENTRY][focus]', {
          event: 'enter',
          hasRetained:
            retainedNearbyUsersResult != null &&
            retainedNearbyUsersResult.status === 'ok',
          retainedUserCount:
            retainedNearbyUsersResult?.status === 'ok'
              ? retainedNearbyUsersResult.users.length
              : 0,
        });
      }
      startLocationTracking();

      // Cleanup: stop tracking when leaving Nearby tab (battery optimization)
      return () => {
        setIsNearbyFocused(false);
        log.info('[NEARBY]', 'screen unfocused, stopping location tracking');
        if (__DEV__) {
          console.log('[NEARBY_ENTRY][focus]', { event: 'leave' });
        }
        stopLocationTracking();
      };
    }, [requestNearbyRefresh, startLocationTracking, stopLocationTracking])
  );

  // ---------------------------------------------------------------------------
  // Derive UI state from location store
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (
      isDemo ||
      permissionStatus !== 'granted' ||
      hasValidBestLocation ||
      error ||
      locationTimeoutMessage
    ) {
      if ((isDemo || permissionStatus !== 'granted' || hasValidBestLocation || error) && locationTimeoutMessage) {
        setLocationTimeoutMessage(null);
      }
      if (locationAcquireTimeoutRef.current) {
        clearTimeout(locationAcquireTimeoutRef.current);
        locationAcquireTimeoutRef.current = null;
      }
      return;
    }

    if (locationAcquireTimeoutRef.current) {
      return;
    }

    locationAcquireTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      const latestBestLocation = useLocationStore.getState().getBestLocation();
      if (
        latestBestLocation &&
        isValidMapCoordinate(latestBestLocation.latitude, latestBestLocation.longitude)
      ) {
        locationAcquireTimeoutRef.current = null;
        return;
      }

      setLocationTimeoutMessage('Unable to get your location. Please try again.');
      locationAcquireTimeoutRef.current = null;
    }, LOCATION_ACQUIRE_TIMEOUT_MS);

    return () => {
      if (locationAcquireTimeoutRef.current) {
        clearTimeout(locationAcquireTimeoutRef.current);
        locationAcquireTimeoutRef.current = null;
      }
    };
  }, [isDemo, permissionStatus, hasValidBestLocation, error, locationTimeoutMessage]);

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
      if (hasValidBestLocation) {
        setLocationUIState('ready');
        return;
      }

      if (blockingLocationErrorMessage) {
        setLocationUIState('error');
        return;
      }

      // Still waiting for GPS fix
      setLocationUIState('checking');
    }
  }, [blockingLocationErrorMessage, hasValidBestLocation, isDemo, permissionStatus]);

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

  // P0 MAP-RECOVERY: Do NOT reset isMapReady once the MapView has reported
  // ready. Map is always mounted now (with FALLBACK_REGION if needed), so
  // onMapReady fires exactly once per screen mount. Resetting mid-lifecycle
  // would freeze the boot overlay because onMapReady wouldn't fire again.

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
    requestNearbyRefresh({ force: true });

    // Re-trigger location tracking and force query identity change so retry is real
    startLocationTracking();
  }, [requestNearbyRefresh, startLocationTracking]);

  const handleRetryLocation = useCallback(() => {
    setLocationTimeoutMessage(null);
    stopLocationTracking();
    startLocationTracking();
  }, [startLocationTracking, stopLocationTracking]);

  const handleRetryNearbySync = useCallback(() => {
    setNearbySyncIssue(null);
    lastPublishedRef.current = null;
    lastDetectionTimeRef.current = 0;
    lastDetectionLatLngRef.current = null;
    setPublishRefreshTick((current) => current + 1);
    requestNearbyRefresh({ force: true });
  }, [requestNearbyRefresh]);

  const mapNotice = useMemo<NearbyMapNotice | null>(() => {
    if (nearbySyncIssue) {
      return {
        ...nearbySyncIssue,
        onPress: handleRetryNearbySync,
      };
    }

    if (queryError && hasRetainedNearbyResult) {
      return {
        message: 'Showing your last Nearby view while we reconnect.',
        actionLabel: 'Retry',
        onPress: handleRetryQuery,
      };
    }

    if (passiveLocationErrorMessage) {
      return {
        message: 'Using your last good location while we refresh your position.',
        actionLabel: 'Retry',
        onPress: handleRetryLocation,
      };
    }

    if (nearbyQueryStatus === 'location_required' && hasValidBestLocation) {
      return {
        message: 'Finishing your Nearby refresh...',
        actionLabel: 'Retry',
        onPress: handleRetryNearbySync,
      };
    }

    return null;
  }, [
    hasValidBestLocation,
    handleRetryLocation,
    handleRetryNearbySync,
    handleRetryQuery,
    nearbyQueryStatus,
    nearbySyncIssue,
    passiveLocationErrorMessage,
    queryError,
    hasRetainedNearbyResult,
  ]);

  const shouldShowBlockingQueryError = Boolean(queryError && !hasRetainedNearbyResult);

  // ---------------------------------------------------------------------------
  // SHELL UI PATTERN: Header renders immediately, content area handles states
  // This provides instant visual feedback when switching to Nearby tab
  // ---------------------------------------------------------------------------
  // P1-001 FIX: Removed render-path DEV log that executed on every render
  // State changes are logged via useEffect hooks, not in render path

  // Helper: Render the appropriate content based on current state
  // Header is rendered separately (shell pattern), only content varies
  const renderContent = () => {
    // P0 MAP-RECOVERY: The 'checking' state no longer short-circuits rendering.
    // Map mounts immediately with FALLBACK_REGION; the boot overlay + "Looking
    // around you…" indicator provide feedback while GPS resolves. This prevents
    // the blank-screen regression when location acquisition is slow.

    // Denied - needs settings
    if (locationUIState === 'denied_needs_settings') {
      return (
        <View style={styles.centered}>
          <Ionicons name="navigate-circle-outline" size={moderateScale(64, 0.3)} color={COLORS.textLight} />
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>Turn on location for Nearby</Text>
          <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
            Nearby needs location access to place your map and show crossed paths in your area.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={openSettings}>
            <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.2}>Turn On Location</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Restricted (iOS parental controls)
    if (locationUIState === 'restricted') {
      return (
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={moderateScale(64, 0.3)} color={COLORS.textLight} />
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>Location isn't available here</Text>
          <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
            This device is preventing location access, possibly because of parental controls or device management.
          </Text>
        </View>
      );
    }

    // Location Services Disabled (system-wide)
    if (locationUIState === 'services_disabled') {
      return (
        <View style={styles.centered}>
          <Ionicons name="location-outline" size={moderateScale(64, 0.3)} color={COLORS.textLight} />
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>Enable Location Services</Text>
          <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
            Turn on Location Services to keep crossed-path detection available.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={openSettings}>
            <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.2}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Error state
    if (locationUIState === 'error') {
      return (
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={moderateScale(64, 0.3)} color={COLORS.warning} />
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>We couldn't update your location yet</Text>
          <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
            {blockingLocationErrorMessage || 'Try again in a moment or move somewhere with a clearer GPS signal.'}
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleRetryLocation}>
            <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.2}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (nearbyQueryStatus === 'viewer_unverified') {
      return (
        <View style={styles.centered}>
          <Ionicons name="shield-checkmark-outline" size={moderateScale(64, 0.3)} color={COLORS.textLight} />
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>Verify to use Nearby</Text>
          <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
            Finish verification to unlock Nearby and browse people you've crossed paths with.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleOpenVerification}>
            <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.2}>Verify Now</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Query error state
    if (shouldShowBlockingQueryError) {
      return (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={moderateScale(64, 0.3)} color={COLORS.warning} />
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>Nearby needs a moment</Text>
          <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
            {queryError}
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleRetryQuery}>
            <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.2}>Refresh Nearby</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // P0 MAP-RECOVERY: No more early return when mapRegion is null — we pass
    // FALLBACK_REGION to MapView so the map is always mounted. It re-centers
    // to the real location as soon as `bestLocation` becomes valid (handled
    // by the existing recenter/animation code paths).

    // Ready state - render map with error boundary
    // P1-001 FIX: Removed DEV log from render path (was logging on every render)

    // P0 MAP-RECOVERY: Strict Number.isFinite guard on every field of the
    // Region. Any NaN/Infinity/undefined/null in latitude, longitude, or the
    // deltas falls back to FALLBACK_REGION. react-native-maps on both iOS
    // (Apple Maps) and Android (Google Maps) can render a blank canvas if
    // the native view receives an invalid LatLng or non-finite span, so we
    // harden this at the render boundary.
    const isValidFiniteRegion = (r: Region | null | undefined): r is Region =>
      !!r &&
      Number.isFinite(r.latitude) &&
      Number.isFinite(r.longitude) &&
      Number.isFinite(r.latitudeDelta) &&
      Number.isFinite(r.longitudeDelta) &&
      r.latitude >= -90 &&
      r.latitude <= 90 &&
      r.longitude >= -180 &&
      r.longitude <= 180 &&
      r.latitudeDelta > 0 &&
      r.longitudeDelta > 0;

    const safeInitialRegion: Region = isValidFiniteRegion(mapRegion)
      ? mapRegion
      : FALLBACK_REGION;

    if (__DEV__ && !isValidFiniteRegion(mapRegion)) {
      log.info('[NEARBY]', 'Using FALLBACK_REGION for initialRegion', {
        hadMapRegion: !!mapRegion,
      });
    }

    return (
      <MapErrorBoundary>
      <View style={styles.mapContainer}>
        <View style={styles.mapStage}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={safeInitialRegion}
            onRegionChangeComplete={handleRegionChangeComplete}
            onMapReady={() => {
              if (__DEV__) {
                log.info('[NEARBY]', 'onMapReady fired', {
                  hasRegion: !!mapRegion,
                  locationUIState,
                });
              }
              if (mapRegion) {
                setCurrentRegion(mapRegion);
              }
              setIsMapReady(true);
            }}
            showsUserLocation={permissionStatus === 'granted'}
            showsMyLocationButton={false}
            showsCompass={false}
            rotateEnabled={true}
            pitchEnabled={false}
            moveOnMarkerPress={false}
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
                  opacity={markerFadeOpacity}
                  tracksViewChanges={false}
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
                  opacity={markerFadeOpacity}
                  tracksViewChanges={false}
                />
              );
            }
          })}
          </MapView>
        </View>

        {!isMapReady && (
          <View style={styles.mapBootOverlay} pointerEvents="none">
            <View style={styles.mapBootCard}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.mapBootText} maxFontSizeMultiplier={1.2}>Loading your map…</Text>
            </View>
          </View>
        )}

        {mapNotice && (
          <View style={styles.mapNoticeContainer} pointerEvents="box-none">
            <View style={styles.mapNoticeCard}>
              <Text style={styles.mapNoticeText} maxFontSizeMultiplier={1.2}>{mapNotice.message}</Text>
              {mapNotice.actionLabel && mapNotice.onPress ? (
                <TouchableOpacity onPress={mapNotice.onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.mapNoticeAction} maxFontSizeMultiplier={1.2}>{mapNotice.actionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}

        {/* Query loading indicator - shown while fetching nearby users */}
        {/* P3-003 / Phase-3: Fade-in + lightweight shimmer placeholders so
             the overlay reads as an active scan rather than a dead spinner. */}
        {showLoadingOverlay && !isDemo && (
          <Animated.View style={[styles.loadingOverlay, { opacity: loadingOpacity }]}>
            <View style={styles.loadingCard}>
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.loadingText} maxFontSizeMultiplier={1.2}>
                  {isRetrying || hasRetainedNearbyResult
                    ? 'Refreshing crossed paths…'
                    : 'Checking crossed paths…'}
                </Text>
              </View>
              <View style={styles.loadingSkeletonRow}>
                <View style={[styles.loadingSkeletonDot, styles.loadingSkeletonDot1]} />
                <View style={[styles.loadingSkeletonDot, styles.loadingSkeletonDot2]} />
                <View style={[styles.loadingSkeletonDot, styles.loadingSkeletonDot3]} />
              </View>
            </View>
          </Animated.View>
        )}

        {/* P3-004: Subtle pulse at the center of the map while empty state is up.
             Single native-driven Animated.View. pointerEvents="none" so it never
             blocks map gestures. */}
        {showEmptyState && (
          <View style={styles.emptyPulseWrap} pointerEvents="none">
            <Animated.View
              style={[
                styles.emptyPulseDot,
                {
                  opacity: emptyPulseOpacity,
                  transform: [{ scale: emptyPulseScale }],
                },
              ]}
            />
          </View>
        )}

        {/* Empty state card — persistent while empty condition holds. Gives
             the user clear context + two recovery actions (refresh, widen
             preferences) so they never land on a silent empty map. */}
        {/* P2-FIX-3: pointerEvents="box-none" lets taps on the surrounding
             overlay strip pass through to the map; only the card itself is tappable. */}
        {showEmptyState && (
          <View
            style={[
              styles.emptyOverlay,
              { bottom: Math.max(insets.bottom, SPACING.md) + SPACING.sm },
            ]}
            pointerEvents="box-none"
          >
            <Animated.View
              style={[
                styles.emptyCardWrap,
                {
                  opacity: emptyCardOpacity,
                  transform: [{ translateY: emptyCardTranslateY }],
                },
              ]}
            >
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconBubble}>
                  <Ionicons name="people-outline" size={SIZES.icon.lg} color={COLORS.primary} />
                </View>
                <Text style={styles.emptyTitle} maxFontSizeMultiplier={1.2}>You haven't crossed paths nearby</Text>
                <Text style={styles.emptyTrust} maxFontSizeMultiplier={1.2}>Approx area where you crossed</Text>
                <Text style={styles.emptyHint} maxFontSizeMultiplier={1.2}>Not their current location. No crossings in the last 14 days yet.</Text>
                <View style={styles.emptyActionRow}>
                  <TouchableOpacity
                    style={[styles.emptyActionButton, isRetrying && styles.emptyActionButtonDisabled]}
                    onPress={handleRetryQuery}
                    activeOpacity={0.85}
                    disabled={isRetrying}
                    accessibilityLabel="Refresh crossed paths"
                    accessibilityHint="Check again for crossed-path events nearby"
                    accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
                  >
                    {isRetrying ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Ionicons name="refresh" size={SIZES.icon.sm} color={COLORS.primary} />
                    )}
                    <Text style={styles.emptyActionText} maxFontSizeMultiplier={1.2}>
                      {isRetrying ? 'Refreshing…' : 'Refresh'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.emptyActionButton}
                    onPress={handleOpenPreferences}
                    activeOpacity={0.85}
                    accessibilityLabel="Adjust preferences"
                    accessibilityHint="Open discovery preferences to widen your search"
                  >
                    <Ionicons name="options-outline" size={SIZES.icon.sm} color={COLORS.primary} />
                    <Text style={styles.emptyActionText} maxFontSizeMultiplier={1.2}>Adjust preferences</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Animated.View>
          </View>
        )}

        {/* My location button (static, tap-once recenter) */}
        {/* P3-002: Animated scale on press for premium feel */}
        {/* Cross-device: bottom offset clears gesture/nav area on OnePlus
            while remaining stable on Samsung. */}
        {permissionStatus === 'granted' && bestLocation && (
          <Animated.View style={{ transform: [{ scale: recenterScale }] }}>
            <TouchableOpacity
              style={[
                styles.myLocationButton,
                { bottom: Math.max(insets.bottom, SPACING.md) + SPACING.sm },
              ]}
              onPress={handleRecenterToMyLocation}
              onPressIn={handleRecenterPressIn}
              onPressOut={handleRecenterPressOut}
              activeOpacity={1}
            >
              <Ionicons name="locate" size={SIZES.icon.md} color={COLORS.primary} />
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
      </MapErrorBoundary>
    );
  };

  // ---------------------------------------------------------------------------
  // SHELL UI: Single return with instant header + dynamic content
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header renders immediately (shell pattern) */}
      {/* Nearby settings entry is intentionally NOT here — users access
          Nearby settings only via Profile → Privacy → Nearby settings. */}
      <View style={styles.header}>
        <View style={{ width: SIZES.icon.lg }} />
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.2}>Nearby</Text>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            onPress={handleOpenCrossedPaths}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Crossed paths"
            accessibilityHint="View people you've crossed paths with"
          >
            <View>
              <Ionicons name="footsteps-outline" size={SIZES.icon.lg} color={COLORS.text} />
              {hasNewCrossedPaths && (
                <Badge dot animate style={styles.crossedPathsBadge} />
              )}
            </View>
          </TouchableOpacity>
        </View>
        {isDemo && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText} maxFontSizeMultiplier={1.2}>DEMO</Text>
          </View>
        )}
      </View>

      {/* Content area - state-specific UI rendered below header */}
      {renderContent()}

      {/* Phase-3: lightweight preview card shown on marker tap. Mounted at
          the SafeAreaView root so the modal backdrop covers the whole tab
          (including the header). No network call — data comes from the
          already-fetched Nearby payload. */}
      <NearbyPreviewCard
        visible={previewUser !== null}
        user={previewUser}
        onClose={handleClosePreview}
        onViewProfile={handlePreviewViewProfile}
        onLike={handlePreviewLike}
      />
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
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
    // No shadow / elevation / border — header and SafeArea share the
    // same background so the top of the screen reads as one continuous
    // premium surface. Visual hierarchy comes from typography + spacing.
  },
  headerTitle: {
    fontSize: moderateScale(22, 0.4),
    lineHeight: lineHeight(moderateScale(22, 0.4), 1.2),
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  crossedPathsBadge: {
    position: 'absolute',
    top: -SPACING.xxs,
    right: -SPACING.xs,
  },
  demoBadge: {
    position: 'absolute',
    right: SPACING.base,
    backgroundColor: COLORS.warning,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
    borderRadius: SIZES.radius.xs,
  },
  demoBadgeText: {
    fontSize: FONT_SIZE.xs,
    lineHeight: lineHeight(FONT_SIZE.xs, 1.2),
    fontWeight: FONT_WEIGHT.bold,
    color: '#fff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: moderateScale(40, 0.5),
  },
  title: {
    fontSize: moderateScale(22, 0.4),
    lineHeight: lineHeight(moderateScale(22, 0.4), 1.2),
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.text,
    marginTop: SPACING.base,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.45),
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  primaryButton: {
    marginTop: SPACING.xl,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.md,
    borderRadius: SIZES.radius.xl,
  },
  primaryButtonText: {
    fontSize: FONT_SIZE.lg,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    fontWeight: FONT_WEIGHT.semibold,
    color: '#fff',
  },
  mapContainer: {
    flex: 1,
    // P2-FIX-5: neutral Google-Maps-like base color so the canvas never
    // reads as pure white if native tile paint is momentarily delayed.
    backgroundColor: '#E5E3DF',
  },
  mapStage: {
    flex: 1,
    backgroundColor: '#E5E3DF',
  },
  map: {
    flex: 1,
  },
  mapBootOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  mapBootCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    borderRadius: moderateScale(20, 0.25),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  mapBootText: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    color: COLORS.textLight,
  },
  // NOTE: Cluster markers use image={pinPink} for Android reliability.
  // Custom View-based cluster styles removed - they were unreliable on Android.
  // Overlay styles
  loadingOverlay: {
    position: 'absolute',
    top: SPACING.base,
    left: SPACING.base,
    right: SPACING.base,
    alignItems: 'center',
  },
  loadingCard: {
    // Phase-3: stack the spinner row above the skeleton dots.
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    borderRadius: moderateScale(20, 0.25),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    gap: SPACING.xs,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  loadingText: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    color: COLORS.textLight,
  },
  loadingSkeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.xxs,
  },
  loadingSkeletonDot: {
    width: moderateScale(6, 0.5),
    height: moderateScale(6, 0.5),
    borderRadius: moderateScale(3, 0.25),
    backgroundColor: `${COLORS.primary}66`,
  },
  loadingSkeletonDot1: { opacity: 0.55 },
  loadingSkeletonDot2: { opacity: 0.8 },
  loadingSkeletonDot3: { opacity: 1 },
  mapNoticeContainer: {
    position: 'absolute',
    top: moderateScale(64, 0.5),
    left: SPACING.base,
    right: SPACING.base,
    alignItems: 'center',
  },
  mapNoticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: SIZES.radius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  mapNoticeText: {
    flex: 1,
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    color: COLORS.text,
  },
  mapNoticeAction: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.primary,
  },
  emptyOverlay: {
    position: 'absolute',
    // Bottom is overridden inline with safe-area-aware value;
    // this static fallback is used when insets aren't yet available.
    bottom: SPACING.xl,
    left: SPACING.base,
    right: SPACING.base,
    alignItems: 'center',
  },
  emptyCard: {
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    paddingHorizontal: moderateScale(28, 0.5),
    paddingVertical: SPACING.xl,
    borderRadius: moderateScale(20, 0.25),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  emptyIconBubble: {
    width: moderateScale(52, 0.4),
    height: moderateScale(52, 0.4),
    borderRadius: moderateScale(26, 0.4),
    backgroundColor: COLORS.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  emptyTitle: {
    fontSize: moderateScale(17, 0.4),
    lineHeight: lineHeight(moderateScale(17, 0.4), 1.25),
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.text,
    marginTop: SPACING.md,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  emptyCardWrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.10)',
    borderRadius: SIZES.radius.xl,
    padding: moderateScale(6, 0.5),
  },
  emptyTrust: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
    opacity: 0.75,
    fontWeight: FONT_WEIGHT.medium,
  },
  emptyHint: {
    fontSize: FONT_SIZE.caption,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
    opacity: 0.85,
  },
  emptyActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.base,
    flexWrap: 'wrap',
  },
  emptyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    borderRadius: moderateScale(22, 0.25),
    backgroundColor: `${COLORS.primary}15`,
    gap: SPACING.xs,
    minWidth: moderateScale(110, 0.5),
    justifyContent: 'center',
  },
  emptyActionButtonDisabled: {
    opacity: 0.6,
  },
  emptyPulseWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPulseDot: {
    width: moderateScale(48, 0.4),
    height: moderateScale(48, 0.4),
    borderRadius: SIZES.radius.xl,
    backgroundColor: COLORS.primary,
  },
  emptyActionText: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    fontWeight: FONT_WEIGHT.medium,
    color: COLORS.primary,
  },
  // My location button (static, tap-once recenter)
  // Bottom is overridden inline with safe-area-aware value; this static
  // fallback ensures the button never sits flush with the tab bar.
  myLocationButton: {
    position: 'absolute',
    bottom: SPACING.xl,
    right: SPACING.base,
    width: SIZES.touchTarget,
    height: SIZES.touchTarget,
    borderRadius: SIZES.touchTarget / 2,
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
