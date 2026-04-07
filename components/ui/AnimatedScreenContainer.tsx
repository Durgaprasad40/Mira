/**
 * AnimatedScreenContainer - Screen entry animation wrapper
 *
 * Provides smooth fade-in + slide-up animation when screen mounts.
 * Uses react-native-reanimated for 60fps performance.
 *
 * UI-ONLY: No navigation logic, just visual entry animation.
 */
import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { SCREEN_ENTRY, ANIMATION_EASING } from '@/lib/animations';

interface AnimatedScreenContainerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Delay before animation starts (default: 0) */
  delay?: number;
  /** Disable animation */
  disableAnimation?: boolean;
}

export function AnimatedScreenContainer({
  children,
  style,
  delay = 0,
  disableAnimation = false,
}: AnimatedScreenContainerProps) {
  const opacity = useSharedValue(disableAnimation ? 1 : SCREEN_ENTRY.initialOpacity);
  const translateY = useSharedValue(disableAnimation ? 0 : SCREEN_ENTRY.initialTranslateY);

  useEffect(() => {
    if (disableAnimation) return;

    const timing = {
      duration: SCREEN_ENTRY.duration,
      easing: ANIMATION_EASING.entry,
    };

    if (delay > 0) {
      opacity.value = withDelay(delay, withTiming(SCREEN_ENTRY.finalOpacity, timing));
      translateY.value = withDelay(delay, withTiming(SCREEN_ENTRY.finalTranslateY, timing));
    } else {
      opacity.value = withTiming(SCREEN_ENTRY.finalOpacity, timing);
      translateY.value = withTiming(SCREEN_ENTRY.finalTranslateY, timing);
    }
  }, [disableAnimation, delay, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
      transform: [{ translateY: translateY.value }],
    };
  });

  return (
    <Animated.View style={[{ flex: 1 }, style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

export default AnimatedScreenContainer;
