import React, { useEffect, useRef } from 'react';
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
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';
import { Toast } from '@/components/ui/Toast';
import { useDemoStore } from '@/stores/demoStore';

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

  // Demo likes: read from mutable store so removals are reflected immediately
  const storeLikes = useDemoStore((s) => s.likes);
  const addLike = useDemoStore((s) => s.addLike);
  const removeLike = useDemoStore((s) => s.removeLike);
  const simulateMatch = useDemoStore((s) => s.simulateMatch);
  const seededLikesRef = useRef(false);

  // Seed demo likes once — skip if store already has likes (user may have
  // removed some via Like-back / Ignore and we shouldn't re-add them).
  useEffect(() => {
    if (!isDemoMode || seededLikesRef.current || storeLikes.length > 0) return;
    seededLikesRef.current = true;
    const fullSet = DEMO_PROFILES.slice(0, 8);
    const seenIds = new Set<string>();
    for (let i = 0; i < fullSet.length; i++) {
      const p = fullSet[i];
      if (seenIds.has(p._id)) continue; // strict uniqueness guard
      seenIds.add(p._id);
      addLike({
        likeId: `demo_like_${p._id}`,
        userId: p._id,
        action: i % 4 === 0 ? 'super_like' : 'like',
        message: null,
        createdAt: Date.now() - 1000 * 60 * 60 * (i + 1),
        name: p.name,
        age: p.age,
        photoUrl: p.photos[0]?.url ?? '',
        isBlurred: false,
      });
    }
    if (__DEV__) console.log(`[Likes] seeded ${seenIds.size} unique demo likes`);
  }, []);

  // Map store likes to UI shape (add computed fields)
  const demoLikes = isDemoMode
    ? storeLikes.map((l) => ({
        ...l,
        distance: DEMO_PROFILES.find((p) => p._id === l.userId)?.distance,
        isSuperLike: l.action === 'super_like',
      }))
    : null;

  const allLikes = (isDemoMode ? demoLikes : convexLikes) || [];
  // In demo mode show all likes; in live mode cap at MAX_VISIBLE_LIKES.
  // Final dedup guard ensures no duplicate userId rows even if persisted data
  // contains stale duplicates from before the addLike dedup fix.
  const dedupByUserId = (arr: any[]) => {
    const seen = new Set<string>();
    return arr.filter((l: any) => {
      if (seen.has(l.userId)) return false;
      seen.add(l.userId);
      return true;
    });
  };
  const likes = dedupByUserId(isDemoMode ? allLikes : allLikes.slice(0, MAX_VISIBLE_LIKES)) as any[];
  const totalCount = allLikes.length;

  const handleLikeBack = async (like: any) => {
    if (isDemoMode) {
      removeLike(like.userId);
      simulateMatch(like.userId);
      router.push(`/(main)/match-celebration?matchId=demo_match&userId=${like.userId}` as any);
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
    } catch {
      Toast.show('Couldn\u2019t like back. Please try again.');
    }
  };

  const handleIgnore = async (like: any) => {
    if (isDemoMode) {
      removeLike(like.userId);
      return;
    }

    try {
      await swipeMutation({
        fromUserId: userId as any,
        toUserId: like.userId as any,
        action: 'pass' as any,
      });
    } catch {
      Toast.show('Couldn\u2019t skip this person. Please try again.');
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
            blurRadius={like.isBlurred ? 25 : 0}
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
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={20} color="#F44336" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.likeBackBtn}
            onPress={() => handleLikeBack(like)}
            activeOpacity={0.7}
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
    gap: 12,
  },
  ignoreBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#F44336',
    backgroundColor: COLORS.background,
  },
  likeBackBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
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
