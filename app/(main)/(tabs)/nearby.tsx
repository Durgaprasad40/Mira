import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLocation } from '@/hooks/useLocation';
import { COLORS } from '@/lib/constants';
import { DEMO_USER, DEMO_PROFILES } from '@/lib/demoData';

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
  photos: { url: string }[];
}

type RadiusOption = 500 | 1000;

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
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Convert a radius in meters to a rough latitudeDelta for the MapView region. */
function radiusToLatDelta(meters: number): number {
  // 1 degree latitude ~ 111 320 m. We want the visible area to be ~2.5x the
  // radius so pins near the edge are still visible.
  return (meters * 2.5) / 111320;
}

/** Format a distance in meters to a human-friendly approximate string. */
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `~${Math.round(meters / 10) * 10}m`;
  }
  return `~${(meters / 1000).toFixed(1)}km`;
}

// ---------------------------------------------------------------------------
// In-app notification banner — no expo-notifications dependency, works
// everywhere including Expo Go without any console errors or warnings.
// ---------------------------------------------------------------------------

// A mutable ref that the component sets so the module-level helper can show
// the in-app banner without needing a React context.
let _showBanner: ((title: string, body: string) => void) | null = null;

/** Show a crossed-path notification using the in-app banner. */
function sendLocalNotification(title: string, body: string) {
  if (_showBanner) {
    _showBanner(title, body);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BOTTOM_SHEET_HEIGHT = 220;

// Extract the 8 demo "nearby" profiles that have lat/lng.
const NEARBY_DEMO_PROFILES: NearbyProfile[] = (DEMO_PROFILES as any[]).filter(
  (p) => typeof p.latitude === 'number' && (p._id as string).startsWith('demo_nearby'),
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NearbyScreen() {
  const router = useRouter();
  const { latitude, longitude, getCurrentLocation, requestPermission } = useLocation();
  const mapRef = useRef<MapView>(null);

  // User location — fallback to demo coords
  const userLat = latitude ?? DEMO_USER.latitude;
  const userLng = longitude ?? DEMO_USER.longitude;

  // Radius toggle state
  const [radius, setRadius] = useState<RadiusOption>(1000);

  // Bottom sheet state
  const [selectedProfile, setSelectedProfile] = useState<NearbyProfile | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current; // 0 = hidden, 1 = visible

  // Notification cooldown tracking
  const notifiedRef = useRef<Record<string, number>>({});
  const notifCountRef = useRef(0);
  const hasFiredDemoNotif = useRef(false);

  // In-app banner state
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current; // 0 = hidden, 1 = visible
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register the module-level callback so sendLocalNotification can trigger the banner.
  useEffect(() => {
    _showBanner = (title: string, body: string) => {
      setBanner({ title, body });
      Animated.timing(bannerAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => {
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
  // On mount: request location + schedule demo notification
  // ------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const granted = await requestPermission();
      if (granted) {
        await getCurrentLocation();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Demo notification ~3s after first load
  useEffect(() => {
    if (hasFiredDemoNotif.current) return;
    hasFiredDemoNotif.current = true;

    const timeout = setTimeout(() => {
      sendLocalNotification('Mira', 'Someone crossed your path nearby.');
    }, 3000);

    return () => clearTimeout(timeout);
  }, []);

  // ------------------------------------------------------------------
  // Filter nearby profiles by radius
  // ------------------------------------------------------------------
  const nearbyProfiles = NEARBY_DEMO_PROFILES.map((p) => ({
    ...p,
    distanceMeters: haversineMeters(userLat, userLng, p.latitude, p.longitude),
  })).filter((p) => p.distanceMeters <= radius);

  // ------------------------------------------------------------------
  // Crossed-path notification check (runs when radius/location changes)
  // ------------------------------------------------------------------
  useEffect(() => {
    const now = Date.now();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const DAILY_CAP = 10;

    nearbyProfiles.forEach((p) => {
      const lastNotified = notifiedRef.current[p._id] ?? 0;
      if (now - lastNotified > SIX_HOURS && notifCountRef.current < DAILY_CAP) {
        notifiedRef.current[p._id] = now;
        notifCountRef.current += 1;
        // Fire-and-forget — safe helper swallows errors in Expo Go
        sendLocalNotification('Mira', 'Someone crossed your path nearby.');
      }
    });
    // We only want this to re-run when the filtered list changes meaningfully.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, userLat, userLng]);

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
  // Map region — only used as initialRegion; radius changes animate.
  // Using a controlled `region` prop would fight user pan/zoom gestures.
  // ------------------------------------------------------------------
  const buildRegion = (r: number): Region => {
    const d = radiusToLatDelta(r);
    return {
      latitude: userLat,
      longitude: userLng,
      latitudeDelta: d,
      longitudeDelta: d * (SCREEN_WIDTH / Dimensions.get('window').height),
    };
  };
  const initialRegion = buildRegion(1000);

  // Animate map when radius toggle changes
  useEffect(() => {
    mapRef.current?.animateToRegion(buildRegion(radius), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

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
  return (
    <View style={styles.container}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
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

        {/* Nearby profile markers */}
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
              <View style={styles.pinDot}>
                <Text style={styles.pinInitial}>{p.name.charAt(0)}</Text>
              </View>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Radius toggle */}
      <View style={styles.radiusToggleContainer}>
        <View style={styles.radiusToggle}>
          {([500, 1000] as RadiusOption[]).map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.radiusOption, radius === r && styles.radiusOptionActive]}
              onPress={() => setRadius(r)}
            >
              <Text
                style={[
                  styles.radiusText,
                  radius === r && styles.radiusTextActive,
                ]}
              >
                {r === 500 ? '500m' : '1km'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* "No one nearby" overlay */}
      {nearbyProfiles.length === 0 && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>No one nearby</Text>
        </View>
      )}

      {/* Crossed paths shortcut */}
      <TouchableOpacity
        style={styles.crossedPathsButton}
        onPress={() => router.push('/(main)/crossed-paths')}
      >
        <Ionicons name="footsteps" size={22} color={COLORS.white} />
      </TouchableOpacity>

      {/* Bottom sheet */}
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
                source={{ uri: selectedProfile.photos[0]?.url }}
                style={styles.sheetPhoto}
              />
              <View style={styles.sheetInfo}>
                <Text style={styles.sheetName}>
                  {selectedProfile.name}, {selectedProfile.age}
                </Text>
                <Text style={styles.sheetDistance}>
                  {formatDistance(
                    haversineMeters(
                      userLat,
                      userLng,
                      selectedProfile.latitude,
                      selectedProfile.longitude,
                    ),
                  )}
                </Text>
                {(selectedProfile as any).lastSeenArea && (
                  <Text style={styles.sheetArea}>
                    {(selectedProfile as any).lastSeenArea}
                  </Text>
                )}
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
    </View>
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

  // Profile pin markers
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

  // Radius toggle
  radiusToggleContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 24,
    alignSelf: 'center',
  },
  radiusToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  radiusOption: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  radiusOptionActive: {
    backgroundColor: COLORS.primary,
  },
  radiusText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  radiusTextActive: {
    color: COLORS.white,
  },

  // Empty overlay
  emptyOverlay: {
    position: 'absolute',
    top: '50%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  emptyText: {
    color: COLORS.white,
    fontSize: 15,
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
  sheetDistance: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  sheetArea: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  viewProfileButton: {
    marginTop: 12,
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
    top: Platform.OS === 'ios' ? 54 : 18,
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
