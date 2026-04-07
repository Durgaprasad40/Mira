import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  SharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SwipeOverlayProps {
  direction: 'left' | 'right' | 'up' | null;
  opacity: SharedValue<number> | number;
  /** Optional: pass panX for position-based opacity interpolation */
  panX?: SharedValue<number>;
  /** Optional: pass panY for position-based opacity interpolation */
  panY?: SharedValue<number>;
  /** When true, uses premium Phase-2 styling */
  dark?: boolean;
}

// Type guard to check if opacity is a Reanimated SharedValue
function isSharedValue(value: any): value is SharedValue<number> {
  return value !== null && typeof value === 'object' && typeof value.modify === 'function';
}

// Premium overlay configuration
const OVERLAY_CONFIG = {
  left: {
    icon: 'close' as const,
    iconColor: '#FFFFFF',
    tintColor: 'rgba(239, 68, 68, 0.35)', // Red tint
    borderColor: 'rgba(239, 68, 68, 0.8)',
    labelColor: '#EF4444',
    label: 'NOPE',
    position: 'topLeft' as const,
  },
  right: {
    icon: 'heart' as const,
    iconColor: '#FFFFFF',
    tintColor: 'rgba(34, 197, 94, 0.35)', // Green tint
    borderColor: 'rgba(34, 197, 94, 0.8)',
    labelColor: '#22C55E',
    label: 'LIKE',
    position: 'topRight' as const,
  },
  up: {
    icon: 'star' as const,
    iconColor: '#FFFFFF',
    tintColor: 'rgba(250, 204, 21, 0.35)', // Gold tint
    borderColor: 'rgba(250, 204, 21, 0.8)',
    labelColor: '#FACC15',
    label: 'STAND OUT',
    position: 'topCenter' as const,
  },
};

// Premium animated overlay with tint effect
function PremiumSwipeOverlay({
  direction,
  opacity,
  dark = false,
}: {
  direction: 'left' | 'right' | 'up';
  opacity: SharedValue<number>;
  dark?: boolean;
}) {
  const config = OVERLAY_CONFIG[direction];

  // Animated style for the full-screen tint
  const tintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      opacity.value,
      [0, 0.3, 1],
      [0, 0.4, 0.85],
      Extrapolation.CLAMP
    ),
  }));

  // Animated style for the icon badge
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      opacity.value,
      [0, 0.2, 0.6],
      [0, 0.5, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        scale: interpolate(
          opacity.value,
          [0, 0.3, 0.7, 1],
          [0.5, 0.8, 1, 1.05],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  // Animated style for the label
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      opacity.value,
      [0, 0.4, 0.8],
      [0, 0.3, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        translateY: interpolate(
          opacity.value,
          [0, 0.5, 1],
          [10, 3, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  // Position styles based on direction
  const getPositionStyle = () => {
    switch (config.position) {
      case 'topLeft':
        return { top: 80, left: 24 };
      case 'topRight':
        return { top: 80, right: 24 };
      case 'topCenter':
        return { top: 80, alignSelf: 'center' as const };
      default:
        return { top: 80, alignSelf: 'center' as const };
    }
  };

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Full-screen color tint overlay */}
      <Animated.View
        style={[
          styles.tintOverlay,
          { backgroundColor: config.tintColor },
          tintStyle,
        ]}
      />

      {/* Icon badge positioned at corner/top */}
      <Animated.View
        style={[
          styles.iconBadge,
          getPositionStyle(),
          { borderColor: config.borderColor },
          dark && styles.iconBadgeDark,
          badgeStyle,
        ]}
      >
        <Ionicons
          name={config.icon}
          size={direction === 'up' ? 36 : 32}
          color={config.labelColor}
        />
      </Animated.View>

      {/* Floating label below badge */}
      <Animated.View
        style={[
          styles.labelContainer,
          getPositionStyle(),
          { marginTop: direction === 'up' ? 150 : 145 },
          labelStyle,
        ]}
      >
        <Text style={[styles.label, { color: config.labelColor }]}>
          {config.label}
        </Text>
      </Animated.View>
    </View>
  );
}

// Fallback component for static number opacity (backward compat)
function StaticSwipeOverlay({
  direction,
  opacity,
  dark = false,
}: {
  direction: 'left' | 'right' | 'up';
  opacity: number;
  dark?: boolean;
}) {
  const config = OVERLAY_CONFIG[direction];
  if (opacity === 0) return null;

  const getPositionStyle = () => {
    switch (config.position) {
      case 'topLeft':
        return { top: 80, left: 24 };
      case 'topRight':
        return { top: 80, right: 24 };
      case 'topCenter':
        return { top: 80, alignSelf: 'center' as const };
      default:
        return { top: 80, alignSelf: 'center' as const };
    }
  };

  return (
    <View style={[styles.container, { opacity }]} pointerEvents="none">
      <View style={[styles.tintOverlay, { backgroundColor: config.tintColor }]} />
      <View
        style={[
          styles.iconBadge,
          getPositionStyle(),
          { borderColor: config.borderColor },
          dark && styles.iconBadgeDark,
        ]}
      >
        <Ionicons
          name={config.icon}
          size={direction === 'up' ? 36 : 32}
          color={config.labelColor}
        />
      </View>
      <View
        style={[
          styles.labelContainer,
          getPositionStyle(),
          { marginTop: direction === 'up' ? 150 : 145 },
        ]}
      >
        <Text style={[styles.label, { color: config.labelColor }]}>
          {config.label}
        </Text>
      </View>
    </View>
  );
}

export const SwipeOverlay = React.memo(function SwipeOverlay({
  direction,
  opacity,
  dark = false,
}: SwipeOverlayProps) {
  if (!direction) return null;

  // Handle static number opacity (backward compatibility)
  if (typeof opacity === 'number') {
    return (
      <StaticSwipeOverlay
        direction={direction}
        opacity={opacity}
        dark={dark}
      />
    );
  }

  // Handle SharedValue opacity (premium animated version)
  if (isSharedValue(opacity)) {
    return (
      <PremiumSwipeOverlay
        direction={direction}
        opacity={opacity}
        dark={dark}
      />
    );
  }

  return null;
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  // Full-screen tint overlay
  tintOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  // Icon badge (positioned at corners/top)
  iconBadge: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconBadgeDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  // Label below icon
  labelContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
