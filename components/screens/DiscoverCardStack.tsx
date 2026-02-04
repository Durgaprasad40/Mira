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
import { DEMO_PROFILES, getDemoCurrentUser } from "@/lib/demoData";
import { useDemoStore } from "@/stores/demoStore";
import { router } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useInteractionStore } from "@/stores/interactionStore";
import { asUserId } from "@/convex/id";
import { ProfileData, toProfileData } from "@/lib/profileData";
import { rankProfiles } from "@/lib/rankProfiles";
import { getProfileCompleteness, NUDGE_MESSAGES } from "@/lib/profileCompleteness";
import { ProfileNudge } from "@/components/ui/ProfileNudge";
import { trackEvent } from "@/lib/analytics";
import { Toast } from "@/components/ui/Toast";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const EMPTY_ARRAY: any[] = [];

const HEADER_H = 44;

export interface DiscoverCardStackProps {
  /** 'dark' applies INCOGNITO_COLORS to background/header only; card UI stays identical */
  theme?: "light" | "dark";
  /** When provided, skip internal Convex query and use these profiles instead (e.g. Explore category). */
  externalProfiles?: any[];
  /** Hide the built-in header (caller renders its own). */
  hideHeader?: boolean;
}

export function DiscoverCardStack({ theme = "light", externalProfiles, hideHeader }: DiscoverCardStackProps) {
  const dark = theme === "dark";
  const C = dark ? INCOGNITO_COLORS : COLORS;

  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
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

  // ── Mounted guard: prevents state updates and navigation after unmount ──
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clean up locks so a future remount starts fresh
      navigatingRef.current = false;
      swipingRef.current = false;
    };
  }, []);

  // Overlay refs + animated value (no React re-renders during drag)
  const overlayDirectionRef = useRef<"left" | "right" | "up" | null>(null);
  const overlayOpacityAnim = useRef(new Animated.Value(0)).current;
  const [overlayDirection, setOverlayDirection] = useState<"left" | "right" | "up" | null>(null);

  // Stand Out result from route screen
  const standOutResult = useInteractionStore((s) => s.standOutResult);

  // Notifications
  const { unseenCount } = useNotifications();

  // Demo store — seed on mount, read mutable profiles, filter blocked
  const demoProfiles = useDemoStore((s) => s.profiles);
  const demoSeed = useDemoStore((s) => s.seed);
  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);
  useEffect(() => { if (isDemoMode) demoSeed(); }, [demoSeed]);

  // Profile data — memoize args to prevent Convex re-subscriptions
  const convexUserId = asUserId(userId);
  const skipInternalQuery = !!externalProfiles;
  const discoverArgs = useMemo(
    () =>
      !isDemoMode && convexUserId && !skipInternalQuery
        ? { userId: convexUserId, sortBy: "recommended" as any, limit: 20 }
        : "skip" as const,
    [convexUserId, skipInternalQuery],
  );
  const convexProfiles = useQuery(api.discover.getDiscoverProfiles, discoverArgs);
  const profilesSafe = convexProfiles ?? EMPTY_ARRAY;

  // CRITICAL: useMemo prevents new array/object references on every render.
  // Without this, DEMO_PROFILES.map() creates new objects each render,
  // which cascades: new current → new handleSwipe → new animateSwipe → new panResponder
  // → touches dropped between old/new panResponder attachment.
  const latestProfiles: ProfileData[] = useMemo(() => {
    if (externalProfiles) {
      // Filter blocked from external profiles (e.g. explore categories)
      const filtered = isDemoMode
        ? externalProfiles.filter((p: any) => !blockedUserIds.includes(p._id ?? p.id))
        : externalProfiles;
      const mapped = filtered.map(toProfileData);
      // Demo mode: preserve array order for deterministic Discover feed
      return isDemoMode ? mapped : rankProfiles(mapped);
    }
    if (isDemoMode) {
      // Demo mode: return profiles in their original demoData.ts order (no ranking)
      return demoProfiles
        .filter((p) => !blockedUserIds.includes(p._id))
        .map((p) => toProfileData({
          ...p,
          lastActive: Date.now() - 2 * 60 * 60 * 1000,
          createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
        }));
    }
    return rankProfiles(profilesSafe.map(toProfileData));
  }, [externalProfiles, profilesSafe, demoProfiles, blockedUserIds]);

  // Drop profiles with no valid primary photo — prevents blank Discover cards
  const validProfiles = useMemo(
    () => latestProfiles.filter((p) => p.photos.length > 0 && !!p.photos[0]?.url),
    [latestProfiles],
  );

  // Keep last non-empty profiles to prevent blank-frame flicker
  const stableProfilesRef = useRef<ProfileData[]>([]);
  if (validProfiles.length > 0) {
    stableProfilesRef.current = validProfiles;
  }
  const profiles = validProfiles.length > 0 ? validProfiles : stableProfilesRef.current;

  // Trust badges
  const getBadges = (p: ProfileData) =>
    getTrustBadges({
      isVerified: p.isVerified,
      lastActive: p.lastActive,
      photoCount: p.photos?.length,
      bio: p.bio,
    });

  // Profile completeness nudge (main Discover only, not explore categories)
  const dismissedNudges = useDemoStore((s) => s.dismissedNudges);
  const dismissNudge = useDemoStore((s) => s.dismissNudge);
  const currentUserForNudge = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && convexUserId ? { userId: convexUserId } : "skip" as const,
  );
  const currentUser = isDemoMode ? getDemoCurrentUser() : currentUserForNudge;
  const nudgeStatus = currentUser
    ? getProfileCompleteness({
        photoCount: Array.isArray(currentUser.photos) ? currentUser.photos.length : 0,
        bioLength: currentUser.bio?.length ?? 0,
      })
    : 'complete';
  const showNudge =
    !hideHeader &&
    !externalProfiles &&
    nudgeStatus !== 'complete' &&
    !dismissedNudges.includes('discover');
  const NUDGE_H = 38;

  const swipeMutation = useMutation(api.likes.swipe);

  // Two-pan alternating approach
  const panA = useRef(new Animated.ValueXY()).current;
  const panB = useRef(new Animated.ValueXY()).current;
  const activeSlotRef = useRef<0 | 1>(0);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const getActivePan = () => (activeSlotRef.current === 0 ? panA : panB);

  // ── Focus effect: cancel animations on blur, reset nav lock on focus ──
  // Uses useIsFocused() (a single boolean) + idempotent ref guard.
  // useIsFocused subscribes to navigation state once and returns a stable
  // boolean — unlike useFocusEffect whose callback can re-fire on every
  // navigation state reconciliation, triggering Animated.setValue calls
  // that cascade rerenders to sibling tabs.
  const isFocused = useIsFocused();
  const lastFocusStateRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (lastFocusStateRef.current === isFocused) return;
    lastFocusStateRef.current = isFocused;

    if (isFocused) {
      isFocusedRef.current = true;
      navigatingRef.current = false;
      swipingRef.current = false;
      if (__DEV__) console.log("[DiscoverCardStack] focus gained");
    } else {
      isFocusedRef.current = false;
      if (__DEV__) console.log("[DiscoverCardStack] focus lost — cancelling animations");
      if (activeAnimationRef.current) {
        activeAnimationRef.current.stop();
        activeAnimationRef.current = null;
      }
      panA.setValue({ x: 0, y: 0 });
      panB.setValue({ x: 0, y: 0 });
      overlayOpacityAnim.setValue(0);
      overlayDirectionRef.current = null;
    }
  // panA, panB, overlayOpacityAnim are useRef().current — stable across renders,
  // so only isFocused drives this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

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
    // Old pan is reset in the useEffect below, AFTER React has re-rendered
    // with the new activeSlot. This prevents a 1-frame flicker where the
    // swiped-away card snaps back to center before the slot switch renders.
  }, [panA, panB, overlayOpacityAnim]);

  // Reset the now-inactive pan AFTER React commits the new activeSlot.
  // This avoids the race where requestAnimationFrame fires before the
  // batched state update, causing the old card to flash at center.
  useEffect(() => {
    const oldPan = activeSlot === 0 ? panB : panA;
    oldPan.setValue({ x: 0, y: 0 });
  }, [activeSlot, panA, panB]);

  const handleSwipe = useCallback(
    async (direction: "left" | "right" | "up", message?: string) => {
      // Guard: unmounted or unfocused
      if (!mountedRef.current || !isFocusedRef.current) return;
      // Guard: navigation in progress
      if (navigatingRef.current) return;
      // Guard: prevent re-entrant calls from queued animation callbacks
      if (swipingRef.current) return;
      swipingRef.current = true;
      let didNavigate = false;

      try {
        if (__DEV__) console.log(`[DiscoverCardStack] handleSwipe dir=${direction} current=${current?.name} index=${index}`);
        if (!current) return;

        // Check daily limits for likes and stand outs
        if (direction === "right" && hasReachedLikeLimit()) return;
        if (direction === "up" && hasReachedStandOutLimit()) return;

        const swipedProfile = current;
        const action = direction === "left" ? "pass" : direction === "up" ? "super_like" : "like";
        advanceCard();

        // Increment counters
        if (direction === "right") incrementLikes();
        if (direction === "up") incrementStandOuts();

        if (isDemoMode) {
          if (direction === "right" && Math.random() > 0.7) {
            if (!mountedRef.current || !isFocusedRef.current || navigatingRef.current) return;
            navigatingRef.current = true;
            didNavigate = true;
            trackEvent({ name: 'match_created', matchId: 'demo_match', otherUserId: swipedProfile.id });
            if (__DEV__) console.log(`[DiscoverCardStack] navigating to match-celebration userId=${swipedProfile.id}`);
            router.push(`/(main)/match-celebration?matchId=demo_match&userId=${swipedProfile.id}` as any);
            // navigatingRef is reset when focus is regained (focus effect)
          }
          return;
        }

        if (!convexUserId) return; // no valid user id — skip mutation
        const result = await swipeMutation({
          fromUserId: convexUserId,
          toUserId: swipedProfile.id as any,
          action: action as any,
          message: message,
        });

        // Guard: check mounted/focused before navigating on match
        if (!mountedRef.current || !isFocusedRef.current) return;
        if (result?.isMatch && !navigatingRef.current) {
          navigatingRef.current = true;
          didNavigate = true;
          trackEvent({ name: 'match_created', matchId: result.matchId, otherUserId: swipedProfile.id });
          router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${swipedProfile.id}`);
          // navigatingRef is reset when focus is regained (focus effect)
        }
      } catch (error: any) {
        if (!mountedRef.current) return;
        Toast.show("Something went wrong. Please try again.");
      } finally {
        // Always release swipe lock — guaranteed, no timers
        swipingRef.current = false;
        if (!didNavigate) navigatingRef.current = false;
      }
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
          if (__DEV__) console.log("[DiscoverCardStack] pan grant");
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
          if (__DEV__) console.log("[DiscoverCardStack] pan release dx=", gs.dx.toFixed(0), "dy=", gs.dy.toFixed(0));
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
    if (!mountedRef.current || !isFocusedRef.current) return;
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
      if (!mountedRef.current || !isFocusedRef.current) return;
      handleSwipe("up", msg || undefined);
    });
  }, [standOutResult]);

  // ── Diagnostic: detect render storms ──
  // Expected: ~3 renders per swipe (overlay direction + advance card batched states).
  // Warn only if we exceed 50 renders per session (indicates real problem).
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  if (renderCountRef.current % 50 === 0) {
    if (__DEV__) console.warn(`[DiscoverCardStack] render #${renderCountRef.current}`);
  }

  // Loading state — non-demo only; skip when using external profiles
  if (!isDemoMode && !externalProfiles && !convexProfiles) {
    if (__DEV__) console.log("[DiscoverCardStack] showing loading state — convexProfiles not yet available");
    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={[styles.loadingText, dark && { color: INCOGNITO_COLORS.textLight }]}>Finding people for you...</Text>
      </View>
    );
  }

  // Empty state
  if (profiles.length === 0) {
    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <Text style={styles.emptyEmoji}>✨</Text>
        <Text style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>You're all caught up</Text>
        <Text style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>Check back soon — we'll bring you more people as they join.</Text>
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
  const cardTop = hideHeader ? 0 : insets.top + HEADER_H + (showNudge ? NUDGE_H : 0);
  const actionRowBottom = Math.max(insets.bottom, 12);
  // Leave room for the action bar so card content (bio) isn't hidden behind the buttons.
  const cardBottom = actionRowBottom + 72;

  const likesLeft = likesRemaining();
  const standOutsLeft = standOutsRemaining();

  return (
    <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
      {/* Compact Header */}
      {!hideHeader && (
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
      )}

      {/* Profile completeness nudge */}
      {showNudge && (
        <ProfileNudge
          message={NUDGE_MESSAGES[nudgeStatus as Exclude<typeof nudgeStatus, 'complete'>].discover}
          onDismiss={() => dismissNudge('discover')}
        />
      )}

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
              bio={next.bio}
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
              bio={current.bio}
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
          activeOpacity={0.7}
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
          activeOpacity={0.7}
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
          activeOpacity={0.7}
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
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: COLORS.text, marginBottom: 8, textAlign: "center" },
  emptySubtitle: { fontSize: 15, color: COLORS.textLight, textAlign: "center", lineHeight: 22 },

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
    width: 44,
    height: 44,
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
    top: 8,
    left: 10,
    right: 10,
    bottom: 8,
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
