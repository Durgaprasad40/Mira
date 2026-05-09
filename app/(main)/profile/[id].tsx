import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { safePush } from '@/lib/safeRouter';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useAuthStore } from '@/stores/authStore';
import {
  COLORS,
  RELATIONSHIP_INTENTS,
  ACTIVITY_FILTERS,
  PROFILE_PROMPT_QUESTIONS,
  KIDS_OPTIONS,
  RELIGION_OPTIONS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  CORE_VALUES_OPTIONS,
  GENDER_OPTIONS,
} from '@/lib/constants';
import { computeIntentCompat, getIntentCompatColor, getIntentMismatchWarning } from '@/lib/intentCompat';
// P0 UNIFIED PRESENCE: Reactive presence query for profile page
import { useUserPresence } from '@/hooks/usePresence';
import { Button, Avatar } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { FlatList } from 'react-native';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES, getDemoCurrentUser, DEMO_INCOGNITO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { ReportBlockModal } from '@/components/security/ReportBlockModal';
import { Toast } from '@/components/ui/Toast';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { useInteractionStore } from '@/stores/interactionStore';
import { formatDiscoverDistanceKm } from '@/lib/distanceRules';
import { formatPhase2DistanceMiles } from '@/lib/phase2Distance';
import { getVerificationDisplay } from '@/lib/verificationStatus';
import { getRenderableProfilePhotos } from '@/lib/profileData';
// Phase-1 only premium light/shaded theme tokens. Phase-2 surfaces must
// not import this file.
import { PHASE1_DISCOVER_THEME } from '@/components/screens/_internal/phase1DiscoverTheme.tokens';
// Phase-1 floating action-row tokens. Mirrors the structure of the Deep
// Connect token system but stays in the Phase-1 light visual identity.
// Phase-2 paths must not import this file.
import {
  P1_BUTTON_DIAMETER,
  P1_BUTTON_DIAMETER_COMPACT,
  P1_ICON_SIZE,
  P1_STAR_ICON_SIZE,
  P1_BUTTON_GAP,
  P1_ROW_PADDING_X,
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
  getPhase1OpenProfileActionLayout,
} from '@/components/screens/_internal/phase1ActionRow.tokens';
// P0-FIX: Haptic feedback for premium interactions
import * as Haptics from 'expo-haptics';
import { trackEvent } from '@/lib/analytics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';

const PHASE1_OPEN_PROFILE_ACTION_LIFT = 30;

function getVerificationBadgeState(profile: { isVerified?: boolean; verificationStatus?: string }) {
  const display = getVerificationDisplay(profile);

  // Premium tone-driven palette: green / amber / red. Background is the
  // text/icon hex at ~14% opacity to keep the pill calm and on-brand.
  switch (display.tone) {
    case 'verified':
      return {
        label: display.label,
        color: '#10B981',
        background: 'rgba(16, 185, 129, 0.14)',
        icon: 'shield-checkmark' as const,
      };
    case 'pending':
      return {
        label: display.label,
        color: '#F59E0B',
        background: 'rgba(245, 158, 11, 0.14)',
        icon: 'time-outline' as const,
      };
    default:
      return {
        label: display.label,
        color: '#EF4444',
        background: 'rgba(239, 68, 68, 0.14)',
        icon: 'alert-circle-outline' as const,
      };
  }
}

