import React, { useEffect } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { COLORS } from '@/lib/constants';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

interface TypingIndicatorProps {
  conversationId: string;
  currentUserId: string;
}

export function TypingIndicator({ conversationId, currentUserId }: TypingIndicatorProps) {
  // In a real app, this would subscribe to real-time typing events
  // For now, we'll use a simple animated component
  const dot1 = React.useRef(new Animated.Value(0.4)).current;
  const dot2 = React.useRef(new Animated.Value(0.4)).current;
  const dot3 = React.useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animateDot = (dot: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.4,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const animations = [
      animateDot(dot1, 0),
      animateDot(dot2, 200),
      animateDot(dot3, 400),
    ];

    animations.forEach((anim) => anim.start());

    return () => {
      animations.forEach((anim) => anim.stop());
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.bubble}>
        <Animated.View style={[styles.dot, { opacity: dot1 }]} />
        <Animated.View style={[styles.dot, { opacity: dot2 }]} />
        <Animated.View style={[styles.dot, { opacity: dot3 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    alignItems: 'flex-start',
  },
  bubble: {
    flexDirection: 'row',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.textLight,
  },
});
