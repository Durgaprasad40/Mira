/**
 * ChatTodOverlay - Full-screen game container for mandatory Truth-or-Dare
 *
 * CONSTRAINTS:
 * - MAY import chatTodStore
 * - MAY import BottleSpin
 * - Must NOT touch Convex yet
 * - Must NOT modify incognito-chat.tsx yet
 *
 * This component is the orchestrator for the in-chat T&D game.
 * It blocks normal chat until one full round is completed.
 *
 * PHASES:
 * - idle        → "Spin the Bottle" button
 * - spinning    → BottleSpin animation
 * - choosing    → Truth / Dare / Skip buttons
 * - writing     → Text input for prompt (no library)
 * - answering   → Answer type selector + composers
 * - round_complete → "Round Complete" + unlock button
 * - unlocked    → (overlay hides, chat opens)
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  useChatTodStore,
  useGameState,
  useMySkipsRemaining,
  type TodAnswerMeta,
} from '@/stores/chatTodStore';
import { BottleSpin, type BottleSpinUser } from './BottleSpin';
import { VoiceComposer } from './VoiceComposer';
import type { TodPrompt, TodProfileVisibility } from '@/types';

const C = INCOGNITO_COLORS;
const CURRENT_USER_ID = 'me';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatTodUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface ChatTodOverlayProps {
  /** Conversation ID */
  conversationId: string;
  /** The two users [currentUser, otherUser] */
  users: [ChatTodUser, ChatTodUser];
  /** Called when mandatory round is complete and chat should unlock */
  onUnlock: () => void;
  /** Called when user wants to answer with camera (navigate to camera-composer) */
  onOpenCamera: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChatTodOverlay({
  conversationId,
  users,
  onUnlock,
  onOpenCamera,
}: ChatTodOverlayProps) {
  const insets = useSafeAreaInsets();

  // Store state
  const game = useGameState(conversationId);
  const mySkipsRemaining = useMySkipsRemaining(conversationId);

  // Store actions
  const initGame = useChatTodStore((s) => s.initGame);
  const spinBottle = useChatTodStore((s) => s.spinBottle);
  const completeSpinAnimation = useChatTodStore((s) => s.completeSpinAnimation);
  const chooseTruthOrDare = useChatTodStore((s) => s.chooseTruthOrDare);
  const setPrompt = useChatTodStore((s) => s.setPrompt);
  const submitAnswer = useChatTodStore((s) => s.submitAnswer);
  const useSkip = useChatTodStore((s) => s.useSkip);
  const completeMandatoryRound = useChatTodStore((s) => s.completeMandatoryRound);

  // Local UI state
  const [promptText, setPromptText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);

  // Initialize game if needed
  React.useEffect(() => {
    if (!game) {
      initGame(conversationId, [users[0].id, users[1].id]);
    }
  }, [game, conversationId, users, initGame]);

  // Convert users to BottleSpin format
  const bottleUsers: [BottleSpinUser, BottleSpinUser] = useMemo(
    () => [
      { id: users[0].id, name: users[0].name, avatarUrl: users[0].avatarUrl },
      { id: users[1].id, name: users[1].name, avatarUrl: users[1].avatarUrl },
    ],
    [users]
  );

  // Determine winner ID for bottle spin (random, but we need to pass it)
  const [spinWinnerId, setSpinWinnerId] = useState<string | null>(null);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleSpinBottle = useCallback(() => {
    // Pre-determine winner before animation starts
    const randomWinner = Math.random() < 0.5 ? users[0].id : users[1].id;
    setSpinWinnerId(randomWinner);
    spinBottle(conversationId);
  }, [conversationId, users, spinBottle]);

  const handleSpinEnd = useCallback(
    (winnerId: string) => {
      completeSpinAnimation(conversationId);
    },
    [conversationId, completeSpinAnimation]
  );

  const handleChooseTruth = useCallback(() => {
    chooseTruthOrDare(conversationId, 'truth');
  }, [conversationId, chooseTruthOrDare]);

  const handleChooseDare = useCallback(() => {
    chooseTruthOrDare(conversationId, 'dare');
  }, [conversationId, chooseTruthOrDare]);

  const handleSkipChoosing = useCallback(() => {
    useSkip(conversationId, CURRENT_USER_ID);
  }, [conversationId, useSkip]);

  const handleSubmitPrompt = useCallback(() => {
    if (promptText.trim().length < 5) return;
    setPrompt(conversationId, promptText.trim());
    setPromptText('');
  }, [conversationId, promptText, setPrompt]);

  const handleSubmitTextAnswer = useCallback(() => {
    if (answerText.trim().length < 1) return;
    const meta: TodAnswerMeta = {
      type: 'text',
      text: answerText.trim(),
    };
    submitAnswer(conversationId, meta);
    setAnswerText('');
  }, [conversationId, answerText, submitAnswer]);

  /**
   * Handle voice answer submission from VoiceComposer.
   * VoiceComposer calls onSubmitAudio(audioUri, durationMs, isAnonymous, profileVisibility)
   */
  const handleSubmitVoiceAnswer = useCallback(
    (audioUri: string, durationMs: number, _isAnonymous: boolean, _profileVisibility: TodProfileVisibility) => {
      const meta: TodAnswerMeta = {
        type: 'voice',
        mediaUri: audioUri,
        durationSec: Math.ceil(durationMs / 1000),
      };
      submitAnswer(conversationId, meta);
      setShowVoiceRecorder(false);
    },
    [conversationId, submitAnswer]
  );

  /**
   * Create a fake TodPrompt object for VoiceComposer display.
   * VoiceComposer requires a TodPrompt to show the prompt text.
   */
  const fakeTodPrompt: TodPrompt | null = useMemo(() => {
    if (!game || !game.promptText || !game.promptType) return null;
    return {
      id: `tod_${conversationId}_${game.currentRound}`,
      text: game.promptText,
      type: game.promptType,
      ownerUserId: game.chooserUserId || '',
      ownerName: users.find((u) => u.id === game.chooserUserId)?.name || 'Anonymous',
      ownerPhotoUrl: users.find((u) => u.id === game.chooserUserId)?.avatarUrl,
      createdAt: Date.now(),
      answerCount: 0,
      activeCount: 0,
      isTrending: false,
    };
  }, [game, conversationId, users]);

  /**
   * Poll for camera answer return.
   * When user comes back from camera-composer with a T&D answer,
   * it saves to AsyncStorage with key 'tod_camera_answer_{conversationId}'
   */
  useEffect(() => {
    if (game?.roundPhase !== 'answering') return;

    const checkForCameraAnswer = async () => {
      try {
        const key = `tod_camera_answer_${conversationId}`;
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const data = JSON.parse(raw) as { type: 'photo' | 'video'; mediaUri: string; durationSec?: number };
          // Clear immediately to prevent re-processing
          await AsyncStorage.removeItem(key);

          const meta: TodAnswerMeta = {
            type: data.type,
            mediaUri: data.mediaUri,
            durationSec: data.durationSec,
          };
          submitAnswer(conversationId, meta);

          if (__DEV__) {
            console.log('[ChatTodOverlay] Camera answer received:', data.type);
          }
        }
      } catch (error) {
        if (__DEV__) {
          console.error('[ChatTodOverlay] Error checking camera answer:', error);
        }
      }
    };

    // Check immediately and then poll every second
    checkForCameraAnswer();
    const interval = setInterval(checkForCameraAnswer, 1000);
    return () => clearInterval(interval);
  }, [game?.roundPhase, conversationId, submitAnswer]);

  const handleSkipAnswering = useCallback(() => {
    useSkip(conversationId, CURRENT_USER_ID);
  }, [conversationId, useSkip]);

  const handleUnlockChat = useCallback(() => {
    completeMandatoryRound(conversationId);
    onUnlock();
  }, [conversationId, completeMandatoryRound, onUnlock]);

  // ─── Render Phases ─────────────────────────────────────────────────────────

  if (!game) {
    return (
      <View style={[styles.overlay, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Don't render if already unlocked
  if (game.isMandatoryComplete || game.roundPhase === 'unlocked') {
    return null;
  }

  const isMyTurnToChoose = game.chooserUserId === CURRENT_USER_ID;
  const isMyTurnToAnswer = game.responderUserId === CURRENT_USER_ID;
  const otherUser = users.find((u) => u.id !== CURRENT_USER_ID) || users[1];

  return (
    <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Ionicons name="game-controller" size={24} color={C.primary} />
            <Text style={styles.headerTitle}>Truth or Dare</Text>
          </View>
          <Text style={styles.headerSubtitle}>
            Play one round to unlock the chat
          </Text>

          {/* ─── IDLE: Spin Button ─── */}
          {game.roundPhase === 'idle' && (
            <View style={styles.phaseContainer}>
              <Text style={styles.phaseTitle}>Ready to play?</Text>
              <Text style={styles.phaseHint}>
                Spin the bottle to see who goes first
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSpinBottle}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={20} color="#FFF" />
                <Text style={styles.primaryButtonText}>Spin the Bottle</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ─── SPINNING: Bottle Animation ─── */}
          {game.roundPhase === 'spinning' && spinWinnerId && (
            <View style={styles.phaseContainer}>
              <BottleSpin
                users={bottleUsers}
                winnerId={spinWinnerId}
                isSpinning={true}
                onSpinEnd={handleSpinEnd}
              />
            </View>
          )}

          {/* ─── CHOOSING: Truth / Dare / Skip ─── */}
          {game.roundPhase === 'choosing' && (
            <View style={styles.phaseContainer}>
              {isMyTurnToChoose ? (
                <>
                  <Text style={styles.phaseTitle}>Your turn!</Text>
                  <Text style={styles.phaseHint}>
                    Choose Truth or Dare for {otherUser.name}
                  </Text>

                  <View style={styles.choiceRow}>
                    <TouchableOpacity
                      style={[styles.choiceButton, styles.truthButton]}
                      onPress={handleChooseTruth}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="chatbubble-ellipses" size={28} color="#FFF" />
                      <Text style={styles.choiceButtonText}>Truth</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.choiceButton, styles.dareButton]}
                      onPress={handleChooseDare}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="flash" size={28} color="#FFF" />
                      <Text style={styles.choiceButtonText}>Dare</Text>
                    </TouchableOpacity>
                  </View>

                  {mySkipsRemaining > 0 && (
                    <TouchableOpacity
                      style={styles.skipButton}
                      onPress={handleSkipChoosing}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.skipButtonText}>
                        Skip ({mySkipsRemaining} left)
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.phaseTitle}>{otherUser.name}'s turn</Text>
                  <Text style={styles.phaseHint}>
                    Waiting for them to choose Truth or Dare...
                  </Text>
                  <View style={styles.waitingIndicator}>
                    <Ionicons name="hourglass" size={32} color={C.textLight} />
                  </View>
                </>
              )}
            </View>
          )}

          {/* ─── WRITING: Prompt Input ─── */}
          {game.roundPhase === 'writing' && (
            <View style={styles.phaseContainer}>
              {isMyTurnToChoose ? (
                <>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>
                      {game.promptType === 'truth' ? 'TRUTH' : 'DARE'}
                    </Text>
                  </View>
                  <Text style={styles.phaseTitle}>
                    Write your {game.promptType}
                  </Text>
                  <Text style={styles.phaseHint}>
                    Ask {otherUser.name} anything
                  </Text>

                  <TextInput
                    style={styles.promptInput}
                    placeholder={
                      game.promptType === 'truth'
                        ? "e.g., What's your biggest secret?"
                        : "e.g., Send a voice message singing"
                    }
                    placeholderTextColor={C.textLight}
                    value={promptText}
                    onChangeText={setPromptText}
                    multiline
                    maxLength={200}
                    textAlignVertical="top"
                  />
                  <Text style={styles.charCount}>{promptText.length}/200</Text>

                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      promptText.trim().length < 5 && styles.primaryButtonDisabled,
                    ]}
                    onPress={handleSubmitPrompt}
                    disabled={promptText.trim().length < 5}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.primaryButtonText}>Send</Text>
                    <Ionicons name="send" size={18} color="#FFF" />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.phaseTitle}>{otherUser.name} is writing</Text>
                  <Text style={styles.phaseHint}>
                    They're creating a {game.promptType} for you...
                  </Text>
                  <View style={styles.waitingIndicator}>
                    <Ionicons name="create" size={32} color={C.textLight} />
                  </View>
                </>
              )}
            </View>
          )}

          {/* ─── ANSWERING: Answer Input ─── */}
          {game.roundPhase === 'answering' && (
            <View style={styles.phaseContainer}>
              {isMyTurnToAnswer ? (
                <>
                  <View
                    style={[
                      styles.typeBadge,
                      game.promptType === 'dare' && styles.typeBadgeDare,
                    ]}
                  >
                    <Text style={styles.typeBadgeText}>
                      {game.promptType === 'truth' ? 'TRUTH' : 'DARE'}
                    </Text>
                  </View>

                  <Text style={styles.promptDisplay}>{game.promptText}</Text>
                  <Text style={styles.promptFrom}>— from {otherUser.name}</Text>

                  {/* Answer Type Selector */}
                  <View style={styles.answerTypeRow}>
                    <TouchableOpacity
                      style={styles.answerTypeButton}
                      onPress={() => {}}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="create-outline" size={24} color={C.primary} />
                      <Text style={styles.answerTypeText}>Text</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.answerTypeButton}
                      onPress={() => setShowVoiceRecorder(true)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="mic-outline" size={24} color="#FF9800" />
                      <Text style={styles.answerTypeText}>Voice</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.answerTypeButton}
                      onPress={onOpenCamera}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="camera-outline" size={24} color="#E94560" />
                      <Text style={styles.answerTypeText}>Camera</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Text Answer Input (default visible) */}
                  {!showVoiceRecorder && (
                    <>
                      <TextInput
                        style={styles.answerInput}
                        placeholder="Type your answer..."
                        placeholderTextColor={C.textLight}
                        value={answerText}
                        onChangeText={setAnswerText}
                        multiline
                        maxLength={500}
                        textAlignVertical="top"
                      />

                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          answerText.trim().length < 1 && styles.primaryButtonDisabled,
                        ]}
                        onPress={handleSubmitTextAnswer}
                        disabled={answerText.trim().length < 1}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.primaryButtonText}>Submit Answer</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {/* Voice recorder hint when selected */}
                  {showVoiceRecorder && (
                    <View style={styles.voiceRecorderHint}>
                      <Ionicons name="mic" size={32} color={C.primary} />
                      <Text style={styles.voiceHintText}>
                        Recording panel open below...
                      </Text>
                    </View>
                  )}

                  {mySkipsRemaining > 0 && (
                    <TouchableOpacity
                      style={styles.skipButton}
                      onPress={handleSkipAnswering}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.skipButtonText}>
                        Skip ({mySkipsRemaining} left)
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <>
                  <View
                    style={[
                      styles.typeBadge,
                      game.promptType === 'dare' && styles.typeBadgeDare,
                    ]}
                  >
                    <Text style={styles.typeBadgeText}>
                      {game.promptType === 'truth' ? 'TRUTH' : 'DARE'}
                    </Text>
                  </View>
                  <Text style={styles.promptDisplay}>{game.promptText}</Text>
                  <Text style={styles.phaseHint}>
                    Waiting for {otherUser.name} to answer...
                  </Text>
                  <View style={styles.waitingIndicator}>
                    <Ionicons name="hourglass" size={32} color={C.textLight} />
                  </View>
                </>
              )}
            </View>
          )}

          {/* ─── ROUND COMPLETE: Unlock Chat ─── */}
          {game.roundPhase === 'round_complete' && (
            <View style={styles.phaseContainer}>
              <Ionicons name="checkmark-circle" size={64} color={C.primary} />
              <Text style={styles.completeTitle}>Round Complete!</Text>
              <Text style={styles.completeHint}>
                You can now chat freely with {otherUser.name}
              </Text>

              {/* Show last answer summary */}
              {game.lastAnswer && (
                <View style={styles.answerSummary}>
                  <Text style={styles.answerSummaryLabel}>
                    {game.promptType === 'truth' ? 'Truth' : 'Dare'}:{' '}
                    <Text style={styles.answerSummaryPrompt}>{game.promptText}</Text>
                  </Text>
                  {game.lastAnswer.type === 'text' && (
                    <Text style={styles.answerSummaryText}>
                      "{game.lastAnswer.text}"
                    </Text>
                  )}
                  {game.lastAnswer.type === 'voice' && (
                    <Text style={styles.answerSummaryMeta}>
                      Voice answer ({game.lastAnswer.durationSec}s)
                    </Text>
                  )}
                  {(game.lastAnswer.type === 'photo' || game.lastAnswer.type === 'video') && (
                    <Text style={styles.answerSummaryMeta}>
                      {game.lastAnswer.type === 'photo' ? 'Photo' : 'Video'} answer
                    </Text>
                  )}
                </View>
              )}

              <TouchableOpacity
                style={styles.unlockButton}
                onPress={handleUnlockChat}
                activeOpacity={0.8}
              >
                <Ionicons name="lock-open" size={20} color="#FFF" />
                <Text style={styles.unlockButtonText}>Start Chatting</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* VoiceComposer Modal - renders above everything */}
      <VoiceComposer
        visible={showVoiceRecorder}
        prompt={fakeTodPrompt}
        onClose={() => setShowVoiceRecorder(false)}
        onSubmitAudio={handleSubmitVoiceAnswer}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.background,
    zIndex: 100,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  loadingText: {
    color: C.textLight,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 100,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
  },
  headerSubtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },

  // Phase Container
  phaseContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  phaseTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  phaseHint: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },

  // Primary Button
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    marginTop: 16,
  },
  primaryButtonDisabled: {
    backgroundColor: C.surface,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },

  // Choice Buttons (Truth / Dare)
  choiceRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  choiceButton: {
    width: 120,
    height: 120,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  truthButton: {
    backgroundColor: '#6C5CE7',
  },
  dareButton: {
    backgroundColor: '#E17055',
  },
  choiceButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },

  // Skip Button
  skipButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  skipButtonText: {
    fontSize: 14,
    color: C.textLight,
    textDecorationLine: 'underline',
  },

  // Waiting Indicator
  waitingIndicator: {
    marginTop: 20,
    opacity: 0.6,
  },

  // Type Badge
  typeBadge: {
    backgroundColor: '#6C5CE7',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 16,
  },
  typeBadgeDare: {
    backgroundColor: '#E17055',
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 1,
  },

  // Prompt Input
  promptInput: {
    width: '100%',
    minHeight: 100,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: C.text,
    textAlignVertical: 'top',
    marginTop: 8,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
    alignSelf: 'flex-end',
    marginTop: 4,
    marginBottom: 8,
  },

  // Prompt Display
  promptDisplay: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  promptFrom: {
    fontSize: 13,
    color: C.textLight,
    fontStyle: 'italic',
    marginBottom: 24,
  },

  // Answer Type Selector
  answerTypeRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  answerTypeButton: {
    alignItems: 'center',
    gap: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.surface,
    minWidth: 70,
  },
  answerTypeText: {
    fontSize: 12,
    color: C.text,
    fontWeight: '500',
  },

  // Answer Input
  answerInput: {
    width: '100%',
    minHeight: 80,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: C.text,
    textAlignVertical: 'top',
    marginBottom: 8,
  },

  // Voice Recorder Hint (shown when voice modal is open)
  voiceRecorderHint: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: C.surface,
    borderRadius: 12,
    width: '100%',
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  voiceHintText: {
    fontSize: 13,
    color: C.textLight,
    fontStyle: 'italic',
  },

  // Complete Phase
  completeTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    marginTop: 16,
    marginBottom: 8,
  },
  completeHint: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },
  answerSummary: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
  },
  answerSummaryLabel: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 8,
  },
  answerSummaryPrompt: {
    color: C.text,
    fontWeight: '500',
  },
  answerSummaryText: {
    fontSize: 15,
    color: C.text,
    fontStyle: 'italic',
  },
  answerSummaryMeta: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '500',
  },

  // Unlock Button
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  unlockButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFF',
  },
});

export default ChatTodOverlay;
