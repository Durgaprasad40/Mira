import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  SharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

interface SwipeOverlayProps {
  direction: 'left' | 'right' | 'up' | null;
  opacity: SharedValue<number> | number;
  /** Optional: pass panX for position-based opacity interpolation */
  panX?: SharedValue<number>;
  /** Optional: pass panY for position-based opacity interpolation */
  panY?: SharedValue<number>;
  /**
   * Preserved for API compatibility. The overlay now renders bare icons with
   * a soft glyph shadow that reads on both light Phase-1 and dark Phase-2
   * backgrounds, so this flag no longer alters chrome.
   */
  dark?: boolean;
}

// Type guard to check if opacity is a Reanimated SharedValue
function isSharedValue(value: any): value is SharedValue<number> {
  return value !== null && typeof value === 'object' && typeof value.modify === 'function';
}

// Premium overlay configuration — bare icons (no badge / border / text).
// Positions are intentionally OPPOSITE to the swipe direction so the icon
// stays visible while the card translates away:
//   - right-swipe (heart, green) renders on the LEFT side of the card.
//   - left-swipe  (close,  red) renders on the RIGHT side of the card.
//   - up-swipe    (star,  blue) renders centered over the card.
const OVERLAY_CONFIG = {
  left: {
    icon: 'close' as const,
    iconColor: '#EF4444', // premium red
    position: 'right' as const,
  },
  right: {
    icon: 'heart' as const,
    iconColor: '#22C55E', // premium green
    position: 'left' as const,
  },
  up: {
    icon: 'star' as const,
    iconColor: '#3B82F6', // premium blue
    position: 'center' as const,
  },
};

const ICON_SIZE_HORIZONTAL = 76;
const ICON_SIZE_UP = 92;

// Premium animated overlay with icon-only feedback
function PremiumSwipeOverlay({
  direction,
  opacity,
}: {
  direction: 'left' | 'right' | 'up';
  opacity: SharedValue<number>;
}) {
  const config = OVERLAY_CONFIG[direction];
  const size = direction === 'up' ? ICON_SIZE_UP : ICON_SIZE_HORIZONTAL;

  // Animated icon reveal — opacity ramps in, scale settles slightly above 1.
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      opacity.value,
      [0, 0.12, 0.55],
      [0, 0.65, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        scale: interpolate(
          opacity.value,
          [0, 0.25, 0.7, 1],
          [0.78, 0.92, 1, 1.04],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View
        style={[
          styles.iconWrap,
          getPositionStyle(config.position, size),
          iconStyle,
        ]}
      >
        <Ionicons
          name={config.icon}
          size={size}
          color={config.iconColor}
          style={styles.iconGlyph}
        />
      </Animated.View>
    </View>
  );
}

// Fallback component for static number opacity (backward compat)
function StaticSwipeOverlay({
  direction,
  opacity,
}: {
  direction: 'left' | 'right' | 'up';
  opacity: number;
}) {
  if (opacity === 0) return null;
  const config = OVERLAY_CONFIG[direction];
  const size = direction === 'up' ? ICON_SIZE_UP : ICON_SIZE_HORIZONTAL;

  return (
    <View style={[styles.container, { opacity }]} pointerEvents="none">
      <View style={[styles.iconWrap, getPositionStyle(config.position, size)]}>
        <Ionicons
          name={config.icon}
          size={size}
          color={config.iconColor}
          style={styles.iconGlyph}
        />
      </View>
    </View>
  );
}

// Position style is shared by both Premium (animated) and Static overlays.
// 'left'/'right' anchor the icon to the side opposite the swipe direction so
// it does NOT translate off-screen with the card. 'center' anchors the icon
// to the visual center of the card using top:50% + marginTop offset.
function getPositionStyle(
  position: 'left' | 'right' | 'center',
  size: number,
) {
  switch (position) {
    case 'left':
      return { top: 72, left: 24 };
    case 'right':
      return { top: 72, right: 24 };
    case 'center':
      return {
        top: '50%' as const,
        alignSelf: 'center' as const,
        marginTop: -size / 2,
      };
    default:
      return { top: 72, alignSelf: 'center' as const };
  }
}

export const SwipeOverlay = React.memo(function SwipeOverlay({
  direction,
  opacity,
}: SwipeOverlayProps) {
  if (!direction) return null;

  // Handle static number opacity (backward compatibility)
  if (typeof opacity === 'number') {
    return <StaticSwipeOverlay direction={direction} opacity={opacity} />;
  }

  // Handle SharedValue opacity (premium animated version)
  if (isSharedValue(opacity)) {
    return <PremiumSwipeOverlay direction={direction} opacity={opacity} />;
  }

  return null;
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  // Bare icon wrapper — no chip, no border, no fill. Position-only.
  iconWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Soft drop shadow on the glyph itself keeps the bare icon legible over
  // busy photos / dark Phase-2 backgrounds without re-introducing a circular
  // badge. textShadow* applies to Ionicons glyphs (rendered as text).
  iconGlyph: {
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
});
