/**
 * WelcomeOverlay - Post-onboarding welcome screen
 *
 * Lightweight, non-blocking overlay that shows "You're in" after onboarding.
 * Auto-dismisses after ~700ms with smooth fade animations.
 *
 * UI-ONLY: No navigation/API blocking.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';

interface WelcomeOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  /** Phase-2 (dark) mode */
  dark?: boolean;
  /** Title text (default: "You're in") */
  title?: string;
  /** Subtitle text (default: "Welcome to Mira") */
  subtitle?: string;
}

export function WelcomeOverlay({
  visible,
  onDismiss,
  dark = false,
  title = "You're in",
  subtitle = "Welcome to Mira",
}: WelcomeOverlayProps) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.95);
  const iconScale = useSharedValue(0);
  const hasStartedRef = useRef(false);

  const C = dark ? INCOGNITO_COLORS : COLORS;

  useEffect(() => {
    if (visible && !hasStartedRef.current) {
      hasStartedRef.current = true;

      // Entry animation
      opacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
      scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
      iconScale.value = withDelay(
        100,
        withSequence(
          withTiming(1.15, { duration: 180, easing: Easing.out(Easing.back(2)) }),
          withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) })
        )
      );

      // Auto-dismiss after 700ms
      opacity.value = withDelay(
        700,
        withTiming(0, { duration: 250, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished) {
            runOnJS(onDismiss)();
          }
        })
      );
    }
  }, [visible, opacity, scale, iconScale, onDismiss]);

  // Reset when hidden
  useEffect(() => {
    if (!visible) {
      hasStartedRef.current = false;
      opacity.value = 0;
      scale.value = 0.95;
      iconScale.value = 0;
    }
  }, [visible, opacity, scale, iconScale]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  if (!visible) return null;

  return (
    <View style={[styles.overlay, dark && styles.overlayDark]} pointerEvents="none">
      <Animated.View style={[styles.content, containerStyle]}>
        <Animated.View style={[styles.iconContainer, dark && styles.iconContainerDark, iconStyle]}>
          <Ionicons
            name={dark ? 'shield-checkmark' : 'checkmark-circle'}
            size={48}
            color={dark ? INCOGNITO_COLORS.primary : COLORS.primary}
          />
        </Animated.View>
        <Text style={[styles.title, dark && styles.titleDark]}>{title}</Text>
        <Text style={[styles.subtitle, dark && styles.subtitleDark]}>{subtitle}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  overlayDark: {
    backgroundColor: 'rgba(18, 18, 18, 0.98)',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  iconContainerDark: {
    backgroundColor: INCOGNITO_COLORS.primary + '20',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  titleDark: {
    color: INCOGNITO_COLORS.text,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  subtitleDark: {
    color: INCOGNITO_COLORS.textLight,
  },
});

export default WelcomeOverlay;
