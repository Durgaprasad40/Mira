/**
 * PHASE-2 FULL PROFILE VIEW
 *
 * Dedicated Phase-2 profile screen matching Phase-1 full-profile UX but with:
 * - Phase-2 data sources only (privateDiscover.getProfileByUserId)
 * - Phase-2 categories, prompts, and styling
 * - No Phase-1 route leakage
 *
 * STRICT ISOLATION: This is a Phase-2-only route under /(main)/(private)/
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Dimensions,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Id } from '@/convex/_generated/dataModel';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { useDiscoverStore } from '@/stores/discoverStore';
import { useInteractionStore } from '@/stores/interactionStore';
import { INCOGNITO_COLORS, COLORS, ACTIVITY_FILTERS } from '@/lib/constants';
import { cmToFeetInches } from '@/lib/utils';
import {
  PRIVATE_INTENT_CATEGORIES,
  PRIVATE_DESIRE_TAGS,
} from '@/lib/privateConstants';
import { isDemoMode } from '@/hooks/useConvex';
import { useScreenTrace } from '@/lib/devTrace';
import { Toast } from '@/components/ui/Toast';
// P2-004: Centralized gender icon utility
import { getGenderIcon } from '@/lib/genderIcon';

const C = INCOGNITO_COLORS;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PHOTO_HEIGHT = SCREEN_HEIGHT * 0.55;

// ═══════════════════════════════════════════════════════════════════════════
// FLOATING ACTION BUTTONS COMPONENT
// Premium micro-interactions with spring animations
// ═══════════════════════════════════════════════════════════════════════════
interface FloatingActionButtonsProps {
  onPass: () => void;
  onStandOut: () => void;
  onLike: () => void;
  standOutsRemaining: number;
  standOutDisabled: boolean;
  bottomInset: number;
}

function FloatingActionButtons({
  onPass,
  onStandOut,
  onLike,
  standOutsRemaining,
  standOutDisabled,
  bottomInset,
}: FloatingActionButtonsProps) {
  // Animation scales for each button
  const passScale = useSharedValue(1);
  const standOutScale = useSharedValue(1);
  const likeScale = useSharedValue(1);

  // Animated styles
  const passAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: passScale.value }],
  }));
  const standOutAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: standOutScale.value }],
  }));
  const likeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeScale.value }],
  }));

  // Press handlers with spring animation
  const onPassPressIn = () => {
    passScale.value = withSpring(0.92, { damping: 15, stiffness: 400 });
  };
  const onPassPressOut = () => {
    passScale.value = withSpring(1, { damping: 12, stiffness: 350 });
  };

  const onStandOutPressIn = () => {
    standOutScale.value = withSpring(0.92, { damping: 15, stiffness: 400 });
  };
  const onStandOutPressOut = () => {
    standOutScale.value = withSpring(1, { damping: 12, stiffness: 350 });
  };

  const onLikePressIn = () => {
    likeScale.value = withSpring(0.92, { damping: 15, stiffness: 400 });
  };
  const onLikePressOut = () => {
    likeScale.value = withSpring(1, { damping: 12, stiffness: 350 });
  };

  // [P2_PROFILE_ACTION_BAR] Debug logging
  if (__DEV__) {
    console.log('[P2_PROFILE_ACTION_BAR]', {
      style: 'premium_floating',
      background: 'transparent',
      microInteractions: true,
      buttonSizes: { pass: 56, standOut: 68, like: 56 },
      standOutsRemaining,
      standOutDisabled,
    });
  }

  return (
    <View style={[floatingStyles.cluster, { paddingBottom: Math.max(bottomInset, 24) + 8 }]}>
      {/* Pass button - side button */}
      <Animated.View style={passAnimStyle}>
        <Pressable
          style={floatingStyles.passButton}
          onPress={onPass}
          onPressIn={onPassPressIn}
          onPressOut={onPassPressOut}
        >
          <Ionicons name="close" size={28} color="#FF5252" />
        </Pressable>
      </Animated.View>

      {/* Stand Out button - CENTER, LARGER */}
      <Animated.View style={standOutAnimStyle}>
        <Pressable
          style={[
            floatingStyles.standOutButton,
            standOutDisabled && floatingStyles.buttonDisabled,
          ]}
          onPress={onStandOut}
          onPressIn={onStandOutPressIn}
          onPressOut={onStandOutPressOut}
          disabled={standOutDisabled}
        >
          <Ionicons name="star" size={28} color="#FFF" />
          <View style={floatingStyles.standOutBadge}>
            <Text style={floatingStyles.standOutBadgeText}>{standOutsRemaining}</Text>
          </View>
        </Pressable>
      </Animated.View>

      {/* Like button - side button */}
      <Animated.View style={likeAnimStyle}>
        <Pressable
          style={floatingStyles.likeButton}
          onPress={onLike}
          onPressIn={onLikePressIn}
          onPressOut={onLikePressOut}
        >
          <Ionicons name="heart" size={28} color="#FFF" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

