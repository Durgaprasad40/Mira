import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

interface SwipeOverlayProps {
  direction: 'left' | 'right' | 'up' | null;
  opacity: number | Animated.Value;
}

export function SwipeOverlay({ direction, opacity }: SwipeOverlayProps) {
  if (!direction) return null;
  // Support both static number and Animated.Value
  if (typeof opacity === 'number' && opacity === 0) return null;

  const getConfig = () => {
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
          color: COLORS.warning,
          text: 'SUPER LIKE',
        };
      default:
        return null;
    }
  };

  const config = getConfig();
  if (!config) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <View style={[styles.overlay, { borderColor: config.color }]}>
        <Ionicons name={config.icon} size={48} color={config.color} />
        <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
      </View>
    </Animated.View>
  );
}

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
