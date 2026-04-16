/**
 * PHASE-2 LIKES SCREEN
 *
 * Dedicated likes page for Phase-2 (Deep Connect) matching Phase-1 UX:
 * - 2-column grid layout
 * - Blurred photo cards with name/age
 * - Like-back and ignore action buttons
 *
 * STRICT ISOLATION: Only uses Phase-2 queries (privateSwipes.getIncomingLikes)
 * CONTRACT FIX: Uses authUserId pattern (not token)
 */
import React, { useState, useEffect, useCallback } from 'react';
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
import { getGenderIcon } from '@/lib/genderIcon';
import { PHASE2_BLUR_LIKE_CARD } from '@/lib/phase2UI';

const C = INCOGNITO_COLORS;
const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

export default function Phase2LikesScreen() {
  useScreenTrace('P2_LIKES_PAGE');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  // P0-AUTH-FIX: Wait for Convex auth identity to be ready before running queries
  const authReady = useAuthStore((s) => s.authReady);

  // P0-AUTH-CRASH-FIX: Simple gating - requires userId + authReady
  const isAuthReadyForQueries = !!(userId && authReady);
  const isAuthWarming = !isAuthReadyForQueries;

  // P2-003: Error and retry state
  const [retryKey, setRetryKey] = useState(0);
  const [hasError, setHasError] = useState(false);

  // Phase-2 incoming likes query
  // CONTRACT FIX: Uses authUserId (not userId as Id)
  const incomingLikes = useQuery(
    api.privateSwipes.getIncomingLikes,
    isAuthReadyForQueries && userId ? { authUserId: userId, refreshKey: retryKey } : 'skip'
  );

  // P2-003: Query states
  const isLoading = !hasError && (isAuthWarming || incomingLikes === undefined);

  // P2-003: Error detection - timeout after 15s of loading
  useEffect(() => {
    if (!isAuthReadyForQueries) {
      setHasError(false);
      return;
    }

    if (incomingLikes !== undefined) {
      setHasError((prev) => (prev ? false : prev));
      return;
    }

    const timeout = setTimeout(() => {
      setHasError(true);
      if (__DEV__) {
        console.warn('[P2_LIKES_PAGE] Query timeout - showing error state');
      }
    }, 15000);

    return () => clearTimeout(timeout);
  }, [incomingLikes, retryKey, isAuthReadyForQueries]);

  // P2-003: Retry handler
  const handleRetry = useCallback(() => {
    setHasError(false);
    setRetryKey((k) => k + 1);
  }, []);

  // Phase-2 swipe mutation (like-back triggers match)
  const swipeMutation = useMutation(api.privateSwipes.swipe);

  // Handle like-back (triggers match creation)
  // CONTRACT FIX: Uses authUserId instead of token
  const handleLikeBack = async (like: any) => {
    if (!userId) {
      Toast.show('Please sign in again to continue.');
      return;
    }

    try {
      const result = await swipeMutation({
        authUserId: userId,
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
        router.push(
          `/(main)/match-celebration?matchId=${result.matchId}&userId=${like.fromUserId}&mode=phase2&conversationId=${result.conversationId}` as any
        );
      } else {
        Toast.show('Liked! Keep swiping to find more matches.');
      }
    } catch (error: any) {
      console.warn('[P2_LIKES_PAGE] Like-back error:', error?.message);
      Toast.show("Couldn't like back. Please try again.");
    }
  };

  // Handle ignore/pass
  // CONTRACT FIX: Uses authUserId instead of token
  const handleIgnore = async (like: any) => {
    if (!userId) {
      Toast.show('Please sign in again to continue.');
      return;
    }

    try {
      await swipeMutation({
        authUserId: userId,
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
    router.push(`/(main)/(private)/p2-profile/${like.fromUserId}` as any);
  };

  // Render individual like card (matching Phase-1 pattern)
  const renderLikeCard = ({ item: like }: { item: any }) => {
    const isSuperLike = like.action === 'super_like';
    const genderIcon = getGenderIcon(like.profile?.gender);
    const photoBlurEnabled = like.profile?.photoBlurEnabled === true;
    const photoBlurSlots: boolean[] | undefined = Array.isArray(like.profile?.photoBlurSlots)
      ? like.profile.photoBlurSlots
      : undefined;
    const shouldBlurMainPhoto = photoBlurEnabled && Boolean(photoBlurSlots?.[0]);

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
              blurRadius={shouldBlurMainPhoto ? PHASE2_BLUR_LIKE_CARD : 0}
            />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Ionicons
                name={like.profile?.hasPrivatePhotos ? 'lock-closed' : 'image-outline'}
                size={34}
                color={C.textLight}
              />
              <Text style={styles.cardImagePlaceholderTitle}>
                {like.profile?.hasPrivatePhotos ? 'Private photo hidden' : 'No private photo yet'}
              </Text>
              <Text style={styles.cardImagePlaceholderSubtitle}>
                {like.profile?.hasPrivatePhotos
                  ? 'Open their profile to request access if you match.'
                  : 'Their preview will show up here once they add one.'}
              </Text>
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

      {/* P2-003: Loading state */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>
            {isAuthWarming ? 'Connecting securely...' : 'Loading likes...'}
          </Text>
        </View>
      )}

      {/* P2-003: Error state with retry */}
      {hasError && (
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={64} color={C.textLight} />
          <Text style={styles.errorTitle}>Couldn't load likes</Text>
          <Text style={styles.errorSubtitle}>
            Please check your connection and try again
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Likes grid */}
      {!isLoading && !hasError && (
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
                When someone likes you in Deep Connect, they'll appear here
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
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: C.textLight,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    marginTop: 16,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
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
    paddingHorizontal: 16,
    gap: 8,
  },
  cardImagePlaceholderTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  cardImagePlaceholderSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: C.textLight,
    textAlign: 'center',
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
