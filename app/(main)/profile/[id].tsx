import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { safePush } from '@/lib/safeRouter';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import {
  COLORS,
  RELATIONSHIP_INTENTS,
  ACTIVITY_FILTERS,
  PROFILE_PROMPT_QUESTIONS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  EXERCISE_OPTIONS,
  PETS_OPTIONS,
  KIDS_OPTIONS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
  SLEEP_SCHEDULE_OPTIONS,
  SOCIAL_RHYTHM_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  WORK_STYLE_OPTIONS,
  CORE_VALUES_OPTIONS,
} from '@/lib/constants';
import { computeIntentCompat, getIntentCompatColor, getIntentMismatchWarning } from '@/lib/intentCompat';
import { getTrustBadges } from '@/lib/trustBadges';
import { getDisplayBio, hasDisplayablePrompts, FALLBACK_BIO } from '@/lib/profileFallbacks';
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

export default function ViewProfileScreen() {
  const { id: userId, mode, confessionId, receiverId, fromChat, source } = useLocalSearchParams<{
    id: string;
    mode?: string;
    confessionId?: string;
    receiverId?: string;
    fromChat?: string;
    source?: string;
  }>();
  const isPhase2 = mode === 'phase2';

  // [P1_PROFILE_QUERY] Debug logging for phase isolation verification
  if (__DEV__) {
    console.log('[P1_PROFILE_QUERY] ViewProfileScreen mounted', {
      userId,
      mode,
      isPhase2,
      route: '/(main)/profile/[id]',
      expectedPhase: isPhase2 ? 'Phase-2' : 'Phase-1',
    });
  }
  const isConfessPreview = mode === 'confess_preview';
  const isConfessRevisit = mode === 'confess_revisit';
  const isConfessionComment = mode === 'confession_comment'; // FIX 8: Mini profile for comment connect
  const isConfessViewOnly = isConfessPreview || isConfessRevisit;
  // HARDENING FIX 3: Check backend flag for confession_comment profile (automatic detection)
  const isLimitedView = isConfessViewOnly || isConfessionComment; // FIX 8: All limited view modes
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { userId: currentUserId, token } = useAuthStore();
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showReportBlock, setShowReportBlock] = useState(false);
  const setDiscoverProfileActionResult = useInteractionStore((s) => s.setDiscoverProfileActionResult);

  // Part E: Photo tap navigation ref
  const photoListRef = useRef<FlatList>(null);

  // NOTE: Preview consumption is now handled BEFORE navigation in confessions.tsx
  // This ensures the preview is consumed before showing the profile, preventing abuse

  // Phase-1: Use users.getUserById
  const convexPhase1Profile = useQuery(
    api.users.getUserById,
    !isDemoMode && !isPhase2 && userId && currentUserId
      ? { userId: userId as any, viewerId: currentUserId as any }
      : 'skip'
  );

  // Shared Places query (Phase-1 only, not for demo mode)
  const sharedPlaces = useQuery(
    api.crossedPaths.getSharedPlaces,
    !isDemoMode && !isPhase2 && userId && currentUserId
      ? { viewerId: currentUserId as any, profileUserId: userId as any }
      : 'skip'
  );

  // Phase-2: Use privateDiscover.getProfileByUserId
  const convexPhase2Profile = useQuery(
    api.privateDiscover.getProfileByUserId,
    !isDemoMode && isPhase2 && userId && currentUserId
      ? { userId: userId as any, viewerId: currentUserId as any }
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
  const displayPhotos = useMemo(() => getRenderableProfilePhotos(profile?.photos), [profile?.photos]);
  const distanceLabel = useMemo(() => formatDiscoverDistanceKm(profile?.distance), [profile?.distance]);
  const verificationBadge = useMemo(
    () => getVerificationBadgeState({
      isVerified: profile?.isVerified,
      verificationStatus: profile?.verificationStatus,
    }),
    [profile?.isVerified, profile?.verificationStatus],
  );

  // Part E: Photo tap navigation handlers
  const totalPhotos = displayPhotos.length;

  useEffect(() => {
    if (currentPhotoIndex >= displayPhotos.length && displayPhotos.length > 0) {
      setCurrentPhotoIndex(displayPhotos.length - 1);
    } else if (displayPhotos.length === 0 && currentPhotoIndex !== 0) {
      setCurrentPhotoIndex(0);
    }
  }, [currentPhotoIndex, displayPhotos.length]);

  const handlePhotoTapLeft = useCallback(() => {
    if (currentPhotoIndex > 0) {
      const newIndex = currentPhotoIndex - 1;
      if (__DEV__) {
        console.log('[P1_PROFILE_PHOTO_TAP]', {
          side: 'left',
          previousIndex: currentPhotoIndex,
          nextIndex: newIndex,
          totalPhotos,
        });
      }
      setCurrentPhotoIndex(newIndex);
      photoListRef.current?.scrollToIndex({ index: newIndex, animated: true });
    }
  }, [currentPhotoIndex, totalPhotos]);

  const handlePhotoTapRight = useCallback(() => {
    if (currentPhotoIndex < totalPhotos - 1) {
      const newIndex = currentPhotoIndex + 1;
      if (__DEV__) {
        console.log('[P1_PROFILE_PHOTO_TAP]', {
          side: 'right',
          previousIndex: currentPhotoIndex,
          nextIndex: newIndex,
          totalPhotos,
        });
      }
      setCurrentPhotoIndex(newIndex);
      photoListRef.current?.scrollToIndex({ index: newIndex, animated: true });
    }
  }, [currentPhotoIndex, totalPhotos]);

  // Phase-1 swipe mutation (shared likes.ts)
  const swipe = useMutation(api.likes.swipe);
  // Phase-2 swipe mutation (isolated privateSwipes.ts) - STRICT ISOLATION
  const phase2Swipe = useMutation(api.privateSwipes.swipe);

  const demoLikes = useDemoStore((s) => s.likes);
  const simulateMatch = useDemoStore((s) => s.simulateMatch);

  const syncPhase1DiscoverAction = useCallback((action: 'like' | 'pass' | 'super_like') => {
    if (source !== 'phase1_discover' || isPhase2 || !userId) return;
    setDiscoverProfileActionResult({
      profileId: userId,
      action,
      source: 'phase1_discover_profile',
    });
  }, [isPhase2, setDiscoverProfileActionResult, source, userId]);

  const handleSwipe = async (action: 'like' | 'pass' | 'super_like') => {
    if (!currentUserId || !userId) return;

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

    try {
      // PHASE-2 ISOLATION: Use separate mutation path for Phase-2
      // Phase-2 writes to privateLikes/privateMatches/privateConversations
      // Phase-1 writes to likes/matches/conversations (shared tables)
      const result = isPhase2
        ? await phase2Swipe({
            token: token!,
            toUserId: userId as any,
            action,
          })
        : await swipe({
            token: token!,
            toUserId: userId as any,
            action,
          });

      if (result.isMatch) {
        // P1-001 FIX: Pass conversationId for Phase-2 so match-celebration can navigate correctly
        const modeParam = isPhase2 ? '&mode=phase2' : '';
        const convoId = (result as any).conversationId;
        const convoParam = isPhase2 && convoId ? `&conversationId=${convoId}` : '';
        syncPhase1DiscoverAction(action);
        safePush(router, `/(main)/match-celebration?matchId=${result.matchId}&userId=${userId}${modeParam}${convoParam}` as any, 'profile->matchCelebration');
      } else {
        syncPhase1DiscoverAction(action);
        router.back();
      }
    } catch {
      Toast.show('Something went wrong. Please try again.');
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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
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

  // profile.age is already the age in years (not a date), use it directly
  const age = profile.age || 0;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header: No back button, no overlay, just the 3-dots menu in top-right */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {/* Spacer to push menu to the right */}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => setShowReportBlock(true)}
          style={styles.moreButton}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      {/* BLUR ACCESS CONTROL:
          - Phase-2: Always blurred (privacy mode)
          - Phase-1: Respect owner's photoBlurred setting
          - Owner sees their own profile clear (handled in profile.tsx tab, not here)
          - Other users see blurred if owner enabled photoBlurred */}
      {(() => {
        // Determine blur: Phase-2 = strong blur, Phase-1 = respect owner's photoBlurred setting
        const shouldBlur = isPhase2 || (profile as any).photoBlurred === true;
        const blurIntensity = isPhase2 ? 20 : (shouldBlur ? 8 : 0);

        if (__DEV__) {
          console.log('[ViewProfile] 🔒 Photo blur access control:', {
            viewerId: currentUserId?.slice(-8),
            ownerId: userId?.slice(-8),
            isPhase2,
            ownerPhotoBlurred: (profile as any).photoBlurred,
            shouldBlur,
            blurIntensity,
          });
        }

        return displayPhotos.length > 0 ? (
          <View style={{ position: 'relative' }}>
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
              scrollEnabled={false} // Disable swipe, use tap navigation only
              data={displayPhotos}
              keyExtractor={(item, index) => item._id || `photo-${index}`}
              getItemLayout={(_, index) => ({
                length: screenWidth,
                offset: screenWidth * index,
                index,
              })}
              renderItem={({ item }) => (
                <View style={{ width: screenWidth, height: 500 + insets.top, overflow: 'hidden', paddingTop: insets.top, backgroundColor: COLORS.backgroundDark }}>
                  <Image
                    source={{ uri: item.url }}
                    style={{ width: '100%', height: 500 }}
                    contentFit="cover"
                    blurRadius={blurIntensity}
                  />
                </View>
              )}
              style={styles.photoCarousel}
            />
            {/* Part E: Tap zones for photo navigation - tap left = prev, tap right = next */}
            {totalPhotos > 1 && (
              <View style={styles.photoTapZones} pointerEvents="box-none">
                <Pressable
                  style={styles.photoTapZoneLeft}
                  onPress={handlePhotoTapLeft}
                />
                <Pressable
                  style={styles.photoTapZoneRight}
                  onPress={handlePhotoTapRight}
                />
              </View>
            )}
          </View>
        ) : null;
      })()}
      {displayPhotos.length === 0 && (
        <View style={[styles.photoPlaceholder, { height: 500 + insets.top, paddingTop: insets.top }]}>
          <Ionicons name="person" size={64} color={COLORS.textLight} />
        </View>
      )}

      {displayPhotos.length > 1 && (
        <View style={styles.photoIndicators}>
          {displayPhotos.map((_: any, index: number) => (
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
          <Text style={styles.name}>
            {profile.name}, {age}
          </Text>
          {distanceLabel && (
            <Text style={styles.distance}>{distanceLabel}</Text>
          )}
        </View>

        {/* Trust Badges: Face Verified + Presence (Online Now / Active Today) */}
        {/* Consistent with Discover card badges */}
        {(() => {
          // Presence badge logic (same as ProfileCard.tsx)
          const now = Date.now();
          const lastActive = profile.lastActive;
          const isOnline = lastActive && (now - lastActive < 10 * 60 * 1000); // < 10 min
          const isActiveToday = lastActive && (now - lastActive < 24 * 60 * 60 * 1000) && !isOnline; // < 24h, not online

          return (
            <View style={styles.trustBadgeRow}>
              {/* Face Verified badge */}
              <View style={[styles.trustBadge, { borderColor: verificationBadge.color + '40' }]}>
                <Ionicons name={verificationBadge.icon} size={14} color={verificationBadge.color} />
                <Text style={[styles.trustBadgeText, { color: verificationBadge.color }]}>
                  {verificationBadge.label}
                </Text>
              </View>

              {/* Online Now badge (priority over Active Today) */}
              {isOnline && (
                <View style={[styles.trustBadge, { borderColor: '#22C55E40' }]}>
                  <View style={styles.onlineDot} />
                  <Text style={[styles.trustBadgeText, { color: '#22C55E' }]}>
                    Online Now
                  </Text>
                </View>
              )}

              {/* Active Today badge (only if not online) */}
              {isActiveToday && (
                <View style={[styles.trustBadge, { borderColor: '#3B82F640' }]}>
                  <Ionicons name="time-outline" size={14} color="#3B82F6" />
                  <Text style={[styles.trustBadgeText, { color: '#3B82F6' }]}>
                    Active Today
                  </Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* ========== PHASE-2 SECTION ORDER: Bio → My Intent → Hobbies → Interests (NO Details) ========== */}

        {/* Phase-2: Desire (Bio) - FIRST in Phase-2 */}
        {/* P3 FALLBACK: Always show bio section with fallback */}
        {isPhase2 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Desire (Bio)</Text>
            <Text style={[styles.bio, !profile.bio && styles.bioFallback]}>
              {getDisplayBio(profile.bio, true)}
            </Text>
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

        {/* ═══════════════════════════════════════════════════════════════════════════
            PHASE-1 FULL PROFILE SECTION ORDER (STRICT):
            1. ABOUT (bio + prompts)
            2. LOOKING FOR (relationshipIntent)
            3. INTERESTS (activities)
            4. LIFESTYLE (smoking, drinking, exercise, pets, kids)
            5. ESSENTIALS (height, job, school, education)
            6. DEEPER TRAITS (sleepSchedule, socialRhythm, travelStyle, workStyle, coreValues)
            7. OPTIONAL (religion)
            + Shared Interests ("You both enjoy")
            + Common Places
            ═══════════════════════════════════════════════════════════════════════════ */}

        {/* DEBUG: Log full profile data */}
        {!isPhase2 && (() => {
          // Helper functions for display labels
          const getSmokingLabel = (v: string) => SMOKING_OPTIONS.find(o => o.value === v)?.label || v;
          const getDrinkingLabel = (v: string) => DRINKING_OPTIONS.find(o => o.value === v)?.label || v;
          const getExerciseLabel = (v: string) => EXERCISE_OPTIONS.find(o => o.value === v)?.label || v;
          const getKidsLabel = (v: string) => KIDS_OPTIONS.find(o => o.value === v)?.label || v;
          const getEducationLabel = (v: string) => EDUCATION_OPTIONS.find(o => o.value === v)?.label || v;
          const getReligionLabel = (v: string) => RELIGION_OPTIONS.find(o => o.value === v)?.label || v;
          const getSleepLabel = (v: string) => SLEEP_SCHEDULE_OPTIONS.find(o => o.value === v)?.label || v;
          const getSocialLabel = (v: string) => SOCIAL_RHYTHM_OPTIONS.find(o => o.value === v)?.label || v;
          const getTravelLabel = (v: string) => TRAVEL_STYLE_OPTIONS.find(o => o.value === v)?.label || v;
          const getWorkLabel = (v: string) => WORK_STYLE_OPTIONS.find(o => o.value === v)?.label || v;
          const getCoreValueLabel = (v: string) => CORE_VALUES_OPTIONS.find(o => o.value === v)?.label || v;
          const getPetLabel = (v: string) => PETS_OPTIONS.find(o => o.value === v)?.label || v;

          // Section visibility helpers
          // P3 FALLBACK: Use getDisplayBio for bio with fallback
          const displayBio = getDisplayBio(profile.bio, true); // Always show fallback if no bio
          const hasBio = !!profile.bio && profile.bio.trim().length > 0;
          const hasPrompts = hasDisplayablePrompts(profile.profilePrompts);
          // P3 FALLBACK: Always show About section (with fallback bio if needed)
          const hasAbout = true; // Always show About with at least fallback bio

          const relIntent: string[] = profile.relationshipIntent || [];
          const hasLookingFor = relIntent.length > 0;

          const hasInterests = profile.activities && profile.activities.length > 0;

          const hasLifestyle = !!(
            profile.smoking ||
            profile.drinking ||
            profile.exercise ||
            (profile.pets && profile.pets.length > 0) ||
            profile.kids
          );

          const hasEssentials = !!(
            profile.height ||
            profile.jobTitle ||
            profile.school ||
            profile.education
          );

          const hasDeeperTraits = !!(
            profile.sleepSchedule ||
            profile.socialRhythm ||
            profile.travelStyle ||
            profile.workStyle ||
            (profile.coreValues && profile.coreValues.length > 0)
          );

          const hasOptional = !!profile.religion;

          // Build rendered sections list for logging
          // NOTE: looking_for removed from public profile per privacy rules
          const sectionsRendered: string[] = ['hero'];
          if (hasAbout) sectionsRendered.push('about');
          if (hasInterests) sectionsRendered.push('interests');
          if (hasLifestyle) sectionsRendered.push('lifestyle');
          if (hasEssentials) sectionsRendered.push('essentials');
          if (hasDeeperTraits) sectionsRendered.push('deeper_traits');
          if (hasOptional) sectionsRendered.push('optional');

          if (__DEV__) {
            console.log('[FULL_PROFILE_DATA]', {
              hasBio,
              displayBio: displayBio?.slice(0, 30), // P3 FALLBACK: Log display bio preview
              promptCount: profile.profilePrompts?.length || 0,
              interestCount: profile.activities?.length || 0,
              hasLifestyle,
              hasEssentials,
              hasDeeperTraits,
              sectionsRendered: sectionsRendered.join(' | '),
            });
            console.log('[FULL_PROFILE_INTERESTS]', {
              count: profile.activities?.length || 0,
              values: profile.activities || [],
              source: 'profile.activities',
            });
            console.log('[FULL_PROFILE_SECTIONS]', sectionsRendered.join(' | '));
          }

          return (
            <>
              {/* ═══════════════════════════════════════════════════════════════════════════
                  SECTION 1: ABOUT (Bio + Prompts)
                  ═══════════════════════════════════════════════════════════════════════════ */}
              {hasAbout && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>About</Text>
                  {/* P3 FALLBACK: Show displayBio (with fallback) instead of profile.bio */}
                  <Text style={[styles.bio, !hasBio && styles.bioFallback]}>{displayBio}</Text>
                  {hasPrompts && (
                    <View style={{ marginTop: 16 }}>
                      {profile.profilePrompts.slice(0, 3).map((prompt: { question: string; answer: string }, idx: number) => (
                        <View key={idx} style={styles.promptCard}>
                          <Text style={styles.promptQuestion}>{prompt.question}</Text>
                          <Text style={styles.promptAnswer}>{prompt.answer}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* ═══════════════════════════════════════════════════════════════════════════
                  SECTION 2: RELATIONSHIP GOALS (moved to private/match context only)
                  NOTE: "Looking for" removed from public profile per privacy rules
                  Partner preferences and relationship intents are private information
                  ═══════════════════════════════════════════════════════════════════════════ */}

              {/* ═══════════════════════════════════════════════════════════════════════════
                  SECTION 3: INTERESTS (Activities)
                  ═══════════════════════════════════════════════════════════════════════════ */}
              {hasInterests && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Interests</Text>
                  <View style={styles.chips}>
                    {profile.activities.map((activity: string) => {
                      const activityData = ACTIVITY_FILTERS.find((a) => a.value === activity);
                      return (
                        <View key={activity} style={styles.chip}>
                          <Text style={styles.chipText}>
                            {activityData?.emoji} {activityData?.label || activity}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* ═══════════════════════════════════════════════════════════════════════════
                  SECTION 4: LIFESTYLE (Smoking, Drinking, Exercise, Pets, Kids)
                  ═══════════════════════════════════════════════════════════════════════════ */}
              {hasLifestyle && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Lifestyle</Text>
                  <View style={styles.details}>
                    {profile.smoking && profile.smoking !== 'prefer_not_to_say' && (
                      <View style={styles.detailRow}>
                        <Ionicons name="flame-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getSmokingLabel(profile.smoking)}</Text>
                      </View>
                    )}
                    {profile.drinking && profile.drinking !== 'prefer_not_to_say' && (
                      <View style={styles.detailRow}>
                        <Ionicons name="wine-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getDrinkingLabel(profile.drinking)}</Text>
                      </View>
                    )}
                    {profile.exercise && profile.exercise !== 'prefer_not_to_say' && (
                      <View style={styles.detailRow}>
                        <Ionicons name="fitness-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getExerciseLabel(profile.exercise)}</Text>
                      </View>
                    )}
                    {profile.pets && profile.pets.length > 0 && (
                      <View style={styles.detailRow}>
                        <Ionicons name="paw-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>
                          {profile.pets.map((p: string) => getPetLabel(p)).join(', ')}
                        </Text>
                      </View>
                    )}
                    {profile.kids && profile.kids !== 'prefer_not_to_say' && (
                      <View style={styles.detailRow}>
                        <Ionicons name="people-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getKidsLabel(profile.kids)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* ═══════════════════════════════════════════════════════════════════════════
                  SECTION 5: ESSENTIALS (Height, Job, School, Education)
                  ═══════════════════════════════════════════════════════════════════════════ */}
              {hasEssentials && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Essentials</Text>
                  <View style={styles.details}>
                    {profile.height && (
                      <View style={styles.detailRow}>
                        <Ionicons name="resize-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{profile.height} cm</Text>
                      </View>
                    )}
                    {profile.jobTitle && (
                      <View style={styles.detailRow}>
                        <Ionicons name="briefcase-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>
                          {profile.jobTitle}
                          {profile.company && ` at ${profile.company}`}
                        </Text>
                      </View>
                    )}
                    {profile.school && (
                      <View style={styles.detailRow}>
                        <Ionicons name="school-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{profile.school}</Text>
                      </View>
                    )}
                    {profile.education && (
                      <View style={styles.detailRow}>
                        <Ionicons name="book-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getEducationLabel(profile.education)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* ═══════════════════════════════════════════════════════════════════════════
                  SECTION 6: DEEPER TRAITS (Sleep, Social, Travel, Work Style, Core Values)
                  ═══════════════════════════════════════════════════════════════════════════ */}
              {hasDeeperTraits && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Deeper Traits</Text>
                  <View style={styles.details}>
                    {profile.sleepSchedule && (
                      <View style={styles.detailRow}>
                        <Ionicons name="moon-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getSleepLabel(profile.sleepSchedule)}</Text>
                      </View>
                    )}
                    {profile.socialRhythm && (
                      <View style={styles.detailRow}>
                        <Ionicons name="people-circle-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getSocialLabel(profile.socialRhythm)}</Text>
                      </View>
                    )}
                    {profile.travelStyle && (
                      <View style={styles.detailRow}>
                        <Ionicons name="airplane-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getTravelLabel(profile.travelStyle)}</Text>
                      </View>
                    )}
                    {profile.workStyle && (
                      <View style={styles.detailRow}>
                        <Ionicons name="laptop-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getWorkLabel(profile.workStyle)}</Text>
                      </View>
                    )}
                    {profile.coreValues && profile.coreValues.length > 0 && (
                      <View style={styles.coreValuesRow}>
                        <View style={styles.detailRow}>
                          <Ionicons name="heart-outline" size={20} color={COLORS.textLight} />
                          <Text style={styles.detailText}>Core Values</Text>
                        </View>
                        <View style={styles.coreValuesChips}>
                          {profile.coreValues.map((v: string) => (
                            <View key={v} style={styles.coreValueChip}>
                              <Text style={styles.coreValueChipText}>{getCoreValueLabel(v)}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* ═══════════════════════════════════════════════════════════════════════════
                  SECTION 7: OPTIONAL (Religion)
                  ═══════════════════════════════════════════════════════════════════════════ */}
              {hasOptional && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>More About Me</Text>
                  <View style={styles.details}>
                    {profile.religion && profile.religion !== 'prefer_not_to_say' && (
                      <View style={styles.detailRow}>
                        <Ionicons name="sparkles-outline" size={20} color={COLORS.textLight} />
                        <Text style={styles.detailText}>{getReligionLabel(profile.religion)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* ═══════════════════════════════════════════════════════════════════════════
                  SHARED INTERESTS ("You both enjoy")
                  ═══════════════════════════════════════════════════════════════════════════ */}
              {(() => {
                const myActivities: string[] = isDemoMode ? getDemoCurrentUser().activities : [];
                const shared = (profile.activities || []).filter((a: string) => myActivities.includes(a));
                if (shared.length === 0) return null;
                return (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>You Both Enjoy</Text>
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

              {/* ═══════════════════════════════════════════════════════════════════════════
                  COMMON PLACES (Privacy-safe shared locations)
                  ═══════════════════════════════════════════════════════════════════════════ */}
              {sharedPlaces && sharedPlaces.length > 0 && (
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
            </>
          );
        })()}

        {/* Action Buttons - Hidden in limited view modes or when opened from chat */}
        {/* HARDENING FIX 3: Also check backend flag for automatic detection */}
        {(isLimitedView || profile?.isConfessionCommentProfile) ? (
          <View style={styles.previewOnlyBanner}>
            <Ionicons
              name={(isConfessionComment || profile?.isConfessionCommentProfile) ? 'chatbubble-ellipses-outline' : 'eye-outline'}
              size={18}
              color={COLORS.textMuted}
            />
            <Text style={styles.previewOnlyText}>
              {(isConfessionComment || profile?.isConfessionCommentProfile)
                ? 'Connected via Confession - Limited Profile'
                : 'View Only'}
            </Text>
          </View>
        ) : fromChat === '1' ? null : (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.passButton]}
              onPress={() => handleSwipe('pass')}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={28} color={COLORS.pass} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.superLikeButton]}
              onPress={() => handleSwipe('super_like')}
              activeOpacity={0.7}
            >
              <Ionicons name="star" size={28} color={COLORS.superLike} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.likeButton]}
              onPress={() => handleSwipe('like')}
              activeOpacity={0.7}
            >
              <Ionicons name="heart" size={28} color={COLORS.like} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ReportBlockModal
        visible={showReportBlock}
        onClose={() => setShowReportBlock(false)}
        reportedUserId={userId || ''}
        reportedUserName={profile?.name || 'this user'}
        currentUserId={currentUserId || ''}
        onBlockSuccess={() => router.back()}
      />
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  // Part E: Photo tap navigation zones
  photoTapZones: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  photoTapZoneLeft: {
    flex: 1,
    // Transparent - tap area only
  },
  photoTapZoneRight: {
    flex: 1,
    // Transparent - tap area only
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
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
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
  // P3 FALLBACK: Style for fallback bio text
  bioFallback: {
    fontStyle: 'italic',
    color: COLORS.textMuted,
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
  // Core Values specific styles
  coreValuesRow: {
    marginTop: 4,
  },
  coreValuesChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginLeft: 32,
  },
  coreValueChip: {
    backgroundColor: COLORS.primary + '15',
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  coreValueChipText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    gap: 24,
  },
  actionButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
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
