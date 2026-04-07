/**
 * SkeletonCard - Placeholder card during data loading
 *
 * Shows a shimmer effect placeholder that mimics the ProfileCard layout.
 * Provides instant visual feedback while real profiles load.
 *
 * UI-ONLY: No data dependencies.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SkeletonCardProps {
  /** Phase-2 (dark) mode */
  dark?: boolean;
}

function ShimmerBar({
  width,
  height,
  borderRadius = 8,
  dark = false,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  dark?: boolean;
}) {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [shimmer]);

  const shimmerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(shimmer.value, [0, 0.5, 1], [0.3, 0.6, 0.3]);
    return { opacity };
  });

  const baseColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: baseColor,
        },
        shimmerStyle,
      ]}
    />
  );
}

export function SkeletonCard({ dark = false }: SkeletonCardProps) {
  const insets = useSafeAreaInsets();
  const C = dark ? INCOGNITO_COLORS : COLORS;

  const cardWidth = SCREEN_WIDTH - 24;
  const cardHeight = cardWidth * 1.35;

  return (
    <View style={[styles.container, dark && styles.containerDark]}>
      {/* Card skeleton */}
      <View style={[styles.card, { width: cardWidth, height: cardHeight }, dark && styles.cardDark]}>
        {/* Photo area skeleton */}
        <View style={styles.photoArea}>
          <ShimmerBar width="100%" height={cardHeight * 0.7} borderRadius={0} dark={dark} />
        </View>

        {/* Content area skeleton */}
        <View style={styles.contentArea}>
          {/* Name + Age row */}
          <View style={styles.row}>
            <ShimmerBar width={160} height={24} borderRadius={6} dark={dark} />
            <ShimmerBar width={40} height={24} borderRadius={6} dark={dark} />
          </View>

          {/* Location */}
          <View style={[styles.row, { marginTop: 8 }]}>
            <ShimmerBar width={16} height={16} borderRadius={8} dark={dark} />
            <ShimmerBar width={100} height={16} borderRadius={4} dark={dark} />
          </View>

          {/* Bio lines */}
          <View style={{ marginTop: 12 }}>
            <ShimmerBar width="90%" height={14} borderRadius={4} dark={dark} />
            <View style={{ marginTop: 6 }}>
              <ShimmerBar width="70%" height={14} borderRadius={4} dark={dark} />
            </View>
          </View>

          {/* Tags */}
          <View style={[styles.row, { marginTop: 14, gap: 8 }]}>
            <ShimmerBar width={70} height={28} borderRadius={14} dark={dark} />
            <ShimmerBar width={85} height={28} borderRadius={14} dark={dark} />
            <ShimmerBar width={60} height={28} borderRadius={14} dark={dark} />
          </View>
        </View>
      </View>

      {/* Action buttons skeleton */}
      <View style={[styles.actionRow, { paddingBottom: insets.bottom + 12 }]}>
        <ShimmerBar width={56} height={56} borderRadius={28} dark={dark} />
        <ShimmerBar width={64} height={64} borderRadius={32} dark={dark} />
        <ShimmerBar width={56} height={56} borderRadius={28} dark={dark} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  containerDark: {
    backgroundColor: INCOGNITO_COLORS.background,
  },
  card: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardDark: {
    backgroundColor: INCOGNITO_COLORS.surface,
  },
  photoArea: {
    width: '100%',
  },
  contentArea: {
    flex: 1,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingTop: 16,
  },
});

export default SkeletonCard;
