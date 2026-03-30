/**
 * AnimatedPressable - Pressable with scale feedback animation
 *
 * Provides smooth press-in/press-out scale animation for buttons.
 * Uses react-native-reanimated for 60fps performance.
 *
 * UI-ONLY: No logic changes, just visual feedback.
 */
import React, { useCallback } from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { ANIMATION_DURATION, ANIMATION_SCALE, ANIMATION_EASING } from '@/lib/animations';

interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Scale when pressed (default: 0.97) */
  pressedScale?: number;
  /** Animation duration in ms (default: 120) */
  duration?: number;
  /** Disable animation */
  disableAnimation?: boolean;
}

export function AnimatedPressable({
  children,
  style,
  onPressIn,
  onPressOut,
  pressedScale = ANIMATION_SCALE.buttonPressed,
  duration = ANIMATION_DURATION.fast,
  disableAnimation = false,
  disabled,
  ...props
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = useCallback(
    (e: any) => {
      if (!disableAnimation && !disabled) {
        scale.value = withTiming(pressedScale, {
          duration,
          easing: ANIMATION_EASING.pressIn,
        });
      }
      onPressIn?.(e);
    },
    [disableAnimation, disabled, pressedScale, duration, onPressIn, scale]
  );

  const handlePressOut = useCallback(
    (e: any) => {
      if (!disableAnimation && !disabled) {
        scale.value = withTiming(ANIMATION_SCALE.buttonReleased, {
          duration,
          easing: ANIMATION_EASING.pressOut,
        });
      }
      onPressOut?.(e);
    },
    [disableAnimation, disabled, duration, onPressOut, scale]
  );

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        style={style}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        {...props}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export default AnimatedPressable;
