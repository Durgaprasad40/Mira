/*
 * LOCKED (DISCOVER CARD STACK)
 * Shared production stack for Discover. When externalProfiles is provided,
 * caller order must be preserved so unified Discover Cards/Browse stay aligned.
 */
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
  InteractionManager,
  ScrollView,
  Modal,
  Easing,
} from "react-native";
import { LoadingGuard } from "@/components/safety";
import { useShallow } from "zustand/react/shallow";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS, INCOGNITO_COLORS, SWIPE_CONFIG } from "@/lib/constants";
import { PRIVATE_INTENT_CATEGORIES } from "@/lib/privateConstants";
import { getTrustBadges } from "@/lib/trustBadges";
import { useAuthStore } from "@/stores/authStore";
import { useDiscoverStore } from "@/stores/discoverStore";
import { useFilterStore } from "@/stores/filterStore";
import { ProfileCard, SwipeOverlay } from "@/components/cards";
import { isDemoMode } from "@/hooks/useConvex";
import { useNotifications } from "@/hooks/useNotifications";
import { DEMO_PROFILES, getDemoCurrentUser, DEMO_INCOGNITO_PROFILES } from "@/lib/demoData";
import { useDemoStore } from "@/stores/demoStore";
import { useBlockStore } from "@/stores/blockStore";
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
import { usePrivateChatStore } from "@/stores/privateChatStore";
import { NotificationPopover } from "@/components/discover/NotificationPopover";
import type { IncognitoConversation, ConnectionSource } from "@/types";
import type { Id } from "@/convex/_generated/dataModel";

import { markPhase2Matched } from "@/lib/phase2MatchSession";

// Type for swipe actions
type SwipeAction = 'like' | 'pass' | 'super_like';
import { log } from "@/utils/logger";

// Demo mode match rate (20% for realistic testing)
const DEMO_MATCH_RATE = 0.2;

