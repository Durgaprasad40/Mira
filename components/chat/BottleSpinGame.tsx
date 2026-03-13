/**
 * BottleSpinGame - Truth or Dare game with bottle rotation animation
 *
 * Features:
 * - Animated bottle that spins and lands on either user
 * - Shows both users' names with "Your turn" / "Their turn" highlight
 * - Per-chat, per-user skip quota with daily UTC reset
 * - Sends result message to chat when spin completes
 * - Haptic feedback on spin end
 * - No prompts/questions - users pick their own
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';

// Skip tracking now uses Convex-backed persistence (userGameLimits table)
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MAX_SKIPS = 3;

// Generate windowKey for daily UTC buckets (e.g., "2024-01-15")
function getWindowKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

interface BottleSpinGameProps {
  visible: boolean;
  onClose: () => void;
  currentUserName: string;
  otherUserName: string;
  conversationId: string;
  userId: string;
  /** Called when spin completes to send result message to chat */
  onSendResultMessage?: (message: string) => void;
}

type GameResult = 'truth' | 'dare' | null;
type SelectedUser = 'current' | 'other' | null;

export function BottleSpinGame({
  visible,
  onClose,
  currentUserName,
  otherUserName,
  conversationId,
  userId,
  onSendResultMessage,
}: BottleSpinGameProps) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SelectedUser>(null);
  const [gameResult, setGameResult] = useState<GameResult>(null);
  const [hasSpun, setHasSpun] = useState(false);

  // Track if we've already sent the result message for current spin
  const resultMessageSentRef = useRef(false);

  // Stale callback guard: increments on reset, animation checks before applying
  const spinSessionRef = useRef(0);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const currentRotation = useRef(0);

  // Convex-backed skip tracking
  const windowKey = getWindowKey();
  const skipDataQuery = useQuery(
    api.games.getBottleSpinSkips,
    visible && conversationId && userId
      ? { convoId: conversationId, windowKey }
      : 'skip'
  );
  const incrementSkipMutation = useMutation(api.games.incrementBottleSpinSkip);

  // Calculate skips remaining from Convex data
  const skipCount = skipDataQuery?.skipCount ?? 0;
  const skipsRemaining = Math.max(0, MAX_SKIPS - skipCount);

  // Increment skip count in Convex when user skips
  const incrementSkipCount = useCallback(async () => {
    if (!conversationId || !userId) return;
    try {
      await incrementSkipMutation({
        convoId: conversationId,
        windowKey,
        delta: 1,
      });
    } catch (error) {
      console.error('[BOTTLE_SPIN] Failed to increment skip count:', error);
    }
  }, [conversationId, userId, windowKey, incrementSkipMutation]);

  const resetGame = useCallback(() => {
    // Increment session to invalidate any in-flight animation callbacks
    spinSessionRef.current += 1;
    setIsSpinning(false);
    setSelectedUser(null);
    setGameResult(null);
    setHasSpun(false);
    resultMessageSentRef.current = false;
    spinAnim.stopAnimation();
    spinAnim.setValue(0);
    currentRotation.current = 0;
  }, [spinAnim]);

  const handleClose = useCallback(() => {
    resetGame();
    onClose();
  }, [resetGame, onClose]);

  const spinBottle = useCallback(() => {
    if (isSpinning) return;

    setIsSpinning(true);
    setSelectedUser(null);
    setGameResult(null);
    resultMessageSentRef.current = false;

    // Capture session at start to detect stale callbacks
    const spinSession = spinSessionRef.current;

    // Random number of full rotations (3-6) plus random final position
    const fullRotations = 3 + Math.floor(Math.random() * 4);
    const randomUser = Math.random() < 0.5 ? 'current' : 'other';
    // Current user is at top (0 degrees), other user is at bottom (180 degrees)
    const finalAngle = randomUser === 'current' ? 0 : 180;
    const totalRotation = fullRotations * 360 + finalAngle;

    // Random truth or dare
    const result: GameResult = Math.random() < 0.5 ? 'truth' : 'dare';

    Animated.timing(spinAnim, {
      toValue: totalRotation,
      duration: 3000 + Math.random() * 1000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Stale callback guard: ignore if session changed (game was reset)
      if (spinSessionRef.current !== spinSession) {
        return;
      }

      currentRotation.current = totalRotation % 360;
      setIsSpinning(false);
      setSelectedUser(randomUser);
      setGameResult(result);
      setHasSpun(true);

      // Haptic feedback on spin complete
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Haptics not available, continue silently
      }

      // Send result message to chat (only once per spin)
      // Note: Message renders as system bubble with dice icon, so no emoji needed
      if (onSendResultMessage && !resultMessageSentRef.current) {
        resultMessageSentRef.current = true;
        const selectedName = randomUser === 'current' ? currentUserName : otherUserName;
        const resultText = result === 'truth' ? 'TRUTH' : 'DARE';
        const message = `${selectedName} → ${resultText}`;
        onSendResultMessage(message);
      }
    });
  }, [isSpinning, spinAnim, currentUserName, otherUserName, onSendResultMessage]);

  const handleSkip = useCallback(() => {
    if (skipsRemaining <= 0) return;
    incrementSkipCount();
    resetGame();
  }, [skipsRemaining, incrementSkipCount, resetGame]);

  const handleRotateAgain = useCallback(() => {
    spinAnim.setValue(currentRotation.current);
    spinBottle();
  }, [spinAnim, spinBottle]);

  const rotation = spinAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  const selectedName = selectedUser === 'current' ? currentUserName : otherUserName;
  const canSkip = skipsRemaining > 0;

  // Determine turn text
  const getTurnText = (user: 'current' | 'other') => {
    if (!hasSpun || isSpinning || !selectedUser) return null;
    if (selectedUser === user) {
      return user === 'current' ? 'Your turn!' : 'Their turn!';
    }
    return null;
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="wine" size={18} color={COLORS.secondary} />
              <Text style={styles.title}>Truth or Dare</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {/* Game area */}
          <View style={styles.gameArea}>
            {/* Top user (current user) */}
            <View style={styles.userLabel}>
              <View style={[
                styles.userBadge,
                selectedUser === 'current' && styles.userBadgeSelected,
              ]}>
                <Text style={[
                  styles.userName,
                  selectedUser === 'current' && styles.userNameSelected,
                ]}>
                  {currentUserName}
                </Text>
                {getTurnText('current') && (
                  <Text style={styles.turnText}>{getTurnText('current')}</Text>
                )}
              </View>
            </View>

            {/* Bottle - Wine bottle shape pointing up */}
            <View style={styles.bottleContainer}>
              <Animated.View style={[styles.bottle, { transform: [{ rotate: rotation }] }]}>
                {/* Bottle cap */}
                <View style={styles.bottleCap} />
                {/* Bottle neck */}
                <View style={styles.bottleNeck} />
                {/* Bottle shoulder */}
                <View style={styles.bottleShoulder} />
                {/* Bottle body */}
                <View style={styles.bottleBody}>
                  {/* Label on bottle */}
                  <View style={styles.bottleLabel}>
                    <Text style={styles.bottleLabelText}>T/D</Text>
                  </View>
                </View>
                {/* Bottle base */}
                <View style={styles.bottleBase} />
              </Animated.View>
            </View>

            {/* Bottom user (other user) */}
            <View style={styles.userLabel}>
              <View style={[
                styles.userBadge,
                selectedUser === 'other' && styles.userBadgeSelected,
              ]}>
                <Text style={[
                  styles.userName,
                  selectedUser === 'other' && styles.userNameSelected,
                ]}>
                  {otherUserName}
                </Text>
                {getTurnText('other') && (
                  <Text style={styles.turnText}>{getTurnText('other')}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Result display */}
          {hasSpun && !isSpinning && selectedUser && gameResult && (
            <View style={styles.resultContainer}>
              <Text style={styles.resultText}>
                <Text style={styles.resultName}>{selectedName}</Text>
                {' '}gets{' '}
                <Text style={[
                  styles.resultType,
                  gameResult === 'truth' ? styles.truthText : styles.dareText,
                ]}>
                  {gameResult === 'truth' ? 'TRUTH' : 'DARE'}
                </Text>
              </Text>
              <Text style={styles.resultHint}>
                {selectedUser === 'current'
                  ? 'They can ask you anything or dare you!'
                  : 'Ask them anything or dare them!'}
              </Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.actions}>
            {!hasSpun ? (
              <TouchableOpacity
                style={[styles.spinButton, isSpinning && styles.spinButtonDisabled]}
                onPress={spinBottle}
                disabled={isSpinning}
              >
                <Ionicons name="refresh" size={18} color={COLORS.white} />
                <Text style={styles.spinButtonText}>
                  {isSpinning ? 'Spinning...' : 'Spin the Bottle'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.postSpinActions}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.rotateAgainButton]}
                  onPress={handleRotateAgain}
                  disabled={isSpinning}
                >
                  <Ionicons name="refresh" size={16} color={COLORS.white} />
                  <Text style={styles.actionButtonText}>Rotate Again</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    styles.skipButton,
                    !canSkip && styles.skipButtonDisabled,
                  ]}
                  onPress={handleSkip}
                  disabled={isSpinning || !canSkip}
                >
                  <Ionicons
                    name="play-skip-forward"
                    size={14}
                    color={canSkip ? COLORS.textLight : COLORS.textMuted}
                  />
                  <Text style={[
                    styles.skipButtonText,
                    !canSkip && styles.skipButtonTextDisabled,
                  ]}>
                    {canSkip ? `Skip (${skipsRemaining} left)` : 'No skips left'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Skips counter - always visible (show when Convex data loaded) */}
          {skipDataQuery !== undefined && (
            <View style={styles.skipsCounter}>
              <View style={styles.skipsIndicator}>
                {[...Array(MAX_SKIPS)].map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.skipDot,
                      i < skipsRemaining ? styles.skipDotActive : styles.skipDotInactive,
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.skipsText}>
                Skips: {skipsRemaining}/{MAX_SKIPS} (resets daily UTC)
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    backgroundColor: COLORS.background,
    borderRadius: 18,
    width: '90%',
    maxWidth: 300,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeButton: {
    padding: 2,
  },
  gameArea: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  userLabel: {
    marginVertical: 6,
  },
  userBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  userBadgeSelected: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  userNameSelected: {
    color: COLORS.primary,
  },
  turnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.secondary,
    marginTop: 2,
  },
  bottleContainer: {
    width: 80,
    height: 110,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
  },
  bottle: {
    alignItems: 'center',
  },
  bottleCap: {
    width: 10,
    height: 5,
    backgroundColor: '#8B4513',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  bottleNeck: {
    width: 8,
    height: 22,
    backgroundColor: COLORS.secondary,
  },
  bottleShoulder: {
    width: 24,
    height: 8,
    backgroundColor: COLORS.secondary,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginTop: -1,
  },
  bottleBody: {
    width: 30,
    height: 42,
    backgroundColor: COLORS.secondary,
    borderRadius: 3,
    marginTop: -1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottleLabel: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  bottleLabelText: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  bottleBase: {
    width: 34,
    height: 4,
    backgroundColor: COLORS.secondary,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    marginTop: -1,
  },
  resultContainer: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    marginBottom: 10,
  },
  resultText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  resultName: {
    color: COLORS.primary,
  },
  resultType: {
    fontWeight: '700',
  },
  truthText: {
    color: '#6C5CE7',
  },
  dareText: {
    color: '#E17055',
  },
  resultHint: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 4,
    textAlign: 'center',
  },
  actions: {
    marginTop: 2,
  },
  spinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 22,
    gap: 6,
  },
  spinButtonDisabled: {
    opacity: 0.6,
  },
  spinButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  postSpinActions: {
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    gap: 5,
  },
  rotateAgainButton: {
    backgroundColor: COLORS.primary,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },
  skipButton: {
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  skipButtonDisabled: {
    opacity: 0.5,
  },
  skipButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  skipButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  skipsCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  skipsIndicator: {
    flexDirection: 'row',
    gap: 4,
  },
  skipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  skipDotActive: {
    backgroundColor: COLORS.secondary,
  },
  skipDotInactive: {
    backgroundColor: COLORS.border,
  },
  skipsText: {
    fontSize: 10,
    color: COLORS.textLight,
    fontWeight: '500',
  },
});
