import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { ProfileCard, SwipeOverlay } from '../../../components/cards';
import { FilterModal } from '../../../components/filters';
import { ProfileQuickMenu } from '../../../components/profile';
import { useAuthStore, useFilterStore, useSubscriptionStore } from '../../../stores';
import { COLORS, SWIPE_CONFIG } from '../../../lib/constants';
import type { Profile } from '../../../types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD_X = SCREEN_WIDTH * SWIPE_CONFIG.SWIPE_THRESHOLD_X; // 30%
const SWIPE_THRESHOLD_Y = SCREEN_HEIGHT * SWIPE_CONFIG.SWIPE_THRESHOLD_Y; // 20%

type SortOption = 'recommended' | 'distance' | 'age' | 'recently_active' | 'newest';

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const { filters, setFilters, sortBy, setSortBy } = useFilterStore();
  const { isPremium } = useSubscriptionStore();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sortByLocal, setSortByLocal] = useState<SortOption>(sortBy);
  const [showFilters, setShowFilters] = useState(false);
  const [rewindAvailable, setRewindAvailable] = useState(true);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const lastSwipedProfile = useRef<Profile | null>(null);

  // Fetch profiles
  const profiles = useQuery(
    api.discover.getDiscoverProfiles,
    userId
      ? {
          userId,
          sortBy: sortByLocal,
          limit: 20,
        }
      : 'skip'
  );

  // Mutations
  const swipe = useMutation(api.likes.swipe);

  // Animation values
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotation = useSharedValue(0);
  const cardScale = useSharedValue(1);

  const currentProfile = profiles?.[currentIndex];
  const nextProfile = profiles?.[currentIndex + 1];

  const resetPosition = useCallback(() => {
    'worklet';
    translateX.value = withSpring(0, { damping: 15 });
    translateY.value = withSpring(0, { damping: 15 });
    rotation.value = withSpring(0, { damping: 15 });
    cardScale.value = withSpring(1, { damping: 15 });
  }, []);

  const handleSwipe = useCallback(
    async (direction: 'left' | 'right' | 'up') => {
      if (!currentProfile || !userId) return;

      const action =
        direction === 'left' ? 'pass' : direction === 'up' ? 'super_like' : 'like';

      try {
        const result = await swipe({
          fromUserId: userId,
          toUserId: currentProfile.id as any,
          action: action as any,
        });

        lastSwipedProfile.current = currentProfile;

        // If match, navigate to celebration screen
        if (result.isMatch) {
          router.push(
            `/(main)/match-celebration?matchId=${result.matchId}&userId=${currentProfile.id}`
          );
        } else {
          // Move to next profile
          setCurrentIndex((prev) => prev + 1);
        }
      } catch (error: any) {
        Alert.alert('Error', error.message || 'Failed to swipe');
      }
    },
    [currentProfile, userId, swipe]
  );

  const animateSwipe = useCallback(
    (direction: 'left' | 'right' | 'up') => {
      'worklet';
      const targetX =
        direction === 'left' ? -SCREEN_WIDTH * 1.5 : direction === 'right' ? SCREEN_WIDTH * 1.5 : 0;
      const targetY = direction === 'up' ? -SCREEN_HEIGHT * 1.5 : 0;

      translateX.value = withTiming(targetX, { duration: 300 }, () => {
        runOnJS(handleSwipe)(direction);
        translateX.value = 0;
        translateY.value = 0;
        rotation.value = 0;
      });
      translateY.value = withTiming(targetY, { duration: 300 });
    },
    [handleSwipe]
  );

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
      rotation.value = interpolate(
        event.translationX,
        [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
        [-15, 0, 15],
        Extrapolation.CLAMP
      );

      // Haptic feedback at threshold
      if (Math.abs(event.translationX) > SWIPE_THRESHOLD_X && Math.abs(event.translationY) < 50) {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      }
      if (event.translationY < -SWIPE_THRESHOLD_Y && Math.abs(event.translationX) < 50) {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
      }
    })
    .onEnd((event) => {
      if (event.translationX < -SWIPE_THRESHOLD_X) {
        animateSwipe('left');
        runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
      } else if (event.translationX > SWIPE_THRESHOLD_X) {
        animateSwipe('right');
        runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
      } else if (event.translationY < -SWIPE_THRESHOLD_Y) {
        animateSwipe('up');
        runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
      } else {
        resetPosition();
      }
    });

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotation.value}deg` },
      { scale: cardScale.value },
    ],
  }));

  const nextCardAnimatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      Math.abs(translateX.value),
      [0, SCREEN_WIDTH / 2],
      [0.95, 1],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale }],
    };
  });

  const likeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, SCREEN_WIDTH / 4],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  const nopeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SCREEN_WIDTH / 4, 0],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));

  const superlikeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [-SCREEN_HEIGHT / 6, 0],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));

  const rewindMutation = useMutation(api.likes.rewind);

  const handleRewind = useCallback(async () => {
    if (!userId || !lastSwipedProfile.current) {
      Alert.alert('Rewind', 'No recent swipe to undo');
      return;
    }

    try {
      const result = await rewindMutation({
        userId: userId as any,
      });

      if (result.success) {
        // Move back to previous profile
        if (currentIndex > 0) {
          setCurrentIndex(currentIndex - 1);
        }
        lastSwipedProfile.current = null;
        // Don't show alert, just silently rewind
        // The UI will update automatically via queries
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to rewind');
    }
  }, [userId, currentIndex, rewind]);

  if (!profiles) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (profiles.length === 0 || currentIndex >= profiles.length) {
    return (
      <View style={[styles.container, styles.emptyContainer]}>
        <Text style={styles.emptyTitle}>No more profiles</Text>
        <Text style={styles.emptySubtitle}>Check back later for new matches!</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => setShowFilters(true)}
        >
          <Text style={styles.headerButtonText}>☰ Sort</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Discover</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIcon}
            onPress={() => router.push('/(main)/notifications')}
          >
            <Text style={styles.headerIconText}>🔔</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIcon}
            onPress={() => router.push('/(main)/likes')}
          >
            <Text style={styles.headerIconText}>❤️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIcon}
            onPress={() => setShowQuickMenu(true)}
          >
            <Text style={styles.headerIconText}>👤</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Profile Cards */}
      <View style={styles.cardsContainer}>
        {nextProfile && (
          <View style={[styles.nextCard, nextCardAnimatedStyle]}>
            <ProfileCard profile={nextProfile} isFirst={false} />
          </View>
        )}
        {currentProfile && (
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.currentCard, cardAnimatedStyle]}>
              <ProfileCard profile={currentProfile} isFirst={true} />
              <SwipeOverlay translateX={translateX} translateY={translateY} />
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.rewindButton]}
          onPress={handleRewind}
          disabled={!rewindAvailable}
        >
          <Text style={styles.actionIcon}>↶</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.passButton]}
          onPress={() => handleSwipe('left')}
        >
          <Text style={styles.actionIcon}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.superLikeButton]}
          onPress={() => handleSwipe('up')}
        >
          <Text style={styles.actionIcon}>⭐</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.likeButton]}
          onPress={() => handleSwipe('right')}
        >
          <Text style={styles.actionIcon}>❤️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.messageButton]}
          onPress={() => {
            if (currentProfile) {
              router.push(`/(main)/chat/${currentProfile.id}`);
            }
          }}
        >
          <Text style={styles.actionIcon}>💬</Text>
        </TouchableOpacity>
      </View>

      <FilterModal
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        sortBy={sortByLocal}
        onApply={(newFilters, newSortBy) => {
          setFilters(newFilters);
          setSortByLocal(newSortBy);
          setShowFilters(false);
        }}
        isPremium={isPremium}
      />

      <ProfileQuickMenu
        visible={showQuickMenu}
        onClose={() => setShowQuickMenu(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerButton: {
    padding: 8,
  },
  headerButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 12,
  },
  headerIcon: {
    padding: 4,
  },
  headerIconText: {
    fontSize: 20,
  },
  cardsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  currentCard: {
    position: 'absolute',
    width: SCREEN_WIDTH - 40,
    height: SCREEN_HEIGHT * 0.65,
  },
  nextCard: {
    position: 'absolute',
    width: SCREEN_WIDTH - 40,
    height: SCREEN_HEIGHT * 0.65,
    zIndex: 0,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  rewindButton: {
    backgroundColor: COLORS.warning + '20',
  },
  passButton: {
    backgroundColor: COLORS.pass + '20',
  },
  superLikeButton: {
    backgroundColor: COLORS.superLike + '20',
  },
  likeButton: {
    backgroundColor: COLORS.like + '20',
  },
  messageButton: {
    backgroundColor: COLORS.secondary + '20',
  },
  actionIcon: {
    fontSize: 24,
  },
});
