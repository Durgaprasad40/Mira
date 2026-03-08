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
 * LOCKED IMPLEMENTATIONS - DO NOT CHANGE WITHOUT APPROVAL
 * ============================================================================
 * The following behaviors are LOCKED and approved by Durga Prasad.
 * Do not modify without explicit unlock approval.
 *
 * 1. INDIVIDUAL PINK MARKERS (LOCKED)
 *    - Uses image={pinPink} prop for Android reliability
 *    - Do NOT replace with View-based markers
 *    - Tap opens profile via Discover-style flow
 *
 * 2. CLUSTERING BEHAVIOR (LOCKED)
 *    - Uses react-native-map-clustering with image-based cluster markers
 *    - Cluster tap zooms into cluster area to reveal individual markers
 *    - Do NOT change clustering radius or behavior without testing
 *
 * 3. RECENTER BUTTON (LOCKED)
 *    - Tap-once recenter only
 *    - No follow mode
 *    - No second-state behavior
 *
 * ANDROID MARKER RELIABILITY:
 * View-based markers are UNRELIABLE on Android. All markers use image prop.
 * DO NOT switch back to View-based markers without extensive Android testing.
 * ============================================================================
 *
 * FUTURE PHASES (documented for later):
 * - Live area pulse animation
 * - "Seen around you" horizontal card strip
 * - Advanced subscription/privacy rules
 * - Freshness ring indicators
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import ClusteredMapView from 'react-native-map-clustering';
import { Region, Marker } from 'react-native-maps';
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LATITUDE_DELTA = 0.02; // ~2km view
const DEFAULT_LONGITUDE_DELTA = 0.02;

