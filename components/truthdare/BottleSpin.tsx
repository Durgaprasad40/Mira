/**
 * BottleSpin - Pure visual component for Truth-or-Dare bottle spin animation
 *
 * CONSTRAINTS:
 * - NO store imports
 * - NO game logic
 * - Pure visual component
 *
 * The winner is predetermined by the parent (store decides, not UI).
 * This component only handles the visual animation.
 *
 * LAYOUT:
 * ```
 *        [User 0 Avatar]
 *              ↑
 *         ___________
 *        |           |
 *        |   BOTTLE  |  ← Rotates in center
 *        |___________|
 *              ↓
 *        [User 1 Avatar]
 * ```
 *
 * User 0 is at top (0°), User 1 is at bottom (180°)
 */

import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FONT_SIZE, INCOGNITO_COLORS, SPACING, SIZES, lineHeight, moderateScale } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const TEXT_MAX_SCALE = 1.2;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BottleSpinUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface BottleSpinProps {
  /** The two users playing [top, bottom] */
  users: [BottleSpinUser, BottleSpinUser];
  /** ID of the predetermined winner (who the bottle will land on) */
  winnerId: string;
  /** Called when spin animation completes */
  onSpinEnd: (winnerId: string) => void;
  /** Set to true to start spinning */
  isSpinning: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SPIN_DURATION = 2500; // ms
const MIN_ROTATIONS = 3;    // Minimum full rotations
const MAX_ROTATIONS = 5;    // Maximum full rotations

// ─── Component ───────────────────────────────────────────────────────────────

export function BottleSpin({
  users,
  winnerId,
  onSpinEnd,
  isSpinning,
}: BottleSpinProps) {
  const { width: windowWidth } = useWindowDimensions();
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const hasSpunRef = useRef(false);
  const arenaSize = Math.min(windowWidth * 0.72, moderateScale(304, 0.25));
  const arenaHeight = arenaSize * 0.6;
  const arenaRingSize = arenaSize * 0.7;
  const bottleSize = Math.min(windowWidth * 0.26, moderateScale(98, 0.25));
  const bottleNeckWidth = Math.max(moderateScale(7, 0.25), Math.round(bottleSize * 0.08));
  const bottleNeckHeight = Math.round(bottleSize * 0.3);
  const bottleBodyWidth = Math.round(bottleSize * 0.5);
  const bottleBodyHeight = Math.round(bottleSize * 0.6);
  const bottleIconSize = Math.max(SIZES.icon.lg, Math.round(bottleBodyWidth * 0.64));
  const avatarSize = Math.min(Math.max(windowWidth * 0.16, moderateScale(56, 0.25)), moderateScale(68, 0.25));
  const winnerOutlineWidth = moderateScale(3, 0.2);
  const avatarRingSize = avatarSize + winnerOutlineWidth * 2;
  const avatarIconSize = Math.max(SIZES.icon.lg, Math.round(avatarSize * 0.44));
  const winnerBadgeSize = moderateScale(24, 0.25);
  const winnerBadgeIconSize = SIZES.icon.xs;

  /**
   * Calculate final rotation angle to land on winner.
   * User 0 (top) = 0° or 360°
   * User 1 (bottom) = 180°
   */
  const calculateFinalAngle = useCallback(() => {
    const winnerIndex = users.findIndex((u) => u.id === winnerId);
    // Base angle: 0° for top user, 180° for bottom user
    const targetAngle = winnerIndex === 0 ? 0 : 180;
    // Add random full rotations for visual effect
    const fullRotations = MIN_ROTATIONS + Math.floor(Math.random() * (MAX_ROTATIONS - MIN_ROTATIONS + 1));
    return fullRotations * 360 + targetAngle;
  }, [users, winnerId]);

  /**
   * Start the spin animation.
   */
  const startSpin = useCallback(() => {
    if (hasSpunRef.current) return;
    hasSpunRef.current = true;

    const finalAngle = calculateFinalAngle();

    // Reset to 0
    rotationAnim.setValue(0);

    // Animate with ease-out for natural deceleration
    Animated.timing(rotationAnim, {
      toValue: finalAngle,
      duration: SPIN_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Animation complete
      onSpinEnd(winnerId);
    });
  }, [rotationAnim, calculateFinalAngle, winnerId, onSpinEnd]);

  // Trigger spin when isSpinning becomes true
  useEffect(() => {
    if (isSpinning && !hasSpunRef.current) {
      startSpin();
    }
  }, [isSpinning, startSpin]);

  // Reset when component remounts with new props
  useEffect(() => {
    return () => {
      hasSpunRef.current = false;
    };
  }, [winnerId]);

  // Rotation interpolation
  const rotateStyle = {
    transform: [
      {
        rotate: rotationAnim.interpolate({
          inputRange: [0, 360],
          outputRange: ['0deg', '360deg'],
        }),
      },
    ],
  };

  const [topUser, bottomUser] = users;

  return (
    <View style={styles.container}>
      {/* Top User */}
      <View style={styles.userSlot}>
        <UserAvatar
          user={topUser}
          avatarSize={avatarSize}
          avatarIconSize={avatarIconSize}
          avatarRingSize={avatarRingSize}
          winnerBadgeSize={winnerBadgeSize}
          winnerBadgeIconSize={winnerBadgeIconSize}
          isWinner={winnerId === topUser.id && !isSpinning && hasSpunRef.current}
        />
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.userName}>{topUser.name}</Text>
      </View>

      {/* Spin Arena */}
      <View style={[styles.arena, { width: arenaSize, height: arenaHeight }]}>
        {/* Center Bottle */}
        <Animated.View style={[styles.bottleContainer, rotateStyle]}>
          <View style={styles.bottle}>
            {/* Bottle neck (points up by default) */}
            <View
              style={[
                styles.bottleNeck,
                {
                  width: bottleNeckWidth,
                  height: bottleNeckHeight,
                  borderTopLeftRadius: bottleNeckWidth / 2,
                  borderTopRightRadius: bottleNeckWidth / 2,
                },
              ]}
            />
            {/* Bottle body */}
            <View
              style={[
                styles.bottleBody,
                {
                  width: bottleBodyWidth,
                  height: bottleBodyHeight,
                },
              ]}
            >
              <Ionicons name="wine" size={bottleIconSize} color={C.primary} />
            </View>
          </View>
        </Animated.View>

        {/* Decorative ring */}
        <View
          style={[
            styles.arenaRing,
            {
              width: arenaRingSize,
              height: arenaRingSize,
              borderRadius: arenaRingSize / 2,
            },
          ]}
        />
      </View>

      {/* Bottom User */}
      <View style={styles.userSlot}>
        <UserAvatar
          user={bottomUser}
          avatarSize={avatarSize}
          avatarIconSize={avatarIconSize}
          avatarRingSize={avatarRingSize}
          winnerBadgeSize={winnerBadgeSize}
          winnerBadgeIconSize={winnerBadgeIconSize}
          isWinner={winnerId === bottomUser.id && !isSpinning && hasSpunRef.current}
        />
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.userName}>{bottomUser.name}</Text>
      </View>

      {/* Instructions */}
      {!isSpinning && !hasSpunRef.current && (
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.instructions}>Tap to spin the bottle</Text>
      )}
      {isSpinning && (
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.spinningText}>Spinning...</Text>
      )}
    </View>
  );
}

