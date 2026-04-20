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
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SkeletonCardProps {
  /** Phase-2 (dark) mode */
  dark?: boolean;
  /** Whether to render the bottom action row placeholder */
  includeActions?: boolean;
}

function ShimmerBar({
  width,
  height,
  borderRadius = 8,
  dark = false,
  shimmer,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  dark?: boolean;
  shimmer: SharedValue<number>;
}) {
  const shimmerStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(shimmer.value, [0, 0.5, 1], [0.12, 0.55, 0.12]),
      transform: [{ translateX: interpolate(shimmer.value, [0, 1], [-72, 156]) }],
    };
  });

  const baseColors = dark
    ? ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.04)']
    : ['rgba(255,255,255,0.42)', 'rgba(255,255,255,0.62)', 'rgba(255,255,255,0.4)'];
  const sheenColors = dark
    ? ['rgba(255,255,255,0)', 'rgba(255,255,255,0.26)', 'rgba(255,255,255,0)']
    : ['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'];

  return (
    <View
      style={[
        styles.shimmerBar,
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)',
        },
      ]}
    >
      <LinearGradient
        colors={baseColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.shimmerSheen, shimmerStyle]}>
        <LinearGradient
          colors={sheenColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

export function SkeletonCard({ dark = false, includeActions = true }: SkeletonCardProps) {
  const insets = useSafeAreaInsets();
  const shimmer = useSharedValue(0);

  const cardWidth = SCREEN_WIDTH - 24;
  const cardHeight = cardWidth * 1.35;

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [shimmer]);

  return (
    <View style={[styles.container, dark && styles.containerDark]}>
      {/* Card skeleton */}
      <View style={[styles.card, { width: cardWidth, height: cardHeight }, dark && styles.cardDark]}>
        <LinearGradient
          colors={dark ? ['#0e1220', '#181f34', '#0f1424'] : ['#fff8f3', '#fff1eb', '#fffaf7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Photo area skeleton */}
        <View style={styles.photoArea}>
          <ShimmerBar width="100%" height={cardHeight * 0.7} borderRadius={0} dark={dark} shimmer={shimmer} />
        </View>

        {/* Content area skeleton */}
        <View style={styles.contentArea}>
          {/* Name + Age row */}
          <View style={styles.row}>
            <ShimmerBar width={160} height={24} borderRadius={6} dark={dark} shimmer={shimmer} />
            <ShimmerBar width={40} height={24} borderRadius={6} dark={dark} shimmer={shimmer} />
          </View>

          {/* Location */}
          <View style={[styles.row, { marginTop: 8 }]}>
            <ShimmerBar width={16} height={16} borderRadius={8} dark={dark} shimmer={shimmer} />
            <ShimmerBar width={100} height={16} borderRadius={4} dark={dark} shimmer={shimmer} />
          </View>

          {/* Bio lines */}
          <View style={{ marginTop: 12 }}>
            <ShimmerBar width="90%" height={14} borderRadius={4} dark={dark} shimmer={shimmer} />
            <View style={{ marginTop: 6 }}>
              <ShimmerBar width="70%" height={14} borderRadius={4} dark={dark} shimmer={shimmer} />
            </View>
          </View>

          {/* Tags */}
          <View style={[styles.row, { marginTop: 14, gap: 8 }]}>
            <ShimmerBar width={70} height={28} borderRadius={14} dark={dark} shimmer={shimmer} />
            <ShimmerBar width={85} height={28} borderRadius={14} dark={dark} shimmer={shimmer} />
            <ShimmerBar width={60} height={28} borderRadius={14} dark={dark} shimmer={shimmer} />
          </View>
        </View>
      </View>

      {includeActions && (
        <View style={[styles.actionRow, { paddingBottom: insets.bottom + 12 }]}>
          <ShimmerBar width={56} height={56} borderRadius={28} dark={dark} shimmer={shimmer} />
          <ShimmerBar width={64} height={64} borderRadius={32} dark={dark} shimmer={shimmer} />
          <ShimmerBar width={56} height={56} borderRadius={28} dark={dark} shimmer={shimmer} />
        </View>
      )}
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
  shimmerBar: {
    overflow: 'hidden',
  },
  shimmerSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -72,
    width: 88,
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
