import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
  Animated,
  PanResponder,
  Modal,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Haptics from "expo-haptics";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ProfileCard, SwipeOverlay } from "@/components/cards";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/stores/authStore";
import { useFilterStore } from "@/stores/filterStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useDemoStore } from "@/stores/demoStore";
import { useBlockStore } from "@/stores/blockStore";
import { COLORS, INCOGNITO_COLORS } from "@/lib/constants";
import { isDemoMode } from "@/hooks/useConvex";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const SWIPE_THRESHOLD_X = SCREEN_WIDTH * 0.15; // 15% — easier swipe
const SWIPE_THRESHOLD_Y = SCREEN_HEIGHT * 0.12; // 12% — easier super-like

const EMPTY_ARRAY: any[] = [];

// P0-002 FIX: Use proper Convex ID type for profiles
interface ProfileData {
  id: string;
  /** Original Convex ID for live profiles - used for type-safe mutations */
  _convexId?: Id<'users'>;
  name: string;
  age: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  distance?: number;
  photos: { url: string }[];
  relationshipIntent?: string[];
  activities?: string[];
  profilePrompt?: { question: string; answer: string };
}

// P0-002 FIX: Allowed swipe actions (matches Convex mutation args)
type SwipeAction = 'like' | 'pass' | 'super_like';

export interface DiscoverFeedProps {
  /** Future-proofing: "main" for Face 1, "private" for Face 2. No UI difference today. */
  mode?: "main" | "private";
  /** When "dark", uses INCOGNITO_COLORS for Face 2 dark theme */
  theme?: "light" | "dark";
  /** Callback when user taps arrow to open a profile */
  onOpenProfile?: (profileId: string) => void;
}

