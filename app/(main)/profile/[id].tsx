import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
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
} from '@/lib/constants';
import { computeIntentCompat, getIntentCompatColor, getIntentMismatchWarning } from '@/lib/intentCompat';
import { getTrustBadges } from '@/lib/trustBadges';
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
import { getRenderableProfilePhotos } from '@/lib/profileData';
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

// Gender labels for "Looking for" display
const GENDER_LABELS: Record<string, string> = {
  male: 'Men',
  female: 'Women',
  non_binary: 'Non-binary',
  lesbian: 'Women',
  other: 'Everyone',
};

function getVerificationBadgeState(profile: { isVerified?: boolean; verificationStatus?: string }) {
  const status = profile.isVerified ? 'verified' : (profile.verificationStatus || 'unverified');

  switch (status) {
    case 'verified':
      return {
        label: 'Verified',
        color: COLORS.success,
        icon: 'shield-checkmark' as const,
      };
    case 'pending_auto':
    case 'pending_manual':
    case 'pending_verification':
      return {
        label: 'Verification pending',
        color: COLORS.secondary,
        icon: 'time-outline' as const,
      };
    default:
      return {
        label: 'Not verified',
        color: COLORS.textMuted,
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
  const { id: userId, mode, fromChat, source, actionScope, freshness, intent } = useLocalSearchParams<{
    id: string;
    mode?: string;
    fromChat?: string;
    source?: string;
    actionScope?: string;
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
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
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
  const distanceLabel = useMemo(
    () => (isNearbyPrivacySource ? null : formatDiscoverDistanceKm(profile?.distance)),
    [isNearbyPrivacySource, profile?.distance],
  );
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
        router.back();
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
          router.back();
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
        router.back();
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
        <TouchableOpacity style={styles.backButtonAlt} onPress={() => router.back()}>
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
        <TouchableOpacity style={styles.backButtonAlt} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const age = typeof profile.age === 'number' && profile.age > 0 ? profile.age : null;
  const profileIdentity = age ? `${profile.name}, ${age}` : profile.name;

  // P1-FIX: Determine if action buttons should be shown
  const showActionButtons = fromChat !== '1' && !isConfessPreview;

  return (
    <View style={styles.rootContainer}>
      {/* P1-FIX: Sticky Header - appears when scrolled past photo */}
      {showStickyHeader && (
        <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.stickyBackButton}>
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
        contentContainerStyle={showActionButtons ? { paddingBottom: 100 } : undefined}
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

        {/* Photo carousel with count indicator */}
        <View style={styles.photoCarouselContainer}>
          {visiblePhotos.length > 0 ? (
            <FlatList
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

          {/* P1-FIX: Photo count indicator (e.g., "2/5") */}
          {visiblePhotos.length > 1 && (
            <View style={[styles.photoCountIndicator, { top: insets.top + 16 }]}>
              <Text style={styles.photoCountText}>
                {currentPhotoIndex + 1}/{visiblePhotos.length}
              </Text>
            </View>
          )}
        </View>

        {visiblePhotos.length > 1 && (
          <View style={styles.photoIndicators}>
            {visiblePhotos.map((_: any, index: number) => (
              <View
                key={index}
                style={[
                  styles.indicator,
                  index === currentPhotoIndex && styles.indicatorActive,
                ]}
              />
            ))}
          </View>
        )}

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

        {/* Trust Badges - includes verification status */}
        {!isConfessPreview && (() => {
          // P0 UNIFIED PRESENCE: Use presenceStatus from reactive query
          const badges = getTrustBadges({
            isVerified: profile.isVerified,
            presenceStatus,
            photoCount: profile.photos?.length,
            bio: profile.bio,
          });
          // Filter out the "Verified" badge from getTrustBadges since we show it separately
          const otherBadges = badges.filter((b) => b.key !== 'verified');
          const visible = otherBadges.slice(0, 2); // Show 2 other badges max
          const overflow = otherBadges.length - 2;

          return (
            <View style={styles.trustBadgeRow}>
              {/* Verification badge - always first */}
              <View style={[styles.trustBadge, { borderColor: verificationBadge.color + '40' }]}>
                <Ionicons name={verificationBadge.icon} size={14} color={verificationBadge.color} />
                <Text style={[styles.trustBadgeText, { color: verificationBadge.color }]}>
                  {verificationBadge.label}
                </Text>
              </View>

              {/* Other trust badges */}
              {visible.map((badge) => (
                <View key={badge.key} style={[styles.trustBadge, { borderColor: badge.color + '40' }]}>
                  <Ionicons name={badge.icon as any} size={14} color={badge.color} />
                  <Text style={[styles.trustBadgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              ))}
              {overflow > 0 && (
                <View style={[styles.trustBadge, { borderColor: COLORS.textMuted + '40' }]}>
                  <Text style={[styles.trustBadgeText, { color: COLORS.textMuted }]}>+{overflow}</Text>
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

        {/* ========== PHASE-1 SECTION ORDER: Intent → Bio → Prompts → Interests → Hobbies → Details ========== */}

        {/* Phase-1 Intent - show lookingFor (gender) + relationshipIntent chips */}
        {!isPhase2 && !isConfessPreview && (() => {
          const lookingFor: string[] = (profile as any).lookingFor || [];
          const relIntent: string[] = profile.relationshipIntent || [];
          if (lookingFor.length === 0 && relIntent.length === 0) return null;

          let lookingForText = '';
          if (lookingFor.length >= 3) {
            lookingForText = 'Everyone';
          } else if (lookingFor.length > 0) {
            const labels = lookingFor.map(g => GENDER_LABELS[g] || g).filter(Boolean);
            const unique = [...new Set(labels)];
            lookingForText = unique.join(', ');
          }

          const intentLabels = relIntent
            .map(key => RELATIONSHIP_INTENTS.find(i => i.value === key))
            .filter(Boolean);

          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Looking for</Text>
              <View style={styles.chips}>
                {lookingForText && (
                  <View style={styles.lookingForChip}>
                    <Ionicons name="people-outline" size={14} color={COLORS.primary} />
                    <Text style={styles.lookingForText}>{lookingForText}</Text>
                  </View>
                )}
                {intentLabels.map((intent, idx) => (
                  <View key={idx} style={styles.chip}>
                    <Text style={styles.chipText}>{intent!.emoji} {intent!.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })()}

        {/* Phase-1: About (Bio) */}
        {!isPhase2 && !isConfessPreview && profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bio}>{profile.bio}</Text>
          </View>
        )}

        {/* Profile Prompts - Phase-1 ONLY */}
        {!isPhase2 && !isConfessPreview && profile.profilePrompts && profile.profilePrompts.length > 0 && (
          <View style={styles.section}>
            {profile.profilePrompts.slice(0, 3).map((prompt: { question: string; answer: string }, idx: number) => (
              <View key={idx} style={styles.promptCard}>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.promptAnswer}>{prompt.answer}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Shared Interests - Both phases */}
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

        {/* Common Places - Phase-1 only, privacy-safe shared locations */}
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

        {/* Interests - Both phases (Phase-2 shows above in different section) */}
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

        {/* Details - Phase-1 ONLY (hidden in Phase-2) */}
        {!isPhase2 && !isConfessPreview && (() => {
          // P2-1: Extend Details section to include kids, religion, school,
          // smoking, drinking (previously only height, job, education rendered).
          const kidsLabel = profile.kids
            ? KIDS_OPTIONS.find((o) => o.value === profile.kids)?.label ?? null
            : null;
          const religionLabel = profile.religion
            ? RELIGION_OPTIONS.find((o) => o.value === profile.religion)?.label ?? null
            : null;
          const smokingLabel = profile.smoking
            ? SMOKING_OPTIONS.find((o) => o.value === profile.smoking)?.label ?? null
            : null;
          const drinkingLabel = profile.drinking
            ? DRINKING_OPTIONS.find((o) => o.value === profile.drinking)?.label ?? null
            : null;
          const schoolLabel = typeof profile.school === 'string' && profile.school.trim().length > 0
            ? profile.school.trim()
            : null;

          const hasAny =
            profile.height ||
            profile.jobTitle ||
            profile.education ||
            kidsLabel ||
            religionLabel ||
            smokingLabel ||
            drinkingLabel ||
            schoolLabel;

          if (!hasAny) return null;

          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Details</Text>
              <View style={styles.details}>
                {profile.height && (
                  <View style={styles.detailRow}>
                    <Ionicons name="resize" size={20} color={COLORS.textLight} />
                    <Text style={styles.detailText}>{profile.height} cm</Text>
                  </View>
                )}
                {profile.jobTitle && (
                  <View style={styles.detailRow}>
                    <Ionicons name="briefcase" size={20} color={COLORS.textLight} />
                    <Text style={styles.detailText}>
                      {profile.jobTitle}
                      {profile.company && ` at ${profile.company}`}
                    </Text>
                  </View>
                )}
                {profile.education && (
                  <View style={styles.detailRow}>
                    <Ionicons name="school" size={20} color={COLORS.textLight} />
                    <Text style={styles.detailText}>{profile.education}</Text>
                  </View>
                )}
                {schoolLabel && (
                  <View style={styles.detailRow}>
                    <Ionicons name="school-outline" size={20} color={COLORS.textLight} />
                    <Text style={styles.detailText}>{schoolLabel}</Text>
                  </View>
                )}
                {religionLabel && (
                  <View style={styles.detailRow}>
                    <Ionicons name="book-outline" size={20} color={COLORS.textLight} />
                    <Text style={styles.detailText}>{religionLabel}</Text>
                  </View>
                )}
                {kidsLabel && (
                  <View style={styles.detailRow}>
                    <Ionicons name="people-outline" size={20} color={COLORS.textLight} />
                    <Text style={styles.detailText}>{kidsLabel}</Text>
                  </View>
                )}
                {smokingLabel && (
                  <View style={styles.detailRow}>
                    <Ionicons name="flame-outline" size={20} color={COLORS.textLight} />
                    <Text style={styles.detailText}>Smoking: {smokingLabel}</Text>
                  </View>
                )}
                {drinkingLabel && (
                  <View style={styles.detailRow}>
                    <Ionicons name="wine-outline" size={20} color={COLORS.textLight} />
                    <Text style={styles.detailText}>Drinking: {drinkingLabel}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })()}

        {/* Action Buttons placeholder removed - now sticky at bottom */}
      </View>
      </ScrollView>

      {/* P1-FIX: Sticky Action Buttons - Fixed at bottom of screen */}
      {showActionButtons && (
        <View style={[styles.stickyActions, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity
            style={[styles.actionButton, styles.passButton, isActionPending && styles.actionButtonDisabled]}
            onPress={() => handleSwipe('pass')}
            activeOpacity={isActionPending ? 1 : 0.7}
            disabled={isActionPending}
          >
            <Ionicons name="close" size={28} color={COLORS.pass} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.superLikeButton, isActionPending && styles.actionButtonDisabled]}
            onPress={() => handleSwipe('super_like')}
            activeOpacity={isActionPending ? 1 : 0.7}
            disabled={isActionPending}
          >
            <Ionicons name="star" size={28} color={COLORS.superLike} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.likeButton, isActionPending && styles.actionButtonDisabled]}
            onPress={() => handleSwipe('like')}
            activeOpacity={isActionPending ? 1 : 0.7}
            disabled={isActionPending}
          >
            <Ionicons name="heart" size={28} color={COLORS.like} />
          </TouchableOpacity>
        </View>
      )}

      <ReportBlockModal
        visible={showReportBlock}
        onClose={() => setShowReportBlock(false)}
        reportedUserId={userId || ''}
        reportedUserName={profile?.name || 'this user'}
        currentUserId={currentUserId || ''}
        onBlockSuccess={() => router.back()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // P1-FIX: Root container for sticky layout
  rootContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
  // P1-FIX: Photo count indicator (e.g., "2/5")
  photoCountIndicator: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  photoCountText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
  // P1-FIX: Sticky action buttons at bottom
  stickyActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 12,
    gap: 24,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
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
  photoIndicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
    marginHorizontal: 4,
  },
  indicatorActive: {
    backgroundColor: COLORS.primary,
    width: 24,
  },
  content: {
    padding: 16,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
    gap: 8,
    marginBottom: 16,
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  trustBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  name: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  distance: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  bio: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
  },
  promptCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  promptQuestion: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  promptAnswer: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 22,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: COLORS.backgroundDark,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  lookingForChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary + '15',
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  lookingForText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.primary,
  },
  sharedChip: {
    backgroundColor: COLORS.secondary + '20',
    borderWidth: 1,
    borderColor: COLORS.secondary + '40',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  sharedChipText: {
    fontSize: 14,
    color: COLORS.secondary,
    fontWeight: '600',
  },
  // Common Places chip styles (privacy-safe shared locations)
  commonPlaceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.secondary + '15',
    borderWidth: 1,
    borderColor: COLORS.secondary + '30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  commonPlaceText: {
    fontSize: 14,
    color: COLORS.secondary,
    fontWeight: '500',
  },
  intentChip: {
    backgroundColor: COLORS.primary + '15',
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  intentChipText: {
    fontSize: 15,
    color: COLORS.primary,
    fontWeight: '600',
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
    backgroundColor: COLORS.primary + '15',
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  intentChipCompactText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  intentOverflow: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginLeft: 4,
  },
  // Hobby chip styles
  hobbyChip: {
    backgroundColor: COLORS.backgroundDark,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  hobbyChipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  details: {
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    fontSize: 16,
    color: COLORS.text,
    marginLeft: 12,
  },
  // Note: actions style replaced by stickyActions (P1-FIX)
  actionButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  passButton: {
    backgroundColor: COLORS.backgroundDark,
  },
  superLikeButton: {
    backgroundColor: COLORS.backgroundDark,
  },
  likeButton: {
    backgroundColor: COLORS.backgroundDark,
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