// P0-FIX: Profile skeleton loader component (matches profile layout)
function ProfileSkeleton({ insets, screenWidth }: { insets: { top: number }; screenWidth: number }) {
  const shimmerAnim = useSharedValue(0);

  React.useEffect(() => {
    shimmerAnim.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmerAnim.value, [0, 1], [0.3, 0.7]),
  }));

  return (
    <View style={skeletonStyles.container}>
      {/* Photo placeholder */}
      <Animated.View
        style={[
          skeletonStyles.photoPlaceholder,
          { height: 500 + insets.top, paddingTop: insets.top },
          shimmerStyle,
        ]}
      />

      {/* Photo indicators */}
      <View style={skeletonStyles.indicators}>
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            style={[
              skeletonStyles.indicator,
              i === 0 && skeletonStyles.indicatorActive,
              shimmerStyle,
            ]}
          />
        ))}
      </View>

      {/* Content area */}
      <View style={skeletonStyles.content}>
        {/* Name row */}
        <Animated.View style={[skeletonStyles.nameBlock, shimmerStyle]} />

        {/* Trust badges row */}
        <View style={skeletonStyles.badgesRow}>
          <Animated.View style={[skeletonStyles.badge, shimmerStyle]} />
          <Animated.View style={[skeletonStyles.badge, shimmerStyle]} />
        </View>

        {/* Bio section */}
        <Animated.View style={[skeletonStyles.sectionTitle, shimmerStyle]} />
        <Animated.View style={[skeletonStyles.textBlock, shimmerStyle]} />
        <Animated.View style={[skeletonStyles.textBlockShort, shimmerStyle]} />

        {/* Interests section */}
        <Animated.View style={[skeletonStyles.sectionTitle, { marginTop: 24 }, shimmerStyle]} />
        <View style={skeletonStyles.chipsRow}>
          {[0, 1, 2, 3].map((i) => (
            <Animated.View key={i} style={[skeletonStyles.chip, shimmerStyle]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  photoPlaceholder: {
    width: '100%',
    backgroundColor: COLORS.backgroundDark,
  },
  indicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
  },
  indicatorActive: {
    width: 24,
    backgroundColor: COLORS.textMuted,
  },
  content: {
    padding: 16,
  },
  nameBlock: {
    width: 180,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
    marginBottom: 16,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  badge: {
    width: 100,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
  },
  sectionTitle: {
    width: 120,
    height: 20,
    borderRadius: 4,
    backgroundColor: COLORS.backgroundDark,
    marginBottom: 12,
  },
  textBlock: {
    width: '100%',
    height: 16,
    borderRadius: 4,
    backgroundColor: COLORS.backgroundDark,
    marginBottom: 8,
  },
  textBlockShort: {
    width: '70%',
    height: 16,
    borderRadius: 4,
    backgroundColor: COLORS.backgroundDark,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    width: 80,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
  },
});

export default function ViewProfileScreen() {
  const { id: userId, mode, fromChat, source, actionScope, freshness, intent, fromConfessionId } = useLocalSearchParams<{
    id: string;
    mode?: string;
    fromChat?: string;
    source?: string;
    actionScope?: string;
    fromConfessionId?: string;
    // Phase-2.5: coarse Nearby recency label passed from the Nearby marker tap.
    // Values: 'recent' (<=24h) | 'earlier' (<=7d) | 'stale' (<=14d).
    // Only shown when source=nearby.
    freshness?: string;
    // Phase-3: preview-card quick-action hint (currently only 'like').
    // Used to highlight the CTA — does not auto-send any action.
    intent?: string;
  }>();
  const normalizedSource = Array.isArray(source) ? source[0] : source;
  const normalizedActionScope = Array.isArray(actionScope) ? actionScope[0] : actionScope;
  const normalizedFromConfessionId = Array.isArray(fromConfessionId) ? fromConfessionId[0] : fromConfessionId;
  // Phase-2.5: coarse Nearby recency chip. Only rendered for source=nearby with
  // a valid three-state label; never reveals minutes/hours/exact timestamp.
  //   'recent'  → "Recently here"  (<=24h)
  //   'earlier' → "Earlier"        (<=7d)
  //   'stale'   → "A while ago"    (<=14d cutoff)
  const normalizedFreshness = Array.isArray(freshness) ? freshness[0] : freshness;
  const showFreshnessChip =
    normalizedSource === 'nearby' &&
    (normalizedFreshness === 'recent' ||
      normalizedFreshness === 'earlier' ||
      normalizedFreshness === 'stale');
  const freshnessChipText =
    normalizedFreshness === 'recent'
      ? 'Recently here'
      : normalizedFreshness === 'earlier'
      ? 'Earlier'
      : 'A while ago';
  const freshnessChipIcon: keyof typeof Ionicons.glyphMap =
    normalizedFreshness === 'recent'
      ? 'time-outline'
      : normalizedFreshness === 'earlier'
      ? 'hourglass-outline'
      : 'calendar-outline';
  // Phase-3: only show the Nearby-source CTA when we arrived via a Nearby
  // marker tap. It's intentionally small — a single line + two chip buttons —
  // and never auto-triggers any action.
  const isFromNearby = normalizedSource === 'nearby';
  const isNearbyPrivacySource = isFromNearby || normalizedSource === 'crossed_paths';
  const isConfessTagSource = normalizedSource === 'confess_tag';
  const normalizedIntent = Array.isArray(intent) ? intent[0] : intent;
  const nearbyIntentLike = isFromNearby && normalizedIntent === 'like';
  const isPhase2 = mode === 'phase2';
  const isConfessPreview = mode === 'confess_preview';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { userId: currentUserId, token } = useAuthStore();
  const currentViewer = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && currentUserId ? { userId: currentUserId } : 'skip'
  );
  const currentViewerId = currentViewer?._id as Id<'users'> | undefined;
  const confessTagActionEligibility = useQuery(
    api.confessions.canUseConfessTagActions,
    !isDemoMode && isConfessTagSource && token && normalizedFromConfessionId && userId
        ? {
          token,
          confessionId: normalizedFromConfessionId,
          taggedUserId: userId,
        }
      : 'skip'
  );
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const photoListRef = useRef<FlatList<any>>(null);
  // Phase-1 premium polish: tap-zone press feedback + action-button press
  // feedback. Mirrors the Phase-2 opened-profile micro-interaction model
  // (subtle scale on press) without changing the Phase-1 light identity.
  const leftTapScale = useSharedValue(1);
  const rightTapScale = useSharedValue(1);
  const leftTapAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftTapScale.value }],
  }));
  const rightTapAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightTapScale.value }],
  }));
  const skipBtnScale = useSharedValue(1);
  const standOutBtnScale = useSharedValue(1);
  const likeBtnScale = useSharedValue(1);
  const skipBtnAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: skipBtnScale.value }],
  }));
  const standOutBtnAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: standOutBtnScale.value }],
  }));
  const likeBtnAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeBtnScale.value }],
  }));
  const [showReportBlock, setShowReportBlock] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [sharedPlacesReady, setSharedPlacesReady] = useState(false);
  // P1-FIX: Sticky header visibility state
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  // P1-FIX: Last scroll position for hysteresis
  const lastScrollYRef = useRef(0);

  // P1-FIX: Responsive threshold based on photo height (500) + safe area + buffer
  // Using useMemo to compute once when insets change
  const { stickyHeaderShowThreshold, stickyHeaderHideThreshold } = useMemo(() => {
    const photoHeight = 500;
    const baseThreshold = photoHeight + insets.top;
    // Show when scrolled past ~80% of photo area
    const showAt = baseThreshold * 0.8;
    // Hide when scrolled back to ~60% (hysteresis to prevent flicker)
    const hideAt = baseThreshold * 0.6;
    return { stickyHeaderShowThreshold: showAt, stickyHeaderHideThreshold: hideAt };
  }, [insets.top]);
  const setDiscoverProfileActionResult = useInteractionStore((s) => s.setDiscoverProfileActionResult);

  // Phase-1: Use users.getUserById
  const convexPhase1Profile = useQuery(
    api.users.getUserById,
    !isDemoMode && !isPhase2 && userId && currentViewerId
      ? {
          userId: userId as Id<'users'>,
          viewerId: currentViewerId,
          ...(isNearbyPrivacySource ? { source: normalizedSource } : {}),
        }
      : 'skip'
  );

  // Shared Places query (Phase-1 only, not for demo mode)
  const sharedPlaces = useQuery(
    api.crossedPaths.getSharedPlaces,
    !isDemoMode && !isPhase2 && userId && currentViewerId && sharedPlacesReady
      ? { viewerId: currentViewerId, profileUserId: userId as Id<'users'> }
      : 'skip'
  );

  // Phase-2: Use privateDiscover.getProfileByUserId
  const convexPhase2Profile = useQuery(
    api.privateDiscover.getProfileByUserId,
    !isDemoMode && isPhase2 && userId && currentUserId
      ? {
          userId: userId as Id<'users'>,
          viewerAuthUserId: currentUserId,
          ...(currentViewerId ? { viewerId: currentViewerId } : {}),
        }
      : 'skip'
  );

  const convexProfile = isPhase2 ? convexPhase2Profile : convexPhase1Profile;

  // In demo mode, check both static DEMO_PROFILES and dynamic demoStore.profiles
  // (fallback Stand Out profiles like Riya/Keerthi/Sana are in demoStore.profiles)
  // For Phase-2, also check DEMO_INCOGNITO_PROFILES
  const demoStoreProfiles = useDemoStore((s) => s.profiles);
  const demoProfile = isDemoMode
    ? (() => {
        // Phase-2: Check DEMO_INCOGNITO_PROFILES first
        if (isPhase2) {
          const incognitoProfile = DEMO_INCOGNITO_PROFILES.find((dp) => dp.id === userId);
          if (incognitoProfile) {
            // Phase-2 profile found - convert to common format
            // Prefer photos[] array if available, fallback to [photoUrl] for backward compat
            const photoUrls = incognitoProfile.photos && incognitoProfile.photos.length > 0
              ? incognitoProfile.photos
              : incognitoProfile.photoUrl
                ? [incognitoProfile.photoUrl]
                : [];
            const photos = photoUrls.map((url, i) => ({ _id: `photo_${i}`, url }));

            // Support multiple field names: privateIntentKeys (new), intentKeys, privateIntentKey (legacy)
            const intentKeys: string[] =
              incognitoProfile.privateIntentKeys ??
              (incognitoProfile as any).intentKeys ??
              (incognitoProfile.privateIntentKey ? [incognitoProfile.privateIntentKey] : []);

            return {
              name: incognitoProfile.username,
              age: incognitoProfile.age,
              bio: incognitoProfile.bio,
              city: incognitoProfile.city,
              isVerified: false, // Phase-2 profiles don't have verification
              distance: incognitoProfile.distance,
              photos,
              // Phase-2 specific fields (NO Phase-1 intent!)
              privateIntentKeys: intentKeys, // Array of intents (primary)
              intentKeys, // Alias for compatibility
              privateIntentKey: intentKeys[0] ?? null, // Legacy compat
              activities: incognitoProfile.interests || incognitoProfile.hobbies || [],
              // Hobbies field for display (resolve from hobbies > interests)
              hobbies: incognitoProfile.hobbies || incognitoProfile.interests || [],
              // Phase-2 does NOT have prompts - explicitly exclude
              profilePrompts: [],
              relationshipIntent: [], // Empty - Phase-2 doesn't use Phase-1 intents
              height: incognitoProfile.height,
              smoking: undefined,
              drinking: undefined,
              education: undefined,
              jobTitle: undefined,
              company: undefined,
              lastActive: Date.now() - 2 * 60 * 60 * 1000,
              createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
            };
          }
        }

        // Phase-1: Check static DEMO_PROFILES, then fallback to demoStore.profiles
        const staticProfile = DEMO_PROFILES.find((dp) => dp._id === userId);
        const storeProfile = demoStoreProfiles.find((dp) => dp._id === userId);
        const p = staticProfile || storeProfile;
        if (!p) return null;

        // Schema-tolerant field resolution (supports old persisted data with different keys)
        const pAny = p as any;
        const resolvedIntent = p.relationshipIntent || pAny.intent || pAny.lookingFor || [];
        const resolvedActivities = p.activities || pAny.interests || pAny.hobbies || [];
        const resolvedPrompts = pAny.profilePrompts || pAny.prompts || [];
        // Hobbies for display (hobbies > interests > activities)
        const resolvedHobbies = pAny.hobbies || pAny.interests || p.activities || [];

        return {
          name: p.name,
          age: p.age,
          gender: p.gender,
          bio: p.bio,
          city: p.city,
          isVerified: p.isVerified,
          verificationStatus: p.isVerified ? 'verified' : 'unverified',
          distance: p.distance,
          photos: p.photos.map((photo, i) => ({ _id: `photo_${i}`, url: photo.url })),
          relationshipIntent: resolvedIntent,
          activities: resolvedActivities,
          hobbies: resolvedHobbies,
          profilePrompts: resolvedPrompts,
          height: undefined,
          smoking: undefined,
          drinking: undefined,
          education: undefined,
          jobTitle: undefined,
          company: undefined,
          // Simulated timestamps for trust badges in demo mode
          lastActive: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
          createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days ago
        };
      })()
    : null;

  // Use type assertion since Phase-1 and Phase-2 profiles have different shapes
  // The UI handles conditional display of fields appropriately
  const profile = (isDemoMode ? demoProfile : convexProfile) as any;

  // P0 UNIFIED PRESENCE: Get presence status for this profile user
  // Use profile.userId if available (Phase-2), otherwise use userId from params
  const profileUserId = profile?.userId || userId;
  const presence = useUserPresence(
    !isDemoMode && profileUserId ? profileUserId as Id<'users'> : null,
    { respectPrivacy: !isPhase2 }
  );
  const presenceStatus = presence?.status;

  const displayPhotos = useMemo(() => getRenderableProfilePhotos(profile?.photos), [profile?.photos]);
  const visiblePhotos = useMemo(
    () => (isConfessPreview ? displayPhotos.slice(0, 2) : displayPhotos),
    [displayPhotos, isConfessPreview],
  );
  if (__DEV__) {
    // [PHOTO_DEBUG] P0: verify backendCount === renderCount on profile screen.
    // Remove after validation.
    console.log('[PHOTO_DEBUG][profile]', {
      userId: profile?.id,
      backendCount: Array.isArray(profile?.photos) ? profile.photos.length : 0,
      renderCount: displayPhotos.length,
      visibleCount: visiblePhotos.length,
      isConfessPreview,
    });
  }
  const distanceLabel = useMemo(() => {
    if (isNearbyPrivacySource) return null;
    if (isPhase2) return formatDiscoverDistanceKm(profile?.distance);
    return formatPhase2DistanceMiles(profile?.distance, { includeAway: true });
  }, [isNearbyPrivacySource, isPhase2, profile?.distance]);
  const verificationBadge = useMemo(
    () => getVerificationBadgeState({
      isVerified: profile?.isVerified,
      verificationStatus: profile?.verificationStatus,
    }),
    [profile?.isVerified, profile?.verificationStatus],
  );

  const swipe = useMutation(api.likes.swipe);

  const demoLikes = useDemoStore((s) => s.likes);
  const simulateMatch = useDemoStore((s) => s.simulateMatch);

  useEffect(() => {
    if (currentPhotoIndex >= visiblePhotos.length && visiblePhotos.length > 0) {
      setCurrentPhotoIndex(visiblePhotos.length - 1);
    } else if (visiblePhotos.length === 0 && currentPhotoIndex !== 0) {
      setCurrentPhotoIndex(0);
    }
  }, [currentPhotoIndex, visiblePhotos.length]);

  // Phase-1 premium polish: tap-left / tap-right photo navigation matching
  // the outer Discover swipe card. Swipe (FlatList paging) is preserved;
  // tap zones provide an additional, faster navigation affordance.
  // Uses `animated: false` so the photo + top progress bar update
  // instantly on tap (no slow scroll easing). State is updated
  // optimistically so progress bars react on press, not on scroll-end.
  const goPrevPhoto = () => {
    if (visiblePhotos.length <= 1) return;
    const next = Math.max(0, currentPhotoIndex - 1);
    if (next === currentPhotoIndex) return;
    setCurrentPhotoIndex(next);
    photoListRef.current?.scrollToOffset({ offset: next * screenWidth, animated: false });
    try { Haptics.selectionAsync(); } catch {}
  };
  const goNextPhoto = () => {
    if (visiblePhotos.length <= 1) return;
    const next = Math.min(visiblePhotos.length - 1, currentPhotoIndex + 1);
    if (next === currentPhotoIndex) return;
    setCurrentPhotoIndex(next);
    photoListRef.current?.scrollToOffset({ offset: next * screenWidth, animated: false });
    try { Haptics.selectionAsync(); } catch {}
  };
  const onLeftZonePressIn = () => { leftTapScale.value = withTiming(0.98, { duration: 90 }); };
  const onLeftZonePressOut = () => { leftTapScale.value = withTiming(1, { duration: 160 }); };
  const onRightZonePressIn = () => { rightTapScale.value = withTiming(0.98, { duration: 90 }); };
  const onRightZonePressOut = () => { rightTapScale.value = withTiming(1, { duration: 160 }); };
  const pressInScale = (sv: typeof skipBtnScale) => () => {
    sv.value = withTiming(0.93, { duration: 90 });
  };
  const pressOutScale = (sv: typeof skipBtnScale) => () => {
    sv.value = withTiming(1, { duration: 180 });
  };

  useEffect(() => {
    if (isDemoMode || isPhase2 || !userId || !token) {
      setSharedPlacesReady(false);
      return;
    }

    setSharedPlacesReady(false);
    let cancelled = false;
    const frameId = requestAnimationFrame(() => {
      if (!cancelled) {
        setSharedPlacesReady(true);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [isDemoMode, isPhase2, token, userId]);

  const goBackSafely = React.useCallback(() => {
    if (isPhase2) {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/(main)/(private)/(tabs)/deep-connect' as any);
      return;
    }

    if (normalizedSource === 'nearby' || normalizedSource === 'crossed_paths') {
      router.replace('/(main)/(tabs)/nearby' as any);
      return;
    }

    if (
      normalizedSource === 'phase1_discover' ||
      normalizedSource === 'discover' ||
      normalizedSource === 'home'
    ) {
      router.replace('/(main)/(tabs)/home' as any);
      return;
    }

    if (normalizedSource === 'phase1_explore' || normalizedSource === 'explore') {
      router.replace('/(main)/(tabs)/explore' as any);
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(main)/(tabs)/home' as any);
  }, [isPhase2, normalizedSource, router]);

  const syncPhase1DiscoverAction = (action: 'like' | 'pass' | 'super_like') => {
    if (isPhase2 || !userId) return;

    if (normalizedSource === 'phase1_discover') {
      setDiscoverProfileActionResult({
        profileId: userId,
        action,
        source: 'phase1_discover_profile',
      });
      return;
    }

    if (normalizedSource === 'phase1_explore' && normalizedActionScope) {
      setDiscoverProfileActionResult({
        profileId: userId,
        action,
        source: 'phase1_explore_profile',
        scopeKey: normalizedActionScope,
      });
    }
  };

  const handleSwipe = async (action: 'like' | 'pass' | 'super_like') => {
    if (!currentUserId || !userId || isActionPending) return;

    if (isDemoMode) {
      if (action === 'pass') {
        syncPhase1DiscoverAction(action);
        goBackSafely();
        return;
      }

      // Check if this user already liked us (i.e. they're in our likes list).
      // If so, liking or super-liking them back ALWAYS creates a match.
      const isLikeBack = demoLikes.some((l) => l.userId === userId);

      if (isLikeBack || action === 'super_like') {
        // Create the match, DM conversation, and remove from discover + likes
        simulateMatch(userId);
        const matchId = `match_${userId}`;
        // Pass mode param so match-celebration knows the phase context
        const modeParam = isPhase2 ? '&mode=phase2' : '';
        syncPhase1DiscoverAction(action);
        safePush(router, `/(main)/match-celebration?matchId=${matchId}&userId=${userId}${modeParam}` as any, 'profile->matchCelebration');
      } else {
        // Regular like on someone NOT in our likes list — small random chance of instant match
        if (Math.random() > 0.7) {
          simulateMatch(userId);
          const matchId = `match_${userId}`;
          const modeParam = isPhase2 ? '&mode=phase2' : '';
          syncPhase1DiscoverAction(action);
          safePush(router, `/(main)/match-celebration?matchId=${matchId}&userId=${userId}${modeParam}` as any, 'profile->matchCelebration');
        } else {
          syncPhase1DiscoverAction(action);
          goBackSafely();
        }
      }
      return;
    }

    setIsActionPending(true);
    try {
      const result = await swipe({
        token: token!,
        toUserId: userId as any,
        action,
      });

      if (result.isMatch) {
        syncPhase1DiscoverAction(action);
        safePush(router, `/(main)/match-celebration?matchId=${result.matchId}&userId=${userId}` as any, 'profile->matchCelebration');
      } else {
        syncPhase1DiscoverAction(action);
        goBackSafely();
      }
    } catch {
      Toast.show('Something went wrong. Please try again.');
    } finally {
      setIsActionPending(false);
    }
  };

  // P1-FIX: Handle scroll to show/hide sticky header with hysteresis
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollY = event.nativeEvent.contentOffset.y;
    const wasScrollingDown = scrollY > lastScrollYRef.current;
    lastScrollYRef.current = scrollY;

    // Hysteresis: different thresholds for showing vs hiding to prevent flicker
    if (wasScrollingDown && scrollY > stickyHeaderShowThreshold) {
      setShowStickyHeader(true);
    } else if (!wasScrollingDown && scrollY < stickyHeaderHideThreshold) {
      setShowStickyHeader(false);
    }
  };

  // Handle missing userId param
  if (!userId) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
        <Text style={styles.loadingText}>Profile not available</Text>
        <TouchableOpacity style={styles.backButtonAlt} onPress={goBackSafely}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // In demo mode, if profile is null, it means user not found (not loading)
  // In convex mode, undefined means loading, null means not found
  const isLoading = !isDemoMode && convexProfile === undefined;
  const isNotFound = isDemoMode ? !profile : convexProfile === null;

  // P0-FIX: Profile skeleton loader (replaces plain text)
  if (isLoading) {
    return <ProfileSkeleton insets={insets} screenWidth={screenWidth} />;
  }

  if (isNotFound || !profile) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="person-outline" size={48} color={COLORS.textMuted} />
        <Text style={styles.loadingText}>Profile not found</Text>
        <TouchableOpacity style={styles.backButtonAlt} onPress={goBackSafely}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const age = typeof profile.age === 'number' && profile.age > 0 ? profile.age : null;
  const profileIdentity = age ? `${profile.name}, ${age}` : profile.name;
  const genderLabel =
    !isPhase2 && typeof profile.gender === 'string' && profile.gender.trim().length > 0
      ? GENDER_OPTIONS.find((option) => option.value === profile.gender)?.label ??
        profile.gender.replace(/_/g, ' ')
      : null;

  // P1-FIX: Determine if action buttons should be shown
  const canUseConfessTagActions =
    !isConfessTagSource || confessTagActionEligibility?.allowed === true;
  const showActionButtons = fromChat !== '1' && !isConfessPreview && canUseConfessTagActions;

  // Floating Phase-1 action-row layout (Skip / Super Like / Like). Mirrors
  // the Phase-2 helper shape so the opened profile shows three independent
  // floating orbs above the page rather than a full-width sticky bar.
  const { actionRowBottom, actionRowClearance } =
    getPhase1OpenProfileActionLayout({ bottom: insets.bottom });
  const floatingActionRowBottom =
    actionRowBottom + (!isPhase2 ? PHASE1_OPEN_PROFILE_ACTION_LIFT : 0);
  const actionScrollPaddingBottom = floatingActionRowBottom + actionRowClearance;

  return (
    <View style={styles.rootContainer}>
      {/* P1-FIX: Sticky Header - appears when scrolled past photo */}
      {showStickyHeader && (
        <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={goBackSafely} style={styles.stickyBackButton}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.stickyHeaderTitle} numberOfLines={1}>
            {profileIdentity}
          </Text>
          {!isConfessPreview && (
            <TouchableOpacity
              onPress={() => setShowReportBlock(true)}
              style={styles.stickyMoreButton}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.text} />
            </TouchableOpacity>
          )}
          {isConfessPreview && <View style={{ width: 36 }} />}
        </View>
      )}

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={
          showActionButtons ? { paddingBottom: actionScrollPaddingBottom } : undefined
        }
      >
        {/* Header: No back button, no overlay, just the 3-dots menu in top-right */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          {/* Spacer to push menu to the right */}
          <View style={{ flex: 1 }} />
          {!isConfessPreview && (
            <TouchableOpacity
              onPress={() => setShowReportBlock(true)}
              style={styles.moreButton}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.white} />
            </TouchableOpacity>
          )}
        </View>

        {/* Phase-1 premium polish: photo carousel with tap-zone navigation
            (mirrors the outer Discover swipe card) and slim top progress
            bars. The "1/N" counter and dots row have been removed in favor
            of the on-photo progress bars; swipe + tap navigation are both
            preserved. */}
        <View style={styles.photoCarouselContainer}>
          {visiblePhotos.length > 0 ? (
            <FlatList
              ref={photoListRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              bounces={false}
              snapToAlignment="start"
              decelerationRate="fast"
              snapToInterval={screenWidth}
              disableIntervalMomentum
              data={visiblePhotos}
              keyExtractor={(item, index) => item._id || `photo-${index}`}
              initialNumToRender={1}
              windowSize={2}
              maxToRenderPerBatch={1}
              removeClippedSubviews
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
                setCurrentPhotoIndex(index);
              }}
              renderItem={({ item }) => (
                <View style={{ width: screenWidth, height: 500 + insets.top, overflow: 'hidden', paddingTop: insets.top }}>
                  <Image
                    source={{ uri: item.url }}
                    style={{ width: '100%', height: 500 }}
                    contentFit="cover"
                    blurRadius={isPhase2 ? 20 : profile.photoBlurred ? 20 : 0}
                  />
                </View>
              )}
              style={styles.photoCarousel}
            />
          ) : (
            <View style={[styles.photoPlaceholder, { height: 500 + insets.top, paddingTop: insets.top }]}>
              <Ionicons name="person" size={64} color={COLORS.textLight} />
            </View>
          )}

          {/* Tap zones: left half = previous photo, right half = next photo.
              Sit above the FlatList but below the top progress bars and
              header. Pressable provides press-in feedback; FlatList swipe
              still works because tap zones only consume taps, not drags. */}
          {visiblePhotos.length > 1 && (
            <>
              <Animated.View
                style={[styles.photoTapZoneLeft, leftTapAnimStyle]}
                pointerEvents="box-none"
              >
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={goPrevPhoto}
                  onPressIn={onLeftZonePressIn}
                  onPressOut={onLeftZonePressOut}
                  accessibilityLabel="Previous photo"
                />
              </Animated.View>
              <Animated.View
                style={[styles.photoTapZoneRight, rightTapAnimStyle]}
                pointerEvents="box-none"
              >
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={goNextPhoto}
                  onPressIn={onRightZonePressIn}
                  onPressOut={onRightZonePressOut}
                  accessibilityLabel="Next photo"
                />
              </Animated.View>
            </>
          )}

          {/* Top progress bars — segmented bar per photo, current photo
              filled, rest tinted. Premium / clean / no numeric counter. */}
          {visiblePhotos.length > 1 && (
            <View style={[styles.photoTopBars, { top: insets.top + 12 }]}>
              {visiblePhotos.map((_: any, index: number) => (
                <View
                  key={index}
                  style={[
                    styles.photoTopBar,
                    index === currentPhotoIndex && styles.photoTopBarActive,
                  ]}
                />
              ))}
            </View>
          )}
        </View>

      <View style={styles.content}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{profileIdentity}</Text>
          {distanceLabel && (
            <Text style={styles.distance}>{distanceLabel}</Text>
          )}
        </View>

        {showFreshnessChip && (
          <View style={styles.freshnessChip}>
            <Ionicons
              name={freshnessChipIcon}
              size={12}
              color={COLORS.textMuted}
            />
            <Text style={styles.freshnessChipText}>{freshnessChipText}</Text>
          </View>
        )}

        {/* Phase-3: subtle "from Nearby" CTA. Only shown when the viewer
            arrived via a Nearby marker tap. Two minimal actions — Say hi
            (opens pre-match composer) and Like (uses the existing swipe
            pipeline). The CTA is rendered as a soft pill row and does not
            replace or hide the existing swipe affordances elsewhere on
            the profile. */}
        {isFromNearby && !isPhase2 && !isConfessPreview && (
          <View style={styles.nearbyCtaWrap}>
            <View style={styles.nearbyCtaHeader}>
              <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.nearbyCtaHeaderText}>From Nearby — say hi first</Text>
            </View>
            <View style={styles.nearbyCtaRow}>
              <TouchableOpacity
                style={styles.nearbyCtaButton}
                activeOpacity={0.85}
                accessibilityLabel="Say hi"
                accessibilityHint="Send a short message to introduce yourself"
                onPress={() => {
                  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                  if (userId) {
                    trackEvent({ name: 'nearby_to_message', targetUserId: userId });
                    safePush(
                      router,
                      `/(main)/pre-match-message?userId=${userId}` as any,
                      'profile->pre-match-message(nearby)'
                    );
                  }
                }}
              >
                <Ionicons name="chatbubble-outline" size={14} color={COLORS.primary} />
                <Text style={styles.nearbyCtaButtonText}>Say hi</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.nearbyCtaButton,
                  styles.nearbyCtaButtonLike,
                  nearbyIntentLike && styles.nearbyCtaButtonLikeIntent,
                ]}
                activeOpacity={0.85}
                disabled={isActionPending}
                accessibilityLabel="Like"
                accessibilityHint="Send a like from Nearby"
                onPress={() => {
                  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                  if (userId) {
                    trackEvent({ name: 'nearby_to_like', targetUserId: userId });
                  }
                  handleSwipe('like');
                }}
              >
                <Ionicons name="heart" size={14} color="#fff" />
                <Text style={styles.nearbyCtaButtonLikeText}>Like</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isConfessPreview && (
          <View style={styles.previewOnlyBanner}>
            <Ionicons name="eye-outline" size={18} color={COLORS.textMuted} />
            <Text style={styles.previewOnlyText}>Preview Only</Text>
          </View>
        )}

        {/* Phase-1 premium polish: header metadata row.
            - Verified is rendered as a premium standalone pill (success
              tint) — feels like a certification mark, not a generic chip.
            - Presence is rendered as a single chip with explicit wording:
              "Online" (with green dot) when presenceStatus === 'online',
              "Recently active" when presenceStatus === 'active_today'.
              "Active Today" wording is no longer used here.
            - "Photos Added", "Profile Complete", "Popular" and the
              "+N" overflow are intentionally not rendered to keep the
              metadata clean and premium. */}
        {!isConfessPreview && (() => {
          const isOnline = presenceStatus === 'online';
          const isRecentlyActive = presenceStatus === 'active_today';
          const showPresence = isOnline || isRecentlyActive;

          return (
            <View style={styles.trustBadgeRow}>
              {genderLabel && (
                <View style={styles.presenceChip}>
                  <Ionicons name="person-outline" size={13} color={COLORS.textMuted} />
                  <Text style={styles.presenceChipText}>{genderLabel}</Text>
                </View>
              )}

              <View style={[styles.verifiedBadgePremium, { backgroundColor: verificationBadge.background }]}>
                <Ionicons name={verificationBadge.icon} size={13} color={verificationBadge.color} />
                <Text style={[styles.verifiedBadgePremiumText, { color: verificationBadge.color }]}>
                  {verificationBadge.label}
                </Text>
              </View>

              {showPresence && (
                <View
                  style={[
                    styles.presenceChip,
                    isOnline && styles.presenceChipOnline,
                  ]}
                >
                  {isOnline && <View style={styles.presenceDot} />}
                  <Text
                    style={[
                      styles.presenceChipText,
                      isOnline && styles.presenceChipTextOnline,
                    ]}
                  >
                    {isOnline ? 'Online' : 'Recently active'}
                  </Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* ========== PHASE-2 SECTION ORDER: Bio → My Intent → Hobbies → Interests (NO Details) ========== */}

        {/* Phase-2: Desire (Bio) - FIRST in Phase-2 */}
        {isPhase2 && profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Desire (Bio)</Text>
            <Text style={styles.bio}>{profile.bio}</Text>
          </View>
        )}

        {/* Phase-2: My Intent - SECOND in Phase-2 (compact, max 3 + overflow) */}
        {isPhase2 && (() => {
          const profileAny = profile as any;
          const keys: string[] =
            profileAny.privateIntentKeys ??
            profileAny.intentKeys ??
            (profileAny.privateIntentKey ? [profileAny.privateIntentKey] : []);

          if (__DEV__) {
            console.log('[Phase-2 Profile] Intent keys:', {
              privateIntentKeys: profileAny.privateIntentKeys,
              intentKeys: profileAny.intentKeys,
              privateIntentKey: profileAny.privateIntentKey,
              resolved: keys,
            });
          }

          if (keys.length === 0) return null;

          const categories = keys
            .map(key => PRIVATE_INTENT_CATEGORIES.find(c => c.key === key))
            .filter(Boolean);

          if (categories.length === 0) return null;

          // Option 2: Show max 3 chips + overflow count
          const visibleCategories = categories.slice(0, 3);
          const overflowCount = categories.length > 3 ? categories.length - 3 : 0;

          return (
            <View style={styles.sectionCompact}>
              <Text style={styles.sectionTitle}>My Intent</Text>
              <View style={styles.chipsCompact}>
                {visibleCategories.map((cat, idx) => (
                  <View key={idx} style={styles.intentChipCompact}>
                    <Ionicons name={cat!.icon as any} size={12} color={COLORS.primary} style={{ marginRight: 4 }} />
                    <Text style={styles.intentChipCompactText}>
                      {cat!.label}
                    </Text>
                  </View>
                ))}
                {overflowCount > 0 && (
                  <Text style={styles.intentOverflow}>+{overflowCount}</Text>
                )}
              </View>
            </View>
          );
        })()}

        {/* Phase-2: Interests - THIRD in Phase-2 */}
        {isPhase2 && (() => {
          const hobbies: string[] = profile.hobbies ?? profile.activities ?? profile.interests ?? [];
          if (hobbies.length === 0) return null;
          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Interests</Text>
              <View style={styles.chips}>
                {hobbies.map((hobby: string, idx: number) => (
                  <View key={idx} style={styles.hobbyChip}>
                    <Text style={styles.hobbyChipText}>{hobby}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })()}

        {/* ========== PHASE-1 SECTION ORDER: Bio -> Relationship goal -> Quick picks -> Lifestyle -> Family -> Interests -> Work & education -> Religion / Values ========== */}

        {/* Phase-1: Bio comes first after identity so the profile reads human before categorical. */}
        {!isPhase2 && !isConfessPreview && profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Bio</Text>
            <Text style={styles.bio}>{profile.bio}</Text>
          </View>
        )}

        {/* Phase-1 Relationship goal: relationshipIntent chips only.
            Gender preferences (Women / Men / Everyone) are not relationship goals. */}
        {!isPhase2 && !isConfessPreview && (() => {
          const relIntent: string[] = profile.relationshipIntent || [];
          if (relIntent.length === 0) return null;

          const intentLabels = relIntent
            .map(key => RELATIONSHIP_INTENTS.find(i => i.value === key))
            .filter(Boolean);

          if (intentLabels.length === 0) return null;

          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Relationship goal</Text>
              <View style={styles.chips}>
                {intentLabels.map((intent, idx) => (
                  <View key={idx} style={styles.chip}>
                    <Text style={styles.chipText}>{intent!.emoji} {intent!.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })()}

        {/* Phase-1 Quick picks / Prompts. Existing prompt cards, now placed after intent. */}
        {!isPhase2 && !isConfessPreview && profile.profilePrompts && profile.profilePrompts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick picks</Text>
            {profile.profilePrompts.slice(0, 3).map((prompt: { question: string; answer: string }, idx: number) => (
              <View key={idx} style={styles.promptCard}>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.promptAnswer}>{prompt.answer}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Phase-1 Lifestyle and Family. Single Parent intent stays in Relationship goal;
            Family only renders when a real kids/family field exists. */}
        {!isPhase2 && !isConfessPreview && (() => {
          const kidsLabel = profile.kids
            ? KIDS_OPTIONS.find((o) => o.value === profile.kids)?.label ?? null
            : null;
          const smokingLabel = profile.smoking
            ? SMOKING_OPTIONS.find((o) => o.value === profile.smoking)?.label ?? null
            : null;
          const drinkingLabel = profile.drinking
            ? DRINKING_OPTIONS.find((o) => o.value === profile.drinking)?.label ?? null
            : null;

          const hasLifestyle = profile.height || smokingLabel || drinkingLabel;
          const hasFamily = !!kidsLabel;

          return (
            <>
              {hasLifestyle && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Lifestyle</Text>
                  <View style={styles.details}>
                    {profile.height && (
                      <View style={styles.detailRow}>
                        <Ionicons name="resize" size={18} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{profile.height} cm</Text>
                      </View>
                    )}
                    {smokingLabel && (
                      <View style={styles.detailRow}>
                        <Ionicons name="flame-outline" size={18} color={COLORS.textLight} />
                        <Text style={styles.detailText}>Smoking: {smokingLabel}</Text>
                      </View>
                    )}
                    {drinkingLabel && (
                      <View style={styles.detailRow}>
                        <Ionicons name="wine-outline" size={18} color={COLORS.textLight} />
                        <Text style={styles.detailText}>Drinking: {drinkingLabel}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {hasFamily && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Family</Text>
                  <View style={styles.details}>
                    <View style={styles.detailRow}>
                      <Ionicons name="people-outline" size={18} color={COLORS.textLight} />
                      <Text style={styles.detailText}>{kidsLabel}</Text>
                    </View>
                  </View>
                </View>
              )}
            </>
          );
        })()}

        {/* Shared Interests - Phase-1 interest context, placed inside the Interests / Activities band. */}
        {!isConfessPreview && (() => {
          // P1-3: In live mode, pull current viewer's activities from the Convex
          // currentViewer query (was previously hardcoded to [] outside demo mode,
          // which meant "You both enjoy" never appeared for real users).
          const viewerActivitiesRaw = isDemoMode
            ? getDemoCurrentUser().activities
            : (currentViewer as any)?.activities;
          const myActivities: string[] = Array.isArray(viewerActivitiesRaw) ? viewerActivitiesRaw : [];
          const candidateActivities: string[] = Array.isArray(profile.activities) ? profile.activities : [];
          const shared = candidateActivities.filter((a: string) => myActivities.includes(a));
          if (shared.length === 0) return null;
          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>You both enjoy</Text>
              <View style={styles.chips}>
                {shared.map((activity: string) => {
                  const data = ACTIVITY_FILTERS.find((a) => a.value === activity);
                  return (
                    <View key={activity} style={styles.sharedChip}>
                      <Text style={styles.sharedChipText}>
                        {data?.emoji} {data?.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })()}

        {/* Interests / Activities - Phase-1 */}
        {!isPhase2 && !isConfessPreview && Array.isArray(profile.activities) && profile.activities.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.chips}>
              {profile.activities.map((activity: string) => {
                const activityData = ACTIVITY_FILTERS.find((a) => a.value === activity);
                return (
                  <View key={activity} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {activityData?.emoji} {activityData?.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Phase-1 Work & education, then Religion / Values. Empty groups are skipped. */}
        {!isPhase2 && !isConfessPreview && (() => {
          const religionLabel = profile.religion
            ? RELIGION_OPTIONS.find((o) => o.value === profile.religion)?.label ?? null
            : null;
          const companyLabel = typeof profile.company === 'string' && profile.company.trim().length > 0
            ? profile.company.trim()
            : null;
          const schoolLabel = typeof profile.school === 'string' && profile.school.trim().length > 0
            ? profile.school.trim()
            : null;
          const rawValues = Array.isArray(profile.coreValues)
            ? profile.coreValues
            : Array.isArray(profile.lifeRhythm?.coreValues)
              ? profile.lifeRhythm.coreValues
              : [];
          const valueLabels = rawValues
            .map((value: unknown) => {
              if (typeof value !== 'string') return null;
              return CORE_VALUES_OPTIONS.find((o) => o.value === value)?.label ?? value;
            })
            .filter((value: unknown): value is string =>
              typeof value === 'string' && value.trim().length > 0
            );

          const hasWork = profile.jobTitle || companyLabel || profile.education || schoolLabel;
          const hasReligionValues = !!religionLabel || valueLabels.length > 0;

          return (
            <>
              {hasWork && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Work & education</Text>
                  <View style={styles.details}>
                    {profile.jobTitle && (
                      <View style={styles.detailRow}>
                        <Ionicons name="briefcase" size={18} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{profile.jobTitle}</Text>
                      </View>
                    )}
                    {companyLabel && (
                      <View style={styles.detailRow}>
                        <Ionicons name="business-outline" size={18} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{companyLabel}</Text>
                      </View>
                    )}
                    {profile.education && (
                      <View style={styles.detailRow}>
                        <Ionicons name="school" size={18} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{profile.education}</Text>
                      </View>
                    )}
                    {schoolLabel && (
                      <View style={styles.detailRow}>
                        <Ionicons name="school-outline" size={18} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{schoolLabel}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {hasReligionValues && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Religion / Values</Text>
                  <View style={styles.details}>
                    {religionLabel && (
                      <View style={styles.detailRow}>
                        <Ionicons name="book-outline" size={18} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{religionLabel}</Text>
                      </View>
                    )}
                    {valueLabels.length > 0 && (
                      <View style={styles.chips}>
                        {valueLabels.map((value: string) => (
                          <View key={value} style={styles.chip}>
                            <Text style={styles.chipText}>{value}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              )}
            </>
          );
        })()}

        {/* Common Places - Phase-1 only, privacy-safe shared locations.
            Kept after the requested profile-data structure so it does not
            interrupt the main opened-profile reading order. */}
        {!isPhase2 && !isConfessPreview && sharedPlaces && sharedPlaces.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Common Places</Text>
            <View style={styles.chips}>
              {sharedPlaces.map((place: { id: string; label: string }) => (
                <View key={place.id} style={styles.commonPlaceChip}>
                  <Ionicons name="location-outline" size={14} color={COLORS.secondary} />
                  <Text style={styles.commonPlaceText}>{place.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Action Buttons placeholder removed - now sticky at bottom */}
      </View>
      </ScrollView>

      {/* Phase-1 floating action row — three independent floating orbs.
          Wrapper is fully transparent (no slab / no top border / no full-width
          background). Each button takes only its own circular footprint. */}
      {showActionButtons && (
        <View
          style={[styles.floatingActionRow, { bottom: floatingActionRowBottom }]}
          pointerEvents="box-none"
        >
          {/* Phase-1 premium polish: subtle scale press feedback on each
              floating action orb. The visual identity (light surface,
              glass highlight, accent border) stays unchanged. */}
          <Animated.View style={skipBtnAnimStyle}>
            <TouchableOpacity
              style={[
                styles.floatingSkipBtn,
                isActionPending && styles.floatingBtnDisabled,
              ]}
              onPress={() => handleSwipe('pass')}
              onPressIn={pressInScale(skipBtnScale)}
              onPressOut={pressOutScale(skipBtnScale)}
              activeOpacity={isActionPending ? 1 : 0.85}
              disabled={isActionPending}
              accessibilityLabel="Skip"
            >
              <LinearGradient
                colors={P1_GLASS_HIGHLIGHT_COLORS}
                locations={P1_GLASS_HIGHLIGHT_LOCATIONS}
                start={P1_GLASS_HIGHLIGHT_START}
                end={P1_GLASS_HIGHLIGHT_END}
                pointerEvents="none"
                style={styles.floatingGlassOverlay}
              />
              <Ionicons name="close" size={P1_ICON_SIZE} color={P1_ICON_SKIP} />
            </TouchableOpacity>
          </Animated.View>
          <Animated.View style={standOutBtnAnimStyle}>
            <TouchableOpacity
              style={[
                styles.floatingStandOutBtn,
                isActionPending && styles.floatingBtnDisabled,
              ]}
              onPress={() => handleSwipe('super_like')}
              onPressIn={pressInScale(standOutBtnScale)}
              onPressOut={pressOutScale(standOutBtnScale)}
              activeOpacity={isActionPending ? 1 : 0.85}
              disabled={isActionPending}
              accessibilityLabel="Super Like"
            >
              <LinearGradient
                colors={P1_GLASS_HIGHLIGHT_COLORS}
                locations={P1_GLASS_HIGHLIGHT_LOCATIONS}
                start={P1_GLASS_HIGHLIGHT_START}
                end={P1_GLASS_HIGHLIGHT_END}
                pointerEvents="none"
                style={styles.floatingGlassOverlayCompact}
              />
              <Ionicons name="star" size={P1_STAR_ICON_SIZE} color={P1_ICON_STANDOUT} />
            </TouchableOpacity>
          </Animated.View>
          <Animated.View style={likeBtnAnimStyle}>
            <TouchableOpacity
              style={[
                styles.floatingLikeBtn,
                isActionPending && styles.floatingBtnDisabled,
              ]}
              onPress={() => handleSwipe('like')}
              onPressIn={pressInScale(likeBtnScale)}
              onPressOut={pressOutScale(likeBtnScale)}
              activeOpacity={isActionPending ? 1 : 0.85}
              disabled={isActionPending}
              accessibilityLabel="Like"
            >
              <LinearGradient
                colors={P1_GLASS_HIGHLIGHT_COLORS}
                locations={P1_GLASS_HIGHLIGHT_LOCATIONS}
                start={P1_GLASS_HIGHLIGHT_START}
                end={P1_GLASS_HIGHLIGHT_END}
                pointerEvents="none"
                style={styles.floatingGlassOverlay}
              />
              <Ionicons name="heart" size={P1_ICON_SIZE} color={P1_ICON_LIKE} />
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}

      <ReportBlockModal
        visible={showReportBlock}
        onClose={() => setShowReportBlock(false)}
        reportedUserId={userId || ''}
        reportedUserName={profile?.name || 'this user'}
        currentUserId={currentUserId || ''}
        onBlockSuccess={goBackSafely}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // P1-FIX: Root container for sticky layout
  // Phase-1 premium foundation: warm ivory page background.
  rootContainer: {
    flex: 1,
    backgroundColor: PHASE1_DISCOVER_THEME.pageBg,
  },
  container: {
    flex: 1,
    backgroundColor: PHASE1_DISCOVER_THEME.pageBg,
  },
  // P1-FIX: Sticky header styles
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: PHASE1_DISCOVER_THEME.pageBg,
    borderBottomWidth: 1,
    borderBottomColor: PHASE1_DISCOVER_THEME.border,
  },
  stickyBackButton: {
    padding: 6,
    marginRight: 8,
  },
  stickyHeaderTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  stickyMoreButton: {
    padding: 6,
    marginLeft: 8,
  },
  // P1-FIX: Photo carousel container for count indicator positioning
  photoCarouselContainer: {
    position: 'relative',
  },
  // Phase-1 premium polish: top progress bars (one slim segment per photo,
  // active segment fully opaque white, inactive segments translucent).
  // Sits above the photo, below the status bar, and replaces the legacy
  // "1/N" counter and below-photo dots.
  photoTopBars: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 4,
    zIndex: 3,
  },
  photoTopBar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  photoTopBarActive: {
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  // Phase-1 premium polish: invisible tap zones layered over the photo
  // for tap-left / tap-right navigation (mirrors the outer Discover swipe
  // card behavior). Positioned above the FlatList for hit-testing but
  // below the top progress bars and the header menu (zIndex order).
  photoTapZoneLeft: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '40%',
    zIndex: 2,
  },
  photoTapZoneRight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '40%',
    zIndex: 2,
  },
  // Phase-1 floating action row. Transparent wrapper — each button is an
  // independent floating orb. No slab background, no top border, no
  // full-width pill. `bottom` is set inline from
  // `getPhase1OpenProfileActionLayout(insets)`.
  floatingActionRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: P1_BUTTON_GAP,
    paddingHorizontal: P1_ROW_PADDING_X,
  },
  floatingSkipBtn: {
    width: P1_BUTTON_DIAMETER,
    height: P1_BUTTON_DIAMETER,
    borderRadius: P1_BUTTON_DIAMETER / 2,
    backgroundColor: P1_SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: P1_BORDER_WIDTH,
    borderColor: P1_BORDER_SKIP,
    ...P1_BUTTON_SHADOW,
  },
  floatingStandOutBtn: {
    width: P1_BUTTON_DIAMETER_COMPACT,
    height: P1_BUTTON_DIAMETER_COMPACT,
    borderRadius: P1_BUTTON_DIAMETER_COMPACT / 2,
    backgroundColor: P1_SURFACE_TINT_STANDOUT,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: P1_BORDER_WIDTH,
    borderColor: P1_BORDER_STANDOUT,
    ...P1_BUTTON_SHADOW,
  },
  floatingLikeBtn: {
    width: P1_BUTTON_DIAMETER,
    height: P1_BUTTON_DIAMETER,
    borderRadius: P1_BUTTON_DIAMETER / 2,
    backgroundColor: P1_SURFACE_TINT_LIKE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: P1_BORDER_WIDTH,
    borderColor: P1_BORDER_LIKE,
    ...P1_BUTTON_SHADOW,
  },
  floatingGlassOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: P1_BUTTON_DIAMETER / 2,
  },
  floatingGlassOverlayCompact: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: P1_BUTTON_DIAMETER_COMPACT / 2,
  },
  floatingBtnDisabled: {
    opacity: P1_DISABLED_OPACITY,
    shadowOpacity: P1_DISABLED_SHADOW_OPACITY,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PHASE1_DISCOVER_THEME.pageBg,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    // No background - photo is fully visible
  },
  moreButton: {
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 14,
  },
  photoCarousel: {
    width: '100%',
    // Height is now dynamic: 500 + insets.top (applied inline)
  },
  photoPlaceholder: {
    width: '100%',
    // Height is now dynamic: 500 + insets.top (applied inline)
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Phase-1 premium redesign: outer content rail. Cards provide their own
  // padding so the rail only needs side gutters and a comfortable top
  // breathing room under the photo carousel.
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
    gap: 12,
  },
  // Phase-1 premium redesign: identity row. Generous baseline alignment so
  // the large name reads against a soft, muted distance label without the
  // distance feeling cramped or floating.
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  // Phase-2: coarse Nearby recency chip. Two-state only ('Recently here' / 'Earlier').
  // Visual: soft chip that sits just above the trust badge row.
  freshnessChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    marginBottom: 12,
  },
  freshnessChipText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  // Phase-3: Nearby-source CTA pill row. Intentionally soft/neutral so it
  // does not compete with the primary swipe affordances elsewhere on the
  // profile. No paywall, no upsell, no new backend.
  nearbyCtaWrap: {
    marginBottom: 16,
    marginTop: -4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
  },
  nearbyCtaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  nearbyCtaHeaderText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  nearbyCtaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  nearbyCtaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: `${COLORS.primary}33`,
  },
  nearbyCtaButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  nearbyCtaButtonLike: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  // Highlight state when the user arrived from the preview card's Like CTA —
  // slightly stronger shadow so the Like pill reads as the pre-selected
  // intent without auto-firing anything.
  nearbyCtaButtonLikeIntent: {
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  nearbyCtaButtonLikeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  trustBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  // Phase-1 premium polish: standalone Verified pill. Soft success-tinted
  // surface, no border ring, slightly tighter padding — reads as a
  // certification mark rather than a generic chip. Single-line / fixed
  // height keeps the row premium even when accompanied by one secondary
  // chip.
  verifiedBadgePremium: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(34, 139, 102, 0.10)',
  },
  verifiedBadgePremiumText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F7A56',
    letterSpacing: 0.2,
  },
  // Phase-1 premium polish: presence chip ("Online" / "Recently active").
  // Sits next to the Verified pill in the metadata row. Online uses a
  // soft green tint with a tiny dot — matching the swipe-card status —
  // and Recently active uses a neutral chip-bg treatment so the row
  // does not over-shout.
  presenceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: PHASE1_DISCOVER_THEME.chipBg,
  },
  presenceChipOnline: {
    backgroundColor: 'rgba(46, 160, 95, 0.10)',
  },
  presenceChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.2,
  },
  presenceChipTextOnline: {
    color: '#1F7A56',
  },
  presenceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2EA05F',
  },
  // Phase-1 premium redesign: name styled as the visual anchor. Slightly
  // tighter letter-spacing matches premium dating-app identity rows.
  name: {
    fontSize: 30,
    fontWeight: '700',
    color: PHASE1_DISCOVER_THEME.text,
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  distance: {
    fontSize: 13,
    fontWeight: '500',
    color: PHASE1_DISCOVER_THEME.textMuted,
    letterSpacing: 0.1,
    marginLeft: 12,
  },
  // Phase-1 premium redesign: every section is an elevated white card on
  // the warm ivory page. Soft cocoa-tinted shadow + warm hairline keeps
  // the surface from looking flat or cheap.
  section: {
    backgroundColor: PHASE1_DISCOVER_THEME.surface,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: PHASE1_DISCOVER_THEME.border,
    shadowColor: PHASE1_DISCOVER_THEME.shadowColor,
    shadowOffset: { width: 0, height: PHASE1_DISCOVER_THEME.shadowOffsetY },
    shadowOpacity: PHASE1_DISCOVER_THEME.shadowOpacity,
    shadowRadius: PHASE1_DISCOVER_THEME.shadowRadius,
    elevation: 1,
  },
  // Phase-1 premium redesign: section title becomes a quiet eyebrow label
  // (uppercase, letter-spaced, muted) so the section's content can be the
  // hero. Mirrors the Phase-2 typography hierarchy without copying the
  // dark palette.
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: PHASE1_DISCOVER_THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  bio: {
    fontSize: 16,
    fontWeight: '400',
    color: PHASE1_DISCOVER_THEME.text,
    lineHeight: 25,
    letterSpacing: 0.05,
  },
  // Phase-1 premium redesign: prompt card. Inherits the same elevated
  // white surface as `section`, plus a single accent strip on the leading
  // edge so prompts feel like premium voice cards, not flat sticky notes.
  promptCard: {
    backgroundColor: PHASE1_DISCOVER_THEME.surface,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: PHASE1_DISCOVER_THEME.border,
    borderRightColor: PHASE1_DISCOVER_THEME.border,
    borderBottomColor: PHASE1_DISCOVER_THEME.border,
    shadowColor: PHASE1_DISCOVER_THEME.shadowColor,
    shadowOffset: { width: 0, height: PHASE1_DISCOVER_THEME.shadowOffsetY },
    shadowOpacity: PHASE1_DISCOVER_THEME.shadowOpacity,
    shadowRadius: PHASE1_DISCOVER_THEME.shadowRadius,
    elevation: 1,
  },
  promptQuestion: {
    fontSize: 11,
    fontWeight: '700',
    color: PHASE1_DISCOVER_THEME.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  promptAnswer: {
    fontSize: 17,
    fontWeight: '500',
    color: PHASE1_DISCOVER_THEME.text,
    lineHeight: 24,
    letterSpacing: 0.05,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Phase-1 premium redesign: pill chip. Fully rounded (radius 100),
  // generous horizontal padding, refined typography. Uses the warm chip
  // surface to sit calmly on the white section card.
  chip: {
    backgroundColor: PHASE1_DISCOVER_THEME.chipBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: PHASE1_DISCOVER_THEME.chipText,
    letterSpacing: 0.1,
  },
  sharedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.secondary + '15',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  sharedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.secondary,
    letterSpacing: 0.1,
  },
  commonPlaceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.secondary + '12',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  commonPlaceText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.secondary,
    letterSpacing: 0.1,
  },
  intentChip: {
    backgroundColor: COLORS.primary + '12',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  intentChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
    letterSpacing: 0.1,
  },
  intentCompatBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 10,
  },
  intentCompatText: {
    fontSize: 13,
    fontWeight: '600',
  },
  intentWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    gap: 8,
  },
  intentWarningText: {
    fontSize: 13,
    color: COLORS.textLight,
    flex: 1,
    lineHeight: 18,
  },
  // Compact section for Phase-2 intent (less vertical space)
  sectionCompact: {
    marginBottom: 16,
  },
  chipsCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  intentChipCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary + '12',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  intentChipCompactText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  intentOverflow: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginLeft: 4,
  },
  // Hobby chip styles
  hobbyChip: {
    backgroundColor: PHASE1_DISCOVER_THEME.chipBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    marginRight: 8,
    marginBottom: 8,
  },
  hobbyChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: PHASE1_DISCOVER_THEME.chipText,
    letterSpacing: 0.1,
  },
  details: {
    gap: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailText: {
    fontSize: 16,
    fontWeight: '500',
    color: PHASE1_DISCOVER_THEME.text,
    letterSpacing: 0.1,
  },
  previewOnlyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginVertical: 24,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
  },
  previewOnlyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  backButtonAlt: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
});
