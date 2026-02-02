import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;
const MAX_VISIBLE_LIKES = 5;

export default function LikesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  const convexLikes = useQuery(
    api.likes.getLikesReceived,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const swipeMutation = useMutation(api.likes.swipe);

  const demoLikes = isDemoMode
    ? DEMO_PROFILES.slice(0, 8).map((p, i) => ({
        likeId: `demo_like_${i}`,
        userId: p._id,
        action: i % 4 === 0 ? 'super_like' : 'like',
        message: null,
        createdAt: Date.now() - 1000 * 60 * 60 * (i + 1),
        name: p.name,
        age: p.age,
        photoUrl: p.photos[0]?.url,
        distance: p.distance,
        isBlurred: true,
        isSuperLike: i % 4 === 0,
      }))
    : null;

  const allLikes = (isDemoMode ? demoLikes : convexLikes) || [];
  // Cap at MAX_VISIBLE_LIKES
  const likes = allLikes.slice(0, MAX_VISIBLE_LIKES) as any[];
  const totalCount = allLikes.length;

  const handleLikeBack = async (like: any) => {
    if (isDemoMode) {
      Alert.alert("It's a Match!", `You and ${like.name} liked each other!`);
      return;
    }

    try {
      const result = await swipeMutation({
        fromUserId: userId as any,
        toUserId: like.userId as any,
        action: 'like' as any,
      });
      if (result?.isMatch) {
        router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${like.userId}`);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to like back');
    }
  };

  const handleIgnore = async (like: any) => {
    if (isDemoMode) return;

    try {
      await swipeMutation({
        fromUserId: userId as any,
        toUserId: like.userId as any,
        action: 'pass' as any,
      });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to ignore');
    }
  };

  const renderLikeCard = ({ item: like }: { item: any }) => {
    return (
      <View style={styles.card}>
        {/* Blurred photo */}
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: like.photoUrl || 'https://via.placeholder.com/150' }}
            style={styles.cardImage}
            blurRadius={25}
          />
          {like.isSuperLike && (
            <View style={styles.standOutBadge}>
              <Ionicons name="star" size={14} color="#2196F3" />
            </View>
          )}
          {/* Distance badge */}
          {like.distance && (
            <View style={styles.distanceBadge}>
              <Text style={styles.distanceBadgeText}>{like.distance.toFixed(0)} km</Text>
            </View>
          )}
        </View>

        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>
            {like.name}, {like.age}
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.ignoreBtn}
            onPress={() => handleIgnore(like)}
          >
            <Ionicons name="close" size={20} color="#F44336" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.likeBackBtn}
            onPress={() => handleLikeBack(like)}
          >
            <Ionicons name="heart" size={20} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {totalCount} {totalCount === 1 ? 'person' : 'people'} liked you
        </Text>
        <View style={styles.placeholder} />
      </View>

      <FlatList
        data={likes}
        numColumns={2}
        keyExtractor={(item, index) => `like-${item.userId}-${index}`}
        renderItem={renderLikeCard}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.columnWrapper}
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
  listContent: {
    padding: 16,
  },
  columnWrapper: {
    gap: 12,
    marginBottom: 12,
  },
  card: {
    flex: 1,
    maxWidth: CARD_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  imageContainer: {
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: CARD_WIDTH * 1.3,
    backgroundColor: COLORS.border,
  },
  standOutBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 5,
  },
  distanceBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  distanceBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.white,
  },
  cardInfo: {
    padding: 10,
    paddingBottom: 6,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  cardActions: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 8,
  },
  ignoreBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#F44336',
    backgroundColor: COLORS.background,
  },
  likeBackBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
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
