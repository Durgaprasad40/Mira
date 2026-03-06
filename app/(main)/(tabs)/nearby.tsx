/**
 * Nearby Tab - Step 2: User Markers Implementation
 *
 * Scope:
 * - Permission state UI (checking/denied/settings/ready)
 * - Safe current-location map render with coordinate validation
 * - Demo mode fallback
 * - Nearby user markers with privacy fuzzing
 * - Marker press → profile navigation
 *
 * NOT in scope (future steps):
 * - Crossed paths list
 * - Ranking/feed logic
 * - Clustering
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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import MapView, { Region, Marker } from 'react-native-maps';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Explicit location UI states for stability */
type LocationUIState =
  | 'checking'
  | 'permission_required'
  | 'denied_needs_settings'
  | 'error'
  | 'ready';

/** Nearby user from query */
interface NearbyUser {
  id: string;
  name: string;
  age: number;
  publishedLat: number;
  publishedLng: number;
  freshness: 'solid' | 'faded';
  photoUrl: string | null;
  isVerified: boolean;
  hideDistance: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LATITUDE_DELTA = 0.02; // ~2km view
const DEFAULT_LONGITUDE_DELTA = 0.02;

// Privacy fuzzing constants
const FUZZ_MIN_METERS = 50;  // Minimum offset
const FUZZ_MAX_METERS = 150; // Maximum offset
const HIDE_DISTANCE_FUZZ_MIN = 200; // Larger offset for users with hideDistance
const HIDE_DISTANCE_FUZZ_MAX = 400;

// Demo fallback location (Mumbai)
const DEMO_LOCATION = {
  latitude: DEMO_USER.latitude,
  longitude: DEMO_USER.longitude,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  oderId: string,
  viewerId: string,
  sessionSalt: number,
  hideDistance: boolean,
): { lat: number; lng: number } {
  // Deterministic seed
  const seed = simpleHash(`${viewerId}:${oderId}:${sessionSalt}`);

  // Random angle (0-360 degrees)
  const angle = ((seed % 36000) / 100) * (Math.PI / 180);

  // Random radius based on hideDistance preference
  const minMeters = hideDistance ? HIDE_DISTANCE_FUZZ_MIN : FUZZ_MIN_METERS;
  const maxMeters = hideDistance ? HIDE_DISTANCE_FUZZ_MAX : FUZZ_MAX_METERS;
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

  // Auth store
  const userId = useAuthStore((s) => s.userId);
  const convexUserId = userId ? asUserId(userId) : undefined;

  // Location store
  const permissionStatus = useLocationStore((s) => s.permissionStatus);
  const startLocationTracking = useLocationStore((s) => s.startLocationTracking);
  const error = useLocationStore((s) => s.error);
  const bestLocation = useBestLocation();

  // UI state
  const [locationUIState, setLocationUIState] = useState<LocationUIState>('checking');

  // ---------------------------------------------------------------------------
  // Query nearby users (live mode only)
  // ---------------------------------------------------------------------------
  const nearbyUsersQuery = useQuery(
    api.crossedPaths.getNearbyUsers,
    !isDemo && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // ---------------------------------------------------------------------------
  // Publish location mutation (live mode only)
  // ---------------------------------------------------------------------------
  const publishLocationMutation = useMutation(api.crossedPaths.publishLocation);

  // Track last published coords to avoid spam
  const lastPublishedRef = useRef<{ lat: number; lng: number } | null>(null);

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

    // Publish location
    (async () => {
      try {
        const result = await publishLocationMutation({
          userId: convexUserId,
          latitude: lat,
          longitude: lng,
        });

        // Update last published ref
        lastPublishedRef.current = { lat, lng };

        if (__DEV__) {
          console.log('[NEARBY] publishLocation success:', result);
        }
      } catch (err) {
        if (__DEV__) {
          console.error('[NEARBY] publishLocation failed:', err);
        }
        // Silently fail - don't crash the app
      }
    })();
  }, [isDemo, convexUserId, locationUIState, bestLocation, publishLocationMutation]);