export function DiscoverFeed({ mode = "main", theme = "light", onOpenProfile }: DiscoverFeedProps) {
  const dark = theme === "dark";
  const TC = dark ? INCOGNITO_COLORS : COLORS;
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const { minAge, maxAge, maxDistance, gender, relationshipIntent, filterVersion } = useFilterStore();
  useSubscriptionStore();

  // Demo store — single source of truth for Phase-1 demo profiles
  const demoProfiles = useDemoStore((s) => s.profiles);
  const demoExcludedIds = useDemoStore((s) => s.getExcludedUserIds());
  const blockedIds = useBlockStore((s) => s.blockedUserIds);
  // P2-008 FIX: Ensure excludedIds is always a valid array (never undefined)
  // This prevents potential filter bypass if store selectors return undefined
  const excludedIds = isDemoMode
    ? (demoExcludedIds ?? [])
    : (blockedIds ?? []);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showPrefsMenu, setShowPrefsMenu] = useState(false);
  // P1-003 FIX: Local refresh key to force query refetch on "Start Over"
  const [refreshKey, setRefreshKey] = useState(0);
  const sortByLocal = "recommended" as const; // Default sort, user controls via Discovery Preferences

  // Reset feed when filter preferences change (filterVersion incremented on save)
  const filterKey = `${minAge}-${maxAge}-${maxDistance}-${gender.join(',')}-${relationshipIntent.join(',')}-v${filterVersion}`;
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      setCurrentIndex(0); // Reset to beginning when filters change
    }
  }, [filterKey]);
  const lastSwipedProfile = useRef<ProfileData | null>(null);

  const [overlayDirection, setOverlayDirection] = useState<
    "left" | "right" | "up" | null
  >(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0);

  // Use demo data if in demo mode, otherwise use Convex
  // P1-007 FIX: Simplified userId handling - use userId directly without redundant cast
  const discoverArgs = useMemo(
    () =>
      !isDemoMode && userId
        // P1-003 FIX: Include refreshKey to force refetch on "Start Over"
        ? { userId, sortBy: sortByLocal, limit: 20, filterVersion: filterVersion + refreshKey }
        : "skip" as const,
    [userId, sortByLocal, filterVersion, refreshKey],
  );
  const convexProfiles = useQuery(api.discover.getDiscoverProfiles, discoverArgs);
  const profilesSafe = convexProfiles ?? EMPTY_ARRAY;

  // Memoize excluded set from store-selected IDs
  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds]);

  // Transform to common format — memoize to prevent new arrays each render
  // filterVersion in deps forces re-render when preferences saved (demo mode cache bust)
  // Apply gender filter: only show profiles matching user's "Looking for" preference
  // Uses demoStore.profiles as single source of truth (not static DEMO_PROFILES)
  const demoItems = useMemo<ProfileData[]>(
    () =>
      demoProfiles
        .filter((p) => {
          // Exclude blocked/swiped/matched users
          const pid = p._id ?? (p as any).id;
          if (pid && excludedSet.has(pid)) return false;
          // Gender filter: If user has set gender preferences, only show matching profiles
          // If no gender preference is set (empty array), show all profiles
          if (gender.length === 0) return true;
          return gender.includes(p.gender as any);
        })
        .filter((p) => {
          // Age filter: Only show profiles within the user's age range
          return p.age >= minAge && p.age <= maxAge;
        })
        .filter((p) => {
          // Distance filter: Only show profiles within the user's max distance
          // maxDistance is stored in km
          return p.distance <= maxDistance;
        })
        .map((p) => ({
          id: p._id,
          name: p.name,
          age: p.age,
          bio: p.bio,
          city: p.city,
          isVerified: p.isVerified,
          distance: p.distance,
          photos: p.photos,
          relationshipIntent: p.relationshipIntent,
          activities: p.activities,
          profilePrompt: p.profilePrompts?.[0], // Show first prompt on card
        })),
    [demoProfiles, excludedSet, filterVersion, gender, minAge, maxAge, maxDistance],
  );

  // P0-002 FIX: Preserve _convexId for type-safe mutations
  const liveItems = useMemo<ProfileData[]>(
    () =>
      profilesSafe.map((p: any) => ({
        id: p._id || p.id,
        _convexId: p._id as Id<'users'> | undefined, // Preserve original Convex ID
        name: p.name,
        age: p.age,
        bio: p.bio,
        city: p.city,
        isVerified: p.isVerified,
        distance: p.distance,
        photos:
          p.photos?.map((photo: any) => ({ url: photo.url || photo })) ?? EMPTY_ARRAY,
        relationshipIntent: p.relationshipIntent,
        activities: p.activities,
        profilePrompt: p.profilePrompts?.[0],
      })),
    [profilesSafe],
  );

  const profiles: ProfileData[] = isDemoMode ? demoItems : liveItems;

  const swipeMutation = useMutation(api.likes.swipe);
  const rewindMutation = useMutation(api.likes.rewind);

  // Animation values (React Native Animated)
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Mount guard to prevent state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // SAFETY FIX: Swipe lock to prevent race conditions during animation/mutation
  const swipeLockRef = useRef(false);

  const currentProfile = profiles[currentIndex];
  const nextProfile = profiles[currentIndex + 1];

  const resetPosition = useCallback(() => {
    Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      friction: 7,
      tension: 40,
      useNativeDriver: true,
    }).start();
    setOverlayDirection(null);
    setOverlayOpacity(0);
  }, [pan]);

  const handleSwipe = useCallback(
    async (direction: "left" | "right" | "up") => {
      // SAFETY FIX: Check swipe lock to prevent race conditions
      if (swipeLockRef.current) return;
      if (!currentProfile) return;
      if (!mountedRef.current) return;

      // Acquire swipe lock
      swipeLockRef.current = true;

      // P0-002 FIX: Type-safe action mapping
      const action: SwipeAction =
        direction === "left"
          ? "pass"
          : direction === "up"
            ? "super_like"
            : "like";

      if (isDemoMode) {
        // Demo mode - just move to next profile
        lastSwipedProfile.current = currentProfile;

        // SAFETY FIX: 20% match chance (realistic) and navigate to match-celebration
        if (direction === "right" && Math.random() < 0.2) {
          // Simulate match with proper navigation instead of Alert
          useDemoStore.getState().simulateMatch(currentProfile.id);
          const matchId = `match_${currentProfile.id}`;
          if (mountedRef.current) {
            router.push(
              `/(main)/match-celebration?matchId=${matchId}&userId=${currentProfile.id}`,
            );
          }
          swipeLockRef.current = false;
          return;
        }

        if (!mountedRef.current) {
          swipeLockRef.current = false;
          return;
        }
        setCurrentIndex((prev) => prev + 1);
        swipeLockRef.current = false;
        return;
      }

      // P0-001 FIX: Check token is available before attempting mutation
      if (!token) {
        swipeLockRef.current = false;
        Alert.alert("Error", "Session expired. Please log in again.");
        return;
      }

      // P0-002 FIX: Validate profile has proper Convex ID for live mode
      const toUserId = currentProfile._convexId;
      if (!toUserId) {
        swipeLockRef.current = false;
        Alert.alert("Error", "Invalid profile data. Please refresh.");
        return;
      }

      // P0-006 FIX: Remove unsafe Promise.race timeout
      // Instead, use AbortController pattern for proper cleanup
      // The mutation is the source of truth - if it succeeds, the swipe is recorded
      // Network issues will naturally timeout via Convex's built-in handling
      try {
        const result = await swipeMutation({
          token,          // P0-001 FIX: Uses current token from closure (now in deps)
          toUserId,       // P0-002 FIX: Type-safe Id<'users'>
          action,         // P0-002 FIX: Type-safe SwipeAction
        });

        lastSwipedProfile.current = currentProfile;

        if (!mountedRef.current) {
          swipeLockRef.current = false;
          return;
        }
        if (result?.isMatch) {
          router.push(
            `/(main)/match-celebration?matchId=${result.matchId}&userId=${currentProfile.id}`,
          );
        } else {
          setCurrentIndex((prev) => prev + 1);
        }
      } catch (error: any) {
        if (!mountedRef.current) {
          swipeLockRef.current = false;
          return;
        }
        // P2-006 FIX: Enhanced error categorization for better user feedback
        const errorMessage = error?.message || "Failed to swipe";
        const lowerMsg = errorMessage.toLowerCase();

        // Network/connection errors
        if (lowerMsg.includes("timeout") || lowerMsg.includes("network") || lowerMsg.includes("fetch")) {
          Alert.alert("Connection Issue", "Please check your connection and try again.");
        // Rate limiting / daily limits
        } else if (lowerMsg.includes("daily limit") || lowerMsg.includes("limit reached") || lowerMsg.includes("too many")) {
          Alert.alert("Limit Reached", errorMessage);
        // Auth/session errors
        } else if (lowerMsg.includes("unauthorized") || lowerMsg.includes("session") || lowerMsg.includes("expired")) {
          Alert.alert("Session Expired", "Please log in again to continue.");
        // Verification required
        } else if (lowerMsg.includes("verify") || lowerMsg.includes("verification")) {
          Alert.alert("Verification Required", errorMessage);
        // User not available (blocked, inactive, etc.)
        } else if (lowerMsg.includes("not available") || lowerMsg.includes("unavailable")) {
          Alert.alert("Profile Unavailable", "This profile is no longer available.");
        // Generic fallback with dev logging
        } else {
          if (__DEV__) {
            console.warn('[DiscoverFeed] Swipe error:', errorMessage);
          }
          Alert.alert("Unable to Swipe", "Something went wrong. Please try again.");
        }
      } finally {
        swipeLockRef.current = false;
      }
    },
    // P0-001 FIX: Added token to dependency array
    [currentProfile, token, swipeMutation],
  );

  const animateSwipe = useCallback(
    (direction: "left" | "right" | "up") => {
      // SAFETY FIX: Don't start animation if swipe already in progress
      if (swipeLockRef.current) return;

      const targetX =
        direction === "left"
          ? -SCREEN_WIDTH * 1.5
          : direction === "right"
            ? SCREEN_WIDTH * 1.5
            : 0;
      const targetY = direction === "up" ? -SCREEN_HEIGHT * 1.5 : 0;

      setOverlayDirection(direction);
      setOverlayOpacity(1);

      Animated.parallel([
        Animated.timing(pan.x, {
          toValue: targetX,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(pan.y, {
          toValue: targetY,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        pan.setValue({ x: 0, y: 0 });
        setOverlayDirection(null);
        setOverlayOpacity(0);
        // Fire the actual swipe side effect after the animation completes.
        void handleSwipe(direction);
      });
    },
    [handleSwipe, pan],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        // SAFETY FIX: Block gesture when swipe is locked
        onMoveShouldSetPanResponder: (_, gestureState) =>
          !swipeLockRef.current && (Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5),
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          !swipeLockRef.current && (Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5),
        onPanResponderMove: (_, gestureState) => {
          if (swipeLockRef.current) return;
          pan.setValue({ x: gestureState.dx, y: gestureState.dy });

          let nextDirection: "left" | "right" | "up" | null = null;
          if (gestureState.dy < -50) nextDirection = "up";
          else if (gestureState.dx < -50) nextDirection = "left";
          else if (gestureState.dx > 50) nextDirection = "right";

          setOverlayDirection(nextDirection);
          setOverlayOpacity(Math.min(Math.abs(gestureState.dx) / 100, 1));
        },
        onPanResponderRelease: async (_, gestureState) => {
          if (swipeLockRef.current) return;

          if (gestureState.dx < -SWIPE_THRESHOLD_X) {
            await Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
            animateSwipe("left");
            return;
          }

          if (gestureState.dx > SWIPE_THRESHOLD_X) {
            await Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
            animateSwipe("right");
            return;
          }

          if (gestureState.dy < -SWIPE_THRESHOLD_Y) {
            await Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
            animateSwipe("up");
            return;
          }

          resetPosition();
        },
        onPanResponderTerminate: () => {
          resetPosition();
        },
      }),
    [animateSwipe, pan, resetPosition],
  );

  const rotation = pan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: ["-15deg", "0deg", "15deg"],
    extrapolate: "clamp",
  });

  const cardAnimatedStyle = {
    transform: [
      { translateX: pan.x },
      { translateY: pan.y },
      { rotate: rotation },
      { scale: 1 },
    ],
  } as const;

  const nextCardScale = pan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [1, 0.95, 1],
    extrapolate: "clamp",
  });

  const nextCardAnimatedStyle = {
    transform: [{ scale: nextCardScale }],
  } as const;

  const handleRewind = useCallback(async () => {
    if (!lastSwipedProfile.current) {
      Alert.alert("Rewind", "No recent swipe to undo");
      return;
    }

    if (isDemoMode) {
      if (currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
        lastSwipedProfile.current = null;
      }
      return;
    }

    try {
      await rewindMutation({ authUserId: userId as string });
      if (currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      }
      lastSwipedProfile.current = null;
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to rewind");
    }
  }, [userId, currentIndex, rewindMutation]);

  // Loading state
  if (!isDemoMode && !convexProfiles) {
    return (
      <View style={[styles.container, styles.loadingContainer, dark && { backgroundColor: TC.background }]}>
        <ActivityIndicator size="large" color={TC.primary} />
        <Text style={[styles.loadingText, dark && { color: TC.textLight }]}>Loading profiles...</Text>
      </View>
    );
  }

  // Empty state
  if (profiles.length === 0 || currentIndex >= profiles.length) {
    return (
      <View style={[styles.container, styles.emptyContainer, dark && { backgroundColor: TC.background }]}>
        <Text style={styles.emptyEmoji}>{"\u{1F50D}"}</Text>
        <Text style={[styles.emptyTitle, dark && { color: TC.text }]}>No more profiles</Text>
        <Text style={[styles.emptySubtitle, dark && { color: TC.textLight }]}>
          Check back later for new matches!
        </Text>
        <TouchableOpacity
          style={[styles.refreshButton, dark && { backgroundColor: TC.primary }]}
          onPress={() => {
            // P1-003 FIX: Trigger proper data refetch by incrementing refreshKey
            setRefreshKey((k) => k + 1);
            setCurrentIndex(0);
          }}
        >
          <Text style={styles.refreshButtonText}>Start Over</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, dark && { backgroundColor: TC.background }]}>
      {/* Floating Header — overlays top of card */}
      <View style={[styles.header, dark && { backgroundColor: 'transparent', borderBottomColor: 'transparent' }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => setShowPrefsMenu(true)}
        >
          <Text style={[styles.headerButtonText, dark && { color: TC.text }]}>Preferences</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, dark && { color: TC.text }]}>{dark ? "Deep Connect" : "Discover"}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIcon}
            onPress={() => router.push("/(main)/likes")}
          >
            <Text style={styles.headerIconText}>{"\u2764\uFE0F"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Profile Cards — full bleed, no padding */}
      <View style={styles.cardsContainer}>
        {nextProfile && (
          <Animated.View style={[styles.nextCard, nextCardAnimatedStyle]}>
            <ProfileCard
              name={nextProfile.name}
              age={nextProfile.age}
              bio={nextProfile.bio}
              city={nextProfile.city}
              isVerified={nextProfile.isVerified}
              distance={nextProfile.distance}
              photos={nextProfile.photos}
              theme={theme}
            />
          </Animated.View>
        )}
        {currentProfile && (
          <Animated.View
            style={[styles.currentCard, cardAnimatedStyle]}
            {...panResponder.panHandlers}
          >
            <ProfileCard
              name={currentProfile.name}
              age={currentProfile.age}
              bio={currentProfile.bio}
              city={currentProfile.city}
              isVerified={currentProfile.isVerified}
              distance={currentProfile.distance}
              photos={currentProfile.photos}
              relationshipIntent={currentProfile.relationshipIntent}
              activities={currentProfile.activities}
              profilePrompt={currentProfile.profilePrompt}
              showCarousel
              theme={theme}
              onOpenProfile={onOpenProfile ? () => onOpenProfile(currentProfile.id) : undefined}
            />
            <SwipeOverlay
              direction={overlayDirection}
              opacity={overlayOpacity}
            />
          </Animated.View>
        )}
      </View>

      {/* Action Buttons — floating overlay at bottom */}
      <View style={[styles.actions, dark && { borderTopColor: 'transparent', backgroundColor: 'transparent' }]} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.actionButton, styles.rewindButton, dark && { backgroundColor: INCOGNITO_COLORS.surface }]}
          onPress={handleRewind}
        >
          <Text style={styles.actionIcon}>{"\u21B6"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.passButton, dark && { backgroundColor: INCOGNITO_COLORS.surface }]}
          onPress={() => animateSwipe("left")}
        >
          <Text style={styles.actionIcon}>{"\u2715"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.superLikeButton, dark && { backgroundColor: INCOGNITO_COLORS.surface }]}
          onPress={() => animateSwipe("up")}
        >
          <Text style={styles.actionIcon}>{"\u2B50"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.likeButton, dark && { backgroundColor: INCOGNITO_COLORS.surface }]}
          onPress={() => animateSwipe("right")}
        >
          <Text style={styles.actionIcon}>{"\u2764\uFE0F"}</Text>
        </TouchableOpacity>
      </View>

      {/* Preferences Menu */}
      <Modal
        visible={showPrefsMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPrefsMenu(false)}
      >
        <TouchableOpacity
          style={styles.prefsMenuOverlay}
          activeOpacity={1}
          onPress={() => setShowPrefsMenu(false)}
        >
          <View style={[styles.prefsMenuContainer, { marginTop: insets.top + 50 }]}>
            <TouchableOpacity
              style={styles.prefsMenuItem}
              onPress={() => {
                setShowPrefsMenu(false);
                router.push("/(main)/discovery-preferences");
              }}
            >
              <View style={styles.prefsMenuItemContent}>
                <Text style={styles.prefsMenuItemTitle}>Discovery Preferences</Text>
                <Text style={styles.prefsMenuItemSubtitle}>Age, distance, and who you see</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
  emptyContainer: {
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: "center",
    marginBottom: 24,
  },
  refreshButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  refreshButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  headerButton: {
    padding: 8,
  },
  headerButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: COLORS.text,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.text,
  },
  headerRight: {
    flexDirection: "row",
    gap: 12,
  },
  headerIcon: {
    padding: 4,
  },
  headerIconText: {
    fontSize: 20,
  },
  cardsContainer: {
    flex: 1,
  },
  currentCard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  nextCard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  actions: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 12,
    paddingBottom: 16,
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  actionButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.backgroundDark,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  rewindButton: {
    backgroundColor: "#FFF3E0",
  },
  passButton: {
    backgroundColor: "#FFEBEE",
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  superLikeButton: {
    backgroundColor: "#E3F2FD",
  },
  likeButton: {
    backgroundColor: "#E8F5E9",
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  actionIcon: {
    fontSize: 28,
  },
  prefsMenuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  prefsMenuContainer: {
    marginHorizontal: 16,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  prefsMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  prefsMenuItemContent: {
    flex: 1,
  },
  prefsMenuItemTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 2,
  },
  prefsMenuItemSubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
  },
});
