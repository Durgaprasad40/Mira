import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Region } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { useLocation } from '@/hooks/useLocation';
import { COLORS } from '@/lib/constants';
import { DEMO_PROFILES, getDemoCurrentUser } from '@/lib/demoData';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';
import { useDemoNotifStore } from '@/hooks/useNotifications';
import { api } from '@/convex/_generated/api';
import { useScreenSafety } from '@/hooks/useScreenSafety';
import { rankNearbyProfiles } from '@/lib/rankProfiles';

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
// In-app notification banner
// ---------------------------------------------------------------------------

let _showBanner: ((title: string, body: string) => void) | null = null;

function sendLocalNotification(title: string, body: string) {
  if (_showBanner) {
    _showBanner(title, body);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BOTTOM_SHEET_HEIGHT = 200;
const FIXED_RADIUS = 1000; // 1km

// Extract demo "nearby" profiles that have lat/lng.
// Fallback: used when demoStore hasn't seeded yet.
const NEARBY_DEMO_PROFILES = (DEMO_PROFILES as any[]).filter(
  (p) => typeof p.latitude === 'number' && (p._id as string).startsWith('demo_nearby'),
);

/** Apply client-side jitter (50-150m) to demo profiles. */
function jitterDemoProfiles(profiles: any[], viewerId: string): NearbyProfile[] {
  return profiles
    .map((p) => {
      const ts = p.lastLocationUpdatedAt ?? Date.now();
      const freshness = computeFreshness(ts);
      if (freshness === 'hidden') return null;

      const epoch = Math.floor(ts / (30 * 60 * 1000));
      const seed = simpleHash(`${viewerId}:${p._id}:${epoch}`);
      const angle = ((seed % 36000) / 100) * (Math.PI / 180);
      const dist = 50 + (seed % 101); // 50-150m
      const { lat, lng } = offsetCoords(p.latitude, p.longitude, dist, angle);
      return {
        ...p,
        latitude: lat,
        longitude: lng,
        freshness,
      } as NearbyProfile;
    })
    .filter(Boolean) as NearbyProfile[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NearbyScreen() {
  const router = useRouter();
  const { latitude, longitude, getCurrentLocation, requestPermission } = useLocation();
  const userId = useAuthStore((s) => s.userId);
  const mapRef = useRef<MapView>(null);
  const { safeTimeout } = useScreenSafety();

  // Demo store — read mutable profiles for nearby display
  const demoStoreProfiles = useDemoStore((s) => s.profiles);
  const demoSeed = useDemoStore((s) => s.seed);
  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);
  useEffect(() => { if (isDemoMode) demoSeed(); }, [demoSeed]);

  // User location — fallback to demo coords
  const demoUser = getDemoCurrentUser();
  const userLat = latitude ?? demoUser.latitude;
  const userLng = longitude ?? demoUser.longitude;

  // Permission state
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Bottom sheet state
  const [selectedProfile, setSelectedProfile] = useState<NearbyProfile | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // In-app banner state
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasShownSessionBanner = useRef(false);

  // Convex mutation/query (skipped in demo mode)
  const recordLocation = useMutation(api.crossedPaths.recordLocation);
  const convexNearby = useQuery(
    api.crossedPaths.getNearbyUsers,
    !isDemoMode && userId ? { userId: userId as any } : 'skip',
  );

  // Register banner callback
  useEffect(() => {
    _showBanner = (title: string, body: string) => {
      setBanner({ title, body });
      Animated.timing(bannerAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = safeTimeout(() => {
        Animated.timing(bannerAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
          setBanner(null);
        });
      }, 4000);
    };
    return () => {
      _showBanner = null;
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [bannerAnim]);

  // ------------------------------------------------------------------
  // On mount: request location + call recordLocation
  // ------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const granted = await requestPermission();
      if (!granted) {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      const loc = await getCurrentLocation();
      if (loc && userId && !isDemoMode) {
        const result = await recordLocation({
          userId: userId as any,
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
        // Show banner on first nearby detection per session
        if (result?.nearbyCount && result.nearbyCount > 0 && !hasShownSessionBanner.current) {
          hasShownSessionBanner.current = true;
          sendLocalNotification('Mira', 'Someone crossed your path nearby.');
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Build nearby profiles list (memoized to avoid recomputing each render)
  // ------------------------------------------------------------------
  const nearbyProfiles: NearbyProfile[] = useMemo(() => {
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
        const d = haversineMeters(userLat, userLng, p.latitude, p.longitude);
        return d <= FIXED_RADIUS;
      });
      return rankNearbyProfiles(jitterDemoProfiles(filtered, userId ?? 'demo_viewer'));
    }
    // Live mode: map Convex query results
    return rankNearbyProfiles(convexNearby.map((u) => ({
      _id: u.id,
      name: u.name,
      age: u.age,
      latitude: u.jitteredLat,
      longitude: u.jitteredLng,
      freshness: u.freshness as 'solid' | 'faded',
      photoUrl: u.photoUrl ?? undefined,
      isVerified: u.isVerified,
    })));
  }, [demoStoreProfiles, blockedUserIds, userLat, userLng, userId, convexNearby]);

  // ------------------------------------------------------------------
  // Fire crossed-paths notification once per session (demo mode)
  // ------------------------------------------------------------------
  const crossedPathsNotifiedRef = useRef(false);
  useEffect(() => {
    if (!isDemoMode || crossedPathsNotifiedRef.current) return;
    if (nearbyProfiles.length === 0) return;
    crossedPathsNotifiedRef.current = true;
    // Pick the first nearby profile for the notification
    const p = nearbyProfiles[0];
    useDemoNotifStore.getState().addNotification({
      type: 'crossed_paths',
      title: 'Crossed paths',
      body: `You crossed paths with ${p.name} nearby.`,
      data: { otherUserId: p._id },
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
  // ------------------------------------------------------------------
  const buildRegion = (): Region => {
    const d = radiusToLatDelta(FIXED_RADIUS);
    return {
      latitude: userLat,
      longitude: userLng,
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
  // Render
  // ------------------------------------------------------------------

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
              const granted = await requestPermission();
              if (granted) {
                setPermissionDenied(false);
                await getCurrentLocation();
              }
            }}
          >
            <Text style={styles.permissionButtonText}>Enable Location</Text>
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
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onPress={closeSheet}
      >
        {/* "You" marker */}
        <Marker
          coordinate={{ latitude: userLat, longitude: userLng }}
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

      {/* "No one nearby" overlay */}
      {nearbyProfiles.length === 0 && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyOverlayEmoji}>📍</Text>
          <Text style={styles.emptyOverlayTitle}>No one nearby yet</Text>
          <Text style={styles.emptyOverlaySubtitle}>Check back soon — people show up as they pass by.</Text>
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

      {/* In-app notification banner */}
      {banner && (
        <Animated.View
          style={[
            styles.notifBanner,
            { top: 4 },
            {
              opacity: bannerAnim,
              transform: [
                {
                  translateY: bannerAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-60, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Ionicons name="footsteps" size={18} color={COLORS.white} style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.notifTitle}>{banner.title}</Text>
            <Text style={styles.notifBody}>{banner.body}</Text>
          </View>
        </Animated.View>
      )}
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

  // Empty overlay
  emptyOverlay: {
    position: 'absolute',
    top: '35%',
    alignSelf: 'center',
    backgroundColor: COLORS.white,
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    maxWidth: 280,
  },
  emptyOverlayEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyOverlayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyOverlaySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
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

  // In-app notification banner
  notifBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 12,
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.white,
  },
  notifBody: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 1,
  },
});
