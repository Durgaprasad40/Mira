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
import { deriveMyRole } from '@/lib/bottleSpin';

const MAX_SKIPS = 3;

const getSafeIdTail = (value?: string | null): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(-6) : undefined;

// PHASE-2 PREMIUM (T/D): dark-glass / midnight-plum palette consumed only when
// the parent passes theme="phase2". Phase-1 callers (ChatScreenInner.tsx) leave
// the prop unset so all overlays evaluate to null and the original COLORS-based
// styles render byte-identically. Mirrors the cohesive Phase-2 Messages palette.
const PHASE2_TD = {
  containerBg: '#22223A',
  containerBorder: 'rgba(255, 255, 255, 0.08)',
  glow: '#E94560',
  text: '#F2F3F8',
  textMuted: 'rgba(224, 224, 232, 0.68)',
  rose: '#E94560',
  roseSoft: 'rgba(233, 69, 96, 0.18)',
  neutralCard: '#262943',
  border: 'rgba(255, 255, 255, 0.10)',
  borderSoft: 'rgba(255, 255, 255, 0.06)',
  toastBg: 'rgba(15, 12, 30, 0.92)',
  spinButtonBg: '#E94560',
  skipDotInactive: 'rgba(255, 255, 255, 0.12)',
  modalOverlay: 'rgba(8, 6, 16, 0.78)',
  endGameBg: 'rgba(233, 69, 96, 0.14)',
  endGameBorder: 'rgba(233, 69, 96, 0.40)',
  endGameText: '#FF8A9B',
  errorRed: '#FF6B7A',
} as const;

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
  /**
   * PHASE-1 MESSAGES OPTION B: when true, replaces the blocking 'complete'
   * screen with a non-blocking result toast and auto-advances the backend
   * turn phase from 'complete' back to 'idle' after ~2s. Phase-2 keeps the
   * legacy [Again]/[Done] screen by leaving this prop unset / false.
   */
  autoAdvance?: boolean;
  /**
   * TD_PAUSE: user-initiated cancel (X button, Android back, backdrop). When
   * provided, the Cancel path calls this instead of onClose and intentionally
   * does NOT mutate backend game state. Parent is expected to flip a local
   * "paused" flag so the auto-open effect will not re-force the modal open
   * while the user is intentionally away. If omitted, falls back to onClose.
   */
  onCancel?: () => void;
  /**
   * PHASE-2 PREMIUM (T/D): visual theme. Defaults to 'phase1' so all existing
   * Phase-1 call sites (ChatScreenInner.tsx) keep their byte-identical look.
   * Phase-2 chats/[id].tsx passes 'phase2' to opt-in to the dark / glass /
   * rose styling that matches the rest of the Phase-2 Messages experience.
   * Theme is purely cosmetic — it does NOT affect game logic, turn ownership,
   * timing, dedup, or any backend mutation.
   */
  theme?: 'phase1' | 'phase2';
}

// ═══════════════════════════════════════════════════════════════════════════
// V4 CLEAN UI MODE - Single source of truth for render decisions
// SPIN-TURN-FIX: Added 'waiting_for_spin' for non-turn-owner
// TD-LIFECYCLE: Added 'waiting_for_start' for invitee waiting for inviter to start
// ═══════════════════════════════════════════════════════════════════════════
type UIMode = 'idle' | 'waiting_for_spin' | 'waiting_for_start' | 'observer_spinning_text' | 'spinning_local' | 'choosing_for_me' | 'choosing_for_other' | 'complete';