// ─── User Avatar Sub-component ───────────────────────────────────────────────

function UserAvatar({
  user,
  isWinner,
  avatarSize,
  avatarIconSize,
  avatarRingSize,
  winnerBadgeSize,
  winnerBadgeIconSize,
}: {
  user: BottleSpinUser;
  isWinner: boolean;
  avatarSize: number;
  avatarIconSize: number;
  avatarRingSize: number;
  winnerBadgeSize: number;
  winnerBadgeIconSize: number;
}) {
  return (
    <View
      style={[
        styles.avatarContainer,
        isWinner && styles.avatarWinner,
        isWinner && {
          borderRadius: avatarRingSize / 2,
          padding: moderateScale(3, 0.2),
        },
      ]}
    >
      {user.avatarUrl ? (
        <Image
          source={{ uri: user.avatarUrl }}
          style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}
          contentFit="cover"
          blurRadius={8}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
          <Ionicons name="person" size={avatarIconSize} color={C.textLight} />
        </View>
      )}
      {isWinner && (
        <View
          style={[
            styles.winnerBadge,
            {
              width: winnerBadgeSize,
              height: winnerBadgeSize,
              borderRadius: winnerBadgeSize / 2,
            },
          ]}
        >
          <Ionicons name="arrow-forward" size={winnerBadgeIconSize} color="#FFF" />
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.lg,
  },

  // User slots
  userSlot: {
    alignItems: 'center',
    marginVertical: SPACING.base,
  },
  userName: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
    color: C.text,
    marginTop: SPACING.sm,
  },

  // Avatar
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    backgroundColor: C.surface,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWinner: {
    borderWidth: moderateScale(3, 0.2),
    borderColor: C.primary,
  },
  winnerBadge: {
    position: 'absolute',
    bottom: -SPACING.xs,
    right: -SPACING.xs,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: moderateScale(2, 0.2),
    borderColor: C.background,
  },

  // Spin Arena
  arena: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  arenaRing: {
    position: 'absolute',
    borderWidth: moderateScale(2, 0.2),
    borderColor: C.surface,
    borderStyle: 'dashed',
  },

  // Bottle
  bottleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottle: {
    alignItems: 'center',
  },
  bottleNeck: {
    backgroundColor: C.primary,
  },
  bottleBody: {
    backgroundColor: C.surface,
    borderRadius: SIZES.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: moderateScale(2, 0.2),
    borderColor: C.primary,
    marginTop: -SPACING.xxs,
  },

  // Text
  instructions: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    color: C.textLight,
    marginTop: SPACING.lg,
    fontStyle: 'italic',
  },
  spinningText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
    color: C.primary,
    marginTop: SPACING.lg,
  },
});

export default BottleSpin;
