/**
 * 🔒 LOCKED: Phase-1 Discover (Production Ready)
 *
 * This feature has completed full audit and production hardening.
 * Do NOT modify without explicit approval.
 *
 * Locked scope includes:
 * - auth flow
 * - ranking logic
 * - pagination
 * - swipe behavior
 * - card rendering rules
 * - presence handling
 * - distance logic
 * - empty state logic
 *
 * If changes are required:
 * - open a new audit
 * - do not modify directly
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  InteractionManager,
  Modal,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withSequence,
  withRepeat,
  interpolate,
  runOnJS,
  Extrapolation,
  FadeIn,
  FadeOut,
  FadeInUp,
  SlideInDown,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useShallow } from "zustand/react/shallow";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  COLORS,
  FONT_SIZE,
  INCOGNITO_COLORS,
  SIZES,
  SPACING,
  SWIPE_CONFIG,
  lineHeight,
  moderateScale,
} from "@/lib/constants";
import { getTrustBadges } from "@/lib/trustBadges";
import { useAuthStore } from "@/stores/authStore";
import { useDiscoverStore } from "@/stores/discoverStore";
import { useFilterStore } from "@/stores/filterStore";
import { ProfileCard, SwipeOverlay } from "@/components/cards";
import { ProfileCardPreview } from "@/components/cards/ProfileCardPreview";
import { WelcomeOverlay, SwipeGuidanceHint, HeaderAvatarButton } from "@/components/ui";
import {
  DC_BUTTON_DIAMETER,
  DC_BUTTON_DIAMETER_COMPACT,
  DC_ICON_SIZE,
  DC_STAR_ICON_SIZE,
  DC_BUTTON_GAP,
  DC_ROW_PADDING_X,
  DC_ROW_PADDING_BOTTOM,
  DC_PRESS_SCALE,
  DC_BUTTON_SHADOW,
  DC_GLASS_BORDER_WIDTH,
  DC_GLASS_BORDER_LIGHT,
  DC_GLASS_BORDER_PASS,
  DC_GLASS_HIGHLIGHT_COLORS_LIGHT,
  DC_GLASS_HIGHLIGHT_COLORS_PASS,
  DC_GLASS_HIGHLIGHT_LOCATIONS,
  DC_GLASS_HIGHLIGHT_START,
  DC_GLASS_HIGHLIGHT_END,
  getDeepConnectBottomLayout,
} from "./_internal/deepConnectActionRow.tokens";
import {
  P1_BUTTON_DIAMETER,
  P1_BUTTON_DIAMETER_COMPACT,
  P1_ICON_SIZE,
  P1_STAR_ICON_SIZE,
  P1_BUTTON_GAP,
  P1_ROW_PADDING_X,
  P1_ROW_PADDING_BOTTOM,
  P1_PRESS_SCALE,
  P1_BUTTON_SHADOW,
  P1_SURFACE,
  P1_SURFACE_TINT_STANDOUT,
  P1_SURFACE_TINT_LIKE,
  P1_BORDER_WIDTH,
  P1_BORDER_SKIP,
  P1_BORDER_STANDOUT,
  P1_BORDER_LIKE,
  P1_ICON_SKIP,
  P1_ICON_STANDOUT,
  P1_ICON_LIKE,
  P1_GLASS_HIGHLIGHT_COLORS,
  P1_GLASS_HIGHLIGHT_LOCATIONS,
  P1_GLASS_HIGHLIGHT_START,
  P1_GLASS_HIGHLIGHT_END,
  P1_DISABLED_OPACITY,
  P1_DISABLED_SHADOW_OPACITY,
} from "./_internal/phase1ActionRow.tokens";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isDemoMode } from "@/hooks/useConvex";
import { getDiscoverPrefetchSnapshot, markPrefetchUsed, clearUsedPrefetch } from "@/lib/discoverPrefetch";
import {
  unwrapPhase1DiscoverQueryResult,
  type Phase1DiscoverEmptyReason,
} from "@/lib/phase1DiscoverQuery";
import {
  usePhase1NotificationBellBadge,
  usePhase2NotificationBellBadge,
} from "@/hooks/useNotifications";
import { DEMO_PROFILES, DEMO_INCOGNITO_PROFILES } from "@/lib/demoData";
import { useDemoStore } from "@/stores/demoStore";
import { useBlockStore } from "@/stores/blockStore";
import { usePhase2DiscoverCacheStore } from "@/stores/phase2DiscoverCacheStore";
import { router } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useInteractionStore } from "@/stores/interactionStore";
import { asUserId } from "@/convex/id";
import { ProfileData, getRenderableProfilePhotos, toProfileData } from "@/lib/profileData";
import { trackEvent } from "@/lib/analytics";
import { Toast } from "@/components/ui/Toast";
import { getExploreCategoryTagLabel } from "@/components/explore/exploreCategories";
// usePrivateChatStore - read-only for retention UI hints (conversations count)
import { usePrivateChatStore } from "@/stores/privateChatStore";
import { usePrivateProfileStore } from "@/stores/privateProfileStore";
import { useExplorePrefsStore } from "@/stores/explorePrefsStore";
import { NotificationPopover } from "@/components/discover/NotificationPopover";
import { StandOutComposerSheet } from "@/components/discover/StandOutComposerSheet";
import { useLocationStore, useLiveDistance } from "@/stores/locationStore";
// REMOVED: IncognitoConversation, ConnectionSource types - no longer needed after disabling local conversation creation
import type { Id } from "@/convex/_generated/dataModel";
// P0 UNIFIED PRESENCE: Batch presence query for discover cards
import { useBatchPresence } from "@/hooks/usePresence";

import { markPhase2Matched } from "@/lib/phase2MatchSession";
import * as Haptics from 'expo-haptics';
import { trackAction, setFeatureAndScreen, SENTRY_FEATURES } from '@/lib/sentry';
import { DEBUG_DISCOVER_QUEUE, DEBUG_PHASE2 } from '@/lib/debugFlags';

// Type for swipe actions
type SwipeAction = 'like' | 'pass' | 'super_like';
import { log } from "@/utils/logger";

// Demo mode match rate (20% for realistic testing)
const DEMO_MATCH_RATE = 0.2;

/**
 * Handle Phase 2 match event. Returns true if new match, false if duplicate.
 *
 * NOTE: Conversation is now created by backend (privateSwipes.ts).
 * Frontend only tracks idempotency and logs the event.
 * Frontend must reflect backend state, not create local conversations.
 */
function handlePhase2Match(profile: { id: string; name: string; age?: number; photoUrl?: string; matchKey?: string }): boolean {
  // Check idempotency via shared session module
  if (!markPhase2Matched(profile.matchKey ?? profile.id)) {
    return false;
  }

  // DISABLED: Local conversation creation removed - backend now handles this
  // Frontend should fetch conversations from backend (privateConversations table)
  // usePrivateChatStore.getState().createConversation(...);
  // usePrivateChatStore.getState().unlockUser(...);

  log.info('[MATCH]', 'phase2-backend', { name: profile.name });
  return true;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const EMPTY_ARRAY: any[] = [];
const EMPTY_STRING_ARRAY: string[] = [];
const PREFETCH_HOLD_MS = 1200;
/** AsyncStorage key for persisting the Phase-1 first-launch welcome overlay flag. */
const PHASE1_WELCOME_SHOWN_STORAGE_KEY = 'mira:phase1-discover:welcome-shown:v1';
const PHASE1_LOCATION_FOCUS_REVISIT_GAP_MS = 30 * 1000;
/** Deep Connect: switch to a recovery state if the live query stalls */
const DEEP_CONNECT_QUERY_TIMEOUT_MS = 8500;
/** Deep Connect: downward pull distance before the deck refreshes */
const DEEP_CONNECT_PULL_REFRESH_MIN_DISTANCE = 92;
const DEBUG_DEEPCONNECT_LOGS =
  __DEV__ && process.env.EXPO_PUBLIC_DEBUG_DEEPCONNECT === 'true';

function getDistanceDebugValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : null;
}

// ── Star-burst animation for super-like ──
const STAR_COUNT = 8;
const STAR_COLORS = ['#FFD700', '#FFA500', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
const STAR_BURST_DURATION_MS = 760;
const STAR_BURST_CONFIG = Array.from({ length: STAR_COUNT }, (_, i) => {
  const angle = (i / STAR_COUNT) * 2 * Math.PI;
  const distance = 78 + (i % 3) * 18;
  return { angle, distance, delay: i * 0.07 };
});


interface StarBurstAnimationProps {
  visible: boolean;
  onComplete: () => void;
}

function StarBurstParticle({
  color,
  angle,
  distance,
  delay,
  progress,
}: {
  color: string;
  angle: number;
  distance: number;
  delay: number;
  progress: SharedValue<number>;
}) {
  const particleStyle = useAnimatedStyle(() => {
    const localProgress = Math.max(0, Math.min((progress.value - delay) / (1 - delay), 1));
    const travel = interpolate(localProgress, [0, 0.72, 1], [0, 1, 1], Extrapolation.CLAMP);
    const opacity = interpolate(localProgress, [0, 0.12, 0.7, 1], [0, 1, 0.95, 0], Extrapolation.CLAMP);
    const scale = interpolate(localProgress, [0, 0.18, 0.72, 1], [0.25, 1, 1.08, 0.82], Extrapolation.CLAMP);

    return {
      opacity,
      transform: [
        { translateX: Math.cos(angle) * distance * travel },
        { translateY: Math.sin(angle) * distance * travel },
        { scale },
        { rotate: `${Math.round((angle * 180) / Math.PI)}deg` },
      ],
    };
  });

  return (
    <Animated.View style={[starBurstStyles.star, particleStyle]}>
      <Ionicons name="star" size={SIZES.icon.lg} color={color} />
    </Animated.View>
  );
}

function StarBurstAnimation({ visible, onComplete }: StarBurstAnimationProps) {
  const burstProgress = useSharedValue(0);
  const centerStarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burstProgress.value, [0, 0.15, 0.75, 1], [0, 1, 0.9, 0], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(burstProgress.value, [0, 0.18, 0.75, 1], [0.5, 1.14, 1, 0.88], Extrapolation.CLAMP),
      },
    ],
  }));

  useEffect(() => {
    if (!visible) {
      burstProgress.value = 0;
      return;
    }

    burstProgress.value = 0;
    burstProgress.value = withTiming(1, {
      duration: STAR_BURST_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });

    const timer = setTimeout(() => {
      onComplete();
    }, STAR_BURST_DURATION_MS + 30);

    return () => clearTimeout(timer);
  }, [visible, onComplete, burstProgress]);

  if (!visible) return null;

  return (
    <View style={starBurstStyles.container} pointerEvents="none">
      {STAR_BURST_CONFIG.map((particle, i) => (
        <StarBurstParticle
          key={i}
          color={STAR_COLORS[i % STAR_COLORS.length]}
          angle={particle.angle}
          distance={particle.distance}
          delay={particle.delay}
          progress={burstProgress}
        />
      ))}
      <Animated.View style={[starBurstStyles.centerStar, centerStarStyle]}>
        <Ionicons name="star" size={DISCOVER_MATCH_AVATAR_ICON_SIZE} color="#FFD700" />
      </Animated.View>
    </View>
  );
}

