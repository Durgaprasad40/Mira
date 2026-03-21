import React from 'react';
import { View, Text, StyleSheet, Animated as RNAnimated } from 'react-native';
import Animated, { useAnimatedStyle, SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

interface SwipeOverlayProps {
  direction: 'left' | 'right' | 'up' | null;
  opacity: SharedValue<number> | number | RNAnimated.Value;
}

// Type guard to check if opacity is a Reanimated SharedValue
// Uses .modify method presence (SharedValue-specific) to avoid reading .value during render
function isSharedValue(value: any): value is SharedValue<number> {
  return value !== null && typeof value === 'object' && typeof value.modify === 'function';
}

// Type guard to check if opacity is a React Native Animated.Value
function isAnimatedValue(value: any): value is RNAnimated.Value {
  return value !== null && typeof value === 'object' && '_value' in value;
}

// Inner component for SharedValue opacity (Reanimated)
function ReanimatedOverlay({ direction, opacity }: { direction: 'left' | 'right' | 'up'; opacity: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const config = getConfig(direction);
  if (!config) return null;

  return (
    <Animated.View style={[styles.container, animatedStyle]} pointerEvents="box-none">
      <View style={[styles.overlay, { borderColor: config.color }]} pointerEvents="none">
        <Ionicons name={config.icon} size={48} color={config.color} />
        <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
      </View>
    </Animated.View>
  );
}

// Inner component for React Native Animated.Value opacity
function RNAnimatedOverlay({ direction, opacity }: { direction: 'left' | 'right' | 'up'; opacity: RNAnimated.Value }) {
  const config = getConfig(direction);
  if (!config) return null;

  return (
    <RNAnimated.View style={[styles.container, { opacity }]} pointerEvents="box-none">
      <View style={[styles.overlay, { borderColor: config.color }]} pointerEvents="none">
        <Ionicons name={config.icon} size={48} color={config.color} />
        <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
      </View>
    </RNAnimated.View>
  );
}

// Inner component for static number opacity
function StaticOverlay({ direction, opacity }: { direction: 'left' | 'right' | 'up'; opacity: number }) {
  const config = getConfig(direction);
  if (!config) return null;

  return (
    <View style={[styles.container, { opacity }]} pointerEvents="box-none">
      <View style={[styles.overlay, { borderColor: config.color }]} pointerEvents="none">
        <Ionicons name={config.icon} size={48} color={config.color} />
        <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
      </View>
    </View>
  );
}

function getConfig(direction: 'left' | 'right' | 'up') {
  switch (direction) {
    case 'left':
      return {
        icon: 'close' as const,
        color: COLORS.error,
        text: 'NOPE',
      };
    case 'right':
      return {
        icon: 'heart' as const,
        color: COLORS.success,
        text: 'LIKE',
      };
    case 'up':
      return {
        icon: 'star' as const,
        color: '#2196F3',
        text: 'STAND OUT',
      };
    default:
      return null;
  }
}

export const SwipeOverlay = React.memo(function SwipeOverlay({ direction, opacity }: SwipeOverlayProps) {
  if (!direction) return null;

  // Handle static number opacity - return null if zero
  if (typeof opacity === 'number') {
    if (opacity === 0) return null;
    return <StaticOverlay direction={direction} opacity={opacity} />;
  }

  // Handle Reanimated SharedValue
  if (isSharedValue(opacity)) {
    return <ReanimatedOverlay direction={direction} opacity={opacity} />;
  }

  // Handle React Native Animated.Value
  if (isAnimatedValue(opacity)) {
    return <RNAnimatedOverlay direction={direction} opacity={opacity} />;
  }

  return null;
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderWidth: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  text: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 8,
  },
});
