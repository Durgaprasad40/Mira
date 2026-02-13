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
import type { IncognitoConversation, ConnectionSource } from "@/types";

import { markPhase2Matched } from "@/lib/phase2MatchSession";
import { log } from "@/utils/logger";

// DEV-only match rate for demo mode (80% for fast testing, 30% for prod)
const DEMO_MATCH_RATE = __DEV__ ? 0.8 : 0.3;

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
}

export function DiscoverCardStack({ theme = "light", mode = "phase1", externalProfiles, hideHeader }: DiscoverCardStackProps) {
  const dark = theme === "dark";
  const isPhase2 = mode === "phase2";
  const C = dark ? INCOGNITO_COLORS : COLORS;

  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const [index, setIndex] = useState(0);
  const [retryKey, setRetryKey] = useState(0); // For LoadingGuard retry

  // Phase-2 only: Intent filters from store (syncs with Discovery Preferences)
  const { privateIntentKeys: intentFilters, togglePrivateIntentKey, setPrivateIntentKeys } = useFilterStore();

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
  // ── Swipe lock: prevents re-entrant swipes while animation + processing is in flight ──
  // Acquired in animateSwipe, released after advanceCard + match logic complete.
  const swipeLockRef = useRef(false);

  // ── Mounted guard: prevents state updates and navigation after unmount ──
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clean up locks so a future remount starts fresh
      navigatingRef.current = false;
      swipeLockRef.current = false;
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
    blockedUserIds: s.blockedUserIds,
    matchCount: s.matches.length,          // only need length for exclusion deps
    swipedCount: s.swipedProfileIds.length, // 3B-1: track swiped count for deps
    getExcludedUserIds: s.getExcludedUserIds,
    recordSwipe: s.recordSwipe,            // 3B-1: record swipes to prevent repeats
    hasHydrated: s._hasHydrated,           // FIX: track hydration for safe seeding
  })));
  // Derive excluded IDs as a Set for O(1) lookup in filters.
  // 3B-1: Deps now include swipedCount so excludedSet updates after each swipe
  const excludedSet = useMemo(() => {
    if (!isDemoMode) return new Set(demo.blockedUserIds);
    return new Set(demo.getExcludedUserIds());
  }, [demo.blockedUserIds, demo.matchCount, demo.swipedCount, demo.getExcludedUserIds]);
  // FIX: Only seed after hydration completes to prevent overwriting persisted data
  useEffect(() => { if (isDemoMode && demo.hasHydrated) demo.seed(); }, [demo.seed, demo.hasHydrated]);

  // Profile data — memoize args to prevent Convex re-subscriptions
  const convexUserId = asUserId(userId);
  const skipInternalQuery = !!externalProfiles;
  // retryKey in deps forces re-evaluation on retry (even if args unchanged, Convex re-subscribes)
  const discoverArgs = useMemo(
    () =>
      !isDemoMode && convexUserId && !skipInternalQuery
        ? { userId: convexUserId, sortBy: "recommended" as any, limit: 20 }
        : "skip" as const,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convexUserId, skipInternalQuery, retryKey],
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
      const mapped = filtered.map(toProfileData);
      // Demo mode: preserve array order for deterministic Discover feed
      return isDemoMode ? mapped : rankProfiles(mapped);
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
      return demo.profiles
        .filter((p) => !excludedSet.has(p._id))
        .map((p) => toProfileData({
          ...p,
          lastActive: Date.now() - 2 * 60 * 60 * 1000,
          createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
        }));
    }
    return rankProfiles(profilesSafe.map(toProfileData));
  }, [externalProfiles, profilesSafe, demo.profiles, excludedSet, isPhase2]);

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
      setIndex(0);
      // Track Phase-2 intent filter selection (use first key for backward compat)
      trackEvent({ name: 'phase2_intent_filter_selected', intentKey: intentFilters[0] ?? 'all' });
      prevFilterRef.current = filterKey;
    }
  }, [intentFilters, isPhase2]);

  // ── Demo auto-replenish: re-inject profiles when pool is exhausted ──
  // Guard ref prevents the effect from firing twice before the store update
  // triggers a re-render with the new profiles.
  const replenishingRef = useRef(false);
  useEffect(() => {
    if (!isDemoMode || externalProfiles) return;
    if (profiles.length > 0) { replenishingRef.current = false; return; }
    if (replenishingRef.current) return;
    replenishingRef.current = true;
    useDemoStore.getState().resetDiscoverPool();
    // 7-3: Guard against setState after unmount
    if (!mountedRef.current) return;
    setIndex(0);
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

  // Strict bounds: no modulo wrapping — when deck exhausted, current becomes undefined
  // Phase-2: Use filteredProfiles when intent filter is active
  const displayProfiles = isPhase2 ? filteredProfiles : profiles;
  const current = index < displayProfiles.length ? displayProfiles[index] : undefined;
  const next = index + 1 < displayProfiles.length ? displayProfiles[index + 1] : undefined;

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
      if (!mountedRef.current || !isFocusedRef.current) { swipeLockRef.current = false; return; }
      // Guard: navigation in progress
      if (navigatingRef.current) { swipeLockRef.current = false; return; }

      // Read the swiped profile from ref (stable, not from closure)
      const swipedProfile = currentRef.current;
      if (!swipedProfile) { swipeLockRef.current = false; return; }


      // Check daily limits — release lock and bail without advancing
      if (direction === "right" && hasReachedLikeLimit()) { swipeLockRef.current = false; return; }
      if (direction === "up" && hasReachedStandOutLimit()) { swipeLockRef.current = false; return; }

      // ★ ALWAYS advance card FIRST — this guarantees the index moves
      // regardless of match/navigation/error below.
      advanceCard();

      // Increment daily counters
      if (direction === "right") incrementLikes();
      if (direction === "up") incrementStandOuts();

      try {
        if (isDemoMode) {
          // 3B-1: Record swipe to prevent profile from reappearing
          demo.recordSwipe(swipedProfile.id);

          // Match probability: DEMO_MATCH_RATE (50% in DEV, 30% in prod)
          const shouldMatch = direction === "right" && Math.random() < DEMO_MATCH_RATE;

          if (shouldMatch) {
            if (isPhase2) {
              // Phase 2: Create private conversation, NO navigation (stay on Desire Land)
              const isNewMatch = handlePhase2Match({
                id: swipedProfile.id,
                name: swipedProfile.name,
                age: swipedProfile.age,
                photoUrl: swipedProfile.photos[0]?.url,
              });
              if (isNewMatch) {
                log.info('[MATCH]', 'phase2', { name: swipedProfile.name });
                trackEvent({ name: 'match_created', otherUserId: swipedProfile.id });
              }
              swipeLockRef.current = false;
              return;
            }

            // Phase 1: Save match + DM thread BEFORE navigating.
            useDemoStore.getState().simulateMatch(swipedProfile.id);
            const matchId = `match_${swipedProfile.id}`;
            navigatingRef.current = true;
            // Defer navigation so advanceCard's setState commits first
            InteractionManager.runAfterInteractions(() => {
              if (!mountedRef.current) {
                swipeLockRef.current = false;
                return;
              }
              try {
                trackEvent({ name: 'match_created', matchId, otherUserId: swipedProfile.id });
                router.push(`/(main)/match-celebration?matchId=${matchId}&userId=${swipedProfile.id}` as any);
              } catch {
                navigatingRef.current = false;
              } finally {
                swipeLockRef.current = false;
              }
            });
            return;
          }
          // Release swipe lock (navigatingRef guards further swipes if navigating)
          swipeLockRef.current = false;
          return;
        }

        if (!convexUserId) { swipeLockRef.current = false; return; }
        const action = direction === "left" ? "pass" : direction === "up" ? "super_like" : "like";
        // B5 fix: wrap mutation in Promise.race with 6s timeout to prevent stuck swipe lock
        const SWIPE_TIMEOUT_MS = 6000;
        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("Swipe timed out")), SWIPE_TIMEOUT_MS)
        );
        const result = await Promise.race([
          swipeMutation({
            fromUserId: convexUserId,
            toUserId: swipedProfile.id as any,
            action: action as any,
            message: message,
          }),
          timeoutPromise,
        ]);

        // Guard: check mounted/focused before navigating on match
        if (!mountedRef.current || !isFocusedRef.current) return;
        if (result?.isMatch && !navigatingRef.current) {
          navigatingRef.current = true;
          // B6 fix: wrap navigation in try/catch and reset navigatingRef on failure
          // 3B-4: Defer swipe lock release until after navigation initiated
          InteractionManager.runAfterInteractions(() => {
            if (!mountedRef.current) {
              swipeLockRef.current = false;
              return;
            }
            try {
              trackEvent({ name: 'match_created', matchId: result.matchId, otherUserId: swipedProfile.id });
              router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${swipedProfile.id}`);
            } catch {
              navigatingRef.current = false;
            } finally {
              swipeLockRef.current = false;
            }
          });
          return; // 3B-4: Don't release lock in outer finally; deferred to callback
        }
      } catch (error: any) {
        if (!mountedRef.current) return;
        Toast.show("Something went wrong. Please try again.");
      } finally {
        swipeLockRef.current = false;
      }
    },
    [convexUserId, swipeMutation, advanceCard, hasReachedLikeLimit, hasReachedStandOutLimit, incrementLikes, incrementStandOuts, demo.recordSwipe],
  );

  const animateSwipe = useCallback(
    (direction: "left" | "right" | "up", velocity?: number) => {
      // Guard: don't start new animations if navigating, unfocused, or already swiping
      if (navigatingRef.current || !isFocusedRef.current) return;
      if (swipeLockRef.current) return;
      // Check limits before animating
      if (direction === "right" && hasReachedLikeLimit()) return;
      if (direction === "up" && hasReachedStandOutLimit()) return;

      // ★ Acquire swipe lock — released inside handleSwipe after advanceCard
      swipeLockRef.current = true;

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
          // Animation was interrupted (blur/unmount) — release lock
          swipeLockRef.current = false;
          return;
        }
        // B4 fix: guard against unmount before calling handleSwipe
        if (!mountedRef.current) {
          swipeLockRef.current = false;
          return;
        }
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
  useEffect(() => {
    if (!standOutResult || !currentRef.current) return;
    if (!mountedRef.current || !isFocusedRef.current) return;
    if (swipeLockRef.current) return;
    useInteractionStore.getState().setStandOutResult(null);
    const msg = standOutResult.message;

    // Acquire swipe lock for the stand-out animation
    swipeLockRef.current = true;

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
        swipeLockRef.current = false;
        return;
      }
      if (!mountedRef.current || !isFocusedRef.current) {
        swipeLockRef.current = false;
        return;
      }
      handleSwipeRef.current("up", msg || undefined);
    });
  }, [standOutResult]);

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
    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <Text style={styles.emptyEmoji}>✨</Text>
        <Text style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>You're all caught up</Text>
        <Text style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>Check back soon — we'll bring you more people as they join.</Text>
      </View>
    );
  }

  // Phase-2: Filter results in no matches
  if (isPhase2 && intentFilters.length > 0 && filteredProfiles.length === 0) {
    const filterLabels = intentFilters
      .map(k => PRIVATE_INTENT_CATEGORIES.find((c) => c.key === k)?.label ?? k)
      .join(', ');
    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
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
    );
  }

  // Deck exhausted state (swiped through all profiles)
  if (!current) {
    const handleResetDeck = () => {
      if (isDemoMode) {
        useDemoStore.getState().resetDiscoverPool();
        setIndex(0);
      }
    };

    return (
      <View style={[styles.center, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        <Text style={styles.emptyEmoji}>🎉</Text>
        <Text style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>No more profiles</Text>
        <Text style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>
          You've seen everyone available right now.
        </Text>
        {isDemoMode && (
          <TouchableOpacity
            style={[styles.resetButton, { marginTop: 24 }]}
            onPress={handleResetDeck}
          >
            <Ionicons name="refresh" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.resetButtonText}>Reset Demo Deck</Text>
          </TouchableOpacity>
        )}
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
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/notifications" as any)}>
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
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push("/(main)/notifications" as any)}>
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
              trustBadges={nextBadges}
              profilePrompt={next.profilePrompts?.[0]}
              theme={isPhase2 ? "dark" : "light"}
              privateIntentKeys={next.privateIntentKeys ?? (next as any).intentKeys ?? (next.privateIntentKey ? [next.privateIntentKey] : [])}
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
              trustBadges={currentBadges}
              profilePrompt={current.profilePrompts?.[0]}
              showCarousel
              onOpenProfile={openProfileCb}
              theme={isPhase2 ? "dark" : "light"}
              privateIntentKeys={current.privateIntentKeys ?? (current as any).intentKeys ?? (current.privateIntentKey ? [current.privateIntentKey] : [])}
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

});
