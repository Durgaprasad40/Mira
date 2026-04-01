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
  Dimensions,
  FlatList,
  ActivityIndicator,
} from 'react-native';
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
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';
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

export default function Phase2FullProfileScreen() {
  useScreenTrace('P2_FULL_PROFILE_VIEW');
  const { userId: profileUserId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

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
    if (!standOutResult || !profileUserId || !token) return;
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
          token,
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
  }, [standOutResult, profileUserId, token, router, incrementStandOuts, swipeMutation]);

  // Phase-2 profile query
  const profile = useQuery(
    api.privateDiscover.getProfileByUserId,
    !isDemoMode && profileUserId && currentUserId
      ? { userId: profileUserId as any, viewerId: currentUserId as any }
      : 'skip'
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PHOTO ACCESS: Query and mutation for privacy feature
  // Shows request button when viewing a matched user's blurred photo
  // ═══════════════════════════════════════════════════════════════════════════
  const photoAccessStatus = useQuery(
    api.privatePhotoAccess.getPrivatePhotoAccessStatus,
    profileUserId && currentUserId
      ? { authUserId: currentUserId, ownerUserId: profileUserId as Id<'users'> }
      : 'skip'
  );

  // Query whether the profile owner has blurred photos enabled
  const photoBlurStatus = useQuery(
    api.privatePhotoAccess.isPhotoBlurredForOwner,
    profileUserId
      ? { ownerUserId: profileUserId as Id<'users'> }
      : 'skip'
  );

  const requestPhotoAccessMutation = useMutation(api.privatePhotoAccess.requestPrivatePhotoAccess);
  const [photoAccessRequesting, setPhotoAccessRequesting] = useState(false);

  const handleRequestPhotoAccess = useCallback(async () => {
    if (!profileUserId || !currentUserId || photoAccessRequesting) return;

    setPhotoAccessRequesting(true);
    try {
      const result = await requestPhotoAccessMutation({
        authUserId: currentUserId,
        ownerUserId: profileUserId as Id<'users'>,
      });

      if (result.success) {
        if (__DEV__) console.log('[P2_PROFILE_PhotoAccess] Request sent:', result.status);
        if (result.status === 'already_approved') {
          Toast.show('You already have access to view their photo');
        } else if (result.status === 'already_pending') {
          Toast.show('Request already pending');
        } else {
          Toast.show('Photo access requested');
        }
      } else {
        if (__DEV__) console.log('[P2_PROFILE_PhotoAccess] Request failed:', result.error);
        Toast.show("Couldn't send request. Please try again.");
      }
    } catch (error) {
      if (__DEV__) console.error('[P2_PROFILE_PhotoAccess] Error:', error);
      Toast.show("Couldn't send request. Please try again.");
    } finally {
      setPhotoAccessRequesting(false);
    }
  }, [profileUserId, currentUserId, requestPhotoAccessMutation, photoAccessRequesting]);

  // Determine if photo should show blurred and if request button should be visible
  const isPhotoBlurred = photoBlurStatus?.isBlurred ?? false;
  const canViewClearPhoto = photoAccessStatus?.canViewClear ?? !isPhotoBlurred;
  const photoAccessRequestStatus = photoAccessStatus?.status ?? 'none';
  const showPhotoAccessButton = isPhotoBlurred && !canViewClearPhoto && photoAccessRequestStatus !== 'approved';

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

  // Handle like action
  const handleLike = async () => {
    if (!token || !profileUserId) return;

    if (__DEV__) {
      console.log('[P2_FULL_PROFILE_ACTION] action=like userId=' + profileUserId?.slice?.(-8));
    }

    try {
      const result = await swipeMutation({
        token,
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
    if (!token || !profileUserId) return;

    if (__DEV__) {
      console.log('[P2_FULL_PROFILE_ACTION] action=pass userId=' + profileUserId?.slice?.(-8));
    }

    try {
      await swipeMutation({
        token,
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
      blurRadius={isPhotoBlurred && !canViewClearPhoto ? 15 : 0}
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

  const photos = profile.photos || [];
  const hasMultiplePhotos = photos.length > 1;

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
              />
              {/* Photo indicators */}
              {hasMultiplePhotos && (
                <View style={styles.photoIndicators}>
                  {photos.map((_, i) => (
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

          {/* PHOTO ACCESS: Request button overlay when photo is blurred */}
          {showPhotoAccessButton && (
            <View style={styles.photoAccessOverlay}>
              <View style={styles.photoAccessContent}>
                <Ionicons name="lock-closed" size={24} color="#FFFFFF" />
                <Text style={styles.photoAccessTitle}>Photo is blurred</Text>
                <Text style={styles.photoAccessSubtitle}>
                  Request access to see the clear photo
                </Text>
                <TouchableOpacity
                  style={[
                    styles.photoAccessRequestButton,
                    photoAccessRequestStatus === 'pending' && styles.photoAccessRequestButtonPending,
                  ]}
                  onPress={handleRequestPhotoAccess}
                  disabled={photoAccessRequestStatus === 'pending' || photoAccessRequesting}
                  activeOpacity={0.8}
                >
                  {photoAccessRequesting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons
                        name={photoAccessRequestStatus === 'pending' ? 'time-outline' : 'eye-outline'}
                        size={18}
                        color="#FFFFFF"
                      />
                      <Text style={styles.photoAccessRequestText}>
                        {photoAccessRequestStatus === 'pending' ? 'Request pending' : 'Request access'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

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
            <Text style={styles.ageText}>, {profile.age}</Text>
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
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            BIO SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        {profile.bio && (
          <View style={styles.section}>
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
            DESIRES SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        {profile.desireTagKeys && profile.desireTagKeys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Desires</Text>
            <View style={styles.tagsRow}>
              {profile.desireTagKeys.map((key: string, i: number) => (
                <View key={i} style={styles.desireTag}>
                  <Text style={styles.desireTagText}>{getDesireTagLabel(key)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PROMPTS SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        {profile.promptAnswers && profile.promptAnswers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About Them</Text>
            {profile.promptAnswers.map((prompt: { promptId: string; question: string; answer: string }, i: number) => (
              <View key={prompt.promptId || i} style={styles.promptCard}>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.promptAnswer}>{prompt.answer}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            HOBBIES & INTERESTS SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        {profile.hobbies && profile.hobbies.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.tagsRow}>
              {profile.hobbies.map((hobby: string, i: number) => (
                <View key={i} style={styles.hobbyTag}>
                  <Text style={styles.hobbyTagText}>{hobby}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Bottom spacing for action buttons */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ═══════════════════════════════════════════════════════════════════
          FIXED ACTION BUTTONS (Pass / Stand Out / Like)
          Matches Phase-2 discovery card action layout
      ═══════════════════════════════════════════════════════════════════ */}
      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {/* Pass button */}
        <TouchableOpacity style={styles.passButton} onPress={handlePass} activeOpacity={0.8}>
          <Ionicons name="close" size={28} color="#F44336" />
        </TouchableOpacity>

        {/* Stand Out button (same as discovery card) */}
        <TouchableOpacity
          style={[
            styles.standOutButton,
            hasReachedStandOutLimit() && styles.actionButtonDisabled,
          ]}
          onPress={handleStandOut}
          disabled={hasReachedStandOutLimit()}
          activeOpacity={0.8}
        >
          <Ionicons name="star" size={24} color="#FFF" />
          <View style={styles.standOutBadge}>
            <Text style={styles.standOutBadgeText}>{standOutsRemaining()}</Text>
          </View>
        </TouchableOpacity>

        {/* Like button */}
        <TouchableOpacity style={styles.likeButton} onPress={handleLike} activeOpacity={0.8}>
          <Ionicons name="heart" size={28} color="#FFF" />
        </TouchableOpacity>
      </View>
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
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  hobbyTagText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.text,
  },

  // Action bar (3 buttons: Pass / Stand Out / Like)
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 32,
    gap: 24,
    backgroundColor: C.background,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  passButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F44336',
  },
  standOutButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  standOutBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#2196F3',
  },
  standOutBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2196F3',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  likeButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
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
