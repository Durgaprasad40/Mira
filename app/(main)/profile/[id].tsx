import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
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
import { DEMO_PROFILES, getDemoCurrentUser } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { ReportBlockModal } from '@/components/security/ReportBlockModal';
import { Toast } from '@/components/ui/Toast';

export default function ViewProfileScreen() {
  const { id: userId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userId: currentUserId } = useAuthStore();
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showReportBlock, setShowReportBlock] = useState(false);

  const convexProfile = useQuery(
    api.users.getUserById,
    !isDemoMode && userId && currentUserId
      ? { userId: userId as any, viewerId: currentUserId as any }
      : 'skip'
  );

  const demoProfile = isDemoMode
    ? (() => {
        const p = DEMO_PROFILES.find((dp) => dp._id === userId);
        if (!p) return null;
        return {
          name: p.name,
          age: p.age,
          bio: p.bio,
          city: p.city,
          isVerified: p.isVerified,
          distance: p.distance,
          photos: p.photos.map((photo, i) => ({ _id: `photo_${i}`, url: photo.url })),
          relationshipIntent: p.relationshipIntent,
          activities: p.activities,
          profilePrompts: (p as any).profilePrompts ?? [],
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

  const profile = isDemoMode ? demoProfile : convexProfile;

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
        router.push(`/(main)/match-celebration?matchId=${matchId}&userId=${userId}` as any);
      } else {
        // Regular like on someone NOT in our likes list — small random chance of instant match
        if (Math.random() > 0.7) {
          simulateMatch(userId);
          const matchId = `match_${userId}`;
          router.push(`/(main)/match-celebration?matchId=${matchId}&userId=${userId}` as any);
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

  if (!profile) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  const age = new Date().getFullYear() - new Date(profile.age || 0).getFullYear();

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {profile.isVerified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          )}
          <TouchableOpacity
            onPress={() => setShowReportBlock(true)}
            style={styles.moreButton}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </View>

      {profile.photos && profile.photos.length > 0 ? (
        <FlatList
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          data={profile.photos}
          keyExtractor={(item, index) => item._id || `photo-${index}`}
          onMomentumScrollEnd={(e) => {
            const index = Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width);
            setCurrentPhotoIndex(index);
          }}
          renderItem={({ item }) => (
            <Image
              source={{ uri: item.url }}
              style={styles.photo}
              contentFit="cover"
            />
          )}
          style={styles.photoCarousel}
        />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Ionicons name="person" size={64} color={COLORS.textLight} />
        </View>
      )}

      {profile.photos && profile.photos.length > 1 && (
        <View style={styles.photoIndicators}>
          {profile.photos.map((_, index) => (
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

        {/* Trust Badges */}
        {(() => {
          const badges = getTrustBadges({
            isVerified: profile.isVerified,
            lastActive: (profile as any).lastActive,
            photoCount: profile.photos?.length,
            bio: profile.bio,
          });
          if (badges.length === 0) return null;
          const visible = badges.slice(0, 3);
          const overflow = badges.length - 3;
          return (
            <View style={styles.trustBadgeRow}>
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

        {profile.bio && (
          <View style={styles.section}>
            <Text style={styles.bio}>{profile.bio}</Text>
          </View>
        )}

        {profile.profilePrompts && profile.profilePrompts.length > 0 && (
          <View style={styles.section}>
            {profile.profilePrompts.slice(0, 3).map((prompt: { question: string; answer: string }, idx: number) => (
              <View key={idx} style={styles.promptCard}>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.promptAnswer}>{prompt.answer}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Shared Interests */}
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

        {profile.relationshipIntent && profile.relationshipIntent.length > 0 && (() => {
          const myIntents: string[] = isDemoMode ? getDemoCurrentUser().relationshipIntent : [];
          const { compat, theirPrimaryLabel, theirPrimaryEmoji } = computeIntentCompat(myIntents, profile.relationshipIntent);
          const compatColor = getIntentCompatColor(compat);
          const warning = getIntentMismatchWarning(compat);
          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Looking for</Text>
              <View style={styles.chips}>
                {profile.relationshipIntent.map((intent) => {
                  const intentData = RELATIONSHIP_INTENTS.find((i) => i.value === intent);
                  return (
                    <View key={intent} style={styles.chip}>
                      <Text style={styles.chipText}>
                        {intentData?.emoji} {intentData?.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {myIntents.length > 0 && (
                <View style={[styles.intentCompatBadge, { backgroundColor: compatColor + '18' }]}>
                  <Text style={[styles.intentCompatText, { color: compatColor }]}>
                    {compat === 'match' ? 'Your intents align' : compat === 'partial' ? 'Possibly compatible' : 'Different intents'}
                  </Text>
                </View>
              )}
              {warning && (
                <View style={styles.intentWarning}>
                  <Ionicons name="information-circle-outline" size={16} color={COLORS.textLight} />
                  <Text style={styles.intentWarningText}>{warning}</Text>
                </View>
              )}
            </View>
          );
        })()}

        {profile.activities && profile.activities.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.chips}>
              {profile.activities.map((activity) => {
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

        {(profile.height ||
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
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  backButton: {
    padding: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moreButton: {
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 16,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    marginLeft: 4,
  },
  photoCarousel: {
    width: '100%',
    height: 500,
  },
  photo: {
    width: 400,
    height: 500,
  },
  photoPlaceholder: {
    width: '100%',
    height: 500,
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
});