// Rate limiting constants for crossed paths detection
const DETECTION_MIN_MOVEMENT_METERS = 60; // Only scan if moved 60m+
const DETECTION_MIN_INTERVAL_MS = 30000; // Only scan every 30s+

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NearbyScreen() {
  const router = useRouter();
  const isDemo = isDemoMode;

  // Session salt for stable fuzzing (generated once per component mount)
  const sessionSaltRef = useRef(Date.now());

  // Map ref for programmatic control (any type for clustering library compatibility)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  // SuperCluster ref for accessing cluster leaves
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const superClusterRef = useRef<any>(null);

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

  // Mount guard for async operations
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Query nearby users (live mode only)
  // ---------------------------------------------------------------------------
  const nearbyUsersQuery = useQuery(
    api.crossedPaths.getNearbyUsers,
    !isDemo && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Track query loading state for error detection
  const isQueryActive = !isDemo && convexUserId !== undefined;
  const isQueryLoading = isQueryActive && nearbyUsersQuery === undefined;

  // Ref to track query timeout (prevents race condition)
  const queryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout when query succeeds or on unmount
  useEffect(() => {
    if (nearbyUsersQuery !== undefined) {
      // Query succeeded - clear any pending timeout
      if (queryTimeoutRef.current) {
        clearTimeout(queryTimeoutRef.current);
        queryTimeoutRef.current = null;
      }
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
    }, 30000);

    return () => {
      if (queryTimeoutRef.current) {
        clearTimeout(queryTimeoutRef.current);
        queryTimeoutRef.current = null;
      }
    };
  }, [isQueryLoading, isQueryActive, nearbyUsersQuery]);

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

  // Publish location when screen is ready and location is valid
  useEffect(() => {
    // Skip in demo mode
    if (isDemo) {
      if (__DEV__) console.log('[NEARBY] publishLocation skipped: demo mode');
      return;
    }

    // Skip if no user ID
    if (!convexUserId) {
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
          userId: convexUserId,
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
          await recordLocationMutation({
            userId: convexUserId,
            latitude: lat,
            longitude: lng,
            accuracy: bestLocation.accuracy,
          });

          // Update rate limiting refs on success
          lastDetectionTimeRef.current = now;
          lastDetectionLatLngRef.current = { lat, lng };

          if (__DEV__) {
            console.log('[NEARBY] recordLocation success - crossed paths scan triggered');
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
  }, [isDemo, convexUserId, locationUIState, bestLocation, publishLocationMutation, recordLocationMutation]);

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
    const sessionSalt = sessionSaltRef.current;
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
          sessionSalt,
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
  // Retry query handler
  // ---------------------------------------------------------------------------
  const handleRetryQuery = useCallback(() => {
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
  if (locationUIState === 'checking') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Nearby</Text>
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
          <Text style={styles.headerTitle}>Nearby</Text>
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
          <Text style={styles.headerTitle}>Nearby</Text>
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
          <Text style={styles.headerTitle}>Nearby</Text>
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
          <Text style={styles.headerTitle}>Nearby</Text>
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
          <Text style={styles.headerTitle}>Nearby</Text>
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
          <Text style={styles.headerTitle}>Nearby</Text>
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
  // Final safety check: ensure we have valid region
  if (!mapRegion) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Nearby</Text>
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
        {/* Left spacer for centering */}
        <View style={styles.headerSpacer} />

        <Text style={styles.headerTitle}>Nearby</Text>

        {/* Right spacer for centering */}
        <View style={styles.headerSpacer} />

        {isDemo && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </View>
        )}
      </View>

      <View style={styles.mapContainer}>
        <ClusteredMapView
          ref={mapRef}
          style={styles.map}
          initialRegion={mapRegion}
          showsUserLocation={permissionStatus === 'granted'}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
          pitchEnabled={false}
          // ================================================================
          // LOCKED: CLUSTERING BEHAVIOR
          // ================================================================
          // STATUS: LOCKED - Do not change without Durga Prasad approval
          //
          // IMPLEMENTATION:
          // - Image-based cluster markers for Android reliability
          // - Cluster tap → opens cluster results page (not just zoom)
          // - radius={45} for "50% overlap" feel
          //
          // DO NOT:
          // - Change clustering radius without testing
          // - Switch to View-based cluster markers
          // - Remove animation disabling (causes blank states)
          // ================================================================
          clusteringEnabled={true}
          radius={45}
          extent={512}
          nodeSize={64}
          minZoom={1}
          maxZoom={20}
          spiralEnabled={false}
          animationEnabled={false}
          superClusterRef={superClusterRef}
          // CLUSTER MARKER RENDERER - Image-based with numbered count for Android reliability
          renderCluster={(cluster) => {
            const { id, geometry, properties, onPress } = cluster;
            const coords = geometry?.coordinates;
            const lat = coords?.[1];
            const lng = coords?.[0];
            const pointCount = properties?.point_count ?? 2;

            // Safety: validate coordinates
            if (!isValidMapCoordinate(lat, lng)) {
              return null;
            }

            // Select cluster image based on count
            const clusterImage = getClusterImage(pointCount);

            return (
              <Marker
                key={`cluster-${id}`}
                coordinate={{ latitude: lat, longitude: lng }}
                anchor={{ x: 0.5, y: 1 }}
                onPress={() => {
                  // Zoom into cluster area to reveal individual markers
                  if (mapRef.current) {
                    const region = {
                      latitude: lat,
                      longitude: lng,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    };
                    mapRef.current.animateToRegion(region, 300);
                  }
                  if (onPress) onPress();
                }}
                // CRITICAL: Use image prop with numbered cluster for Android reliability
                image={clusterImage}
              />
            );
          }}
        >
          {/* ================================================================
           * LOCKED: INDIVIDUAL PINK MARKERS
           * ================================================================
           * IMPLEMENTATION: image={pinPink} for Android reliability
           * STATUS: LOCKED - Do not change without Durga Prasad approval
           *
           * BEHAVIOR:
           * - Individual marker tap → handleMarkerPress(user)
           * - Navigate to Discover-style profile
           *
           * DO NOT:
           * - Replace with View-based markers
           * - Change the image prop approach
           * - Modify anchor position
           * ================================================================ */}
          {mapUsers.map((user) => (
            <Marker
              key={user.id}
              coordinate={{
                latitude: user.fuzzedLat,
                longitude: user.fuzzedLng,
              }}
              anchor={{ x: 0.5, y: 1 }}
              onPress={() => handleMarkerPress(user)}
              image={pinPink}
            />
          ))}
        </ClusteredMapView>

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

        {/* Empty state overlay - only shown when ready with no users and NOT loading */}
        {locationUIState === 'ready' && mapUsers.length === 0 && !isDemo && !isQueryLoading && !isRetrying && (
          <View style={styles.emptyOverlay}>
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={24} color={COLORS.textLight} />
              <Text style={styles.emptyText}>
                No one nearby right now
              </Text>
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
  headerSpacer: {
    width: 40,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
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
