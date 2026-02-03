import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Animated,
  PanResponder,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS, INCOGNITO_COLORS, SWIPE_CONFIG } from "@/lib/constants";
import { getTrustBadges } from "@/lib/trustBadges";
import { useAuthStore } from "@/stores/authStore";
import { useDiscoverStore } from "@/stores/discoverStore";
import { ProfileCard, SwipeOverlay } from "@/components/cards";
import { isDemoMode } from "@/hooks/useConvex";
import { useNotifications } from "@/hooks/useNotifications";
import { DEMO_PROFILES, DEMO_USER } from "@/lib/demoData";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useInteractionStore } from "@/stores/interactionStore";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const HEADER_H = 44;

interface ProfileData {
  id: string;
  name: string;
  age: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  verificationStatus?: string;
  distance?: number;
  photos: { url: string }[];
  activities?: string[];
  relationshipIntent?: string[];
  lastActive?: number;
  createdAt?: number;
  profilePrompts?: { question: string; answer: string }[];
}

export interface DiscoverCardStackProps {
  /** 'dark' applies INCOGNITO_COLORS to background/header only; card UI stays identical */
  theme?: "light" | "dark";
}

export function DiscoverCardStack({ theme = "light" }: DiscoverCardStackProps) {
  const dark = theme === "dark";
  const C = dark ? INCOGNITO_COLORS : COLORS;

  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const [index, setIndex] = useState(0);

  // Daily limits — individual selectors to avoid full re-render on AsyncStorage hydration
  const likesRemaining = useDiscoverStore((s) => s.likesRemaining);
  const standOutsRemaining = useDiscoverStore((s) => s.standOutsRemaining);
  const hasReachedLikeLimit = useDiscoverStore((s) => s.hasReachedLikeLimit);
  const hasReachedStandOutLimit = useDiscoverStore((s) => s.hasReachedStandOutLimit);
  const incrementLikes = useDiscoverStore((s) => s.incrementLikes);
  const incrementStandOuts = useDiscoverStore((s) => s.incrementStandOuts);
  const checkAndResetIfNewDay = useDiscoverStore((s) => s.checkAndResetIfNewDay);

  // Reset daily limits if new day
  useEffect(() => {
    checkAndResetIfNewDay();
  }, [checkAndResetIfNewDay]);

  // ── Navigation lock: prevents handleSwipe/pan handlers from firing during navigation ──
  const navigatingRef = useRef(false);
  // ── Focus guard: tracks whether this screen is the active tab ──
  const isFocusedRef = useRef(true);
  // ── Track in-flight animation so we can cancel on blur ──
  const activeAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  // ── Swipe lock: prevents re-entrant handleSwipe from queued animation callbacks ──
  const swipingRef = useRef(false);

  // Overlay refs + animated value (no React re-renders during drag)
  const overlayDirectionRef = useRef<"left" | "right" | "up" | null>(null);
  const overlayOpacityAnim = useRef(new Animated.Value(0)).current;
  const [overlayDirection, setOverlayDirection] = useState<"left" | "right" | "up" | null>(null);

  // Stand Out result from route screen
  const standOutResult = useInteractionStore((s) => s.standOutResult);

  // Notifications
  const { unseenCount } = useNotifications();

  // Profile data
  const convexProfiles = useQuery(
    api.discover.getDiscoverProfiles,
    !isDemoMode && userId
      ? { userId: userId as any, sortBy: "recommended" as any, limit: 20 }
      : "skip",
  );

  // CRITICAL: useMemo prevents new array/object references on every render.
  // Without this, DEMO_PROFILES.map() creates new objects each render,
  // which cascades: new current → new handleSwipe → new animateSwipe → new panResponder
  // → touches dropped between old/new panResponder attachment.
  const latestProfiles: ProfileData[] = useMemo(() => {
    if (isDemoMode) {
      return DEMO_PROFILES.map((p) => ({
        id: p._id,
        name: p.name,
        age: p.age,
        bio: p.bio,
        city: p.city,
        isVerified: p.isVerified,
        distance: p.distance,
        photos: p.photos,
        activities: p.activities,
        relationshipIntent: p.relationshipIntent,
        lastActive: Date.now() - 2 * 60 * 60 * 1000,
        createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
        profilePrompts: (p as any).profilePrompts,
      }));
    }
    return (convexProfiles || []).map((p: any) => ({
      id: p._id || p.id,
      name: p.name,
      age: p.age,
      bio: p.bio,
      city: p.city,
      isVerified: p.isVerified,
      verificationStatus: p.verificationStatus,
      distance: p.distance,
      photos: p.photos?.map((photo: any) => ({ url: photo.url || photo })) || [],
      activities: p.activities,
      relationshipIntent: p.relationshipIntent,
      lastActive: p.lastActive,
      createdAt: p.createdAt,
      profilePrompts: p.profilePrompts,
    }));
  }, [convexProfiles]);

  // Keep last non-empty profiles to prevent blank-frame flicker
  const stableProfilesRef = useRef<ProfileData[]>([]);
  if (latestProfiles.length > 0) {
    stableProfilesRef.current = latestProfiles;
  }
  const profiles = latestProfiles.length > 0 ? latestProfiles : stableProfilesRef.current;

  // Trust badges
  const getBadges = (p: ProfileData) =>
    getTrustBadges({
      isVerified: p.isVerified,
      verificationStatus: p.verificationStatus,
      lastActive: p.lastActive,
      createdAt: p.createdAt,
      photoCount: p.photos?.length,
    });

  const swipeMutation = useMutation(api.likes.swipe);

  // Two-pan alternating approach
  const panA = useRef(new Animated.ValueXY()).current;
  const panB = useRef(new Animated.ValueXY()).current;
  const activeSlotRef = useRef<0 | 1>(0);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const getActivePan = () => (activeSlotRef.current === 0 ? panA : panB);

  // ── Focus effect: cancel animations on blur, reset nav lock on focus ──
  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      navigatingRef.current = false;
      swipingRef.current = false;
      console.log("[DiscoverCardStack] focus gained");
      return () => {
        isFocusedRef.current = false;
        console.log("[DiscoverCardStack] focus lost — cancelling animations");
        if (activeAnimationRef.current) {
          activeAnimationRef.current.stop();
          activeAnimationRef.current = null;
        }
        panA.setValue({ x: 0, y: 0 });
        panB.setValue({ x: 0, y: 0 });
        overlayOpacityAnim.setValue(0);
        overlayDirectionRef.current = null;
      };
    }, [panA, panB, overlayOpacityAnim]),
  );

  const activePan = activeSlot === 0 ? panA : panB;

  const rotation = activePan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [`-${SWIPE_CONFIG.ROTATION_ANGLE}deg`, "0deg", `${SWIPE_CONFIG.ROTATION_ANGLE}deg`],
    extrapolate: "clamp",
  });

  const cardStyle = {
    transform: [{ translateX: activePan.x }, { translateY: activePan.y }, { rotate: rotation }, { scale: 1 }],
  } as const;

  const nextScale = activePan.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: [1, 0.95, 1],
    extrapolate: "clamp",
  });

  const current = profiles.length > 0 ? profiles[index % profiles.length] : undefined;
  const next = profiles.length > 0 ? profiles[(index + 1) % profiles.length] : undefined;

  // Stable refs for panResponder callbacks — prevents panResponder recreation
  // when current/handleSwipe/animateSwipe change between renders.
  const currentRef = useRef(current);
  currentRef.current = current;

  const resetPosition = useCallback(() => {
    const currentPan = getActivePan();
    Animated.spring(currentPan, {
      toValue: { x: 0, y: 0 },
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();
    overlayDirectionRef.current = null;
    overlayOpacityAnim.setValue(0);
    setOverlayDirection(null);
  }, [panA, panB, overlayOpacityAnim]);

  const advanceCard = useCallback(() => {
    const newSlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    activeSlotRef.current = newSlot;
    const newPan = newSlot === 0 ? panA : panB;
    newPan.setValue({ x: 0, y: 0 });
    overlayOpacityAnim.setValue(0);
    overlayDirectionRef.current = null;
    setOverlayDirection(null);
    setActiveSlot(newSlot);
    setIndex((prev) => prev + 1);
    const oldPan = newSlot === 0 ? panB : panA;
    requestAnimationFrame(() => oldPan.setValue({ x: 0, y: 0 }));
  }, [panA, panB, overlayOpacityAnim]);

  const handleSwipe = useCallback(
    (direction: "left" | "right" | "up", message?: string) => {
      // Guard: skip if navigating away or screen lost focus (e.g. tab switched mid-animation)
      if (navigatingRef.current || !isFocusedRef.current) {
        console.log(`[DiscoverCardStack] handleSwipe BLOCKED (navigating=${navigatingRef.current} focused=${isFocusedRef.current})`);
        return;
      }
      // Guard: prevent re-entrant calls from queued animation callbacks
      if (swipingRef.current) {
        console.log(`[DiscoverCardStack] handleSwipe BLOCKED (swipe in progress)`);
        return;
      }
      swipingRef.current = true;

      console.log(`[DiscoverCardStack] handleSwipe dir=${direction} current=${current?.name} index=${index}`);
      if (!current) { swipingRef.current = false; return; }

      // Check daily limits for likes and stand outs
      if (direction === "right" && hasReachedLikeLimit()) { swipingRef.current = false; return; }
      if (direction === "up" && hasReachedStandOutLimit()) { swipingRef.current = false; return; }

      const swipedProfile = current;
      const action = direction === "left" ? "pass" : direction === "up" ? "super_like" : "like";
      advanceCard();

      // Increment counters
      if (direction === "right") incrementLikes();
      if (direction === "up") incrementStandOuts();

      // Release swipe lock after React has batched the state updates
      requestAnimationFrame(() => { swipingRef.current = false; });

      if (isDemoMode) {
        if (direction === "right" && Math.random() > 0.7) {
          if (navigatingRef.current) return;
          navigatingRef.current = true;
          console.log(`[DiscoverCardStack] navigating to match-celebration userId=${swipedProfile.id}`);
          router.push(`/(main)/match-celebration?matchId=demo_match&userId=${swipedProfile.id}` as any);
          setTimeout(() => { navigatingRef.current = false; }, 600);
        }
        return;
      }

      swipeMutation({
        fromUserId: userId as any,
        toUserId: swipedProfile.id as any,
        action: action as any,
        message: message,
      }).then((result) => {
        if (result?.isMatch && !navigatingRef.current && isFocusedRef.current) {
          navigatingRef.current = true;
          router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${swipedProfile.id}`);
          setTimeout(() => { navigatingRef.current = false; }, 600);
        }
      }).catch((error: any) => {
        Alert.alert("Error", error.message || "Failed to swipe");
      });
    },
    [current, userId, swipeMutation, advanceCard, hasReachedLikeLimit, hasReachedStandOutLimit, incrementLikes, incrementStandOuts],
  );

  const animateSwipe = useCallback(
    (direction: "left" | "right" | "up", velocity?: number) => {
      // Guard: don't start new animations if navigating or unfocused
      if (navigatingRef.current || !isFocusedRef.current) return;
      // Check limits before animating
      if (direction === "right" && hasReachedLikeLimit()) return;
      if (direction === "up" && hasReachedStandOutLimit()) return;

      const currentPan = getActivePan();
      const targetX = direction === "left" ? -SCREEN_WIDTH * 1.5 : direction === "right" ? SCREEN_WIDTH * 1.5 : 0;
      const targetY = direction === "up" ? -SCREEN_HEIGHT * 1.5 : 0;
      const speed = Math.abs(velocity || 0);
      const duration = speed > 1.5 ? 120 : speed > 0.5 ? 180 : 250;

      setOverlayDirection(direction);
      overlayOpacityAnim.setValue(1);

      const anim = Animated.parallel([
        Animated.timing(currentPan.x, { toValue: targetX, duration, useNativeDriver: true }),
        Animated.timing(currentPan.y, { toValue: targetY, duration, useNativeDriver: true }),
      ]);
      activeAnimationRef.current = anim;
      anim.start(({ finished }) => {
        activeAnimationRef.current = null;
        if (!finished) return;
        handleSwipeRef.current(direction);
      });
    },
    [panA, panB, overlayOpacityAnim, hasReachedLikeLimit, hasReachedStandOutLimit],
  );

  // Stable refs so the panResponder (created once) always calls the latest version
  const handleSwipeRef = useRef(handleSwipe);
  handleSwipeRef.current = handleSwipe;
  const animateSwipeRef = useRef(animateSwipe);
  animateSwipeRef.current = animateSwipe;

  const thresholdX = SCREEN_WIDTH * SWIPE_CONFIG.SWIPE_THRESHOLD_X;
  const thresholdY = SCREEN_HEIGHT * SWIPE_CONFIG.SWIPE_THRESHOLD_Y;
  const velocityX = SWIPE_CONFIG.SWIPE_VELOCITY_X;
  const velocityY = SWIPE_CONFIG.SWIPE_VELOCITY_Y;

  // PanResponder created ONCE (empty deps). Uses refs for all callback logic
  // so it always calls the latest handleSwipe/animateSwipe without recreation.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gs) => {
          // Don't claim touches if navigating or unfocused
          if (navigatingRef.current || !isFocusedRef.current) return false;
          return Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8;
        },
        // Allow other responders (e.g. tab bar) to take over
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: () => {
          console.log("[DiscoverCardStack] pan grant");
        },
        onPanResponderMove: (_, gs) => {
          getActivePan().setValue({ x: gs.dx, y: gs.dy });
          const absX = Math.abs(gs.dx);
          const absY = Math.abs(gs.dy);
          if (gs.dy < -15 && absY > absX) overlayDirectionRef.current = "up";
          else if (gs.dx < -10) overlayDirectionRef.current = "left";
          else if (gs.dx > 10) overlayDirectionRef.current = "right";
          else overlayDirectionRef.current = null;
          overlayOpacityAnim.setValue(Math.min(Math.max(absX, absY) / 60, 1));
          const newDir = overlayDirectionRef.current;
          setOverlayDirection((prev) => (prev === newDir ? prev : newDir));
        },
        onPanResponderRelease: (_, gs) => {
          console.log("[DiscoverCardStack] pan release dx=", gs.dx.toFixed(0), "dy=", gs.dy.toFixed(0));
          // If screen lost focus during drag, just reset
          if (navigatingRef.current || !isFocusedRef.current) { resetPosition(); return; }
          if (gs.dx < -thresholdX || gs.vx < -velocityX) { animateSwipeRef.current("left", gs.vx); return; }
          if (gs.dx > thresholdX  || gs.vx > velocityX)  { animateSwipeRef.current("right", gs.vx); return; }
          if (gs.dy < -thresholdY || gs.vy < -velocityY)  {
            // Up swipe triggers Stand Out screen instead of instant swipe
            resetPosition();
            const c = currentRef.current;
            if (!hasReachedStandOutLimit() && c) {
              router.push(`/(main)/stand-out?profileId=${c.id}&name=${encodeURIComponent(c.name)}&standOutsLeft=${standOutsRemaining()}` as any);
            }
            return;
          }
          resetPosition();
        },
        onPanResponderTerminate: () => resetPosition(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panA, panB, overlayOpacityAnim, resetPosition, thresholdX, thresholdY, velocityX, velocityY],
  );

  // Handle stand-out result from route screen
  useEffect(() => {
    if (!standOutResult || !current) return;
    if (!isFocusedRef.current) return; // don't process if unfocused
    useInteractionStore.getState().setStandOutResult(null);
    const msg = standOutResult.message;

    // Animate the card out (up direction)
    const currentPan = getActivePan();
    const targetY = -SCREEN_HEIGHT * 1.5;

    setOverlayDirection("up");
    overlayOpacityAnim.setValue(1);

    const anim = Animated.timing(currentPan.y, { toValue: targetY, duration: 250, useNativeDriver: true });
    activeAnimationRef.current = anim;
    anim.start(({ finished }) => {
      activeAnimationRef.current = null;
      if (!finished) return;
      handleSwipe("up", msg || undefined);
    });
  }, [standOutResult]);

  // ── Diagnostic: detect render storms ──
  // Expected: ~3 renders per swipe (overlay direction + advance card batched states).
  // Warn only if we exceed 50 renders per session (indicates real problem).
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  if (renderCountRef.current % 50 === 0) {
    console.warn(`[DiscoverCardStack] render #${renderCountRef.current}`);
  }

  // Loading state — non-demo only; demo profiles are instant via useMemo
  if (!isDemoMode && !convexProfiles) {
    console.log("[DiscoverCardStack] showing loading state — convexProfiles not yet available");
    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={[styles.loadingText, dark && { color: INCOGNITO_COLORS.textLight }]}>Loading profiles...</Text>
      </View>
    );
  }

  // Empty state
  if (profiles.length === 0) {
    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <Text style={styles.emptyEmoji}>🔍</Text>
        <Text style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>No profiles available</Text>
        <Text style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>Check back later for new matches!</Text>
      </View>
    );
  }

  // Daily like limit reached state
  if (hasReachedLikeLimit()) {
    return (
      <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/settings" as any)}>
            <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          </TouchableOpacity>
          <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/likes" as any)}>
            <Ionicons name="heart" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.limitContainer}>
          <Ionicons name="heart-circle-outline" size={80} color={COLORS.primary} />
          <Text style={[styles.limitTitle, dark && { color: INCOGNITO_COLORS.text }]}>You've used today's likes!</Text>
          <Text style={[styles.limitSubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>Likes refresh at midnight</Text>
          <TouchableOpacity
            style={styles.limitButton}
            onPress={() => router.push("/(main)/likes" as any)}
          >
            <Ionicons name="heart" size={18} color={COLORS.white} />
            <Text style={styles.limitButtonText}>Check who liked you</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Layout: card fills from header to bottom of content area
  const cardTop = insets.top + HEADER_H;
  const cardBottom = 4;
  const actionRowBottom = 16;

  const likesLeft = likesRemaining();
  const standOutsLeft = standOutsRemaining();

  return (
    <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
      {/* Compact Header */}
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/settings" as any)}>
          <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
        </TouchableOpacity>
        <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/likes" as any)}>
          <Ionicons name="heart" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          {unseenCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Card Area (fills between header and tab bar) */}
      <View style={[styles.cardArea, { top: cardTop, bottom: cardBottom }]} pointerEvents="box-none">
        {/* Back card */}
        {next && (
          <Animated.View
            style={[styles.card, { zIndex: 0, transform: [{ scale: nextScale }] }]}
          >
            <ProfileCard
              name={next.name}
              age={next.age}
              city={next.city}
              isVerified={next.isVerified}
              distance={next.distance}
              photos={next.photos}
              trustBadges={getBadges(next)}
              profilePrompt={next.profilePrompts?.[0]}
            />
          </Animated.View>
        )}
        {/* Top card */}
        {current && (
          <Animated.View style={[styles.card, { zIndex: 1 }, cardStyle]} {...panResponder.panHandlers}>
            <ProfileCard
              name={current.name}
              age={current.age}
              city={current.city}
              isVerified={current.isVerified}
              distance={current.distance}
              photos={current.photos}
              trustBadges={getBadges(current)}
              profilePrompt={current.profilePrompts?.[0]}
              showCarousel
              onOpenProfile={() => router.push(`/profile/${current.id}` as any)}
            />
            <SwipeOverlay direction={overlayDirection} opacity={overlayOpacityAnim} />
          </Animated.View>
        )}
      </View>

      {/* 3-Button Action Bar */}
      <View style={[styles.actions, { bottom: actionRowBottom }]} pointerEvents="box-none">
        {/* Skip (X) */}
        <TouchableOpacity
          style={[styles.actionButton, styles.skipBtn]}
          onPress={() => animateSwipeRef.current("left")}
        >
          <Ionicons name="close" size={30} color="#F44336" />
        </TouchableOpacity>

        {/* Stand Out (star) */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.standOutBtn,
            hasReachedStandOutLimit() && styles.actionBtnDisabled,
          ]}
          onPress={() => {
            const c = currentRef.current;
            if (!hasReachedStandOutLimit() && c) {
              router.push(`/(main)/stand-out?profileId=${c.id}&name=${encodeURIComponent(c.name)}&standOutsLeft=${standOutsLeft}` as any);
            }
          }}
          disabled={hasReachedStandOutLimit()}
        >
          <Ionicons name="star" size={24} color={COLORS.white} />
          <View style={styles.standOutBadge}>
            <Text style={styles.standOutBadgeText}>{standOutsLeft}</Text>
          </View>
        </TouchableOpacity>

        {/* Like (heart) */}
        <TouchableOpacity
          style={[styles.actionButton, styles.likeBtn]}
          onPress={() => animateSwipeRef.current("right")}
        >
          <Ionicons name="heart" size={30} color={COLORS.white} />
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 24, fontWeight: "700", color: COLORS.text, marginBottom: 8 },
  emptySubtitle: { fontSize: 16, color: COLORS.textLight, textAlign: "center" },

  // Compact Header
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: COLORS.background,
    zIndex: 10,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  headerLogo: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: 1,
  },
  bellBadge: {
    position: "absolute",
    top: 0,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: COLORS.background,
  },
  bellBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.white,
  },

  // Card Area
  cardArea: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  card: {
    position: "absolute",
    top: 4,
    left: 8,
    right: 8,
    bottom: 4,
    borderRadius: 16,
    overflow: "hidden",
  },

  // 3-Button Action Bar
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    zIndex: 50,
  },
  actionButton: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  skipBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  standOutBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#2196F3",
    position: "relative",
  },
  likeBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  standOutBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#2196F3",
  },
  standOutBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2196F3",
  },

  // Daily limit reached
  limitContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  limitTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  limitSubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    marginBottom: 24,
    textAlign: "center",
  },
  limitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
  },
  limitButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.white,
  },

});