function MatchCelebrationPulse() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, {
        duration: 2200,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
  }, [pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 0.5, 1], [0.3, 0.62, 0.34], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(pulse.value, [0, 0.5, 1], [0.96, 1.06, 0.98], Extrapolation.CLAMP),
      },
    ],
  }));

  const heartStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(pulse.value, [0, 0.5, 1], [0.94, 1.08, 0.97], Extrapolation.CLAMP),
      },
      {
        translateY: interpolate(pulse.value, [0, 0.5, 1], [2, -2, 2], Extrapolation.CLAMP),
      },
    ],
  }));

  return (
    <>
      <Animated.View style={[styles.p2MatchGlowRing, haloStyle]} />
      <Animated.View style={[styles.p2MatchFloatingHeart, heartStyle]}>
        <Ionicons name="heart" size={DISCOVER_ACTION_ICON_SIZE} color="#ff9ac8" />
      </Animated.View>
    </>
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
    width: SIZES.icon.lg,
    height: SIZES.icon.lg,
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
const DEEP_CONNECT_HEADER_VERTICAL_OFFSET = 8;
const DISCOVER_TEXT_MAX_SCALE = 1.2;
const DISCOVER_TEXT_PROPS = { maxFontSizeMultiplier: DISCOVER_TEXT_MAX_SCALE } as const;
const DISCOVER_FONT_15 = moderateScale(15, 0.4);
const DISCOVER_FONT_17 = moderateScale(17, 0.4);
const DISCOVER_FONT_21 = moderateScale(21, 0.4);
const DISCOVER_FONT_22 = moderateScale(22, 0.4);
const DISCOVER_FONT_26 = moderateScale(26, 0.4);
const DISCOVER_EMOJI_SIZE = moderateScale(72, 0.3);
const DISCOVER_PHASE2_EMPTY_ICON_SIZE = moderateScale(36, 0.3);
const DISCOVER_LIMIT_ICON_SIZE = moderateScale(80, 0.3);
const DISCOVER_MATCH_AVATAR_ICON_SIZE = moderateScale(48, 0.3);
const DISCOVER_ACTION_ICON_SIZE = moderateScale(28, 0.3);
const DISCOVER_STANDOUT_ICON_SIZE = moderateScale(22, 0.3);
const DISCOVER_ACTION_BUTTON_SIZE = moderateScale(62, 0.25);
const DISCOVER_ACTION_BUTTON_COMPACT_SIZE = moderateScale(54, 0.25);
const DISCOVER_BADGE_SIZE = SIZES.badgeSize + SPACING.xxs;
const DISCOVER_CARD_HORIZONTAL_INSET = SPACING.sm + SPACING.xxs;
const DISCOVER_EMPTY_CONTENT_MAX_WIDTH = moderateScale(320, 0.25);
const DISCOVER_EMPTY_CARD_MAX_WIDTH = moderateScale(340, 0.25);
const DISCOVER_ACTION_BAR_CLEARANCE = DISCOVER_ACTION_BUTTON_SIZE + SPACING.md + SPACING.xs;
const DISCOVER_TRANSITION_HINT_MIN_BOTTOM = SIZES.button.lg + SPACING.lg;
const DEFAULT_PHASE2_INTENT_KEYS = ['go_with_the_flow'];

function resolvePhase2IntentKeys(
  profile: {
    privateIntentKeys?: string[];
    intentKeys?: string[];
    privateIntentKey?: string | null | undefined;
  },
  fallbackIntentKeys: string[] = DEFAULT_PHASE2_INTENT_KEYS,
): string[] {
  const intentKeys =
    profile.privateIntentKeys ??
    profile.intentKeys ??
    (profile.privateIntentKey && String(profile.privateIntentKey) !== 'undefined'
      ? [profile.privateIntentKey]
      : fallbackIntentKeys);
  return Array.isArray(intentKeys) && intentKeys.length > 0
    ? intentKeys
    : fallbackIntentKeys;
}

function resolvePhase2CardName(displayName: unknown): string {
  // ANON-LOADING-FIX: return empty string when the name is missing so the
  // ProfileCard renders a skeleton placeholder. The literal word "Anonymous"
  // is reserved for intentional anonymous product modes only and must NOT
  // be shown for a loading/missing-data state.
  const trimmedName = typeof displayName === "string" ? displayName.trim() : "";
  if (trimmedName.length === 0) return "";
  if (trimmedName.toLowerCase() === "anonymous") return "";
  return trimmedName;
}

function isPhase2ConnectedProfile(profile: ProfileData, connectedUserIds: Set<string>): boolean {
  if (connectedUserIds.size === 0) return false;
  return connectedUserIds.has(profile.id) || (profile.userId ? connectedUserIds.has(profile.userId) : false);
}

function mapPhase2CardProfile(input: {
  profileId: string;
  userId?: string;
  displayName?: unknown;
  age?: number;
  distance?: number;
  bio?: string;
  photoUrls?: Array<string | null | undefined>;
  activities?: string[];
  isVerified?: boolean;
  verificationStatus?: string;
  intentKeys?: string[];
  fallbackIntentKeys?: string[];
  desireTagKeys?: string[];
  gender?: string;
  photoBlurEnabled?: boolean;
  photoBlurSlots?: boolean[];
  isSetupComplete?: boolean;
  hasPhotos?: boolean;
  height?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  education?: string | null;
  religion?: string | null;
  profilePrompts?: { question: string; answer: string }[];
  lastActive?: number;
  createdAt?: number;
}): ProfileData {
  const photoUrls = (input.photoUrls ?? []).filter(
    (url): url is string => typeof url === "string" && url.length > 0
  );
  const intentKeys =
    Array.isArray(input.intentKeys) && input.intentKeys.length > 0
      ? input.intentKeys
      : (input.fallbackIntentKeys ?? []);

  return toProfileData({
    _id: input.profileId,
    userId: input.userId ?? input.profileId,
    name: resolvePhase2CardName(input.displayName),
    age: input.age,
    distance: input.distance,
    bio: input.bio,
    photos: photoUrls.map((url) => ({ url })),
    activities: input.activities ?? [],
    isVerified: input.isVerified ?? false,
    verificationStatus: input.verificationStatus,
    privateIntentKeys: intentKeys,
    privateIntentKey: intentKeys[0],
    desireTagKeys: Array.isArray(input.desireTagKeys) ? input.desireTagKeys : [],
    gender: input.gender,
    photoBlurEnabled: input.photoBlurEnabled,
    photoBlurSlots: input.photoBlurSlots,
    photoBlurred: false,
    isSetupComplete: input.isSetupComplete,
    hasPhotos: input.hasPhotos ?? (photoUrls.length > 0),
    height: input.height ?? null,
    smoking: input.smoking ?? null,
    drinking: input.drinking ?? null,
    education: input.education ?? null,
    religion: input.religion ?? null,
    profilePrompts: input.profilePrompts ?? [],
    lastActive: input.lastActive,
    createdAt: input.createdAt,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATED ACTION BUTTON - Micro-interaction feedback for action buttons
// ═══════════════════════════════════════════════════════════════════════════
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

interface AnimatedActionButtonProps {
  onPress: () => void;
  style: any;
  children: React.ReactNode;
  disabled?: boolean;
  feedbackScale?: number;
  hapticType?: 'light' | 'medium' | 'none';
}

function AnimatedActionButton({
  onPress,
  style,
  children,
  disabled = false,
  feedbackScale = 0.92,
  hapticType = 'light',
}: AnimatedActionButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(feedbackScale, { damping: 15, stiffness: 400 });
  }, [scale, feedbackScale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  }, [scale]);

  const handlePress = useCallback(() => {
    // Trigger haptic feedback
    if (hapticType !== 'none') {
      Haptics.impactAsync(
        hapticType === 'medium'
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light
      );
    }
    onPress();
  }, [onPress, hapticType]);

  return (
    <AnimatedTouchable
      style={[style, animatedStyle]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      activeOpacity={0.9}
    >
      {children}
    </AnimatedTouchable>
  );
}

export interface DiscoverCardStackProps {
  /** 'dark' applies INCOGNITO_COLORS to background/header only; card UI stays identical */
  theme?: "light" | "dark";
  /**
   * Phase context for match routing:
   * - 'phase1' (default): Match goes to match-celebration → Phase 1 messages
   * - 'phase2': Match creates Phase 2 private chat (no navigation, stays on Deep Connect)
   */
  mode?: "phase1" | "phase2";
  /** When provided, skip internal Convex query and use these profiles instead (e.g. Explore category). */
  externalProfiles?: any[];
  /** Hide the built-in header (caller renders its own). */
  hideHeader?: boolean;
  /** Category ID when used from Explore - shows "Why this profile" tag */
  exploreCategoryId?: string;
  /** Scope key for profile-action sync when the stack is used outside main Discover. */
  profileActionScope?: string;
  /** Callback when user swipes through all profiles in stack */
  onStackEmpty?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────
// Shared swipe direction classifier — used by BOTH the live overlay preview
// (UI thread, inside panGesture.onUpdate worklet) and the final commit
// decision (JS thread, inside handlePanEnd) so the icon the user sees can
// never disagree with the action that fires on release.
//
// Returns "left" | "right" | "up" | null. `null` is the diagonal/ambiguous
// dead-zone — neither axis dominates, so no overlay icon is shown and on
// release the gesture resets without committing an action.
//
// Direction rules (identical for preview and commit; only the distance/
// velocity thresholds differ):
//   - "up"    : dy < 0 AND |dy| ≥ |dx| * dominanceRatio AND
//               (|dy| ≥ distanceY OR |vy| ≥ velocityY).
//   - "right" : dx > 0 AND |dx| ≥ |dy| * dominanceRatio AND
//               (|dx| ≥ distanceX OR vx ≥ velocityX).
//   - "left"  : dx < 0 AND |dx| ≥ |dy| * dominanceRatio AND
//               (|dx| ≥ distanceX OR -vx ≥ velocityX).
// dominanceRatio = 1.25 means the winning axis must be at least 25 % larger
// than the other; 30°-ish diagonal swipes fail the test → null.
//
// This function is a Reanimated worklet (annotated below) so it is usable
// from inside Gesture.Pan().onUpdate() on the UI thread, while still being
// callable as a normal function on the JS thread from handlePanEnd.
function classifySwipeDirection(
  dx: number,
  dy: number,
  vx: number,
  vy: number,
  distanceX: number,
  distanceY: number,
  velocityX: number,
  velocityY: number,
  dominanceRatio: number,
): "left" | "right" | "up" | null {
  'worklet';
  const absX = dx < 0 ? -dx : dx;
  const absY = dy < 0 ? -dy : dy;
  const absVy = vy < 0 ? -vy : vy;

  // Upward intent first: dy must be negative AND vertical clearly dominates.
  if (dy < 0 && absY >= absX * dominanceRatio) {
    if (absY >= distanceY || absVy >= velocityY) {
      return "up";
    }
  }

  // Horizontal intent: horizontal must clearly dominate vertical.
  if (absX >= absY * dominanceRatio) {
    if (dx > 0 && (absX >= distanceX || vx >= velocityX)) {
      return "right";
    }
    if (dx < 0 && (absX >= distanceX || -vx >= velocityX)) {
      return "left";
    }
  }

  return null;
}

// 🔒 LOCKED: Do not change Discover stack orchestration (Phase-1/2 modes, queue) without audit approval
export function DiscoverCardStack({ theme = "light", mode = "phase1", externalProfiles, hideHeader, exploreCategoryId, profileActionScope, onStackEmpty }: DiscoverCardStackProps) {
  const dark = theme === "dark";
  const isPhase2 = mode === "phase2";
  const C = dark ? INCOGNITO_COLORS : COLORS;

  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const hasValidToken = typeof token === "string" && token.trim().length > 0;

  // LIVE_LOCATION: Get cached location refresh for screen focus events
  const refreshLocationCached = useLocationStore((s) => s.refreshLocationCached);
  const hasUsableLocationCache = useLocationStore((s) => s.hasUsableLocationCache);
  // AUTH_READY_FIX: Wait for auth to be fully validated before running queries
  const authReady = useAuthStore((s) => s.authReady);
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const authVersion = useAuthStore((s) => s.authVersion);
  const phase2HasHydrated = usePrivateProfileStore((s) => s._hasHydrated);
  const [index, setIndex] = useState(0);
  const [retryKey, setRetryKey] = useState(0); // For LoadingGuard retry
  const [showNotificationPopover, setShowNotificationPopover] = useState(false);
  const lastPhase1LocationRefreshAtRef = useRef(0);
  const prefetchedNextHeroUrlsRef = useRef<Set<string>>(new Set());

  // Super-like star-burst animation state
  const [showSuperLikeAnimation, setShowSuperLikeAnimation] = useState(false);
  const clearSuperLikeAnimation = useCallback(() => setShowSuperLikeAnimation(false), []);

  // P2_MATCH: Match celebration state for Phase-2
  const [phase2MatchCelebration, setPhase2MatchCelebration] = useState<{
    visible: boolean;
    matchedProfile: {
      name: string;
      photoUrl?: string;
      conversationId?: string;
      alreadyMatched?: boolean;
      source?: 'deep_connect' | 'truth_dare' | 'rematch';
    } | null;
  }>({ visible: false, matchedProfile: null });

  // Read-only: existing conversations count for match reminder (no new queries)
  const conversationCount = usePrivateChatStore(
    useShallow((s) => s.conversations.length),
  );

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE TRANSITION OVERLAY (Phase-2 Entry Experience)
  // Shows once per component mount when entering Deep Connect
  // ══════════════════════════════════════════════════════════════════════════
  const [showPhaseTransition, setShowPhaseTransition] = useState(isPhase2);
  const phaseTransitionShownRef = useRef(false);
  const phaseTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after hold duration
  useEffect(() => {
    if (!isPhase2 || phaseTransitionShownRef.current) {
      setShowPhaseTransition(false);
      return;
    }
    // Mark as shown immediately to prevent re-triggers
    phaseTransitionShownRef.current = true;
    // Auto-dismiss after 1.4 seconds
    phaseTransitionTimerRef.current = setTimeout(() => {
      setShowPhaseTransition(false);
    }, 1400);
    return () => {
      if (phaseTransitionTimerRef.current) {
        clearTimeout(phaseTransitionTimerRef.current);
      }
    };
  }, [isPhase2]);

  // Tap to skip handler
  const dismissPhaseTransition = useCallback(() => {
    if (phaseTransitionTimerRef.current) {
      clearTimeout(phaseTransitionTimerRef.current);
    }
    setShowPhaseTransition(false);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // FIRST-TIME USER EXPERIENCE OVERLAYS
  // Shows welcome message and swipe guidance on first entry
  // ══════════════════════════════════════════════════════════════════════════
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(false);
  const [showSwipeGuidance, setShowSwipeGuidance] = useState(false);
  const welcomeShownRef = useRef(false);
  const swipeGuidanceShownRef = useRef(false);

  // Phase-1 welcome overlay is shown at most once per install; we hydrate the
  // persisted "shown" flag here and defer the actual show trigger until the
  // Discover deck has settled (see effect after phase1ProfilesWithPrefetch).
  const [welcomeFlagHydrated, setWelcomeFlagHydrated] = useState(false);
  useEffect(() => {
    if (isPhase2) {
      // Phase-2 has its own transition flow and never shows this overlay.
      setWelcomeFlagHydrated(true);
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(PHASE1_WELCOME_SHOWN_STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw === 'true') {
          welcomeShownRef.current = true;
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setWelcomeFlagHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isPhase2]);

  // Show swipe guidance after welcome (or phase transition for Phase-2)
  useEffect(() => {
    // For Phase-1: show after welcome overlay dismisses
    // For Phase-2: show after phase transition dismisses
    const shouldShowGuidance = !swipeGuidanceShownRef.current && (
      (!isPhase2 && !showWelcomeOverlay && welcomeShownRef.current) ||
      (isPhase2 && !showPhaseTransition && phaseTransitionShownRef.current)
    );

    if (shouldShowGuidance) {
      swipeGuidanceShownRef.current = true;
      // Small delay to let the main content appear first
      const timer = setTimeout(() => {
        setShowSwipeGuidance(true);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isPhase2, showWelcomeOverlay, showPhaseTransition]);

  // Phase-2 + Phase-1: one shallow subscription — avoids full filterStore re-renders
  const {
    privateIntentKeys: intentFilters,
    togglePrivateIntentKey,
    setPrivateIntentKeys,
    minAge,
    maxAge,
    maxDistance,
    gender: genderFilter,
    sortBy,
    filterVersion,
  } = useFilterStore(
    useShallow((s) => ({
      privateIntentKeys: s.privateIntentKeys,
      togglePrivateIntentKey: s.togglePrivateIntentKey,
      setPrivateIntentKeys: s.setPrivateIntentKeys,
      minAge: s.minAge,
      maxAge: s.maxAge,
      maxDistance: s.maxDistance,
      gender: s.gender,
      sortBy: s.sortBy,
      filterVersion: s.filterVersion,
    })),
  );

  // Daily limits — individual selectors to avoid full re-render on AsyncStorage hydration
  const standOutsRemaining = useDiscoverStore((s) => s.standOutsRemaining);
  const hasReachedLikeLimit = useDiscoverStore((s) => s.hasReachedLikeLimit);
  const hasReachedStandOutLimit = useDiscoverStore((s) => s.hasReachedStandOutLimit);
  const incrementLikes = useDiscoverStore((s) => s.incrementLikes);
  const incrementStandOuts = useDiscoverStore((s) => s.incrementStandOuts);
  const checkAndResetIfNewDay = useDiscoverStore((s) => s.checkAndResetIfNewDay);

  // Phase-1 live pagination: merge Convex pages in-session.
  // P2-4: First page is intentionally larger than subsequent pages so fast
  // swipers do not outrun pagination on cold-start. Subsequent pages stay at
  // PHASE1_PAGE_SIZE to keep network usage incremental.
  const PHASE1_FIRST_PAGE_SIZE = 30;
  const PHASE1_PAGE_SIZE = 20;
  const PHASE1_LOAD_MORE_THRESHOLD = 5;
  const [phase1FetchOffset, setPhase1FetchOffset] = useState(0);
  const [phase1SessionProfiles, setPhase1SessionProfiles] = useState<any[]>([]);
  const phase1LoadMoreInFlightRef = useRef(false);
  const phase1HasMoreRef = useRef(true);
  const phase1ConsumedIdsRef = useRef<Set<string>>(new Set()); // Profiles already swiped in Phase-1

  // Engagement triggers - swipe progress tracking
  const trackSwipe = useExplorePrefsStore((s) => s.trackSwipe);
  const shouldShowSwipeProgress = useExplorePrefsStore((s) => s.shouldShowSwipeProgress);

  // Reset daily limits if new day
  useEffect(() => {
    checkAndResetIfNewDay();
  }, [checkAndResetIfNewDay]);

  // ── Navigation lock: prevents handleSwipe/pan handlers from firing during navigation ──
  const navigatingRef = useRef(false);
  // ── Focus guard: tracks whether this screen is the active tab ──
  const isFocusedRef = useRef(true);
  // ── Swipe lock: prevents re-entrant swipes while animation + processing is in flight ──
  // Acquired in animateSwipe, released after advanceCard + match logic complete.
  const swipeLockRef = useRef(false);
  // P2-1: React-state mirror of swipeLockRef so the action-button row can
  // re-render `disabled` while a swipe is in flight. The ref alone does not
  // trigger re-renders, leaving Like/Pass/Stand-Out buttons visually active
  // even though duplicate taps are silently swallowed by the lock guard.
  const [isSwipeInFlight, setIsSwipeInFlight] = useState(false);
  const prevDiscoverReadyLogKeyRef = useRef<string | null>(null);
  // LIVE_LOCATION: Prevent duplicate location refresh requests during focus
  const isRefreshingLocationRef = useRef(false);

  // ── RACE CONDITION FIX: Swipe ID for deterministic lock ownership ──
  // Each swipe gets a unique ID. Only the callback holding the current ID can release the lock.
  // This prevents stale async callbacks (from animation, network, timeout) from releasing
  // a lock that belongs to a newer swipe.
  const swipeIdRef = useRef(0);
  const pendingPhase2SwipeRef = useRef<{ swipeId: number; profileId: string } | null>(null);
  const reconciledPhase2SwipeIdsRef = useRef<Set<number>>(new Set());

  /**
   * Acquire the swipe lock and return a unique swipe ID.
   * Only the holder of this ID should release the lock.
   */
  const acquireSwipeLock = useCallback((): number => {
    swipeIdRef.current += 1;
    swipeLockRef.current = true;
    // P2-1: Mirror lock to React state so the button row re-renders disabled.
    // React 18+ silently no-ops setState on unmounted components, so the
    // mountedRef guard below is unnecessary here.
    setIsSwipeInFlight(true);
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
      // P2-1: Re-enable buttons once the in-flight swipe owner releases.
      setIsSwipeInFlight(false);
    }
    // else: stale callback from old swipe — ignore silently
  }, []);

  // ── Mounted guard: prevents state updates and navigation after unmount ──
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;

    // Set Sentry feature context for Phase-2 error tracking
    if (isPhase2) {
      setFeatureAndScreen(SENTRY_FEATURES.PHASE2_DISCOVER, 'DiscoverCardStack');
    }

    return () => {
      mountedRef.current = false;
      // Clean up locks so a future remount starts fresh
      navigatingRef.current = false;
      swipeLockRef.current = false;
      pendingPhase2SwipeRef.current = null;
      reconciledPhase2SwipeIdsRef.current.clear();
    };
  }, [isPhase2]);

  const [phase2QueryPaused, setPhase2QueryPaused] = useState(false);
  const [isRefreshingPhase2Deck, setIsRefreshingPhase2Deck] = useState(false);
  const [phase2QueryTimedOut, setPhase2QueryTimedOut] = useState(false);

  // Overlay refs + shared values (no React re-renders during drag)
  const overlayDirectionRef = useRef<"left" | "right" | "up" | null>(null);
  const overlayOpacity = useSharedValue(0);
  const [overlayDirection, setOverlayDirection] = useState<"left" | "right" | "up" | null>(null);

  // Stand Out result from route screen
  const standOutResult = useInteractionStore((s) => s.standOutResult);

  // Inline Stand Out composer sheet target. When non-null, renders the
  // premium bottom-sheet composer over the current profile card. Replaces
  // the legacy `router.push('/(main)/stand-out?...')` navigation, which
  // showed a separate full screen with a white background flash.
  // Note: actual send still goes through `useInteractionStore.setStandOutResult`
  // → existing standOutResult effect → `handleSwipe('up', message)`, so the
  // Phase-1 / Phase-2 dispatch logic is untouched.
  const [standOutSheetTarget, setStandOutSheetTarget] = useState<{
    profileId: string;
    name: string;
  } | null>(null);
  const discoverProfileActionResult = useInteractionStore((s) => s.discoverProfileActionResult);
  const setDiscoverProfileActionResult = useInteractionStore((s) => s.setDiscoverProfileActionResult);

  // Notifications stay phase-scoped: Phase-1 reads notifications, Phase-2 reads privateNotifications.
  const phase1Bell = usePhase1NotificationBellBadge();
  const phase2Bell = usePhase2NotificationBellBadge();
  const { unseenCount } = mode === "phase2" ? phase2Bell : phase1Bell;

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

  // FIRST_MOUNT_FIX: Track userId availability and force query re-subscription
  // On first mount, userId might not be available yet (auth store not hydrated)
  // When it becomes available, we need to force the query to re-subscribe
  const userIdTrackingRef = useRef<{ prev: string | null | undefined; firstMount: boolean }>({
    prev: undefined,
    firstMount: true,
  });
  const [queryTrigger, setQueryTrigger] = useState(0);

  useEffect(() => {
    const { prev, firstMount } = userIdTrackingRef.current;

    // CASE 1: First mount with valid userId - trigger immediately
    if (firstMount && userId && convexUserId) {
      setQueryTrigger(1);
      userIdTrackingRef.current.firstMount = false;
    }
    // CASE 2: userId became available after mount (was undefined/null, now has value)
    else if (!prev && userId && convexUserId) {
      setQueryTrigger(t => t + 1);
    }

    userIdTrackingRef.current.prev = userId;
    userIdTrackingRef.current.firstMount = false;
  }, [userId, convexUserId, isPhase2]);

  // PHASE-2 ISOLATION FIX: Use separate queries for Phase-1 and Phase-2
  // Phase-1 uses discover.getDiscoverProfiles (users table)
  // Phase-2 uses privateDiscover.getProfiles (userPrivateProfiles table with isSetupComplete check)

  const prefetchSnapshot = useMemo(
    () =>
      !isPhase2 && userId && !isDemoMode && !skipInternalQuery
        ? getDiscoverPrefetchSnapshot(userId, authVersion)
        : null,
    [authVersion, isDemoMode, isPhase2, skipInternalQuery, userId],
  );
  // Treat the prefetch as a *positive* cache only — if it resolved with zero
  // profiles we leave `prefetchedProfiles` null so the live query controls the
  // empty/caught-up decision instead of flashing a stale "no_more_profiles".
  const [prefetchedProfiles, setPrefetchedProfiles] = useState<any[] | null>(() => {
    const r = prefetchSnapshot?.result;
    if (r == null) return null;
    const profs = unwrapPhase1DiscoverQueryResult(r).profiles;
    return profs.length > 0 ? profs : null;
  });
  const [prefetchWaitExpired, setPrefetchWaitExpired] = useState(false);

  useEffect(() => {
    const r = prefetchSnapshot?.result;
    if (r == null) {
      setPrefetchedProfiles(null);
      return;
    }
    const profs = unwrapPhase1DiscoverQueryResult(r).profiles;
    setPrefetchedProfiles(profs.length > 0 ? profs : null);
  }, [authVersion, prefetchSnapshot?.result, prefetchSnapshot?.startedAt, userId]);

  useEffect(() => {
    if (!prefetchSnapshot) {
      return;
    }

    if (prefetchSnapshot.result !== null) {
      markPrefetchUsed();
      return;
    }

    let cancelled = false;
    prefetchSnapshot.promise
      ?.then((result) => {
        if (cancelled) return;
        markPrefetchUsed();
        const profs = unwrapPhase1DiscoverQueryResult(result).profiles;
        setPrefetchedProfiles(profs.length > 0 ? profs : null);
      })
      .catch(() => {
        if (cancelled) return;
        setPrefetchedProfiles(null);
      });

    return () => {
      cancelled = true;
    };
  }, [prefetchSnapshot?.promise, prefetchSnapshot?.result, prefetchSnapshot?.startedAt]);

  useEffect(() => {
    if (!prefetchSnapshot?.promise || prefetchSnapshot.result !== null) {
      setPrefetchWaitExpired(false);
      return;
    }

    const elapsed = Date.now() - prefetchSnapshot.startedAt;
    if (elapsed >= PREFETCH_HOLD_MS) {
      setPrefetchWaitExpired(true);
      return;
    }

    setPrefetchWaitExpired(false);
    const timer = setTimeout(() => {
      setPrefetchWaitExpired(true);
    }, PREFETCH_HOLD_MS - elapsed);

    return () => clearTimeout(timer);
  }, [prefetchSnapshot?.promise, prefetchSnapshot?.result, prefetchSnapshot?.startedAt]);

  const shouldHoldPhase1Query =
    !isPhase2 &&
    !isDemoMode &&
    !!convexUserId &&
    !skipInternalQuery &&
    !!prefetchSnapshot?.promise &&
    prefetchSnapshot.result === null &&
    prefetchedProfiles === null &&
    !prefetchWaitExpired;

  // Phase-1 discover query args (skip if Phase-2 mode or legacy demo mode)
  // NOTE: isDemoAuthMode uses real Convex backend with token-based auth - do NOT skip
  const discoverArgs = useMemo(
    () =>
      !isDemoMode &&
      convexUserId &&
      hasValidToken &&
      !skipInternalQuery &&
      !isPhase2 &&
      !shouldHoldPhase1Query
        ? {
            token: token!.trim(),
            // P3-4: `sortBy` is typed `SortOption` in filterStore and the
            // Convex `getDiscoverProfiles` args union accepts exactly the
            // same five literals, so no `as any` is needed here.
            sortBy: sortBy || "recommended",
            // P2-4: First page uses larger size to give the deck enough
            // cushion before background pagination kicks in.
            limit: phase1FetchOffset === 0 ? PHASE1_FIRST_PAGE_SIZE : PHASE1_PAGE_SIZE,
            offset: phase1FetchOffset,
            filterVersion,
          }
        : "skip" as const,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convexUserId, hasValidToken, token, skipInternalQuery, retryKey, sortBy, isPhase2, isDemoMode, shouldHoldPhase1Query, phase1FetchOffset, filterVersion],
  );
  // 🔒 LOCKED: Do not change Phase-1 pagination / discover query contract without audit approval
  const phase1Profiles = useQuery(api.discover.getDiscoverProfiles, discoverArgs);
  const phase1ProfilesWithPrefetch =
    phase1Profiles !== undefined
      ? unwrapPhase1DiscoverQueryResult(phase1Profiles).profiles
      : prefetchedProfiles ?? null;

  /**
   * Step 8: backend empty reason for Phase-1.
   *
   * IMPORTANT: This intentionally only consults the *settled* live query.
   * Reading from `prefetchSnapshot.result` here used to allow a stale
   * `no_more_profiles` reason to flash "You've seen everyone" before the
   * live query had even resolved on cold launch.
   */
  const phase1DiscoverEmptyReason = useMemo((): Phase1DiscoverEmptyReason | undefined => {
    if (isPhase2 || isDemoMode || externalProfiles) return undefined;
    if (phase1Profiles === undefined) return undefined;
    return unwrapPhase1DiscoverQueryResult(phase1Profiles).phase1EmptyReason ?? undefined;
  }, [isPhase2, isDemoMode, externalProfiles, phase1Profiles]);

  const phase1EmptyMessaging = useMemo(() => {
    switch (phase1DiscoverEmptyReason) {
      case 'auth_missing_or_invalid':
        return {
          title: "Can't load Discover",
          subtitle: 'Sign in again or check your connection.',
        };
      case 'viewer_unavailable':
        return {
          title: 'Discover unavailable',
          subtitle: "You're hidden or paused. Turn Discover back on in settings.",
        };
      case 'filters_no_match':
        return {
          title: 'No matching profiles',
          subtitle: "Try widening age, distance, or who you're looking for.",
        };
      case 'no_more_profiles':
        return {
          title: "You've seen everyone",
          subtitle: 'Check back soon for new people, or try different preferences.',
        };
      case 'unknown_empty':
      default:
        return {
          title: "We're finding people for you",
          subtitle: 'Try adjusting your preferences to see more profiles',
        };
    }
  }, [phase1DiscoverEmptyReason]);

  useEffect(() => {
    if (isPhase2 || isDemoMode || externalProfiles) return;
    if (phase1Profiles === undefined) return;
    const { profiles: phase1Page } = unwrapPhase1DiscoverQueryResult(phase1Profiles);
    setPhase1SessionProfiles((prev) => {
      if (phase1FetchOffset === 0) return [...phase1Page];
      const seen = new Set(prev.map((p: { id: string }) => p.id));
      const next = [...prev];
      for (const p of phase1Page) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          next.push(p);
        }
      }
      return next;
    });
    // P2-4: First page is sized to PHASE1_FIRST_PAGE_SIZE; later pages to
    // PHASE1_PAGE_SIZE. Compare returned page length against whichever was
    // requested so hasMore is detected correctly on cold-start.
    const expectedPageSize =
      phase1FetchOffset === 0 ? PHASE1_FIRST_PAGE_SIZE : PHASE1_PAGE_SIZE;
    phase1HasMoreRef.current = phase1Page.length >= expectedPageSize;
    phase1LoadMoreInFlightRef.current = false;
  }, [phase1Profiles, phase1FetchOffset, isPhase2, isDemoMode, externalProfiles]);

  useEffect(() => {
    if (!externalProfiles) return;
    setPhase1FetchOffset(0);
    setPhase1SessionProfiles([]);
    phase1HasMoreRef.current = true;
  }, [externalProfiles]);

  useEffect(() => {
    if (isPhase2 || isDemoMode || externalProfiles) return;
    if (phase1LoadMoreInFlightRef.current) return;
    if (!phase1HasMoreRef.current) return;
    if (phase1SessionProfiles.length === 0) return;

    const unshown = phase1SessionProfiles.filter((p) => !phase1ConsumedIdsRef.current.has(p.id)).length;
    if (unshown > PHASE1_LOAD_MORE_THRESHOLD) return;

    phase1LoadMoreInFlightRef.current = true;
    // P2-4: Bump by the size of the page we just consumed. After the cold
    // first page (size 30) we advance by 30; thereafter we advance by 20.
    setPhase1FetchOffset((o) =>
      o + (o === 0 ? PHASE1_FIRST_PAGE_SIZE : PHASE1_PAGE_SIZE),
    );
  }, [index, phase1SessionProfiles, isPhase2, isDemoMode, externalProfiles]);

  // Clear prefetch cache once useQuery returns real data (subscription is active)
  useEffect(() => {
    if (phase1Profiles !== undefined && prefetchedProfiles !== null) {
      clearUsedPrefetch();
      setPrefetchedProfiles(null);
    }
  }, [phase1Profiles, prefetchedProfiles]);

  // Phase-1 welcome overlay: show *once* per install, only after the deck has
  // settled with at least one profile. This avoids the white welcome card
  // covering an empty/loading screen on every cold launch.
  const phase1HasSettledProfile =
    !isPhase2 &&
    !isDemoMode &&
    !externalProfiles &&
    !!phase1ProfilesWithPrefetch &&
    phase1ProfilesWithPrefetch.length > 0;
  useEffect(() => {
    if (isPhase2) return;
    if (!welcomeFlagHydrated) return;
    if (welcomeShownRef.current) return;
    if (!onboardingCompleted) return;
    if (!phase1HasSettledProfile) return;
    welcomeShownRef.current = true;
    setShowWelcomeOverlay(true);
    AsyncStorage.setItem(PHASE1_WELCOME_SHOWN_STORAGE_KEY, 'true').catch(() => {});
  }, [isPhase2, welcomeFlagHydrated, onboardingCompleted, phase1HasSettledProfile]);

  // Phase-2 private discover query args (skip if Phase-1 mode)
  // CRITICAL: This queries userPrivateProfiles table which requires isSetupComplete=true
  // AUTH_FIX: Pass authUserId only as a token cross-check hint.
  // FIRST_MOUNT_FIX: queryTrigger forces re-subscription when userId becomes available
  // AUTH_READY_FIX: Wait for authReady before querying to ensure onboardingCompleted is correct
  // FLICKER_FIX: Use stable ref so once auth is ready, it stays ready (no query skip toggle)
  const stableAuthReadyRef = useRef(false);
  const rawAuthReady = authReady && onboardingCompleted;

  // Once auth becomes ready, lock it (prevents transient flicker back to not-ready)
  if (rawAuthReady && !stableAuthReadyRef.current) {
    stableAuthReadyRef.current = true;
  }
  // Reset stable flag if user explicitly logs out (userId becomes null)
  if (!userId && stableAuthReadyRef.current) {
    stableAuthReadyRef.current = false;
  }

  const isAuthReadyForQuery = stableAuthReadyRef.current;

  // FLICKER_FIX: Debug log for auth state stability (Phase-2 only; log when snapshot changes — no per-render spam)
  if (DEBUG_DEEPCONNECT_LOGS && isPhase2) {
    const readyLogKey = JSON.stringify({
      authReady,
      onboardingCompleted,
      rawAuthReady,
      stableReady: stableAuthReadyRef.current,
      isAuthReadyForQuery,
      hasUserId: typeof userId === 'string' && userId.length > 0,
    });
    if (prevDiscoverReadyLogKeyRef.current !== readyLogKey) {
      prevDiscoverReadyLogKeyRef.current = readyLogKey;
      console.log('[DISCOVER_READY]', {
        authReady,
        onboardingCompleted,
        rawAuthReady,
        stableReady: stableAuthReadyRef.current,
        isAuthReadyForQuery,
      });
    }
  }

  // Deep Connect query args: token-bound viewer + server-side intent filtering.
  // NOTE: isDemoAuthMode uses real Convex backend with token-based auth - do NOT skip
  const privateDiscoverArgs = useMemo(
    () =>
      convexUserId && token && !skipInternalQuery && isPhase2 && isAuthReadyForQuery && !phase2QueryPaused
        ? {
            token: token as string,
            // P2-5: Pull a deeper Phase-2 slice per request. Backend safely
            // caps via MAX_PHASE2_RESULT_LIMIT, queue front-buffer stays at 3,
            // and we don't prefetch additional images here.
            limit: 80,
            ...(typeof userId === "string" && userId.trim().length > 0 ? { authUserId: userId } : {}),
            ...(intentFilters.length > 0 ? { intentKeys: intentFilters } : {}),
          }
        : "skip" as const,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convexUserId, userId, token, intentFilters, skipInternalQuery, isPhase2, isAuthReadyForQuery, phase2QueryPaused],
  );

  const phase2Profiles = useQuery(api.privateDiscover.getProfiles, privateDiscoverArgs);

  const phase2ConversationsArgs = useMemo(
    () =>
      isPhase2 && !isDemoMode && !externalProfiles && token && typeof userId === "string" && userId.trim().length > 0
        ? { token, authUserId: userId }
        : "skip" as const,
    [externalProfiles, isDemoMode, isPhase2, token, userId],
  );
  const phase2Conversations = useQuery(
    api.privateConversations.getUserPrivateConversations,
    phase2ConversationsArgs,
  );
  const connectedPhase2UserIds = useMemo(() => {
    if (!isPhase2 || !Array.isArray(phase2Conversations)) {
      return new Set<string>();
    }

    const ids = new Set<string>();
    for (const conversation of phase2Conversations as Array<{ participantId?: unknown }>) {
      if (typeof conversation.participantId === "string" && conversation.participantId.length > 0) {
        ids.add(conversation.participantId);
      }
    }
    return ids;
  }, [isPhase2, phase2Conversations]);

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEWER PROFILE QUERY - For computing common points with candidates
  // ═══════════════════════════════════════════════════════════════════════════
  // Step 10: token-only viewer support — no caller-supplied identity (session validates Convex user)
  const viewerProfileArgs = useMemo(
    () =>
      !isDemoMode && hasValidToken && authReady && !isPhase2
        ? { token: token!.trim() }
        : ("skip" as const),
    [authReady, hasValidToken, isPhase2, token]
  );
  const viewerProfile = useQuery(api.users.getDiscoverViewerSupport, viewerProfileArgs);

  // Use the correct profiles based on mode
  // PERF: For Phase-1, merge paginated batches in-session; prefetch until first merge commits
  const convexProfiles = isPhase2
    ? phase2Profiles
    : phase1SessionProfiles.length > 0
      ? phase1SessionProfiles
      : phase1ProfilesWithPrefetch;

  // Track Deep Connect profile user so user changes start a new session cleanly.
  const phase2ProfilesUserRef = useRef<string | null>(null);
  if (userId !== phase2ProfilesUserRef.current) {
    phase2ProfilesUserRef.current = userId;
  }

  // P1-003 FIX: Phase-2 — only `undefined` is loading; `[]` is resolved empty (no grace-period fake loading)
  const isPhase2QueryLoading =
    isPhase2 && !isDemoMode && privateDiscoverArgs !== "skip" && phase2Profiles === undefined;

  useEffect(() => {
    if (!isPhase2 || isDemoMode || privateDiscoverArgs === "skip" || !isAuthReadyForQuery) {
      setPhase2QueryTimedOut(false);
      return;
    }
    if (!isPhase2QueryLoading) {
      setPhase2QueryTimedOut(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      if (!mountedRef.current) return;
      setPhase2QueryTimedOut(true);
    }, DEEP_CONNECT_QUERY_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [isAuthReadyForQuery, isDemoMode, isPhase2, isPhase2QueryLoading, privateDiscoverArgs]);

  const effectiveConvexProfiles = convexProfiles;

  const profilesSafe = effectiveConvexProfiles ?? EMPTY_ARRAY;

  // CRITICAL: useMemo prevents new array/object references on every render.
  // Without this, DEMO_PROFILES.map() creates new objects each render,
  // which cascades: new current → new handleSwipe → new animateSwipe → new panResponder
  // → touches dropped between old/new panResponder attachment.
  const latestProfiles: ProfileData[] = useMemo(() => {
    if (externalProfiles) {
      // 3B-6: Filter excluded from external profiles for both demo and live mode
      // (blocked users, matched users, swiped users should not appear in explore categories)
      const filtered = externalProfiles.filter((p: any) => !excludedSet.has(p._id ?? p.id));
      const mapped = filtered.map((p: any) => {
        const normalized = toProfileData(p);

        if (!isPhase2) {
          return normalized;
        }

        return {
          ...normalized,
          city: undefined,
          distance: undefined,
          lastActive: undefined,
          createdAt: undefined,
          photoBlurred: false,
        };
      });

      // Preserve source order for externally supplied decks such as Explore.
      return mapped;
    }
    if (isDemoMode) {
      // Phase-2 demo mode: use DEMO_INCOGNITO_PROFILES (with privateIntentKeys)
      if (isPhase2) {
        return DEMO_INCOGNITO_PROFILES
          .filter((p) => !excludedSet.has(p.id))
          .map((p) => {
            const intentKeys = resolvePhase2IntentKeys(p);
            // DEV assertion: warn if profile has no valid intent keys
            if (DEBUG_DEEPCONNECT_LOGS && (!intentKeys || intentKeys.length === 0)) {
              console.warn('[demo] Missing privateIntentKeys');
            }
            return mapPhase2CardProfile({
              profileId: p.id,
              userId: p.id,
              displayName: p.username,
              age: p.age,
              distance: p.distance,
              bio: p.bio,
              photoUrls: p.photos ?? [p.photoUrl],
              activities: p.interests ?? p.hobbies ?? [],
              isVerified: false,
              intentKeys,
              fallbackIntentKeys: DEFAULT_PHASE2_INTENT_KEYS,
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

    // PHASE-2 ISOLATION FIX: Map Phase-2 profiles to ProfileData format
    // Phase-2 profiles from privateDiscover.getProfiles have different field names
    // SOFT_MATCH_FIX: Allow profiles without photos - use placeholder
    if (isPhase2) {
      // SOFT_MATCH_FIX: Debug logging for profile counts
      const withPhotos = profilesSafe.filter((p: any) => p.blurredPhotoUrls?.length > 0).length;
      const withoutPhotos = profilesSafe.filter((p: any) => !p.blurredPhotoUrls?.length).length;
      const incomplete = profilesSafe.filter((p: any) => !p.isSetupComplete).length;
      if (DEBUG_DEEPCONNECT_LOGS) {
        console.log('[PHASE2_DISCOVER_FE] Profile stats:', { total: profilesSafe.length, withPhotos, withoutPhotos, incomplete });
      }

      return profilesSafe.map((p: any) => {
        const photoUrls = p.blurredPhotoUrls ?? [];
        const resolvedPhase2Name = resolvePhase2CardName(p.displayName);
        const intentKeys = resolvePhase2IntentKeys(p, []);

        if (DEBUG_DEEPCONNECT_LOGS) {
          console.log('[P2_DATA]', { photoCount: photoUrls.length });
        }

        // [P2_PROMPT_DUP] One-shot dev probe — warns when backend
        // promptAnswers contain duplicate promptId values for the same
        // profile. Used to confirm the data-side hypothesis behind the
        // OnePlus prompt-repetition report.
        if (DEBUG_DEEPCONNECT_LOGS && Array.isArray(p.promptAnswers) && p.promptAnswers.length > 1) {
          const seen = new Set<string>();
          const dups: string[] = [];
          for (const ans of p.promptAnswers) {
            const id = ans?.promptId;
            if (!id) continue;
            if (seen.has(id)) dups.push(id);
            else seen.add(id);
          }
          if (dups.length > 0) {
            console.warn(
              '[P2_PROMPT_DUP] duplicate promptIds in profilePrompts:',
              dups,
            );
          }
        }

        return mapPhase2CardProfile({
          profileId: p._id,
          userId: p.userId,
          displayName: p.displayName,
          age: p.age,
          distance: typeof p.distanceKm === 'number' ? p.distanceKm : undefined,
          bio: p.privateBio,
          photoUrls,
          activities: p.hobbies ?? [],
          isVerified: p.isVerified ?? false,
          verificationStatus: (p as any).verificationStatus,
          intentKeys,
          desireTagKeys: Array.isArray(p.desireTagKeys) ? p.desireTagKeys : [],
          gender: p.gender,
          photoBlurEnabled: p.photoBlurEnabled,
          photoBlurSlots: p.photoBlurSlots,
          isSetupComplete: p.isSetupComplete ?? false,
          hasPhotos: p.hasPhotos ?? (photoUrls.length > 0),
          height: p.height ?? null,
          smoking: p.smoking ?? null,
          drinking: p.drinking ?? null,
          education: p.education ?? null,
          religion: p.religion ?? null,
          profilePrompts: p.promptAnswers ?? [],
        });
      });
    }

    // Phase-1 live results are already ranked/sorted by the backend.
    return profilesSafe.map(toProfileData);
  }, [externalProfiles, profilesSafe, demo.profiles, excludedSet, isDemoMode, isPhase2, genderFilter, minAge, maxAge, maxDistance]);

  // Drop profiles with no valid primary photo — prevents blank Discover cards
  // SOFT_MATCH_FIX: For Phase-2, allow profiles without photos (ProfileCard shows placeholder)
  const validProfiles = useMemo(
    () => {
      if (isPhase2) {
        // Phase-2: Allow ALL profiles - ProfileCard will show placeholder for no photos
        // This implements the 90/10 soft matching rule
        if (DEBUG_DEEPCONNECT_LOGS) {
          const withPhotos = latestProfiles.filter((p) => p.photos?.length > 0).length;
          const withoutPhotos = latestProfiles.length - withPhotos;
          console.log('[PHASE2_DISCOVER_FE] Soft match: all', latestProfiles.length, 'profiles kept (', withPhotos, 'with photos,', withoutPhotos, 'without)');
        }
        return latestProfiles;
      }
      // Phase-1: Require at least one renderable photo, not just a valid first slot
      return latestProfiles.filter(
        (p) => Array.isArray(p.photos) && p.photos.some((photo) => typeof photo?.url === "string" && photo.url.length > 0)
      );
    },
    [latestProfiles, isPhase2],
  );

  const {
    viewerUserId: cachedViewerUserId,
    profilesMap: cachedProfilesMap,
    consumedIds: cachedConsumedIds,
    queue: cachedQueue,
    searchingDone: cachedSearchingDone,
    mergeProfiles: mergeCachedProfiles,
    consume: consumeCachedProfile,
    purgeUserIds: purgeCachedUserIds,
    setQueue: setCachedQueue,
    markSearchingDone: markCachedSearchingDone,
    resetForUser: resetPhase2CacheForUser,
    hardReset: hardResetPhase2Cache,
  } = usePhase2DiscoverCacheStore(
    useShallow((s) => ({
      viewerUserId: s.viewerUserId,
      profilesMap: s.profilesMap,
      consumedIds: s.consumedIds,
      queue: s.queue,
      searchingDone: s.searchingDone,
      mergeProfiles: s.mergeProfiles,
      consume: s.consume,
      purgeUserIds: s.purgeUserIds,
      setQueue: s.setQueue,
      markSearchingDone: s.markSearchingDone,
      resetForUser: s.resetForUser,
      hardReset: s.hardReset,
    })),
  );
  // Keep a union of seen Phase-1 profiles to prevent blank-frame flicker.
  const phase1StableProfilesMapRef = useRef<Map<string, ProfileData>>(new Map());
  // FIX: Track userId to invalidate cache when user changes (prevents showing stale profiles)
  const stableUserIdRef = useRef<string | null>(null);
  if (userId !== stableUserIdRef.current) {
    // User changed — clear stale cache to prevent showing old user's excluded profiles
    // FLICKER_FIX: Only clear if there WAS a previous user (not first mount)
    if (stableUserIdRef.current !== null) {
      phase1StableProfilesMapRef.current.clear();
      if (DEBUG_DEEPCONNECT_LOGS && isPhase2) {
        console.log('[DISCOVER_RESET] reason=user_changed');
      }
    }
    stableUserIdRef.current = userId;
  }
  useEffect(() => {
    if (isPhase2) {
      resetPhase2CacheForUser(userId);
    }
  }, [isPhase2, resetPhase2CacheForUser, userId]);
  const phase1DiscoverPaused =
    !isPhase2 &&
    viewerProfile?.isDiscoveryPaused === true &&
    typeof viewerProfile.discoveryPausedUntil === "number" &&
    viewerProfile.discoveryPausedUntil > Date.now();
  const phase1CacheResetKey = useMemo(
    () =>
      JSON.stringify({
        userId: userId ?? null,
        minAge,
        maxAge,
        maxDistance,
        genderFilter,
        sortBy: sortBy ?? "recommended",
        filterVersion,
        paused: phase1DiscoverPaused,
      }),
    [genderFilter, maxAge, maxDistance, minAge, phase1DiscoverPaused, sortBy, userId, filterVersion],
  );
  const prevPhase1CacheResetKeyRef = useRef<string | null>(null);
  if (!isPhase2 && !isDemoMode && !externalProfiles && prevPhase1CacheResetKeyRef.current !== phase1CacheResetKey) {
    if (prevPhase1CacheResetKeyRef.current !== null) {
      phase1StableProfilesMapRef.current.clear();
    }
    prevPhase1CacheResetKeyRef.current = phase1CacheResetKey;
  }
  if (!isPhase2) {
    for (const p of validProfiles) {
      phase1StableProfilesMapRef.current.set(p.id, p);
    }
  }
  const phase2CacheBelongsToViewer = cachedViewerUserId === (userId ?? null);
  const phase2RelationshipSafeValidProfiles = useMemo(
    () =>
      isPhase2
        ? validProfiles.filter((profile) => !isPhase2ConnectedProfile(profile, connectedPhase2UserIds))
        : validProfiles,
    [connectedPhase2UserIds, isPhase2, validProfiles],
  );
  const phase2RenderableCachedProfileCount = useMemo(() => {
    if (!isPhase2 || !phase2CacheBelongsToViewer) return 0;
    let count = 0;
    for (const profile of cachedProfilesMap.values()) {
      if (!cachedConsumedIds.has(profile.id) && !isPhase2ConnectedProfile(profile, connectedPhase2UserIds)) {
        count += 1;
      }
    }
    return count;
  }, [cachedConsumedIds, cachedProfilesMap, connectedPhase2UserIds, isPhase2, phase2CacheBelongsToViewer]);

  useEffect(() => {
    if (!isPhase2) return;
    mergeCachedProfiles(userId, phase2RelationshipSafeValidProfiles);
  }, [isPhase2, mergeCachedProfiles, phase2RelationshipSafeValidProfiles, userId]);

  const phase2ProfilesRaw = useMemo(() => {
    const merged = phase2CacheBelongsToViewer
      ? new Map(cachedProfilesMap)
      : new Map<string, ProfileData>();

    for (const profile of phase2RelationshipSafeValidProfiles) {
      if (!cachedConsumedIds.has(profile.id)) {
        merged.set(profile.id, profile);
      }
    }

    return Array.from(merged.values()).filter(
      (profile) => !isPhase2ConnectedProfile(profile, connectedPhase2UserIds),
    );
  }, [cachedConsumedIds, cachedProfilesMap, connectedPhase2UserIds, phase2CacheBelongsToViewer, phase2RelationshipSafeValidProfiles]);
  const phase1ProfilesRaw = Array.from(phase1StableProfilesMapRef.current.values());
  // FLICKER_FIX: Log when falling back to stable cache
  const usingStableCache = isPhase2
    ? validProfiles.length === 0 && phase2CacheBelongsToViewer && phase2RenderableCachedProfileCount > 0
    : effectiveConvexProfiles === undefined && phase1StableProfilesMapRef.current.size > 0;
  if (DEBUG_DEEPCONNECT_LOGS && isPhase2 && usingStableCache) {
    console.log('[DISCOVER_GUARD] Using stable cache:', phase2RenderableCachedProfileCount, 'profiles (validProfiles was empty)');
  }
  const profilesRaw = isPhase2 ? phase2ProfilesRaw : phase1ProfilesRaw;
  const activeConsumedIds = isPhase2 ? cachedConsumedIds : phase1ConsumedIdsRef.current;

  // FIX: Defensive filter — never show current user's profile in Discover
  // Backend already excludes, but this protects against stale cache contamination
  const profiles = useMemo(
    () =>
      profilesRaw.filter(
        (p) =>
          p.id !== userId &&
          !activeConsumedIds.has(p.id) &&
          !(isPhase2 && isPhase2ConnectedProfile(p, connectedPhase2UserIds)),
      ),
    [activeConsumedIds, connectedPhase2UserIds, isPhase2, profilesRaw, userId],
  );

  // Phase-2 fallback decks (demo/external) still need local filtering.
  // Live Deep Connect results now arrive pre-filtered from the backend.
  const phase2DeckProfiles = useMemo(() => {
    if (!isPhase2 || intentFilters.length === 0) return profiles;
    if (!isDemoMode && !externalProfiles) return profiles;
    return profiles.filter((p) => {
      // Support: privateIntentKeys (new) > intentKeys > privateIntentKey (legacy)
      const profileKeys: string[] =
        p.privateIntentKeys ??
        (p as any).intentKeys ??
        (p.privateIntentKey ? [p.privateIntentKey] : []);
      // Match if any profile intent is in the filter set
      return profileKeys.some(k => intentFilters.includes(k));
    });
  }, [profiles, isPhase2, intentFilters, isDemoMode, externalProfiles]);

  // Reset index when filter changes (always show first matching profile)
  const intentFilterKey = useMemo(() => JSON.stringify([...intentFilters].sort()), [intentFilters]);
  const prevFilterRef = useRef<string | null>(null);
  const phase2InitialFilterCapturedRef = useRef(false);
  const [phase2InitialFilterReady, setPhase2InitialFilterReady] = useState(false);
  // P2-001 FIX: Track pending filter change to apply after swipe completes
  const pendingFilterResetRef = useRef<boolean>(false);
  useEffect(() => {
    if (!isPhase2) {
      phase2InitialFilterCapturedRef.current = false;
      prevFilterRef.current = null;
      setPhase2InitialFilterReady(false);
      return;
    }

    if (!phase2HasHydrated) {
      phase2InitialFilterCapturedRef.current = false;
      prevFilterRef.current = null;
      setPhase2InitialFilterReady(false);
      return;
    }

    if (!phase2InitialFilterCapturedRef.current) {
      // First post-hydration filter observation is the Convex/profile baseline,
      // not a user selection. Do not reset cache or emit analytics here.
      phase2InitialFilterCapturedRef.current = true;
      prevFilterRef.current = intentFilterKey;
      setPhase2InitialFilterReady(true);
      if (DEBUG_DEEPCONNECT_LOGS) {
        console.log('[P2_FILTER_INITIAL_CAPTURE]', {
          intentFilterKey,
          intentFilterCount: intentFilters.length,
        });
      }
      return;
    }

    if (prevFilterRef.current === intentFilterKey) {
      return;
    }

    const shouldDeferReset =
      swipeLockRef.current ||
      showPhaseTransition ||
      navigatingRef.current;
    hardResetPhase2Cache();
    if (!shouldDeferReset) {
      setIndex(0);
      pendingFilterResetRef.current = false;
    } else {
      // P2-001 FIX: Mark that filter changed during swipe, will apply after swipe completes
      pendingFilterResetRef.current = true;
    }
    // Track Phase-2 intent filter selection (use first key for backward compat)
    trackEvent({ name: 'phase2_intent_filter_selected', intentKey: intentFilters[0] ?? 'all' });
    prevFilterRef.current = intentFilterKey;
  }, [hardResetPhase2Cache, intentFilterKey, intentFilters, isPhase2, phase2HasHydrated, showPhaseTransition]);

  // ══════════════════════════════════════════════════════════════════════════
  // STABLE QUEUE MODEL: Prevents back card from changing during swipe animation
  // ══════════════════════════════════════════════════════════════════════════
  // The queue holds profile IDs for the visible cards (front, back, third).
  // It is "frozen" during swipe animation and only advances after swipe completion.
  // This ensures the back card remains stable even if source data changes mid-swipe.

  const QUEUE_SIZE = 3; // Number of cards to buffer
  const phase1VisibleQueueRef = useRef<string[]>([]); // Profile IDs in queue for Phase-1
  const getVisibleQueue = useCallback(
    () => isPhase2 ? usePhase2DiscoverCacheStore.getState().queue : phase1VisibleQueueRef.current,
    [isPhase2],
  );
  const setVisibleQueue = useCallback(
    (ids: string[]) => {
      if (isPhase2) {
        setCachedQueue(ids);
      } else {
        phase1VisibleQueueRef.current = ids;
      }
    },
    [isPhase2, setCachedQueue],
  );
  const getConsumedIds = useCallback(
    () => isPhase2 ? usePhase2DiscoverCacheStore.getState().consumedIds : phase1ConsumedIdsRef.current,
    [isPhase2],
  );
  const consumeProfileId = useCallback(
    (profileId: string) => {
      if (isPhase2) {
        consumeCachedProfile(profileId);
      } else {
        phase1ConsumedIdsRef.current.add(profileId);
      }
    },
    [consumeCachedProfile, isPhase2],
  );

  // P2_CARD_FIX: State trigger to force re-render when queue transitions from empty to populated
  // Refs don't trigger re-renders, so we need this state to ensure the card appears on first load
  const [queueVersion, setQueueVersion] = useState(0);

  // P2_REFETCH_FIX: Track retry attempts to prevent infinite loops
  const refetchRetryCountRef = useRef(0);
  const MAX_REFETCH_RETRIES = 2;
  const prevPhase1QueueResetKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isPhase2 || isDemoMode || externalProfiles) return;

    if (prevPhase1QueueResetKeyRef.current === null) {
      prevPhase1QueueResetKeyRef.current = phase1CacheResetKey;
      return;
    }

    if (prevPhase1QueueResetKeyRef.current !== phase1CacheResetKey) {
      phase1VisibleQueueRef.current = [];
      phase1ConsumedIdsRef.current.clear();
      prevPhase1QueueResetKeyRef.current = phase1CacheResetKey;
      setIndex(0);
      setQueueVersion((version) => version + 1);
      setPhase1FetchOffset(0);
      setPhase1SessionProfiles([]);
      phase1HasMoreRef.current = true;
      return;
    }

    prevPhase1QueueResetKeyRef.current = phase1CacheResetKey;
  }, [externalProfiles, isDemoMode, isPhase2, phase1CacheResetKey]);

  // Source profiles for queue refill (preserve backend order for live Phase-2)
  const baseProfiles = isPhase2 ? phase2DeckProfiles : profiles;
  const sourceProfiles = baseProfiles;

  // Build a map from profile ID to profile data for O(1) lookup
  // FLICKER_FIX: Don't clear map when sourceProfiles is transiently empty
  // This prevents the card from disappearing when query/state briefly resets
  const profileMapRef = useRef<Map<string, ProfileData>>(new Map());
  useMemo(() => {
    // FLICKER_FIX: Only update map if we have profiles - don't clear on empty
    if (sourceProfiles.length === 0) {
      if (DEBUG_DEEPCONNECT_LOGS && isPhase2 && profileMapRef.current.size > 0) {
        console.log('[DISCOVER_GUARD] Ignored empty sourceProfiles overwrite, keeping', profileMapRef.current.size, 'profiles in map');
      }
      return; // Keep existing map data
    }
    // Have new profiles - update the map
    profileMapRef.current.clear();
    for (const p of sourceProfiles) {
      profileMapRef.current.set(p.id, p);
    }
  }, [sourceProfiles, isPhase2]);

  const purgePhase2ProfilesFromDeck = useCallback(
    (ids: Set<string>, reason: "match_result" | "focus_connected") => {
      if (!isPhase2 || ids.size === 0) return 0;

      const idsToPurge = new Set(ids);
      const removedProfileIds = new Set<string>();

      for (const [profileId, profile] of profileMapRef.current) {
        if (idsToPurge.has(profileId) || (profile.userId && idsToPurge.has(profile.userId))) {
          idsToPurge.add(profileId);
          if (profile.userId) {
            idsToPurge.add(profile.userId);
          }
          removedProfileIds.add(profileId);
          profileMapRef.current.delete(profileId);
        }
      }

      const cacheState = usePhase2DiscoverCacheStore.getState();
      for (const [profileId, profile] of cacheState.profilesMap) {
        if (idsToPurge.has(profileId) || (profile.userId && idsToPurge.has(profile.userId))) {
          idsToPurge.add(profileId);
          if (profile.userId) {
            idsToPurge.add(profile.userId);
          }
          removedProfileIds.add(profileId);
        }
      }
      for (const queueId of cacheState.queue) {
        if (idsToPurge.has(queueId)) {
          removedProfileIds.add(queueId);
        }
      }

      purgeCachedUserIds(idsToPurge);

      const removed = removedProfileIds.size;
      if (removed > 0) {
        setQueueVersion((version) => version + 1);
        if (DEBUG_DEEPCONNECT_LOGS) {
          console.log('[P2_CACHE_PURGE_CONNECTED]', `removed=${removed}`, reason);
        }
      }

      return removed;
    },
    [isPhase2, purgeCachedUserIds],
  );

  const triggerPhase2Refresh = useCallback(
    (source: "button" | "pull" = "button") => {
      if (!isPhase2 || externalProfiles) return;

      if (source === "button" || source === "pull") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }

      if (isDemoMode) {
        useDemoStore.getState().clearSwipedProfiles();
        useDemoStore.getState().resetDiscoverPool();
        hardResetPhase2Cache();
        setIndex(0);
        setQueueVersion((version) => version + 1);
        return;
      }

      if (skipInternalQuery || !convexUserId || !isAuthReadyForQuery) {
        return;
      }

      hardResetPhase2Cache();
      profileMapRef.current.clear();
      refetchRetryCountRef.current = 0;
      setIndex(0);
      setQueueVersion((version) => version + 1);
      setPhase2QueryTimedOut(false);
      setIsRefreshingPhase2Deck(true);
      setPhase2QueryPaused(true);

      setTimeout(() => {
        if (!mountedRef.current) return;
        setPhase2QueryPaused(false);
      }, 32);
    },
    [convexUserId, externalProfiles, hardResetPhase2Cache, isAuthReadyForQuery, isDemoMode, isPhase2, skipInternalQuery],
  );

  const sanitizeQueue = useCallback(() => {
    if (isPhase2) return false;

    const currentQueue = getVisibleQueue();
    if (currentQueue.length === 0) return false;

    const validIds = new Set(sourceProfiles.map((p) => p.id));
    const consumed = getConsumedIds();
    const seen = new Set<string>();
    const sanitizedQueue: string[] = [];

    for (const id of currentQueue) {
      if (seen.has(id)) continue;
      if (!validIds.has(id)) continue;
      if (consumed.has(id)) continue;
      if (id === userId) continue;
      seen.add(id);
      sanitizedQueue.push(id);
    }

    const changed =
      sanitizedQueue.length !== currentQueue.length ||
      sanitizedQueue.some((id, idx) => id !== currentQueue[idx]);

    if (changed) {
      setVisibleQueue(sanitizedQueue);
    }

    return changed;
  }, [getConsumedIds, getVisibleQueue, isPhase2, setVisibleQueue, sourceProfiles, userId]);

  /**
   * Refill the visible queue from source profiles.
   * Only adds profiles that are:
   * - Not already in the queue
   * - Not already consumed (swiped)
   * - Not the current user
   */
  const refillQueue = useCallback(() => {
    const sanitized = sanitizeQueue();
    const queue = getVisibleQueue();
    const consumed = getConsumedIds();
    const needed = QUEUE_SIZE - queue.length;
    if (needed <= 0) return sanitized;

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
      const wasEmpty = queue.length === 0;
      setVisibleQueue([...queue, ...toAdd]);

      // P2_CARD_FIX: Force re-render when queue transitions from empty to populated
      // This ensures the first card renders on first open
      if (wasEmpty) {
        // LOG_NOISE_FIX: Gated behind DEBUG_DISCOVER_QUEUE
        if (__DEV__ && DEBUG_DISCOVER_QUEUE && isPhase2) {
          console.log(`[QUEUE] init: added ${toAdd.length} profiles`);
        }
        setQueueVersion(v => v + 1);
      }
      return true;
    }
    return sanitized;
  }, [getConsumedIds, getVisibleQueue, sanitizeQueue, setVisibleQueue, sourceProfiles, userId, isPhase2]);

  /**
   * Advance the queue after swipe completion.
   * Removes the front card, marks it as consumed, and refills.
   */
  const advanceQueue = useCallback(() => {
    const queue = getVisibleQueue();
    if (queue.length === 0) return;

    // Mark front card as consumed
    const consumedId = queue[0];
    consumeProfileId(consumedId);

    // Remove front card from queue
    setVisibleQueue(queue.slice(1));

    // Refill queue with next available profiles
    refillQueue();

    // LOG_NOISE_FIX: Queue state logging gated behind DEBUG_DISCOVER_QUEUE
    const newQueueLength = getVisibleQueue().length;
    if (__DEV__ && DEBUG_DISCOVER_QUEUE && isPhase2) {
      console.log(`[QUEUE] len=${newQueueLength} consumed=${getConsumedIds().size}`);
    }

    // P2_REFETCH_FIX: If queue is empty after refill, trigger retry mechanism
    if (newQueueLength === 0 && isPhase2) {
      if (refetchRetryCountRef.current < MAX_REFETCH_RETRIES) {
        refetchRetryCountRef.current++;
        // LOG_NOISE_FIX: Keep refetch logs as they indicate important state transitions
        if (__DEV__ && DEBUG_DISCOVER_QUEUE) {
          console.log(`[REFETCH] retry ${refetchRetryCountRef.current}/${MAX_REFETCH_RETRIES}`);
        }
        // Force a queueVersion bump after a short delay to trigger re-render
        // This gives the Convex subscription time to update with new profiles
        setTimeout(() => {
          // Re-run refillQueue with potentially updated sourceProfiles
          refillQueue();
          // If still empty, bump version to force UI update
          if (getVisibleQueue().length === 0) {
            setQueueVersion(v => v + 1);
          }
        }, 500);
      } else if (__DEV__ && DEBUG_DISCOVER_QUEUE) {
        console.log('[REFETCH] exhausted - no more profiles');
      }
    }
  }, [consumeProfileId, getConsumedIds, getVisibleQueue, refillQueue, isPhase2, setVisibleQueue, sourceProfiles]);

  // Refill queue when source data changes AND no swipe is in progress
  // This ensures the queue is populated but doesn't change mid-swipe
  useEffect(() => {
    // Don't refill during active swipe
    if (swipeLockRef.current) return;

    // P2_REFETCH_FIX: Cleanup consumed IDs that are no longer in sourceProfiles
    // This handles the case where backend has removed swiped profiles from results
    if (!isPhase2 && sourceProfiles.length > 0) {
      const sourceIdSet = new Set(sourceProfiles.map(p => p.id));
      const consumed = phase1ConsumedIdsRef.current;
      const toRemove: string[] = [];
      for (const id of consumed) {
        if (!sourceIdSet.has(id)) {
          toRemove.push(id);
        }
      }
      if (toRemove.length > 0) {
        for (const id of toRemove) {
          consumed.delete(id);
        }
        // LOG_NOISE_FIX: Gated cleanup log
        if (__DEV__ && DEBUG_DISCOVER_QUEUE) {
          console.log(`[QUEUE] cleanup: removed ${toRemove.length} stale IDs`);
        }
      }
    }

    const queueChanged = refillQueue();

    if (!isPhase2 && queueChanged) {
      setIndex((prev) => prev + 1);
    }

    // P2_REFETCH_FIX: If queue is now populated, reset retry count
    if (getVisibleQueue().length > 0) {
      refetchRetryCountRef.current = 0;
    }
  }, [getVisibleQueue, sourceProfiles, refillQueue, isPhase2]);

  // Reset queue when user changes (prevents showing stale profiles)
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== userId) {
      // User changed — clear queue and consumed IDs
      if (isPhase2) {
        resetPhase2CacheForUser(userId);
      } else {
        phase1VisibleQueueRef.current = [];
        phase1ConsumedIdsRef.current.clear();
      }
      setPhase1FetchOffset(0);
      setPhase1SessionProfiles([]);
      phase1HasMoreRef.current = true;
    }
    prevUserIdRef.current = userId;
  }, [isPhase2, resetPhase2CacheForUser, userId]);

  // Get current/next from the STABLE QUEUE (not from live array indices)
  // P2_CARD_FIX: queueVersion dependency ensures this re-computes after queue populates
  const visibleQueue = isPhase2 ? cachedQueue : phase1VisibleQueueRef.current;
  const currentQueueId = visibleQueue[0];
  const nextQueueId = visibleQueue[1];
  const queueCurrent = currentQueueId ? profileMapRef.current.get(currentQueueId) : undefined;
  const queueNext = nextQueueId ? profileMapRef.current.get(nextQueueId) : undefined;

  // LOG_NOISE_FIX: Very noisy log - removed (fires every render)

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
    if (isPhase2) {
      hardResetPhase2Cache();
    } else {
      phase1VisibleQueueRef.current = [];
      phase1ConsumedIdsRef.current.clear();
    }
  }, [externalProfiles, hardResetPhase2Cache, isPhase2, profiles.length]);

  // Profile completion nudge DISABLED on Discover screen
  // Nudges should only appear on Profile/Edit Profile screens (not swiping context)

  // Phase-1 swipe mutation (likes table, Phase-1 discovery)
  // 🔒 LOCKED: Do not change swipe mutation wiring without audit approval
  const phase1SwipeMutation = useMutation(api.likes.swipe);
  // Phase-2 Deep Connect: privateLikes / privateMatches / privateConversations (privateSwipes.ts)
  const phase2SwipeMutation = useMutation(api.privateSwipes.swipe);
  // Phase-2 only: Impression recording for ranking system
  const recordImpressionsMutation = useMutation(api.privateDiscover.recordDeepConnectImpressions);

  // Two-pan alternating approach with Reanimated shared values
  const panAX = useSharedValue(0);
  const panAY = useSharedValue(0);
  const panBX = useSharedValue(0);
  const panBY = useSharedValue(0);
  const activeSlotRef = useRef<0 | 1>(0);
  // SharedValue mirror of activeSlotRef for worklet access (refs cannot be read in worklets)
  const activeSlotShared = useSharedValue<0 | 1>(0);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);

  // Helper to get the active pan shared values (for JS thread use only)
  const getActivePanX = () => (activeSlotRef.current === 0 ? panAX : panBX);
  const getActivePanY = () => (activeSlotRef.current === 0 ? panAY : panBY);

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
      // P2-1: Keep React-state mirror in sync when focus resets the lock,
      // otherwise the action buttons could remain visually disabled after
      // a navigation away+back if a stale swipe was still pending.
      setIsSwipeInFlight(false);

      const now = Date.now();
      const shouldRefreshLocation =
        isPhase2 ||
        !hasUsableLocationCache() ||
        now - lastPhase1LocationRefreshAtRef.current >= PHASE1_LOCATION_FOCUS_REVISIT_GAP_MS;

      // SCREEN_FOCUS_REFRESH: Keep Phase-2 behavior unchanged, but skip
      // quick Phase-1 revisits when a usable cached location already exists.
      if (!isRefreshingLocationRef.current && shouldRefreshLocation) {
        isRefreshingLocationRef.current = true;
        if (!isPhase2) {
          lastPhase1LocationRefreshAtRef.current = now;
        }
        refreshLocationCached({ allowBackgroundFreshen: true }).finally(() => {
          isRefreshingLocationRef.current = false;
        });
        if (DEBUG_DEEPCONNECT_LOGS || (__DEV__ && !isPhase2)) {
          console.log('[SCREEN_FOCUS_REFRESH]', isPhase2 ? 'DeepConnect' : 'Discover', 'focus gained');
        }
      }
    } else {
      isFocusedRef.current = false;
      // RACE FIX: Increment swipeId to invalidate any in-flight async callbacks
      // from the previous focus session. Their releaseSwipeLock(oldId) calls will no-op.
      swipeIdRef.current += 1;
      swipeLockRef.current = false;
      // P2-1: Mirror the lock reset to React state so buttons aren't left
      // disabled across blur→focus cycles.
      setIsSwipeInFlight(false);
      pendingPhase2SwipeRef.current = null;
      reconciledPhase2SwipeIdsRef.current.clear();
      // Reset all shared values on blur
      panAX.value = 0;
      panAY.value = 0;
      panBX.value = 0;
      panBY.value = 0;
      overlayOpacity.value = 0;
      overlayDirectionRef.current = null;
    }
  // Shared values are stable across renders, so only isFocused drives this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  useEffect(() => {
    if (!isPhase2 || !isFocused || connectedPhase2UserIds.size === 0) return;
    purgePhase2ProfilesFromDeck(connectedPhase2UserIds, "focus_connected");
  }, [connectedPhase2UserIds, isFocused, isPhase2, purgePhase2ProfilesFromDeck]);

  // Get current active pan values based on slot
  const activePanX = activeSlot === 0 ? panAX : panBX;
  const activePanY = activeSlot === 0 ? panAY : panBY;

  // Card animated style - runs on UI thread (premium rotation + position)
  const cardAnimatedStyle = useAnimatedStyle(() => {
    // Premium rotation: subtle tilt based on horizontal drag
    const rotation = interpolate(
      activePanX.value,
      [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
      [-SWIPE_CONFIG.ROTATION_ANGLE, 0, SWIPE_CONFIG.ROTATION_ANGLE],
      Extrapolation.CLAMP
    );
    // Slight scale reduction when dragging for depth feel
    const dragDistance = Math.sqrt(
      activePanX.value * activePanX.value + activePanY.value * activePanY.value
    );
    const scale = interpolate(
      dragDistance,
      [0, SCREEN_WIDTH * 0.5],
      [1, 0.98],
      Extrapolation.CLAMP
    );
    return {
      transform: [
        { translateX: activePanX.value },
        { translateY: activePanY.value },
        { rotate: `${rotation}deg` },
        { scale },
      ],
    };
  });

  const phase2RefreshHintAnimatedStyle = useAnimatedStyle(() => {
    const activeY = activePanY.value;
    const pullProgress = Math.max(0, Math.min(activeY / DEEP_CONNECT_PULL_REFRESH_MIN_DISTANCE, 1));
    const restingOpacity = isRefreshingPhase2Deck ? 0.96 : pullProgress * 0.96;
    const restingScale = isRefreshingPhase2Deck
      ? 1
      : interpolate(pullProgress, [0, 1], [0.92, 1], Extrapolation.CLAMP);
    const restingTranslateY = isRefreshingPhase2Deck
      ? 10
      : interpolate(pullProgress, [0, 1], [-18, 10], Extrapolation.CLAMP);

    return {
      opacity: restingOpacity,
      transform: [{ translateY: restingTranslateY }, { scale: restingScale }],
    };
  }, [isRefreshingPhase2Deck]);

  // Next card animated style - premium stack depth effect
  // Card behind scales up and moves up as top card is dragged away
  const nextCardAnimatedStyle = useAnimatedStyle(() => {
    const dragDistance = Math.abs(activePanX.value) + Math.abs(activePanY.value) * 0.5;
    // Scale from 0.94 → 1.0 as top card moves away
    const scale = interpolate(
      dragDistance,
      [0, SCREEN_WIDTH * 0.4],
      [SWIPE_CONFIG.NEXT_CARD_SCALE, 1],
      Extrapolation.CLAMP
    );
    // Translate up slightly as it scales
    const translateY = interpolate(
      dragDistance,
      [0, SCREEN_WIDTH * 0.4],
      [SWIPE_CONFIG.NEXT_CARD_OFFSET_Y, 0],
      Extrapolation.CLAMP
    );
    // Slight opacity increase for polish
    const opacity = interpolate(
      dragDistance,
      [0, SCREEN_WIDTH * 0.3],
      [0.92, 1],
      Extrapolation.CLAMP
    );
    return {
      transform: [
        { scale },
        { translateY },
      ],
      opacity,
    };
  });

  // STABLE QUEUE: Use queue-based current/next instead of index-based access
  // This ensures the back card doesn't change during swipe animation
  const current = queueCurrent; // From stable queue
  const next = queueNext; // From stable queue

  // Step 9 (Phase-1): live GPS distance when device + candidate coords exist; else backend distance
  const phase1LiveDistance = useLiveDistance(
    !isPhase2 ? current?.latitude : undefined,
    !isPhase2 ? current?.longitude : undefined,
  );
  const displayDistanceCurrentCard =
    isPhase2
      ? current?.distance
      : phase1LiveDistance !== undefined
        ? phase1LiveDistance
        : current?.distance;
  const lastPhase1DistanceDebugRef = useRef<string | null>(null);

  useEffect(() => {
    if (!__DEV__ || isPhase2 || !current) return;

    const currentWithPrivacy = current as typeof current & {
      distanceHidden?: boolean;
      hideDistance?: boolean;
    };
    const hasBackendDistance =
      typeof current.distance === 'number' && Number.isFinite(current.distance);
    const hasLiveDistance =
      typeof phase1LiveDistance === 'number' && Number.isFinite(phase1LiveDistance);
    const hasDistancePassedToProfileCard =
      typeof displayDistanceCurrentCard === 'number' &&
      Number.isFinite(displayDistanceCurrentCard);
    const candidateHasCoordinates =
      typeof current.latitude === 'number' && Number.isFinite(current.latitude) &&
      typeof current.longitude === 'number' && Number.isFinite(current.longitude);
    const payload = {
      userId: current.userId ?? current.id,
      hasBackendDistance,
      backendDistanceValue: getDistanceDebugValue(current.distance),
      hasLiveDistance,
      hasDistancePassedToProfileCard,
      distancePassedToProfileCard: getDistanceDebugValue(displayDistanceCurrentCard),
      hideDistance:
        typeof currentWithPrivacy.hideDistance === 'boolean'
          ? currentWithPrivacy.hideDistance
          : undefined,
      distanceHidden:
        typeof currentWithPrivacy.distanceHidden === 'boolean'
          ? currentWithPrivacy.distanceHidden
          : undefined,
      candidateHasCoordinates,
    };
    const debugKey = JSON.stringify(payload);
    if (lastPhase1DistanceDebugRef.current === debugKey) return;
    lastPhase1DistanceDebugRef.current = debugKey;
    console.log('[P1_DISTANCE_DEBUG][stack]', payload);
  }, [
    current,
    displayDistanceCurrentCard,
    isPhase2,
    phase1LiveDistance,
  ]);

  // P0 UNIFIED PRESENCE: Batch query for current and next profile presence
  // Use userId or id (both should map to Convex user ID)
  const presenceUserIds = useMemo(() => {
    const ids: Id<'users'>[] = [];
    if (current?.userId || current?.id) {
      ids.push((current.userId || current.id) as Id<'users'>);
    }
    if (isPhase2 && (next?.userId || next?.id)) {
      ids.push((next.userId || next.id) as Id<'users'>);
    }
    return ids;
  }, [current?.userId, current?.id, isPhase2, next?.userId, next?.id]);

  const batchPresence = useBatchPresence(
    !isDemoMode && presenceUserIds.length > 0 ? presenceUserIds : null,
    { respectPrivacy: !isPhase2 }
  );

  // Get presence status for current and next profiles
  const currentPresenceStatus = useMemo(() => {
    if (!batchPresence || !current) return undefined;
    const id = current.userId || current.id;
    return batchPresence[id]?.status;
  }, [batchPresence, current?.userId, current?.id]);

  const nextPresenceStatus = useMemo(() => {
    if (!batchPresence || !next) return undefined;
    const id = next.userId || next.id;
    return batchPresence[id]?.status;
  }, [batchPresence, next?.userId, next?.id]);

  // Track when stack becomes empty (for onStackEmpty callback)
  const hadProfilesRef = useRef(false);
  const stackEmptyCalledRef = useRef(false);
  useEffect(() => {
    if (current) {
      hadProfilesRef.current = true;
      stackEmptyCalledRef.current = false;
    } else if (hadProfilesRef.current && !stackEmptyCalledRef.current && onStackEmpty) {
      stackEmptyCalledRef.current = true;
      onStackEmpty();
    }
  }, [current, onStackEmpty]);

  // Trust badges — memoized per profile to avoid allocation each render
  // P0 UNIFIED PRESENCE: Now uses presenceStatus instead of lastActive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const currentBadges = useMemo(
    () => current ? getTrustBadges({ isVerified: current.isVerified, presenceStatus: currentPresenceStatus, photoCount: current.photos?.length, bio: current.bio }) : [],
    [current?.id, currentPresenceStatus],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nextBadges = useMemo(
    () =>
      isPhase2 && next
        ? getTrustBadges({ isVerified: next.isVerified, presenceStatus: nextPresenceStatus, photoCount: next.photos?.length, bio: next.bio })
        : EMPTY_ARRAY,
    [isPhase2, next?.id, nextPresenceStatus],
  );
  const viewerProfileForCard = useMemo(
    () =>
      !isPhase2 && viewerProfile
        ? {
            activities: viewerProfile.activities,
            relationshipIntent: viewerProfile.relationshipIntent,
            lookingFor: viewerProfile.lookingFor,
            smoking: viewerProfile.smoking,
            drinking: viewerProfile.drinking,
            height: viewerProfile.height,
          }
        : undefined,
    [
      isPhase2,
      viewerProfile?.activities,
      viewerProfile?.relationshipIntent,
      viewerProfile?.lookingFor,
      viewerProfile?.smoking,
      viewerProfile?.drinking,
      viewerProfile?.height,
    ],
  );
  const currentIntentKeys = useMemo(
    () =>
      current?.privateIntentKeys ??
      (current as any)?.intentKeys ??
      (current?.privateIntentKey ? [current.privateIntentKey] : EMPTY_STRING_ARRAY),
    [current],
  );
  const nextIntentKeys = useMemo(
    () =>
      isPhase2
        ? next?.privateIntentKeys ??
          (next as any)?.intentKeys ??
          (next?.privateIntentKey ? [next.privateIntentKey] : EMPTY_STRING_ARRAY)
        : EMPTY_STRING_ARRAY,
    [isPhase2, next],
  );

  // Hero prefetch depth 2: warm both the immediate next card AND the one after
  // it. Fast successive swipes can otherwise outrun a depth-1 prefetch and
  // show a momentary photo decode on the new top card. Phase-2 (Deep Connect)
  // is now included — the prior null-out for Phase-2 is removed so Deep
  // Connect benefits from the same warming.
  const nextHeroPhotoUrl = useMemo(
    () => (next ? getRenderableProfilePhotos(next.photos)[0]?.url ?? null : null),
    [next],
  );
  const currentHeroPhotoUrl = useMemo(
    () => (current ? getRenderableProfilePhotos(current.photos)[0]?.url ?? null : null),
    [current],
  );
  const [phase2TopCardMediaReady, setPhase2TopCardMediaReady] = useState(true);
  const phase2TopCardReady = !isPhase2 || !current || phase2TopCardMediaReady;

  // next+1 hero (one card behind the next card). Pulled from the same stable
  // queue/profileMap that drives queueCurrent / queueNext.
  const nextNextHeroPhotoUrl = useMemo(() => {
    const id = visibleQueue[2];
    if (!id) return null;
    const profile = profileMapRef.current.get(id);
    if (!profile) return null;
    return getRenderableProfilePhotos(profile.photos)[0]?.url ?? null;
  }, [visibleQueue]);

  useEffect(() => {
    const urls = [nextHeroPhotoUrl, nextNextHeroPhotoUrl].filter(
      (u): u is string => typeof u === 'string' && u.length > 0,
    );
    for (const url of urls) {
      if (prefetchedNextHeroUrlsRef.current.has(url)) continue;
      prefetchedNextHeroUrlsRef.current.add(url);
      Image.prefetch(url).catch(() => {
        prefetchedNextHeroUrlsRef.current.delete(url);
      });
    }
  }, [nextHeroPhotoUrl, nextNextHeroPhotoUrl]);

  useEffect(() => {
    if (!isPhase2 || !current || !currentHeroPhotoUrl) {
      setPhase2TopCardMediaReady(true);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setPhase2TopCardMediaReady(true);
    }, 2500);

    setPhase2TopCardMediaReady(false);
    Image.prefetch(currentHeroPhotoUrl)
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        clearTimeout(timeout);
        setPhase2TopCardMediaReady(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [isPhase2, current?.id, currentHeroPhotoUrl]);

  // P2-4: Prefetch the CURRENT card's remaining photos (beyond the hero) so
  // that tapping into the full profile / swiping between photos does not
  // stall on cold-cached images. The hero is already rendered by the card
  // itself, so we skip index 0 and cap prefetch to a few photos to avoid
  // wasteful bandwidth.
  const currentFullPhotoUrls = useMemo(() => {
    if (isPhase2 || !current) return EMPTY_STRING_ARRAY;
    const urls = getRenderableProfilePhotos(current.photos)
      .map((p) => p.url)
      .filter((url) => typeof url === 'string' && url.length > 0)
      .slice(1, 6); // Skip hero (index 0), cap at 5 additional photos
    return urls.length > 0 ? urls : EMPTY_STRING_ARRAY;
  }, [isPhase2, current]);

  // [PHOTO_DEBUG] P0: verify backendCount === renderCount on Discover cards.
  // Gated behind an explicit dev flag (EXPO_PUBLIC_DEBUG_PHOTOS=true) so it
  // does not fire on every render during normal dev/profiling. Re-enable
  // locally when validating photo render counts.
  if (
    __DEV__ &&
    current &&
    process.env.EXPO_PUBLIC_DEBUG_PHOTOS === 'true'
  ) {
    const rendered = getRenderableProfilePhotos(current.photos);
    console.log('[PHOTO_DEBUG][discover]', {
      userId: current.id,
      backendCount: Array.isArray(current.photos) ? current.photos.length : 0,
      renderCount: rendered.length,
      photoCountField: (current as any).photoCount,
    });
  }

  useEffect(() => {
    if (currentFullPhotoUrls.length === 0) return;
    for (const url of currentFullPhotoUrls) {
      if (prefetchedNextHeroUrlsRef.current.has(url)) continue;
      prefetchedNextHeroUrlsRef.current.add(url);
      Image.prefetch(url).catch(() => {
        prefetchedNextHeroUrlsRef.current.delete(url);
      });
    }
  }, [currentFullPhotoUrls]);

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
      (current.privateIntentKey && String(current.privateIntentKey) !== 'undefined' ? [current.privateIntentKey] : [DEFAULT_INTENT_KEY]);
    trackEvent({
      name: 'phase2_profile_viewed',
      profileId: current.id,
      privateIntentKey: intentKeys[0] ?? DEFAULT_INTENT_KEY, // Never send undefined
    });
  }, [isPhase2, current?.id]);

  // Phase-2 only: Record impressions when the top card becomes visible.
  const recordedTopImpressionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPhase2 || isDemoMode || !userId || !token || !current) return;

    const currentViewedUserId = (current.userId ?? current.id) as Id<'users'> | undefined;
    if (!currentViewedUserId) return;

    const signature = `${userId}:${currentViewedUserId}`;
    if (recordedTopImpressionRef.current === signature) return;
    recordedTopImpressionRef.current = signature;

    recordImpressionsMutation({
      token,
      viewedUserIds: [currentViewedUserId],
      authUserId: userId,
    }).catch((error) => {
      if (__DEV__) {
        console.warn('[DEEPCONNECT_IMPRESSION_FAIL]', error?.message ?? error);
      }
    });
  }, [isPhase2, isDemoMode, userId, token, current?.userId, current?.id, recordImpressionsMutation]);

  // Stable refs for panResponder callbacks — prevents panResponder recreation
  // when current/handleSwipe/animateSwipe change between renders.
  const currentRef = useRef(current);
  currentRef.current = current;

  // Stable callback for opening profile — uses ref so it never changes identity
  // Phase-1 and Phase-2 now use SEPARATE routes for profile viewing
  const openProfileCb = useCallback(() => {
    const c = currentRef.current;
    if (!c) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // LOG_NOISE_FIX: Removed verbose profile open log

    // Track profile opened for user journey replay
    if (isPhase2) {
      trackAction('profile_opened', {
        userId: (c.userId || c.id)?.slice(-8),
        name: c.name,
      });
    }

    if (isPhase2) {
      // Phase-2: Use dedicated Phase-2 profile route (no Phase-1 leakage)
      // ISOLATION FIX: Use p2-profile to avoid URL collision with Phase-1 profile
      const profileUserId = c.userId || c.id; // Prefer userId, fallback to id
      router.push(`/(main)/(private)/p2-profile/${profileUserId}` as any);
    } else {
      const isExploreDeck = !!externalProfiles;
      const source = isExploreDeck ? 'phase1_explore' : 'phase1_discover';
      const scopeQuery = isExploreDeck && profileActionScope
        ? `&actionScope=${encodeURIComponent(profileActionScope)}`
        : '';
      router.push(`/(main)/profile/${c.id}?source=${source}${scopeQuery}` as any);
    }
  }, [externalProfiles, isPhase2, mode, profileActionScope]);

  useEffect(() => {
    if (!discoverProfileActionResult || isPhase2) return;
    if (externalProfiles) {
      if (discoverProfileActionResult.source !== "phase1_explore_profile") return;
      if (!profileActionScope || discoverProfileActionResult.scopeKey !== profileActionScope) return;
    } else if (discoverProfileActionResult.source !== "phase1_discover_profile") {
      return;
    }

    const { profileId } = discoverProfileActionResult;
    const queueBefore = phase1VisibleQueueRef.current;

    if (!queueBefore.includes(profileId) && phase1ConsumedIdsRef.current.has(profileId)) {
      setDiscoverProfileActionResult(null);
      return;
    }

    let queueChanged = false;
    phase1ConsumedIdsRef.current.add(profileId);
    const queueAfterRemoval = queueBefore.filter((id) => id !== profileId);
    queueChanged = queueAfterRemoval.length !== queueBefore.length;
    phase1VisibleQueueRef.current = queueAfterRemoval;
    if (refillQueue()) {
      queueChanged = true;
    }
    if (queueChanged) {
      setIndex((prev) => prev + 1);
    }
    setDiscoverProfileActionResult(null);
  }, [discoverProfileActionResult, externalProfiles, isPhase2, profileActionScope, refillQueue, setDiscoverProfileActionResult]);

  const resetPosition = useCallback(() => {
    const currentPanX = getActivePanX();
    const currentPanY = getActivePanY();
    // Premium spring animation: snappy bounce-back with subtle overshoot
    currentPanX.value = withSpring(0, {
      damping: SWIPE_CONFIG.SPRING_DAMPING,
      stiffness: SWIPE_CONFIG.SPRING_STIFFNESS,
      mass: 0.8,
    });
    currentPanY.value = withSpring(0, {
      damping: SWIPE_CONFIG.SPRING_DAMPING,
      stiffness: SWIPE_CONFIG.SPRING_STIFFNESS,
      mass: 0.8,
    });
    overlayDirectionRef.current = null;
    // Fade out overlay smoothly
    overlayOpacity.value = withTiming(0, { duration: 150 });
    setOverlayDirection(null);
  }, [panAX, panAY, panBX, panBY, overlayOpacity]);

  const advanceCard = useCallback(() => {
    const newSlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    activeSlotRef.current = newSlot;
    // Keep SharedValue in sync for worklet access
    activeSlotShared.value = newSlot;
    // Reset the new active slot's pan values
    if (newSlot === 0) {
      panAX.value = 0;
      panAY.value = 0;
    } else {
      panBX.value = 0;
      panBY.value = 0;
    }
    overlayOpacity.value = 0;
    overlayDirectionRef.current = null;
    // Visual swap (overlay clear, slot swap, queue advance) MUST stay in the
    // same tick so the next card appears immediately and queue invariants
    // hold for fast successive swipes.
    setOverlayDirection(null);
    setActiveSlot(newSlot);
    setIndex((prev) => prev + 1);
    // STABLE QUEUE: Advance the queue after swipe
    // This removes front card, promotes back -> front, and refills from source
    advanceQueue();

    // Engagement-side effects (analytics + toast) are NOT visual. Defer them
    // by one frame so they don't pile onto the swap tick — this measurably
    // reduces the one-frame stutter at the moment the new top card paints.
    // Safe: trackSwipe is a Zustand action; Toast.show is fire-and-forget.
    requestAnimationFrame(() => {
      trackSwipe();
      if (shouldShowSwipeProgress()) {
        Toast.show("You're exploring fast 🔥");
      }
    });
    // Old pan is reset in the useEffect below, AFTER React has re-rendered
    // with the new activeSlot. This prevents a 1-frame flicker where the
    // swiped-away card snaps back to center before the slot switch renders.
  }, [panAX, panAY, panBX, panBY, overlayOpacity, activeSlotShared, advanceQueue, trackSwipe, shouldShowSwipeProgress]);

  useEffect(() => {
    if (!isPhase2 || isDemoMode) return;

    const pendingSwipe = pendingPhase2SwipeRef.current;
    if (!pendingSwipe) return;
    if (current?.id !== pendingSwipe.profileId) return;

    const stillInFeed = sourceProfiles.some((profile) => profile.id === pendingSwipe.profileId);
    if (stillInFeed) return;

    pendingPhase2SwipeRef.current = null;
    reconciledPhase2SwipeIdsRef.current.add(pendingSwipe.swipeId);
    advanceCard();
    releaseSwipeLock(pendingSwipe.swipeId);
  }, [isPhase2, isDemoMode, current?.id, sourceProfiles, advanceCard, releaseSwipeLock]);

  // Reset the now-inactive pan AFTER React commits the new activeSlot.
  // This avoids the race where requestAnimationFrame fires before the
  // batched state update, causing the old card to flash at center.
  useEffect(() => {
    if (activeSlot === 0) {
      panBX.value = 0;
      panBY.value = 0;
    } else {
      panAX.value = 0;
      panAY.value = 0;
    }
  }, [activeSlot, panAX, panAY, panBX, panBY]);

  const handleSwipe = useCallback(
    async (direction: "left" | "right" | "up", message?: string, swipeId?: number) => {
      // RACE FIX: Use provided swipeId, or current if not provided (backward compat)
      const activeSwipeId = swipeId ?? swipeIdRef.current;
      // P1-001 FIX: Track if release was deferred to prevent double-release in finally
      let releaseDeferredToCallback = false;

      // Guard: unmounted or unfocused
      if (!mountedRef.current || !isFocusedRef.current) { releaseSwipeLock(activeSwipeId); return; }
      // Guard: navigation in progress
      if (navigatingRef.current) { releaseSwipeLock(activeSwipeId); return; }

      // Read the swiped profile from ref (stable, not from closure)
      const swipedProfile = currentRef.current;
      if (!swipedProfile) { releaseSwipeLock(activeSwipeId); return; }

      if (isPhase2 && !phase2TopCardReady) {
        resetPosition();
        releaseSwipeLock(activeSwipeId);
        return;
      }

      // Check daily limits — release lock and bail without advancing
      if (direction === "right" && hasReachedLikeLimit()) { releaseSwipeLock(activeSwipeId); return; }
      if (direction === "up" && hasReachedStandOutLimit()) { releaseSwipeLock(activeSwipeId); return; }

      // Phase-1 live: advance only after backend success (matches Phase-2 live). Demo stays optimistic.
      const shouldAdvanceOptimistically = isDemoMode;
      if (shouldAdvanceOptimistically) {
        advanceCard();
      }

      // Task 3: Light haptic feedback on swipe
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (shouldAdvanceOptimistically) {
        if (direction === "right") incrementLikes();
        if (direction === "up") incrementStandOuts();
      }

      try {
        if (isDemoMode) {
          // 3B-1: Record swipe to prevent profile from reappearing
          demo.recordSwipe(swipedProfile.id);

          // Match probability: DEMO_MATCH_RATE (20% for realistic testing)
          const shouldMatch = direction === "right" && Math.random() < DEMO_MATCH_RATE;

          if (shouldMatch) {
            if (isPhase2) {
              // Phase 2: Create private conversation, NO navigation (stay on Deep Connect)
              const isNewMatch = handlePhase2Match({
                id: swipedProfile.id,
                name: swipedProfile.name,
                age: swipedProfile.age,
                photoUrl: swipedProfile.photos?.[0]?.url,
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
            // P1-001 FIX: Mark that release will happen in deferred callback
            releaseDeferredToCallback = true;
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

        if (!convexUserId || (isPhase2 && !isDemoMode && !token)) { releaseSwipeLock(activeSwipeId); return; }
        const action: SwipeAction = direction === "left" ? "pass" : direction === "up" ? "super_like" : "like";

        // Track swipe action for user journey replay
        if (isPhase2) {
          trackAction(`swipe_${action}`, {
            profileId: swipedProfile.id?.slice(-8),
            name: swipedProfile.name,
          });
        }

        const SWIPE_TIMEOUT_MS = 6000;

        // PHASE-2 ID FIX: privateSwipes.swipe expects v.id('users'). For Phase-2,
        // `swipedProfile.id` is the `userPrivateProfiles._id` (card id), and
        // `swipedProfile.userId` is the underlying `users._id`. Always pass userId
        // to the Phase-2 mutation. Phase-1 keeps using `id` (which is users._id).
        if (isPhase2 && !isDemoMode) {
          const p2ToUserId = swipedProfile.userId;
          if (!p2ToUserId || p2ToUserId === swipedProfile.id) {
            if (DEBUG_DEEPCONNECT_LOGS) {
              console.warn('[P2_SWIPE_GUARD] Phase-2 profile is missing a valid users._id; refusing swipe', {
                hasUserId: !!p2ToUserId,
                idEqualsUserId: p2ToUserId === swipedProfile.id,
              });
            }
            Toast.show("Couldn't process swipe. Please try again.");
            resetPosition();
            releaseSwipeLock(activeSwipeId);
            return;
          }
        }

        const swipePromise =
          isPhase2 && !isDemoMode
            ? phase2SwipeMutation({
                token: token as string,
                authUserId: convexUserId as string,
                toUserId: swipedProfile.userId as Id<'users'>,
                action,
                message,
              })
            : phase1SwipeMutation({
                token: token!,
                toUserId: swipedProfile.id as Id<'users'>,
                action,
                message,
              });

        let result;
        if (isPhase2 && !isDemoMode) {
          // Phase-2 live swipes stay locked until the backend definitively settles.
          // After 6s we switch to an honest "still confirming" state instead of
          // pretending the swipe can be safely retried while the mutation may still succeed.
          const slowSwipeTimer = setTimeout(() => {
            if (!mountedRef.current || swipeIdRef.current !== activeSwipeId) {
              return;
            }

            pendingPhase2SwipeRef.current = {
              swipeId: activeSwipeId,
              profileId: swipedProfile.id,
            };
            setRetryKey((currentRetryKey) => currentRetryKey + 1);
            Toast.show("Still confirming that swipe...");
          }, SWIPE_TIMEOUT_MS);

          try {
            result = await swipePromise;
          } finally {
            clearTimeout(slowSwipeTimer);
          }
        } else {
          // P2-2: Mirror the Phase-2 honest "still confirming" pattern for
          // Phase-1 live swipes (and demo). Previously we hard-rejected via
          // Promise.race after 6s, which surfaced a "Please try again" error
          // even when the mutation was still in flight and would shortly
          // succeed — leading to duplicate likes if the user retried. Now we
          // keep the swipe lock held, surface a soft toast once at 6s, and
          // settle on the real backend result. Lock is released by the outer
          // finally block once the mutation resolves; navigation away clears
          // it via the focus-change effect.
          const slowSwipeTimer = setTimeout(() => {
            if (!mountedRef.current || swipeIdRef.current !== activeSwipeId) {
              return;
            }
            Toast.show("Still confirming that swipe...");
          }, SWIPE_TIMEOUT_MS);

          try {
            result = await swipePromise;
          } finally {
            clearTimeout(slowSwipeTimer);
          }
        }

        // LOG_NOISE_FIX: Match logging moved to trackAction/analytics

        if (isPhase2 && !isDemoMode) {
          const reconciledFromRefresh = reconciledPhase2SwipeIdsRef.current.has(activeSwipeId);
          pendingPhase2SwipeRef.current = null;
          if (reconciledFromRefresh) {
            reconciledPhase2SwipeIdsRef.current.delete(activeSwipeId);
          } else {
            advanceCard();
          }
          if (direction === "right") incrementLikes();
          if (direction === "up") incrementStandOuts();
        } else if (!isPhase2 && !isDemoMode) {
          // Phase-1 live: mutation succeeded — now advance and apply local limits
          advanceCard();
          if (direction === "right") incrementLikes();
          if (direction === "up") incrementStandOuts();
        }

        // Guard: check mounted/focused before navigating on match
        if (!mountedRef.current || !isFocusedRef.current) return;
        if (result?.isMatch && !navigatingRef.current) {
          // DL-001 FIX: Phase-2 matches stay on Deep Connect, no navigation
          if (isPhase2) {
            const alreadyMatched = (result as any)?.alreadyMatched === true;
            const matchKey = (result as any)?.matchId ?? swipedProfile.userId ?? swipedProfile.id;
            purgePhase2ProfilesFromDeck(
              new Set([
                swipedProfile.id,
                ...(swipedProfile.userId ? [swipedProfile.userId] : []),
              ]),
              "match_result",
            );
            if (alreadyMatched) {
              setPhase2MatchCelebration({
                visible: true,
                matchedProfile: {
                  name: swipedProfile.name,
                  photoUrl: swipedProfile.photos?.[0]?.url,
                  conversationId: (result as any)?.conversationId,
                  alreadyMatched: true,
                  source: (result as any)?.source ?? 'deep_connect',
                },
              });
              releaseSwipeLock(activeSwipeId);
              return;
            }

            const isNewMatch = handlePhase2Match({
              id: swipedProfile.id,
              matchKey,
              name: swipedProfile.name,
              age: swipedProfile.age,
              photoUrl: swipedProfile.photos?.[0]?.url,
            });
            if (isNewMatch) {
              trackEvent({ name: 'match_created', otherUserId: swipedProfile.id });
              // Premium haptic: Strong feedback for match celebration
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              // P2_MATCH: Show match celebration
              setPhase2MatchCelebration({
                visible: true,
                matchedProfile: {
                  name: swipedProfile.name,
                  photoUrl: swipedProfile.photos?.[0]?.url,
                  conversationId: (result as any)?.conversationId,
                  alreadyMatched: false,
                  source: (result as any)?.source ?? 'deep_connect',
                },
              });
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
          // P1-001 FIX: Mark that release will happen in deferred callback
          releaseDeferredToCallback = true;
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
        if (!isPhase2 && !isDemoMode) {
          resetPosition();
        }
        if (pendingPhase2SwipeRef.current?.swipeId === activeSwipeId) {
          pendingPhase2SwipeRef.current = null;
        }
        reconciledPhase2SwipeIdsRef.current.delete(activeSwipeId);
        const isTimeout = error?.message === "Swipe timed out";
        Toast.show(isTimeout ? "We couldn't confirm that swipe. Please try again." : "Something went wrong. Please try again.");
      } finally {
        // P1-001 FIX: Only release here if not deferred to callback
        if (!releaseDeferredToCallback) {
          releaseSwipeLock(activeSwipeId);
        }
      }
    },
    [
      convexUserId,
      phase1SwipeMutation,
      phase2SwipeMutation,
      isPhase2,
      isDemoMode,
      advanceCard,
      hasReachedLikeLimit,
      hasReachedStandOutLimit,
      incrementLikes,
      incrementStandOuts,
      demo.recordSwipe,
      purgePhase2ProfilesFromDeck,
      releaseSwipeLock,
      resetPosition,
      token,
      phase2TopCardReady,
    ],
  );

  const animateSwipe = useCallback(
    (direction: "left" | "right" | "up", velocity?: number) => {
      // Guard: don't start new animations if navigating, unfocused, or already swiping
      if (navigatingRef.current || !isFocusedRef.current) return;
      if (swipeLockRef.current) return;
      if (isPhase2 && !phase2TopCardReady) return;
      // Check limits before animating
      if (direction === "right" && hasReachedLikeLimit()) return;
      if (direction === "up" && hasReachedStandOutLimit()) return;

      // ★ RACE FIX: Acquire swipe lock and capture unique ID for this swipe lifecycle
      const swipeId = acquireSwipeLock();

      const currentPanX = getActivePanX();
      const currentPanY = getActivePanY();
      // Targets are comfortably off-screen so the card fully unmounts. Slightly
      // less aggressive throw than the prior fixed-duration exit so the
      // velocity-fed spring doesn't whip past the edge unnaturally.
      const targetX = direction === "left" ? -SCREEN_WIDTH * 1.4 : direction === "right" ? SCREEN_WIDTH * 1.4 : 0;
      const targetY = direction === "up" ? -SCREEN_HEIGHT * 1.2 : 0;

      // Pan velocity from the gesture is in screen-units / ms (gesture handler
      // / 1000 in onPanEnd). Reanimated withSpring expects pixels/s for
      // translate values, so we re-scale by 1000. Sign matches axis direction.
      const vScaled = (velocity ?? 0) * 1000;

      setOverlayDirection(direction);
      overlayOpacity.value = 1;

      // Callback to run after animation completes
      const onAnimationComplete = (finished: boolean) => {
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
      };

      // Velocity-fed spring for Tinder-feel exit: carries flick momentum and
      // settles smoothly off-screen instead of a fixed-duration timing curve.
      // Reset/cancel still uses its own withSpring in resetPosition().
      const SWIPE_EXIT_SPRING = {
        damping: 22,
        stiffness: 220,
        mass: 0.7,
        overshootClamping: false,
      } as const;

      currentPanX.value = withSpring(
        targetX,
        {
          ...SWIPE_EXIT_SPRING,
          velocity: direction === "up" ? 0 : vScaled,
        },
        (finished) => {
          // For L/R swipes the X axis is primary; fire completion here.
          if (direction !== "up" && finished !== undefined) {
            runOnJS(onAnimationComplete)(finished);
          }
        },
      );
      currentPanY.value = withSpring(
        targetY,
        {
          ...SWIPE_EXIT_SPRING,
          velocity: direction === "up" ? vScaled : 0,
        },
        (finished) => {
          // For up swipes the Y axis is primary; fire completion here.
          if (direction === "up" && finished !== undefined) {
            runOnJS(onAnimationComplete)(finished);
          }
        },
      );
    },
    [
      panAX,
      panAY,
      panBX,
      panBY,
      overlayOpacity,
      hasReachedLikeLimit,
      hasReachedStandOutLimit,
      acquireSwipeLock,
      releaseSwipeLock,
      isPhase2,
      phase2TopCardReady,
    ],
  );

  // Stable refs so the panResponder (created once) always calls the latest version
  const handleSwipeRef = useRef(handleSwipe);
  handleSwipeRef.current = handleSwipe;
  const animateSwipeRef = useRef(animateSwipe);
  animateSwipeRef.current = animateSwipe;

  // P0-001 FIX: Stable ref for handlePanEnd to prevent panGesture recreation on dependency changes
  const handlePanEndRef = useRef<(dx: number, dy: number, vx: number, vy: number) => void>(() => {});

  // WORKLET FIX: Stable wrapper that never changes identity - avoids "Tried to modify key `current`" warning
  // The wrapper reads handlePanEndRef.current at call time, so the ref object isn't captured in worklet closure
  const onPanEndWrapper = useCallback((dx: number, dy: number, vx: number, vy: number) => {
    handlePanEndRef.current(dx, dy, vx, vy);
  }, []); // Empty deps - this function identity never changes

  const thresholdX = SCREEN_WIDTH * SWIPE_CONFIG.SWIPE_THRESHOLD_X;
  const thresholdY = SCREEN_HEIGHT * SWIPE_CONFIG.SWIPE_THRESHOLD_Y;
  const velocityX = SWIPE_CONFIG.SWIPE_VELOCITY_X;
  const velocityY = SWIPE_CONFIG.SWIPE_VELOCITY_Y;
  // P1-FIX: Hardened pull-up gesture thresholds
  // Minimum distance for profile open (10% of screen height)
  const profileOpenMinDistance = SCREEN_HEIGHT * 0.10;
  // Maximum distance before Stand Out triggers (less than thresholdY)
  const profileOpenMaxDistance = SCREEN_HEIGHT * 0.16;
  // Minimum upward velocity for intentional gesture
  const profileOpenMinVelocity = 0.3;

  const isAuthPending = isPhase2 && !isDemoMode && (!userId || !isAuthReadyForQuery);

  // JS callbacks to be called from UI thread via runOnJS
  const updateOverlayDirection = useCallback((newDir: "left" | "right" | "up" | null) => {
    if (overlayDirectionRef.current !== newDir) {
      overlayDirectionRef.current = newDir;
      setOverlayDirection(newDir);
    }
  }, []);

  const handlePanEnd = useCallback((dx: number, dy: number, vx: number, vy: number) => {
    // If screen lost focus during drag, or swipe already in flight, just reset
    if (navigatingRef.current || !isFocusedRef.current || swipeLockRef.current) {
      resetPosition();
      return;
    }
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const absVy = Math.abs(vy);
    const isUpward = dy < 0;

    // Single source of truth: same classifier the live preview uses, but
    // gated by COMMIT thresholds (full thresholdX / thresholdY / velocity).
    // dominanceRatio 1.25 enforces that diagonal/ambiguous gestures resolve
    // to null (deadzone) rather than firing the wrong action.
    const direction = classifySwipeDirection(
      dx,
      dy,
      vx,
      vy,
      thresholdX,
      thresholdY,
      velocityX,
      velocityY,
      1.25,
    );

    if (__DEV__ && (!isPhase2 || DEBUG_DEEPCONNECT_LOGS)) {
      // Dev-only: one log per release, NOT per frame. No PII.
      console.log("[SWIPE_CLASSIFY]", {
        dx: Math.round(dx),
        dy: Math.round(dy),
        vx: Number(vx.toFixed(2)),
        vy: Number(vy.toFixed(2)),
        direction,
        phase: isPhase2 ? "phase2" : "phase1",
      });
    }

    if (isPhase2 && direction && !phase2TopCardReady) {
      resetPosition();
      return;
    }

    if (direction === "up") {
      // Up swipe opens the inline Stand Out composer sheet over the current
      // card (no separate route / no white-page transition). Phase-2 routes
      // the standout/super-like through the same composer flow.
      resetPosition();
      const c = currentRef.current;
      if (!hasReachedStandOutLimit() && c) {
        setStandOutSheetTarget({ profileId: c.id, name: c.name });
      }
      return;
    }

    if (direction === "left") {
      animateSwipeRef.current("left", vx);
      return;
    }

    if (direction === "right") {
      animateSwipeRef.current("right", vx);
      return;
    }

    // direction === null → diagonal/ambiguous deadzone OR insufficient
    // distance/velocity. Fall through to profile-open / pull-refresh checks
    // so existing gentle-pull behaviours are preserved.

    // P1-FIX: Hardened pull-up gesture for profile open
    // Must be: intentionally vertical, sufficient distance, not too far (Stand Out territory)
    const isPrimarilyVertical = absY > absX * 2; // Must be clearly vertical (2:1 ratio)
    const hasMinDistance = absY >= profileOpenMinDistance;
    const isBelowStandOut = absY < profileOpenMaxDistance;
    const hasMinVelocity = absVy >= profileOpenMinVelocity;

    // Profile open requires: upward + vertical + (distance OR velocity) + not Stand Out
    if (isUpward && isPrimarilyVertical && isBelowStandOut && (hasMinDistance || hasMinVelocity)) {
      resetPosition();
      openProfileCb();
      return;
    }

    const isPullRefreshGesture =
      isPhase2 &&
      !showPhaseTransition &&
      dy > DEEP_CONNECT_PULL_REFRESH_MIN_DISTANCE &&
      dy > absX * 1.35 &&
      vy > 0.1;

    if (isPullRefreshGesture) {
      resetPosition();
      triggerPhase2Refresh("pull");
      return;
    }

    resetPosition();
  }, [thresholdX, thresholdY, velocityX, velocityY, profileOpenMinDistance, profileOpenMaxDistance, profileOpenMinVelocity, resetPosition, hasReachedStandOutLimit, openProfileCb, isPhase2, phase2TopCardReady, showPhaseTransition, triggerPhase2Refresh]);

  // P0-001 FIX: Keep handlePanEndRef in sync with latest handlePanEnd
  handlePanEndRef.current = handlePanEnd;

  // Gesture.Pan() runs on UI thread - replaces PanResponder for better performance
  // 🔒 LOCKED: Do not change swipe gesture / thresholds without audit approval
  const panGesture = useMemo(() =>
    Gesture.Pan()
      .minDistance(8)
      .onStart(() => {
        // Don't claim gestures if navigating, unfocused, or swipe in flight
        // Note: This check is on UI thread, refs are read synchronously
      })
      .onUpdate((event) => {
        // Update pan position directly (UI thread)
        // Use activeSlotShared (SharedValue) instead of activeSlotRef (ref can't be read in worklet)
        const currentPanX = activeSlotShared.value === 0 ? panAX : panBX;
        const currentPanY = activeSlotShared.value === 0 ? panAY : panBY;
        currentPanX.value = event.translationX;
        currentPanY.value = event.translationY;

        // Live preview classifier — SAME function handlePanEnd uses, but with
        // smaller PREVIEW thresholds so the icon reveals naturally during the
        // drag. The dominance ratio (1.25) and direction rules are identical,
        // so what the user sees mid-gesture cannot disagree with the action
        // that actually fires on release.
        const previewDistanceX = thresholdX * 0.35;
        const previewDistanceY = thresholdY * 0.35;
        const scaledVx = event.velocityX / 1000;
        const scaledVy = event.velocityY / 1000;

        const newDir = classifySwipeDirection(
          event.translationX,
          event.translationY,
          scaledVx,
          scaledVy,
          previewDistanceX,
          previewDistanceY,
          velocityX,
          velocityY,
          1.25,
        );

        // Axis-aware opacity: ramp by the dominant axis of the chosen zone.
        // When direction is null (diagonal deadzone) opacity stays 0, so the
        // overlay is fully invisible until intent is unambiguous — fixes
        // "icon flickers between left/right during a slow upward drag".
        const absX = event.translationX < 0 ? -event.translationX : event.translationX;
        const absY = event.translationY < 0 ? -event.translationY : event.translationY;
        let progress = 0;
        if (newDir === "up") {
          progress = absY / thresholdY;
        } else if (newDir === "left" || newDir === "right") {
          progress = absX / thresholdX;
        }
        overlayOpacity.value = progress > 1 ? 1 : progress < 0 ? 0 : progress;

        // Update React state only when direction changes (via JS thread)
        runOnJS(updateOverlayDirection)(newDir);
      })
      .onEnd((event) => {
        // Handle pan end via JS thread (threshold checks, navigation, etc.)
        // WORKLET FIX: Pass stable wrapper function - avoids capturing ref object in worklet closure
        runOnJS(onPanEndWrapper)(
          event.translationX,
          event.translationY,
          event.velocityX / 1000, // Convert to roughly same scale as old PanResponder
          event.velocityY / 1000
        );
      })
      .onFinalize(() => {
        // Gesture was cancelled/interrupted
      }),
    // P0-001 FIX: Using stable ref pattern - onPanEndWrapper has empty deps so it never changes
    [panAX, panAY, panBX, panBY, activeSlotShared, overlayOpacity, thresholdX, thresholdY, velocityX, velocityY, updateOverlayDirection, onPanEndWrapper]
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
      if (DEBUG_DEEPCONNECT_LOGS) {
        console.log('[StandOut] Profile mismatch - clearing stale result');
      }
      useInteractionStore.getState().setStandOutResult(null);
      return;
    }

    useInteractionStore.getState().setStandOutResult(null);
    const msg = standOutResult.message;

    // ★ RACE FIX: Acquire swipe lock and capture unique ID for this stand-out lifecycle
    const swipeId = acquireSwipeLock();

    // ★ Trigger star-burst animation for super-like
    setShowSuperLikeAnimation(true);

    // Animate the card out (up direction). Spring-based to match the
    // velocity-fed exit used by direct up-swipes from animateSwipe(). The
    // composer-flow has no live gesture velocity to feed in, so we provide a
    // small synthetic upward velocity to keep the launch feeling responsive.
    const currentPanY = getActivePanY();
    const targetY = -SCREEN_HEIGHT * 1.2;

    setOverlayDirection("up");
    overlayOpacity.value = 1;

    // Callback to run after animation completes
    const onStandOutAnimComplete = (finished: boolean) => {
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
    };

    currentPanY.value = withSpring(
      targetY,
      {
        damping: 22,
        stiffness: 220,
        mass: 0.7,
        overshootClamping: false,
        velocity: -1800,
      },
      (finished) => {
        if (finished !== undefined) {
          runOnJS(onStandOutAnimComplete)(finished);
        }
      },
    );
  }, [standOutResult, acquireSwipeLock, releaseSwipeLock, overlayOpacity, panAY, panBY]);

  useEffect(() => {
    if (!isPhase2 || !pendingFilterResetRef.current) return;
    if (swipeLockRef.current || showPhaseTransition || navigatingRef.current) {
      return;
    }
    pendingFilterResetRef.current = false;
    setIndex(0);
  }, [isPhase2, showPhaseTransition, sourceProfiles.length]);

  const hasResolvedPhase2Query =
    isPhase2 && !isDemoMode && privateDiscoverArgs !== "skip" && phase2Profiles !== undefined;
  const isPhase2EmptySettled =
    isPhase2 &&
    !isDemoMode &&
    !showPhaseTransition &&
    !isAuthPending &&
    hasResolvedPhase2Query &&
    !usingStableCache &&
    profiles.length === 0;
  const isPhase2NetworkIssueSettled =
    isPhase2 &&
    !isDemoMode &&
    !showPhaseTransition &&
    !isAuthPending &&
    !usingStableCache &&
    phase2QueryTimedOut &&
    profiles.length === 0;

  useEffect(() => {
    if (!isPhase2) {
      setIsRefreshingPhase2Deck(false);
      return;
    }
    if (privateDiscoverArgs === "skip") {
      setIsRefreshingPhase2Deck(false);
      return;
    }
    if (hasResolvedPhase2Query || isPhase2NetworkIssueSettled) {
      setIsRefreshingPhase2Deck(false);
    }
  }, [hasResolvedPhase2Query, isPhase2, isPhase2NetworkIssueSettled, privateDiscoverArgs]);

  const phase2EmptyState = useMemo(() => {
    if (!isPhase2) return null;

    if (isPhase2NetworkIssueSettled) {
      return {
        icon: "cloud-offline-outline" as const,
        iconColor: "rgba(125, 211, 252, 0.95)",
        title: "Deep Connect hit a connection snag",
        subtitle: "We couldn't refresh the deck just now. Try again in a moment.",
        primaryAction: "retry" as const,
        primaryLabel: "Try again",
        secondaryAction: null,
        secondaryLabel: null,
      };
    }

    if (intentFilters.length > 0 && sourceProfiles.length === 0) {
      return {
        icon: "options-outline" as const,
        iconColor: "rgba(255, 206, 102, 0.96)",
        title: "You’ve seen everyone for now",
        subtitle: "No Deep Connect profiles match these preferences right now. Try refreshing or adjust your preferences.",
        primaryAction: "adjust_preferences" as const,
        primaryLabel: "Adjust preferences",
        secondaryAction: "refresh" as const,
        secondaryLabel: "Refresh",
      };
    }

    return {
      icon: "sparkles-outline" as const,
      iconColor: "rgba(233, 69, 96, 0.95)",
      title: "You’ve seen everyone for now",
      subtitle: "No Deep Connect profiles are available right now. Try refreshing, or check your preferences and private profile setup.",
      primaryAction: "adjust_preferences" as const,
      primaryLabel: "Adjust preferences",
      secondaryAction: "refresh" as const,
      secondaryLabel: "Refresh",
    };
  }, [intentFilters, isPhase2, isPhase2NetworkIssueSettled, sourceProfiles.length]);

  const headerVerticalOffset = isPhase2 ? DEEP_CONNECT_HEADER_VERTICAL_OFFSET : 0;
  const compactHeaderTopPadding = insets.top + headerVerticalOffset;
  const compactHeaderHeight = insets.top + HEADER_H + headerVerticalOffset;

  const notificationPopover = showNotificationPopover ? (
    <NotificationPopover
      visible
      phase={isPhase2 ? "phase2" : "phase1"}
      onClose={() => setShowNotificationPopover(false)}
      anchorTop={compactHeaderHeight + SPACING.sm}
    />
  ) : null;
  const hasProfiles = profiles.length > 0;
  const phase2QueryResolved = phase2Profiles !== undefined;
  const phase2ReadyToDecide =
    !isPhase2 ||
    (
      phase2HasHydrated &&
      phase2InitialFilterReady &&
      phase2QueryResolved
    );
  const queryResolved = phase2QueryResolved;
  const cachedHas = phase2CacheBelongsToViewer && cachedProfilesMap.size > 0;
  // PHASE2_FLICKER_FIX: Reordered so warm-open cached profiles short-circuit
  // to "cards" BEFORE the phase2ReadyToDecide searching gate. This lets a
  // returning user see the cached card immediately on tab tap instead of the
  // noisy SearchingOverlay flashing while hydration + initial filter + query
  // settle. The empty branch still requires phase2ReadyToDecide=true (and
  // therefore phase2HasHydrated && phase2InitialFilterReady && queryResolved)
  // because both searching guards above remain in place when cache is empty.
  const state =
    hasProfiles
      ? "cards"
      : cachedHas
        ? "cards"
        : isPhase2 && !phase2ReadyToDecide
          ? "searching"
          : !queryResolved && !cachedSearchingDone
            ? "searching"
            : "empty";

  const phase2ReadyToDecideLoggedRef = useRef(false);
  useEffect(() => {
    if (!isPhase2) {
      phase2ReadyToDecideLoggedRef.current = false;
      return;
    }
    if (!phase2ReadyToDecide) {
      phase2ReadyToDecideLoggedRef.current = false;
      return;
    }
    if (DEBUG_DEEPCONNECT_LOGS && !phase2ReadyToDecideLoggedRef.current) {
      phase2ReadyToDecideLoggedRef.current = true;
      console.log('[P2_READY_TO_DECIDE]', {
        phase2HasHydrated,
        phase2InitialFilterReady,
        phase2QueryResolved,
        intentFilterCount: intentFilters.length,
      });
    }
  }, [intentFilters, isPhase2, phase2HasHydrated, phase2InitialFilterReady, phase2QueryResolved, phase2ReadyToDecide]);

  useEffect(() => {
    if (isPhase2 && state === "cards" && !cachedSearchingDone) {
      markCachedSearchingDone();
    }
  }, [cachedSearchingDone, isPhase2, markCachedSearchingDone, state]);

  useEffect(() => {
    if (!DEBUG_DEEPCONNECT_LOGS || !isPhase2) return;
    console.log("[P2_STATE_DEBUG]", {
      profilesSafeLength: profilesSafe.length,
      profilesLength: profiles.length,
      usingStableCache,
      cachedHas,
      searchingDone: cachedSearchingDone,
      state,
      intentFilterCount: intentFilters.length,
    });
  }, [cachedHas, cachedSearchingDone, intentFilters, isPhase2, profiles.length, profilesSafe.length, state, usingStableCache]);

  const searchingPulse = useSharedValue(0);
  useEffect(() => {
    if (!isPhase2) {
      searchingPulse.value = 0;
      return;
    }

    searchingPulse.value = withRepeat(
      withTiming(1, {
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
  }, [isPhase2, searchingPulse]);

  const searchingIconPulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(searchingPulse.value, [0, 1], [0.78, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(searchingPulse.value, [0, 1], [0.94, 1.06], Extrapolation.CLAMP) },
    ],
  }));

  const searchingGlowPulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(searchingPulse.value, [0, 1], [0.42, 0.76], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(searchingPulse.value, [0, 1], [0.9, 1.14], Extrapolation.CLAMP) },
    ],
  }));

  function SearchingOverlay() {
    return (
      <View key="p2-searching-overlay" style={styles.phase2SearchingOverlay}>
        <LinearGradient
          colors={['#0F0F1A', '#141428', '#1A1A2E', '#16213E', '#1A1A2E', '#141428', '#0F0F1A']}
          locations={[0, 0.15, 0.35, 0.5, 0.65, 0.85, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Animated.View style={[styles.phase2SearchingGlow, searchingGlowPulseStyle]} pointerEvents="none" />
        {/*
         * Loading visual is intentionally minimal: a pulsing radial glow + a
         * soft pulsing icon. No title/subtitle copy here — keeping it text-free
         * makes the loading state feel like deck preparation rather than a
         * Deep-Connect-branded message, and avoids any accidental resemblance
         * to the final empty state.
         */}
        <Animated.View style={[styles.phase2IconOuter, searchingIconPulseStyle]}>
          <View style={styles.phase2IconInner}>
            <Ionicons
              name="sparkles-outline"
              size={DISCOVER_PHASE2_EMPTY_ICON_SIZE}
              color="rgba(233, 69, 96, 0.95)"
            />
          </View>
        </Animated.View>
      </View>
    );
  }

  // Phase-1 first-open loading: while the live discover query is still
  // resolving and the prefetch did not provide any positive profiles, we want
  // a neutral header-only screen instead of the "We're finding people for
  // you" / "You've seen everyone" empty card. This is what the user sees
  // for the brief window between focus and the first profile mount.
  const isPhase1InitialLoading =
    !isPhase2 &&
    !isDemoMode &&
    !externalProfiles &&
    phase1Profiles === undefined &&
    !(phase1ProfilesWithPrefetch && phase1ProfilesWithPrefetch.length > 0);

  // Empty state (no profiles at all). For Phase-1 we additionally require the
  // initial load to have settled before falling into the empty branch — this
  // prevents the empty UI from flashing while the query is still pending.
  const shouldShowEmptyState =
    isPhase2
      ? state === "empty"
      : !isPhase1InitialLoading && profiles.length === 0;

  if (isPhase1InitialLoading) {
    return (
      <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        {/* Premium subtle gradient background for Phase-1 (mirrors empty state) */}
        {!dark && (
          <LinearGradient
            colors={['#FFFFFF', '#FAFAFA', '#F7F7F7']}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* Header — keeps the chrome stable across loading → cards / empty */}
        {!hideHeader && (
          <View style={[
            styles.header,
            { paddingTop: compactHeaderTopPadding, height: compactHeaderHeight },
            dark && { backgroundColor: INCOGNITO_COLORS.background },
            !dark && { backgroundColor: 'rgba(255, 255, 255, 0.85)' },
          ]}>
            <TouchableOpacity
              style={[
                styles.headerBtn,
                !dark && { backgroundColor: 'rgba(0, 0, 0, 0.03)', borderWidth: 1, borderColor: 'rgba(0, 0, 0, 0.04)' },
              ]}
              onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: 'phase1' } } as any)}
            >
              <Ionicons name="options-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
            </TouchableOpacity>
            <Text {...DISCOVER_TEXT_PROPS} style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
            <View style={styles.headerRightGroup}>
              <TouchableOpacity
                style={[
                  styles.headerBtn,
                  !dark && { backgroundColor: 'rgba(0, 0, 0, 0.03)', borderWidth: 1, borderColor: 'rgba(0, 0, 0, 0.04)' },
                ]}
                onPress={() => setShowNotificationPopover(true)}
              >
                <Ionicons name="notifications-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
                {unseenCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text {...DISCOVER_TEXT_PROPS} style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <HeaderAvatarButton dark={dark} />
            </View>
          </View>
        )}
        {/* Intentionally empty body: no copy, no icon, no skeleton. The card
            slides in over this neutral surface as soon as the live query
            resolves with at least one profile. */}
        <View style={[styles.center, { flex: 1 }, !dark && { backgroundColor: 'transparent' }]} />
        {notificationPopover}
      </View>
    );
  }

  if (shouldShowEmptyState) {
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
        {isPhase2 && (
          <>
            <LinearGradient
              colors={['#080913', '#101426', '#121c32', '#0d1427', '#080913']}
              locations={[0, 0.28, 0.52, 0.76, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View pointerEvents="none" style={styles.phase2DeckGlowTop} />
            <View pointerEvents="none" style={styles.phase2DeckGlowBottom} />
          </>
        )}
        {/* Premium subtle gradient background for Phase-1 */}
        {!dark && (
          <LinearGradient
            colors={['#FFFFFF', '#FAFAFA', '#F7F7F7']}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* Top fade overlay for header depth - Phase-1 only */}
        {!dark && (
          <LinearGradient
            colors={[
              'rgba(255,255,255,0.9)',
              'rgba(255,255,255,0.6)',
              'rgba(255,255,255,0.0)',
            ]}
            locations={[0, 0.4, 1]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: moderateScale(140, 0.25),
              zIndex: 1,
            }}
            pointerEvents="none"
          />
        )}
        {/* Header - always visible even when feed is empty */}
        {!hideHeader && (
          <View style={[
            styles.header,
            { paddingTop: compactHeaderTopPadding, height: compactHeaderHeight },
            dark && { backgroundColor: INCOGNITO_COLORS.background },
            !dark && { backgroundColor: 'rgba(255, 255, 255, 0.85)' }
          ]}>
            <TouchableOpacity
              style={[
                styles.headerBtn,
                !dark && { backgroundColor: 'rgba(0, 0, 0, 0.03)', borderWidth: 1, borderColor: 'rgba(0, 0, 0, 0.04)' }
              ]}
              onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}
            >
              <Ionicons name="options-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
            </TouchableOpacity>
            <Text {...DISCOVER_TEXT_PROPS} style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
            <View style={styles.headerRightGroup}>
              <TouchableOpacity
                style={[
                  styles.headerBtn,
                  !dark && { backgroundColor: 'rgba(0, 0, 0, 0.03)', borderWidth: 1, borderColor: 'rgba(0, 0, 0, 0.04)' }
                ]}
                onPress={() => setShowNotificationPopover(true)}
              >
                <Ionicons name="notifications-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
                {unseenCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text {...DISCOVER_TEXT_PROPS} style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              {!isPhase2 && <HeaderAvatarButton dark={dark} />}
            </View>
          </View>
        )}
        <View style={[styles.center, { flex: 1 }, !dark && { backgroundColor: 'transparent' }]}>
          {/* Unified empty state for both Phase-1 and Phase-2 */}
          {isPhase2 ? (
            <>
              {/* Premium gradient background for Phase-2 */}
              <LinearGradient
                colors={['#0F0F1A', '#141428', '#1A1A2E', '#16213E', '#1A1A2E', '#141428', '#0F0F1A']}
                locations={[0, 0.15, 0.35, 0.5, 0.65, 0.85, 1]}
                style={StyleSheet.absoluteFill}
              />
              {/* Subtle radial glow in center */}
              <View style={styles.phase2RadialGlow} />

              <Animated.View
                entering={FadeInUp.duration(400).delay(100).springify().damping(20)}
                style={styles.phase2EmptyContent}
              >
                {/* Premium icon with multi-layer glow */}
                <View style={styles.phase2IconOuter}>
                  <View style={styles.phase2IconInner}>
                    <Ionicons
                      name={phase2EmptyState?.icon ?? "sparkles-outline"}
                      size={DISCOVER_PHASE2_EMPTY_ICON_SIZE}
                      color={phase2EmptyState?.iconColor ?? "rgba(233, 69, 96, 0.95)"}
                    />
                  </View>
                </View>

                <Animated.Text
                  {...DISCOVER_TEXT_PROPS}
                  entering={FadeInUp.duration(350).delay(200)}
                  style={styles.phase2EmptyTitle}
                >
                  {phase2EmptyState?.title ?? "You’ve seen everyone for now"}
                </Animated.Text>
                <Animated.Text
                  {...DISCOVER_TEXT_PROPS}
                  entering={FadeInUp.duration(350).delay(280)}
                  style={styles.phase2EmptySubtitle}
                >
                  {phase2EmptyState?.subtitle ?? "Adjust your preferences to discover more profiles."}
                </Animated.Text>

                <Animated.View entering={FadeIn.duration(300).delay(400)} style={styles.phase2EmptyActions}>
                  {phase2EmptyState?.primaryLabel ? (
                    <TouchableOpacity
                      style={styles.phase2PrimaryAction}
                      activeOpacity={0.9}
                      onPress={() => {
                        if (phase2EmptyState.primaryAction === "adjust_preferences") {
                          // Navigate to the preferences page only.
                          // Do NOT clear filters and do NOT emit
                          // phase2_intent_filter_selected — the user must
                          // adjust preferences manually on that page.
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                          router.push({
                            pathname: "/(main)/discovery-preferences",
                            params: { mode: isPhase2 ? 'phase2' : 'phase1' },
                          } as any);
                          return;
                        }
                        triggerPhase2Refresh("button");
                      }}
                    >
                      <Ionicons
                        name={
                          phase2EmptyState.primaryAction === "adjust_preferences"
                            ? "options-outline"
                            : "refresh"
                        }
                        size={SIZES.icon.sm}
                        color="rgba(255,255,255,0.92)"
                        style={{ marginRight: SPACING.sm }}
                      />
                      <Text {...DISCOVER_TEXT_PROPS} style={styles.phase2PrimaryActionText}>{phase2EmptyState.primaryLabel}</Text>
                    </TouchableOpacity>
                  ) : null}

                  {phase2EmptyState?.secondaryLabel ? (
                    <TouchableOpacity
                      style={styles.phase2SecondaryAction}
                      activeOpacity={0.82}
                      onPress={() => {
                        triggerPhase2Refresh("button");
                      }}
                    >
                      <Text {...DISCOVER_TEXT_PROPS} style={styles.phase2SecondaryActionText}>{phase2EmptyState.secondaryLabel}</Text>
                    </TouchableOpacity>
                  ) : null}

                  {isDemoMode && (
                    <TouchableOpacity
                      style={styles.phase2SecondaryAction}
                      activeOpacity={0.82}
                      onPress={handleResetDemoSwipes}
                    >
                      <Text {...DISCOVER_TEXT_PROPS} style={styles.phase2SecondaryActionText}>Reset demo deck</Text>
                    </TouchableOpacity>
                  )}
                </Animated.View>
              </Animated.View>
            </>
          ) : (
            <>
              {/* Subtle radial glow for Phase-1 */}
              <View style={styles.phase1RadialGlow} />

              <Animated.View
                entering={FadeInUp.duration(400).delay(100).springify().damping(20)}
                style={styles.phase1EmptyCard}
              >
                {/* Premium icon with multi-layer glow - light theme */}
                <View style={styles.phase1IconOuter}>
                  <View style={styles.phase1IconInner}>
                    <Ionicons name="sparkles" size={SIZES.icon.xl} color={COLORS.primary} />
                  </View>
                </View>

                <Animated.Text
                  {...DISCOVER_TEXT_PROPS}
                  entering={FadeInUp.duration(350).delay(200)}
                  style={styles.phase1EmptyTitle}
                >
                  {phase1EmptyMessaging.title}
                </Animated.Text>
                <Animated.Text
                  {...DISCOVER_TEXT_PROPS}
                  entering={FadeInUp.duration(350).delay(280)}
                  style={styles.phase1EmptySubtitle}
                >
                  {phase1EmptyMessaging.subtitle}
                </Animated.Text>

                {isDemoMode && (
                  <Animated.View entering={FadeIn.duration(300).delay(400)}>
                    <TouchableOpacity
                      style={styles.phase1ResetButton}
                      onPress={handleResetDemoSwipes}
                    >
                      <Ionicons name="refresh" size={SIZES.icon.sm} color="#FFFFFF" style={{ marginRight: SPACING.sm }} />
                      <Text {...DISCOVER_TEXT_PROPS} style={styles.phase1ResetButtonText}>Reset Demo</Text>
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </Animated.View>
            </>
          )}
        </View>
        {notificationPopover}
      </View>
    );
  }

  // Deck exhausted state (swiped through all profiles)
  const shouldShowDeckExhaustedState =
    !isPhase2 &&
    !current;

  if (shouldShowDeckExhaustedState) {
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
          <View style={[styles.header, { paddingTop: compactHeaderTopPadding, height: compactHeaderHeight }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}>
              <Ionicons name="options-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
            </TouchableOpacity>
            <Text {...DISCOVER_TEXT_PROPS} style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
            <View style={styles.headerRightGroup}>
              <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNotificationPopover(true)}>
                <Ionicons name="notifications-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
                {unseenCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text {...DISCOVER_TEXT_PROPS} style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              {!isPhase2 && <HeaderAvatarButton dark={dark} />}
            </View>
          </View>
        )}
        <View style={[styles.center, { flex: 1 }]}>
          <Text {...DISCOVER_TEXT_PROPS} style={styles.emptyEmoji}>🎉</Text>
          <Text {...DISCOVER_TEXT_PROPS} style={[styles.emptyTitle, dark && { color: INCOGNITO_COLORS.text }]}>You've seen everyone</Text>
          <Text {...DISCOVER_TEXT_PROPS} style={[styles.emptySubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>
            {isDemoMode
              ? "Great job! Reset the deck or adjust your preferences to see more."
              : "Check back soon for new people, or try different preferences."}
          </Text>
          {isDemoMode && (
            <>
              <TouchableOpacity
                style={[styles.resetButton, { marginTop: SPACING.xl }]}
                onPress={handleResetDeck}
              >
                <Ionicons name="refresh" size={SIZES.icon.md} color="#FFFFFF" style={{ marginRight: SPACING.sm }} />
                <Text {...DISCOVER_TEXT_PROPS} style={styles.resetButtonText}>Reset Demo Deck</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { marginTop: SPACING.md }]}
                onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: 'phase1' } } as any)}
              >
                <Ionicons name="options-outline" size={SIZES.icon.md} color={C.primary} style={{ marginRight: SPACING.sm }} />
                <Text {...DISCOVER_TEXT_PROPS} style={[styles.secondaryButtonText, { color: C.primary }]}>Open Filters</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        {notificationPopover}
      </View>
    );
  }

  // Daily like limit reached state
  if (hasReachedLikeLimit()) {
    return (
      <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
        {!hideHeader && (
          <View style={[styles.header, { paddingTop: compactHeaderTopPadding, height: compactHeaderHeight }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}>
              <Ionicons name="options-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
            </TouchableOpacity>
            <Text {...DISCOVER_TEXT_PROPS} style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
            <View style={styles.headerRightGroup}>
              <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNotificationPopover(true)}>
                <Ionicons name="notifications-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
                {unseenCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text {...DISCOVER_TEXT_PROPS} style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              {!isPhase2 && <HeaderAvatarButton dark={dark} />}
            </View>
          </View>
        )}

        <View style={styles.limitContainer}>
          <Ionicons name="heart-circle-outline" size={DISCOVER_LIMIT_ICON_SIZE} color={COLORS.primary} />
          <Text {...DISCOVER_TEXT_PROPS} style={[styles.limitTitle, dark && { color: INCOGNITO_COLORS.text }]}>You've used today's likes!</Text>
          <Text {...DISCOVER_TEXT_PROPS} style={[styles.limitSubtitle, dark && { color: INCOGNITO_COLORS.textLight }]}>Likes refresh at midnight</Text>
          <TouchableOpacity
            style={styles.limitButton}
            onPress={() => router.push("/(main)/likes" as any)}
          >
            <Ionicons name="heart" size={SIZES.icon.md} color={COLORS.white} />
            <Text {...DISCOVER_TEXT_PROPS} style={styles.limitButtonText}>Check who liked you</Text>
          </TouchableOpacity>
        </View>
        {notificationPopover}
      </View>
    );
  }

  // FIX 10: Layout with safe area compliance across devices
  const cardTop = hideHeader ? 0 : compactHeaderHeight;
  // Phase-2 (Deep Connect): single safe-area helper drives every bottom anchor
  // so the action row, card, and transition hint stay in lockstep across
  // devices. Phase-1 keeps the original three-formula layout unchanged.
  const phase2BottomLayout = isPhase2 ? getDeepConnectBottomLayout(insets) : null;
  // Keep the action row consistently above the gesture area while preserving existing interactions.
  const actionRowBottom = phase2BottomLayout
    ? phase2BottomLayout.actionRowBottom
    : Math.max(insets.bottom, SPACING.md) + SPACING.sm;
  // Leave room for the action bar so card content isn't hidden behind the floating controls.
  const cardBottom = phase2BottomLayout
    ? phase2BottomLayout.cardBottom
    : actionRowBottom + DISCOVER_ACTION_BAR_CLEARANCE;
  const floatingPillTop = cardTop + SPACING.sm;
  const phaseTransitionHintBottom = phase2BottomLayout
    ? phase2BottomLayout.transitionHintBottom
    : Math.max(insets.bottom + SPACING.xl, DISCOVER_TRANSITION_HINT_MIN_BOTTOM);

  return (
    <View style={[styles.container, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
      {isPhase2 && (
        <>
          <LinearGradient
            colors={['#080913', '#101426', '#121c32', '#0d1427', '#080913']}
            locations={[0, 0.28, 0.52, 0.76, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View pointerEvents="none" style={styles.phase2DeckGlowTop} />
          <View pointerEvents="none" style={styles.phase2DeckGlowBottom} />
        </>
      )}

      {/* Compact Header */}
      {!hideHeader && (
        <View style={[styles.header, { paddingTop: compactHeaderTopPadding, height: compactHeaderHeight }, dark && { backgroundColor: INCOGNITO_COLORS.background }]}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.push({ pathname: "/(main)/discovery-preferences", params: { mode: isPhase2 ? 'phase2' : 'phase1' } } as any)}>
            <Ionicons name="options-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
          </TouchableOpacity>
          <Text {...DISCOVER_TEXT_PROPS} style={[styles.headerLogo, dark && { color: INCOGNITO_COLORS.primary }]}>mira</Text>
          <View style={styles.headerRightGroup}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNotificationPopover(true)}>
              <Ionicons name="notifications-outline" size={SIZES.icon.md} color={dark ? INCOGNITO_COLORS.text : COLORS.text} />
              {unseenCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text {...DISCOVER_TEXT_PROPS} style={styles.bellBadgeText}>{unseenCount > 9 ? "9+" : unseenCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            {!isPhase2 && <HeaderAvatarButton dark={dark} />}
          </View>
        </View>
      )}

      {/* Match Reminder - Phase-2 only, shows if user has existing Deep Connects */}
      {isPhase2 && conversationCount > 0 && (
        <TouchableOpacity
          style={[styles.matchReminderPill, { top: floatingPillTop }]}
          onPress={() => router.push("/(main)/(private)/(tabs)/chats" as any)}
          activeOpacity={0.6}
        >
          <Text {...DISCOVER_TEXT_PROPS} style={styles.matchReminderText}>
            {conversationCount === 1
              ? "You have a Deep Connect waiting"
              : `${conversationCount} Deep Connects waiting`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Card Area (fills between header and tab bar) */}
      <View style={[styles.cardArea, { top: cardTop, bottom: cardBottom }]} pointerEvents="box-none">
        {isPhase2 && state === "cards" && !showPhaseTransition ? (
          <Animated.View style={[styles.phase2PullRefreshHint, phase2RefreshHintAnimatedStyle]} pointerEvents="none">
            <View style={styles.phase2PullRefreshInner}>
              <Ionicons
                name={isRefreshingPhase2Deck ? "refresh" : "arrow-down-outline"}
                size={moderateScale(14, 0.3)}
                color="rgba(255,255,255,0.82)"
                style={{ marginRight: SPACING.sm - SPACING.xxs }}
              />
              <Text {...DISCOVER_TEXT_PROPS} style={styles.phase2PullRefreshText}>
                {isRefreshingPhase2Deck ? "Refreshing deck..." : "Pull for fresh faces"}
              </Text>
            </View>
          </Animated.View>
        ) : null}

        {isPhase2 && state === "searching" ? (
          // PHASE2_FLICKER_FIX: Neutral chrome-stable loading surface. No
          // gradient, no sparkles, no copy. Header + tab chrome stay visible
          // while phase2HasHydrated / phase2InitialFilterReady /
          // phase2QueryResolved settle. Mirrors the Phase-1
          // isPhase1InitialLoading branch which also renders an empty body.
          // The container's INCOGNITO_COLORS.background shows through, which
          // matches the eventual ProfileCard surroundings — preventing the
          // visible swap that previously flashed the dark gradient + sparkles.
          null
        ) : (
          <>
            {/* Back card — guard against next === current (queue drained to 1
                profile, or transient race after refill) so the same prompt
                content can never visually stack on the front card. */}
            {next && next.id !== current?.id && (
              <Animated.View
                style={[styles.card, { zIndex: 0 }, nextCardAnimatedStyle]}
              >
                {isPhase2 ? (
                  <ProfileCard
                    key={next.id}
                    phase="phase2"
                    profileId={next.userId ?? next.id}
                    name={next.name}
                    age={next.age}
                    bio={next.bio}
                    isVerified={next.isVerified}
                    verificationStatus={next.verificationStatus}
                    distance={next.distance}
                    photos={next.photos}
                    photoBlurred={next.photoBlurred}
                    photoBlurEnabled={(next as any).photoBlurEnabled}
                    photoBlurSlots={(next as any).photoBlurSlots}
                    trustBadges={nextBadges}
                    profilePrompt={next.profilePrompts?.[0]}
                    profilePrompts={next.profilePrompts}
                    theme="dark"
                    privateIntentKeys={nextIntentKeys}
                    desireTagKeys={(next as any).desireTagKeys}
                    isIncognito={next.isIncognito}
                    presenceStatus={nextPresenceStatus}
                    activities={next.activities}
                    gender={next.gender}
                    lookingFor={next.lookingFor}
                    relationshipIntent={next.relationshipIntent}
                    viewerProfile={viewerProfileForCard}
                    height={next.height}
                    smoking={next.smoking}
                    drinking={next.drinking}
                    education={next.education}
                    religion={next.religion}
                  />
                ) : (
                  <ProfileCardPreview
                    key={next.id}
                    name={next.name}
                    age={next.age}
                    isVerified={next.isVerified}
                    photos={next.photos}
                    photoBlurred={next.photoBlurred}
                    theme="light"
                  />
                )}
              </Animated.View>
            )}
            {/* Top card - wrapped in GestureDetector for UI thread gesture handling */}
            {current && (
              <GestureDetector gesture={panGesture}>
                <Animated.View style={[styles.card, { zIndex: 1 }, cardAnimatedStyle]}>
                  {/* KEY PROP: Forces React to create new instance when profile changes,
                      ensuring photoIndex state resets to 0 for each new profile */}
                  <ProfileCard
                    key={current.id}
                    phase={isPhase2 ? "phase2" : undefined}
                    profileId={current.userId ?? current.id}
                    name={current.name}
                    age={current.age}
                    bio={current.bio}
                    city={isPhase2 ? undefined : current.city}
                    isVerified={current.isVerified}
                    verificationStatus={current.verificationStatus}
                    distance={displayDistanceCurrentCard}
                    photos={current.photos}
                    photoBlurred={current.photoBlurred}
                    photoBlurEnabled={(current as any).photoBlurEnabled}
                    photoBlurSlots={(current as any).photoBlurSlots}
                    trustBadges={currentBadges}
                    profilePrompt={current.profilePrompts?.[0]}
                    profilePrompts={current.profilePrompts}
                    showCarousel
                    onOpenProfile={openProfileCb}
                    theme={isPhase2 ? "dark" : "light"}
                    privateIntentKeys={currentIntentKeys}
                    desireTagKeys={(current as any).desireTagKeys}
                    isIncognito={current.isIncognito}
                    exploreTag={getExploreCategoryTagLabel(exploreCategoryId)}
                    presenceStatus={currentPresenceStatus}
                    activities={current.activities}
                    gender={current.gender}
                    lookingFor={current.lookingFor}
                    relationshipIntent={current.relationshipIntent}
                    viewerProfile={viewerProfileForCard}
                    height={current.height}
                    smoking={current.smoking}
                    drinking={current.drinking}
                    education={current.education}
                    religion={current.religion}
                  />
                  <SwipeOverlay direction={overlayDirection} opacity={overlayOpacity} dark={dark} />
                  {isPhase2 && !phase2TopCardReady ? (
                    <View style={styles.phase2TopCardMediaLoading} pointerEvents="none">
                      <ActivityIndicator size="small" color="rgba(255,255,255,0.82)" />
                    </View>
                  ) : null}
                </Animated.View>
              </GestureDetector>
            )}
          </>
        )}

        {/* Super-like star-burst animation */}
        <StarBurstAnimation visible={showSuperLikeAnimation} onComplete={clearSuperLikeAnimation} />
      </View>

      {/* ══════════════════════════════════════════════════════════════════════════
          PREMIUM 3-BUTTON ACTION BAR
          Floating, semi-transparent, with premium shadows and spacing
          ══════════════════════════════════════════════════════════════════════════ */}
      <View
        style={[
          styles.actions,
          styles.premiumActions,
          // Phase-2 overrides: stable token-based gap + padding so the row
          // doesn't drift wider on 411dp devices vs 360dp devices.
          isPhase2 && styles.deepConnectActions,
          { bottom: actionRowBottom },
        ]}
        pointerEvents="box-none"
      >
        {/* Skip (X) - Light feedback */}
        <AnimatedActionButton
          style={[
            styles.actionButton,
            styles.premiumSkipBtn,
            isPhase2 && styles.deepConnectSkipBtn,
            // P2-1: also visually disable while a swipe is in flight.
            (!current || isSwipeInFlight || (isPhase2 && !phase2TopCardReady)) && styles.premiumBtnDisabled,
          ]}
          onPress={() => animateSwipeRef.current("left")}
          disabled={!current || isSwipeInFlight || (isPhase2 && !phase2TopCardReady)}
          feedbackScale={isPhase2 ? DC_PRESS_SCALE : P1_PRESS_SCALE}
          hapticType="light"
        >
          {/* Phase-2: subtle bottom dark wash for spherical glass depth */}
          {isPhase2 && (
            <LinearGradient
              colors={DC_GLASS_HIGHLIGHT_COLORS_PASS}
              locations={DC_GLASS_HIGHLIGHT_LOCATIONS}
              start={DC_GLASS_HIGHLIGHT_START}
              end={DC_GLASS_HIGHLIGHT_END}
              pointerEvents="none"
              style={styles.deepConnectGlassOverlay}
            />
          )}
          {/* Phase-1: top sheen → soft warm shade for premium 3-D orb */}
          {!isPhase2 && (
            <LinearGradient
              colors={P1_GLASS_HIGHLIGHT_COLORS}
              locations={P1_GLASS_HIGHLIGHT_LOCATIONS}
              start={P1_GLASS_HIGHLIGHT_START}
              end={P1_GLASS_HIGHLIGHT_END}
              pointerEvents="none"
              style={styles.premiumGlassOverlay}
            />
          )}
          <Ionicons
            name="close"
            size={isPhase2 ? DC_ICON_SIZE : P1_ICON_SIZE}
            color={isPhase2 ? "#F44336" : P1_ICON_SKIP}
          />
        </AnimatedActionButton>

        {/* Stand Out (star) - Medium feedback */}
        <AnimatedActionButton
          style={[
            styles.actionButton,
            styles.premiumStandOutBtn,
            isPhase2 && styles.deepConnectStandOutBtn,
            // P2-1: also visually disable while a swipe is in flight.
            (hasReachedStandOutLimit() || !current || isSwipeInFlight || (isPhase2 && !phase2TopCardReady)) && styles.premiumBtnDisabled,
          ]}
          onPress={() => {
            const c = currentRef.current;
            // P2-1: also reject taps during in-flight swipe to avoid opening
            // the Stand Out sheet while a swipe animation/network is active.
            if (!hasReachedStandOutLimit() && c && !isSwipeInFlight && (!isPhase2 || phase2TopCardReady)) {
              // Open inline composer over the current profile card. The
              // numeric `standOutsLeft` is read live by the sheet via the
              // standOutsRemaining() callback below — no need to pass it
              // through a route param.
              setStandOutSheetTarget({ profileId: c.id, name: c.name });
            }
          }}
          disabled={hasReachedStandOutLimit() || !current || isSwipeInFlight || (isPhase2 && !phase2TopCardReady)}
          feedbackScale={isPhase2 ? DC_PRESS_SCALE : P1_PRESS_SCALE}
          hapticType="medium"
        >
          {/* Phase-2: top white sheen + bottom darkening for orb depth */}
          {isPhase2 && (
            <LinearGradient
              colors={DC_GLASS_HIGHLIGHT_COLORS_LIGHT}
              locations={DC_GLASS_HIGHLIGHT_LOCATIONS}
              start={DC_GLASS_HIGHLIGHT_START}
              end={DC_GLASS_HIGHLIGHT_END}
              pointerEvents="none"
              style={styles.deepConnectGlassOverlayCompact}
            />
          )}
          {/* Phase-1: top sheen → soft warm shade for premium 3-D orb */}
          {!isPhase2 && (
            <LinearGradient
              colors={P1_GLASS_HIGHLIGHT_COLORS}
              locations={P1_GLASS_HIGHLIGHT_LOCATIONS}
              start={P1_GLASS_HIGHLIGHT_START}
              end={P1_GLASS_HIGHLIGHT_END}
              pointerEvents="none"
              style={styles.premiumGlassOverlayCompact}
            />
          )}
          <Ionicons
            name="star"
            size={isPhase2 ? DC_STAR_ICON_SIZE : P1_STAR_ICON_SIZE}
            color={isPhase2 ? COLORS.white : P1_ICON_STANDOUT}
          />
          {/* Numeric "remaining" badge intentionally hidden in both phases.
              hasReachedStandOutLimit() still gates onPress. */}
        </AnimatedActionButton>

        {/* Like (heart) - Medium feedback with stronger scale */}
        <AnimatedActionButton
          style={[
            styles.actionButton,
            styles.premiumLikeBtn,
            isPhase2 && styles.deepConnectLikeBtn,
            // P2-1: also visually disable while a swipe is in flight.
            (!current || isSwipeInFlight || (isPhase2 && !phase2TopCardReady)) && styles.premiumBtnDisabled,
          ]}
          onPress={() => animateSwipeRef.current("right")}
          disabled={!current || isSwipeInFlight || (isPhase2 && !phase2TopCardReady)}
          feedbackScale={isPhase2 ? DC_PRESS_SCALE : P1_PRESS_SCALE}
          hapticType="medium"
        >
          {/* Phase-2: top white sheen + bottom darkening for orb depth */}
          {isPhase2 && (
            <LinearGradient
              colors={DC_GLASS_HIGHLIGHT_COLORS_LIGHT}
              locations={DC_GLASS_HIGHLIGHT_LOCATIONS}
              start={DC_GLASS_HIGHLIGHT_START}
              end={DC_GLASS_HIGHLIGHT_END}
              pointerEvents="none"
              style={styles.deepConnectGlassOverlay}
            />
          )}
          {/* Phase-1: top sheen → soft warm shade for premium 3-D orb */}
          {!isPhase2 && (
            <LinearGradient
              colors={P1_GLASS_HIGHLIGHT_COLORS}
              locations={P1_GLASS_HIGHLIGHT_LOCATIONS}
              start={P1_GLASS_HIGHLIGHT_START}
              end={P1_GLASS_HIGHLIGHT_END}
              pointerEvents="none"
              style={styles.premiumGlassOverlay}
            />
          )}
          <Ionicons
            name="heart"
            size={isPhase2 ? DC_ICON_SIZE : P1_ICON_SIZE}
            color={isPhase2 ? COLORS.white : P1_ICON_LIKE}
          />
        </AnimatedActionButton>
      </View>

      {notificationPopover}

      {/* ══════════════════════════════════════════════════════════════════════════
          PHASE TRANSITION OVERLAY (Phase-2 Entry Experience)
          Premium entry moment when entering Deep Connect
          ══════════════════════════════════════════════════════════════════════════ */}
      {showPhaseTransition && (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={dismissPhaseTransition}
        >
          <Animated.View
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(250)}
            style={styles.phaseTransitionOverlay}
          >
            {/* Gradient overlay for depth */}
            <View style={styles.phaseTransitionGradient} />

            {/* Centered intro text */}
            <Animated.View
              entering={FadeIn.delay(80).duration(300)}
              style={styles.phaseTransitionContent}
            >
              <Animated.Text
                {...DISCOVER_TEXT_PROPS}
                entering={FadeIn.delay(120).duration(350)}
                style={styles.phaseTransitionTitle}
              >
                Deep Connect
              </Animated.Text>
              <Animated.Text
                {...DISCOVER_TEXT_PROPS}
                entering={FadeIn.delay(220).duration(350)}
                style={styles.phaseTransitionSubtitle}
              >
                More private. More real.
              </Animated.Text>
            </Animated.View>

            {/* Subtle tap hint */}
            <Animated.Text
              {...DISCOVER_TEXT_PROPS}
              entering={FadeIn.delay(600).duration(400)}
              style={[styles.phaseTransitionSkipHint, { bottom: phaseTransitionHintBottom }]}
            >
              tap to continue
            </Animated.Text>
          </Animated.View>
        </TouchableOpacity>
      )}

      {/* P2_MATCH: Premium Deep Connect Match Celebration */}
      {phase2MatchCelebration.visible && phase2MatchCelebration.matchedProfile && (
        <Modal
          visible
          transparent
          statusBarTranslucent
          animationType="none"
          onRequestClose={() => setPhase2MatchCelebration({ visible: false, matchedProfile: null })}
        >
          {/* Premium full-screen backdrop */}
          <Animated.View
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(200)}
            style={styles.p2MatchFullScreen}
          >
            {/* Blur background for premium feel */}
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />

            {/* Gradient overlay for depth */}
            <View style={styles.p2MatchGradientOverlay} />

            {/* Celebration content */}
            <Animated.View
              entering={FadeIn.delay(150).duration(420).springify().damping(18)}
              style={styles.p2MatchContent}
            >
              {/* Premium avatar composition */}
              <Animated.View
                entering={FadeIn.delay(200).duration(520).springify().damping(16)}
                style={styles.p2MatchAvatarSection}
              >
                <MatchCelebrationPulse />

                {/* Profile photo with premium frame */}
                <View style={styles.p2MatchPremiumFrame}>
                  <View style={styles.p2MatchInnerFrame}>
                    {phase2MatchCelebration.matchedProfile.photoUrl ? (
                      <Image
                        source={{ uri: phase2MatchCelebration.matchedProfile.photoUrl }}
                        style={styles.p2MatchPremiumAvatar}
                        blurRadius={12}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.p2MatchPremiumAvatar, styles.p2MatchAvatarPlaceholder]}>
                        <Ionicons name="person" size={DISCOVER_MATCH_AVATAR_ICON_SIZE} color="rgba(255,255,255,0.4)" />
                      </View>
                    )}
                  </View>
                  {/* Accent ring */}
                  <View style={styles.p2MatchAccentRing} />
                </View>
              </Animated.View>

              {/* Premium typography */}
              <Animated.View
                entering={FadeIn.delay(350).duration(400)}
                style={styles.p2MatchTextSection}
              >
                <Text {...DISCOVER_TEXT_PROPS} style={styles.p2MatchPremiumTitle}>
                  {phase2MatchCelebration.matchedProfile.alreadyMatched
                    ? "You're already matched"
                    : phase2MatchCelebration.matchedProfile.source === 'rematch'
                      ? "Connection restored"
                      : "It's a Deep Connect match 🔥"}
                </Text>
                <Text {...DISCOVER_TEXT_PROPS} style={styles.p2MatchPremiumSubtitle}>
                  {phase2MatchCelebration.matchedProfile.alreadyMatched
                    ? `You and ${phase2MatchCelebration.matchedProfile.name} already have a chat waiting.`
                    : `You and ${phase2MatchCelebration.matchedProfile.name} chose each other in Deep Connect.`}
                </Text>
              </Animated.View>

              {/* Premium action buttons */}
              <Animated.View
                entering={FadeIn.delay(500).duration(400)}
                style={styles.p2MatchPremiumActions}
              >
                <TouchableOpacity
                  style={styles.p2MatchStartChatBtn}
                  activeOpacity={0.85}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    const convoId = phase2MatchCelebration.matchedProfile?.conversationId;
                    setPhase2MatchCelebration({ visible: false, matchedProfile: null });
                    if (convoId) {
                      router.push(`/(main)/(private)/(tabs)/chats/${encodeURIComponent(convoId)}` as any);
                    }
                  }}
                >
                  <View style={styles.p2MatchBtnGradient}>
                    <Ionicons name="chatbubble-ellipses" size={SIZES.icon.md} color="#FFF" />
                    <Text {...DISCOVER_TEXT_PROPS} style={styles.p2MatchStartChatText}>
                      {phase2MatchCelebration.matchedProfile.alreadyMatched ? 'Continue Chat' : 'Open Chat'}
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.p2MatchKeepExploringBtn}
                  activeOpacity={0.7}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setPhase2MatchCelebration({ visible: false, matchedProfile: null });
                  }}
                >
                  <Text {...DISCOVER_TEXT_PROPS} style={styles.p2MatchKeepExploringText}>Keep Exploring</Text>
                </TouchableOpacity>
              </Animated.View>
            </Animated.View>
          </Animated.View>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          FIRST-TIME USER EXPERIENCE OVERLAYS
          ══════════════════════════════════════════════════════════════════════════ */}

      {/* Welcome Overlay - Phase-1 only (Phase-2 has its own transition) */}
      <WelcomeOverlay
        visible={showWelcomeOverlay}
        onDismiss={() => setShowWelcomeOverlay(false)}
        dark={dark}
        title="You're in"
        subtitle="Welcome to Mira"
      />

      {/* Swipe Guidance Hint - shows after welcome/transition */}
      <SwipeGuidanceHint
        visible={showSwipeGuidance}
        onDismiss={() => setShowSwipeGuidance(false)}
        dark={dark}
      />

      {/* Inline Stand Out composer. Renders as a premium bottom sheet over
          the current profile card — no separate route, no white-page flash.
          Sending dispatches to the existing standOutResult pipeline so the
          Phase-1 / Phase-2 swipe + mutation flow stays untouched. */}
      <StandOutComposerSheet
        visible={standOutSheetTarget !== null}
        targetName={standOutSheetTarget?.name ?? null}
        standOutsLeft={standOutsRemaining()}
        mode={isPhase2 ? 'phase2' : 'phase1'}
        onSend={(message) => {
          const target = standOutSheetTarget;
          // Close the sheet first so its dismissal animation runs in parallel
          // with the card's "stand out" up-animation kicked off by the
          // existing standOutResult effect.
          setStandOutSheetTarget(null);
          if (!target) return;
          useInteractionStore.getState().setStandOutResult({
            profileId: target.profileId,
            message,
          });
        }}
        onClose={() => setStandOutSheetTarget(null)}
      />
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
    padding: SPACING.xl,
  },
  // FIX 9: Premium empty state styles - minimal and polished
  emptyEmoji: {
    fontSize: DISCOVER_EMOJI_SIZE,
    lineHeight: lineHeight(DISCOVER_EMOJI_SIZE, 1.2),
    marginBottom: SPACING.xl,
  },
  emptyTitle: {
    fontSize: DISCOVER_FONT_26,
    fontWeight: "700",
    lineHeight: lineHeight(DISCOVER_FONT_26, 1.2),
    color: COLORS.text,
    marginBottom: SPACING.md,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  emptySubtitle: {
    fontSize: DISCOVER_FONT_15,
    color: COLORS.textLight,
    textAlign: "center",
    lineHeight: lineHeight(DISCOVER_FONT_15, 1.35),
    paddingHorizontal: SPACING.xxl,
    maxWidth: DISCOVER_EMPTY_CONTENT_MAX_WIDTH,
  },
  phase2EmptyContent: {
    alignItems: "center",
    width: "100%",
    maxWidth: DISCOVER_EMPTY_CONTENT_MAX_WIDTH,
    paddingHorizontal: SPACING.xl + SPACING.xs,
    zIndex: 2,
  },
  phase2SearchingOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xl + SPACING.xs,
    overflow: "hidden",
  },
  phase2SearchingGlow: {
    position: "absolute",
    width: moderateScale(260, 0.25),
    height: moderateScale(260, 0.25),
    borderRadius: moderateScale(130, 0.25),
    backgroundColor: "rgba(233, 69, 96, 0.08)",
    shadowColor: "#E94560",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 70,
  },
  // Subtle radial glow overlay for depth
  phase2RadialGlow: {
    position: 'absolute',
    width: moderateScale(400, 0.25),
    height: moderateScale(400, 0.25),
    borderRadius: moderateScale(200, 0.25),
    backgroundColor: 'rgba(233, 69, 96, 0.03)',
    top: '30%',
    alignSelf: 'center',
    shadowColor: '#E94560',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 120,
  },
  // Premium outer glow ring
  phase2IconOuter: {
    width: moderateScale(100, 0.25),
    height: moderateScale(100, 0.25),
    borderRadius: moderateScale(50, 0.25),
    backgroundColor: 'rgba(233, 69, 96, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xxl,
    // Soft outer glow
    shadowColor: '#E94560',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 40,
  },
  // Inner icon container with tighter glow
  phase2IconInner: {
    width: moderateScale(72, 0.25),
    height: moderateScale(72, 0.25),
    borderRadius: moderateScale(36, 0.25),
    backgroundColor: 'rgba(233, 69, 96, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    // Inner glow
    shadowColor: '#E94560',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  // Premium title typography
  phase2EmptyTitle: {
    fontSize: DISCOVER_FONT_21,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.95)',
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: lineHeight(DISCOVER_FONT_21, 1.2),
  },
  // Softer subtitle typography
  phase2EmptySubtitle: {
    fontSize: DISCOVER_FONT_15,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    marginTop: SPACING.sm + SPACING.xxs,
    lineHeight: lineHeight(DISCOVER_FONT_15, 1.35),
    letterSpacing: 0.2,
  },
  phase2EmptyActions: {
    width: "100%",
    marginTop: SPACING.xxl - SPACING.xs,
    gap: SPACING.md,
  },
  phase2PrimaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(233, 69, 96, 0.28)',
    paddingVertical: SPACING.md + SPACING.xxs,
    paddingHorizontal: SPACING.lg,
    borderRadius: SIZES.radius.md + SPACING.xxs,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  phase2PrimaryActionText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    color: 'rgba(255, 255, 255, 0.92)',
    letterSpacing: 0.3,
  },
  phase2SecondaryAction: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: SIZES.radius.md + SPACING.xxs,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  phase2SecondaryActionText: {
    fontSize: FONT_SIZE.md,
    fontWeight: "500",
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    color: "rgba(255,255,255,0.78)",
  },
  // Phase-1 empty content container (mirrors Phase-2 structure)
  phase1EmptyContent: {
    alignItems: "center",
    width: "100%",
    maxWidth: DISCOVER_EMPTY_CARD_MAX_WIDTH,
    paddingHorizontal: SPACING.xl,
    zIndex: 2,
  },
  // ══════════════════════════════════════════════════════════════════════════════
  // PREMIUM PHASE-1 EMPTY STATE STYLES
  // Clean, elegant, light theme with subtle depth
  // ══════════════════════════════════════════════════════════════════════════════
  // Premium card container for empty state
  phase1EmptyCard: {
    alignItems: "center",
    width: "100%",
    maxWidth: DISCOVER_EMPTY_CARD_MAX_WIDTH,
    paddingVertical: SPACING.xxxl,
    paddingHorizontal: SPACING.xxl,
    backgroundColor: "#FFFFFF",
    borderRadius: SIZES.radius.xl,
    // Natural vertical positioning (not stuck to center)
    marginTop: -moderateScale(40, 0.25),
    // Premium subtle shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 6,
    // Subtle border for definition
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.04)",
    zIndex: 2,
  },
  // Subtle radial glow for Phase-1 (light version - visible but soft)
  phase1RadialGlow: {
    position: "absolute",
    width: moderateScale(320, 0.25),
    height: moderateScale(320, 0.25),
    borderRadius: moderateScale(160, 0.25),
    backgroundColor: "rgba(255, 107, 107, 0.07)",
    top: "22%",
    alignSelf: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.10,
    shadowRadius: 100,
  },
  // Premium icon container (outer glow ring - light theme)
  phase1IconOuter: {
    width: moderateScale(96, 0.25),
    height: moderateScale(96, 0.25),
    borderRadius: moderateScale(48, 0.25),
    backgroundColor: "rgba(255, 107, 107, 0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.xxl - SPACING.xs,
    // Soft outer glow
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
  },
  // Inner icon container with tighter styling
  phase1IconInner: {
    width: moderateScale(68, 0.25),
    height: moderateScale(68, 0.25),
    borderRadius: moderateScale(34, 0.25),
    backgroundColor: "rgba(255, 107, 107, 0.10)",
    alignItems: "center",
    justifyContent: "center",
    // Inner glow
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  // Premium title typography (Phase-1)
  phase1EmptyTitle: {
    fontSize: DISCOVER_FONT_22,
    fontWeight: "700",
    color: COLORS.text,
    textAlign: "center",
    letterSpacing: -0.3,
    lineHeight: lineHeight(DISCOVER_FONT_22, 1.2),
  },
  // Softer subtitle typography (Phase-1)
  phase1EmptySubtitle: {
    fontSize: DISCOVER_FONT_15,
    fontWeight: "400",
    color: "#8E8E93",
    textAlign: "center",
    marginTop: SPACING.sm + SPACING.xxs,
    lineHeight: lineHeight(DISCOVER_FONT_15, 1.35),
    letterSpacing: 0.1,
    paddingHorizontal: SPACING.sm,
  },
  // Premium reset button (Phase-1, demo only)
  phase1ResetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md + SPACING.xxs,
    paddingHorizontal: SPACING.xl,
    borderRadius: SIZES.radius.md + SPACING.xxs,
    marginTop: SPACING.xxl - SPACING.xs,
    // Soft shadow for depth
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  phase1ResetButtonText: {
    fontSize: DISCOVER_FONT_15,
    fontWeight: "600",
    lineHeight: lineHeight(DISCOVER_FONT_15, 1.35),
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  // Premium header for Phase-1 empty state
  phase1Header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    backgroundColor: "transparent",
    zIndex: 10,
  },
  // Header button with subtle background
  phase1HeaderBtn: {
    width: SIZES.touchTarget,
    height: SIZES.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    borderRadius: SIZES.touchTarget / 2,
    backgroundColor: "rgba(0, 0, 0, 0.03)",
  },

  // Premium Compact Header
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm + SPACING.xxs,
    backgroundColor: COLORS.background,
    zIndex: 10,
  },
  headerBtn: {
    width: SIZES.touchTarget,
    height: SIZES.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    borderRadius: SIZES.touchTarget / 2,
  },
  headerRightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  headerLogo: {
    fontSize: FONT_SIZE.title,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: 1.5,
  },
  bellBadge: {
    position: "absolute",
    top: SPACING.xxs,
    right: 0,
    minWidth: DISCOVER_BADGE_SIZE,
    height: DISCOVER_BADGE_SIZE,
    borderRadius: DISCOVER_BADGE_SIZE / 2,
    backgroundColor: COLORS.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xs,
    borderWidth: 2,
    borderColor: COLORS.background,
    shadowColor: COLORS.error,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  bellBadgeText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: "700",
    lineHeight: lineHeight(FONT_SIZE.xs, 1.2),
    color: COLORS.white,
  },

  // Card Area
  cardArea: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  phase2DeckGlowTop: {
    position: "absolute",
    top: -moderateScale(40, 0.25),
    right: -moderateScale(30, 0.25),
    width: moderateScale(260, 0.25),
    height: moderateScale(260, 0.25),
    borderRadius: moderateScale(130, 0.25),
    backgroundColor: "rgba(104, 92, 255, 0.12)",
    shadowColor: "#685cff",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 120,
  },
  phase2DeckGlowBottom: {
    position: "absolute",
    left: -moderateScale(60, 0.25),
    bottom: moderateScale(90, 0.25),
    width: moderateScale(280, 0.25),
    height: moderateScale(280, 0.25),
    borderRadius: moderateScale(140, 0.25),
    backgroundColor: "rgba(233, 69, 96, 0.08)",
    shadowColor: "#e94560",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 140,
  },
  phase2PullRefreshHint: {
    position: "absolute",
    top: SPACING.md - SPACING.xxs,
    alignSelf: "center",
    zIndex: 25,
  },
  phase2PullRefreshInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: SIZES.radius.full,
    backgroundColor: "rgba(10, 14, 28, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  phase2PullRefreshText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: "600",
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: "rgba(255,255,255,0.78)",
    letterSpacing: 0.2,
  },
  card: {
    position: "absolute",
    top: SPACING.sm,
    left: DISCOVER_CARD_HORIZONTAL_INSET,
    right: DISCOVER_CARD_HORIZONTAL_INSET,
    bottom: SPACING.sm,
    borderRadius: SIZES.radius.lg,
    overflow: "hidden",
  },
  phase2TopCardMediaLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5, 8, 18, 0.16)",
  },

  // 3-Button Action Bar (base)
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.lg,
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

  // ══════════════════════════════════════════════════════════════════════════════
  // PREMIUM ACTION BAR STYLES
  // Floating, semi-transparent, with premium shadows and spacing
  // ══════════════════════════════════════════════════════════════════════════════
  // Phase-1 floating premium action row. The wrapper inherits `styles.actions`
  // which is already transparent + position:absolute (no slab). cappedScale
  // diameters keep the row a stable physical size on Samsung 360dp ↔ OnePlus
  // 411dp ↔ iPhone 390dp. All three buttons share `P1_BUTTON_SHADOW` (warm-
  // neutral lift) so the row reads as three independent floating orbs, not a
  // ring of competing coloured halos.
  premiumActions: {
    gap: P1_BUTTON_GAP,
    paddingHorizontal: P1_ROW_PADDING_X,
    paddingBottom: P1_ROW_PADDING_BOTTOM,
  },
  premiumSkipBtn: {
    width: P1_BUTTON_DIAMETER,
    height: P1_BUTTON_DIAMETER,
    borderRadius: P1_BUTTON_DIAMETER / 2,
    backgroundColor: P1_SURFACE,
    borderWidth: P1_BORDER_WIDTH,
    borderColor: P1_BORDER_SKIP,
    overflow: "hidden",
    ...P1_BUTTON_SHADOW,
  },
  premiumStandOutBtn: {
    width: P1_BUTTON_DIAMETER_COMPACT,
    height: P1_BUTTON_DIAMETER_COMPACT,
    borderRadius: P1_BUTTON_DIAMETER_COMPACT / 2,
    backgroundColor: P1_SURFACE_TINT_STANDOUT,
    borderWidth: P1_BORDER_WIDTH,
    borderColor: P1_BORDER_STANDOUT,
    position: "relative",
    overflow: "hidden",
    ...P1_BUTTON_SHADOW,
  },
  premiumLikeBtn: {
    width: P1_BUTTON_DIAMETER,
    height: P1_BUTTON_DIAMETER,
    borderRadius: P1_BUTTON_DIAMETER / 2,
    backgroundColor: P1_SURFACE_TINT_LIKE,
    borderWidth: P1_BORDER_WIDTH,
    borderColor: P1_BORDER_LIKE,
    overflow: "hidden",
    ...P1_BUTTON_SHADOW,
  },
  // Phase-1 inner glass-highlight overlays. Borders are clipped by
  // `overflow:'hidden'` on each button (parent `borderRadius` carries the
  // circle). Two diameters because Stand Out is the compact size.
  premiumGlassOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: P1_BUTTON_DIAMETER / 2,
  },
  premiumGlassOverlayCompact: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: P1_BUTTON_DIAMETER_COMPACT / 2,
  },
  premiumBtnDisabled: {
    opacity: P1_DISABLED_OPACITY,
    shadowOpacity: P1_DISABLED_SHADOW_OPACITY,
  },
  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE-2 (DEEP CONNECT) ACTION-ROW OVERRIDES
  // Applied via mode-gated style merge; Phase-1 styles above remain unchanged.
  // Tokens come from `_internal/deepConnectActionRow.tokens.ts`.
  // ══════════════════════════════════════════════════════════════════════════════
  deepConnectActions: {
    // Replaces `gap: SPACING.xxl - SPACING.xs` with one stable cappedScale value.
    // marginHorizontal fallback ensures consistent spacing on RN versions where
    // flex `gap` is unreliable (older Android Hermes builds).
    gap: DC_BUTTON_GAP,
    paddingHorizontal: DC_ROW_PADDING_X,
    paddingBottom: DC_ROW_PADDING_BOTTOM,
  },
  deepConnectSkipBtn: {
    width: DC_BUTTON_DIAMETER,
    height: DC_BUTTON_DIAMETER,
    borderRadius: DC_BUTTON_DIAMETER / 2,
    // Frosted-white feel: brighter base + slightly stronger accent border to
    // give the Pass button a clean, calm presence (not a weak grey circle).
    backgroundColor: "rgba(255,255,255,0.97)",
    borderWidth: DC_GLASS_BORDER_WIDTH,
    borderColor: DC_GLASS_BORDER_PASS,
    shadowColor: "#000",
    ...DC_BUTTON_SHADOW,
  },
  deepConnectStandOutBtn: {
    width: DC_BUTTON_DIAMETER_COMPACT,
    height: DC_BUTTON_DIAMETER_COMPACT,
    borderRadius: DC_BUTTON_DIAMETER_COMPACT / 2,
    // Solid premium blue surface so the white star icon reads clearly.
    // Mirrors the Phase-2 opened-profile floatingStyles.standOutButton.
    backgroundColor: "#2196F3",
    // Lit edge — sells the "premium glass orb" silhouette.
    borderWidth: DC_GLASS_BORDER_WIDTH,
    borderColor: DC_GLASS_BORDER_LIGHT,
    // Neutral lift only — no coloured glow ring.
    shadowColor: "#000",
    ...DC_BUTTON_SHADOW,
  },
  deepConnectLikeBtn: {
    width: DC_BUTTON_DIAMETER,
    height: DC_BUTTON_DIAMETER,
    borderRadius: DC_BUTTON_DIAMETER / 2,
    // Solid premium pink surface so the white heart icon reads clearly.
    // Mirrors the Phase-2 opened-profile floatingStyles.likeButton.
    backgroundColor: COLORS.primary,
    borderWidth: DC_GLASS_BORDER_WIDTH,
    borderColor: DC_GLASS_BORDER_LIGHT,
    // Neutral lift only — no coloured glow ring.
    shadowColor: "#000",
    ...DC_BUTTON_SHADOW,
  },

  // Inner glass-highlight overlays. Rendered as a child of each Phase-2
  // button via LinearGradient. `borderRadius` matches the parent button so
  // the gradient is clipped to the circle without needing `overflow:'hidden'`
  // (which on iOS would also clip the halo shadow).
  deepConnectGlassOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: DC_BUTTON_DIAMETER / 2,
  },
  deepConnectGlassOverlayCompact: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: DC_BUTTON_DIAMETER_COMPACT / 2,
  },

  // Daily limit reached
  limitContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xxl,
  },
  limitTitle: {
    fontSize: DISCOVER_FONT_22,
    fontWeight: "700",
    lineHeight: lineHeight(DISCOVER_FONT_22, 1.2),
    color: COLORS.text,
    marginTop: SPACING.base,
    marginBottom: SPACING.sm,
    textAlign: "center",
  },
  limitSubtitle: {
    fontSize: DISCOVER_FONT_15,
    color: COLORS.textLight,
    lineHeight: lineHeight(DISCOVER_FONT_15, 1.35),
    marginBottom: SPACING.xl,
    textAlign: "center",
  },
  limitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md + SPACING.xxs,
    borderRadius: SIZES.radius.xl + SPACING.xs,
  },
  limitButtonText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: "600",
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    color: COLORS.white,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md + SPACING.xxs,
    borderRadius: SIZES.radius.xl + SPACING.xs,
  },
  resetButtonText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: "600",
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    color: COLORS.white,
  },
  // STEP 2.7: Empty state secondary button styles
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: SIZES.radius.xl + SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  secondaryButtonText: {
    fontSize: DISCOVER_FONT_15,
    fontWeight: "600",
    lineHeight: lineHeight(DISCOVER_FONT_15, 1.35),
  },
  tipText: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textLight,
    textAlign: "center",
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.xxl,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
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

  // P2_MATCH: Phase-2 Match Celebration styles
  p2MatchOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  p2MatchSheet: {
    backgroundColor: INCOGNITO_COLORS.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
  },
  p2MatchAvatarContainer: {
    position: "relative",
    marginBottom: 20,
  },
  p2MatchAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: INCOGNITO_COLORS.primary,
  },
  p2MatchAvatarPlaceholder: {
    backgroundColor: INCOGNITO_COLORS.background,
    alignItems: "center",
    justifyContent: "center",
  },
  p2MatchHeartBadge: {
    position: "absolute",
    bottom: -5,
    right: -5,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: INCOGNITO_COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: INCOGNITO_COLORS.surface,
  },
  p2MatchTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: INCOGNITO_COLORS.text,
    marginBottom: 8,
    textAlign: "center",
  },
  p2MatchSubtitle: {
    fontSize: 15,
    color: INCOGNITO_COLORS.textLight,
    textAlign: "center",
    marginBottom: 28,
  },
  p2MatchActions: {
    width: "100%",
    gap: 12,
  },
  p2MatchPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: INCOGNITO_COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  p2MatchPrimaryText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
  p2MatchSecondaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  p2MatchSecondaryText: {
    fontSize: 15,
    fontWeight: "500",
    color: INCOGNITO_COLORS.textLight,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PREMIUM MATCH CELEBRATION (Phase-2 Deep Connect)
  // ══════════════════════════════════════════════════════════════════════════
  p2MatchFullScreen: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  p2MatchGradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
  },
  p2MatchContent: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.xxxl,
    width: "100%",
    maxWidth: DISCOVER_EMPTY_CARD_MAX_WIDTH,
  },
  p2MatchGlowRing: {
    position: "absolute",
    width: moderateScale(280, 0.25),
    height: moderateScale(280, 0.25),
    borderRadius: moderateScale(140, 0.25),
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "rgba(155, 89, 182, 0.15)",
    top: "50%",
    marginTop: -moderateScale(140, 0.25),
  },
  p2MatchAvatarSection: {
    alignItems: "center",
    marginBottom: SPACING.xxl,
  },
  p2MatchFloatingHeart: {
    width: DISCOVER_MATCH_AVATAR_ICON_SIZE,
    height: DISCOVER_MATCH_AVATAR_ICON_SIZE,
    borderRadius: DISCOVER_MATCH_AVATAR_ICON_SIZE / 2,
    backgroundColor: "rgba(155, 89, 182, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.base,
  },
  p2MatchPremiumFrame: {
    width: moderateScale(140, 0.25),
    height: moderateScale(140, 0.25),
    borderRadius: moderateScale(70, 0.25),
    backgroundColor: "rgba(155, 89, 182, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  p2MatchInnerFrame: {
    width: moderateScale(120, 0.25),
    height: moderateScale(120, 0.25),
    borderRadius: moderateScale(60, 0.25),
    backgroundColor: INCOGNITO_COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  p2MatchPremiumAvatar: {
    width: moderateScale(120, 0.25),
    height: moderateScale(120, 0.25),
    borderRadius: moderateScale(60, 0.25),
  },
  p2MatchAccentRing: {
    position: "absolute",
    width: moderateScale(148, 0.25),
    height: moderateScale(148, 0.25),
    borderRadius: moderateScale(74, 0.25),
    borderWidth: 2,
    borderColor: "rgba(155, 89, 182, 0.4)",
    borderStyle: "dashed",
  },
  p2MatchTextSection: {
    alignItems: "center",
    marginBottom: SPACING.xxl,
  },
  p2MatchPremiumTitle: {
    fontSize: FONT_SIZE.h2,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    lineHeight: lineHeight(FONT_SIZE.h2, 1.2),
    marginBottom: SPACING.sm + SPACING.xxs,
    textAlign: "center",
  },
  p2MatchPremiumSubtitle: {
    fontSize: FONT_SIZE.lg,
    color: "rgba(255, 255, 255, 0.7)",
    textAlign: "center",
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
  },
  p2MatchPremiumActions: {
    width: "100%",
    gap: SPACING.md + SPACING.xxs,
  },
  p2MatchStartChatBtn: {
    width: "100%",
    borderRadius: SIZES.radius.lg,
    overflow: "hidden",
  },
  p2MatchBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm + SPACING.xxs,
    backgroundColor: "#9b59b6",
    paddingVertical: SPACING.base,
    paddingHorizontal: SPACING.xxl,
  },
  p2MatchStartChatText: {
    fontSize: DISCOVER_FONT_17,
    fontWeight: "700",
    lineHeight: lineHeight(DISCOVER_FONT_17, 1.35),
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  p2MatchKeepExploringBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: SPACING.md + SPACING.xxs,
  },
  p2MatchKeepExploringText: {
    fontSize: DISCOVER_FONT_15,
    fontWeight: "500",
    lineHeight: lineHeight(DISCOVER_FONT_15, 1.35),
    color: "rgba(255, 255, 255, 0.6)",
  },

  // Match Reminder Pill (Phase-2 Only)
  matchReminderPill: {
    position: "absolute",
    alignSelf: "center",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 5,
  },
  matchReminderText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: "500",
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: "rgba(255, 255, 255, 0.4)",
    letterSpacing: 0.2,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE TRANSITION OVERLAY (Phase-2 Entry Experience)
  // ══════════════════════════════════════════════════════════════════════════
  phaseTransitionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  phaseTransitionGradient: {
    ...StyleSheet.absoluteFillObject,
    // Subtle radial-like gradient effect using layered background
    backgroundColor: "transparent",
    // Top-to-bottom subtle gradient simulation
    borderTopWidth: 0,
    opacity: 0.3,
  },
  phaseTransitionContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  phaseTransitionTitle: {
    fontSize: FONT_SIZE.h1,
    fontWeight: "300",
    color: "#FFFFFF",
    letterSpacing: 1.5,
    lineHeight: lineHeight(FONT_SIZE.h1, 1.2),
    marginBottom: SPACING.md,
    textAlign: "center",
  },
  phaseTransitionSubtitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: "400",
    color: "rgba(255, 255, 255, 0.55)",
    letterSpacing: 0.5,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    textAlign: "center",
  },
  phaseTransitionSkipHint: {
    position: "absolute",
    fontSize: FONT_SIZE.caption,
    fontWeight: "400",
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: "rgba(255, 255, 255, 0.25)",
    letterSpacing: 0.3,
  },
});
