import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import { Button, Avatar } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { FlatList } from 'react-native';

export default function ViewProfileScreen() {
  const { id: userId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userId: currentUserId } = useAuthStore();
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  const profile = useQuery(
    api.users.getUserById,
    userId && currentUserId
      ? { userId: userId as any, viewerId: currentUserId as any }
      : 'skip'
  );

  const swipe = useMutation(api.likes.swipe);

  const handleSwipe = async (action: 'like' | 'pass' | 'super_like') => {
    if (!currentUserId || !userId) return;

    try {
      const result = await swipe({
        fromUserId: currentUserId as any,
        toUserId: userId as any,
        action,
      });

      if (result.isMatch) {
        Alert.alert('🎉 It\'s a Match!', 'You matched with this person!', [
          { text: 'Send Message', onPress: () => router.push('/(main)/(tabs)/messages') },
          { text: 'Keep Swiping', onPress: () => router.back() },
        ]);
      } else {
        router.back();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to swipe');
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
        {profile.isVerified && (
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        )}
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

        {profile.bio && (
          <View style={styles.section}>
            <Text style={styles.bio}>{profile.bio}</Text>
          </View>
        )}

        {profile.relationshipIntent && profile.relationshipIntent.length > 0 && (
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
          </View>
        )}

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
          >
            <Ionicons name="close" size={28} color={COLORS.pass} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.superLikeButton]}
            onPress={() => handleSwipe('super_like')}
          >
            <Ionicons name="star" size={28} color={COLORS.superLike} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.likeButton]}
            onPress={() => handleSwipe('like')}
          >
            <Ionicons name="heart" size={28} color={COLORS.like} />
          </TouchableOpacity>
        </View>
      </View>
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
