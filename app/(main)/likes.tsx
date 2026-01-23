import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Avatar, Badge } from '@/components/ui';
import { useAuthStore, useSubscriptionStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
// Note: expo-blur may not be available, using alternative blur effect

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 3;

export default function LikesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const { isPremium } = useSubscriptionStore();
  const [sortBy, setSortBy] = useState<'recent' | 'distance' | 'active'>('recent');

  const likes = useQuery(
    api.likes.getLikesReceived,
    userId ? { userId } : 'skip'
  );

  const renderLikeCard = (like: any, index: number) => {
    const isBlurred = !isPremium && index >= 3;
    const isVisible = isPremium || index < 3;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          if (isBlurred) {
            // Show upgrade prompt
            router.push('/(main)/subscription');
          } else {
            router.push(`/(main)/profile/${like.userId}`);
          }
        }}
        activeOpacity={0.8}
      >
        {isBlurred ? (
          <View style={styles.blurredCard}>
            <View style={styles.blurOverlay}>
              <Ionicons name="lock-closed" size={32} color={COLORS.white} />
              <Text style={styles.blurredText}>Subscribe to see</Text>
            </View>
            <Image
              source={{ uri: like.photoUrl || 'https://via.placeholder.com/150' }}
              style={styles.cardImage}
              blurRadius={20}
            />
          </View>
        ) : (
          <>
            <Image
              source={{ uri: like.photoUrl || 'https://via.placeholder.com/150' }}
              style={styles.cardImage}
            />
            {like.isSuperLike && (
              <View style={styles.superLikeBadge}>
                <Ionicons name="star" size={16} color={COLORS.superLike} />
              </View>
            )}
          </>
        )}

        <View style={styles.cardInfo}>
          {isBlurred ? (
            <>
              <Text style={styles.blurredName}>???</Text>
              <Text style={styles.blurredAge}>??</Text>
              <Text style={styles.blurredDistance}>?? mi</Text>
            </>
          ) : (
            <>
              <Text style={styles.cardName} numberOfLines={1}>
                {like.name}
              </Text>
              <Text style={styles.cardAge}>{like.age}</Text>
              {like.distance && (
                <Text style={styles.cardDistance}>{like.distance.toFixed(1)} mi</Text>
              )}
            </>
          )}
        </View>

        {!isBlurred && (
          <TouchableOpacity
            style={styles.viewButton}
            onPress={() => router.push(`/(main)/profile/${like.userId}`)}
          >
            <Text style={styles.viewButtonText}>View</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const visibleLikes = likes?.filter((_, i) => isPremium || i < 3) || [];
  const blurredCount = likes && !isPremium ? Math.max(0, likes.length - 3) : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {likes?.length || 0} {likes?.length === 1 ? 'person has' : 'people have'} liked you
        </Text>
        <View style={styles.placeholder} />
      </View>

      {blurredCount > 0 && (
        <View style={styles.upgradeBanner}>
          <LinearGradient
            colors={[COLORS.primary, COLORS.secondary]}
            style={styles.upgradeGradient}
          >
            <Ionicons name="lock-closed" size={24} color={COLORS.white} />
            <View style={styles.upgradeContent}>
              <Text style={styles.upgradeTitle}>
                Subscribe to see all {likes?.length} likes
              </Text>
              <Text style={styles.upgradeSubtitle}>
                {blurredCount} more {blurredCount === 1 ? 'person' : 'people'} liked you
              </Text>
            </View>
            <TouchableOpacity
              style={styles.upgradeButton}
              onPress={() => router.push('/(main)/subscription')}
            >
              <Text style={styles.upgradeButtonText}>Unlock</Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>
      )}

      {/* Sort Options */}
      <View style={styles.sortContainer}>
        {(['recent', 'distance', 'active'] as const).map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.sortChip, sortBy === option && styles.sortChipActive]}
            onPress={() => setSortBy(option)}
          >
            <Text
              style={[styles.sortText, sortBy === option && styles.sortTextActive]}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={visibleLikes}
        numColumns={3}
        keyExtractor={(item, index) => `like-${item.userId}-${index}`}
        renderItem={({ item, index }) => renderLikeCard(item, index)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="heart-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No likes yet</Text>
            <Text style={styles.emptySubtitle}>
              Start swiping to get likes!
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    textAlign: 'center',
  },
  placeholder: {
    width: 24,
  },
  upgradeBanner: {
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  upgradeGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  upgradeContent: {
    flex: 1,
  },
  upgradeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 4,
  },
  upgradeSubtitle: {
    fontSize: 13,
    color: COLORS.white,
    opacity: 0.9,
  },
  upgradeButton: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  upgradeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  sortContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sortChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sortChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  sortText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  sortTextActive: {
    color: COLORS.white,
  },
  listContent: {
    padding: 16,
  },
  card: {
    width: CARD_WIDTH,
    marginBottom: 16,
    marginRight: 8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  cardImage: {
    width: '100%',
    height: CARD_WIDTH * 1.3,
    backgroundColor: COLORS.border,
  },
  blurredCard: {
    position: 'relative',
  },
  blurOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  blurredText: {
    fontSize: 12,
    color: COLORS.white,
    fontWeight: '600',
    marginTop: 8,
  },
  superLikeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 4,
  },
  cardInfo: {
    padding: 8,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  blurredName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
    marginBottom: 2,
  },
  cardAge: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  blurredAge: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  cardDistance: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  blurredDistance: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  viewButton: {
    marginTop: 4,
    paddingVertical: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 100,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});
