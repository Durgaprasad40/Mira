/**
 * PHASE-2 LIKES SCREEN
 *
 * Dedicated likes page for Phase-2 (Desire Land) matching Phase-1 UX:
 * - 2-column grid layout
 * - Blurred photo cards with name/age
 * - Like-back and ignore action buttons
 *
 * STRICT ISOLATION: Only uses Phase-2 queries (privateSwipes.getIncomingLikes)
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { Toast } from '@/components/ui/Toast';
import { useScreenTrace } from '@/lib/devTrace';

const C = INCOGNITO_COLORS;
const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

export default function Phase2LikesScreen() {
  useScreenTrace('P2_LIKES_PAGE');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId, token } = useAuthStore();

  // Phase-2 incoming likes query
  const incomingLikes = useQuery(
    api.privateSwipes.getIncomingLikes,
    userId ? { userId: userId as any } : 'skip'
  );

  // Phase-2 swipe mutation (like-back triggers match)
  const swipeMutation = useMutation(api.privateSwipes.swipe);

  // Handle like-back (triggers match creation)
  // P1-005 FIX: Show proper error when auth is missing instead of silent return
  const handleLikeBack = async (like: any) => {
    if (!token) {
      Toast.show('Please sign in again to continue.');
      return;
    }

    try {
      const result = await swipeMutation({
        token,
        toUserId: like.fromUserId,
        action: 'like',
      });

      if (__DEV__) {
        console.log('[P2_LIKES_PAGE] Like-back result:', {
          fromUserId: like.fromUserId?.slice?.(-8),
          isMatch: result?.isMatch,
          matchId: result?.matchId?.slice?.(-8),
        });
      }

      if (result?.isMatch) {
        // Navigate to match celebration (using shared screen with Phase-2 mode)
        router.push(
          `/(main)/match-celebration?matchId=${result.matchId}&userId=${like.fromUserId}&mode=phase2` as any
        );
      } else {
        // Unlikely - they already liked us, so should be instant match
        Toast.show('Liked! Keep swiping to find more matches.');
      }
    } catch (error: any) {
      console.warn('[P2_LIKES_PAGE] Like-back error:', error?.message);
      Toast.show("Couldn't like back. Please try again.");
    }
  };

  // Handle ignore/pass
  // P1-005 FIX: Show proper error when auth is missing instead of silent return
  const handleIgnore = async (like: any) => {
    if (!token) {
      Toast.show('Please sign in again to continue.');
      return;
    }

    try {
      await swipeMutation({
        token,
        toUserId: like.fromUserId,
        action: 'pass',
      });

      if (__DEV__) {
        console.log('[P2_LIKES_PAGE] Ignored:', like.fromUserId?.slice?.(-8));
      }
    } catch (error: any) {
      console.warn('[P2_LIKES_PAGE] Ignore error:', error?.message);
      Toast.show("Couldn't skip this person. Please try again.");
    }
  };

  // Handle tap on card/photo to open full Phase-2 profile
  const handleOpenProfile = (like: any) => {
    if (__DEV__) {
      console.log('[P2_LIKES_PAGE] Opening profile:', like.fromUserId?.slice?.(-8));
    }
    // Navigate to dedicated Phase-2 full profile (within private route group)
    // OLD WRONG: /(main)/private-profile/[id] or /(main)/profile/[id]
    // NEW CORRECT: /(main)/(private)/profile/[userId]
    router.push(`/(main)/(private)/profile/${like.fromUserId}` as any);
  };

  // Get gender icon based on gender value
  const getGenderIcon = (gender: string | undefined): string => {
    if (!gender) return 'person-outline';
    const g = gender.toLowerCase();
    if (g === 'male' || g === 'm') return 'male';
    if (g === 'female' || g === 'f') return 'female';
    return 'male-female'; // non-binary or other
  };

  // Render individual like card (matching Phase-1 pattern)
  const renderLikeCard = ({ item: like }: { item: any }) => {
    const isSuperLike = like.action === 'super_like';
    const genderIcon = getGenderIcon(like.profile?.gender);

    return (
      <View style={styles.card}>
        {/* Tappable photo with blur - opens full profile */}
        <TouchableOpacity
          style={styles.imageContainer}
          onPress={() => handleOpenProfile(like)}
          activeOpacity={0.85}
        >
          {like.profile?.blurredPhotoUrl ? (
            <Image
              source={{ uri: like.profile.blurredPhotoUrl }}
              style={styles.cardImage}
              contentFit="cover"
              blurRadius={25}
            />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Ionicons name="person" size={48} color={C.textLight} />
            </View>
          )}

          {/* Super like badge */}
          {isSuperLike && (
            <View style={styles.superLikeBadge}>
              <Ionicons name="star" size={14} color="#FFFFFF" />
            </View>
          )}

          {/* City badge */}
          {like.profile?.city && (
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>{like.profile.city}</Text>
            </View>
          )}

          {/* Tap hint overlay */}
          <View style={styles.tapHintOverlay}>
            <Ionicons name="expand-outline" size={16} color="rgba(255,255,255,0.8)" />
          </View>
        </TouchableOpacity>

        {/* Name, age, and gender */}
        <TouchableOpacity
          style={styles.cardInfo}
          onPress={() => handleOpenProfile(like)}
          activeOpacity={0.7}
        >
          <View style={styles.nameRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {like.profile?.displayName || 'Someone'}, {like.profile?.age || '?'}
            </Text>
            <Ionicons name={genderIcon as any} size={14} color={C.textLight} style={styles.genderIcon} />
          </View>
          {isSuperLike && (
            <Text style={styles.superLikeHint}>Super Liked you!</Text>
          )}
        </TouchableOpacity>

        {/* Standout message (if present) */}
        {like.message && (
          <View style={styles.standoutMessageContainer}>
            <Text style={styles.standoutMessageText} numberOfLines={2}>
              "{like.message}"
            </Text>
          </View>
        )}

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
            <Ionicons name="heart" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const totalCount = incomingLikes?.length ?? 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {totalCount} {totalCount === 1 ? 'person' : 'people'} liked you
        </Text>
        <View style={styles.placeholder} />
      </View>

      {/* Loading state */}
      {incomingLikes === undefined && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      )}

      {/* Likes grid */}
      {incomingLikes !== undefined && (
        <FlatList
          data={incomingLikes}
          numColumns={2}
          keyExtractor={(item) => item.likeId}
          renderItem={renderLikeCard}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.columnWrapper}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="heart-outline" size={64} color={C.textLight} />
              <Text style={styles.emptyTitle}>No likes yet</Text>
              <Text style={styles.emptySubtitle}>
                When someone likes you in Desire Land, they'll appear here
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    flex: 1,
    textAlign: 'center',
  },
  placeholder: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 16,
  },
  columnWrapper: {
    gap: 12,
    marginBottom: 12,
  },

  // Card styles (matching Phase-1 pattern)
  card: {
    flex: 1,
    maxWidth: CARD_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  imageContainer: {
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: CARD_WIDTH * 1.3,
    backgroundColor: C.accent,
  },
  cardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  superLikeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.superLike,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  locationBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cardInfo: {
    padding: 10,
    paddingBottom: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    flex: 1,
  },
  genderIcon: {
    marginLeft: 6,
  },
  superLikeHint: {
    fontSize: 11,
    color: COLORS.superLike,
    marginTop: 2,
  },
  tapHintOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12,
    padding: 4,
  },
  standoutMessageContainer: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  standoutMessageText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: C.primary,
    lineHeight: 16,
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
    backgroundColor: C.background,
  },
  likeBackBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: C.primary,
  },

  // Empty state
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
    color: C.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
  },
});
