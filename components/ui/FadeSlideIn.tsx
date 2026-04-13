/**
 * FadeSlideIn - Moti-powered entrance animation wrapper
 *
 * Provides smooth fade + slide-up entrance for cards, rows, sections.
 * Uses Moti for declarative animation with React Native Reanimated.
 *
 * UI-ONLY: No logic changes, just visual entrance animation.
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { MotiView } from 'moti';
import { ENTRANCE_Y, NORMAL_DURATION, STAGGER_NORMAL } from '@/lib/motion';

interface FadeSlideInProps {
  children: React.ReactNode;
  /** Custom styles for the animated container */
  style?: StyleProp<ViewStyle>;
  /** Delay before animation starts (ms) */
  delay?: number;
  /** Duration of animation (ms) */
  duration?: number;
  /** Vertical offset to slide from (px) */
  fromY?: number;
  /** Horizontal offset to slide from (px) */
  fromX?: number;
  /** Whether to disable animation */
  disabled?: boolean;
}

/**
 * Wraps children with a subtle fade + slide entrance animation.
 *
 * @example
 * <FadeSlideIn delay={100}>
 *   <Card>Content</Card>
 * </FadeSlideIn>
 */
export function FadeSlideIn({
  children,
  style,
  delay = 0,
  duration = NORMAL_DURATION,
  fromY = ENTRANCE_Y,
  fromX = 0,
  disabled = false,
}: FadeSlideInProps) {
  if (disabled) {
    return <>{children}</>;
  }

  return (
    <MotiView
      from={{
        opacity: 0,
        translateY: fromY,
        translateX: fromX,
      }}
      animate={{
        opacity: 1,
        translateY: 0,
        translateX: 0,
      }}
      transition={{
        type: 'timing',
        duration,
        delay,
      }}
      style={style}
    >
      {children}
    </MotiView>
  );
}

/**
 * Helper to generate staggered delays for list items.
 *
 * @example
 * items.map((item, i) => (
 *   <FadeSlideIn key={item.id} delay={getStaggerDelay(i)}>
 *     <ListItem {...item} />
 *   </FadeSlideIn>
 * ))
 */
export function getStaggerDelay(index: number, baseDelay = 0, stagger = STAGGER_NORMAL): number {
  return baseDelay + index * stagger;
}

export default FadeSlideIn;
