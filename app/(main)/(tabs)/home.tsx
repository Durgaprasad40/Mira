import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { PanGestureHandler } from 'react-native-gesture-handler';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS, SWIPE_CONFIG } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { ProfileCard } from '@/components/cards/ProfileCard';
import { Button } from '@/components/ui';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function DiscoverScreen() {
  const { userId } = useAuthStore();
  const [index, setIndex] = useState(0);

  const profiles = useQuery(
    api.discover.getDiscoverProfiles,
    userId ? { userId: userId as any, sortBy: 'recommended', limit: 20 } : 'skip'
  );

  const swipeMutation = useMutation(api.likes.swipe);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotateZ = useSharedValue(0);

  const current = profiles && profiles[index];

  const remainingCount = profiles ? profiles.length - index - (current ? 0 : 1) : 0;

  const resetPosition = () => {
    'worklet';
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    rotateZ.value = withSpring(0);
  };

  const goNext = () => {
    setIndex((prev) => prev + 1);
    translateX.value = 0;
    translateY.value = 0;
    rotateZ.value = 0;
  };

  const handleSwipeAction = async (action: 'like' | 'pass' | 'super_like') => {
    if (!userId || !current) return;
    try {
      await swipeMutation({
        fromUserId: userId as any,
        toUserId: current.id,
        action,
      });
    } catch (e) {
      // swallow for now; TODO: show toast
    }
    goNext();
  };

  const gestureHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: any) => {
      ctx.startX = translateX.value;
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx: any) => {
      translateX.value = ctx.startX + event.translationX;
      translateY.value = ctx.startY + event.translationY;
      rotateZ.value = (translateX.value / SCREEN_WIDTH) * SWIPE_CONFIG.ROTATION_ANGLE;
    },
    onEnd: (event) => {
      const dx = event.translationX;
      const dy = event.translationY;
      const thresholdX = SCREEN_WIDTH * SWIPE_CONFIG.SWIPE_THRESHOLD_X;
      const thresholdY = SCREEN_HEIGHT * SWIPE_CONFIG.SWIPE_THRESHOLD_Y;

      if (dx > thresholdX) {
        // Like
        translateX.value = withSpring(SCREEN_WIDTH * 1.5, {}, () => {
          runOnJS(handleSwipeAction)('like');
        });
        return;
      }

      if (dx < -thresholdX) {
        // Pass
        translateX.value = withSpring(-SCREEN_WIDTH * 1.5, {}, () => {
          runOnJS(handleSwipeAction)('pass');
        });
        return;
      }

      if (dy < -thresholdY) {
        // Super Like
        translateY.value = withSpring(-SCREEN_HEIGHT, {}, () => {
          runOnJS(handleSwipeAction)('super_like');
        });
        return;
      }

      resetPosition();
    },
  });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      {
        rotateZ: `${rotateZ.value}deg`,
      },
    ],
  }));

  if (!userId) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Discover</Text>
        <Text style={styles.subtitle}>Log in to see people near you.</Text>
      </View>
    );
  }

  if (!profiles) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>You’re all caught up</Text>
        <Text style={styles.subtitle}>
          Check back later for more recommendations.
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <Text style={styles.headerSubtitle}>
          {remainingCount > 0
            ? `${remainingCount + 1} profiles today`
            : 'Few profiles left for today'}
        </Text>
      </View>

      <View style={styles.cardContainer}>
        <PanGestureHandler onGestureEvent={gestureHandler}>
          <Animated.View style={[styles.cardWrapper, cardStyle]}>
            <ProfileCard
              name={current.name}
              age={current.age}
              bio={current.bio}
              city={current.city}
              isVerified={current.isVerified}
              distance={current.distance}
              photos={current.photos}
            />
          </Animated.View>
        </PanGestureHandler>
      </View>

      <View style={styles.actions}>
        <Button
          title="Pass"
          variant="outline"
          onPress={() => handleSwipeAction('pass')}
          style={styles.actionButton}
        />
        <Button
          title="Super Like"
          variant="secondary"
          onPress={() => handleSwipeAction('super_like')}
          style={styles.actionButton}
        />
        <Button
          title="Like"
          variant="primary"
          onPress={() => handleSwipeAction('like')}
          style={styles.actionButton}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  header: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  cardContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  cardWrapper: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.65,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 4,
  },
});


