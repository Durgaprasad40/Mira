/**
 * BottleSpinGame - Truth or Dare game with bottle rotation animation
 *
 * V4 REWRITE: Clean uiMode derivation from backend source of truth
 *
 * UI Modes:
 * - idle: Ready to spin
 * - spinning_local: Local device is animating the spin
 * - choosing_for_me: Backend says it's MY turn - show Truth/Dare/Skip
 * - choosing_for_other: Backend says it's OTHER's turn - show observer UI
 * - complete: Choice was made, show result
 *
 * Critical Rule: Chooser UI derived ONLY from backend state, not local state
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

// ═══════════════════════════════════════════════════════════════════════════
// V4 CLEAN UI MODE - Single source of truth for render decisions
// ═══════════════════════════════════════════════════════════════════════════
type UIMode = 'idle' | 'spinning_local' | 'choosing_for_me' | 'choosing_for_other' | 'complete';

export function BottleSpinGame({
  visible,
  onClose,
  currentUserName,
  otherUserName,
  conversationId,
  userId,
  onSendResultMessage,
}: BottleSpinGameProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // LOCAL STATE - Only for animation and UI helpers, NOT for turn ownership
  // ═══════════════════════════════════════════════════════════════════════════
  const [isSpinningLocally, setIsSpinningLocally] = useState(false);
  const [chosenOption, setChosenOption] = useState<'truth' | 'dare' | 'skip' | null>(null);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);

  // Stale callback guard: increments on reset, animation checks before applying
  const spinSessionRef = useRef(0);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const currentRotation = useRef(0);

  // ═══════════════════════════════════════════════════════════════════════════
  // BACKEND STATE - Single source of truth for turn ownership
  // ═══════════════════════════════════════════════════════════════════════════
  const gameSession = useQuery(
    api.games.getBottleSpinSession,
    visible && conversationId ? { conversationId } : 'skip'
  );
  const setTurnMutation = useMutation(api.games.setBottleSpinTurn);

  // Extract backend values (only when session is active)
  const isSessionActive = gameSession?.state === 'active';
  const backendTurnRole = isSessionActive ? gameSession.currentTurnRole : undefined;
  const backendTurnPhase = isSessionActive ? gameSession.turnPhase : undefined;
  const inviterId = isSessionActive ? gameSession.inviterId : undefined;
  const inviteeId = isSessionActive ? gameSession.inviteeId : undefined;

  // ═══════════════════════════════════════════════════════════════════════════
  // ROLE DETERMINATION - Am I inviter or invitee?
  // ═══════════════════════════════════════════════════════════════════════════
  // inviterId is the auth ID stored when invite was sent
  // userId is my auth ID passed from parent
  const amIInviter = Boolean(inviterId && userId === inviterId);
  const amIInvitee = Boolean(inviteeId && userId === inviteeId);
  const myRole: 'inviter' | 'invitee' | null = amIInviter ? 'inviter' : (amIInvitee ? 'invitee' : null);

  // ═══════════════════════════════════════════════════════════════════════════
  // UI MODE DERIVATION - THE SINGLE SOURCE OF TRUTH FOR RENDERING
  // ═══════════════════════════════════════════════════════════════════════════
  const uiMode: UIMode = (() => {
    // Priority 1: Local spinning animation takes precedence
    if (isSpinningLocally) {
      return 'spinning_local';
    }

    // Priority 2: No active session = idle
    if (!isSessionActive) {
      return 'idle';
    }

    // Priority 3: Backend says choosing phase
    if (backendTurnPhase === 'choosing' && backendTurnRole && myRole) {
      if (backendTurnRole === myRole) {
        // IT'S MY TURN - I must see Truth/Dare/Skip
        return 'choosing_for_me';
      } else {
        // IT'S OTHER'S TURN - I see observer UI
        return 'choosing_for_other';
      }
    }

    // Priority 4: Backend says complete
    if (backendTurnPhase === 'complete') {
      return 'complete';
    }

    // Priority 5: Backend says spinning (other device is spinning)
    if (backendTurnPhase === 'spinning') {
      return 'spinning_local'; // Show spinning UI even if we're not the spinner
    }

    // Default: idle
    return 'idle';
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUG LOGGING - Comprehensive state trace for both devices
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (visible) {
      console.log('[BOTTLE_SPIN_V4_DEBUG]', {
        // Session info
        sessionState: gameSession?.state,
        isSessionActive,
        // IDs
        userId,
        inviterId,
        inviteeId,
        // Role determination
        amIInviter,
        amIInvitee,
        myRole,
        // Backend turn state
        backendTurnRole,
        backendTurnPhase,
        // Local state
        isSpinningLocally,
        chosenOption,
        // DERIVED UI MODE
        uiMode,
        // Render branch that will be active
        renderBranch: uiMode === 'choosing_for_me' ? 'CHOOSER_BUTTONS' :
                      uiMode === 'choosing_for_other' ? 'OBSERVER_UI' :
                      uiMode === 'spinning_local' ? 'SPINNING' :
                      uiMode === 'complete' ? 'COMPLETE' : 'IDLE',
      });
    }
  }, [visible, gameSession, isSessionActive, userId, inviterId, inviteeId, amIInviter, amIInvitee, myRole, backendTurnRole, backendTurnPhase, isSpinningLocally, chosenOption, uiMode]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SKIP TRACKING
  // ═══════════════════════════════════════════════════════════════════════════
  const windowKey = getWindowKey();
  const skipDataQuery = useQuery(
    api.games.getGlobalBottleSpinSkips,
    visible && userId ? { authUserId: userId, windowKey } : 'skip'
  );
  const incrementSkipMutation = useMutation(api.games.incrementGlobalBottleSpinSkip);

  const skipCount = skipDataQuery?.skipCount ?? 0;
  const skipsRemaining = Math.max(0, MAX_SKIPS - skipCount);
  const canSkip = skipsRemaining > 0;

  const incrementSkipCount = useCallback(async () => {
    if (!userId) return;
    try {
      await incrementSkipMutation({ authUserId: userId, windowKey, delta: 1 });
    } catch (error) {
      console.error('[BOTTLE_SPIN] Failed to increment skip count:', error);
    }
  }, [userId, windowKey, incrementSkipMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // GAME ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  const resetGame = useCallback(async () => {
    spinSessionRef.current += 1;
    setIsSpinningLocally(false);
    setChosenOption(null);
    setShowEndConfirmation(false);
    spinAnim.stopAnimation();
    spinAnim.setValue(0);
    currentRotation.current = 0;

    if (userId && conversationId) {
      try {
        await setTurnMutation({
          authUserId: userId,
          conversationId,
          currentTurnRole: undefined,
          turnPhase: 'idle',
        });
      } catch (error) {
        // Ignore errors during reset
      }
    }
  }, [spinAnim, userId, conversationId, setTurnMutation]);

  const handleClose = useCallback(() => {
    resetGame();
    onClose();
  }, [resetGame, onClose]);

  const handleEndGamePress = useCallback(() => {
    setShowEndConfirmation(true);
  }, []);

  const handleEndGameConfirm = useCallback(() => {
    setShowEndConfirmation(false);
    if (onSendResultMessage) {
      onSendResultMessage(`${currentUserName} ended the game`);
    }
    resetGame();
    onClose();
  }, [currentUserName, onSendResultMessage, resetGame, onClose]);

  const handleEndGameCancel = useCallback(() => {
    setShowEndConfirmation(false);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // SPIN BOTTLE
  // ═══════════════════════════════════════════════════════════════════════════
  const spinBottle = useCallback(async () => {
    if (isSpinningLocally) return;

    // Guard: Only spin if session is active
    if (!isSessionActive) {
      console.warn('[BOTTLE_SPIN] Cannot spin - no active session');
      return;
    }

    // Guard: Must have a role
    if (!myRole) {
      console.warn('[BOTTLE_SPIN] Cannot spin - role not determined', { userId, inviterId, inviteeId });
      return;
    }

    setIsSpinningLocally(true);
    setChosenOption(null);

    // Notify backend
    if (userId && conversationId) {
      try {
        await setTurnMutation({
          authUserId: userId,
          conversationId,
          currentTurnRole: undefined,
          turnPhase: 'spinning',
        });
      } catch (error) {
        console.error('[BOTTLE_SPIN] Failed to set spinning state:', error);
      }
    }

    const spinSession = spinSessionRef.current;

    // Random spin
    const fullRotations = 3 + Math.floor(Math.random() * 4);
    const landsOnMe = Math.random() < 0.5;
    const finalAngle = landsOnMe ? 0 : 180;
    const totalRotation = fullRotations * 360 + finalAngle;

    // Determine which ROLE the bottle landed on
    const selectedRole: 'inviter' | 'invitee' = landsOnMe
      ? myRole // Landed on me = my role
      : (myRole === 'inviter' ? 'invitee' : 'inviter'); // Landed on other = opposite role

    console.log('[BOTTLE_SPIN] Spin result:', { landsOnMe, myRole, selectedRole });

    Animated.timing(spinAnim, {
      toValue: totalRotation,
      duration: 3000 + Math.random() * 1000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(async () => {
      // Stale callback guard
      if (spinSessionRef.current !== spinSession) {
        return;
      }

      currentRotation.current = totalRotation % 360;
      setIsSpinningLocally(false);

      // Update backend with the selected ROLE
      if (userId && conversationId) {
        try {
          await setTurnMutation({
            authUserId: userId,
            conversationId,
            currentTurnRole: selectedRole,
            turnPhase: 'choosing',
          });
          console.log('[BOTTLE_SPIN] Set turn state:', { selectedRole, turnPhase: 'choosing' });
        } catch (error) {
          console.error('[BOTTLE_SPIN] Failed to set turn state:', error);
        }
      }

      // Haptic feedback
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Haptics not available
      }

      // Send system message
      if (onSendResultMessage) {
        const selectedName = landsOnMe ? currentUserName : otherUserName;
        onSendResultMessage(`Bottle landed on ${selectedName}!`);
      }
    });
  }, [isSpinningLocally, isSessionActive, myRole, userId, inviterId, inviteeId, conversationId, setTurnMutation, spinAnim, currentUserName, otherUserName, onSendResultMessage]);

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLE CHOICE (Truth/Dare/Skip)
  // ═══════════════════════════════════════════════════════════════════════════
  const handleChoice = useCallback(async (choice: 'truth' | 'dare' | 'skip') => {
    // Guard: Only allow choice if it's my turn
    if (uiMode !== 'choosing_for_me') {
      console.warn('[BOTTLE_SPIN] Cannot choose - not my turn', { uiMode });
      return;
    }

    setChosenOption(choice);

    // Update backend
    if (userId && conversationId) {
      try {
        await setTurnMutation({
          authUserId: userId,
          conversationId,
          currentTurnRole: undefined,
          turnPhase: 'complete',
          lastSpinResult: choice,
        });
      } catch (error) {
        console.error('[BOTTLE_SPIN] Failed to set complete state:', error);
      }
    }

    if (choice === 'skip') {
      incrementSkipCount();
    }

    // Send result message
    if (onSendResultMessage) {
      if (choice === 'skip') {
        onSendResultMessage(`${currentUserName} skipped their turn`);
      } else {
        const resultText = choice === 'truth' ? 'TRUTH' : 'DARE';
        onSendResultMessage(`${currentUserName} chose ${resultText}`);
      }
    }

    // Haptic feedback
    try {
      if (choice === 'skip') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      // Haptics not available
    }
  }, [uiMode, currentUserName, incrementSkipCount, onSendResultMessage, userId, conversationId, setTurnMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SPIN AGAIN
  // ═══════════════════════════════════════════════════════════════════════════
  const handleSpinAgain = useCallback(async () => {
    spinAnim.setValue(currentRotation.current);
    setChosenOption(null);

    if (userId && conversationId) {
      try {
        await setTurnMutation({
          authUserId: userId,
          conversationId,
          currentTurnRole: undefined,
          turnPhase: 'idle',
        });
      } catch (error) {
        // Ignore errors
      }
    }

    // Small delay to let state update, then spin
    setTimeout(() => {
      spinBottle();
    }, 100);
  }, [spinAnim, spinBottle, userId, conversationId, setTurnMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATION
  // ═══════════════════════════════════════════════════════════════════════════
  const rotation = spinAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  // Determine which user badge should be highlighted based on backend turn role
  const isCurrentUserSelected = backendTurnPhase === 'choosing' && backendTurnRole === myRole;
  const isOtherUserSelected = backendTurnPhase === 'choosing' && backendTurnRole !== myRole && backendTurnRole !== undefined;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: CHOOSER BUTTONS (Truth/Dare/Skip) - Horizontal row layout
  // ═══════════════════════════════════════════════════════════════════════════
  const renderChooserButtons = () => (
    <View style={styles.choiceContainer}>
      <View style={styles.choiceButtons}>
        <TouchableOpacity
          style={[styles.choiceButton, styles.truthButton]}
          onPress={() => handleChoice('truth')}
        >
          <Ionicons name="chatbubble-ellipses" size={16} color={COLORS.white} />
          <Text style={styles.choiceButtonText}>Truth</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.choiceButton, styles.dareButton]}
          onPress={() => handleChoice('dare')}
        >
          <Ionicons name="flame" size={16} color={COLORS.white} />
          <Text style={styles.choiceButtonText}>Dare</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.choiceButton, styles.skipChoiceButton, !canSkip && styles.skipChoiceButtonDisabled]}
          onPress={() => canSkip && handleChoice('skip')}
          disabled={!canSkip}
        >
          <Ionicons name="play-skip-forward" size={14} color={canSkip ? COLORS.text : COLORS.textMuted} />
          <Text style={[styles.skipChoiceText, !canSkip && styles.skipChoiceTextDisabled]}>
            Skip
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: OBSERVER UI (other user is choosing) - Compact layout
  // ═══════════════════════════════════════════════════════════════════════════
  const renderObserverUI = () => (
    <View style={styles.resultContainer}>
      <Text style={styles.resultText}>
        <Text style={styles.resultName}>{otherUserName}</Text>
        {' '}is choosing...
      </Text>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: COMPLETE STATE - Compact layout with inline actions
  // ═══════════════════════════════════════════════════════════════════════════
  const renderComplete = () => (
    <View style={styles.resultContainer}>
      <Text style={styles.resultText}>
        {chosenOption === 'skip' ? (
          <>Skipped!</>
        ) : chosenOption ? (
          <>
            <Text style={[
              styles.resultType,
              chosenOption === 'truth' ? styles.truthText : styles.dareText,
            ]}>
              {chosenOption === 'truth' ? 'TRUTH' : 'DARE'}
            </Text>
          </>
        ) : (
          <>Done!</>
        )}
      </Text>
      <View style={styles.compactActions}>
        <TouchableOpacity style={styles.compactActionButton} onPress={handleSpinAgain}>
          <Ionicons name="refresh" size={14} color={COLORS.primary} />
          <Text style={styles.compactActionText}>Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.compactActionButton} onPress={handleClose}>
          <Ionicons name="checkmark" size={14} color={COLORS.secondary} />
          <Text style={[styles.compactActionText, { color: COLORS.secondary }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════════
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
              <Text style={styles.title}>Spin the Bottle</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {/* Game area */}
          <View style={styles.gameArea}>
            {/* Top user (current user / me) */}
            <View style={styles.userLabel}>
              <View style={[
                styles.userBadge,
                isCurrentUserSelected && styles.userBadgeSelected,
              ]}>
                <Text style={[
                  styles.userName,
                  isCurrentUserSelected && styles.userNameSelected,
                ]}>
                  {currentUserName}
                </Text>
                {isCurrentUserSelected && (
                  <Text style={styles.turnText}>Your turn!</Text>
                )}
              </View>
            </View>

            {/* Bottle */}
            <View style={styles.bottleContainer}>
              <Animated.View style={[styles.bottle, { transform: [{ rotate: rotation }] }]}>
                <View style={styles.bottleCap} />
                <View style={styles.bottleNeck} />
                <View style={styles.bottleShoulder} />
                <View style={styles.bottleBody}>
                  <View style={styles.bottleLabel}>
                    <Text style={styles.bottleLabelText}>T/D</Text>
                  </View>
                </View>
                <View style={styles.bottleBase} />
              </Animated.View>
            </View>

            {/* Bottom user (other user) */}
            <View style={styles.userLabel}>
              <View style={[
                styles.userBadge,
                isOtherUserSelected && styles.userBadgeSelected,
              ]}>
                <Text style={[
                  styles.userName,
                  isOtherUserSelected && styles.userNameSelected,
                ]}>
                  {otherUserName}
                </Text>
                {isOtherUserSelected && (
                  <Text style={styles.turnText}>Their turn!</Text>
                )}
              </View>
            </View>
          </View>

          {/* ═══════════════════════════════════════════════════════════════════
              DYNAMIC CONTENT BASED ON uiMode - SINGLE RENDER DECISION
              ═══════════════════════════════════════════════════════════════════ */}

          {/* IDLE: Show spin button */}
          {uiMode === 'idle' && (
            <View style={styles.actions}>
              <TouchableOpacity style={styles.spinButton} onPress={spinBottle}>
                <Ionicons name="refresh" size={18} color={COLORS.white} />
                <Text style={styles.spinButtonText}>Spin the Bottle</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* SPINNING: Show spinning text */}
          {uiMode === 'spinning_local' && (
            <View style={styles.spinningContainer}>
              <Text style={styles.spinningText}>Spinning...</Text>
            </View>
          )}

          {/* CHOOSING_FOR_ME: I must choose - show Truth/Dare/Skip buttons */}
          {uiMode === 'choosing_for_me' && renderChooserButtons()}

          {/* CHOOSING_FOR_OTHER: Other player chooses - show observer UI */}
          {uiMode === 'choosing_for_other' && renderObserverUI()}

          {/* COMPLETE: Show result */}
          {uiMode === 'complete' && renderComplete()}

          {/* Bottom row: Skip info + End Game */}
          <View style={styles.bottomRow}>
            <View style={styles.skipInfoLeft}>
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
              <Text style={styles.skipsText}>Skips: {skipsRemaining}/{MAX_SKIPS}</Text>
            </View>

            <TouchableOpacity style={styles.endGameButton} onPress={handleEndGamePress}>
              <Ionicons name="close-circle-outline" size={14} color="#E57373" style={{ marginRight: 4 }} />
              <Text style={styles.endGameText}>End Game</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* End Game Confirmation Modal */}
        <Modal
          visible={showEndConfirmation}
          animationType="fade"
          transparent
          onRequestClose={handleEndGameCancel}
        >
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmContainer}>
              <Text style={styles.confirmTitle}>End Game?</Text>
              <Text style={styles.confirmMessage}>
                Are you sure you want to end the game?
              </Text>
              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={[styles.confirmButton, styles.confirmButtonNo]}
                  onPress={handleEndGameCancel}
                >
                  <Text style={styles.confirmButtonNoText}>No</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, styles.confirmButtonYes]}
                  onPress={handleEndGameConfirm}
                >
                  <Text style={styles.confirmButtonYesText}>Yes</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