/** Create Phase 2 private conversation for match. Returns true if new, false if duplicate. */
function handlePhase2Match(profile: { id: string; name: string; age?: number; photoUrl?: string }): boolean {
  // Check idempotency via shared session module
  if (!markPhase2Matched(profile.id)) {
    return false;
  }

  const conversationId = `ic_desire_${profile.id}`;
  const conversation: IncognitoConversation = {
    id: conversationId,
    participantId: profile.id,
    participantName: profile.name,
    participantAge: profile.age ?? 0,
    participantPhotoUrl: profile.photoUrl ?? '',
    lastMessage: 'Matched! Start chatting.',
    lastMessageAt: Date.now(),
    unreadCount: 0,
    connectionSource: 'desire' as ConnectionSource,
  };

  usePrivateChatStore.getState().createConversation(conversation);
  usePrivateChatStore.getState().unlockUser({
    id: profile.id,
    username: profile.name,
    photoUrl: profile.photoUrl ?? '',
    age: profile.age ?? 0,
    source: 'tod',
    unlockedAt: Date.now(),
  });

  log.info('[MATCH]', 'private', { name: profile.name });
  return true;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const EMPTY_ARRAY: any[] = [];

// ── Star-burst animation for super-like ──
const STAR_COUNT = 8;
const STAR_COLORS = ['#FFD700', '#FFA500', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];

interface StarBurstAnimationProps {
  visible: boolean;
  onComplete: () => void;
}

function StarBurstAnimation({ visible, onComplete }: StarBurstAnimationProps) {
  const animations = useRef(
    Array.from({ length: STAR_COUNT }, () => ({
      scale: new Animated.Value(0),
      opacity: new Animated.Value(1),
      translateX: new Animated.Value(0),
      translateY: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    if (!visible) return;

    // Reset all animations
    animations.forEach((anim) => {
      anim.scale.setValue(0);
      anim.opacity.setValue(1);
      anim.translateX.setValue(0);
      anim.translateY.setValue(0);
    });

    // Create staggered star burst
    const starAnimations = animations.map((anim, i) => {
      const angle = (i / STAR_COUNT) * 2 * Math.PI;
      const distance = 80 + Math.random() * 40; // Random distance 80-120
      const targetX = Math.cos(angle) * distance;
      const targetY = Math.sin(angle) * distance;

      return Animated.sequence([
        Animated.delay(i * 30), // Stagger each star
        Animated.parallel([
          Animated.timing(anim.scale, {
            toValue: 1,
            duration: 150,
            easing: Easing.out(Easing.back(2)),
            useNativeDriver: true,
          }),
          Animated.timing(anim.translateX, {
            toValue: targetX,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(anim.translateY, {
            toValue: targetY,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(200),
            Animated.timing(anim.opacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]);
    });

    const compositeAnimation = Animated.parallel(starAnimations);
    compositeAnimation.start(() => {
      onComplete();
    });

    // DL-014: Stop animation on unmount to prevent stale callback
    return () => {
      compositeAnimation.stop();
    };
  }, [visible, animations, onComplete]);

  if (!visible) return null;

  return (
    <View style={starBurstStyles.container} pointerEvents="none">
      {animations.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            starBurstStyles.star,
            {
              backgroundColor: STAR_COLORS[i % STAR_COLORS.length],
              opacity: anim.opacity,
              transform: [
                { translateX: anim.translateX },
                { translateY: anim.translateY },
                { scale: anim.scale },
                { rotate: `${(i * 45)}deg` },
              ],
            },
          ]}
        >
          <Ionicons name="star" size={24} color={STAR_COLORS[i % STAR_COLORS.length]} />
        </Animated.View>
      ))}
      {/* Center star pulse */}
      <Animated.View
        style={[
          starBurstStyles.centerStar,
          {
            opacity: animations[0].opacity,
            transform: [{ scale: animations[0].scale }],
          },
        ]}
      >
        <Ionicons name="star" size={48} color="#FFD700" />
      </Animated.View>
    </View>
  );
}

const starBurstStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  star: {
    position: 'absolute',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  centerStar: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const HEADER_H = 44;

export interface DiscoverCardStackProps {
  /** 'dark' applies INCOGNITO_COLORS to background/header only; card UI stays identical */
  theme?: "light" | "dark";
  /**
   * Phase context for match routing:
   * - 'phase1' (default): Match goes to match-celebration → Phase 1 messages
   * - 'phase2': Match creates Phase 2 private chat (no navigation, stays on Desire Land)
   */
  mode?: "phase1" | "phase2";
  /** When provided, skip internal Convex query and use these profiles instead (e.g. Explore category). */
  externalProfiles?: any[];
  /** Hide the built-in header (caller renders its own). */
  hideHeader?: boolean;
  /** Notify parent when a profile is acted on so sibling surfaces can stay in sync. */
  onProfileAction?: (profileId: string, action: SwipeAction) => void;
}

export function DiscoverCardStack({
  theme = "light",
  mode = "phase1",
  externalProfiles,
  hideHeader,
  onProfileAction,
}: DiscoverCardStackProps) {
  const dark = theme === "dark";
  const isPhase2 = mode === "phase2";
  const C = dark ? INCOGNITO_COLORS : COLORS;

  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const [index, setIndex] = useState(0);
  const [retryKey, setRetryKey] = useState(0); // For LoadingGuard retry
  const [showNotificationPopover, setShowNotificationPopover] = useState(false);

  // Random Match popup state (F2-D)
  const [showRandomMatchPopup, setShowRandomMatchPopup] = useState(false);
  const randomMatchPopupShownRef = useRef(false); // Anti-spam: one popup per component lifecycle
  const randomMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // DL-004: cleanup on unmount

  // Super-like star-burst animation state
  const [showSuperLikeAnimation, setShowSuperLikeAnimation] = useState(false);
  const clearSuperLikeAnimation = useCallback(() => setShowSuperLikeAnimation(false), []);

  // Phase-2 only: Intent filters from store (syncs with Discovery Preferences)
  const { privateIntentKeys: intentFilters, togglePrivateIntentKey, setPrivateIntentKeys } = useFilterStore();

  // P1-7 fix: Phase-1 filter preferences (age, gender, distance, sortBy)
  const { minAge, maxAge, maxDistance, gender: genderFilter, sortBy } = useFilterStore();

  // Daily limits — individual selectors to avoid full re-render on AsyncStorage hydration
  const likesRemaining = useDiscoverStore((s) => s.likesRemaining);
  const standOutsRemaining = useDiscoverStore((s) => s.standOutsRemaining);
  const hasReachedLikeLimit = useDiscoverStore((s) => s.hasReachedLikeLimit);
  const hasReachedStandOutLimit = useDiscoverStore((s) => s.hasReachedStandOutLimit);
  const incrementLikes = useDiscoverStore((s) => s.incrementLikes);
  const incrementStandOuts = useDiscoverStore((s) => s.incrementStandOuts);
  const checkAndResetIfNewDay = useDiscoverStore((s) => s.checkAndResetIfNewDay);
  // F2-A/F2-B: Random match control — swipe tracking + trigger entry point
  const incSwipe = useDiscoverStore((s) => s.incSwipe);
  const maybeTriggerRandomMatch = useDiscoverStore((s) => s.maybeTriggerRandomMatch);

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
  // ── Swipe lock: prevents re-entrant swipes while animation + processing is in flight ──
  // Acquired in animateSwipe, released after advanceCard + match logic complete.
  const swipeLockRef = useRef(false);

  // ── RACE CONDITION FIX: Swipe ID for deterministic lock ownership ──
  // Each swipe gets a unique ID. Only the callback holding the current ID can release the lock.
  // This prevents stale async callbacks (from animation, network, timeout) from releasing
  // a lock that belongs to a newer swipe.
  const swipeIdRef = useRef(0);

  /**
   * Acquire the swipe lock and return a unique swipe ID.
   * Only the holder of this ID should release the lock.
   */
  const acquireSwipeLock = useCallback((): number => {
    swipeIdRef.current += 1;
    swipeLockRef.current = true;
    return swipeIdRef.current;
  }, []);

  /**
   * Release the swipe lock ONLY if the provided ID matches the current swipe.
   * Stale callbacks (from interrupted animations, old network responses) will have
   * outdated IDs and their release attempts will be safely ignored.
   */
  const releaseSwipeLock = useCallback((id: number): void => {
    if (swipeIdRef.current === id) {
      swipeLockRef.current = false;
    }
    // else: stale callback from old swipe — ignore silently
  }, []);

  // ── Mounted guard: prevents state updates and navigation after unmount ──
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clean up locks so a future remount starts fresh
      navigatingRef.current = false;
      swipeLockRef.current = false;
      // DL-004: Clear random match timer on unmount
      if (randomMatchTimerRef.current) {
        clearTimeout(randomMatchTimerRef.current);
        randomMatchTimerRef.current = null;
      }
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

  // Demo store — single shallow selector to minimize re-renders.
  // Only subscribes to fields Discover actually needs; shallow compare
  // prevents re-renders when unrelated store slices change.
  const demo = useDemoStore(useShallow((s) => ({
    profiles: s.profiles,
    seed: s.seed,
    matchCount: s.matches.length,          // only need length for exclusion deps
    swipedCount: s.swipedProfileIds.length, // 3B-1: track swiped count for deps
    getExcludedUserIds: s.getExcludedUserIds,
    recordSwipe: s.recordSwipe,            // 3B-1: record swipes to prevent repeats
    hasHydrated: s._hasHydrated,           // FIX: track hydration for safe seeding
  })));
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);
  // R1 FIX: Derive excluded IDs with stable dependencies.
  // P1-003 FIX: Use blockedUserIds array (not .length) to detect content changes.
  // For demo mode, call getExcludedUserIds() inside the memo body — the function
  // itself is stable (from useShallow), and we trigger recalc via matchCount/swipedCount.
  const excludedSet = useMemo(() => {
    if (!isDemoMode) return new Set(blockedUserIds);
    // demo.getExcludedUserIds() reads current state inside the function
    return new Set(demo.getExcludedUserIds());
  }, [isDemoMode, blockedUserIds, demo.matchCount, demo.swipedCount, demo.getExcludedUserIds]);
  // FIX: Only seed after hydration completes to prevent overwriting persisted data
  useEffect(() => { if (isDemoMode && demo.hasHydrated) demo.seed(); }, [demo.seed, demo.hasHydrated]);

  // Profile data — memoize args to prevent Convex re-subscriptions
  const convexUserId = asUserId(userId);
  const skipInternalQuery = !!externalProfiles;
  // retryKey in deps forces re-evaluation on retry (even if args unchanged, Convex re-subscribes)
  const discoverArgs = useMemo(
    () =>
      !isDemoMode && convexUserId && !skipInternalQuery
        ? { userId: convexUserId, sortBy: (sortBy || "recommended") as any, limit: 20 }
        : "skip" as const,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convexUserId, skipInternalQuery, retryKey, sortBy],
  );
  const convexProfiles = useQuery(api.discover.getDiscoverProfiles, discoverArgs);
  const profilesSafe = convexProfiles ?? EMPTY_ARRAY;

  // CRITICAL: useMemo prevents new array/object references on every render.
  // Without this, DEMO_PROFILES.map() creates new objects each render,
  // which cascades: new current → new handleSwipe → new animateSwipe → new panResponder
  // → touches dropped between old/new panResponder attachment.
  const latestProfiles: ProfileData[] = useMemo(() => {
    if (externalProfiles) {
      // 3B-6: Filter excluded from external profiles for both demo and live mode
      // (blocked users, matched users, swiped users should not appear in explore categories)
      const filtered = externalProfiles.filter((p: any) => !excludedSet.has(p._id ?? p.id));
      // Preserve caller-provided order exactly. The unified Discover surface already
      // supplies a ranked list and both Cards/Browse must stay aligned.
      return filtered.map(toProfileData);
    }
    if (isDemoMode) {
      // Phase-2 demo mode: use DEMO_INCOGNITO_PROFILES (with privateIntentKeys)
      if (isPhase2) {
        const DEFAULT_INTENT_KEYS = ['go_with_the_flow'];
        return DEMO_INCOGNITO_PROFILES
          .filter((p) => !excludedSet.has(p.id))
          .map((p) => {
            // Resolve intent keys: privateIntentKeys > privateIntentKey > default
            const intentKeys = p.privateIntentKeys ??
              (p.privateIntentKey && p.privateIntentKey !== 'undefined' ? [p.privateIntentKey] : DEFAULT_INTENT_KEYS);
            // DEV assertion: warn if profile has no valid intent keys
            if (__DEV__ && (!intentKeys || intentKeys.length === 0)) {
              console.warn('[demo] Missing privateIntentKeys for', p.id);
            }
            return toProfileData({
              _id: p.id,
              name: p.username,
              age: p.age,
              bio: p.bio,
              city: p.city,
              distance: p.distance,
              isVerified: false,
              photos: (p.photos ?? [p.photoUrl]).map(url => ({ url })),
              activities: p.interests ?? p.hobbies ?? [],
              privateIntentKeys: intentKeys,
              privateIntentKey: intentKeys[0],
              lastActive: Date.now() - 2 * 60 * 60 * 1000,
              createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
            });
          });
      }
      // Phase-1 demo mode: use demo.profiles from demoStore
      // P1-7 fix: Apply filter preferences (age, gender, distance) to demo profiles
      // STEP 2.6: Demo-mode fallback — if < 5 profiles, progressively relax filters
      const MIN_DEMO_PROFILES = 5;
      const baseProfiles = demo.profiles.filter((p) => !excludedSet.has(p._id));

      // Helper to apply filters with optional relaxation
      const applyFilters = (profiles: typeof baseProfiles, relaxDistance: boolean, relaxGender: boolean, relaxAge: boolean) => {
        return profiles
          .filter((p) => {
            // Gender filter (relaxed if relaxGender=true)
            if (relaxGender || genderFilter.length === 0) return true;
            return genderFilter.includes(p.gender as any);
          })
          .filter((p) => {
            // Age filter (relaxed to 18-60 if relaxAge=true)
            const ageMin = relaxAge ? 18 : minAge;
            const ageMax = relaxAge ? 60 : maxAge;
            return p.age >= ageMin && p.age <= ageMax;
          })
          .filter((p) => {
            // Distance filter (relaxed if relaxDistance=true)
            if (relaxDistance) return true;
            return p.distance <= maxDistance;
          });
      };

      // Try with strict filters first
      let filtered = applyFilters(baseProfiles, false, false, false);

      // Fallback 1: Relax distance filter
      if (filtered.length < MIN_DEMO_PROFILES) {
        filtered = applyFilters(baseProfiles, true, false, false);
      }
      // Fallback 2: Also relax gender filter
      if (filtered.length < MIN_DEMO_PROFILES) {
        filtered = applyFilters(baseProfiles, true, true, false);
      }
      // Fallback 3: Also widen age range to 18-60
      if (filtered.length < MIN_DEMO_PROFILES) {
        filtered = applyFilters(baseProfiles, true, true, true);
      }

      return filtered.map((p) => toProfileData({
        ...p,
        lastActive: Date.now() - 2 * 60 * 60 * 1000,
        createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      }));
    }
    return rankProfiles(profilesSafe.map(toProfileData));
  }, [externalProfiles, profilesSafe, demo.profiles, excludedSet, isPhase2, genderFilter, minAge, maxAge, maxDistance]);

  // Drop profiles with no primary visual. Phase-1 still requires a real photo URL,
  // while Phase-2 can intentionally render a locked placeholder as the lead card.
  const validProfiles = useMemo(
    () =>
      latestProfiles.filter((p) => {
        const hasPrimaryPhotoUrl =
          typeof p.photos?.[0]?.url === "string" && p.photos[0].url.length > 0;
        const hasLockedPhase2Placeholder =
          isPhase2 &&
          p.photoBlurred === true &&
          (p.photos?.length ?? 0) > 0 &&
          p.photos[0]?.url === null;

        return hasPrimaryPhotoUrl || hasLockedPhase2Placeholder;
      }),
    [isPhase2, latestProfiles],
  );

  // Keep last non-empty profiles to prevent blank-frame flicker
  const stableProfilesRef = useRef<ProfileData[]>([]);
  // FIX: Track userId to invalidate cache when user changes (prevents showing stale profiles)
  const stableUserIdRef = useRef<string | null>(null);
  if (userId !== stableUserIdRef.current) {
    // User changed — clear stale cache to prevent showing old user's excluded profiles
    stableProfilesRef.current = [];
    stableUserIdRef.current = userId;
  }
  if (validProfiles.length > 0) {
    stableProfilesRef.current = validProfiles;
  }
  const profilesRaw = validProfiles.length > 0 ? validProfiles : stableProfilesRef.current;

  // FIX: Defensive filter — never show current user's profile in Discover
  // Backend already excludes, but this protects against stale cache contamination
  const profiles = useMemo(
    () => userId ? profilesRaw.filter((p) => p.id !== userId) : profilesRaw,
    [profilesRaw, userId],
  );

  // Phase-2 only: Filter profiles by intent categories (any match)
  const filteredProfiles = useMemo(() => {
    if (!isPhase2 || intentFilters.length === 0) return profiles;
    return profiles.filter((p) => {
      // Support: privateIntentKeys (new) > intentKeys > privateIntentKey (legacy)
      const profileKeys: string[] =
        p.privateIntentKeys ??
        (p as any).intentKeys ??
        (p.privateIntentKey ? [p.privateIntentKey] : []);
      // Match if any profile intent is in the filter set
      return profileKeys.some(k => intentFilters.includes(k));
    });
  }, [profiles, isPhase2, intentFilters]);

  // Reset index when filter changes (always show first matching profile)
  const prevFilterRef = useRef<string>(JSON.stringify([]));
  useEffect(() => {
    const filterKey = JSON.stringify(intentFilters);
    if (isPhase2 && prevFilterRef.current !== filterKey) {
      // DL-006: Skip index reset if swipe is in progress to prevent race condition
      if (!swipeLockRef.current) {
        setIndex(0);
        // Also reset queue when filter changes
        visibleQueueRef.current = [];
        consumedIdsRef.current.clear();
      }
      // Track Phase-2 intent filter selection (use first key for backward compat)
      trackEvent({ name: 'phase2_intent_filter_selected', intentKey: intentFilters[0] ?? 'all' });
      prevFilterRef.current = filterKey;
    }
  }, [intentFilters, isPhase2]);

  // ══════════════════════════════════════════════════════════════════════════
  // STABLE QUEUE MODEL: Prevents back card from changing during swipe animation
  // ══════════════════════════════════════════════════════════════════════════
  // The queue holds profile IDs for the visible cards (front, back, third).
  // It is "frozen" during swipe animation and only advances after swipe completion.
  // This ensures the back card remains stable even if source data changes mid-swipe.

  const QUEUE_SIZE = 3; // Number of cards to buffer
  const visibleQueueRef = useRef<string[]>([]); // Profile IDs in queue
  const consumedIdsRef = useRef<Set<string>>(new Set()); // Profiles already swiped

  // Source profiles for queue refill (use filtered for Phase-2, regular for Phase-1)
  const sourceProfiles = isPhase2 ? filteredProfiles : profiles;

  // Build a map from profile ID to profile data for O(1) lookup
  const profileMapRef = useRef<Map<string, ProfileData>>(new Map());
  useMemo(() => {
    profileMapRef.current.clear();
    for (const p of sourceProfiles) {
      profileMapRef.current.set(p.id, p);
    }
  }, [sourceProfiles]);

  /**
   * Refill the visible queue from source profiles.
   * Only adds profiles that are:
   * - Not already in the queue
   * - Not already consumed (swiped)
   * - Not the current user
   */
  const refillQueue = useCallback(() => {
    const queue = visibleQueueRef.current;
    const consumed = consumedIdsRef.current;
    const needed = QUEUE_SIZE - queue.length;
    if (needed <= 0) return;

    const queueSet = new Set(queue);
    const toAdd: string[] = [];

    for (const p of sourceProfiles) {
      if (toAdd.length >= needed) break;
      // Skip if already in queue, consumed, or is current user
      if (queueSet.has(p.id)) continue;
      if (consumed.has(p.id)) continue;
      if (p.id === userId) continue;
      toAdd.push(p.id);
    }

    if (toAdd.length > 0) {
      visibleQueueRef.current = [...queue, ...toAdd];
    }
  }, [sourceProfiles, userId]);

  /**
   * Advance the queue after swipe completion.
   * Removes the front card, marks it as consumed, and refills.
   */
  const advanceQueue = useCallback(() => {
    const queue = visibleQueueRef.current;
    if (queue.length === 0) return;

    // Mark front card as consumed
    const consumedId = queue[0];
    consumedIdsRef.current.add(consumedId);

    // Remove front card from queue
    visibleQueueRef.current = queue.slice(1);

    // Refill queue with next available profiles
    refillQueue();
  }, [refillQueue]);

  // Refill queue when source data changes AND no swipe is in progress
  // This ensures the queue is populated but doesn't change mid-swipe
  useEffect(() => {
    // Don't refill during active swipe
    if (swipeLockRef.current) return;
    refillQueue();
  }, [sourceProfiles, refillQueue]);

  // Reset queue when user changes (prevents showing stale profiles)
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== userId) {
      // User changed — clear queue and consumed IDs
      visibleQueueRef.current = [];
      consumedIdsRef.current.clear();
    }
    prevUserIdRef.current = userId;
  }, [userId]);

  // Get current/next from the STABLE QUEUE (not from live array indices)
  const currentQueueId = visibleQueueRef.current[0];
  const nextQueueId = visibleQueueRef.current[1];
  const queueCurrent = currentQueueId ? profileMapRef.current.get(currentQueueId) : undefined;
  const queueNext = nextQueueId ? profileMapRef.current.get(nextQueueId) : undefined;

  // ── Demo auto-replenish: re-inject profiles when pool is exhausted ──
  // Guard ref prevents the effect from firing twice before the store update
  // triggers a re-render with the new profiles.
  const replenishingRef = useRef(false);
  useEffect(() => {
    if (!isDemoMode || externalProfiles) return;
    if (profiles.length > 0) { replenishingRef.current = false; return; }
    if (replenishingRef.current) return;
    replenishingRef.current = true;
    try {
      useDemoStore.getState().resetDiscoverPool();
    } finally {
      // DL-016: Always reset ref after attempt to prevent stuck state
      replenishingRef.current = false;
    }
    // 7-3: Guard against setState after unmount
    if (!mountedRef.current) return;
    setIndex(0);
    // STABLE QUEUE: Reset queue when demo pool is replenished
    visibleQueueRef.current = [];
    consumedIdsRef.current.clear();
  }, [profiles.length, externalProfiles]);

  // Profile completeness nudge (main Discover only, not explore categories)
  const { dismissedNudges, dismissNudge } = useDemoStore(useShallow((s) => ({
    dismissedNudges: s.dismissedNudges,
    dismissNudge: s.dismissNudge,
  })));
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
  // Phase-2 only: Impression recording for ranking system
  const recordImpressionsMutation = useMutation(api.privateDiscover.recordDesireLandImpressions);

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
      swipeLockRef.current = false;
    } else {
      isFocusedRef.current = false;
      // RACE FIX: Increment swipeId to invalidate any in-flight async callbacks
      // from the previous focus session. Their releaseSwipeLock(oldId) calls will no-op.
      swipeIdRef.current += 1;
      swipeLockRef.current = false;
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

  // STABLE QUEUE: Use queue-based current/next instead of index-based access
  // This ensures the back card doesn't change during swipe animation
  const displayProfiles = isPhase2 ? filteredProfiles : profiles; // Keep for compatibility
  const current = queueCurrent; // From stable queue
  const next = queueNext; // From stable queue

  // Trust badges — memoized per profile to avoid allocation each render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const currentBadges = useMemo(
    () => current ? getTrustBadges({ isVerified: current.isVerified, lastActive: current.lastActive, photoCount: current.photos?.length, bio: current.bio }) : [],
    [current?.id],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nextBadges = useMemo(
    () => next ? getTrustBadges({ isVerified: next.isVerified, lastActive: next.lastActive, photoCount: next.photos?.length, bio: next.bio }) : [],
    [next?.id],
  );

  // Phase-2 only: Track profile views when card is shown
  const trackedProfileRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPhase2 || !current) return;
    // Only track once per profile (avoid re-tracking on re-renders)
    if (trackedProfileRef.current === current.id) return;
    trackedProfileRef.current = current.id;
    // Resolve intent keys: privateIntentKeys > intentKeys > privateIntentKey > default
    const DEFAULT_INTENT_KEY = 'go_with_the_flow';
    const intentKeys: string[] =
      current.privateIntentKeys ??
      (current as any).intentKeys ??
      (current.privateIntentKey && current.privateIntentKey !== 'undefined' ? [current.privateIntentKey] : [DEFAULT_INTENT_KEY]);
    trackEvent({
      name: 'phase2_profile_viewed',
      profileId: current.id,
      privateIntentKey: intentKeys[0] ?? DEFAULT_INTENT_KEY, // Never send undefined
    });
  }, [isPhase2, current?.id]);

  // Phase-2 only: Record impressions for ranking system (fire-and-forget)
  // Guard: track which profile batch was recorded to avoid duplicate calls on rerender
  const recordedImpressionSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    // Only for Phase-2, non-demo mode, with valid profiles
    if (!isPhase2 || isDemoMode || displayProfiles.length === 0 || !userId) return;

    // Build a signature of the current batch (sorted user IDs joined)
    // Using userId ?? id to handle both Phase-2 (userId) and Phase-1 (id = userId) shapes
    const userIds = displayProfiles
      .map((p) => (p.userId ?? p.id) as string)
      .filter(Boolean)
      .sort()
      .join(',');

    // Skip if already recorded this exact batch
    if (recordedImpressionSignatureRef.current === userIds) return;
    recordedImpressionSignatureRef.current = userIds;

    // Fire-and-forget: record impressions for displayed profiles
    const viewedUserIds = displayProfiles
      .map((p) => p.userId ?? p.id)
      .filter(Boolean) as Id<'users'>[];

    // DL-007: Batch into chunks of 10 to reduce backend load
    const BATCH_SIZE = 10;
    for (let i = 0; i < viewedUserIds.length; i += BATCH_SIZE) {
      const batch = viewedUserIds.slice(i, i + BATCH_SIZE);
      if (batch.length > 0) {
        recordImpressionsMutation({
          viewedUserIds: batch,
        }).catch(() => {
          // Silently ignore errors - impression recording is non-critical
        });
      }
    }
  }, [isPhase2, displayProfiles, userId, recordImpressionsMutation]);

  // Stable refs for panResponder callbacks — prevents panResponder recreation
  // when current/handleSwipe/animateSwipe change between renders.
  const currentRef = useRef(current);
  currentRef.current = current;

  // Stable callback for opening profile — uses ref so it never changes identity
  // Both Phase-1 and Phase-2 use the same route for viewing OTHER users' profiles
  // (private-profile is only for your OWN Phase-2 tab, not for viewing others)
  // Pass mode param so profile view can show Phase-2 specific content
  const openProfileCb = useCallback(() => {
    const c = currentRef.current;
    if (!c) return;
    if (isPhase2) {
      // Phase-2: pass mode (intentKeys are read from profile in the detail view)
      router.push(`/(main)/profile/${c.id}?mode=phase2` as any);
    } else {
      // Phase-1: no params needed
      router.push(`/(main)/profile/${c.id}` as any);
    }
  }, [isPhase2]);

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
    // STABLE QUEUE: Advance the queue after swipe
    // This removes front card, promotes back -> front, and refills from source
    advanceQueue();
    // Old pan is reset in the useEffect below, AFTER React has re-rendered
    // with the new activeSlot. This prevents a 1-frame flicker where the
    // swiped-away card snaps back to center before the slot switch renders.
  }, [panA, panB, overlayOpacityAnim, advanceQueue]);

  // Reset the now-inactive pan AFTER React commits the new activeSlot.
  // This avoids the race where requestAnimationFrame fires before the
  // batched state update, causing the old card to flash at center.
  useEffect(() => {
    const oldPan = activeSlot === 0 ? panB : panA;
    oldPan.setValue({ x: 0, y: 0 });
  }, [activeSlot, panA, panB]);

  const handleSwipe = useCallback(
    async (direction: "left" | "right" | "up", message?: string, swipeId?: number) => {
      // RACE FIX: Use provided swipeId, or current if not provided (backward compat)
      const activeSwipeId = swipeId ?? swipeIdRef.current;

      // Guard: unmounted or unfocused
      if (!mountedRef.current || !isFocusedRef.current) { releaseSwipeLock(activeSwipeId); return; }
      // Guard: navigation in progress
      if (navigatingRef.current) { releaseSwipeLock(activeSwipeId); return; }

      // Read the swiped profile from ref (stable, not from closure)
      const swipedProfile = currentRef.current;
      if (!swipedProfile) { releaseSwipeLock(activeSwipeId); return; }


      // Check daily limits — release lock and bail without advancing
      if (direction === "right" && hasReachedLikeLimit()) { releaseSwipeLock(activeSwipeId); return; }
      if (direction === "up" && hasReachedStandOutLimit()) { releaseSwipeLock(activeSwipeId); return; }
      const action: SwipeAction =
        direction === "left" ? "pass" : direction === "up" ? "super_like" : "like";

      // ★ ALWAYS advance card FIRST — this guarantees the index moves
      // regardless of match/navigation/error below.
      advanceCard();
      onProfileAction?.(swipedProfile.id, action);

      // F2-A: Track swipe for random match control
      incSwipe();

      // F2-D: Random match popup trigger (Option C: only on positive interaction)
      // Only trigger on like (right) or super_like (up), NOT on pass (left)
      if ((direction === "right" || direction === "up") && !randomMatchPopupShownRef.current) {
        const shouldTriggerRandomMatch = maybeTriggerRandomMatch();
        if (shouldTriggerRandomMatch && mountedRef.current && isFocusedRef.current) {
          // Anti-spam: mark as shown in this component lifecycle
          randomMatchPopupShownRef.current = true;
          // DL-004: Clear any existing timer before scheduling new one
          if (randomMatchTimerRef.current) {
            clearTimeout(randomMatchTimerRef.current);
          }
          // Defer popup slightly to let swipe animation complete
          randomMatchTimerRef.current = setTimeout(() => {
            randomMatchTimerRef.current = null;
            if (mountedRef.current && isFocusedRef.current) {
              setShowRandomMatchPopup(true);
              if (__DEV__) console.log('[F2-D] Random match popup shown');
            }
          }, 400);
        }
      }

      // Increment daily counters
      if (direction === "right") incrementLikes();
      if (direction === "up") incrementStandOuts();

      try {
        if (isDemoMode) {
          // 3B-1: Record swipe to prevent profile from reappearing
          demo.recordSwipe(swipedProfile.id);

          // Match probability: DEMO_MATCH_RATE (20% for realistic testing)
          const shouldMatch = direction === "right" && Math.random() < DEMO_MATCH_RATE;

          if (shouldMatch) {
            if (isPhase2) {
              // Phase 2: Create private conversation, NO navigation (stay on Desire Land)
              const isNewMatch = handlePhase2Match({
                id: swipedProfile.id,
                name: swipedProfile.name,
                age: swipedProfile.age,
                photoUrl: swipedProfile.photos?.[0]?.url ?? undefined,
              });
              if (isNewMatch) {
                log.info('[MATCH]', 'phase2', { name: swipedProfile.name });
                trackEvent({ name: 'match_created', otherUserId: swipedProfile.id });
              }
              releaseSwipeLock(activeSwipeId);
              return;
            }

            // Phase 1: Save match + DM thread BEFORE navigating.
            useDemoStore.getState().simulateMatch(swipedProfile.id);
            const matchId = `match_${swipedProfile.id}`;
            navigatingRef.current = true;
            // Defer navigation so advanceCard's setState commits first
            // RACE FIX: Capture swipeId in closure so deferred callback releases correct lock
            const deferredSwipeId = activeSwipeId;
            InteractionManager.runAfterInteractions(() => {
              if (!mountedRef.current || !isFocusedRef.current) {
                releaseSwipeLock(deferredSwipeId);
                return;
              }
              // CRASH FIX: Guard against stale swipedProfile in deferred callback
              if (!swipedProfile?.id) {
                releaseSwipeLock(deferredSwipeId);
                navigatingRef.current = false;
                return;
              }
              try {
                trackEvent({ name: 'match_created', matchId, otherUserId: swipedProfile.id });
                router.push(`/(main)/match-celebration?matchId=${matchId}&userId=${swipedProfile.id}` as any);
              } catch {
                navigatingRef.current = false;
              } finally {
                releaseSwipeLock(deferredSwipeId);
              }
            });
            return;
          }
          // Release swipe lock (navigatingRef guards further swipes if navigating)
          releaseSwipeLock(activeSwipeId);
          return;
        }

        if (!convexUserId) { releaseSwipeLock(activeSwipeId); return; }
        // B5 fix: wrap mutation in Promise.race with 6s timeout to prevent stuck swipe lock
        const SWIPE_TIMEOUT_MS = 6000;
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("Swipe timed out")), SWIPE_TIMEOUT_MS)
        );
        const result = await Promise.race([
          swipeMutation({
            token: token!,
            toUserId: swipedProfile.id as Id<'users'>,
            action,
            message: message,
          }),
          timeoutPromise,
        ]);

        // Guard: check mounted/focused before navigating on match
        if (!mountedRef.current || !isFocusedRef.current) return;
        if (result?.isMatch && !navigatingRef.current) {
          // DL-001 FIX: Phase-2 matches stay on Desire Land, no navigation
          if (isPhase2) {
            const isNewMatch = handlePhase2Match({
              id: swipedProfile.id,
              name: swipedProfile.name,
              age: swipedProfile.age,
              photoUrl: swipedProfile.photos?.[0]?.url ?? undefined,
            });
            if (isNewMatch) {
              trackEvent({ name: 'match_created', otherUserId: swipedProfile.id });
            }
            releaseSwipeLock(activeSwipeId);
            return;
          }

          // Phase-1: Navigate to match-celebration
          navigatingRef.current = true;
          // B6 fix: wrap navigation in try/catch and reset navigatingRef on failure
          // 3B-4: Defer swipe lock release until after navigation initiated
          // RACE FIX: Capture swipeId in closure so deferred callback releases correct lock
          const deferredSwipeId = activeSwipeId;
          InteractionManager.runAfterInteractions(() => {
            if (!mountedRef.current || !isFocusedRef.current) {
              releaseSwipeLock(deferredSwipeId);
              return;
            }
            // CRASH FIX: Guard against stale swipedProfile/result in deferred callback
            if (!swipedProfile?.id || !result?.matchId) {
              releaseSwipeLock(deferredSwipeId);
              navigatingRef.current = false;
              return;
            }
            try {
              trackEvent({ name: 'match_created', matchId: result.matchId, otherUserId: swipedProfile.id });
              router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${swipedProfile.id}`);
            } catch {
              navigatingRef.current = false;
            } finally {
              releaseSwipeLock(deferredSwipeId);
            }
          });
          return; // 3B-4: Don't release lock in outer finally; deferred to callback
        }
      } catch (error: any) {
        if (!mountedRef.current) return;
        // DL-003: Don't show error toast for timeout - card already advanced and swipe likely recorded server-side
        const isTimeout = error?.message === "Swipe timed out";
        if (!isTimeout) {
          Toast.show("Something went wrong. Please try again.");
        }
      } finally {
        releaseSwipeLock(activeSwipeId);
      }
    },
    [convexUserId, swipeMutation, advanceCard, hasReachedLikeLimit, hasReachedStandOutLimit, incrementLikes, incrementStandOuts, demo.recordSwipe, incSwipe, maybeTriggerRandomMatch, onProfileAction, releaseSwipeLock],
  );

  const animateSwipe = useCallback(
    (direction: "left" | "right" | "up", velocity?: number) => {
      // Guard: don't start new animations if navigating, unfocused, or already swiping
      if (navigatingRef.current || !isFocusedRef.current) return;
      if (swipeLockRef.current) return;
      // Check limits before animating
      if (direction === "right" && hasReachedLikeLimit()) return;
      if (direction === "up" && hasReachedStandOutLimit()) return;

      // ★ RACE FIX: Acquire swipe lock and capture unique ID for this swipe lifecycle
      const swipeId = acquireSwipeLock();

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
        if (!finished) {
          // Animation was interrupted (blur/unmount) — release lock only if we still own it
          releaseSwipeLock(swipeId);
          return;
        }
        // B4 fix: guard against unmount before calling handleSwipe
        // DL-005: Also guard against focus loss during animation
        if (!mountedRef.current || !isFocusedRef.current) {
          releaseSwipeLock(swipeId);
          return;
        }
        // Pass swipeId to handleSwipe so it can release the correct lock
        handleSwipeRef.current(direction, undefined, swipeId);
      });
    },
    [panA, panB, overlayOpacityAnim, hasReachedLikeLimit, hasReachedStandOutLimit, acquireSwipeLock, releaseSwipeLock],
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
          // Don't claim touches if navigating, unfocused, or swipe in flight
          if (navigatingRef.current || !isFocusedRef.current || swipeLockRef.current) return false;
          return Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8;
        },
        // Allow other responders (e.g. tab bar) to take over
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: () => {},
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
          // If screen lost focus during drag, or swipe already in flight, just reset
          if (navigatingRef.current || !isFocusedRef.current || swipeLockRef.current) { resetPosition(); return; }
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
  // NOTE: We do NOT check isFocusedRef here because the stand-out flow is user-initiated
  // from a modal overlay. When router.back() is called, the focus state updates asynchronously
  // but the standOutResult is set synchronously. We must process it regardless of focus timing.
  useEffect(() => {
    if (!standOutResult || !currentRef.current) return;
    if (!mountedRef.current) return;
    if (swipeLockRef.current) return;

    // CORRECTNESS FIX: Validate that standOutResult.profileId matches current profile
    // This prevents sending the message to a different profile if the deck changed
    if (standOutResult.profileId !== currentRef.current.id) {
      if (__DEV__) console.log('[StandOut] Profile mismatch - clearing stale result', {
        resultId: standOutResult.profileId,
        currentId: currentRef.current.id,
      });
      useInteractionStore.getState().setStandOutResult(null);
      return;
    }

    useInteractionStore.getState().setStandOutResult(null);
    const msg = standOutResult.message;

    // ★ RACE FIX: Acquire swipe lock and capture unique ID for this stand-out lifecycle
    const swipeId = acquireSwipeLock();

    // ★ Trigger star-burst animation for super-like
    setShowSuperLikeAnimation(true);

    // Animate the card out (up direction)
    const currentPan = getActivePan();
    const targetY = -SCREEN_HEIGHT * 1.5;

    setOverlayDirection("up");
    overlayOpacityAnim.setValue(1);

    const anim = Animated.timing(currentPan.y, { toValue: targetY, duration: 250, useNativeDriver: true });
    activeAnimationRef.current = anim;
    anim.start(({ finished }) => {
      activeAnimationRef.current = null;
      if (!finished) {
        releaseSwipeLock(swipeId);
        return;
      }
      if (!mountedRef.current || !isFocusedRef.current) {
        releaseSwipeLock(swipeId);
        return;
      }
      // Pass swipeId to handleSwipe so it can release the correct lock
      handleSwipeRef.current("up", msg || undefined, swipeId);
    });
  }, [standOutResult, acquireSwipeLock, releaseSwipeLock]);

  // Loading state — non-demo only; skip when using external profiles
  const isDiscoverLoading = !isDemoMode && !externalProfiles && !convexProfiles;
  if (isDiscoverLoading) {
    return (
      <LoadingGuard
        isLoading={true}
        onRetry={() => setRetryKey((k) => k + 1)}
        title="Finding people for you…"
        subtitle="This is taking longer than expected. Check your connection and try again."
      >
        <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[styles.loadingText, dark && { color: INCOGNITO_COLORS.textLight }]}>Finding people for you...</Text>
        </View>
      </LoadingGuard>
    );
  }

  // Empty state (no profiles at all)
  if (profiles.length === 0) {
    // STEP 2.7: Demo-only reset that clears swipedProfileIds + re-injects profiles
    const handleResetDemoSwipes = () => {
      if (isDemoMode) {
        // DL-009: Use safe store action instead of direct setState
        useDemoStore.getState().clearSwipedProfiles();
        useDemoStore.getState().resetDiscoverPool();
        setIndex(0);
      }
    };

    return (
      <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        {/* Header - always visible even when feed is empty */}
        {!hideHeader && (
          <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}>
              <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
            </TouchableOpacity>
            <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
            {!isPhase2 ? (
              <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNotificationPopover(true)}>
                <Ionicons name="notifications-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
                {unseenCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.headerBtn} />
            )}
          </View>
        )}
        <View style={[styles.center, { flex: 1 }]}>
          <Text style={styles.emptyEmoji}>✨</Text>
          <Text style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>No more profiles right now</Text>
          <Text style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>
            {isDemoMode
              ? "You may have swiped through the demo deck or your filters are strict."
              : "Check back soon — we'll bring you more people as they join."}
          </Text>
          {isDemoMode && (
            <>
              <TouchableOpacity
                style={[styles.resetButton, { marginTop: 24 }]}
                onPress={handleResetDemoSwipes}
              >
                <Ionicons name="refresh" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.resetButtonText}>Reset Demo Swipes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { marginTop: 12 }]}
                onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: 'phase1' } } as any)}
              >
                <Ionicons name="options-outline" size={18} color={C.primary} style={{ marginRight: 8 }} />
                <Text style={[styles.secondaryButtonText, { color: C.primary }]}>Open Filters</Text>
              </TouchableOpacity>
              <Text style={[styles.tipText, dark && { color: INCOGNITO_COLORS.textLight }]}>
                Tip: Set distance 200+ km and age 18–60 to see more.
              </Text>
            </>
          )}
        </View>
        {/* Notification Popover */}
        <NotificationPopover
          visible={showNotificationPopover}
          onClose={() => setShowNotificationPopover(false)}
          anchorTop={insets.top + HEADER_H + 8}
        />
      </View>
    );
  }

  // Phase-2: Filter results in no matches
  if (isPhase2 && intentFilters.length > 0 && filteredProfiles.length === 0) {
    const filterLabels = intentFilters
      .map(k => PRIVATE_INTENT_CATEGORIES.find((c) => c.key === k)?.label ?? k)
      .join(', ');
    return (
      <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        {/* Header - always visible even when feed is empty */}
        {!hideHeader && (
          <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}>
              <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
            </TouchableOpacity>
            <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
            <View style={styles.headerBtn} />
          </View>
        )}
        <View style={[styles.center, { flex: 1 }]}>
          <Text style={styles.emptyEmoji}>🔍</Text>
          <Text style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>No matching profiles</Text>
          <Text style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>
            No profiles match "{filterLabels}". Try different intents or clear filters.
          </Text>
          <TouchableOpacity
            style={[styles.resetButton, { marginTop: 24 }]}
            onPress={() => setPrivateIntentKeys([])}
          >
            <Ionicons name="funnel-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.resetButtonText}>Show All</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Deck exhausted state (swiped through all profiles)
  if (!current) {
    // STEP 2.7: Demo-only reset that clears swipedProfileIds + re-injects profiles
    const handleResetDeck = () => {
      if (isDemoMode) {
        // DL-009: Use safe store action instead of direct setState
        useDemoStore.getState().clearSwipedProfiles();
        useDemoStore.getState().resetDiscoverPool();
        setIndex(0);
      }
    };

    return (
      <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        {/* Header - always visible even when feed is empty */}
        {!hideHeader && (
          <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}>
              <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
            </TouchableOpacity>
            <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
            {!isPhase2 ? (
              <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNotificationPopover(true)}>
                <Ionicons name="notifications-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
                {unseenCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.headerBtn} />
            )}
          </View>
        )}
        <View style={[styles.center, { flex: 1 }]}>
          <Text style={styles.emptyEmoji}>🎉</Text>
          <Text style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>No more profiles</Text>
          <Text style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>
            {isDemoMode
              ? "You've swiped through the demo deck. Reset to see everyone again!"
              : "You've seen everyone available right now."}
          </Text>
          {isDemoMode && (
            <>
              <TouchableOpacity
                style={[styles.resetButton, { marginTop: 24 }]}
                onPress={handleResetDeck}
              >
                <Ionicons name="refresh" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.resetButtonText}>Reset Demo Deck</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { marginTop: 12 }]}
                onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: 'phase1' } } as any)}
              >
                <Ionicons name="options-outline" size={18} color={C.primary} style={{ marginRight: 8 }} />
                <Text style={[styles.secondaryButtonText, { color: C.primary }]}>Open Filters</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        {/* Notification Popover */}
        <NotificationPopover
          visible={showNotificationPopover}
          onClose={() => setShowNotificationPopover(false)}
          anchorTop={insets.top + HEADER_H + 8}
        />
      </View>
    );
  }

  // Daily like limit reached state
  if (hasReachedLikeLimit()) {
    return (
      <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}>
            <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          </TouchableOpacity>
          <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
          {/* Hide bell in Phase 2 — notifications are Phase 1 only */}
          {!isPhase2 ? (
            <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNotificationPopover(true)}>
              <Ionicons name="notifications-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
              {unseenCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.headerBtn} />
          )}
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
        {/* Notification Popover */}
        <NotificationPopover
          visible={showNotificationPopover}
          onClose={() => setShowNotificationPopover(false)}
          anchorTop={insets.top + HEADER_H + 8}
        />
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
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}>
            <Ionicons name="options-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          </TouchableOpacity>
          <Text style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
          {/* Hide bell in Phase 2 — notifications are Phase 1 only */}
          {!isPhase2 ? (
            <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNotificationPopover(true)}>
              <Ionicons name="notifications-outline" size={22} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
              {unseenCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.headerBtn} />
          )}
        </View>
      )}


      {/* Profile completeness nudge */}
      {/* DL-015: Runtime guard with optional chaining for safety */}
      {showNudge && NUDGE_MESSAGES[nudgeStatus]?.discover && (
        <ProfileNudge
          message={NUDGE_MESSAGES[nudgeStatus].discover}
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
              ageHidden={next.ageHidden}
              bio={next.bio}
              city={next.city}
              isVerified={next.isVerified}
              distance={next.distance}
              distanceHidden={next.distanceHidden}
              photos={next.photos}
              photoBlurred={next.photoBlurred === true}
              trustBadges={nextBadges}
              profilePrompt={next.profilePrompts?.[0]}
              theme={isPhase2 ? "dark" : "light"}
              privateIntentKeys={next.privateIntentKeys ?? (next as any).intentKeys ?? (next.privateIntentKey ? [next.privateIntentKey] : [])}
              isIncognito={next.isIncognito}
            />
          </Animated.View>
        )}
        {/* Top card */}
        {current && (
          <Animated.View style={[styles.card, { zIndex: 1 }, cardStyle]} {...panResponder.panHandlers}>
            <ProfileCard
              name={current.name}
              age={current.age}
              ageHidden={current.ageHidden}
              bio={current.bio}
              city={current.city}
              isVerified={current.isVerified}
              distance={current.distance}
              distanceHidden={current.distanceHidden}
              photos={current.photos}
              photoBlurred={current.photoBlurred === true}
              trustBadges={currentBadges}
              profilePrompt={current.profilePrompts?.[0]}
              showCarousel
              onOpenProfile={openProfileCb}
              theme={isPhase2 ? "dark" : "light"}
              privateIntentKeys={current.privateIntentKeys ?? (current as any).intentKeys ?? (current.privateIntentKey ? [current.privateIntentKey] : [])}
              isIncognito={current.isIncognito}
            />
            <SwipeOverlay direction={overlayDirection} opacity={overlayOpacityAnim} />
          </Animated.View>
        )}

        {/* Super-like star-burst animation */}
        <StarBurstAnimation visible={showSuperLikeAnimation} onComplete={clearSuperLikeAnimation} />
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

      {/* Notification Popover */}
      <NotificationPopover
        visible={showNotificationPopover}
        onClose={() => setShowNotificationPopover(false)}
        anchorTop={insets.top + HEADER_H + 8}
      />

      {/* Random Match Popup (F2-D) */}
      <Modal
        visible={showRandomMatchPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRandomMatchPopup(false)}
      >
        <View style={styles.randomMatchOverlay}>
          <View style={styles.randomMatchPopup}>
            {/* Sparkle icon */}
            <View style={styles.randomMatchIconWrap}>
              <Ionicons name="sparkles" size={48} color={COLORS.primary} />
            </View>

            {/* Title */}
            <Text style={styles.randomMatchTitle}>Someone&apos;s interested!</Text>

            {/* Subtitle */}
            <Text style={styles.randomMatchSubtitle}>
              A match is waiting for you. Would you like to see who liked you?
            </Text>

            {/* Primary CTA */}
            <TouchableOpacity
              style={styles.randomMatchCta}
              onPress={() => {
                setShowRandomMatchPopup(false);
                // Navigate to likes screen to see who liked them
                router.push("/(main)/likes" as any);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="heart" size={20} color={COLORS.white} style={{ marginRight: 8 }} />
              <Text style={styles.randomMatchCtaText}>See Who Liked Me</Text>
            </TouchableOpacity>

            {/* Dismiss */}
            <TouchableOpacity
              style={styles.randomMatchDismiss}
              onPress={() => setShowRandomMatchPopup(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.randomMatchDismissText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.white,
  },
  // STEP 2.7: Empty state secondary button styles
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  tipText: {
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: "center",
    marginTop: 20,
    paddingHorizontal: 32,
    lineHeight: 18,
  },

  // Random Match Popup (F2-D)
  randomMatchOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  randomMatchPopup: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  randomMatchIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: `${COLORS.primary}15`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  randomMatchTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 12,
    textAlign: "center",
  },
  randomMatchSubtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 28,
  },
  randomMatchCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 28,
    width: "100%",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  randomMatchCtaText: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.white,
  },
  randomMatchDismiss: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  randomMatchDismissText: {
    fontSize: 15,
    fontWeight: "500",
    color: COLORS.textLight,
  },
});