export function BottleSpinGame({
  visible,
  onClose,
  currentUserName,
  otherUserName,
  conversationId,
  userId,
  onSendResultMessage,
  autoAdvance = false,
  onCancel,
  theme = 'phase1',
}: BottleSpinGameProps) {
  // PHASE-2 PREMIUM (T/D): theme overlays. Each value is null when phase1 so
  // the original COLORS-based styles render byte-identically (RN ignores
  // null/undefined entries in style arrays). Pre-computed once per render.
  const isPhase2Theme = theme === 'phase2';
  const overlayBgOverlay = isPhase2Theme ? { backgroundColor: PHASE2_TD.modalOverlay } : null;
  const containerOverlay = isPhase2Theme
    ? {
        backgroundColor: PHASE2_TD.containerBg,
        borderWidth: 1,
        borderColor: PHASE2_TD.containerBorder,
        shadowColor: PHASE2_TD.glow,
        shadowOpacity: 0.22,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
        elevation: 12,
      }
    : null;
  const titleOverlay = isPhase2Theme ? { color: PHASE2_TD.text } : null;
  const userBadgeOverlay = isPhase2Theme
    ? { backgroundColor: PHASE2_TD.neutralCard, borderColor: 'transparent' }
    : null;
  const userBadgeSelectedOverlay = isPhase2Theme
    ? { backgroundColor: PHASE2_TD.roseSoft, borderColor: PHASE2_TD.rose }
    : null;
  const userBadgeSpinTurnOverlay = isPhase2Theme
    ? { backgroundColor: PHASE2_TD.roseSoft, borderColor: PHASE2_TD.rose }
    : null;
  const userBadgeSpinTurnOtherOverlay = isPhase2Theme
    ? { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.10)' }
    : null;
  const userNameOverlay = isPhase2Theme ? { color: PHASE2_TD.text } : null;
  const userNameSelectedOverlay = isPhase2Theme ? { color: PHASE2_TD.rose } : null;
  const userNameSpinTurnOverlay = isPhase2Theme ? { color: PHASE2_TD.rose } : null;
  const userNameSpinTurnOtherOverlay = isPhase2Theme ? { color: PHASE2_TD.textMuted } : null;
  const turnTextOverlay = isPhase2Theme ? { color: PHASE2_TD.rose } : null;
  const spinTurnTextOverlay = isPhase2Theme ? { color: PHASE2_TD.rose } : null;
  const spinTurnTextOtherOverlay = isPhase2Theme ? { color: PHASE2_TD.textMuted } : null;
  const spinButtonOverlay = isPhase2Theme
    ? {
        backgroundColor: PHASE2_TD.spinButtonBg,
        shadowColor: PHASE2_TD.glow,
        shadowOpacity: 0.45,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      }
    : null;
  const spinningTextOverlay = isPhase2Theme ? { color: PHASE2_TD.textMuted } : null;
  const waitingContentOverlay = isPhase2Theme
    ? {
        backgroundColor: PHASE2_TD.neutralCard,
        borderWidth: 1,
        borderColor: PHASE2_TD.border,
      }
    : null;
  const waitingTextThemeOverlay = isPhase2Theme ? { color: PHASE2_TD.textMuted } : null;
  const waitingNameOverlay = isPhase2Theme ? { color: PHASE2_TD.text } : null;
  const skipChoiceOverlay = isPhase2Theme
    ? {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderColor: 'rgba(255,255,255,0.14)',
      }
    : null;
  const skipChoiceTextOverlay = isPhase2Theme ? { color: PHASE2_TD.text } : null;
  const skipChoiceTextDisabledOverlay = isPhase2Theme ? { color: PHASE2_TD.textMuted } : null;
  const resultContainerOverlay = isPhase2Theme
    ? {
        backgroundColor: PHASE2_TD.neutralCard,
        borderWidth: 1,
        borderColor: PHASE2_TD.border,
      }
    : null;
  const resultTextOverlay = isPhase2Theme ? { color: PHASE2_TD.text } : null;
  const resultNameOverlay = isPhase2Theme ? { color: PHASE2_TD.rose } : null;
  const compactActionButtonOverlay = isPhase2Theme
    ? {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.10)',
      }
    : null;
  const compactActionTextOverlay = isPhase2Theme ? { color: PHASE2_TD.rose } : null;
  const skipDotInactiveOverlay = isPhase2Theme
    ? { backgroundColor: PHASE2_TD.skipDotInactive }
    : null;
  const skipsTextOverlay = isPhase2Theme ? { color: PHASE2_TD.textMuted } : null;
  const bottomRowOverlay = isPhase2Theme ? { borderTopColor: PHASE2_TD.border } : null;
  const endGameButtonOverlay = isPhase2Theme
    ? {
        backgroundColor: PHASE2_TD.endGameBg,
        borderColor: PHASE2_TD.endGameBorder,
      }
    : null;
  const endGameTextOverlay = isPhase2Theme ? { color: PHASE2_TD.endGameText } : null;
  const confirmContainerOverlay = isPhase2Theme
    ? {
        backgroundColor: PHASE2_TD.containerBg,
        borderWidth: 1,
        borderColor: PHASE2_TD.containerBorder,
      }
    : null;
  const confirmTitleOverlay = isPhase2Theme ? { color: PHASE2_TD.text } : null;
  const confirmMessageOverlay = isPhase2Theme ? { color: PHASE2_TD.textMuted } : null;
  const confirmButtonNoOverlay = isPhase2Theme
    ? {
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderColor: 'rgba(255,255,255,0.14)',
      }
    : null;
  const confirmButtonNoTextOverlay = isPhase2Theme ? { color: PHASE2_TD.text } : null;
  const resultToastOverlay = isPhase2Theme
    ? {
        backgroundColor: PHASE2_TD.toastBg,
        borderWidth: 1,
        borderColor: 'rgba(233, 69, 96, 0.32)',
      }
    : null;
  // ═══════════════════════════════════════════════════════════════════════════
  // LOCAL STATE - Only for animation and UI helpers, NOT for turn ownership
  // ═══════════════════════════════════════════════════════════════════════════
  const [isSpinningLocally, setIsSpinningLocally] = useState(false);
  const [chosenOption, setChosenOption] = useState<'truth' | 'dare' | 'skip' | null>(null);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);

  // TD-FLOW (Option B): result toast + auto-advance timer state. Only active
  // when autoAdvance === true (Phase-1 Messages). Phase-2 behavior unchanged.
  const [toastInfo, setToastInfo] = useState<{ text: string; key: number } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinCompleteCloseFiredForActionRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);

  // Stale callback guard: increments on reset, animation checks before applying
  const spinSessionRef = useRef(0);

  // TD_LIVE: dedup refs — a single 'complete' event (identified by
  // backendLastActionAt) must only fire ONE observer toast and ONE auto-advance
  // mutation regardless of how many times the effects re-run.
  const toastFiredForActionRef = useRef<number | null>(null);
  const autoAdvanceFiredForActionRef = useRef<number | null>(null);
  // TD_SPIN: dedup ref for observer-side no-animation sync. We only record one
  // deterministic landing angle per distinct backendLastActionAt.
  const observerSpinFiredForActionRef = useRef<number | null>(null);
  // TD_LIVE: previous uiMode, used for single-shot phase_map / transition logs.
  const prevUiModeRef = useRef<UIMode | null>(null);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const currentRotation = useRef(0);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // ═══════════════════════════════════════════════════════════════════════════
  // BACKEND STATE - Single source of truth for turn ownership
  // ═══════════════════════════════════════════════════════════════════════════
  const gameSession = useQuery(
    api.games.getBottleSpinSession,
    visible && conversationId && userId ? { conversationId, authUserId: userId } : 'skip'
  );
  const setTurnMutation = useMutation(api.games.setBottleSpinTurn);

  // Extract backend values (only when session is active)
  const isSessionActive = gameSession?.state === 'active';
  const backendTurnRole = isSessionActive ? gameSession.currentTurnRole : undefined;
  const backendTurnPhase = isSessionActive ? gameSession.turnPhase : undefined;
  // SPIN-TURN-FIX: Extract spinTurnRole from backend
  const backendSpinTurnRole = isSessionActive ? gameSession.spinTurnRole : undefined;
  // TD-FLOW (Option B): observer needs last chosen result to show the toast
  const backendLastSpinResult = isSessionActive ? gameSession.lastSpinResult : undefined;
  // TD_LIVE: lastActionAt is bumped by the backend on every turn mutation and
  // is the stable dedup key for a single completion event across re-renders.
  const backendLastActionAt = isSessionActive ? gameSession.lastActionAt : undefined;
  const inviterId = isSessionActive ? gameSession.inviterId : undefined;
  const inviteeId = isSessionActive ? gameSession.inviteeId : undefined;
  // TD-LIFECYCLE: Extract gameStartedAt for manual start check
  const gameStartedAt = isSessionActive ? gameSession.gameStartedAt : undefined;
  const hasGameStarted = !!gameStartedAt;
  // NOTE: lastSelectedRole and consecutiveSelectedCount are handled entirely in backend
  // Frontend does NOT need these values - all random selection logic is backend-only

  // ═══════════════════════════════════════════════════════════════════════════
  // ROLE DETERMINATION - Am I inviter or invitee?
  // ═══════════════════════════════════════════════════════════════════════════
  // inviterId is the auth ID stored when invite was sent
  // userId is my auth ID passed from parent
  const myRole = deriveMyRole(gameSession, userId);
  const amIInviter = myRole === 'inviter';
  const amIInvitee = myRole === 'invitee';

  // ═══════════════════════════════════════════════════════════════════════════
  // SPIN TURN OWNERSHIP - SPIN-TURN-FIX
  // ═══════════════════════════════════════════════════════════════════════════
  // Determine if it's my turn to spin (only relevant in idle phase)
  const currentSpinTurnRole = backendSpinTurnRole || 'inviter'; // Default to inviter if not set
  const isMySpinTurn = myRole === currentSpinTurnRole;

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATION LOCK - Disable all actions during spin animation
  // ═══════════════════════════════════════════════════════════════════════════
  const isAnimationLocked = isSpinningLocally || backendTurnPhase === 'spinning';

  // ═══════════════════════════════════════════════════════════════════════════
  // UI MODE DERIVATION - THE SINGLE SOURCE OF TRUTH FOR RENDERING
  // SPIN-TURN-FIX: Added 'waiting_for_spin' when it's not my turn
  // TD-LIFECYCLE: Added 'waiting_for_start' when game hasn't started yet
  // ═══════════════════════════════════════════════════════════════════════════
  const uiMode: UIMode = (() => {
    // Priority 1: Local spinning animation takes precedence
    if (isSpinningLocally) {
      return 'spinning_local';
    }

    // Priority 2: No active session = idle (button still shown but backend will reject)
    if (!isSessionActive) {
      return 'idle';
    }

    // TD-LIFECYCLE Priority 2.5: Game not started yet - invitee waits for inviter
    // If session is active but gameStartedAt is not set, show waiting state for invitee
    if (!hasGameStarted && amIInvitee) {
      if (__DEV__) {
        console.log('[TD_LIFECYCLE] Invitee waiting for game to start:', {
          hasGameStarted,
          gameStartedAt,
          amIInvitee,
        });
      }
      return 'waiting_for_start';
    }

    // TD-LIFECYCLE: If inviter and game not started, show idle (they can start)
    if (!hasGameStarted && amIInviter) {
      if (__DEV__) {
        console.log('[TD_LIFECYCLE] Inviter can start game:', {
          hasGameStarted,
          gameStartedAt,
          amIInviter,
        });
      }
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
      // TD-FLOW (Option B): autoAdvance mode never renders a blocking
      // 'complete' screen. The choice result is surfaced via a floating
      // toast, and the visible game state falls through to idle / waiting
      // for the next spin. Backend has already rotated spinTurnRole, so
      // this correctly hands off to the other player visually.
      if (autoAdvance) {
        if (!isMySpinTurn && myRole) {
          return 'waiting_for_spin';
        }
        return 'idle';
      }
      return 'complete';
    }

    // Priority 5: Backend says spinning (other device is spinning)
    if (backendTurnPhase === 'spinning') {
      if (!isSpinningLocally && !isMySpinTurn) {
        return 'observer_spinning_text';
      }
      return 'spinning_local';
    }

    // Priority 6: Idle phase - check spin turn ownership
    // SPIN-TURN-FIX: Show waiting state if not my spin turn
    if (backendTurnPhase === 'idle' || backendTurnPhase === undefined) {
      // ROLE-FIX: Log uiMode decision for debugging
      if (__DEV__) {
        console.log('[BOTTLE_SPIN_UIMODE_DECISION] Idle phase check:', {
          isMySpinTurn,
          myRole,
          currentSpinTurnRole,
          backendSpinTurnRole,
          hasGameStarted,
          decision: (!isMySpinTurn && myRole) ? 'waiting_for_spin' : 'idle',
        });
      }
      if (!isMySpinTurn && myRole) {
        return 'waiting_for_spin';
      }
      return 'idle';
    }

    // Default: idle
    return 'idle';
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUG LOGGING - Comprehensive state trace for both devices
  // SPIN-TURN-FIX: Added spin turn ownership logging
  // FIX: Removed gameSession object reference from deps to prevent array size issues
  // ═══════════════════════════════════════════════════════════════════════════
  // Derive gameSession state as primitive for stable dependency
  const gameSessionState = gameSession?.state ?? 'unknown';

  useEffect(() => {
    if (visible && __DEV__) {
      console.log('[BOTTLE_SPIN_DEBUG] State trace:', {
        // Session info (primitives only)
        gameSessionState,
        isSessionActive,
        // Sanitized IDs
        userRef: getSafeIdTail(userId),
        inviterRef: getSafeIdTail(inviterId),
        inviteeRef: getSafeIdTail(inviteeId),
        // Role determination
        myRole: myRole ?? 'none',
        // Backend turn state
        backendTurnRole: backendTurnRole ?? 'none',
        backendTurnPhase: backendTurnPhase ?? 'none',
        // SPIN-TURN-FIX: Spin turn ownership
        backendSpinTurnRole: backendSpinTurnRole ?? 'none',
        currentSpinTurnRole,
        isMySpinTurn,
        // Local state
        isSpinningLocally,
        isAnimationLocked,
        // DERIVED UI MODE
        uiMode,
      });
    }
  // FIX: Fixed dependency array - only primitive values, stable count (15 items)
  }, [visible, gameSessionState, isSessionActive, userId, inviterId, inviteeId, myRole, backendTurnRole, backendTurnPhase, backendSpinTurnRole, currentSpinTurnRole, isMySpinTurn, isSpinningLocally, isAnimationLocked, uiMode]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TD_LIVE: single-shot transition logs + per-phase entry logs
  // Fires once per uiMode transition so log volume stays bounded even as
  // other effects re-evaluate. Keep behind __DEV__ guard.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!visible) {
      prevUiModeRef.current = null;
      return;
    }
    if (prevUiModeRef.current === uiMode) return;
    const prev = prevUiModeRef.current;
    prevUiModeRef.current = uiMode;
    if (__DEV__) {
      console.log('[TD_LIVE] phase_map', {
        from: prev ?? 'init',
        to: uiMode,
        backendTurnPhase,
        backendTurnRole,
        backendSpinTurnRole,
        myRole,
      });
      if (uiMode === 'spinning_local') {
        console.log('[TD_LIVE] show_spinning', { asSpinner: isSpinningLocally });
      } else if (uiMode === 'observer_spinning_text') {
        console.log('[TD_LIVE] show_observer_spinning_text', {
          hasOtherName: otherUserName.length > 0,
        });
      } else if (uiMode === 'choosing_for_me') {
        console.log('[TD_LIVE] show_choose_buttons', {
          backendTurnRole,
          myRole,
        });
      } else if (uiMode === 'choosing_for_other') {
        console.log('[TD_LIVE] show_waiting_for_choice', {
          hasOtherName: otherUserName.length > 0,
          backendTurnRole,
          myRole,
        });
        // Spinner who landed the bottle on the other user transitions
        // spinning_local → choosing_for_other automatically; log that the
        // blocking spinner UI has been auto-closed/replaced with waiting UI.
        if (prev === 'spinning_local') {
          console.log('[TD_LIVE] auto_close_spinner_modal', {
            reason: 'spin_landed_on_other',
          });
        }
      }
    }
  }, [
    visible,
    uiMode,
    backendTurnPhase,
    backendTurnRole,
    backendSpinTurnRole,
    myRole,
    isSpinningLocally,
    otherUserName,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TD_SPIN: OBSERVER-SIDE NO-ANIMATION SYNC
  //
  // The spinner device owns the bottle animation. The receiver device shows a
  // text-only "is spinning" status and records the deterministic final angle so
  // the next phase is aligned without running Animated.timing locally.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!visible) return;
    if (isSpinningLocally) return; // chooser-side spin owns the animation
    if (backendTurnPhase !== 'spinning') return;
    if (!backendLastActionAt) return;
    if (!backendTurnRole) return; // currentTurnRole not yet surfaced
    if (!myRole) return;

    // TD_SPIN: dedup — never restart an animation for the same backend event.
    if (observerSpinFiredForActionRef.current === backendLastActionAt) {
      if (__DEV__) {
        console.log('[TD_SPIN] skip_duplicate', {
          backendLastActionAt,
          reason: 'already_animated_for_this_action',
        });
      }
      return;
    }
    observerSpinFiredForActionRef.current = backendLastActionAt;

    // TD_SPIN: deterministic landing angle — matches chooser-side mapping
    // (finalAngle = landsOnMe ? 0 : 180) so both devices land identically.
    const landsOnMe = backendTurnRole === myRole;
    const finalAngle = landsOnMe ? 0 : 180;
    currentRotation.current = finalAngle;
    spinAnim.setValue(finalAngle);

    if (__DEV__) {
      console.log('[TD_SPIN] observer_no_animation', {
        finalAngle,
        lastActionAt: backendLastActionAt,
      });
    }
  }, [
    visible,
    backendTurnPhase,
    backendTurnRole,
    backendLastActionAt,
    isSpinningLocally,
    myRole,
    spinAnim,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TD-FLOW (Option B): AUTO-CLOSE AFTER SPIN RESULT IS KNOWN
  // Once backend moves from spinning to choosing, the spin result is known.
  // Close the Phase-1 Messages popup immediately instead of waiting for the
  // selected user to choose Truth/Dare/Skip.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!autoAdvance) return;
    if (!visible) return;
    if (backendTurnPhase !== 'choosing') return;
    if (!backendTurnRole) return;
    if (backendTurnRole === myRole) return;
    if (!backendLastActionAt) return;
    if (spinCompleteCloseFiredForActionRef.current === backendLastActionAt) return;

    spinCompleteCloseFiredForActionRef.current = backendLastActionAt;
    if (__DEV__) {
      console.log('[TD_LIVE] auto_close_after_spin_complete', {
        lastActionAt: backendLastActionAt,
        turnRole: backendTurnRole,
      });
    }

    const timeout = setTimeout(() => {
      onCloseRef.current();
    }, 125);

    return () => {
      clearTimeout(timeout);
    };
  }, [autoAdvance, visible, backendTurnPhase, backendTurnRole, myRole, backendLastActionAt]);

  // TD-FLOW (Option B) + TD_LIVE: OBSERVER TOAST (deduped per lastActionAt)
  // When the OTHER player makes a choice, backend turnPhase flips to 'complete'
  // with lastSpinResult set. On the observer device, chosenOption is still null
  // (we only set it for the chooser in handleChoice). Show a toast for them too
  // so both players see the outcome before the modal auto-advances to idle.
  //
  // Dedup: a single 'complete' event has a unique backendLastActionAt. We only
  // fire the observer toast once per distinct lastActionAt so React re-renders
  // cannot re-trigger it.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!autoAdvance) return;
    if (!visible) return;
    if (backendTurnPhase !== 'complete') return;
    if (!backendLastSpinResult) return;
    if (!backendLastActionAt) return;
    // Only trigger for observer side; chooser toast already set in handleChoice
    if (chosenOption) return;
    if (toastFiredForActionRef.current === backendLastActionAt) return;
    toastFiredForActionRef.current = backendLastActionAt;

    const result = backendLastSpinResult;
    const text =
      result === 'skip'
        ? `${otherUserName} skipped 😅`
        : result === 'truth'
          ? `${otherUserName} chose TRUTH 🔥`
          : `${otherUserName} chose DARE 😈`;
    if (__DEV__) {
      console.log('[TD_FLOW] result_toast_show', { result, byChooser: false });
      console.log('[TD_LIVE] complete_toast', {
        result,
        byChooser: false,
        lastActionAt: backendLastActionAt,
      });
    }
    setToastInfo({ text, key: Date.now() });
  }, [autoAdvance, visible, backendTurnPhase, backendLastSpinResult, backendLastActionAt, chosenOption, otherUserName]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TD-FLOW (Option B): TOAST FADE ANIMATION
  // Keyed on toastInfo?.key so the same text can re-trigger. Fades in, holds,
  // fades out, then clears toastInfo. Runs purely on the JS-driver-free
  // opacity value (useNativeDriver: true) so it won't interfere with layout.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!toastInfo) return;
    toastOpacity.setValue(0);
    const seq = Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(toastOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]);
    seq.start(({ finished }) => {
      if (finished) setToastInfo(null);
    });
    return () => {
      seq.stop();
    };
  }, [toastInfo, toastOpacity]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TD-FLOW (Option B): UNMOUNT CLEANUP
  // Make sure any pending auto-advance timer is cleared if the component is
  // torn down (user closes chat, navigates away, etc.).
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        if (__DEV__) console.log('[TD_LIVE] auto_advance_cleanup_on_unmount');
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, []);

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
      if (__DEV__) console.warn('[BOTTLE_SPIN] Failed to increment skip count:', error);
    }
  }, [userId, windowKey, incrementSkipMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // GAME ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  const resetGame = useCallback(async () => {
    if (__DEV__) {
      // TD_END_TRACE: resetGame only mutates turnPhase to 'idle'. It does NOT
      // end the session or set cooldown — logged here for triage visibility.
      console.log('[TD_END_TRACE] reset_game_called', {
        autoAdvance,
        hasPendingAutoAdvance: !!autoAdvanceTimerRef.current,
      });
    }
    spinSessionRef.current += 1;
    setIsSpinningLocally(false);
    setChosenOption(null);
    setShowEndConfirmation(false);
    spinCompleteCloseFiredForActionRef.current = null;
    // TD-FLOW (Option B): clear pending toast + auto-advance timer on reset
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setToastInfo(null);
    toastOpacity.setValue(0);
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
  }, [spinAnim, userId, conversationId, setTurnMutation, toastOpacity, autoAdvance]);

  // TD_PAUSE: Cancel = UI close only. Does NOT reset the game. Does NOT mutate
  // backend state. Does NOT trigger a spin. Parent receives onCancel (falls
  // back to onClose when not supplied) and is responsible for setting its
  // local paused flag so the auto-open effect does not immediately reopen the
  // modal for the chooser.
  const handleCancel = useCallback(() => {
    if (__DEV__) {
      console.log('[TD_PAUSE] user_paused', {
        reason: 'cancel_button_or_backdrop',
        backendTurnPhase,
        backendTurnRole,
        myRole,
      });
    }
    if (onCancel) {
      onCancel();
    } else {
      onClose();
    }
  }, [onCancel, onClose, backendTurnPhase, backendTurnRole, myRole]);

  // Kept for the Phase-2 legacy [Done] button on the post-result screen where
  // the user has explicitly finished a round and wants the game returned to
  // idle. autoAdvance=true path never reaches this branch in normal flow
  // (auto-advance timer handles the idle transition) but leaving the reset
  // preserves Phase-2 behavior.
  const handleFinishRound = useCallback(() => {
    resetGame();
    onClose();
  }, [resetGame, onClose]);

  const handleEndGamePress = useCallback(() => {
    setShowEndConfirmation(true);
  }, []);

  const handleEndGameConfirm = useCallback(() => {
    if (__DEV__) {
      // TD_END_TRACE: this is the ONLY legitimate caller of the end-game
      // mutation path (via the "ended the game" system message). Any other
      // [TD_END_TRACE] end_game_called log without a preceding
      // [TD_END_TRACE] end_game_confirm_pressed is a bug.
      console.log('[TD_END_TRACE] end_game_confirm_pressed');
    }
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
  // RANDOM-TARGET-FIX: ALL random selection happens in BACKEND, not frontend
  // Frontend only reads the result from backend and animates accordingly
  // This ensures both devices always show the same selection (no desync)
  // ═══════════════════════════════════════════════════════════════════════════
  const spinBottle = useCallback(async () => {
    // VERIFICATION LOG: Spin attempt
    if (__DEV__) {
      console.log('[BOTTLE_SPIN] Spin attempt:', {
        isSpinningLocally,
        isAnimationLocked,
        isSessionActive,
        myRole,
        currentSpinTurnRole,
        isMySpinTurn,
        backendSpinTurnRole,
      });
    }

    if (isSpinningLocally) return;

    // Guard: Only spin if session is active
    if (!isSessionActive) {
      if (__DEV__) console.warn('[BOTTLE_SPIN] Cannot spin - no active session');
      return;
    }

    // Guard: Must have a role
    if (!myRole) {
      if (__DEV__) console.warn('[BOTTLE_SPIN] Cannot spin - role not determined', {
        userRef: getSafeIdTail(userId),
        inviterRef: getSafeIdTail(inviterId),
        inviteeRef: getSafeIdTail(inviteeId),
      });
      return;
    }

    if (!userId || !conversationId) {
      if (__DEV__) console.warn('[BOTTLE_SPIN] Cannot spin - missing userId or conversationId');
      return;
    }

    setIsSpinningLocally(true);
    setChosenOption(null);

    // ═══════════════════════════════════════════════════════════════════════════
    // BACKEND-ONLY RANDOM SELECTION
    // Call backend with 'spinning' phase - backend generates random selection
    // and returns it. NO Math.random() in frontend for target selection!
    // ═══════════════════════════════════════════════════════════════════════════
    let selectedRole: 'inviter' | 'invitee';
    try {
      // Backend now performs the random selection authoritatively when
      // turnPhase === 'spinning' and returns { success, selectedTargetRole }.
      const result = await setTurnMutation({
        authUserId: userId,
        conversationId,
        currentTurnRole: undefined,
        turnPhase: 'spinning',
      });
      if (!result?.selectedTargetRole) {
        throw new Error('Backend did not return a selected target');
      }
      selectedRole = result.selectedTargetRole;
    } catch (error) {
      if (__DEV__) console.warn('[BOTTLE_SPIN] Failed to get spin result from backend:', error);
      setIsSpinningLocally(false);
      return;
    }

    const spinSession = spinSessionRef.current;

    // Calculate animation direction based on backend selection (NO local random for selection)
    const landsOnMe = selectedRole === myRole;

    // Only use random for visual animation variation (not selection)
    const fullRotations = 3 + Math.floor(Math.random() * 4);
    const finalAngle = landsOnMe ? 0 : 180;
    const totalRotation = fullRotations * 360 + finalAngle;
    const animDuration = 3000 + Math.random() * 1000;

    if (__DEV__) {
      console.log('[TD_SPIN] start_spin', {
        side: 'chooser',
        fromAngle: 0,
        fullRotations,
        selectedRole,
        myRole,
      });
      console.log('[TD_SPIN] target_angle', {
        side: 'chooser',
        finalAngle,
        totalRotation,
        landsOnMe,
      });
    }

    Animated.timing(spinAnim, {
      toValue: totalRotation,
      duration: animDuration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(async () => {
      // Stale callback guard
      if (spinSessionRef.current !== spinSession) {
        return;
      }

      currentRotation.current = totalRotation % 360;
      setIsSpinningLocally(false);
      if (__DEV__) {
        console.log('[TD_SPIN] animation_complete', {
          side: 'chooser',
          landedAt: currentRotation.current,
          selectedRole,
        });
      }

      // Transition to choosing phase (backend already knows the selected target)
      try {
        await setTurnMutation({
          authUserId: userId,
          conversationId,
          currentTurnRole: selectedRole, // Use the backend-selected role
          turnPhase: 'choosing',
        });
      } catch (error) {
        if (__DEV__) console.warn('[BOTTLE_SPIN] Failed to set choosing state:', error);
      }

      // Haptic feedback
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Haptics not available
      }

      // NOTE: "Bottle landed on X" message intentionally NOT sent to chat
      // to keep thread clean. Users see visual result in game modal.
      // Only meaningful messages (chose Truth/Dare/Skip) are persisted.
    });
  }, [isSpinningLocally, isSessionActive, myRole, userId, inviterId, inviteeId, conversationId, setTurnMutation, spinAnim, currentSpinTurnRole, isMySpinTurn, backendSpinTurnRole, isAnimationLocked]);

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLE CHOICE (Truth/Dare/Skip)
  // ═══════════════════════════════════════════════════════════════════════════
  const handleChoice = useCallback(async (choice: 'truth' | 'dare' | 'skip') => {
    // Guard: Only allow choice if it's my turn
    if (uiMode !== 'choosing_for_me') {
      if (__DEV__) console.warn('[BOTTLE_SPIN] Cannot choose - not my turn', { uiMode });
      return;
    }

    if (__DEV__) {
      console.log('[TD_FLOW] choice_selected', { choice, autoAdvance });
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
        if (__DEV__) console.warn('[BOTTLE_SPIN] Failed to set complete state:', error);
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

    if (autoAdvance) {
      onCloseRef.current();
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

    // TD-FLOW (Option B): when autoAdvance is on, surface the choice as a
    // non-blocking toast and schedule a return to 'idle' after ~2s so the
    // user never has to manually tap [Again]/[Done] to continue playing.
    // Backend has already rotated spinTurnRole on the 'complete' write.
    if (autoAdvance) {
      const text =
        choice === 'skip'
          ? 'Skipped 😅'
          : choice === 'truth'
            ? 'You chose TRUTH 🔥'
            : 'You chose DARE 😈';
      if (__DEV__) {
        console.log('[TD_FLOW] result_toast_show', { choice, byChooser: true });
        console.log('[TD_LIVE] complete_toast', { choice, byChooser: true });
      }
      setToastInfo({ text, key: Date.now() });

      // TD_LIVE: dedup guard — mark this specific choice event as already
      // auto-advanced so the observer-side effect (if it were to fire on the
      // chooser's own device due to state timing) cannot double-fire the
      // turnPhase:'idle' mutation. We tag with the locally-known actionAt
      // (Date.now()) since the backend bumps its own lastActionAt on the
      // 'complete' write that will arrive right after.
      const choiceLocalActionAt = Date.now();
      autoAdvanceFiredForActionRef.current = choiceLocalActionAt;

      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
      autoAdvanceTimerRef.current = setTimeout(async () => {
        autoAdvanceTimerRef.current = null;
        setChosenOption(null);
        if (userId && conversationId) {
          // TD_FLOW: explicit payload log so it's unambiguous which mutation
          // the autoAdvance timer calls. This is setBottleSpinTurn with
          // turnPhase:'idle' — it does NOT end the session or set cooldown.
          const payload = {
            authUserId: userId,
            conversationId,
            currentTurnRole: undefined,
            turnPhase: 'idle' as const,
          };
          if (__DEV__) {
            console.log('[TD_FLOW] auto_advance_payload', {
              mutation: 'setBottleSpinTurn',
              payload: {
                hasAuthUser: !!payload.authUserId,
                conversationRef: getSafeIdTail(payload.conversationId),
                turnPhase: payload.turnPhase,
              },
            });
            console.log('[TD_FLOW] auto_advance_to_idle');
            console.log('[TD_LIVE] auto_advance_once', {
              byChooser: true,
              localActionAt: choiceLocalActionAt,
            });
          }
          try {
            await setTurnMutation(payload);
          } catch (err) {
            if (__DEV__) console.warn('[TD_FLOW] auto_advance_to_idle failed', err);
          }
        }
      }, 2000);
    }
  }, [uiMode, currentUserName, incrementSkipCount, onSendResultMessage, userId, conversationId, setTurnMutation, autoAdvance]);

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
  // Choosing phase highlights (existing)
  const isCurrentUserSelected = backendTurnPhase === 'choosing' && backendTurnRole === myRole;
  const isOtherUserSelected = backendTurnPhase === 'choosing' && backendTurnRole !== myRole && backendTurnRole !== undefined;

  // SPIN-TURN-FIX: Spin turn highlights for idle phase
  const isIdleOrWaiting = backendTurnPhase === 'idle' || backendTurnPhase === undefined;
  const showMySpinTurnBadge = isIdleOrWaiting && isMySpinTurn && myRole !== null;
  const showOtherSpinTurnBadge = isIdleOrWaiting && !isMySpinTurn && myRole !== null;

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
          style={[styles.choiceButton, styles.skipChoiceButton, skipChoiceOverlay, !canSkip && styles.skipChoiceButtonDisabled]}
          onPress={() => canSkip && handleChoice('skip')}
          disabled={!canSkip}
        >
          <Ionicons
            name="play-skip-forward"
            size={14}
            color={
              canSkip
                ? (isPhase2Theme ? PHASE2_TD.text : COLORS.text)
                : (isPhase2Theme ? PHASE2_TD.textMuted : COLORS.textMuted)
            }
          />
          <Text
            style={[
              styles.skipChoiceText,
              skipChoiceTextOverlay,
              !canSkip && styles.skipChoiceTextDisabled,
              !canSkip && skipChoiceTextDisabledOverlay,
            ]}
          >
            Skip
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: OBSERVER UI (other user is choosing) - Compact layout
  // TD_LIVE: restyled to match renderWaitingForSpin so the spinner (non-chooser)
  // sees an explicit non-blocking wait affordance instead of a blocking popup.
  // ═══════════════════════════════════════════════════════════════════════════
  const renderObserverUI = () => (
    <View style={styles.waitingContainer}>
      <View style={[styles.waitingContent, waitingContentOverlay]}>
        <Ionicons
          name="hourglass-outline"
          size={18}
          color={isPhase2Theme ? PHASE2_TD.textMuted : COLORS.textLight}
        />
        <Text style={[styles.waitingText, waitingTextThemeOverlay]}>
          Waiting for <Text style={[styles.waitingName, waitingNameOverlay]}>{otherUserName}</Text> to choose…
        </Text>
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: WAITING FOR SPIN (other user's turn to spin) - SPIN-TURN-FIX
  // ═══════════════════════════════════════════════════════════════════════════
  const renderWaitingForSpin = () => (
    <View style={styles.waitingContainer}>
      <View style={[styles.waitingContent, waitingContentOverlay]}>
        <Ionicons
          name="hourglass-outline"
          size={18}
          color={isPhase2Theme ? PHASE2_TD.textMuted : COLORS.textLight}
        />
        <Text style={[styles.waitingText, waitingTextThemeOverlay]}>
          Waiting for <Text style={[styles.waitingName, waitingNameOverlay]}>{otherUserName}</Text> to spin
        </Text>
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: OBSERVER SPINNING TEXT - no bottle animation on receiver side
  // ═══════════════════════════════════════════════════════════════════════════
  const renderObserverSpinningText = () => (
    <View style={styles.waitingContainer}>
      <View style={[styles.waitingContent, waitingContentOverlay]}>
        <Ionicons
          name="hourglass-outline"
          size={18}
          color={isPhase2Theme ? PHASE2_TD.textMuted : COLORS.textLight}
        />
        <Text style={[styles.waitingText, waitingTextThemeOverlay]}>
          <Text style={[styles.waitingName, waitingNameOverlay]}>{otherUserName}</Text> is spinning…
        </Text>
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TD-LIFECYCLE: RENDER: WAITING FOR START (invitee waiting for inviter to start game)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderWaitingForStart = () => (
    <View style={styles.waitingContainer}>
      <View style={[styles.waitingContent, waitingContentOverlay]}>
        <Ionicons
          name="time-outline"
          size={18}
          color={isPhase2Theme ? PHASE2_TD.rose : COLORS.textLight}
        />
        <Text style={[styles.waitingText, waitingTextThemeOverlay]}>
          Waiting for <Text style={[styles.waitingName, waitingNameOverlay]}>{otherUserName}</Text> to start
        </Text>
      </View>
    </View>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: COMPLETE STATE - Compact layout with inline actions
  // ═══════════════════════════════════════════════════════════════════════════
  const renderComplete = () => (
    <View style={[styles.resultContainer, resultContainerOverlay]}>
      <Text style={[styles.resultText, resultTextOverlay]}>
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
        <TouchableOpacity style={[styles.compactActionButton, compactActionButtonOverlay]} onPress={handleSpinAgain}>
          <Ionicons name="refresh" size={14} color={isPhase2Theme ? PHASE2_TD.rose : COLORS.primary} />
          <Text style={[styles.compactActionText, compactActionTextOverlay]}>Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.compactActionButton, compactActionButtonOverlay]} onPress={handleFinishRound}>
          <Ionicons name="checkmark" size={14} color={isPhase2Theme ? PHASE2_TD.text : COLORS.secondary} />
          <Text style={[styles.compactActionText, { color: isPhase2Theme ? PHASE2_TD.text : COLORS.secondary }]}>Done</Text>
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
      onRequestClose={handleCancel}
    >
      <View style={[styles.overlay, overlayBgOverlay]}>
        <View style={[styles.container, containerOverlay]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="wine" size={18} color={isPhase2Theme ? PHASE2_TD.rose : COLORS.secondary} />
              <Text style={[styles.title, titleOverlay]}>Spin the Bottle</Text>
            </View>
            <TouchableOpacity
              onPress={handleCancel}
              style={[styles.closeButton, isAnimationLocked && styles.buttonDisabled]}
              disabled={isAnimationLocked}
            >
              <Ionicons
                name="close"
                size={22}
                color={
                  isAnimationLocked
                    ? (isPhase2Theme ? PHASE2_TD.textMuted : COLORS.textMuted)
                    : (isPhase2Theme ? PHASE2_TD.text : COLORS.text)
                }
              />
            </TouchableOpacity>
          </View>

          {/* Game area */}
          {uiMode !== 'observer_spinning_text' && (
            <View style={styles.gameArea}>
              {/* Top user (current user / me) */}
              <View style={styles.userLabel}>
                <View style={[
                  styles.userBadge,
                  userBadgeOverlay,
                  isCurrentUserSelected && styles.userBadgeSelected,
                  isCurrentUserSelected && userBadgeSelectedOverlay,
                  showMySpinTurnBadge && styles.userBadgeSpinTurn,
                  showMySpinTurnBadge && userBadgeSpinTurnOverlay,
                ]}>
                  <Text style={[
                    styles.userName,
                    userNameOverlay,
                    isCurrentUserSelected && styles.userNameSelected,
                    isCurrentUserSelected && userNameSelectedOverlay,
                    showMySpinTurnBadge && styles.userNameSpinTurn,
                    showMySpinTurnBadge && userNameSpinTurnOverlay,
                  ]}>
                    {currentUserName}
                  </Text>
                  {isCurrentUserSelected && (
                    <Text style={[styles.turnText, turnTextOverlay]}>Your turn!</Text>
                  )}
                  {showMySpinTurnBadge && (
                    <Text style={[styles.spinTurnText, spinTurnTextOverlay]}>Your turn to spin</Text>
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
                  userBadgeOverlay,
                  isOtherUserSelected && styles.userBadgeSelected,
                  isOtherUserSelected && userBadgeSelectedOverlay,
                  showOtherSpinTurnBadge && styles.userBadgeSpinTurnOther,
                  showOtherSpinTurnBadge && userBadgeSpinTurnOtherOverlay,
                ]}>
                  <Text style={[
                    styles.userName,
                    userNameOverlay,
                    isOtherUserSelected && styles.userNameSelected,
                    isOtherUserSelected && userNameSelectedOverlay,
                    showOtherSpinTurnBadge && styles.userNameSpinTurnOther,
                    showOtherSpinTurnBadge && userNameSpinTurnOtherOverlay,
                  ]}>
                    {otherUserName}
                  </Text>
                  {isOtherUserSelected && (
                    <Text style={[styles.turnText, turnTextOverlay]}>Their turn!</Text>
                  )}
                  {showOtherSpinTurnBadge && (
                    <Text style={[styles.spinTurnTextOther, spinTurnTextOtherOverlay]}>Their turn to spin</Text>
                  )}
                </View>
              </View>

              {/* TD-FLOW (Option B): Floating result toast overlay. Non-blocking,
                  pointerEvents='none' so underlying UI stays interactive. Only
                  rendered when toastInfo has content; fade handled by animation effect. */}
              {autoAdvance && toastInfo && (
                <Animated.View
                  pointerEvents="none"
                  style={[styles.resultToast, resultToastOverlay, { opacity: toastOpacity }]}
                >
                  <Text style={styles.resultToastText}>{toastInfo.text}</Text>
                </Animated.View>
              )}
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              DYNAMIC CONTENT BASED ON uiMode - SINGLE RENDER DECISION
              ═══════════════════════════════════════════════════════════════════ */}

          {/* IDLE: Show spin button */}
          {uiMode === 'idle' && (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.spinButton, spinButtonOverlay]} onPress={spinBottle}>
                <Ionicons name="refresh" size={18} color={COLORS.white} />
                <Text style={styles.spinButtonText}>Spin the Bottle</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* SPINNING: Show spinning text */}
          {uiMode === 'spinning_local' && (
            <View style={styles.spinningContainer}>
              <Text style={[styles.spinningText, spinningTextOverlay]}>Spinning...</Text>
            </View>
          )}

          {/* OBSERVER_SPINNING_TEXT: receiver sees text only, no bottle animation */}
          {uiMode === 'observer_spinning_text' && renderObserverSpinningText()}

          {/* WAITING_FOR_SPIN: Show waiting text - SPIN-TURN-FIX */}
          {uiMode === 'waiting_for_spin' && renderWaitingForSpin()}

          {/* TD-LIFECYCLE: WAITING_FOR_START: Invitee waiting for inviter to start */}
          {uiMode === 'waiting_for_start' && renderWaitingForStart()}

          {/* CHOOSING_FOR_ME: I must choose - show Truth/Dare/Skip buttons */}
          {uiMode === 'choosing_for_me' && renderChooserButtons()}

          {/* CHOOSING_FOR_OTHER: Other player chooses - show observer UI */}
          {uiMode === 'choosing_for_other' && renderObserverUI()}

          {/* COMPLETE: Show result (legacy blocking screen) - only when autoAdvance is off (Phase-2). */}
          {uiMode === 'complete' && !autoAdvance && renderComplete()}

          {/* Bottom row: Skip info + End Game */}
          <View style={[styles.bottomRow, bottomRowOverlay]}>
            <View style={styles.skipInfoLeft}>
              <View style={styles.skipsIndicator}>
                {[...Array(MAX_SKIPS)].map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.skipDot,
                      i < skipsRemaining ? styles.skipDotActive : styles.skipDotInactive,
                      i >= skipsRemaining && skipDotInactiveOverlay,
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.skipsText, skipsTextOverlay]}>Skips: {skipsRemaining}/{MAX_SKIPS}</Text>
            </View>

            <TouchableOpacity
              style={[
                styles.endGameButton,
                endGameButtonOverlay,
                isAnimationLocked && styles.endGameButtonDisabled,
              ]}
              onPress={handleEndGamePress}
              disabled={isAnimationLocked}
            >
              <Ionicons
                name="close-circle-outline"
                size={14}
                color={
                  isAnimationLocked
                    ? (isPhase2Theme ? PHASE2_TD.textMuted : COLORS.textMuted)
                    : (isPhase2Theme ? PHASE2_TD.endGameText : '#E57373')
                }
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  styles.endGameText,
                  endGameTextOverlay,
                  isAnimationLocked && styles.endGameTextDisabled,
                ]}
              >
                End Game
              </Text>
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
          <View style={[styles.confirmOverlay, overlayBgOverlay]}>
            <View style={[styles.confirmContainer, confirmContainerOverlay]}>
              <Text style={[styles.confirmTitle, confirmTitleOverlay]}>End Game?</Text>
              <Text style={[styles.confirmMessage, confirmMessageOverlay]}>
                Are you sure you want to end the game?
              </Text>
              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={[styles.confirmButton, styles.confirmButtonNo, confirmButtonNoOverlay]}
                  onPress={handleEndGameCancel}
                >
                  <Text style={[styles.confirmButtonNoText, confirmButtonNoTextOverlay]}>No</Text>
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
  buttonDisabled: {
    opacity: 0.4,
  },
  gameArea: {
    alignItems: 'center',
    paddingVertical: 10,
    position: 'relative',
  },
  // TD-FLOW (Option B): floating result toast overlay
  resultToast: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  resultToastText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
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
  // SPIN-TURN-FIX: Spin turn highlight styles
  userBadgeSpinTurn: {
    backgroundColor: COLORS.secondary + '20',
    borderColor: COLORS.secondary,
  },
  userNameSpinTurn: {
    color: COLORS.secondary,
  },
  spinTurnText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.secondary,
    marginTop: 2,
  },
  userBadgeSpinTurnOther: {
    backgroundColor: COLORS.textMuted + '15',
    borderColor: COLORS.textMuted + '40',
  },
  userNameSpinTurnOther: {
    color: COLORS.textLight,
  },
  spinTurnTextOther: {
    fontSize: 10,
    fontWeight: '500',
    color: COLORS.textMuted,
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
  // SPIN-TURN-FIX: Waiting for spin styles
  waitingContainer: {
    height: CONTENT_AREA_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
  },
  waitingText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  waitingName: {
    fontWeight: '600',
    color: COLORS.text,
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
  endGameButtonDisabled: {
    opacity: 0.4,
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    borderColor: 'rgba(150, 150, 150, 0.2)',
  },
  endGameTextDisabled: {
    color: COLORS.textMuted,
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