// Fixed content area height for consistent modal size across all states
const CONTENT_AREA_HEIGHT = 56;

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
    maxWidth: 320,
    padding: 16,
    // Fixed modal size - no content-driven expansion
    minHeight: 380,
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
  actions: {
    height: CONTENT_AREA_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
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
  spinButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  spinningContainer: {
    height: CONTENT_AREA_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinningText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  choiceContainer: {
    height: CONTENT_AREA_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  choiceButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 10,
    width: '100%',
    paddingHorizontal: 4,
  },
  choiceButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 4,
  },
  truthButton: {
    backgroundColor: '#6C5CE7',
  },
  dareButton: {
    backgroundColor: '#E17055',
  },
  skipChoiceButton: {
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  skipChoiceButtonDisabled: {
    opacity: 0.5,
  },
  choiceButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },
  skipChoiceText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.text,
  },
  skipChoiceTextDisabled: {
    color: COLORS.textMuted,
  },
  resultContainer: {
    height: CONTENT_AREA_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    gap: 16,
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
    fontSize: 18,
  },
  truthText: {
    color: '#6C5CE7',
  },
  dareText: {
    color: '#E17055',
  },
  compactActions: {
    flexDirection: 'row',
    gap: 12,
  },
  compactActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: COLORS.background,
  },
  compactActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  skipInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  skipsIndicator: {
    flexDirection: 'row',
    gap: 3,
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
    fontSize: 11,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  endGameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(229, 115, 115, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(229, 115, 115, 0.3)',
  },
  endGameText: {
    fontSize: 11,
    color: '#E57373',
    fontWeight: '600',
  },
  // End Game confirmation modal
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  confirmContainer: {
    backgroundColor: COLORS.background,
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 280,
    alignItems: 'center',
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  confirmMessage: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonNo: {
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  confirmButtonYes: {
    backgroundColor: COLORS.error,
  },
  confirmButtonNoText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  confirmButtonYesText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
});