// Premium floating button styles - separate from main styles for clarity
const floatingStyles = StyleSheet.create({
  cluster: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 12,
    gap: 24,
    // NO background - fully transparent
  },
  passButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    // Soft shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  standOutButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    // Colored glow shadow
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  standOutBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    // Subtle badge shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  standOutBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2196F3',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  likeButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    // Brand color glow
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
});

export default function Phase2FullProfileScreen() {
  useScreenTrace('P2_FULL_PROFILE_VIEW');
  const { userId: profileUserId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  // [P2_PROFILE_QUERY] Debug logging - this screen should ONLY be reached from Phase-2
  if (__DEV__) {
    console.log('[P2_PROFILE_QUERY] Phase2FullProfileScreen mounted', {
      profileUserId,
      route: '/(main)/(private)/p2-profile/[userId]',
      phase: 'Phase-2 ONLY',
      isolationFix: 'Renamed from /profile to /p2-profile to avoid URL collision',
    });
  }

  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const photoListRef = useRef<FlatList>(null);

  // Stand Out limits from discover store (shared with discovery card)
  const standOutsRemaining = useDiscoverStore((s) => s.standOutsRemaining);
  const hasReachedStandOutLimit = useDiscoverStore((s) => s.hasReachedStandOutLimit);
  const incrementStandOuts = useDiscoverStore((s) => s.incrementStandOuts);

  // P0-001 FIX: Watch for Stand Out result from stand-out screen
  // When user sends a Stand Out message, this effect handles the API call
  const standOutResult = useInteractionStore((s) => s.standOutResult);

  // Phase-2 swipe mutation (must be declared before useEffect that uses it)
  const swipeMutation = useMutation(api.privateSwipes.swipe);

  useEffect(() => {
    if (!standOutResult || !profileUserId || !currentUserId) return;
    // Only handle if this is for our profile
    if (standOutResult.profileId !== profileUserId) return;

    // Clear the result immediately to prevent re-processing
    useInteractionStore.getState().setStandOutResult(null);

    const sendStandOut = async () => {
      try {
        if (__DEV__) {
          console.log('[P2_FULL_PROFILE_STANDOUT] Sending stand out', {
            profileId: profileUserId?.slice?.(-8),
            hasMessage: !!standOutResult.message,
          });
        }

        const result = await swipeMutation({
          authUserId: currentUserId,
          toUserId: profileUserId as any,
          action: 'super_like',
          message: standOutResult.message || undefined,
        });

        // Increment stand out count
        incrementStandOuts();

        if (result?.isMatch) {
          router.push(
            `/(main)/match-celebration?matchId=${result.matchId}&userId=${profileUserId}&mode=phase2&conversationId=${result.conversationId || ''}` as any
          );
        } else {
          Toast.show('Stand Out sent! They will see your message.');
          router.back();
        }
      } catch (error: any) {
        console.warn('[P2_FULL_PROFILE_STANDOUT] Error:', error?.message);
        Toast.show("Couldn't send Stand Out. Please try again.");
      }
    };

    sendStandOut();
  }, [standOutResult, profileUserId, currentUserId, router, incrementStandOuts, swipeMutation]);

  // Phase-2 profile query
  const profile = useQuery(
    api.privateDiscover.getProfileByUserId,
    !isDemoMode && profileUserId && currentUserId
      ? { userId: profileUserId as any, viewerAuthUserId: currentUserId }
      : 'skip'
  );

  // Phase-2 per-photo blur model (viewer-facing): blur only if enabled AND this slot is marked blurred
  const photoBlurEnabled = profile?.photoBlurEnabled === true;
  const photoBlurSlots: boolean[] = Array.isArray(profile?.photoBlurSlots) ? profile.photoBlurSlots : [];

  // ═══════════════════════════════════════════════════════════════════════════
  // P0 HOOK ORDER FIX: ALL HOOKS MUST BE DECLARED BEFORE EARLY RETURNS
  // These hooks were previously after the early returns, causing React error:
  // "Rendered more hooks than during the previous render"
  // ═══════════════════════════════════════════════════════════════════════════

  // Photo navigation hooks (safe even when profile is null)
  const photos = profile?.photos || [];
  const hasMultiplePhotos = photos.length > 1;

  const goNextPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    const nextIndex = currentPhotoIndex + 1;
    if (nextIndex >= photos.length) return;
    setCurrentPhotoIndex(nextIndex);
    photoListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
  }, [photos.length, currentPhotoIndex]);

  const goPrevPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    const prevIndex = currentPhotoIndex - 1;
    if (prevIndex < 0) return;
    setCurrentPhotoIndex(prevIndex);
    photoListRef.current?.scrollToIndex({ index: prevIndex, animated: true });
  }, [photos.length, currentPhotoIndex]);

  // Tap feedback animations (Reanimated hooks)
  const leftTapScale = useSharedValue(1);
  const rightTapScale = useSharedValue(1);

  const leftTapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftTapScale.value }],
    opacity: leftTapScale.value < 1 ? 0.85 : 1,
  }));

  const rightTapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightTapScale.value }],
    opacity: rightTapScale.value < 1 ? 0.85 : 1,
  }));

  const onLeftPressIn = useCallback(() => {
    leftTapScale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  }, [leftTapScale]);

  const onLeftPressOut = useCallback(() => {
    leftTapScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  }, [leftTapScale]);

  const onRightPressIn = useCallback(() => {
    rightTapScale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  }, [rightTapScale]);

  const onRightPressOut = useCallback(() => {
    rightTapScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  }, [rightTapScale]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EARLY RETURNS (safe now - all hooks declared above)
  // ═══════════════════════════════════════════════════════════════════════════

  // [P2_PROFILE_MAPPED_DATA] Debug logging for full profile data from query
  if (__DEV__ && profile) {
    console.log('[P2_PROFILE_MAPPED_DATA]', {
      userId: profile.userId?.slice?.(-8),
      displayName: profile.displayName,
      // Bio
      hasBio: !!profile.bio,
      bioLength: profile.bio?.length ?? 0,
      // INTERESTS - KEY DATA PATH
      hobbiesFromQuery: profile.hobbies,
      hobbiesCount: profile.hobbies?.length ?? 0,
      activitiesFromQuery: profile.activities,
      activitiesCount: profile.activities?.length ?? 0,
      interestsWillRender: (profile.hobbies?.length ?? 0) > 0 || (profile.activities?.length ?? 0) > 0,
      // Other sections
      intentKeysCount: profile.intentKeys?.length ?? 0,
      promptAnswersCount: profile.promptAnswers?.length ?? 0,
      hasLifestyle: !!(profile.height || profile.smoking || profile.drinking),
    });
  }

  // Loading state
  if (profile === undefined) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  // Profile not found or blocked
  if (profile === null) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={styles.emptyContainer}>
          <Ionicons name="person-outline" size={64} color={C.textLight} />
          <Text style={styles.emptyTitle}>Profile not available</Text>
          <Text style={styles.emptySubtitle}>
            This profile may have been removed or is not accessible
          </Text>
        </View>
      </View>
    );
  }

  const profileDistanceKm = (profile as { distanceKm?: number }).distanceKm;

  // Handle like action
  const handleLike = async () => {
    if (!currentUserId || !profileUserId) return;

    if (__DEV__) {
      console.log('[P2_FULL_PROFILE_ACTION] action=like userId=' + profileUserId?.slice?.(-8));
    }

    try {
      const result = await swipeMutation({
        authUserId: currentUserId,
        toUserId: profileUserId as any,
        action: 'like',
      });

      if (result?.isMatch) {
        // P2-ISOLATION-FIX: Pass conversationId to prevent Phase 1 API fallback
        router.push(
          `/(main)/match-celebration?matchId=${result.matchId}&userId=${profileUserId}&mode=phase2&conversationId=${result.conversationId}` as any
        );
      } else {
        Toast.show('Liked! They will see it in their likes.');
        router.back();
      }
    } catch (error: any) {
      console.warn('[P2_FULL_PROFILE] Like error:', error?.message);
      Toast.show("Couldn't like. Please try again.");
    }
  };

  // Handle pass action
  const handlePass = async () => {
    if (!currentUserId || !profileUserId) return;

    if (__DEV__) {
      console.log('[P2_FULL_PROFILE_ACTION] action=pass userId=' + profileUserId?.slice?.(-8));
    }

    try {
      await swipeMutation({
        authUserId: currentUserId,
        toUserId: profileUserId as any,
        action: 'pass',
      });
      router.back();
    } catch (error: any) {
      console.warn('[P2_FULL_PROFILE] Pass error:', error?.message);
    }
  };

  // Handle Stand Out action - navigates to same Stand Out screen as discovery card
  const handleStandOut = () => {
    if (!profile || !profileUserId) return;
    if (hasReachedStandOutLimit()) {
      Toast.show('No Stand Outs remaining today');
      return;
    }

    if (__DEV__) {
      console.log('[P2_FULL_PROFILE_ACTION] action=super_like userId=' + profileUserId?.slice?.(-8));
    }

    // Navigate to Stand Out screen (same as discovery card flow)
    // P0-001 FIX: Include mode=phase2 to ensure Phase-2 swipe mutation is used
    // P0-002 FIX: Use displayName only (no name/nickname fallback)
    const profileName = profile.displayName || 'Someone';
    const standOutsLeft = standOutsRemaining();
    router.push(
      `/(main)/stand-out?profileId=${profileUserId}&name=${encodeURIComponent(profileName)}&standOutsLeft=${standOutsLeft}&mode=phase2` as any
    );
  };

  // P2-004: Using centralized getGenderIcon from lib/genderIcon.ts

  // Render photo carousel item with conditional blur
  const renderPhotoItem = ({ item, index }: { item: { url: string }; index: number }) => (
    <Image
      source={{ uri: item.url }}
      style={styles.heroPhoto}
      contentFit="cover"
      blurRadius={photoBlurEnabled && photoBlurSlots[index] ? 15 : 0}
    />
  );

  // Get intent info
  const getIntentInfo = (key: string) => {
    return PRIVATE_INTENT_CATEGORIES.find((c) => c.key === key);
  };

  // Get desire tag info
  const getDesireTagLabel = (key: string) => {
    return PRIVATE_DESIRE_TAGS.find((t) => t.key === key)?.label || key;
  };

  // Get hobby/interest info with emoji
  const getHobbyInfo = (key: string) => {
    const activity = ACTIVITY_FILTERS.find((a) => a.value === key);
    return activity ? { label: activity.label, emoji: activity.emoji } : { label: key, emoji: '' };
  };

  // Get lifestyle items as array for chip display
  const getLifestyleItems = () => {
    const items: { icon: string; label: string }[] = [];
    const heightStr = cmToFeetInches(profile.height);
    if (heightStr) items.push({ icon: 'resize-outline', label: heightStr });
    if (profile.smoking) {
      const smokingLabels: Record<string, string> = {
        never: 'Non-smoker', socially: 'Social smoker', regularly: 'Smoker'
      };
      items.push({ icon: 'flame-outline', label: smokingLabels[profile.smoking] || profile.smoking });
    }
    if (profile.drinking) {
      const drinkingLabels: Record<string, string> = {
        never: "Doesn't drink", socially: 'Drinks socially', regularly: 'Drinks regularly'
      };
      items.push({ icon: 'wine-outline', label: drinkingLabels[profile.drinking] || profile.drinking });
    }
    return items;
  };

  return (
    <View style={styles.container}>
      {/* ANDROID FIX: Add top safe area padding so photo doesn't overlap status bar */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ═══════════════════════════════════════════════════════════════════
            HERO PHOTO SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        <View style={styles.heroSection}>
          {photos.length > 0 ? (
            <>
              <FlatList
                ref={photoListRef}
                data={photos}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                renderItem={renderPhotoItem}
                keyExtractor={(item, i) => `photo_${i}`}
                onMomentumScrollEnd={(e) => {
                  const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                  setCurrentPhotoIndex(index);
                }}
                scrollEnabled={hasMultiplePhotos}
              />

              {/* TAP ZONES FOR PHOTO NAVIGATION (matches Discovery card UX) */}
              {/* PREMIUM UX: Animated tap feedback with subtle scale */}
              {hasMultiplePhotos && (
                <>
                  {/* Left tap zone = previous photo */}
                  <Animated.View style={[styles.photoTapZoneLeft, leftTapStyle]}>
                    <Pressable
                      style={StyleSheet.absoluteFill}
                      onPress={goPrevPhoto}
                      onPressIn={onLeftPressIn}
                      onPressOut={onLeftPressOut}
                    />
                  </Animated.View>
                  {/* Right tap zone = next photo */}
                  <Animated.View style={[styles.photoTapZoneRight, rightTapStyle]}>
                    <Pressable
                      style={StyleSheet.absoluteFill}
                      onPress={goNextPhoto}
                      onPressIn={onRightPressIn}
                      onPressOut={onRightPressOut}
                    />
                  </Animated.View>
                </>
              )}

              {/* Photo indicators */}
              {hasMultiplePhotos && (
                <View style={styles.photoIndicators}>
                  {photos.map((_: { _id: string; url: string }, i: number) => (
                    <View
                      key={i}
                      style={[
                        styles.photoIndicator,
                        i === currentPhotoIndex && styles.photoIndicatorActive,
                      ]}
                    />
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={styles.noPhotoPlaceholder}>
              <Ionicons name="person" size={80} color={C.textLight} />
            </View>
          )}

          {/* Gradient overlay at bottom of photo */}
          <View style={styles.heroGradient} />

          {/* Back button */}
          <TouchableOpacity
            style={[styles.backButton, { top: 10 }]}
            onPress={() => router.back()}
          >
            <View style={styles.backButtonBg}>
              <Ionicons name="arrow-back" size={22} color="#FFF" />
            </View>
          </TouchableOpacity>
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            IDENTITY SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        <View style={styles.identitySection}>
          {/* P0-002 FIX: Use displayName only */}
          <View style={styles.nameRow}>
            <Text style={styles.nameText}>{profile.displayName}</Text>
            {typeof profile.age === 'number' && profile.age > 0 ? (
              <Text style={styles.ageText}>, {profile.age}</Text>
            ) : null}
            <Ionicons
              name={getGenderIcon(profile.gender) as any}
              size={20}
              color={C.textLight}
              style={styles.genderIcon}
            />
            {profile.isVerified && (
              <Ionicons name="checkmark-circle" size={20} color={C.primary} style={styles.verifiedIcon} />
            )}
          </View>
          {profile.city && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={16} color={C.textLight} />
              <Text style={styles.locationText}>{profile.city}</Text>
            </View>
          )}
          {typeof profileDistanceKm === 'number' && profileDistanceKm >= 0 && (
            <View style={styles.locationRow}>
              <Text style={styles.locationText}>
                {profileDistanceKm < 1 ? '< 1 km away' : `${profileDistanceKm} km away`}
              </Text>
            </View>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            ABOUT SECTION (Bio with proper heading)
        ═══════════════════════════════════════════════════════════════════ */}
        {profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            LOOKING FOR (INTENTIONS) SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        {profile.intentKeys && profile.intentKeys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Looking For</Text>
            <View style={styles.intentChipsRow}>
              {profile.intentKeys.map((key: string, i: number) => {
                const intent = getIntentInfo(key);
                if (!intent) return null;
                return (
                  <View
                    key={i}
                    style={[styles.intentChip, { borderColor: intent.color + '60' }]}
                  >
                    <Ionicons name={intent.icon as any} size={16} color={intent.color} />
                    <Text style={[styles.intentChipText, { color: intent.color }]}>
                      {intent.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            DESIRES SECTION (max 4 tags for premium feel)
        ═══════════════════════════════════════════════════════════════════ */}
        {profile.desireTagKeys && profile.desireTagKeys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Desires</Text>
            <View style={styles.tagsRow}>
              {/* Deep Connect UI: Show max 4 desire tags */}
              {profile.desireTagKeys.slice(0, 4).map((key: string, i: number) => (
                <View key={i} style={styles.desireTag}>
                  <Text style={styles.desireTagText}>{getDesireTagLabel(key)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PROMPTS SECTION (exactly 2 prompts: first two valid answers)
        ═══════════════════════════════════════════════════════════════════ */}
        {profile.promptAnswers && profile.promptAnswers.length > 0 && (() => {
          const validPrompts = profile.promptAnswers.filter(
            (p: { answer: string }) => p.answer && p.answer.trim().length > 0
          );
          if (validPrompts.length === 0) return null;

          const displayPrompts = validPrompts.slice(0, 2);

          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About Them</Text>
              {displayPrompts.map((prompt: { promptId: string; question: string; answer: string }, i: number) => (
                <View key={prompt.promptId || i} style={styles.promptCard}>
                  <Text style={styles.promptQuestion}>{prompt.question}</Text>
                  <Text style={styles.promptAnswer}>{prompt.answer}</Text>
                </View>
              ))}
            </View>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════════════
            LIFESTYLE SECTION (height, smoking, drinking) - Premium chips
        ═══════════════════════════════════════════════════════════════════ */}
        {(() => {
          const lifestyleItems = getLifestyleItems();
          if (lifestyleItems.length === 0) return null;
          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Lifestyle</Text>
              <View style={styles.lifestyleChipsRow}>
                {lifestyleItems.map((item, i) => (
                  <View key={i} style={styles.lifestyleChip}>
                    <Ionicons name={item.icon as any} size={14} color={C.textLight} />
                    <Text style={styles.lifestyleChipText}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════════════
            HOBBIES & INTERESTS SECTION (max 6 for premium feel)
        ═══════════════════════════════════════════════════════════════════ */}
        {(() => {
          // Try hobbies first, fall back to activities
          const interests = profile.hobbies?.length > 0 ? profile.hobbies : profile.activities;

          // [P2_PROFILE_INTERESTS_RENDER] Debug logging
          if (__DEV__) {
            const willRender = interests && interests.length > 0;
            console.log('[P2_PROFILE_INTERESTS_RENDER]', {
              hasHobbies: !!profile.hobbies,
              hobbiesCount: profile.hobbies?.length ?? 0,
              hasActivities: !!profile.activities,
              activitiesCount: profile.activities?.length ?? 0,
              usingSource: profile.hobbies?.length > 0 ? 'hobbies' : 'activities',
              willRender,
              interestsToShow: willRender ? interests.slice(0, 6) : [],
            });
          }

          if (!interests || interests.length === 0) return null;

          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Interests</Text>
              <View style={styles.tagsRow}>
                {/* Deep Connect UI: Show max 6 interests with emojis */}
                {interests.slice(0, 6).map((hobby: string, i: number) => {
                  const info = getHobbyInfo(hobby);
                  return (
                    <View key={i} style={styles.hobbyTag}>
                      {info.emoji && <Text style={styles.hobbyEmoji}>{info.emoji}</Text>}
                      <Text style={styles.hobbyTagText}>{info.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════════════
            BOTTOM SPACER: Ensures content is visible above floating action buttons
            Height = button height (60) + vertical padding (16+16) + safe area + extra
        ═══════════════════════════════════════════════════════════════════ */}
        {(() => {
          const FLOATING_CLUSTER_HEIGHT = 60; // Largest button height
          const FLOATING_CLUSTER_PADDING = 32; // Top + bottom padding around buttons
          const EXTRA_BREATHING_ROOM = 20;
          const bottomPadding = FLOATING_CLUSTER_HEIGHT + FLOATING_CLUSTER_PADDING + Math.max(insets.bottom, 16) + EXTRA_BREATHING_ROOM;

          if (__DEV__) {
            console.log('[P2_PROFILE_BOTTOM_PADDING]', {
              clusterHeight: FLOATING_CLUSTER_HEIGHT,
              clusterPadding: FLOATING_CLUSTER_PADDING,
              insetsBottom: insets.bottom,
              extraRoom: EXTRA_BREATHING_ROOM,
              totalPadding: bottomPadding,
            });
          }

          return <View style={{ height: bottomPadding }} />;
        })()}
      </ScrollView>

      {/* ═══════════════════════════════════════════════════════════════════
          FLOATING ACTION BUTTONS (Pass / Stand Out / Like)
          Premium floating cluster with micro-interactions
          - NO rectangular background
          - Soft shadows for depth
          - Spring scale on press
      ═══════════════════════════════════════════════════════════════════ */}
      <FloatingActionButtons
        onPass={handlePass}
        onStandOut={handleStandOut}
        onLike={handleLike}
        standOutsRemaining={standOutsRemaining()}
        standOutDisabled={hasReachedStandOutLimit()}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: C.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 8,
  },

  // Hero photo section
  heroSection: {
    width: SCREEN_WIDTH,
    height: PHOTO_HEIGHT,
    position: 'relative',
  },
  heroPhoto: {
    width: SCREEN_WIDTH,
    height: PHOTO_HEIGHT,
    backgroundColor: C.surface,
  },
  noPhotoPlaceholder: {
    width: SCREEN_WIDTH,
    height: PHOTO_HEIGHT,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
    backgroundColor: 'transparent',
    // Simple fade effect using background
  },
  photoIndicators: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 4,
    zIndex: 10,
  },
  photoIndicator: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 2,
  },
  photoIndicatorActive: {
    backgroundColor: '#FFF',
  },
  // TAP ZONES FOR PHOTO NAVIGATION (invisible, full height)
  photoTapZoneLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '40%',
    zIndex: 5,
  },
  photoTapZoneRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '40%',
    zIndex: 5,
  },
  backButton: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
  },
  backButtonBg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Identity section
  identitySection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  nameText: {
    fontSize: 28,
    fontWeight: '700',
    color: C.text,
  },
  ageText: {
    fontSize: 24,
    fontWeight: '400',
    color: C.text,
  },
  genderIcon: {
    marginLeft: 10,
  },
  verifiedIcon: {
    marginLeft: 6,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  locationText: {
    fontSize: 15,
    color: C.textLight,
  },

  // Sections
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  bioText: {
    fontSize: 16,
    color: C.text,
    lineHeight: 24,
  },

  // Intent chips
  intentChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  intentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  intentChipText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Desire tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  desireTag: {
    backgroundColor: C.primary + '20',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.primary + '40',
  },
  desireTagText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.primary,
  },

  // Prompt cards
  promptCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  promptQuestion: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 8,
  },
  promptAnswer: {
    fontSize: 16,
    color: C.text,
    lineHeight: 24,
  },

  // Hobby tags
  hobbyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  hobbyEmoji: {
    fontSize: 14,
  },
  hobbyTagText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.text,
  },

  // Lifestyle section - premium chip style
  lifestyleChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  lifestyleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.accent,
  },
  lifestyleChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.text,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHOTO ACCESS: Styles for photo privacy feature
  // ═══════════════════════════════════════════════════════════════════════════
  photoAccessOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAccessContent: {
    alignItems: 'center',
    padding: 24,
  },
  photoAccessTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 12,
  },
  photoAccessSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
    textAlign: 'center',
  },
  photoAccessRequestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 20,
  },
  photoAccessRequestButtonPending: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  photoAccessRequestText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
