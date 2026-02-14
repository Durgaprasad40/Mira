import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS, PROFILE_PROMPT_QUESTIONS } from '@/lib/constants';
import { computeIntentCompat, getIntentCompatColor, getIntentMismatchWarning } from '@/lib/intentCompat';
import { getTrustBadges } from '@/lib/trustBadges';
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
import { useConfessPreviewStore } from '@/stores/confessPreviewStore';

// Gender labels for "Looking for" display
const GENDER_LABELS: Record<string, string> = {
  male: 'Men',
  female: 'Women',
  non_binary: 'Non-binary',
  lesbian: 'Women',
  other: 'Everyone',
};

export default function ViewProfileScreen() {
  const { id: userId, mode, confessionId, receiverId } = useLocalSearchParams<{
    id: string;
    mode?: string;
    confessionId?: string;
    receiverId?: string;
  }>();
  const isPhase2 = mode === 'phase2';
  const isConfessPreview = mode === 'confess_preview';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { userId: currentUserId } = useAuthStore();
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showReportBlock, setShowReportBlock] = useState(false);

  // Confess preview: mark as used on successful screen mount (one-time only)
  const markPreviewUsed = useConfessPreviewStore((s) => s.markPreviewUsed);
  const previewMarkedRef = useRef(false);

  useEffect(() => {
    if (isConfessPreview && confessionId && receiverId && !previewMarkedRef.current) {
      // Mark preview as used now that screen has successfully opened
      markPreviewUsed(confessionId, receiverId);
      previewMarkedRef.current = true;
    }
  }, [isConfessPreview, confessionId, receiverId, markPreviewUsed]);

  // Phase-1: Use users.getUserById
  const convexPhase1Profile = useQuery(
    api.users.getUserById,
    !isDemoMode && !isPhase2 && userId && currentUserId
      ? { userId: userId as any, viewerId: currentUserId as any }
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

  const swipe = useMutation(api.likes.swipe);

  const demoLikes = useDemoStore((s) => s.likes);
  const simulateMatch = useDemoStore((s) => s.simulateMatch);

  const handleSwipe = async (action: 'like' | 'pass' | 'super_like') => {
    if (!currentUserId || !userId) return;

    if (isDemoMode) {
      if (action === 'pass') {
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
        router.push(`/(main)/match-celebration?matchId=${matchId}&userId=${userId}${modeParam}` as any);
      } else {
        // Regular like on someone NOT in our likes list — small random chance of instant match
        if (Math.random() > 0.7) {
          simulateMatch(userId);
          const matchId = `match_${userId}`;
          const modeParam = isPhase2 ? '&mode=phase2' : '';
          router.push(`/(main)/match-celebration?matchId=${matchId}&userId=${userId}${modeParam}` as any);
        } else {
          router.back();
        }
      }
      return;
    }

    try {
      const result = await swipe({
        fromUserId: currentUserId as any,
        toUserId: userId as any,
        action,
      });

      if (result.isMatch) {
        router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${userId}` as any);
      } else {
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

      {profile.photos && profile.photos.length > 0 ? (
        <FlatList
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          snapToAlignment="start"
          decelerationRate="fast"
          snapToInterval={screenWidth}
          disableIntervalMomentum
          data={profile.photos}
          keyExtractor={(item, index) => item._id || `photo-${index}`}
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
                blurRadius={isPhase2 ? 20 : 0}
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

      {profile.photos && profile.photos.length > 1 && (
        <View style={styles.photoIndicators}>
          {profile.photos.map((_: any, index: number) => (
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
          {profile.distance !== undefined && (
            <Text style={styles.distance}>{profile.distance} mi away</Text>
          )}
        </View>

        {/* Trust Badges - includes verification status */}
        {(() => {
          const badges = getTrustBadges({
            isVerified: profile.isVerified,
            lastActive: (profile as any).lastActive,
            photoCount: profile.photos?.length,
            bio: profile.bio,
          });
          // Filter out the "Verified" badge from getTrustBadges since we show it separately
          const otherBadges = badges.filter((b) => b.key !== 'verified');
          const visible = otherBadges.slice(0, 2); // Show 2 other badges max
          const overflow = otherBadges.length - 2;

          // Verification badge: both verified and unverified show green check (per product decision)
          const verificationBadge = {
            label: profile.isVerified ? 'Verified' : 'Unverified',
            color: '#22C55E', // Green for both states
            icon: 'checkmark-circle' as const,
          };

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
        {!isPhase2 && (() => {
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
        {!isPhase2 && profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bio}>{profile.bio}</Text>
          </View>
        )}

        {/* Profile Prompts - Phase-1 ONLY */}
        {!isPhase2 && profile.profilePrompts && profile.profilePrompts.length > 0 && (
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
        {(() => {
          const myActivities: string[] = isDemoMode ? getDemoCurrentUser().activities : [];
          const shared = (profile.activities || []).filter((a: string) => myActivities.includes(a));
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

        {/* Interests - Both phases (Phase-2 shows above in different section) */}
        {!isPhase2 && profile.activities && profile.activities.length > 0 && (
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
        {!isPhase2 && (profile.height ||
          profile.smoking ||
          profile.drinking ||
          profile.education ||
          profile.jobTitle) && (
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
            </View>
          </View>
        )}

        {/* Action Buttons - Hidden in confess_preview mode */}
        {isConfessPreview ? (
          <View style={styles.previewOnlyBanner}>
            <Ionicons name="eye-outline" size={18} color={COLORS.textMuted} />
            <Text style={styles.previewOnlyText}>View Only — One-time preview</Text>
          </View>
        ) : (
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