  // ---------------------------------------------------------------------------
  // Demo mode nearby users
  // ---------------------------------------------------------------------------
  const demoNearbyUsers: NearbyUser[] = useMemo(() => {
    if (!isDemo) return [];
    // Use first 5 demo profiles as nearby users
    return DEMO_PROFILES.slice(0, 5).map((profile) => ({
      id: profile._id,
      name: profile.name,
      age: profile.age,
      publishedLat: profile.latitude,
      publishedLng: profile.longitude,
      freshness: 'solid' as const,
      photoUrl: profile.photos?.[0]?.url ?? null,
      isVerified: profile.isVerified ?? false,
      hideDistance: false,
    }));
  }, [isDemo]);

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
        // Apply privacy fuzzing
        const fuzzed = applyPrivacyFuzz(
          user.publishedLat,
          user.publishedLng,
          user.id,
          viewerId,
          sessionSalt,
          user.hideDistance,
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
  // Marker press handler
  // ---------------------------------------------------------------------------
  const handleMarkerPress = useCallback((markerId: string, markerName: string) => {
    if (!markerId) {
      if (__DEV__) console.warn('[NEARBY] Marker press with no ID');
      return;
    }
    log.info('[NEARBY]', 'marker pressed', { id: markerId, name: markerName });
    safePush(router, `/(main)/profile/${markerId}` as any, 'nearby->profile');
  }, [router]);

  // ---------------------------------------------------------------------------
  // Permission flow on focus
  // ---------------------------------------------------------------------------
  useFocusEffect(
    useCallback(() => {
      log.info('[NEARBY]', 'screen focused, starting location tracking');
      startLocationTracking();
    }, [startLocationTracking])
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
    // Demo mode: use demo location
    if (isDemo) {
      return {
        latitude: DEMO_LOCATION.latitude,
        longitude: DEMO_LOCATION.longitude,
        latitudeDelta: DEFAULT_LATITUDE_DELTA,
        longitudeDelta: DEFAULT_LONGITUDE_DELTA,
      };
    }

    // Real mode: use best available location
    if (bestLocation && isValidMapCoordinate(bestLocation.latitude, bestLocation.longitude)) {
      return {
        latitude: bestLocation.latitude,
        longitude: bestLocation.longitude,
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
        <Text style={styles.headerTitle}>Nearby</Text>
        {isDemo && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </View>
        )}
      </View>

      <View style={styles.mapContainer}>
        <MapView
          style={styles.map}
          initialRegion={mapRegion}
          showsUserLocation={!isDemo}
          showsMyLocationButton={false}
          showsCompass={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {/* Nearby user markers */}
          {processedNearbyUsers.map((user) => (
            <Marker
              key={user.id}
              coordinate={{
                latitude: user.fuzzedLat,
                longitude: user.fuzzedLng,
              }}
              onPress={() => handleMarkerPress(user.id, user.name)}
              tracksViewChanges={false}
            >
              <View style={styles.markerContainer}>
                {user.photoUrl ? (
                  <Image
                    source={{ uri: user.photoUrl }}
                    style={[
                      styles.markerImage,
                      user.freshness === 'faded' && styles.markerFaded,
                    ]}
                  />
                ) : (
                  <View style={[
                    styles.markerPlaceholder,
                    user.freshness === 'faded' && styles.markerFaded,
                  ]}>
                    <Text style={styles.markerInitial}>
                      {user.name?.charAt(0)?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
                {user.isVerified && (
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
                  </View>
                )}
              </View>
            </Marker>
          ))}
        </MapView>

        {/* Status overlay */}
        {processedNearbyUsers.length === 0 && (
          <View style={styles.emptyOverlay}>
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={24} color={COLORS.textLight} />
              <Text style={styles.emptyText}>
                No one nearby right now
              </Text>
            </View>
          </View>
        )}

        {processedNearbyUsers.length > 0 && (
          <View style={styles.countOverlay}>
            <View style={styles.countBadge}>
              <Ionicons name="people" size={16} color={COLORS.primary} />
              <Text style={styles.countText}>
                {processedNearbyUsers.length} nearby
              </Text>
            </View>
          </View>
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
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
  // Marker styles
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  markerPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  markerInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  markerFaded: {
    opacity: 0.6,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#fff',
    borderRadius: 7,
  },
  // Overlay styles
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
  countOverlay: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    gap: 6,
  },
  countText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
});
