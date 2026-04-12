/**
 * SwipeGuidanceHint - First-time swipe instruction overlay
 *
 * Shows subtle swipe hint on first entry to discover screen.
 * Auto-fades after ~1.8s. Non-blocking, no interaction required.
 *
 * UI-ONLY: Uses local ref to track shown state (session-only).
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';

interface SwipeGuidanceHintProps {
  visible: boolean;
  onDismiss: () => void;
  /** Phase-2 (dark) mode */
  dark?: boolean;
}

export function SwipeGuidanceHint({
  visible,
  onDismiss,
  dark = false,
}: SwipeGuidanceHintProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (visible && !hasStartedRef.current) {
      hasStartedRef.current = true;

      // Entry animation (delayed slightly to let user see the card first)
      opacity.value = withDelay(
        400,
        withTiming(1, { duration: 250, easing: Easing.out(Easing.cubic) })
      );
      translateY.value = withDelay(
        400,
        withTiming(0, { duration: 250, easing: Easing.out(Easing.cubic) })
      );

      // Auto-dismiss after 1.8s total (400ms delay + 1.4s display)
      opacity.value = withDelay(
        1800,
        withTiming(0, { duration: 300, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished) {
            runOnJS(onDismiss)();
          }
        })
      );
    }
  }, [visible, opacity, translateY, onDismiss]);

  // Reset when hidden
  useEffect(() => {
    if (!visible) {
      hasStartedRef.current = false;
      opacity.value = 0;
      translateY.value = 10;
    }
  }, [visible, opacity, translateY]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  const C = dark ? INCOGNITO_COLORS : COLORS;

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={[styles.container, dark && styles.containerDark, containerStyle]}>
        {/* Swipe Right */}
        <View style={styles.hintRow}>
          <View style={[styles.iconCircle, styles.iconCircleRight]}>
            <Ionicons name="heart" size={18} color="#4CAF50" />
          </View>
          <Text style={[styles.hintText, dark && styles.hintTextDark]}>
            Swipe right to connect
          </Text>
        </View>

        {/* Divider */}
        <View style={[styles.divider, dark && styles.dividerDark]} />

        {/* Swipe Left */}
        <View style={styles.hintRow}>
          <View style={[styles.iconCircle, styles.iconCircleLeft]}>
            <Ionicons name="close" size={18} color="#FF6B6B" />
          </View>
          <Text style={[styles.hintText, dark && styles.hintTextDark]}>
            Swipe left to pass
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    bottom: 140,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  containerDark: {
    backgroundColor: 'rgba(40, 40, 40, 0.95)',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleRight: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  iconCircleLeft: {
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
  },
  hintText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  hintTextDark: {
    color: INCOGNITO_COLORS.text,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 10,
  },
  dividerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
});

export default SwipeGuidanceHint;
