import React, { useMemo, useState, useCallback, useRef } from "react";
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
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Haptics from "expo-haptics";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ProfileCard, SwipeOverlay } from "@/components/cards";
import { FilterModal } from "@/components/filters";
import { useAuthStore } from "@/stores/authStore";
import { useFilterStore } from "@/stores/filterStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { COLORS, INCOGNITO_COLORS } from "@/lib/constants";
import { DEMO_PROFILES } from "@/lib/demoData";
import { isDemoMode } from "@/hooks/useConvex";
import type { SortOption } from "@/types";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const SWIPE_THRESHOLD_X = SCREEN_WIDTH * 0.15; // 15% — easier swipe
const SWIPE_THRESHOLD_Y = SCREEN_HEIGHT * 0.12; // 12% — easier super-like

interface ProfileData {
  id: string;
  name: string;
  age: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  distance?: number;
  photos: { url: string }[];
}

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
  const { userId } = useAuthStore();
  useFilterStore();
  useSubscriptionStore();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sortByLocal, setSortByLocal] = useState<SortOption>("recommended");
  const [showFilters, setShowFilters] = useState(false);
  const lastSwipedProfile = useRef<ProfileData | null>(null);

  const [overlayDirection, setOverlayDirection] = useState<
    "left" | "right" | "up" | null
  >(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0);

  // Use demo data if in demo mode, otherwise use Convex
  const convexProfiles = useQuery(
    api.discover.getDiscoverProfiles,
    !isDemoMode && userId
      ? {
          userId: userId as any,
          sortBy: sortByLocal,
          limit: 20,
        }
      : "skip",
  );

  // Transform to common format
  const profiles: ProfileData[] = isDemoMode
    ? DEMO_PROFILES.map((p) => ({
        id: p._id,
        name: p.name,
        age: p.age,
        bio: p.bio,
        city: p.city,
        isVerified: p.isVerified,
        distance: p.distance,
        photos: p.photos,
      }))
    : (convexProfiles || []).map((p: any) => ({
        id: p._id || p.id,
        name: p.name,
        age: p.age,
        bio: p.bio,
        city: p.city,
        isVerified: p.isVerified,
        distance: p.distance,
        photos:
          p.photos?.map((photo: any) => ({ url: photo.url || photo })) || [],
      }));

  const swipeMutation = useMutation(api.likes.swipe);
  const rewindMutation = useMutation(api.likes.rewind);

  // Animation values (React Native Animated)
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

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
      if (!currentProfile) return;

      const action =
        direction === "left"
          ? "pass"
          : direction === "up"
            ? "super_like"
            : "like";

      if (isDemoMode) {
        // Demo mode - just move to next profile
        lastSwipedProfile.current = currentProfile;

        if (direction === "right" && Math.random() > 0.7) {
          // 30% chance of match in demo mode
          Alert.alert(
            "\u{1F389} It's a Match!",
            `You and ${currentProfile.name} liked each other!`,
          );
        }

        setCurrentIndex((prev) => prev + 1);
        return;
      }

      try {
        const result = await swipeMutation({
          fromUserId: userId as any,
          toUserId: currentProfile.id as any,
          action: action as any,
        });

        lastSwipedProfile.current = currentProfile;

        if (result?.isMatch) {
          router.push(
            `/(main)/match-celebration?matchId=${result.matchId}&userId=${currentProfile.id}`,
          );
        } else {
          setCurrentIndex((prev) => prev + 1);
        }
      } catch (error: any) {
        Alert.alert("Error", error.message || "Failed to swipe");
      }
    },
    [currentProfile, userId, swipeMutation],
  );

  const animateSwipe = useCallback(
    (direction: "left" | "right" | "up") => {
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
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5,
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5,
        onPanResponderMove: (_, gestureState) => {
          pan.setValue({ x: gestureState.dx, y: gestureState.dy });

          let nextDirection: "left" | "right" | "up" | null = null;
          if (gestureState.dy < -50) nextDirection = "up";
          else if (gestureState.dx < -50) nextDirection = "left";
          else if (gestureState.dx > 50) nextDirection = "right";

          setOverlayDirection(nextDirection);
          setOverlayOpacity(Math.min(Math.abs(gestureState.dx) / 100, 1));
        },
        onPanResponderRelease: async (_, gestureState) => {
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
      await rewindMutation({ userId: userId as any });
      if (currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      }
      lastSwipedProfile.current = null;
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to rewind");
    }
  }, [userId, currentIndex, rewindMutation]);

  const handleApplyFilters = (newFilters: any, newSortBy: SortOption) => {
    setSortByLocal(newSortBy);
    setShowFilters(false);
    setCurrentIndex(0); // Reset to show filtered results
  };

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
          onPress={() => setCurrentIndex(0)}
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
          onPress={() => setShowFilters(true)}
        >
          <Text style={[styles.headerButtonText, dark && { color: TC.text }]}>{"\u2630"} Filters</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, dark && { color: TC.text }]}>{dark ? "Desire Land" : "Discover"}</Text>
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

      <FilterModal
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={handleApplyFilters}
        initialSortBy={sortByLocal}
      />
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
});
