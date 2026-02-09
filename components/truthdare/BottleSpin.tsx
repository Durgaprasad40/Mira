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
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
const BOTTLE_SIZE = 100;
const AVATAR_SIZE = 64;
const ARENA_SIZE = SCREEN_WIDTH - 80;

// ─── Component ───────────────────────────────────────────────────────────────

export function BottleSpin({
  users,
  winnerId,
  onSpinEnd,
  isSpinning,
}: BottleSpinProps) {
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const hasSpunRef = useRef(false);

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
        <UserAvatar user={topUser} isWinner={winnerId === topUser.id && !isSpinning && hasSpunRef.current} />
        <Text style={styles.userName}>{topUser.name}</Text>
      </View>

      {/* Spin Arena */}
      <View style={styles.arena}>
        {/* Center Bottle */}
        <Animated.View style={[styles.bottleContainer, rotateStyle]}>
          <View style={styles.bottle}>
            {/* Bottle neck (points up by default) */}
            <View style={styles.bottleNeck} />
            {/* Bottle body */}
            <View style={styles.bottleBody}>
              <Ionicons name="wine" size={32} color={C.primary} />
            </View>
          </View>
        </Animated.View>

        {/* Decorative ring */}
        <View style={styles.arenaRing} />
      </View>

      {/* Bottom User */}
      <View style={styles.userSlot}>
        <UserAvatar user={bottomUser} isWinner={winnerId === bottomUser.id && !isSpinning && hasSpunRef.current} />
        <Text style={styles.userName}>{bottomUser.name}</Text>
      </View>

      {/* Instructions */}
      {!isSpinning && !hasSpunRef.current && (
        <Text style={styles.instructions}>Tap to spin the bottle</Text>
      )}
      {isSpinning && (
        <Text style={styles.spinningText}>Spinning...</Text>
      )}
    </View>
  );
}

// ─── User Avatar Sub-component ───────────────────────────────────────────────

function UserAvatar({ user, isWinner }: { user: BottleSpinUser; isWinner: boolean }) {
  return (
    <View style={[styles.avatarContainer, isWinner && styles.avatarWinner]}>
      {user.avatarUrl ? (
        <Image
          source={{ uri: user.avatarUrl }}
          style={styles.avatar}
          contentFit="cover"
          blurRadius={8}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Ionicons name="person" size={28} color={C.textLight} />
        </View>
      )}
      {isWinner && (
        <View style={styles.winnerBadge}>
          <Ionicons name="arrow-forward" size={12} color="#FFF" />
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
    paddingVertical: 20,
  },

  // User slots
  userSlot: {
    alignItems: 'center',
    marginVertical: 16,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginTop: 8,
  },

  // Avatar
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: C.surface,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWinner: {
    borderWidth: 3,
    borderColor: C.primary,
    borderRadius: (AVATAR_SIZE + 6) / 2,
    padding: 3,
  },
  winnerBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },

  // Spin Arena
  arena: {
    width: ARENA_SIZE,
    height: ARENA_SIZE * 0.6,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  arenaRing: {
    position: 'absolute',
    width: ARENA_SIZE * 0.7,
    height: ARENA_SIZE * 0.7,
    borderRadius: (ARENA_SIZE * 0.7) / 2,
    borderWidth: 2,
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
    width: 8,
    height: 30,
    backgroundColor: C.primary,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  bottleBody: {
    width: BOTTLE_SIZE * 0.5,
    height: BOTTLE_SIZE * 0.6,
    backgroundColor: C.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.primary,
    marginTop: -2,
  },

  // Text
  instructions: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 20,
    fontStyle: 'italic',
  },
  spinningText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
    marginTop: 20,
  },
});

export default BottleSpin;
