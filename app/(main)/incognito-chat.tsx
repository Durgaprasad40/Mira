/**
 * LOCKED (PHASE-2 PRIVATE CHAT THREAD)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - P0 audit passed: backend connectivity verified, Phase isolation confirmed
 * - All messages via Convex privateMessages backend
 * - Delivery/read ticks from backend truth
 * - Voice messages use storage URLs (not local paths)
 *
 * Backend source: privateMessages table
 * Queries: getPrivateMessages, sendPrivateMessage, markPrivateMessagesRead
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Alert,
  InteractionManager,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { popHandoff } from '@/lib/memoryHandoff';
import * as ImagePicker from 'expo-image-picker';
import { INCOGNITO_COLORS } from '@/lib/constants';
// PHASE 2 FIX: Removed PRIVATE_INTENT_CATEGORIES import - intent labels not shown in header
import { maskExplicitWords, MASKED_CONTENT_NOTICE } from '@/lib/contentFilter';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useAuthStore } from '@/stores/authStore';
import { BottleSpinGame, TruthDareInviteCard } from '@/components/chat';
import { CameraPhotoSheet, type CameraPhotoOptions } from '@/components/chat/CameraPhotoSheet';
import { ReportModal } from '@/components/private/ReportModal';
import { Phase2ProtectedMediaViewer } from '@/components/private/Phase2ProtectedMediaViewer';
import { calculateProtectedMediaCountdown } from '@/utils/protectedMediaCountdown';
// P1-004 FIX: Removed DEMO_INCOGNITO_PROFILES and useDemoStore - now using backend participantIntentKey
import { trackEvent } from '@/lib/analytics';
// P2-002: Centralized blur constants
import { PHASE2_BLUR_AVATAR } from '@/lib/phase2UI';
import { useVoiceRecorder, type VoiceRecorderResult } from '@/hooks/useVoiceRecorder';
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble';
import type { IncognitoMessage } from '@/types';
// P2-INSTRUMENTATION: Sentry breadcrumbs for Phase-2 debugging
import { P2 } from '@/lib/p2Instrumentation';

// SELECTOR FIX: Stable empty array reference to avoid infinite loop in useSyncExternalStore
const EMPTY_ARRAY: IncognitoMessage[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// P0-002b: Message type for backend messages (mapped for UI compatibility)
// P1-001: Added protected media fields
// ═══════════════════════════════════════════════════════════════════════════
interface BackendMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: string;
  content: string;
  // P1-001: Protected media fields from backend
  isProtected?: boolean;
  imageUrl?: string | null;
  protectedMediaTimer?: number;
  protectedMediaViewingMode?: 'tap' | 'hold';
  protectedMediaIsMirrored?: boolean;
  viewedAt?: number;
  timerEndsAt?: number;
  isExpired?: boolean;
  createdAt: number;
  readAt?: number;
  deliveredAt?: number;
  // P0-003: Voice message fields
  audioUrl?: string | null;
  audioDurationMs?: number;
}

// PHASE 2 FIX: Removed getIntentLabelFromKey - intent labels not shown in Deep Connect chat header

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE-TICKS-FIX: Helper functions for message status ticks
// Following Phase-1 pattern exactly: sent (1 gray), delivered (2 gray), read (2 blue)
// ═══════════════════════════════════════════════════════════════════════════
type TickStatus = 'sent' | 'delivered' | 'read';

function getTickStatus(message: { readAt?: number; deliveredAt?: number }): TickStatus {
  if (message.readAt) return 'read';
  if (message.deliveredAt) return 'delivered';
  return 'sent';
}

function getTickIcon(status: TickStatus): 'checkmark' | 'checkmark-done' {
  return status === 'sent' ? 'checkmark' : 'checkmark-done';
}

function getTickColor(status: TickStatus): string {
  if (status === 'read') {
    return '#34B7F1'; // Blue for read (WhatsApp-style)
  }
  // White/light for sent and delivered on dark bubbles
  return 'rgba(255,255,255,0.8)';
}

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION DEBUG: Track mount events for camera-composer bug investigation
// ═══════════════════════════════════════════════════════════════════════════
let _incognitoChatMountCount = 0;

export default function PrivateChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlashListRef<IncognitoMessage>>(null);

  // Mount counter for debugging (no logging to reduce noise)
  const mountIdRef = useRef(++_incognitoChatMountCount);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002b: Auth for backend mutations
  // SELECTOR FIX: Use individual selectors to avoid unstable object references
  // ═══════════════════════════════════════════════════════════════════════════
  const token = useAuthStore((s) => s.token);
  const currentUserId = useAuthStore((s) => s.userId);

  // ─── Composer height tracking (matches locked chat-rooms pattern) ───
  const [composerHeight, setComposerHeight] = useState(56);
  // Phase-1 style: + menu state
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Near-bottom tracking for smart auto-scroll
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  // Local store - ONLY used for conversation metadata (header info), NOT messages
  const conversations = usePrivateChatStore((s) => s.conversations);
  // Note: blockUser moved to ReportModal with full backend integration
  // P1-006 PARITY: Local add/delete for ToD system messages and pending secure media
  const localAddMessage = usePrivateChatStore((s) => s.addMessage);
  const deleteMessage = usePrivateChatStore((s) => s.deleteMessage);

  const localConversation = conversations.find((c) => c.id === id);

  // ═══════════════════════════════════════════════════════════════════════════
  // PRESENCE-FIX: ALWAYS query backend for fresh presence data
  // ROOT CAUSE FIX: Previously skipped backend when localConversation existed
  // NOW: Always run backend query to get real-time presence updates
  // ═══════════════════════════════════════════════════════════════════════════
  const backendConversation = useQuery(
    api.privateConversations.getPrivateConversation,
    id && currentUserId
      ? { conversationId: id as Id<'privateConversations'>, authUserId: currentUserId }
      : 'skip'
  );

  // PRESENCE-FIX: Prefer backend data for real-time presence, fallback to local for metadata
  const conversation = useMemo(() => {
    // Backend has fresh presence data - prefer it
    if (backendConversation) {
      // Map backend response to local store format
      return {
        id: backendConversation.id as string,
        participantId: backendConversation.participantId as string,
        participantName: backendConversation.participantName || 'Someone',
        participantAge: 0,
        participantPhotoUrl: backendConversation.participantPhotoUrl || '',
        // P1-004 FIX: Include participantIntentKey from backend for intent label lookup
        participantIntentKey: (backendConversation as any).participantIntentKey ?? null,
        lastMessage: '',
        lastMessageAt: backendConversation.createdAt || Date.now(),
        unreadCount: backendConversation.unreadCount || 0,
        connectionSource: backendConversation.connectionSource || 'tod',
        // PHOTO ACCESS: New fields for privacy feature
        isPhotoBlurred: (backendConversation as any).isPhotoBlurred ?? false,
        photoAccessStatus: (backendConversation as any).photoAccessStatus ?? 'none',
        canViewClearPhoto: (backendConversation as any).canViewClearPhoto ?? true,
        // PRESENCE-FIX: Include participantLastActive from backend for online status
        participantLastActive: (backendConversation as any).participantLastActive ?? 0,
      };
    }
    // Fallback to local store while backend loads (metadata only, presence may be stale)
    if (localConversation) return localConversation;
    return null;
  }, [localConversation, backendConversation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P2-INSTRUMENTATION: Set Sentry context when conversation/user data is available
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (currentUserId) {
      P2.auth.authUserIdAvailable(currentUserId);
    }
    if (conversation && currentUserId) {
      P2.setContext({
        conversationId: id || '',
        authUserId: currentUserId,
        otherUserId: conversation.participantId,
        screen: 'incognito-chat',
      });
      P2.auth.participantIds(id || '', currentUserId, conversation.participantId);
    }
    return () => {
      P2.clearContext();
    };
  }, [id, currentUserId, conversation?.participantId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHOTO ACCESS: Request access mutation for blurred photos
  // ═══════════════════════════════════════════════════════════════════════════
  const requestPhotoAccessMutation = useMutation(api.privatePhotoAccess.requestPrivatePhotoAccess);
  const [photoAccessRequesting, setPhotoAccessRequesting] = useState(false);

  const handleRequestPhotoAccess = useCallback(async () => {
    if (!conversation || !currentUserId || photoAccessRequesting) return;

    setPhotoAccessRequesting(true);
    try {
      const result = await requestPhotoAccessMutation({
        authUserId: currentUserId,
        ownerUserId: conversation.participantId as Id<'users'>,
        conversationId: id as Id<'privateConversations'>,
      });

      if (result.success) {
        if (__DEV__) console.log('[PhotoAccess] Request sent:', result.status);
      } else {
        if (__DEV__) console.log('[PhotoAccess] Request failed:', result.error);
      }
    } catch (error) {
      if (__DEV__) console.warn('[PhotoAccess] Error:', error);
    } finally {
      setPhotoAccessRequesting(false);
    }
  }, [conversation, currentUserId, id, requestPhotoAccessMutation, photoAccessRequesting]);

  // PHOTO ACCESS: Query for pending requests where I am the OWNER
  // This shows a banner when the other participant wants to see MY blurred photo
  const pendingPhotoRequests = useQuery(
    api.privatePhotoAccess.getPendingPhotoAccessRequests,
    currentUserId ? { authUserId: currentUserId } : 'skip'
  );

  // Find if the OTHER participant in this conversation has a pending request for MY photo
  const pendingRequestFromOther = useMemo(() => {
    if (!pendingPhotoRequests || !conversation) return null;
    return pendingPhotoRequests.find(
      (req) => req.viewerUserId === conversation.participantId && req.conversationId === id
    ) ?? null;
  }, [pendingPhotoRequests, conversation, id]);

  // Mutation to respond to photo access request
  const respondPhotoAccessMutation = useMutation(api.privatePhotoAccess.respondPrivatePhotoAccessRequest);
  const [respondingToRequest, setRespondingToRequest] = useState(false);

  const handleRespondToPhotoRequest = useCallback(async (approve: boolean) => {
    if (!pendingRequestFromOther || !currentUserId || respondingToRequest) return;

    setRespondingToRequest(true);
    try {
      await respondPhotoAccessMutation({
        authUserId: currentUserId,
        requestId: pendingRequestFromOther.requestId as Id<'privatePhotoAccessRequests'>,
        approve,
      });
      if (__DEV__) console.log('[PhotoAccess] Responded:', approve ? 'approved' : 'declined');
    } catch (error) {
      if (__DEV__) console.warn('[PhotoAccess] Respond error:', error);
    } finally {
      setRespondingToRequest(false);
    }
  }, [pendingRequestFromOther, currentUserId, respondPhotoAccessMutation, respondingToRequest]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002b: Backend message fetching (replaces local store)
  // ═══════════════════════════════════════════════════════════════════════════
  const backendMessages = useQuery(
    api.privateConversations.getPrivateMessages,
    id && currentUserId
      ? { conversationId: id as Id<'privateConversations'>, authUserId: currentUserId }
      : 'skip'
  );

  // Map backend messages to UI-compatible IncognitoMessage format
  // MESSAGE-TICKS-FIX: Include deliveredAt and readAt for visual ticks
  // P1-006 FIX: Get local messages from store (ToD results, pending secure media)
  // SELECTOR FIX: Return undefined instead of new [] to avoid unstable references
  const localMessagesRaw = usePrivateChatStore((s) => (id ? s.messages[id] : undefined));
  const localMessages = localMessagesRaw ?? EMPTY_ARRAY;

  // P0-003: Include audioUrl for voice messages
  // P1-001: Include protected media fields
  // P1-006: Merge backend messages with local-only messages (ToD, pending secure media)
  const messages: IncognitoMessage[] = useMemo(() => {
    // Map backend messages
    const backendMapped: IncognitoMessage[] = backendMessages
      ? backendMessages.map((m: BackendMessage) => ({
          id: m.id,
          conversationId: m.conversationId,
          // P0-002b: Map senderId to 'me' for own messages (UI expects 'me' for isOwn check)
          senderId: m.senderId === currentUserId ? 'me' : m.senderId,
          content: m.content,
          type: m.type as any,
          createdAt: m.createdAt,
          isRead: !!m.readAt,
          // MESSAGE-TICKS-FIX: Pass through delivery and read timestamps
          deliveredAt: m.deliveredAt,
          readAt: m.readAt,
          // P0-003: Voice message fields - map audioUrl to audioUri for VoiceMessageBubble compatibility
          audioUri: m.audioUrl ?? undefined,
          durationMs: m.audioDurationMs,
          // P1-001: Protected media fields from backend
          isProtected: m.isProtected,
          protectedMedia: m.isProtected
            ? {
                localUri: m.imageUrl ?? '', // Backend URL instead of local URI
                mediaType: m.type === 'video' ? 'video' : 'photo',
                timer: m.protectedMediaTimer ?? 0,
                viewingMode: m.protectedMediaViewingMode ?? 'tap',
                screenshotAllowed: false,
                viewOnce: m.protectedMediaTimer === 0,
                watermark: false,
                isMirrored: m.protectedMediaIsMirrored,
              }
            : undefined,
          viewedAt: m.viewedAt,
          timerEndsAt: m.timerEndsAt,
          isExpired: m.isExpired,
        }))
      : [];

    // P1-006: Filter local messages that should be shown
    // Include: system/ToD messages, pending uploads (not yet in backend)
    const backendIds = new Set(backendMapped.map((m) => m.id));
    const localOnlyMessages = localMessages.filter((m) => {
      // Don't duplicate backend messages
      if (backendIds.has(m.id)) return false;
      // Include ToD/system messages
      if (m.senderId === 'tod' || m.senderId === 'system') return true;
      // Include pending secure media (has localUri but not yet uploaded)
      if (m.isProtected && m.protectedMedia?.localUri?.startsWith('file://')) return true;
      return false;
    });

    // Merge and sort by createdAt
    const merged = [...backendMapped, ...localOnlyMessages];
    merged.sort((a, b) => a.createdAt - b.createdAt);
    return merged;
  }, [backendMessages, localMessages, currentUserId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002b: Backend mutations
  // ═══════════════════════════════════════════════════════════════════════════
  const sendMessageMutation = useMutation(api.privateConversations.sendPrivateMessage);
  const markReadMutation = useMutation(api.privateConversations.markPrivateMessagesRead);
  const markDeliveredMutation = useMutation(api.privateConversations.markPrivateMessagesDelivered);
  const deleteMessageMutation = useMutation(api.privateConversations.deletePrivateMessage);
  // EXPIRED-CLEANUP-FIX: New mutation for system cleanup (allows both participants, not just sender)
  const cleanupExpiredMutation = useMutation(api.privateConversations.cleanupExpiredPrivateMessage);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl); // P0-003: For voice upload
  // P1-001: Secure media upload mutation
  const generateSecureMediaUploadUrl = useMutation(api.privateConversations.generateSecureMediaUploadUrl);
  // P1-004 FIX: Typing indicator mutation
  const setTypingStatusMutation = useMutation(api.privateConversations.setPrivateTypingStatus);

  // P1-004 FIX: Typing indicator query subscription
  const typingStatus = useQuery(
    api.privateConversations.getPrivateTypingStatus,
    id && currentUserId
      ? { conversationId: id as Id<'privateConversations'>, authUserId: currentUserId }
      : 'skip'
  );
  const isOtherUserTyping = typingStatus?.isTyping ?? false;

  // P1-004 FIX: Debounced typing status update
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingUpdateRef = useRef<number>(0);

  const updateTypingStatus = useCallback((isTyping: boolean) => {
    if (!id || !token) return;

    const now = Date.now();
    // Debounce: Only send if 500ms has passed since last update
    if (isTyping && now - lastTypingUpdateRef.current < 500) return;

    lastTypingUpdateRef.current = now;

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    // Send typing status to backend
    setTypingStatusMutation({
      token,
      conversationId: id as Id<'privateConversations'>,
      isTyping,
    }).catch(() => {
      // Silent fail - typing is non-critical
    });

    // Auto-clear typing after 3 seconds of no activity
    if (isTyping) {
      typingTimeoutRef.current = setTimeout(() => {
        setTypingStatusMutation({
          token,
          conversationId: id as Id<'privateConversations'>,
          isTyping: false,
        }).catch(() => {});
      }, 3000);
    }
  }, [id, token, setTypingStatusMutation]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      // Clear typing status on unmount
      if (id && token) {
        setTypingStatusMutation({
          token,
          conversationId: id as Id<'privateConversations'>,
          isTyping: false,
        }).catch(() => {});
      }
    };
  }, [id, token, setTypingStatusMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1 PARITY: Truth/Dare Game Session Management
  // Exactly matches Phase 1 ChatScreenInner T/D flow
  // ═══════════════════════════════════════════════════════════════════════════

  // Query game session status from backend (same as Phase 1)
  const gameSession = useQuery(
    api.games.getBottleSpinSession,
    id ? { conversationId: id } : 'skip'
  );

  // T/D-DEBUG: Log game session changes for debugging invite flow
  useEffect(() => {
    if (__DEV__ && gameSession) {
      console.log('[P2_TD_DEBUG] Session state:', gameSession.state,
        '\n  sessionId:', gameSession.sessionId?.slice(-8),
        '\n  inviterId:', gameSession.inviterId?.slice(-8),
        '\n  inviteeId:', gameSession.inviteeId?.slice(-8),
        '\n  currentUserId:', currentUserId?.slice(-8),
        '\n  isInvitee:', gameSession.inviteeId === currentUserId
      );
    }
  }, [gameSession, currentUserId]);

  // Game session mutations (same as Phase 1)
  const sendInviteMutation = useMutation(api.games.sendBottleSpinInvite);
  const respondToInviteMutation = useMutation(api.games.respondToBottleSpinInvite);
  const endGameMutation = useMutation(api.games.endBottleSpinGame);
  // TD-LIFECYCLE: New mutations for proper session lifecycle
  const startGameMutation = useMutation(api.games.startBottleSpinGame);
  const cleanupExpiredGameMutation = useMutation(api.games.cleanupExpiredSession);

  // Get other user's ID for invite
  const otherUserId = conversation?.participantId;

  // T/D UI state
  const [showTruthDareGame, setShowTruthDareGame] = useState(false);
  const [showTruthDareInvite, setShowTruthDareInvite] = useState(false);
  const [showCooldownMessage, setShowCooldownMessage] = useState(false);
  const [cooldownRemainingMin, setCooldownRemainingMin] = useState(0);
  // TD-UX: Lightweight waiting toast for invitee (instead of full modal)
  const [showWaitingForStartToast, setShowWaitingForStartToast] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // T/D SYSTEM MESSAGES: Helper to send T/D events to backend (persisted)
  // These messages appear on BOTH users' chats and survive reload
  // ═══════════════════════════════════════════════════════════════════════════
  const sendTodSystemMessage = useCallback(async (content: string) => {
    if (!id || !token) return;
    try {
      await sendMessageMutation({
        token,
        conversationId: id as Id<'privateConversations'>,
        type: 'system',
        content,
      });
    } catch (error) {
      // Silent fail - T/D system messages are non-critical
      if (__DEV__) console.warn('[P2_TD] Failed to send system message:', error);
    }
  }, [id, token, sendMessageMutation]);

  // TD-LIFECYCLE: Watch game session state changes for cross-device sync
  useEffect(() => {
    if (!gameSession) return;

    // TD-LIFECYCLE: Debug logging for session state
    console.log('[TD_UI_STATE] Phase 2 session update:', {
      phase: 'P2',
      conversationId: id,
      sessionId: gameSession.sessionId,
      state: gameSession.state,
      turnPhase: gameSession.turnPhase,
      gameStartedAt: gameSession.gameStartedAt,
      hasGameStarted: !!gameSession.gameStartedAt,
    });

    // Auto-close game modal when game is ended/rejected/expired on either device
    if (gameSession.state === 'cooldown' || gameSession.state === 'none' || gameSession.state === 'expired') {
      if (showTruthDareGame) {
        console.log('[TD_MODAL_GUARD] Phase 2: Closing modal - session ended/expired');
        setShowTruthDareGame(false);
      }
      if (showTruthDareInvite) {
        setShowTruthDareInvite(false);
      }
    }

    // TD-LIFECYCLE: Handle expired session - cleanup and show message
    if (gameSession.state === 'expired' && gameSession.endedReason && currentUserId && id) {
      // Cleanup the expired session in backend
      cleanupExpiredGameMutation({
        authUserId: currentUserId,
        conversationId: id,
        endedReason: gameSession.endedReason as 'invite_expired' | 'not_started' | 'timeout',
      }).catch((err) => console.warn('[TD_CLEANUP] Failed:', err));

      // Send appropriate system message
      const messages: Record<string, string> = {
        invite_expired: 'Truth or Dare invite expired',
        not_started: 'Truth or Dare was not started in time',
        timeout: 'Truth or Dare ended due to inactivity',
      };
      const msg = messages[gameSession.endedReason];
      if (msg) {
        sendTodSystemMessage(msg);
      }
    }

    // TD-LIFECYCLE: Close invite modal when game becomes active
    // Do NOT auto-open game modal - inviter must manually start
    if (gameSession.state === 'active') {
      if (showTruthDareInvite) {
        console.log('[TD_MODAL_GUARD] Phase 2: Closing invite modal - game accepted, waiting for manual start');
        setShowTruthDareInvite(false);
        // DO NOT open game modal - inviter must click T/D button to start
      }
    }

    // Clear cooldown message when cooldown expires
    if (gameSession.state !== 'cooldown') {
      setShowCooldownMessage(false);
    }
  }, [gameSession?.state, gameSession?.turnPhase, gameSession?.gameStartedAt, gameSession?.endedReason, showTruthDareGame, showTruthDareInvite, currentUserId, id, cleanupExpiredGameMutation, sendTodSystemMessage]);

  // TD-LIFECYCLE: Auto-open modal ONLY when game has started and it's my turn to choose
  useEffect(() => {
    if (!gameSession || !currentUserId) return;

    // Only care about active games that have been manually started
    if (gameSession.state !== 'active') return;
    if (!gameSession.gameStartedAt) {
      console.log('[TD_MODAL_GUARD] Phase 2: Blocked auto-open - game not started yet', {
        state: gameSession.state,
        gameStartedAt: gameSession.gameStartedAt,
      });
      return; // Game not started yet - do NOT auto-open
    }
    if (gameSession.turnPhase !== 'choosing') return;
    if (!gameSession.currentTurnRole) return;

    // Determine my role
    const amIInviter = gameSession.inviterId === currentUserId;
    const amIInvitee = gameSession.inviteeId === currentUserId;
    const myRole = amIInviter ? 'inviter' : (amIInvitee ? 'invitee' : null);

    if (!myRole) return;

    // Check if it's MY turn
    const isMyTurn = gameSession.currentTurnRole === myRole;

    // If it's my turn and modal is closed, open it automatically
    if (isMyTurn && !showTruthDareGame) {
      console.log('[TD_MODAL_GUARD] Phase 2: Auto-opening modal - my turn to choose');
      setShowTruthDareGame(true);
    }
  }, [gameSession?.state, gameSession?.turnPhase, gameSession?.currentTurnRole, gameSession?.inviterId, gameSession?.inviteeId, gameSession?.gameStartedAt, currentUserId, showTruthDareGame]);

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-CLOSE MODAL AFTER TRUTH/DARE/SKIP SELECTION
  // When turnPhase becomes 'complete', show result briefly then close modal.
  // Both devices see this since they watch the same backend state.
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!gameSession) return;

    // Only auto-close when active game reaches 'complete' phase
    if (gameSession.state !== 'active') return;
    if (gameSession.turnPhase !== 'complete') return;

    // Wait briefly to show result, then auto-close (fast, near-instant)
    const timer = setTimeout(() => {
      if (showTruthDareGame) {
        console.log('[P2_TD_AUTO_CLOSE] Closing modal after T/D selection complete');
        setShowTruthDareGame(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [gameSession?.state, gameSession?.turnPhase, showTruthDareGame]);

  // TD-LIFECYCLE: Handle T/D button press with manual start support
  const handleTruthDarePress = useCallback(async () => {
    if (!gameSession || !currentUserId || !id) return;

    // Debug logging
    console.log('[TD_MODAL_GUARD] Phase 2: T/D button pressed', {
      state: gameSession.state,
      turnPhase: gameSession.turnPhase,
      gameStartedAt: gameSession.gameStartedAt,
      hasGameStarted: !!gameSession.gameStartedAt,
      amIInviter: gameSession.inviterId === currentUserId,
    });

    // P2-INSTRUMENTATION: T/D button pressed (skip for expired state)
    if (gameSession.state !== 'expired') {
      P2.tod.queryResult(id, gameSession.state as 'none' | 'pending' | 'active' | 'cooldown', gameSession.sessionId, gameSession.inviterId, gameSession.inviteeId);
    }

    // Priority 1: Cooldown active - show inline message
    if (gameSession.state === 'cooldown') {
      const remainingMin = Math.ceil((gameSession.remainingMs || 0) / 60000);
      setCooldownRemainingMin(remainingMin);
      setShowCooldownMessage(true);
      setTimeout(() => setShowCooldownMessage(false), 3000);
      return;
    }

    // Priority 2: Expired session - handled by useEffect, just return
    if (gameSession.state === 'expired') {
      return;
    }

    // Priority 3: Active game exists
    if (gameSession.state === 'active') {
      const amIInviter = gameSession.inviterId === currentUserId;
      const hasGameStarted = !!gameSession.gameStartedAt;

      // TD-LIFECYCLE: If game not started yet, handle based on role
      if (!hasGameStarted) {
        if (amIInviter) {
          // Inviter: Start the game manually
          console.log('[TD_MANUAL_START] Phase 2: Inviter starting game');
          try {
            const result = await startGameMutation({
              authUserId: currentUserId,
              conversationId: id,
            });
            if (result.success) {
              console.log('[TD_MANUAL_START] Phase 2: Game started successfully');
              sendTodSystemMessage('Game started!');
              setShowTruthDareGame(true);
            } else {
              console.warn('[TD_MANUAL_START] Phase 2: Failed to start game:', result);
            }
          } catch (err) {
            console.error('[TD_MANUAL_START] Phase 2: Error starting game:', err);
          }
        } else {
          // TD-UX: Invitee sees lightweight toast instead of full modal
          console.log('[TD_UX] Phase 2: Invitee - showing waiting toast (not modal)');
          setShowWaitingForStartToast(true);
          setTimeout(() => setShowWaitingForStartToast(false), 3000);
        }
        return;
      }

      // Game is started - open the game modal normally
      P2.tod.gameActive(id, gameSession.sessionId || '');
      setShowTruthDareGame(true);
      return;
    }

    // Priority 4: Pending invite exists - no action (invitee sees card, inviter waits)
    if (gameSession.state === 'pending') {
      return;
    }

    // Priority 5: No game - show invite modal
    setShowTruthDareInvite(true);
  }, [gameSession, id, currentUserId, startGameMutation, sendTodSystemMessage]);

  // Send game invite (same as Phase 1)
  // INVITE-FIX: Check pending state before sending to prevent "Invite already pending" error
  const handleSendInvite = useCallback(async () => {
    if (!currentUserId || !id || !otherUserId) return;

    // P2-INSTRUMENTATION: Invite pressed
    P2.tod.invitePressed(id, currentUserId, String(otherUserId));

    // INVITE-FIX: Don't send if invite is already pending
    if (gameSession?.state === 'pending') {
      setShowTruthDareInvite(false);
      return;
    }

    try {
      // P2-INSTRUMENTATION: Invite requested
      P2.tod.inviteRequested(id);
      const result = await sendInviteMutation({
        authUserId: currentUserId,
        conversationId: id,
        otherUserId: String(otherUserId),
      });

      // T/D-FIX: Handle status responses (backend no longer throws)
      if (result && !result.success) {
        // P2-INSTRUMENTATION: Invite failed with status
        P2.tod.inviteFailed(id, 'status_response', result.status);
        if (result.status === 'already_pending') {
          // Silently close modal - invite already sent
          setShowTruthDareInvite(false);
          return;
        }
        if (result.status === 'game_active') {
          // Game is already active - close modal
          setShowTruthDareInvite(false);
          return;
        }
        if (result.status === 'cooldown_active') {
          Alert.alert('Cooldown Active', 'Please wait before sending another invite.');
          setShowTruthDareInvite(false);
          return;
        }
      }

      // P2-INSTRUMENTATION: Invite success
      P2.tod.inviteSuccess(id);
      setShowTruthDareInvite(false);

      // T/D PERSISTENCE FIX: Send system message via backend (appears on BOTH users, survives reload)
      sendTodSystemMessage('You want to play Truth or Dare!');
    } catch (error: any) {
      // P2-INSTRUMENTATION: Invite failed
      P2.tod.inviteFailed(id, error?.message || 'unknown');
      // Fallback error handling (should rarely happen now)
      const errorMsg = error?.message || '';
      Alert.alert('Error', errorMsg || 'Failed to send invite');
      setShowTruthDareInvite(false);
    }
  }, [currentUserId, id, otherUserId, gameSession?.state, sendInviteMutation, sendTodSystemMessage]);

  // TD-UX: Respond to game invite with clean acceptance flow
  const handleRespondToInvite = useCallback(async (accept: boolean) => {
    if (!currentUserId || !id) return;

    try {
      await respondToInviteMutation({
        authUserId: currentUserId,
        conversationId: id,
        accept,
      });

      // P2-INSTRUMENTATION: Invite response
      if (accept) {
        P2.tod.inviteAccepted(id, currentUserId);
      } else {
        P2.tod.inviteRejected(id, currentUserId);
      }

      // TD-UX: Clear acceptance message (NO "Game starting..." - inviter must start)
      if (accept) {
        sendTodSystemMessage('Invite accepted! Tap T/D to start');
      } else {
        sendTodSystemMessage('Invite declined');
      }

      // TD-UX: Do NOT open modal on accept - inviter must tap T/D to start
      // Modal will open only after startGame mutation succeeds
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to respond to invite');
    }
  }, [currentUserId, id, respondToInviteMutation, sendTodSystemMessage]);

  // End game (called from BottleSpinGame)
  const handleEndGame = useCallback(async () => {
    if (!currentUserId || !id) return;

    try {
      // P2-INSTRUMENTATION: Game ended
      P2.tod.gameEnded(id, gameSession?.sessionId || '');
      await endGameMutation({
        authUserId: currentUserId,
        conversationId: id,
      });
    } catch (error) {
      // Silent fail - UI will close anyway
      if (__DEV__) console.warn('[P2_TD] Failed to end game:', error);
    }
  }, [currentUserId, id, endGameMutation, gameSession?.sessionId]);

  // MESSAGE-TICKS-FIX: Mark messages as read AND delivered when screen opens
  // Following Phase-1 pattern: delivery happens when conversation opens
  const hasMarkedRef = useRef(false);
  useEffect(() => {
    if (!id || !token || hasMarkedRef.current) return;
    hasMarkedRef.current = true;

    // Mark as delivered first (Phase-1 pattern)
    markDeliveredMutation({
      token,
      conversationId: id as Id<'privateConversations'>,
    }).catch((err) => {
      if (process.env.NODE_ENV !== 'production') console.warn('[Phase2Chat] Failed to mark messages delivered:', err);
    });

    // Then mark as read
    markReadMutation({
      token,
      conversationId: id as Id<'privateConversations'>,
    }).catch((err) => {
      if (process.env.NODE_ENV !== 'production') console.warn('[Phase2Chat] Failed to mark messages read:', err);
    });
  }, [id, token, markReadMutation, markDeliveredMutation]);

  // Reset mark flag when conversation changes
  useEffect(() => {
    hasMarkedRef.current = false;
  }, [id]);

  // PHASE-2 ISOLATED: Update presence periodically while chat is FOCUSED
  // Uses Phase-2 privateUserPresence table, NOT users table
  // P2_PRESENCE_FIX: Use useFocusEffect so heartbeat stops when navigating away
  const updatePresenceMutation = useMutation(api.privateConversations.updatePresence);
  useFocusEffect(
    useCallback(() => {
      if (!currentUserId) return;

      // P2-INSTRUMENTATION: Chat focused
      P2.presence.chatFocused(id || '', currentUserId);
      P2.presence.heartbeatStarted(currentUserId, 30_000);

      // [P2_PRESENCE_WRITE] Update presence immediately on focus
      if (__DEV__) console.log('[P2_PRESENCE_WRITE] Chat focused, updating presence for:', currentUserId);
      P2.presence.mutationRequested(currentUserId);
      updatePresenceMutation({ authUserId: currentUserId })
        .then(() => P2.presence.mutationSuccess(currentUserId))
        .catch((err) => {
          P2.presence.mutationFailed(currentUserId, err?.message || 'unknown');
        });

      // Update every 30 seconds while chat is focused
      const interval = setInterval(() => {
        if (__DEV__) console.log('[P2_PRESENCE_WRITE] Heartbeat tick for:', currentUserId);
        P2.presence.heartbeatTick(currentUserId);
        P2.presence.mutationRequested(currentUserId);
        updatePresenceMutation({ authUserId: currentUserId })
          .then(() => P2.presence.mutationSuccess(currentUserId))
          .catch((err) => {
            P2.presence.mutationFailed(currentUserId, err?.message || 'unknown');
          });
      }, 30_000);

      return () => {
        if (__DEV__) console.log('[P2_PRESENCE_WRITE] Chat unfocused, clearing heartbeat');
        P2.presence.heartbeatStopped(currentUserId);
        clearInterval(interval);
      };
    }, [currentUserId, updatePresenceMutation, id])
  );

  // PHASE-1 PARITY FIX (LIVE-TICK-V2): Mark messages as delivered/read when new messages arrive
  // This ensures the sender sees tick updates (1 -> 2 -> blue) in real-time
  const lastProcessedMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Skip if no messages or required data
    if (!messages || messages.length === 0 || !id || !token) return;

    // Get the latest message
    const latestMsg = messages[messages.length - 1];
    const latestMsgId = latestMsg?.id;

    // Check if we have any unread messages from the other user
    const hasUnreadFromOther = messages.some((m) =>
      m.senderId !== 'me' && !m.readAt
    );

    // If there are unread messages from the other user, mark as delivered and read
    if (hasUnreadFromOther) {
      // P2-INSTRUMENTATION: Deliver requested
      P2.messages.deliverRequested(id);
      // Mark as delivered
      markDeliveredMutation({
        token,
        conversationId: id as Id<'privateConversations'>,
      })
        .then((result) => {
          P2.messages.deliverSuccess(id, (result as any)?.count || 0);
        })
        .catch((err) => {
          if (__DEV__) console.warn('[P2_LIVE_TICK] markDelivered error:', err);
        });

      // P2-INSTRUMENTATION: Read requested
      P2.messages.readRequested(id);
      // Mark as read
      markReadMutation({
        token,
        conversationId: id as Id<'privateConversations'>,
      })
        .then((result) => {
          P2.messages.readSuccess(id, (result as any)?.markedCount || 0);
        })
        .catch((err) => {
          if (__DEV__) console.warn('[P2_LIVE_TICK] markRead error:', err);
        });
    }

    // P2-INSTRUMENTATION: Thread synced
    P2.messages.threadSynced(id, messages.length);

    // Update last processed message ID
    lastProcessedMsgIdRef.current = latestMsgId;
  }, [messages, id, token, markDeliveredMutation, markReadMutation]);

  // GOAL A: Live countdown state - updates every 250ms for smooth countdown display
  const [now, setNow] = useState(Date.now());

  // MESSAGE-TICKS-FIX: Live tick updates - hash of last 20 messages' delivery/read status
  // Following Phase-1 pattern: triggers FlashList re-render when ticks change
  const messageStatusHash = useMemo(() => {
    return messages
      .slice(-20)
      .map((m) => `${m.id}:${m.deliveredAt || 0}:${m.readAt || 0}`)
      .join('|');
  }, [messages]);

  // GOAL A: Update 'now' every 250ms for live countdown (only when messages have active timers)
  const hasActiveTimers = messages.some(
    (m) => m.isProtected && m.timerEndsAt && !m.isExpired && m.timerEndsAt > Date.now()
  );
  useEffect(() => {
    if (!hasActiveTimers) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [hasActiveTimers]);

  // EXPIRY-AUTO-TRIGGER: Mark expired messages when timer reaches 0 (without requiring tap)
  // This ensures media auto-expires even if viewer is NOT open
  const markExpiredMutation = useMutation(api.privateConversations.markPrivateSecureMediaExpired);
  const expiredIdsRef = useRef(new Set<string>()); // Track already-expired IDs to prevent duplicates

  useEffect(() => {
    if (!token) return;

    // Find messages that should be expired (timer ended but not marked expired)
    const toExpire = messages.filter(
      (m) =>
        m.isProtected &&
        m.timerEndsAt &&
        !m.isExpired &&
        m.timerEndsAt <= now &&
        !expiredIdsRef.current.has(m.id)
    );

    // Auto-expire each message
    toExpire.forEach((m) => {
      expiredIdsRef.current.add(m.id);
      markExpiredMutation({ token, messageId: m.id as Id<'privateMessages'> })
        .catch((err) => {
          if (__DEV__) console.warn('[EXPIRY_AUTO] Failed to mark expired:', err);
          expiredIdsRef.current.delete(m.id); // Allow retry on failure
        });
    });
  }, [messages, now, token, markExpiredMutation]);

  // EXPIRED-CLEANUP: Auto-delete expired media messages after retention period (1 minute)
  // This prevents expired pills from stacking forever in the thread
  // EXPIRED-CLEANUP-FIX: Uses cleanupExpiredMutation (allows both participants, not just sender)
  const EXPIRED_RETENTION_MS = 60_000; // 1 minute after expiry
  const cleanedUpIdsRef = useRef(new Set<string>()); // Track already-cleaned IDs

  useEffect(() => {
    if (!token || !id) return;

    // Find expired messages past retention period
    const toCleanup = messages.filter(
      (m) =>
        m.isProtected &&
        m.isExpired &&
        m.timerEndsAt &&
        now - m.timerEndsAt > EXPIRED_RETENTION_MS &&
        !cleanedUpIdsRef.current.has(m.id)
    );

    // Auto-cleanup each expired message (system cleanup, not user deletion)
    toCleanup.forEach((m) => {
      cleanedUpIdsRef.current.add(m.id);
      cleanupExpiredMutation({ token, messageId: m.id as Id<'privateMessages'> })
        .catch((err) => {
          if (__DEV__) console.warn('[EXPIRED_CLEANUP] Failed to cleanup:', err);
          cleanedUpIdsRef.current.delete(m.id); // Allow retry on failure
        });
    });
  }, [messages, now, token, id, cleanupExpiredMutation]);

  const [text, setText] = useState('');
  const [reportVisible, setReportVisible] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSendingVoice, setIsSendingVoice] = useState(false); // P0-003: Voice upload state

  // ─── Scroll to bottom helper (with Android timing fix - matches locked pattern) ───
  const scrollToBottom = useCallback((animated = true) => {
    const run = () => flatListRef.current?.scrollToEnd({ animated });
    if (Platform.OS === 'android') {
      InteractionManager.runAfterInteractions(() => setTimeout(run, 120));
    } else {
      requestAnimationFrame(run);
    }
  }, []);

  // P0-003: Voice recording with backend upload (Phase-1 parity)
  // Voice messages are uploaded to Convex storage and sent via sendPrivateMessage
  // Note: localAddMessage/deleteMessage defined earlier with store selectors

  const handleRecordingComplete = useCallback(async (result: VoiceRecorderResult) => {
    if (!id || !token) {
      Alert.alert('Error', 'Cannot send voice message. Please try again.');
      return;
    }

    setIsSendingVoice(true);

    try {
      // Step 1: Get upload URL from Convex
      const uploadUrl = await generateUploadUrl();

      // Step 2: Read audio file and convert to blob
      const response = await fetch(result.audioUri);
      const blob = await response.blob();

      // Step 3: Upload blob to Convex storage
      const uploadResult = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/m4a' },
        body: blob,
      });

      if (!uploadResult.ok) {
        throw new Error('Failed to upload audio file');
      }

      const { storageId } = await uploadResult.json();

      // Step 4: Send voice message via backend mutation
      await sendMessageMutation({
        token,
        conversationId: id as Id<'privateConversations'>,
        type: 'voice',
        content: 'Voice message',
        audioStorageId: storageId,
        audioDurationMs: result.durationMs,
      });

      // Message will appear via Convex subscription - no local add needed
      scrollToBottom();
    } catch (e) {
      if (__DEV__) console.warn('[Phase2Chat] Failed to send voice message:', e);
      Alert.alert('Error', 'Failed to send voice message. Please try again.');
    } finally {
      setIsSendingVoice(false);
    }
  }, [id, token, generateUploadUrl, sendMessageMutation, scrollToBottom]);

  const handleRecordingError = useCallback((message: string) => {
    Alert.alert('Recording Error', message);
  }, []);

  const {
    isRecording,
    elapsedMs,
    maxDurationMs,
    toggleRecording,
  } = useVoiceRecorder({
    onRecordingComplete: handleRecordingComplete,
    onError: handleRecordingError,
  });

  // Format elapsed time as 0:xx
  const formatRecordingTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  // P0-001: Delete message handler (supports both local and backend messages)
  // - Backend messages (including voice after P0-003): call deletePrivateMessage mutation
  // - Local messages (tod system messages only): just remove from local store
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!id) return;

    // Local-only messages have prefixed IDs (tod_result_ for Truth-or-Dare system messages)
    // Note: Voice messages now go through backend (P0-003), so im_voice_ prefix is legacy only
    const isLocalOnly = messageId.startsWith('im_voice_') || messageId.startsWith('tod_result_');

    if (isLocalOnly) {
      // Just remove from local store
      deleteMessage(id, messageId);
      return;
    }

    // Backend message: call mutation
    if (!token) {
      console.warn('[Phase2Chat] Cannot delete message: no token');
      return;
    }

    try {
      await deleteMessageMutation({
        token,
        messageId: messageId as Id<'privateMessages'>,
      });
      // Also remove from local store for immediate UI feedback
      deleteMessage(id, messageId);
    } catch (e) {
      if (__DEV__) console.warn('[Phase2Chat] Failed to delete message:', e);
      Alert.alert('Error', 'Failed to delete message. Please try again.');
    }
  }, [id, token, deleteMessage, deleteMessageMutation]);

  // Alias for backward compatibility with voice message component
  const handleDeleteVoiceMessage = handleDeleteMessage;

  // Camera/gallery state for secure photos
  const [showCameraSheet, setShowCameraSheet] = useState(false);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);
  const [pendingMediaType, setPendingMediaType] = useState<'photo' | 'video'>('photo');
  const [pendingIsMirrored, setPendingIsMirrored] = useState(false);

  // Secure photo viewer state
  const [viewingMessageId, setViewingMessageId] = useState<string | null>(null);
  // SENDER-VIEW-FIX: Track if sender is viewing their own sent media (no timer trigger)
  const [isSenderViewing, setIsSenderViewing] = useState(false);

  // ─── Truth-or-Dare game state moved to T/D Session Management section (line ~287) ───

  // PHASE 2 FIX: Enable profile navigation to Phase 2 profile route
  // Uses Phase 2 isolated profile screen - no Phase 1 data leakage
  // ISOLATION FIX: Use p2-profile to avoid URL collision with Phase-1 profile
  const handleOpenProfile = useCallback(() => {
    if (!conversation?.participantId) return;
    router.push(`/(main)/(private)/p2-profile/${conversation.participantId}`);
  }, [conversation?.participantId, router]);

  // PHASE 1 PARITY: Send result message to chat when spin completes
  // Also calls handleEndGame when "ended the game" is detected (same as Phase 1 ChatScreenInner)
  const handleSendTodResult = useCallback((message: string) => {
    if (!id) return;

    // PHASE 1 PARITY: Check for end game message and call backend
    if (message.includes('ended the game')) {
      handleEndGame();
    }

    // T/D PERSISTENCE FIX: Send via backend (appears on BOTH users, survives reload)
    sendTodSystemMessage(message);
  }, [id, handleEndGame, sendTodSystemMessage]);

  // Check for captured media from camera-composer when screen regains focus
  useFocusEffect(
    useCallback(() => {
      const checkCapturedMedia = () => {
        if (!id) return;
        const key = `secure_capture_media_${id}`;
        // Pop from memory (get and delete atomically, no persistence)
        const data = popHandoff<{ uri: string; type: string; isMirrored?: boolean }>(key);
        if (!data) return;

        try {
          if (data.uri && data.type && (data.type === 'photo' || data.type === 'video')) {
            setPickedImageUri(data.uri);
            setPendingMediaType(data.type);
            setPendingIsMirrored(data.isMirrored === true);
            setShowCameraSheet(true);
          }
        } catch {
          // Ignore parse errors
        }
      };
      checkCapturedMedia();
    }, [id])
  );

  // Auto-scroll only when new messages arrive AND user is near bottom
  useEffect(() => {
    const count = messages.length;
    if (count > prevMessageCountRef.current && isNearBottomRef.current) {
      scrollToBottom(true);
    }
    prevMessageCountRef.current = count;
  }, [messages.length, scrollToBottom]);

  // ─── Keyboard listener: scroll on open (matches locked chat-rooms pattern) ───
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      scrollToBottom(true);
    });
    return () => sub.remove();
  }, [scrollToBottom]);

  // Phase-2 analytics: Track when chat opens
  useEffect(() => {
    if (!conversation || !id) return;
    // P1-004 FIX: Use backend participantIntentKey directly instead of demo data lookup
    trackEvent({
      name: 'phase2_match_started',
      conversationId: id,
      privateIntentKey: (conversation as any).participantIntentKey ?? undefined,
    });
  }, [id, conversation?.id]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002b: Send message via backend (replaces local store)
  // ═══════════════════════════════════════════════════════════════════════════
  const handleSend = useCallback(async () => {
    if (!text.trim() || !id || !token || isSending) return;

    const content = text.trim();
    setText(''); // Clear immediately for responsiveness

    // P2-INSTRUMENTATION: Send pressed
    P2.messages.sendPressed(id, 'text');

    setIsSending(true);
    try {
      // P2-INSTRUMENTATION: Send requested
      P2.messages.sendRequested(id, 'text');
      const result = await sendMessageMutation({
        token,
        conversationId: id as Id<'privateConversations'>,
        type: 'text',
        content,
        clientMessageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      });
      // P2-INSTRUMENTATION: Send success
      P2.messages.sendSuccess(id, (result as any)?.messageId || 'unknown');
      // Message will appear via query reactivity
      scrollToBottom(true);
    } catch (err) {
      // P2-INSTRUMENTATION: Send failed
      P2.messages.sendFailed(id, (err as Error)?.message || 'unknown');
      // Restore text on error
      setText(content);
      Alert.alert('Error', 'Failed to send message. Please try again.');
      if (__DEV__) console.warn('[Phase2Chat] Send failed:', err);
    } finally {
      setIsSending(false);
    }
  }, [text, id, token, isSending, sendMessageMutation, scrollToBottom]);

  // PHASE 1 PARITY: Report/Block/Leave handlers moved to ReportModal component
  // ReportModal now handles all backend calls internally

  // Gallery picker for secure photos/videos (Phase-1 style: from + menu)
  const handleGalleryPick = useCallback(async () => {
    if (!conversation) return;
    setShowAttachMenu(false);

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library access is needed to select media.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
        allowsEditing: false,
        selectionLimit: 1,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      setPickedImageUri(asset.uri);
      setPendingMediaType(isVideo ? 'video' : 'photo');
      setShowCameraSheet(true);
    } catch {
      // STABILITY: ImagePicker can fail on various devices
      Alert.alert('Error', 'Could not open photo picker. Please try again.');
    }
  }, [conversation]);

  // Camera capture: navigate directly to camera screen in PHOTO mode (no Alert prompt)
  const handleCameraCapture = useCallback(() => {
    if (!conversation) {
      if (__DEV__) console.log('[Phase2Chat] Camera capture aborted - no conversation');
      return;
    }
    setShowAttachMenu(false);
    router.push(`/(main)/camera-composer?mode=secure_capture&conversationId=${id}` as any);
  }, [conversation, id, router]);

  // Voice recording from + menu
  const handleVoiceFromMenu = useCallback(() => {
    setShowAttachMenu(false);
    toggleRecording();
  }, [toggleRecording]);

  // P1-001 FIX: Handle secure photo/video confirmation from CameraPhotoSheet
  // Flow: 1) Show optimistic local message 2) Upload to storage 3) Send via backend
  const handleCameraPhotoConfirm = useCallback(async (imageUri: string, options: CameraPhotoOptions) => {
    setShowCameraSheet(false);
    setPickedImageUri(null);
    const isVideo = pendingMediaType === 'video';
    const isMirrored = pendingIsMirrored;

    setPendingMediaType('photo'); // Reset for next time
    setPendingIsMirrored(false); // Reset for next time

    if (!id || !token) return;

    const optimisticId = `im_${isVideo ? 'video' : 'photo'}_${Date.now()}`;
    const messageType = isVideo ? 'video' : 'image';

    // Step 1: Create optimistic local message immediately (shows "uploading" state)
    const optimisticMsg: IncognitoMessage = {
      id: optimisticId,
      conversationId: id,
      senderId: 'me',
      content: isVideo ? '🎬 Sending secure video...' : '📷 Sending secure photo...',
      createdAt: Date.now(),
      isRead: false,
      isProtected: true,
      protectedMedia: {
        localUri: imageUri,
        mediaType: isVideo ? 'video' : 'photo',
        timer: options.timer,
        viewingMode: options.viewingMode,
        screenshotAllowed: false,
        viewOnce: options.timer === 0,
        watermark: false,
        isMirrored,
      },
    };

    localAddMessage(id, optimisticMsg);

    try {
      // Step 2: Get upload URL from backend
      const uploadUrl = await generateSecureMediaUploadUrl({ token });

      // Step 3: Upload media file to storage
      const response = await fetch(imageUri);
      const blob = await response.blob();

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || (isVideo ? 'video/mp4' : 'image/jpeg') },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload media');
      }

      const { storageId } = await uploadResponse.json();

      // Step 4: Send message via backend with storageId
      await sendMessageMutation({
        token,
        conversationId: id as Id<'privateConversations'>,
        type: messageType as 'image' | 'video',
        content: isVideo ? '🎬 Secure Video' : '📷 Secure Photo',
        imageStorageId: storageId,
        isProtected: true,
        protectedMediaTimer: options.timer,
        protectedMediaViewingMode: options.viewingMode,
        protectedMediaIsMirrored: isMirrored,
        clientMessageId: optimisticId, // For idempotency
      });

      // Step 5: Remove optimistic message (backend subscription will add the real one)
      deleteMessage(id, optimisticId);
    } catch (error: any) {
      if (__DEV__) console.warn('[Phase2Chat] Failed to send secure media:', error?.message);
      // Update optimistic message to show error
      deleteMessage(id, optimisticId);
      Alert.alert('Error', 'Failed to send secure media. Please try again.');
    }
  }, [id, token, localAddMessage, deleteMessage, generateSecureMediaUploadUrl, sendMessageMutation, pendingMediaType, pendingIsMirrored]);

  // Loading state while fetching conversation from backend
  const isLoadingConversation = !localConversation && backendConversation === undefined;

  if (isLoadingConversation) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color={C.text} />
            <Text style={styles.headerName}>Loading...</Text>
          </View>
        </View>
      </View>
    );
  }

  // P0-FIX C: Show clear error UI with explanation instead of dead blank screen
  if (!conversation) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerName}>Chat</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Ionicons name="chatbubble-ellipses-outline" size={64} color={C.textLight} />
          <Text style={{ fontSize: 18, fontWeight: '600', color: C.text, marginTop: 16, textAlign: 'center' }}>
            Conversation not found
          </Text>
          <Text style={{ fontSize: 14, color: C.textLight, marginTop: 8, textAlign: 'center' }}>
            This conversation may have been deleted or is no longer available.
          </Text>
          <TouchableOpacity
            style={{ marginTop: 24, backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
            onPress={() => router.back()}
          >
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderMessage = ({ item, index }: { item: IncognitoMessage; index: number }) => {
    const isOwn = item.senderId === 'me';

    // AVATAR-GROUPING: Check if previous message is from same sender (to hide redundant avatars)
    // For grouped consecutive messages, only show avatar on the FIRST message of the group
    const prevMessage = index > 0 ? messages[index - 1] : null;
    const isSameSenderAsPrev = prevMessage && prevMessage.senderId === item.senderId;
    const showAvatar = !isOwn && !isSameSenderAsPrev;
    const isSystem = item.senderId === 'system';
    // T/D PERSISTENCE FIX: Detect T/D events from both local (senderId='tod') and backend (type='system')
    const isTodEvent = item.senderId === 'tod' || item.type === 'system';

    // PHASE-1 PARITY FIX: Avatar blur should be conditional (match header avatar behavior)
    // Only blur when photo IS blurred AND viewer doesn't have clear access
    const avatarBlurRadius =
      (conversation as any)?.isPhotoBlurred && !(conversation as any)?.canViewClearPhoto
        ? PHASE2_BLUR_AVATAR
        : 0;

    // FIX #1: ToD event messages match Phase-1 SystemMessage style (dice icon, not flame)
    if (isTodEvent) {
      return (
        <View style={styles.todEventRow}>
          <View style={styles.todEventCapsule}>
            <Ionicons name="dice" size={13} color={C.primary} style={styles.todEventIcon} />
            <Text style={styles.todEventText}>{item.content}</Text>
          </View>
        </View>
      );
    }

    if (isSystem) {
      return (
        <View style={styles.systemMsgRow}>
          <Text style={styles.systemMsgText}>{item.content}</Text>
        </View>
      );
    }

    // Voice message
    if (item.type === 'voice' && item.audioUri) {
      return (
        <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
          {/* AVATAR-GROUPING: Only show avatar for first message in group */}
          {showAvatar ? (
            <Image
              source={{ uri: conversation.participantPhotoUrl }}
              style={styles.msgAvatar}
              blurRadius={avatarBlurRadius}
            />
          ) : !isOwn ? (
            <View style={styles.msgAvatarPlaceholder} />
          ) : null}
          <VoiceMessageBubble
            messageId={item.id}
            audioUri={item.audioUri}
            durationMs={item.durationMs || 0}
            isOwn={isOwn}
            timestamp={item.createdAt}
            onDelete={isOwn ? () => handleDeleteVoiceMessage(item.id) : undefined}
            darkTheme
            // VOICE-TICKS: Pass tick status props for sent/delivered/read indicators
            deliveredAt={item.deliveredAt}
            readAt={item.readAt}
          />
        </View>
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE-1 PARITY FIX: Protected media message (secure photo/video)
    // Uses SEPARATE render paths for sender vs receiver to match Phase-1 exactly
    // ═══════════════════════════════════════════════════════════════════════════
    if (item.isProtected) {
      const isExpired = item.isExpired;
      const isHoldMode = item.protectedMedia?.viewingMode === 'hold';
      const originalTimer = item.protectedMedia?.timer ?? 0;
      const isVideo = item.protectedMedia?.mediaType === 'video';
      const thumbnailUri = item.protectedMedia?.localUri;
      const isMirrored = item.protectedMedia?.isMirrored === true;

      // PHASE-1 PARITY: Live countdown - use shared helper
      const timerStarted = !!item.timerEndsAt;
      const countdown = timerStarted
        ? calculateProtectedMediaCountdown(item.timerEndsAt)
        : null;
      const remainingSec = countdown ? countdown.remainingSeconds : 0;
      const hasActiveTimer = timerStarted && remainingSec > 0;

      // Format timer preview for receiver (before opening): "30s" or "1m"
      const formatTimerPreview = (seconds: number): string => {
        if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
        return `${seconds}s`;
      };

      // Expired state: compact pill (same for sender and receiver)
      if (isExpired) {
        return (
          <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
            {/* AVATAR-GROUPING: Only show avatar for first message in group */}
            {showAvatar ? (
              <Image
                source={{ uri: conversation.participantPhotoUrl }}
                style={styles.msgAvatar}
                blurRadius={avatarBlurRadius}
              />
            ) : !isOwn ? (
              <View style={styles.msgAvatarPlaceholder} />
            ) : null}
            <View style={[styles.expiredPill, isOwn && styles.expiredPillOwn]}>
              <Ionicons name="lock-closed" size={12} color={C.textLight} />
              <Text style={styles.expiredPillText}>Expired</Text>
            </View>
          </View>
        );
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SENDER PATH: Dark/blurred card, TAP to preview (without triggering timer)
      // SENDER-VIEW-FIX: Sender can now tap to open viewer without triggering timer/expiry
      // ═══════════════════════════════════════════════════════════════════════
      if (isOwn) {
        // SENDER-VIEW-FIX: Handler to open viewer as sender (no timer trigger)
        const handleSenderPress = () => {
          if (!isExpired) {
            setIsSenderViewing(true);
            setViewingMessageId(item.id);
          }
        };

        return (
          <View style={[styles.msgRow, styles.msgRowOwn]}>
            <View style={styles.secureBubbleWrapper}>
              {/* SENDER-VIEW-FIX: Wrap in TouchableOpacity to allow sender preview */}
              <TouchableOpacity onPress={handleSenderPress} activeOpacity={0.8}>
                <View style={styles.secureThumbnailContainer}>
                  {/* PHASE-2 PRIVACY: Blurred thumbnail (same as receiver) */}
                  {thumbnailUri ? (
                    <Image
                      source={{ uri: thumbnailUri }}
                      style={[styles.secureThumbnail, isMirrored && styles.secureThumbnailMirrored]}
                      contentFit="cover"
                      blurRadius={25}
                    />
                  ) : (
                    <View style={styles.secureThumbnailPlaceholder}>
                      <Ionicons name={isVideo ? 'videocam' : 'image'} size={24} color={C.textLight} />
                    </View>
                  )}
                  {/* Dark overlay for blur effect */}
                  <View style={styles.secureBlurOverlay} />
                  {/* Media type indicator (top-left) */}
                  <View style={styles.secureMediaTypeIndicator}>
                    <Ionicons name={isVideo ? 'videocam' : 'image'} size={10} color="#FFFFFF" />
                  </View>
                  {/* Shield badge (bottom-right) - indicates secure media */}
                  <View style={styles.secureShieldBadge}>
                    <Ionicons name="shield-checkmark" size={10} color="#FFFFFF" />
                  </View>
                  {/* "Tap to preview" hint for sender */}
                  <View style={styles.secureHintOverlay}>
                    <Text style={styles.secureHintText}>Tap to preview</Text>
                  </View>
                </View>
              </TouchableOpacity>
              {/* Sender status: show if recipient has viewed */}
              {item.viewedAt && hasActiveTimer && (
                <View style={styles.senderStatusBadge}>
                  <Ionicons name="eye" size={10} color={SOFT_ACCENT} />
                  <Text style={styles.senderStatusText}>Viewing • {countdown?.label}</Text>
                </View>
              )}
              {item.viewedAt && originalTimer === 0 && (
                <View style={[styles.senderStatusBadge, styles.senderStatusOpened]}>
                  <Ionicons name="eye" size={10} color="#4CAF50" />
                  <Text style={[styles.senderStatusText, { color: '#4CAF50' }]}>Opened</Text>
                </View>
              )}
              {/* Time + tick row */}
              <View style={styles.secureBubbleFooter}>
                <Text style={[styles.msgTime, styles.msgTimeOwn]}>{formatTime(item.createdAt)}</Text>
                {(() => {
                  const tickStatus = getTickStatus(item);
                  return (
                    <Ionicons
                      name={getTickIcon(tickStatus)}
                      size={14}
                      color={getTickColor(tickStatus)}
                      style={styles.tickIcon}
                    />
                  );
                })()}
              </View>
            </View>
          </View>
        );
      }

      // ═══════════════════════════════════════════════════════════════════════
      // RECEIVER PATH: Blurred thumbnail, tap/hold to open viewer
      // Receiver sees blurred preview and can tap/hold to view
      // ═══════════════════════════════════════════════════════════════════════
      const handleReceiverPress = () => {
        if (!isHoldMode && !isExpired) {
          setViewingMessageId(item.id);
        }
      };

      const handleReceiverPressIn = () => {
        if (isHoldMode && !isExpired) {
          setViewingMessageId(item.id);
        }
      };

      const handleReceiverPressOut = () => {
        if (isHoldMode) {
          setViewingMessageId(null);
        }
      };

      return (
        <View style={[styles.msgRow]}>
          {/* AVATAR-GROUPING: Only show avatar for first message in group */}
          {showAvatar ? (
            <Image
              source={{ uri: conversation.participantPhotoUrl }}
              style={styles.msgAvatar}
              blurRadius={avatarBlurRadius}
            />
          ) : (
            <View style={styles.msgAvatarPlaceholder} />
          )}
          <TouchableOpacity
            onPress={handleReceiverPress}
            onPressIn={handleReceiverPressIn}
            onPressOut={handleReceiverPressOut}
            activeOpacity={isHoldMode ? 1 : 0.8}
            delayPressIn={isHoldMode ? 0 : undefined}
          >
            <View style={styles.secureThumbnailContainer}>
              {/* Blurred thumbnail */}
              {thumbnailUri ? (
                <Image
                  source={{ uri: thumbnailUri }}
                  style={[styles.secureThumbnail, isMirrored && styles.secureThumbnailMirrored]}
                  contentFit="cover"
                  blurRadius={25}
                />
              ) : (
                <View style={styles.secureThumbnailPlaceholder}>
                  <Ionicons name={isVideo ? 'videocam' : 'image'} size={24} color={C.textLight} />
                </View>
              )}
              {/* Dark overlay for blur effect */}
              <View style={styles.secureBlurOverlay} />
              {/* Media type indicator (top-left) */}
              <View style={styles.secureMediaTypeIndicator}>
                <Ionicons name={isVideo ? 'videocam' : 'image'} size={10} color="#FFFFFF" />
              </View>
              {/* Timer preview badge (top-right) - shows BEFORE opening */}
              {!timerStarted && originalTimer > 0 && (
                <View style={styles.secureTimerPreviewBadge}>
                  <Ionicons name="time-outline" size={10} color="#FFFFFF" />
                  <Text style={styles.secureTimerPreviewText}>{formatTimerPreview(originalTimer)}</Text>
                </View>
              )}
              {/* Live countdown (bottom-left) - shows DURING viewing */}
              {hasActiveTimer && (
                <View style={styles.secureLiveTimerBadge}>
                  <Ionicons name="time-outline" size={10} color="#FFFFFF" />
                  <Text style={styles.secureLiveTimerText}>{countdown?.label}</Text>
                </View>
              )}
              {/* Tap/Hold to view hint */}
              <View style={styles.secureHintOverlay}>
                <Text style={styles.secureHintText}>
                  {isHoldMode ? 'Hold to view' : 'Tap to view'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    // D2: Mask explicit words in private chat with "****"
    const { masked, wasMasked } = maskExplicitWords(item.content);

    // MESSAGE-TICKS-FIX: Get tick status for own messages
    const tickStatus = isOwn ? getTickStatus(item) : null;

    return (
      <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
        {/* AVATAR-GROUPING: Only show avatar for first message in group */}
        {showAvatar ? (
          <Image
            source={{ uri: conversation.participantPhotoUrl }}
            style={styles.msgAvatar}
            blurRadius={avatarBlurRadius}
          />
        ) : !isOwn ? (
          <View style={styles.msgAvatarPlaceholder} />
        ) : null}
        <View style={[styles.msgBubble, isOwn ? styles.msgBubbleOwn : styles.msgBubbleOther]}>
          <Text style={[styles.msgText, isOwn && styles.msgTextOwn]}>{masked}</Text>
          {wasMasked && (
            <Text style={styles.maskedNotice}>{MASKED_CONTENT_NOTICE}</Text>
          )}
          {/* MESSAGE-TICKS-FIX: Time + tick row for own messages */}
          <View style={styles.msgTimeRow}>
            <Text style={[styles.msgTime, isOwn && styles.msgTimeOwn]}>
              {formatTime(item.createdAt)}
            </Text>
            {isOwn && tickStatus && (
              <Ionicons
                name={getTickIcon(tickStatus)}
                size={14}
                color={getTickColor(tickStatus)}
                style={styles.tickIcon}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header — sits above KAV (does not move when keyboard opens) */}
      <View style={[styles.header, { marginTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        {/* PHASE 1 PARITY: Avatar with presence dot - tappable to open profile */}
        {/* PHOTO ACCESS: Conditional blur based on canViewClearPhoto */}
        <TouchableOpacity
          onPress={handleOpenProfile}
          style={styles.avatarButton}
          activeOpacity={0.7}
        >
          <View style={styles.avatarContainer}>
            {conversation.participantPhotoUrl ? (
              <Image
                source={{ uri: conversation.participantPhotoUrl }}
                style={styles.headerAvatar}
                blurRadius={
                  // Apply blur if photo is blurred AND viewer doesn't have clear access
                  (conversation as any).isPhotoBlurred && !(conversation as any).canViewClearPhoto
                    ? PHASE2_BLUR_AVATAR
                    : 0
                }
                contentFit="cover"
              />
            ) : (
              <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
                <Ionicons name="person" size={20} color={C.textLight} />
              </View>
            )}
            {/* PHASE 1 PARITY: Presence dot - green if online, gray if offline */}
            {(() => {
              const lastActive = (conversation as any).participantLastActive ?? 0;
              const isOnline = Date.now() - lastActive < 60_000;
              return (
                <View style={[
                  styles.presenceDot,
                  isOnline ? styles.presenceDotOnline : styles.presenceDotOffline,
                ]} />
              );
            })()}
            {/* PHOTO ACCESS: Lock icon when photo is blurred and not approved */}
            {(conversation as any).isPhotoBlurred && !(conversation as any).canViewClearPhoto && (
              <View style={styles.photoLockedBadge}>
                <Ionicons name="lock-closed" size={10} color="#FFFFFF" />
              </View>
            )}
          </View>
        </TouchableOpacity>
        {/* PHASE 1 PARITY: Name + online status - tappable to open profile */}
        <TouchableOpacity
          onPress={handleOpenProfile}
          style={styles.headerInfo}
          activeOpacity={0.7}
        >
          <Text style={styles.headerName} numberOfLines={1} ellipsizeMode="tail">
            {conversation.participantName}
          </Text>
          {/* PHASE 1 PARITY: Online status text exactly like Phase 1 */}
          {/* P1-004 FIX: Show "typing..." when other user is typing */}
          <Text style={[styles.headerStatus, isOtherUserTyping && styles.headerStatusTyping]}>
            {(() => {
              // P1-004 FIX: Typing indicator takes priority
              if (isOtherUserTyping) return 'typing...';
              const lastActive = (conversation as any).participantLastActive ?? 0;
              const now = Date.now();
              const diff = now - lastActive;
              // Online: within 1 minute (likely still in app)
              if (diff < 60_000) return 'Online';
              // Active now: within 5 minutes
              if (diff < 5 * 60_000) return 'Active now';
              // Recently active: anything else with valid timestamp
              if (lastActive > 0) return 'Recently active';
              return 'Offline';
            })()}
          </Text>
        </TouchableOpacity>
        {/* PHOTO ACCESS: Request access button when photo is blurred */}
        {(conversation as any).isPhotoBlurred && !(conversation as any).canViewClearPhoto && (
          <TouchableOpacity
            onPress={handleRequestPhotoAccess}
            style={[
              styles.photoAccessButton,
              (conversation as any).photoAccessStatus === 'pending' && styles.photoAccessButtonPending,
            ]}
            disabled={(conversation as any).photoAccessStatus === 'pending' || photoAccessRequesting}
            activeOpacity={0.7}
          >
            {photoAccessRequesting ? (
              <ActivityIndicator size="small" color={C.primary} />
            ) : (
              <>
                <Ionicons
                  name={(conversation as any).photoAccessStatus === 'pending' ? 'time-outline' : 'eye-outline'}
                  size={14}
                  color={(conversation as any).photoAccessStatus === 'pending' ? C.textLight : C.primary}
                />
                <Text style={[
                  styles.photoAccessButtonText,
                  (conversation as any).photoAccessStatus === 'pending' && styles.photoAccessButtonTextPending,
                ]}>
                  {(conversation as any).photoAccessStatus === 'pending' ? 'Pending' : 'Request photo'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {/* PHASE 1 PARITY: Truth-or-Dare button with full session flow */}
        {/* handleTruthDarePress checks: cooldown → active → pending → show invite */}
        <TouchableOpacity
          onPress={handleTruthDarePress}
          hitSlop={8}
          style={styles.gameButton}
          disabled={gameSession?.state === 'pending' && gameSession?.inviterId === currentUserId}
        >
          <View style={[
            styles.truthDareButton,
            // PHASE 1 PARITY: Show badge dot when there's a pending invite for me
            gameSession?.state === 'pending' && gameSession?.inviteeId === currentUserId && styles.truthDareButtonWithBadge,
            // PHASE 1 PARITY: Dim button if I sent a pending invite (waiting for response)
            gameSession?.state === 'pending' && gameSession?.inviterId === currentUserId && styles.truthDareButtonWaiting,
            // PHASE 1 PARITY: Dim button during cooldown
            gameSession?.state === 'cooldown' && styles.truthDareButtonCooldown,
            // TD-UX: Special "ready to start" style for inviter when accepted but not started
            gameSession?.state === 'active' && !gameSession?.gameStartedAt && gameSession?.inviterId === currentUserId && styles.truthDareButtonReadyToStart,
            // Green for active game that's already started
            gameSession?.state === 'active' && !!gameSession?.gameStartedAt && styles.truthDareButtonActive,
          ]}>
            <Ionicons name="wine" size={18} color="#FFFFFF" />
            <Text style={[
              styles.truthDareLabel,
              gameSession?.state === 'pending' && gameSession?.inviterId === currentUserId && styles.truthDareLabelWaiting,
            ]}>
              {gameSession?.state === 'pending' && gameSession?.inviterId === currentUserId
                ? 'Waiting...'
                : gameSession?.state === 'active' && !gameSession?.gameStartedAt && gameSession?.inviterId === currentUserId
                  ? 'Start!'
                  : 'T/D'}
            </Text>
          </View>
          {/* PHASE 1 PARITY: Badge dot for pending invite for me */}
          {gameSession?.state === 'pending' && gameSession?.inviteeId === currentUserId && (
            <View style={styles.truthDareBadge} />
          )}
          {/* TD-UX: Badge dot for inviter when ready to start */}
          {gameSession?.state === 'active' && !gameSession?.gameStartedAt && gameSession?.inviterId === currentUserId && (
            <View style={styles.truthDareStartBadge} />
          )}
        </TouchableOpacity>
        {/* PHASE 1 PARITY: Cooldown message toast */}
        {showCooldownMessage && (
          <View style={styles.cooldownToast}>
            <Text style={styles.cooldownToastText}>
              T/D available in {cooldownRemainingMin}m
            </Text>
          </View>
        )}
        {/* TD-UX: Waiting for inviter to start toast */}
        {showWaitingForStartToast && (
          <View style={styles.waitingStartToast}>
            <Text style={styles.waitingStartToastText}>
              Waiting for {conversation?.participantName || 'them'} to start
            </Text>
          </View>
        )}
        <TouchableOpacity onPress={() => setReportVisible(true)} style={styles.moreButton}>
          <Ionicons name="ellipsis-vertical" size={20} color={C.textLight} />
        </TouchableOpacity>
      </View>

      {/* PHOTO ACCESS: Owner approval banner when someone requests access to my photo */}
      {pendingRequestFromOther && (
        <View style={styles.photoRequestBanner}>
          <View style={styles.photoRequestContent}>
            <Ionicons name="eye-outline" size={18} color={C.text} />
            <Text style={styles.photoRequestText}>
              <Text style={styles.photoRequestName}>{conversation?.participantName}</Text>
              {' wants to see your photo'}
            </Text>
          </View>
          <View style={styles.photoRequestActions}>
            <TouchableOpacity
              style={styles.photoRequestDeclineButton}
              onPress={() => handleRespondToPhotoRequest(false)}
              disabled={respondingToRequest}
            >
              <Text style={styles.photoRequestDeclineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoRequestApproveButton}
              onPress={() => handleRespondToPhotoRequest(true)}
              disabled={respondingToRequest}
            >
              {respondingToRequest ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.photoRequestApproveText}>Approve</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ─── KEYBOARD AVOIDING VIEW (matches locked chat-rooms pattern) ─── */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatArea}>
          {/* Messages */}
          {backendMessages === undefined ? (
            // Loading state
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
          ) : (
            <FlashList
              ref={flatListRef}
              data={messages}
              extraData={{ now, messageStatusHash }}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="chatbubble-outline" size={40} color={C.textLight} />
                  <Text style={styles.emptyText}>Say hi 👋</Text>
                </View>
              }
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: messages.length > 0 ? 'flex-end' as const : 'center' as const,
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: composerHeight,
              }}
              onScroll={onScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            />
          )}

          {/* Recording indicator */}
          {isRecording && (
            <View style={styles.recordingBanner}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>
                Recording... {formatRecordingTime(elapsedMs)} / {formatRecordingTime(maxDurationMs)}
              </Text>
            </View>
          )}

          {/* ─── COMPOSER (Phase-1 style: + menu with Camera/Gallery/Voice) ─── */}
          {/* ANDROID FIX: Use insets.bottom on all platforms for 3-button nav support */}
          <View
            style={[styles.composerWrapper, { paddingBottom: insets.bottom + 8 }]}
            onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
          >
            <View style={styles.inputBar}>
              {/* + Button with popup menu - LEFT side of TextInput */}
              {!isRecording ? (
                <TouchableOpacity
                  style={styles.attachButton}
                  onPress={() => setShowAttachMenu(true)}
                >
                  <Ionicons name="add" size={26} color={C.primary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.attachButton, styles.stopButton]}
                  onPress={toggleRecording}
                >
                  <Ionicons name="stop" size={22} color="#FF4444" />
                </TouchableOpacity>
              )}

              <TextInput
                style={[styles.textInput, isRecording && styles.textInputRecording]}
                placeholder={isRecording ? 'Recording voice message...' : 'Type a message...'}
                placeholderTextColor={isRecording ? '#FF4444' : C.textLight}
                value={text}
                onChangeText={(newText) => {
                  setText(newText);
                  // P1-004 FIX: Update typing status when user types
                  if (newText.length > 0) {
                    updateTypingStatus(true);
                  } else {
                    updateTypingStatus(false);
                  }
                }}
                multiline
                scrollEnabled
                textAlignVertical="top"
                blurOnSubmit={false}
                maxLength={1000}
                editable={!isRecording && !isSending}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="noExcludeDescendants"
              />

              {!isRecording && (
                <TouchableOpacity
                  style={[styles.sendButton, (!text.trim() || isSending) && styles.sendButtonDisabled]}
                  onPress={handleSend}
                  disabled={!text.trim() || isSending}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color={C.textLight} />
                  ) : (
                    <Ionicons name="send" size={20} color={text.trim() ? '#FFFFFF' : C.textLight} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* + Menu Modal */}
          <Modal
            visible={showAttachMenu}
            transparent
            animationType="fade"
            onRequestClose={() => setShowAttachMenu(false)}
          >
            <Pressable style={styles.menuOverlay} onPress={() => setShowAttachMenu(false)}>
              <View style={styles.menuContainer}>
                <TouchableOpacity style={styles.menuItem} onPress={handleCameraCapture}>
                  <View style={[styles.menuIcon, { backgroundColor: C.primary }]}>
                    <Ionicons name="camera" size={20} color="#FFFFFF" />
                  </View>
                  <Text style={styles.menuText}>Camera</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={handleGalleryPick}>
                  <View style={[styles.menuIcon, { backgroundColor: '#9B59B6' }]}>
                    <Ionicons name="images" size={20} color="#FFFFFF" />
                  </View>
                  <Text style={styles.menuText}>Gallery</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={handleVoiceFromMenu}>
                  <View style={[styles.menuIcon, { backgroundColor: '#E67E22' }]}>
                    <Ionicons name="mic" size={20} color="#FFFFFF" />
                  </View>
                  <Text style={styles.menuText}>Voice</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Modal>
        </View>
      </KeyboardAvoidingView>

      {/* PHASE 1 PARITY: Report/Block/Leave Modal with full backend integration */}
      <ReportModal
        visible={reportVisible}
        targetName={conversation.participantName}
        targetUserId={conversation.participantId}
        currentUserId={currentUserId || ''}
        conversationId={id}
        onClose={() => setReportVisible(false)}
        onBlockSuccess={() => router.back()}
        onLeaveSuccess={() => router.back()}
      />

      {/* PHASE 1 PARITY: Truth-or-Dare Game — same component as Phase-1 */}
      {/* T/D AUTH FIX: Use real currentUserId for backend mutations, not hardcoded "me" */}
      {/* NOTE: handleEndGame called from handleSendTodResult when it detects "ended the game" */}
      <BottleSpinGame
        visible={showTruthDareGame}
        onClose={() => setShowTruthDareGame(false)}
        currentUserName="You"
        otherUserName={conversation.participantName}
        conversationId={id}
        userId={currentUserId || ''}
        onSendResultMessage={handleSendTodResult}
      />

      {/* PHASE 1 PARITY: Truth/Dare Invite Modal (first-tap flow) */}
      <Modal
        visible={showTruthDareInvite}
        animationType="fade"
        transparent
        onRequestClose={() => setShowTruthDareInvite(false)}
      >
        <View style={styles.tdInviteOverlay}>
          <View style={styles.tdInviteContainer}>
            <View style={styles.tdInviteHeader}>
              <View style={styles.tdInviteIconContainer}>
                <Ionicons name="wine" size={28} color="#FFFFFF" />
              </View>
              <Text style={styles.tdInviteTitle}>Truth or Dare</Text>
            </View>
            <Text style={styles.tdInviteMessage}>
              Invite {conversation.participantName} to play Truth or Dare?
            </Text>
            <View style={styles.tdInviteActions}>
              <TouchableOpacity
                style={[styles.tdInviteButton, styles.tdInviteCancelButton]}
                onPress={() => setShowTruthDareInvite(false)}
              >
                <Text style={styles.tdInviteCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tdInviteButton, styles.tdInviteSendButton]}
                onPress={handleSendInvite}
              >
                <Text style={styles.tdInviteSendText}>Invite</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PHASE 1 PARITY: Truth/Dare Pending Invite Card (for invitee) */}
      {/* T/D-DEBUG: Log render condition */}
      {(() => {
        const shouldShow = gameSession?.state === 'pending' && gameSession?.inviteeId === currentUserId;
        if (__DEV__ && gameSession?.state === 'pending') {
          console.log('[P2_TD_RENDER] Invite card check:',
            '\n  state:', gameSession.state,
            '\n  inviteeId:', gameSession.inviteeId?.slice(-8),
            '\n  currentUserId:', currentUserId?.slice(-8),
            '\n  match:', gameSession.inviteeId === currentUserId,
            '\n  shouldShow:', shouldShow
          );
        }
        return shouldShow ? (
          <View style={styles.tdPendingInviteWrapper}>
            <TruthDareInviteCard
              inviterName={conversation.participantName}
              isInvitee={true}
              onAccept={() => handleRespondToInvite(true)}
              onReject={() => handleRespondToInvite(false)}
            />
          </View>
        ) : null;
      })()}

      {/* Camera Photo Sheet (gallery/camera picker -> secure options) */}
      <CameraPhotoSheet
        visible={showCameraSheet}
        imageUri={pickedImageUri}
        mediaType={pendingMediaType}
        onConfirm={handleCameraPhotoConfirm}
        onCancel={() => {
          setShowCameraSheet(false);
          setPickedImageUri(null);
          setPendingMediaType('photo');
        }}
      />

      {/* Secure Photo Viewer */}
      {viewingMessageId && id && (
        <Phase2ProtectedMediaViewer
          visible={!!viewingMessageId}
          conversationId={id}
          messageId={viewingMessageId}
          onClose={() => {
            setViewingMessageId(null);
            setIsSenderViewing(false); // SENDER-VIEW-FIX: Reset sender viewing state
          }}
          // SENDER-VIEW-FIX: Pass sender viewing flag to prevent timer trigger
          isSenderViewing={isSenderViewing}
          // PHASE-1 PARITY FIX: Pass message data for backend messages
          messageData={(() => {
            const msg = messages.find((m) => m.id === viewingMessageId);
            if (!msg) return null;
            return {
              id: msg.id,
              isProtected: msg.isProtected,
              isExpired: msg.isExpired,
              viewedAt: msg.viewedAt,
              timerEndsAt: msg.timerEndsAt,
              protectedMedia: msg.protectedMedia,
            };
          })()}
        />
      )}
    </View>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const C = INCOGNITO_COLORS;

// GOAL C: Softer accent colors for Phase-2 secure photo elements (not harsh pink)
const SOFT_ACCENT = '#7B68A6'; // Muted plum/purple
const SOFT_ACCENT_BG = '#3D3255'; // Deep plum background
const SOFT_ACCENT_ACTIVE = '#9B7DC4'; // Slightly brighter for active timer

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  keyboardAvoid: { flex: 1 },
  chatArea: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
    color: C.textLight,
  },
  composerWrapper: { backgroundColor: C.background },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  backButton: { marginRight: 8 },
  // PHASE 1 PARITY: Avatar button and container for presence dot overlay
  avatarButton: { marginRight: 8 },
  avatarContainer: { position: 'relative' as const },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accent },
  headerAvatarPlaceholder: { alignItems: 'center' as const, justifyContent: 'center' as const },
  // PHASE 1 PARITY: Presence dot styles
  presenceDot: {
    position: 'absolute' as const,
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: C.background,
  },
  presenceDotOnline: { backgroundColor: '#22C55E' },
  presenceDotOffline: { backgroundColor: C.textLight, opacity: 0.5 },
  // PHASE 1 PARITY: Header info layout
  headerInfo: { flex: 1, marginLeft: 10 },
  headerName: { fontSize: 16, fontWeight: '600' as const, color: C.text },
  headerStatus: { fontSize: 13, color: C.textLight, marginTop: 2 },
  // P1-004 FIX: Typing indicator style - subtle green color
  headerStatusTyping: { color: '#22C55E', fontStyle: 'italic' },
  moreButton: { padding: 8 },
  gameButton: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 4,
  },
  truthDareButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: C.primary,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 4,
  },
  truthDareLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },

  systemMsgRow: { alignItems: 'center', marginBottom: 12 },
  systemMsgText: { fontSize: 12, color: C.textLight, fontStyle: 'italic', textAlign: 'center' },

  // FIX #1: ToD event capsule styles matching Phase-1 SystemMessage
  todEventRow: {
    alignItems: 'center' as const,
    marginVertical: 6,
  },
  todEventCapsule: {
    alignSelf: 'center' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: C.surface, // Phase-2 dark theme equivalent of COLORS.backgroundDark
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 5,
  },
  todEventIcon: {
    marginRight: 2,
  },
  todEventText: {
    fontSize: 12,
    color: C.textLight,
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
  },

  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  msgRowOwn: { flexDirection: 'row-reverse' },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8, backgroundColor: C.accent },
  // AVATAR-GROUPING: Placeholder to maintain spacing when avatar is hidden
  msgAvatarPlaceholder: { width: 28, height: 28, marginRight: 8 },
  msgBubble: { maxWidth: '75%', padding: 12, borderRadius: 16 },
  msgBubbleOwn: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: C.surface, borderBottomLeftRadius: 4 },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE-1 PARITY: Secure media thumbnail card (matches ProtectedMediaBubble)
  // ═══════════════════════════════════════════════════════════════════════════
  secureBubbleWrapper: {
    alignItems: 'flex-end' as const,
  },
  secureThumbnailContainer: {
    width: 100,
    height: 75,
    borderRadius: 8,
    overflow: 'hidden' as const,
    backgroundColor: '#1E1E2E',
  },
  secureThumbnail: {
    width: '100%' as any,
    height: '100%' as any,
  },
  secureThumbnailMirrored: {
    transform: [{ scaleX: -1 }],
  },
  secureThumbnailPlaceholder: {
    width: '100%' as any,
    height: '100%' as any,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#1E1E2E',
  },
  secureBlurOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(30, 30, 46, 0.4)',
  },
  secureMediaTypeIndicator: {
    position: 'absolute' as const,
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  secureShieldBadge: {
    position: 'absolute' as const,
    bottom: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(155, 125, 196, 0.8)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  secureTimerPreviewBadge: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
    backgroundColor: 'rgba(155, 125, 196, 0.8)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
  },
  secureTimerPreviewText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '600' as const,
  },
  secureLiveTimerBadge: {
    position: 'absolute' as const,
    top: 4,
    right: 26, // TIMER-UI-FIX: Move to top-right, next to timer preview badge
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
  },
  secureLiveTimerText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '600' as const,
  },
  secureHintOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  secureHintText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
  secureBubbleFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    marginTop: 4,
    gap: 4,
  },
  senderStatusBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(155, 125, 196, 0.15)',
    borderRadius: 10,
  },
  senderStatusOpened: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  senderStatusText: {
    fontSize: 10,
    color: SOFT_ACCENT,
    fontWeight: '600' as const,
  },

  // GOAL B: Small expired pill (not large card)
  expiredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: C.surface,
    opacity: 0.7,
  },
  expiredPillOwn: {
    backgroundColor: SOFT_ACCENT_BG,
  },
  expiredPillText: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '500',
  },
  msgText: { fontSize: 14, color: C.text, lineHeight: 20 },
  msgTextOwn: { color: '#FFFFFF' },
  // MESSAGE-TICKS-FIX: Time + tick row container
  msgTimeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    marginTop: 4,
    gap: 4,
  },
  msgTime: { fontSize: 10, color: C.textLight, textAlign: 'right' as const },
  msgTimeOwn: { color: 'rgba(255,255,255,0.7)' },
  // MESSAGE-TICKS-FIX: Tick icon style
  tickIcon: {
    marginLeft: 2,
  },
  maskedNotice: { fontSize: 10, color: C.textLight, fontStyle: 'italic', marginTop: 2 },

  // Recording indicator
  recordingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF444420',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF4444',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 13,
    color: '#FF4444',
    fontWeight: '600',
  },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: C.surface, gap: 8,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stopButton: {
    backgroundColor: '#FF444420',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end' as const,
  },
  menuContainer: {
    position: 'absolute' as const,
    left: 16,
    bottom: 80,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 140,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 12,
  },
  menuText: {
    fontSize: 15,
    color: C.text,
    fontWeight: '500' as const,
  },
  textInput: {
    flex: 1, backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14, color: C.text, maxHeight: 100,
  },
  textInputRecording: {
    borderWidth: 1,
    borderColor: '#FF444440',
  },
  cameraButton: {
    padding: 8, marginRight: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: C.surface },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1 PARITY: T/D button visual states (matches ChatScreenInner.tsx)
  // ═══════════════════════════════════════════════════════════════════════════
  truthDareButtonWithBadge: {
    position: 'relative' as const,
  },
  truthDareBadge: {
    position: 'absolute' as const,
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E53E3E',
    borderWidth: 2,
    borderColor: C.background,
  },
  truthDareButtonWaiting: {
    opacity: 0.6,
    backgroundColor: C.textLight,
  },
  truthDareLabelWaiting: {
    fontSize: 10,
  },
  truthDareButtonCooldown: {
    opacity: 0.5,
    backgroundColor: '#999', // Muted gray for cooldown
  },
  truthDareButtonActive: {
    backgroundColor: '#27AE60', // Green for active game
  },
  // TD-UX: Special style for inviter when accepted but not started
  truthDareButtonReadyToStart: {
    backgroundColor: '#E67E22', // Orange - attention-grabbing
    borderWidth: 2,
    borderColor: '#F39C12',
  },
  truthDareStartBadge: {
    position: 'absolute' as const,
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F39C12', // Orange badge
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  cooldownToast: {
    position: 'absolute' as const,
    top: -40,
    right: 50,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 10,
  },
  cooldownToastText: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '500' as const,
  },
  // TD-UX: Waiting for start toast
  waitingStartToast: {
    position: 'absolute' as const,
    top: -40,
    right: 50,
    backgroundColor: '#E8F5E9', // Light green tint
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 10,
    borderWidth: 1,
    borderColor: '#81C784',
  },
  waitingStartToastText: {
    fontSize: 12,
    color: '#2E7D32', // Dark green
    fontWeight: '500' as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1 PARITY: T/D Invite Modal styles (matches ChatScreenInner)
  // ═══════════════════════════════════════════════════════════════════════════
  tdInviteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 24,
  },
  tdInviteContainer: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 24,
    width: '90%',
    maxWidth: 320,
    alignItems: 'center' as const,
  },
  tdInviteHeader: {
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  tdInviteIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 12,
  },
  tdInviteTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: C.text,
  },
  tdInviteMessage: {
    fontSize: 15,
    color: C.textLight,
    textAlign: 'center' as const,
    marginBottom: 24,
    lineHeight: 22,
  },
  tdInviteActions: {
    flexDirection: 'row' as const,
    gap: 12,
    width: '100%',
  },
  tdInviteButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center' as const,
  },
  tdInviteCancelButton: {
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.surface,
  },
  tdInviteSendButton: {
    backgroundColor: C.primary,
  },
  tdInviteCancelText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: C.text,
  },
  tdInviteSendText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  tdPendingInviteWrapper: {
    position: 'absolute' as const,
    bottom: 80,
    left: 0,
    right: 0,
    zIndex: 100,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHOTO ACCESS: Styles for privacy feature
  // ═══════════════════════════════════════════════════════════════════════════
  photoLockedBadge: {
    position: 'absolute' as const,
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: C.background,
  },
  photoAccessButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: C.surface,
    marginLeft: 4,
  },
  photoAccessButtonPending: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.surface,
  },
  photoAccessButtonText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: C.primary,
  },
  photoAccessButtonTextPending: {
    color: C.textLight,
  },
  // Owner-side photo request banner
  photoRequestBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: C.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.background,
  },
  photoRequestContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
    gap: 8,
  },
  photoRequestText: {
    fontSize: 13,
    color: C.text,
    flex: 1,
  },
  photoRequestName: {
    fontWeight: '600' as const,
    color: C.primary,
  },
  photoRequestActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginLeft: 12,
  },
  photoRequestDeclineButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.textLight,
  },
  photoRequestDeclineText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: C.textLight,
  },
  photoRequestApproveButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.primary,
    minWidth: 70,
    alignItems: 'center' as const,
  },
  photoRequestApproveText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
});
