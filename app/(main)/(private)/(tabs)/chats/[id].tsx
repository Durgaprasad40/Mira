/*
 * Phase-2 Messages thread (clean rewrite).
 *
 * Replaces app/(main)/incognito-chat.tsx as the canonical Phase-2 chat thread.
 * Lives inside (private)/(tabs)/chats so the bottom Phase-2 tab bar stays
 * visible while the thread is open.
 *
 * Backend used (Phase-2 only):
 *   - api.privateConversations.getPrivateConversation
 *   - api.privateConversations.getPrivateMessages
 *   - api.privateConversations.sendPrivateMessage
 *   - api.privateConversations.markPrivateMessagesRead
 *   - api.users.getUserById                  (current user name resolution)
 *   - api.games.getBottleSpinSession         (T/D session state)
 *   - api.games.sendBottleSpinInvite
 *   - api.games.respondToBottleSpinInvite
 *   - api.games.endBottleSpinGame
 *
 * Behavior copied from Phase-1 ChatScreenInner:
 *   - autoAdvance={true} on BottleSpinGame
 *   - real currentUserName from api.users.getUserById (no hardcoded "You")
 *   - inline cooldown toast overlay (auto-hide after 3s)
 *   - modal close sets a local "paused" flag so auto-open does not re-trigger
 */
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';
import {
  MessageBubble,
  MessageInput,
  BottleSpinGame,
  TruthDareInviteCard,
} from '@/components/chat';
import {
  Phase2CameraPhotoSheet,
  type Phase2CameraPhotoOptions,
} from '@/components/private/Phase2CameraPhotoSheet';
import { Phase2ProtectedMediaBubble } from '@/components/private/Phase2ProtectedMediaBubble';
import { Phase2ProtectedMediaViewer } from '@/components/private/Phase2ProtectedMediaViewer';
import { popHandoff } from '@/lib/memoryHandoff';

const C = INCOGNITO_COLORS;

type GameState = 'none' | 'pending' | 'active' | 'expired' | 'cooldown';

/**
 * NormalMediaModal: Fullscreen viewer for non-protected photos/videos sent
 * in Phase-2 messages. No backend mutations — these messages have no timer,
 * no expiry, and no view-once semantics. Phase-2 backend resolves imageUrl
 * for non-protected media in api.privateConversations.getPrivateMessages,
 * so the URL is already stable.
 */
function NormalMediaModal({
  uri,
  type,
  onClose,
}: {
  uri: string;
  type: 'image' | 'video';
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={normalStyles.container}>
        {type === 'image' ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
          />
        ) : (
          <NormalMediaVideo uri={uri} />
        )}
        <TouchableOpacity
          style={[normalStyles.closeBtn, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Close media viewer"
        >
          <Ionicons name="close" size={28} color={COLORS.white} />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function NormalMediaVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      allowsFullscreen={false}
      nativeControls
    />
  );
}

const normalStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function Phase2ChatThread() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id =
    typeof params.id === 'string' && params.id.trim()
      ? params.id.trim()
      : null;

  // ROUTE-DEBUG: Force log on every mount/render to confirm thread screen is active.
  console.log('🔥 THREAD SCREEN ACTIVE', id);

  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const insets = useSafeAreaInsets();

  // --------------------------------------------------------------------- queries
  const conversation = useQuery(
    api.privateConversations.getPrivateConversation,
    id && userId ? { conversationId: id as any, authUserId: userId } : 'skip'
  );

  const messages = useQuery(
    api.privateConversations.getPrivateMessages,
    id && userId
      ? { conversationId: id as any, authUserId: userId, limit: 100 }
      : 'skip'
  );

  const currentUser = useQuery(
    api.users.getUserById,
    userId ? { userId, viewerId: userId } : 'skip'
  );

  const gameSession = useQuery(
    api.games.getBottleSpinSession,
    id ? { conversationId: id } : 'skip'
  );

  // --------------------------------------------------------------------- mutations
  const sendPrivateMessage = useMutation(
    api.privateConversations.sendPrivateMessage
  );
  const generateMediaUploadUrl = useMutation(
    api.privateConversations.generateSecureMediaUploadUrl
  );
  const markRead = useMutation(api.privateConversations.markPrivateMessagesRead);
  const sendInvite = useMutation(api.games.sendBottleSpinInvite);
  const respondInvite = useMutation(api.games.respondToBottleSpinInvite);
  // P2_TD_PARITY: inviter manually starts the game after invitee accepts
  // (Phase-1 ChatScreenInner.tsx:1204). Without this, gameStartedAt never
  // gets set and the BottleSpinGame turn engine sits in pre-start.
  const startGame = useMutation(api.games.startBottleSpinGame);
  // P2_TD_PARITY: end the game when BottleSpinGame emits an "ended the game"
  // result message (Phase-1 ChatScreenInner.tsx:1339). Triggers cooldown.
  const endGame = useMutation(api.games.endBottleSpinGame);
  // P2_TD_FIX: backend returns state='expired' when an active session times
  // out (not_started / timeout / invite_expired) but the DB row is still
  // status='active'. We must call cleanupExpiredSession before letting the
  // user send a fresh invite, otherwise sendBottleSpinInvite throws
  // "Game already active". Mirrors Phase-1 ChatScreenInner.tsx:898.
  const cleanupExpired = useMutation(api.games.cleanupExpiredSession);
  const blockUser = useMutation(api.users.blockUser);
  const reportUser = useMutation(api.users.reportUser);
  const leaveConversation = useMutation(
    api.privateConversations.leavePrivateConversation
  );

  // --------------------------------------------------------------------- local state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showGameModal, setShowGameModal] = useState(false);
  const [tdPaused, setTdPaused] = useState(false);
  const [showCooldownToast, setShowCooldownToast] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showReportSheet, setShowReportSheet] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // P2_TD_PARITY: 1-second tick to drive live countdown text in cooldown
  // toast (Phase-1 ChatScreenInner.tsx:839,1636-1641). Only ticks while
  // gameSession.state === 'cooldown' to save renders.
  const [cooldownTick, setCooldownTick] = useState(0);
  // P2_TD_PARITY: Captured at press-time when only `remainingMs` snapshot is
  // available (Phase-1 ChatScreenInner.tsx:289,1162-1168). Ensures the live
  // countdown can keep ticking even between query refreshes.
  const cooldownAnchorRef = useRef<number | null>(null);

  // SECURE-MEDIA REVIEW STATE (Phase-1 parity):
  // After camera capture or gallery pick, hold the asset URI + media type so
  // <Phase2CameraPhotoSheet> can review it and let the user pick Normal /
  // Once / 30s / 60s before upload + send.
  const [pendingMediaUri, setPendingMediaUri] = useState<string | null>(null);
  const [pendingMediaType, setPendingMediaType] = useState<'photo' | 'video'>(
    'photo'
  );
  const [pendingIsMirrored, setPendingIsMirrored] = useState(false);

  // SECURE-MEDIA OPEN STATE (Phase-1 parity, Phase-2 backend):
  //   - protectedViewer: holds the message currently shown in the secure
  //     viewer (Phase2ProtectedMediaViewer). Cleared on close.
  //   - normalViewer: full-screen lightbox state for non-protected media
  //     (Normal photo/video) — { uri, type }.
  // Both are HOISTED here (not inside MessageBubble) so the viewer's
  // lifecycle survives bubble re-renders, mirroring how Phase-1
  // ChatScreenInner manages viewerMessageId.
  const [protectedViewer, setProtectedViewer] = useState<{
    raw: any;
    isSender: boolean;
  } | null>(null);
  const [normalViewer, setNormalViewer] = useState<{
    uri: string;
    type: 'image' | 'video';
  } | null>(null);

  // BOTTOM-ANCHOR-FIX: FlashList ref + initial-scroll tracking (Phase-1 parity).
  const listRef = useRef<FlashListRef<any>>(null);
  const hasInitiallyScrolledRef = useRef(false);
  const contentHeightRef = useRef(0);

  // --------------------------------------------------------------------- derived
  const otherUserId = (conversation as any)?.participantId as
    | string
    | undefined;
  const otherUserName =
    ((conversation as any)?.participantName as string | undefined) ??
    'Anonymous';
  const otherPhotoUrl = (conversation as any)?.participantPhotoUrl as
    | string
    | undefined;

  const tdState = ((gameSession as any)?.state as GameState | undefined) ??
    undefined;
  const inviterId = (gameSession as any)?.inviterId as string | undefined;
  const inviteeId = (gameSession as any)?.inviteeId as string | undefined;
  const amInviter = !!inviterId && inviterId === userId;
  const amInvitee = !!inviteeId && inviteeId === userId;
  // P2_TD_PARITY: gameStartedAt distinguishes "accepted but inviter hasn't
  // started yet" from "game running" (Phase-1 ChatScreenInner.tsx:1197).
  const gameStartedAt = (gameSession as any)?.gameStartedAt as
    | number
    | undefined;

  const currentUserName = useMemo(() => {
    const u = currentUser as any;
    return (u?.name as string) || (u?.handle as string) || 'You';
  }, [currentUser]);

  // --------------------------------------------------------------------- logs
  useEffect(() => {
    console.log('[P2_THREAD_OPEN]', { id, userId });
  }, [id, userId]);

  useEffect(() => {
    if (gameSession === undefined) {
      console.log('[P2_TD_STATE] loading', { id });
    } else {
      console.log('[P2_TD_STATE]', {
        id,
        state: tdState,
        amInviter,
        amInvitee,
      });
    }
  }, [id, gameSession, tdState, amInviter, amInvitee]);

  // --------------------------------------------------------------------- side effects
  // Mark conversation as read whenever a new message arrives or thread mounts.
  useEffect(() => {
    if (!id || !token) return;
    markRead({ conversationId: id as any, token }).catch(() => {});
  }, [id, token, markRead, messages?.length]);

  // Auto-open game modal when game becomes active AND has actually started
  // (i.e. inviter pressed start). Phase-1 parity: ChatScreenInner doesn't
  // auto-open at all; Phase-2 keeps auto-open for the invitee's UX, but it
  // must not fire while the inviter has not yet manually started the game,
  // otherwise both sides see an empty BottleSpinGame stuck in pre-start.
  useEffect(() => {
    if (!gameSession) return;
    if (tdState === 'active' && gameStartedAt && !tdPaused) {
      setShowGameModal(true);
    }
    if (tdState !== 'active' && showGameModal) {
      setShowGameModal(false);
    }
    // Reset pause flag once the session leaves active so the next active
    // session can auto-open again.
    if (tdState !== 'active' && tdPaused) {
      setTdPaused(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tdState, tdPaused, gameStartedAt]);

  // P2_TD_FIX: Auto-cleanup expired sessions so the next invite doesn't hit
  // "Game already active". Phase-1 parity: ChatScreenInner.tsx:885-928. The
  // backend may return state='expired' while the DB row is still status='active'
  // (e.g. accepted-but-not-started timeout or in-game inactivity timeout).
  // Without this, tapping T/D after an active timeout would show the invite
  // modal, then sendBottleSpinInvite would throw because DB status is still
  // 'active'.
  const endedReason = (gameSession as any)?.endedReason as
    | 'invite_expired'
    | 'not_started'
    | 'timeout'
    | undefined;
  useEffect(() => {
    if (!id || !userId) return;
    if (tdState !== 'expired' || !endedReason) return;
    console.log('[P2_TD_CLEANUP]', { id, endedReason });
    cleanupExpired({
      authUserId: userId,
      conversationId: id,
      endedReason,
    }).catch((err) =>
      console.warn('[P2_TD_CLEANUP] failed:', err?.message ?? err)
    );
  }, [id, userId, tdState, endedReason, cleanupExpired]);

  // Cleanup cooldown timer on unmount.
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, []);

  // P2_TD_PARITY: 1-second tick while in cooldown so the live countdown
  // re-renders. Phase-1 ChatScreenInner.tsx:1636-1641. Stops ticking when
  // not in cooldown.
  useEffect(() => {
    if (tdState !== 'cooldown') return;
    const intervalId = setInterval(
      () => setCooldownTick((t) => t + 1),
      1000
    );
    return () => clearInterval(intervalId);
  }, [tdState]);

  // P2_TD_PARITY: Reset cooldown anchor when the session leaves cooldown
  // (Phase-1 ChatScreenInner.tsx:857,1159) so a stale anchor from a previous
  // game cannot leak into the next render.
  useEffect(() => {
    if (tdState !== 'cooldown') {
      cooldownAnchorRef.current = null;
    }
  }, [tdState]);

  // BOTTOM-ANCHOR-FIX: Reset initial-scroll tracking when conversation changes.
  useEffect(() => {
    hasInitiallyScrolledRef.current = false;
    contentHeightRef.current = 0;
  }, [id]);

  // BOTTOM-ANCHOR-FIX: scroll-to-end helper (Phase-1 parity, simplified).
  const scrollToBottom = useCallback((animated = true) => {
    const doScroll = () => listRef.current?.scrollToEnd({ animated });
    if (Platform.OS === 'android') {
      // Android needs a short tick after layout to land cleanly.
      setTimeout(doScroll, 60);
    } else {
      requestAnimationFrame(doScroll);
    }
  }, []);

  // BOTTOM-ANCHOR-FIX: scroll on initial content render, and on growth.
  const handleContentSizeChange = useCallback(
    (_w: number, h: number) => {
      const prevHeight = contentHeightRef.current;
      contentHeightRef.current = h;
      const count = messages?.length ?? 0;
      if (!hasInitiallyScrolledRef.current && h > 0 && count > 0) {
        hasInitiallyScrolledRef.current = true;
        scrollToBottom(false);
        return;
      }
      if (hasInitiallyScrolledRef.current && h > prevHeight) {
        scrollToBottom(true);
      }
    },
    [messages?.length, scrollToBottom]
  );

  // --------------------------------------------------------------------- handlers
  const showCooldownFor3s = useCallback(() => {
    setShowCooldownToast(true);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      setShowCooldownToast(false);
      cooldownTimerRef.current = null;
    }, 3000);
  }, []);

  // P2_TD_PARITY: send a `[SYSTEM:truthdare]` marker message via Phase-2
  // private-message backend. Type is 'text' (not 'system') because Phase-1
  // also uses 'text' + the marker so MessageBubble's existing system-message
  // detector fires identically (ChatScreenInner.tsx:1276-1282).
  const sendSystemMessage = useCallback(
    async (content: string) => {
      if (!id || !token) return;
      try {
        await sendPrivateMessage({
          token,
          conversationId: id as any,
          type: 'text',
          content: `[SYSTEM:truthdare]${content}`,
          clientMessageId: `td_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        });
      } catch (err) {
        // Non-fatal — system message failure must NEVER block the game flow.
        console.warn('[P2_TD_SYSTEM_MSG] failed:', err);
      }
    },
    [id, token, sendPrivateMessage]
  );

  const handleTruthDarePress = useCallback(async () => {
    console.log('[P2_TD_PRESS]', {
      id,
      state: tdState,
      amInviter,
      amInvitee,
      gameStartedAt,
      userId,
    });

    if (!userId || !id) {
      console.log('[P2_TD] missing user or id', { currentUserId: userId, id });
      return;
    }

    // P2_TD_PARITY: Phase-1 ChatScreenInner.tsx:1147-1152 — when the session
    // query is still loading, treat as "no session" and open the invite modal
    // silently. The backend mutation enforces the real cooldown / active /
    // pending rules, so this is safe.
    if (gameSession === undefined) {
      console.log('[P2_TD] session loading → open invite modal');
      setTdPaused(false);
      setShowInviteModal(true);
      return;
    }

    // P2_TD_PARITY: Active game branch (Phase-1 ChatScreenInner.tsx:1194-1231).
    if (tdState === 'active') {
      // Inviter manually starts the game once the invitee accepts. Until
      // gameStartedAt is set, BottleSpinGame's turn engine is in pre-start
      // and shouldn't be opened.
      if (!gameStartedAt) {
        if (amInviter) {
          console.log('[P2_TD_MANUAL_START]', { id });
          try {
            await startGame({
              authUserId: userId,
              conversationId: id,
            });
            // Fire-and-forget system message; do NOT block opening the modal
            // on its success.
            void sendSystemMessage('Game started!');
            setTdPaused(false);
            setShowGameModal(true);
          } catch (err) {
            console.warn('[P2_TD_MANUAL_START] failed:', err);
            Alert.alert(
              'Could not start game',
              String((err as any)?.message ?? err)
            );
          }
        } else {
          // Invitee: accepted but inviter hasn't pressed start yet — no-op.
          console.log('[P2_TD] invitee waiting for inviter to start', { id });
        }
        return;
      }
      // Game is started — open the modal normally.
      console.log('[P2_TD_ACTIVE_OPEN]', { id });
      setTdPaused(false);
      setShowGameModal(true);
      return;
    }

    if (tdState === 'pending') {
      if (amInvitee) {
        // Invitee taps T/D → show accept/decline card.
        setShowInviteModal(true);
      } else {
        Alert.alert('Invite sent', `Waiting for ${otherUserName} to respond.`);
      }
      return;
    }

    if (tdState === 'cooldown') {
      // P2_TD_PARITY: Capture absolute cooldown expiry at press time so the
      // live countdown stays accurate between query refreshes. Phase-1
      // ChatScreenInner.tsx:1162-1168.
      const gs: any = gameSession;
      const cooldownUntil =
        typeof gs?.cooldownUntil === 'number' && gs.cooldownUntil > 0
          ? gs.cooldownUntil
          : typeof gs?.remainingMs === 'number' && gs.remainingMs > 0
            ? Date.now() + gs.remainingMs
            : null;
      if (cooldownUntil) {
        cooldownAnchorRef.current = cooldownUntil;
      }
      showCooldownFor3s();
      return;
    }

    // P2_TD_PARITY: 'expired' is handled by the cleanup useEffect (which
    // patches the row to status='expired' so the query transitions to
    // 'cooldown' or 'none'). Phase-1 ChatScreenInner.tsx:1189-1191 simply
    // returns; we mirror that — no Alert, the user can tap again once the
    // session refreshes.
    if (tdState === 'expired') {
      console.log('[P2_TD_EXPIRED] awaiting cleanup', { id, endedReason });
      return;
    }

    // No session — open invite/cancel modal.
    if (!gameSession || tdState === 'none') {
      console.log('[P2_TD] opening invite modal');
      setTdPaused(false);
      setShowInviteModal(true);
      return;
    }
  }, [
    id,
    tdState,
    endedReason,
    amInviter,
    amInvitee,
    gameStartedAt,
    userId,
    gameSession,
    otherUserName,
    showCooldownFor3s,
    startGame,
    sendSystemMessage,
  ]);

  const handleSendInvite = useCallback(async () => {
    if (!userId || !id || !otherUserId) {
      Alert.alert('Not ready', 'Cannot send invite right now.');
      return;
    }
    // P2_TD_FIX: Defensive guard — never call sendBottleSpinInvite when the
    // session is active or pending. The button-press handler already routes
    // those states elsewhere, but this protects against stale modal opens
    // (e.g. user opened modal in 'none' state, then session became 'active').
    if (tdState === 'active') {
      console.log('[P2_TD_ACTIVE_OPEN] redirecting send→game', { id });
      setShowInviteModal(false);
      setTdPaused(false);
      setShowGameModal(true);
      return;
    }
    if (tdState === 'pending') {
      setShowInviteModal(false);
      return;
    }
    try {
      await sendInvite({
        authUserId: userId,
        conversationId: id,
        otherUserId,
      });
      console.log('[P2_TD_PRESS] invite sent');
      setShowInviteModal(false);
      // P2_TD_PARITY: announce the invite in the thread (Phase-1
      // ChatScreenInner.tsx:1276-1282). Fire-and-forget so a system-message
      // failure cannot block the invite UX.
      void sendSystemMessage(
        `${currentUserName} wants to play Truth or Dare!`
      );
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      console.warn('[P2_TD_PRESS] invite failed:', msg);
      // P2_TD_FIX: Backend race — by the time we call sendBottleSpinInvite,
      // a different active session may exist (e.g. invitee accepted just now,
      // or stale active row not yet cleaned up). Open the live game modal
      // instead of crashing the UI.
      if (msg.includes('Game already active')) {
        console.log('[P2_TD_ACTIVE_OPEN] recovered from invite error', { id });
        setShowInviteModal(false);
        setTdPaused(false);
        setShowGameModal(true);
        return;
      }
      if (msg.includes('Cooldown active')) {
        setShowInviteModal(false);
        showCooldownFor3s();
        return;
      }
      if (msg.includes('Invite already pending')) {
        setShowInviteModal(false);
        Alert.alert(
          'Invite pending',
          `Waiting for ${otherUserName} to respond.`
        );
        return;
      }
      Alert.alert('Could not send invite', msg);
    }
  }, [
    userId,
    id,
    otherUserId,
    tdState,
    otherUserName,
    sendInvite,
    showCooldownFor3s,
    currentUserName,
    sendSystemMessage,
  ]);

  const handleAcceptInvite = useCallback(async () => {
    if (!userId || !id) return;
    try {
      await respondInvite({
        authUserId: userId,
        conversationId: id,
        accept: true,
      });
      setShowInviteModal(false);
      // P2_TD_PARITY: Phase-1 ChatScreenInner.tsx:1300-1311 emits an accept
      // system message immediately after the mutation. Fire-and-forget.
      void sendSystemMessage(
        `${currentUserName} is ready to play! Game starting...`
      );
    } catch (err: any) {
      Alert.alert('Could not accept', String(err?.message ?? err));
    }
  }, [userId, id, respondInvite, sendSystemMessage, currentUserName]);

  const handleDeclineInvite = useCallback(async () => {
    if (!userId || !id) return;
    try {
      await respondInvite({
        authUserId: userId,
        conversationId: id,
        accept: false,
      });
      setShowInviteModal(false);
      // P2_TD_PARITY: Phase-1 ChatScreenInner.tsx:1304 — decline announcement.
      void sendSystemMessage(
        `${currentUserName} declined the game invite`
      );
    } catch (err: any) {
      Alert.alert('Could not decline', String(err?.message ?? err));
    }
  }, [userId, id, respondInvite, sendSystemMessage, currentUserName]);

  const handleSendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !id || !token) return;
      try {
        await sendPrivateMessage({
          token,
          conversationId: id as any,
          type: 'text',
          content: trimmed,
          clientMessageId: `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        });
      } catch (err: any) {
        Alert.alert('Send failed', String(err?.message ?? err));
      }
    },
    [id, token, sendPrivateMessage]
  );

  // P2_TD_PARITY: BottleSpinGame emits result strings (e.g. "Truth: <q>",
  // "${name} ended the game"). Phase-1 wraps every such string with the
  // `[SYSTEM:truthdare]` marker and uses type='text' so MessageBubble's
  // existing system-message detector renders them as system rows
  // (ChatScreenInner.tsx:1359-1402). It also intercepts "ended the game"
  // to call endBottleSpinGame, which kicks the session into cooldown.
  const handleSendResultMessage = useCallback(
    async (msg: string) => {
      if (!id || !token || !userId) return;

      // P2_TD_PARITY: detect explicit End Game message via the same regex
      // Phase-1 uses (ChatScreenInner.tsx:1368) and trigger the backend
      // mutation. Fire-and-forget — the UI closes regardless.
      const isEndGameSystemMessage = /^[^\s].* ended the game$/.test(msg);
      if (isEndGameSystemMessage) {
        console.log('[P2_TD_END]', { id, msg });
        endGame({
          authUserId: userId,
          conversationId: id,
        }).catch((err) =>
          console.warn('[P2_TD_END] failed:', (err as any)?.message ?? err)
        );
      }

      try {
        await sendPrivateMessage({
          token,
          conversationId: id as any,
          type: 'text',
          content: `[SYSTEM:truthdare]${msg}`,
          clientMessageId: `td_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        });
      } catch {
        // Non-fatal — system message failure shouldn't block the game.
      }
    },
    [id, token, userId, sendPrivateMessage, endGame]
  );

  // --------------------------------------------------------------------- attach handlers
  // PLUS-MENU REAL IMPL (Phase-2 parity with Phase-1 ChatScreenInner):
  //   * Camera  → ImagePicker.launchCameraAsync (image OR video, 30s cap)
  //   * Gallery → ImagePicker.launchImageLibraryAsync (image OR video, 30s cap)
  //   * Voice   → upload audio blob + sendPrivateMessage type='voice'
  //
  // All uploads use api.privateConversations.generateSecureMediaUploadUrl,
  // and all sends go through api.privateConversations.sendPrivateMessage.
  // Image/video sends go out as `isProtected: true` because getPrivateMessages
  // only resolves imageUrl for protected media (see convex/privateConversations.ts).
  const uploadMediaBlob = useCallback(
    async (uri: string, contentTypeFallback: string): Promise<string | null> => {
      if (!token) return null;
      const uploadUrl = await generateMediaUploadUrl({ token });
      const fileResp = await fetch(uri);
      const blob = await fileResp.blob();
      const postResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || contentTypeFallback },
        body: blob,
      });
      const json = (await postResp.json()) as { storageId?: string };
      return json.storageId ?? null;
    },
    [token, generateMediaUploadUrl]
  );

  const handleSendVoiceMessage = useCallback(
    async (audioUri: string, durationMs: number) => {
      if (!id || !token) return;
      try {
        const storageId = await uploadMediaBlob(audioUri, 'audio/m4a');
        if (!storageId) {
          Alert.alert('Upload failed', 'Could not upload voice message.');
          return;
        }
        await sendPrivateMessage({
          token,
          conversationId: id as any,
          type: 'voice',
          content: 'Voice message',
          audioStorageId: storageId as any,
          audioDurationMs: durationMs,
          clientMessageId: `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        });
      } catch (err: any) {
        Alert.alert('Send failed', String(err?.message ?? err));
      }
    },
    [id, token, uploadMediaBlob, sendPrivateMessage]
  );

  // Stage an asset into the review sheet (Phase-1 setPendingImageUri parity).
  const stageAsset = useCallback(
    (asset: ImagePicker.ImagePickerAsset, fromCamera: boolean) => {
      const isVideo = asset.type === 'video';
      if (isVideo && asset.duration && asset.duration > 30000) {
        Alert.alert(
          'Video too long',
          'Please select a video 30 seconds or shorter.'
        );
        return;
      }
      // Phase-1 only mirrors VIDEOs captured with the front camera. Gallery
      // picks are never mirrored. We don't currently distinguish front/back
      // here (ImagePicker.launchCameraAsync uses the OS camera UI), so we
      // default isMirrored to false for both. This matches Phase-1 gallery
      // behavior and is a safe default for camera until we add a custom
      // camera-composer route in a follow-up.
      setPendingIsMirrored(false);
      void fromCamera;
      setPendingMediaUri(asset.uri);
      setPendingMediaType(isVideo ? 'video' : 'photo');
    },
    []
  );

  const clearPendingMedia = useCallback(() => {
    setPendingMediaUri(null);
    setPendingMediaType('photo');
    setPendingIsMirrored(false);
  }, []);

  // Confirm callback from <Phase2CameraPhotoSheet>: upload + send with the
  // user-chosen timer mapping. Phase-1 timer values:
  //   -1 = Normal, 0 = View once, 30 = 30s, 60 = 60s
  //
  // Phase-2 backend mapping (no schema change):
  //   Normal     -> isProtected: false, no timer fields
  //                 (getPrivateMessages now resolves imageUrl for these)
  //   View once  -> isProtected: true,  protectedMediaTimer: 0
  //                 (markPrivateSecureMediaViewed sets timerEndsAt = now,
  //                  recipient gets one open before viewer marks expired)
  //   30s / 60s  -> isProtected: true,  protectedMediaTimer: 30 | 60
  //                 (timerEndsAt = now + timer*1000 on first view)
  const handleConfirmSecureSend = useCallback(
    async (uri: string, options: Phase2CameraPhotoOptions) => {
      if (!id || !token) {
        clearPendingMedia();
        return;
      }
      const isVideo = pendingMediaType === 'video';
      const isMirrored = pendingIsMirrored;
      const timer = options.timer; // -1 | 0 | 30 | 60
      const isNormal = timer < 0;

      clearPendingMedia();

      try {
        const storageId = await uploadMediaBlob(
          uri,
          isVideo ? 'video/mp4' : 'image/jpeg'
        );
        if (!storageId) {
          Alert.alert('Upload failed', 'Could not upload media.');
          return;
        }

        const clientMessageId = `${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;

        if (isNormal) {
          // Normal: not protected, no timer. MessageBubble renders via
          // <MediaMessage /> using the imageUrl resolved by getPrivateMessages.
          await sendPrivateMessage({
            token,
            conversationId: id as any,
            type: isVideo ? 'video' : 'image',
            content: isVideo ? 'Video' : 'Photo',
            imageStorageId: storageId as any,
            clientMessageId,
          });
        } else {
          // Once / 30s / 60s: protected pipeline.
          await sendPrivateMessage({
            token,
            conversationId: id as any,
            type: isVideo ? 'video' : 'image',
            content: isVideo ? 'Secure Video' : 'Secure Photo',
            imageStorageId: storageId as any,
            isProtected: true,
            protectedMediaTimer: timer,
            protectedMediaViewingMode: options.viewingMode,
            // Mirror only for front-camera captured videos (Phase-1 rule).
            protectedMediaIsMirrored: isVideo && isMirrored,
            clientMessageId,
          });
        }
      } catch (err: any) {
        Alert.alert('Send failed', String(err?.message ?? err));
      }
    },
    [
      id,
      token,
      pendingMediaType,
      pendingIsMirrored,
      uploadMediaBlob,
      sendPrivateMessage,
      clearPendingMedia,
    ]
  );

  // CAMERA-VIDEO-FIX: Phase-2 camera now uses the same custom camera-composer
  // route that Phase-1 Messages uses, so users get a real PHOTO/VIDEO toggle
  // (vision-camera) and the 30s secure-video cap (MAX_VIDEO_SEC_SECURE) is
  // hard-enforced. Captured asset comes back via the in-memory handoff store
  // (key: `secure_capture_media_${id}`) and is picked up below by
  // `useFocusEffect` → staged into the existing Phase2CameraPhotoSheet for
  // Normal / Once / 30s / 60s selection. ImagePicker.launchCameraAsync was
  // replaced because it surfaces the OS camera UI, which is photo-only on
  // many Android devices and doesn't enforce the 30s rule.
  const handleSendCameraPress = useCallback(() => {
    if (!id || !token) return;
    router.push({
      pathname: '/(main)/camera-composer',
      params: {
        mode: 'secure_capture',
        conversationId: String(id),
      },
    } as any);
  }, [id, token, router]);

  // CAMERA-VIDEO-FIX: Pick up captured media when this thread regains focus
  // after camera-composer calls `router.back()`. The composer writes to
  // `secure_capture_media_${conversationId}` via setHandoff. We pop it (so it
  // can't be picked up twice) and feed it into the existing pendingMedia*
  // state, which mounts <Phase2CameraPhotoSheet> for the timer choice.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const captured = popHandoff<{
        uri?: string;
        type?: 'photo' | 'video';
        mediaUri?: string;
        durationSec?: number;
        isMirrored?: boolean;
      }>(`secure_capture_media_${id}`);
      if (!captured) return;
      const uri = captured.uri ?? captured.mediaUri;
      if (!uri) return;
      const type: 'photo' | 'video' =
        captured.type === 'video' ? 'video' : 'photo';
      // Defense-in-depth: composer already enforces 30s, but if anything
      // upstream returned a longer clip we reject it here too.
      if (
        type === 'video' &&
        typeof captured.durationSec === 'number' &&
        captured.durationSec > 30
      ) {
        Alert.alert(
          'Video too long',
          'Please capture a video 30 seconds or shorter.'
        );
        return;
      }
      setPendingIsMirrored(!!captured.isMirrored);
      setPendingMediaUri(uri);
      setPendingMediaType(type);
    }, [id])
  );

  const handleSendGalleryPress = useCallback(async () => {
    if (!id || !token) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert(
        'Photo access needed',
        'Allow photo access in Settings to choose photos and videos for Deep Connect.'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      allowsEditing: false,
      videoMaxDuration: 30,
    });
    if (!result.canceled && result.assets[0]) {
      stageAsset(result.assets[0], false);
    }
  }, [id, token, stageAsset]);

  // --------------------------------------------------------------------- safety handlers
  const handleBlock = useCallback(() => {
    setShowMenu(false);
    if (!userId || !otherUserId) return;
    Alert.alert(
      'Block this person?',
      `${otherUserName} will no longer be able to contact you. This conversation will be hidden.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser({
                authUserId: userId,
                blockedUserId: otherUserId as any,
              });
              if (token && id) {
                try {
                  await leaveConversation({
                    token,
                    conversationId: id as any,
                  });
                } catch {
                  // best-effort hide
                }
              }
              router.replace('/(main)/(private)/(tabs)/chats' as any);
            } catch (err: any) {
              Alert.alert('Could not block', String(err?.message ?? err));
            }
          },
        },
      ]
    );
  }, [
    userId,
    otherUserId,
    otherUserName,
    blockUser,
    leaveConversation,
    token,
    id,
    router,
  ]);

  const handleLeave = useCallback(() => {
    setShowMenu(false);
    if (!token || !id) return;
    Alert.alert(
      'End connection?',
      `This will hide your conversation with ${otherUserName}. They won't be notified.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveConversation({
                token,
                conversationId: id as any,
              });
              router.replace('/(main)/(private)/(tabs)/chats' as any);
            } catch (err: any) {
              Alert.alert('Could not end connection', String(err?.message ?? err));
            }
          },
        },
      ]
    );
  }, [token, id, otherUserName, leaveConversation, router]);

  const handleReportReason = useCallback(
    async (
      reason:
        | 'fake_profile'
        | 'inappropriate_photos'
        | 'harassment'
        | 'spam'
        | 'underage'
        | 'other'
    ) => {
      setShowReportSheet(false);
      if (!userId || !otherUserId) return;
      try {
        await reportUser({
          authUserId: userId,
          reportedUserId: otherUserId as any,
          reason,
        });
        Alert.alert(
          'Report submitted',
          'Thanks — our team will review this report.'
        );
      } catch (err: any) {
        Alert.alert('Could not submit report', String(err?.message ?? err));
      }
    },
    [userId, otherUserId, reportUser]
  );

  // --------------------------------------------------------------------- render helpers
  const messageList = (messages ?? []) as any[];

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const isOwn = item.senderId === userId;
      // AVATAR GROUPING: last in group when next message has different sender
      // or this is the most recent message in the list.
      const next = messageList[index + 1];
      const isLastInGroup = !next || next.senderId !== item.senderId;

      // PHASE-2 PARITY: every message type is now rendered through the
      // shared Phase-1 MessageBubble so avatar gutter, grouping spacing,
      // bubble frame, timestamp/tick footer, and media sizing match Phase-1
      // exactly. The only Phase-2-specific divergence is the protected-media
      // inner card, which is supplied via the additive `renderProtectedMedia`
      // slot so the Phase-2 backend (api.privateConversations.*) stays the
      // sole data source — Phase-1's ProtectedMediaBubble (api.media.* /
      // api.protectedMedia.*) is NEVER touched on this screen.
      const isProtectedMedia =
        !!item.isProtected &&
        (item.type === 'image' || item.type === 'video');

      return (
        <MessageBubble
          message={{
            id: String(item.id),
            senderId: item.senderId,
            type: item.type,
            content: item.content ?? '',
            createdAt: item.createdAt,
            deliveredAt: item.deliveredAt,
            readAt: item.readAt,
            imageUrl: item.imageUrl,
            audioUrl: item.audioUrl,
            audioDurationMs: item.audioDurationMs,
            isProtected: item.isProtected,
            isExpired: item.isExpired,
            timerEndsAt: item.timerEndsAt,
            expiredAt: item.expiredAt,
            viewedAt: item.viewedAt,
          }}
          isOwn={isOwn}
          otherUserName={otherUserName}
          currentUserId={userId ?? undefined}
          currentUserToken={token ?? undefined}
          // NORMAL-MEDIA OPEN: tap normal photo/video → fullscreen lightbox.
          // Phase-2 backend resolved imageUrl in getPrivateMessages, so
          // MessageBubble renders it via <MediaMessage/>; we just provide
          // the open-fullscreen handler.
          onMediaPress={(url, mediaType) =>
            setNormalViewer({ uri: url, type: mediaType })
          }
          showAvatar={!isOwn && isLastInGroup}
          avatarUrl={otherPhotoUrl}
          isLastInGroup={isLastInGroup}
          // PHASE-2 SECURE MEDIA: substitute Phase2ProtectedMediaBubble into
          // MessageBubble's protected-media slot. Layout (avatar gutter,
          // grouped spacing, bubble frame, timestamp/tick footer) is owned
          // by MessageBubble; the inner card and the open/viewer flow stay
          // Phase-2-only.
          renderProtectedMedia={
            isProtectedMedia
              ? () => (
                  <Phase2ProtectedMediaBubble
                    isOwn={isOwn}
                    isProtected
                    isExpired={!!item.isExpired}
                    viewedAt={item.viewedAt}
                    timerEndsAt={item.timerEndsAt}
                    protectedMediaTimer={item.protectedMediaTimer}
                    protectedMediaViewingMode={item.protectedMediaViewingMode}
                    onOpen={() =>
                      setProtectedViewer({
                        raw: item,
                        isSender: isOwn,
                      })
                    }
                  />
                )
              : undefined
          }
        />
      );
    },
    [userId, token, otherUserName, otherPhotoUrl, messageList]
  );

  // --------------------------------------------------------------------- early-return: bad id
  if (!id) {
    return (
      <View style={[styles.errorContainer, { paddingTop: insets.top }]}>
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={44}
          color={C.textLight}
        />
        <Text style={styles.errorTitle}>
          This conversation can’t be opened.
        </Text>
        <TouchableOpacity
          style={styles.errorBtn}
          onPress={() =>
            router.replace('/(main)/(private)/(tabs)/chats' as any)
          }
        >
          <Text style={styles.errorBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --------------------------------------------------------------------- T/D button
  // P2_TD_PARITY: Phase-1 button label (ChatScreenInner.tsx:2778-2782) is
  // strictly one of: 'Sent' | 'Start!' | 'T/D'. Phase-1 NEVER renders
  // cooldown text on the button — the cooldown info appears in a floating
  // toast triggered by tapping T/D during cooldown. Removing the previous
  // 'Cool' / 'Play' / invitee-'Start!' branches restores parity.
  const tdButtonDisabled = !userId || !id;
  const tdLabel =
    tdState === 'pending' && amInviter
      ? 'Sent'
      : tdState === 'active' && !gameStartedAt && amInviter
        ? 'Start!'
        : 'T/D';
  // P2_TD_PARITY: Badge dots match Phase-1 (ChatScreenInner.tsx:2785-2791):
  //   * pending + invitee  → small notification dot (incoming invite)
  //   * active + !started + inviter → start-game badge
  const tdShowDot =
    (tdState === 'pending' && amInvitee) ||
    (tdState === 'active' && !gameStartedAt && amInviter);

  // P2_TD_PARITY: Live cooldown countdown text — Phase-1 ChatScreenInner.tsx:
  // 2606-2625. Source-of-truth order:
  //   1) gameSession.cooldownUntil (absolute timestamp from server)
  //   2) cooldownAnchorRef (captured at press-time from remainingMs)
  //   3) Date.now() + remainingMs (fallback)
  // cooldownTick (1s interval) drives the re-render. Returns null while not
  // in cooldown so the toast falls back to a static message.
  const cooldownLiveText = (() => {
    if (tdState !== 'cooldown') return null;
    const gs: any = gameSession;
    let expiry: number | null = null;
    if (typeof gs?.cooldownUntil === 'number' && gs.cooldownUntil > 0) {
      expiry = gs.cooldownUntil;
    } else if (
      cooldownAnchorRef.current &&
      cooldownAnchorRef.current > Date.now()
    ) {
      expiry = cooldownAnchorRef.current;
    } else if (typeof gs?.remainingMs === 'number' && gs.remainingMs > 0) {
      expiry = Date.now() + gs.remainingMs;
    }
    if (!expiry) return null;
    const remaining = Math.max(0, expiry - Date.now());
    if (remaining <= 0) return null;
    const totalSec = Math.floor(remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  })();
  // Reference cooldownTick so React re-evaluates each second while cooldown
  // is active (Phase-1 ChatScreenInner.tsx:2627).
  void cooldownTick;

  // --------------------------------------------------------------------- main
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={26} color={C.text} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <View style={styles.headerAvatarWrap}>
            {otherPhotoUrl ? (
              <Image
                source={{ uri: otherPhotoUrl }}
                style={styles.headerAvatar}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
                <Ionicons name="person" size={20} color={C.textLight} />
              </View>
            )}
          </View>
          <View style={styles.headerNameWrap}>
            <Text style={styles.headerName} numberOfLines={1}>
              {otherUserName}
            </Text>
            {tdState === 'active' && (
              <Text style={styles.headerStatus} numberOfLines={1}>
                Truth or Dare in progress
              </Text>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.tdPill,
            tdButtonDisabled && styles.tdPillDisabled,
          ]}
          onPress={handleTruthDarePress}
          disabled={tdButtonDisabled}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Ionicons
            name={tdState === 'active' ? 'wine' : 'wine-outline'}
            size={14}
            color={COLORS.white}
            style={{ marginRight: 4 }}
          />
          <Text style={styles.tdPillText}>{tdLabel}</Text>
          {tdShowDot && <View style={styles.tdPillDot} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => setShowMenu(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Inviter waiting strip */}
      {tdState === 'pending' && amInviter && (
        <View style={styles.waitingBar}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={styles.waitingText}>
            Truth or Dare invite sent — waiting for {otherUserName}
          </Text>
        </View>
      )}

      {/* P2_TD_PARITY: Cooldown toast text mirrors Phase-1 ChatScreenInner.tsx:
          3068-3072. When `cooldownLiveText` is available we show "Cooldown
          ends in 29m 45s" (live, ticks every second). Falls back to a static
          message if no expiry timestamp can be resolved. */}
      {showCooldownToast && (
        <View
          style={[styles.cooldownToast, { top: insets.top + 64 }]}
          pointerEvents="none"
        >
          <Ionicons name="time-outline" size={16} color={COLORS.white} />
          <Text style={styles.cooldownText}>
            {cooldownLiveText
              ? `Cooldown ends in ${cooldownLiveText}`
              : 'Cooldown active — try again shortly'}
          </Text>
        </View>
      )}

      {/* Body: messages + composer
          KEYBOARD-FIX (Phase-1 parity): behavior=padding/height with offset=0.
          AndroidManifest already sets windowSoftInputMode="adjustResize", and
          'height' behavior cooperates with that (same as Phase-1). 'undefined'
          on Android caused the composer to slip under the keyboard. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.listWrap}>
          {messages === undefined ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
          ) : (messages?.length ?? 0) === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons
                name="chatbubbles-outline"
                size={42}
                color={C.textLight}
              />
              <Text style={styles.emptyText}>
                Say hi to {otherUserName} to get started
              </Text>
            </View>
          ) : (
            <FlashList
              ref={listRef}
              data={messages ?? []}
              keyExtractor={(item: any) => String(item.id)}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              onContentSizeChange={handleContentSizeChange}
            />
          )}
        </View>

        <MessageInput
          onSend={handleSendText}
          onSendCamera={handleSendCameraPress}
          onSendGallery={handleSendGalleryPress}
          onSendVoice={handleSendVoiceMessage}
        />
      </KeyboardAvoidingView>

      {/* Invite modal — Send/Cancel for inviter, Accept/Decline for invitee */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalBackdrop}>
          {tdState === 'pending' && amInvitee ? (
            <View style={styles.inviteCardWrap}>
              <TruthDareInviteCard
                inviterName={otherUserName}
                isInvitee
                onAccept={handleAcceptInvite}
                onReject={handleDeclineInvite}
              />
              <TouchableOpacity
                style={styles.modalDismiss}
                onPress={() => setShowInviteModal(false)}
              >
                <Text style={styles.modalDismissText}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.inviteCard}>
              <View style={styles.inviteIconCircle}>
                <Ionicons name="wine" size={28} color={COLORS.white} />
              </View>
              <Text style={styles.inviteTitle}>Truth or Dare?</Text>
              <Text style={styles.inviteSubtitle}>
                Invite {otherUserName} to play. They’ll need to accept before
                the game starts.
              </Text>
              <View style={styles.inviteRow}>
                <TouchableOpacity
                  style={[styles.inviteBtn, styles.inviteCancel]}
                  onPress={() => setShowInviteModal(false)}
                >
                  <Text style={styles.inviteCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inviteBtn, styles.inviteSend]}
                  onPress={handleSendInvite}
                >
                  <Text style={styles.inviteSendText}>Send invite</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* 3-dot menu — Block / Report / End connection */}
      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View
            style={[styles.menuSheet, { paddingBottom: insets.bottom + 12 }]}
          >
            <View style={styles.menuHandle} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                setTimeout(() => setShowReportSheet(true), 200);
              }}
            >
              <Ionicons name="flag-outline" size={20} color={C.text} />
              <Text style={styles.menuItemText}>Report</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleBlock}
            >
              <Ionicons
                name="ban-outline"
                size={20}
                color={C.primary}
              />
              <Text style={[styles.menuItemText, { color: C.primary }]}>
                Block {otherUserName}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleLeave}
            >
              <Ionicons
                name="close-circle-outline"
                size={20}
                color={C.primary}
              />
              <Text style={[styles.menuItemText, { color: C.primary }]}>
                End connection
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.menuCancel]}
              onPress={() => setShowMenu(false)}
            >
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report reason sheet */}
      <Modal
        visible={showReportSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowReportSheet(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setShowReportSheet(false)}
        >
          <View
            style={[styles.menuSheet, { paddingBottom: insets.bottom + 12 }]}
          >
            <View style={styles.menuHandle} />
            <Text style={styles.reportTitle}>Why are you reporting?</Text>
            {([
              ['fake_profile', 'Fake profile'],
              ['inappropriate_photos', 'Inappropriate photos'],
              ['harassment', 'Harassment'],
              ['spam', 'Spam'],
              ['underage', 'Underage'],
              ['other', 'Other'],
            ] as const).map(([reason, label]) => (
              <TouchableOpacity
                key={reason}
                style={styles.menuItem}
                onPress={() => handleReportReason(reason)}
              >
                <Text style={styles.menuItemText}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.menuItem, styles.menuCancel]}
              onPress={() => setShowReportSheet(false)}
            >
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Secure media review sheet (Normal / Once / 30s / 60s) */}
      <Phase2CameraPhotoSheet
        visible={!!pendingMediaUri}
        imageUri={pendingMediaUri}
        mediaType={pendingMediaType}
        onConfirm={handleConfirmSecureSend}
        onCancel={clearPendingMedia}
      />

      {/* PROTECTED-MEDIA VIEWER:
          For Phase-2 secure media (View once / 30s / 60s). Uses
          api.privateConversations.markPrivateSecureMediaViewed and
          markPrivateSecureMediaExpired internally — Phase-2 isolated. */}
      {protectedViewer && id && (
        <Phase2ProtectedMediaViewer
          visible={!!protectedViewer}
          conversationId={String(id)}
          messageId={String(protectedViewer.raw.id)}
          isSenderViewing={protectedViewer.isSender}
          messageData={{
            id: String(protectedViewer.raw.id),
            isProtected: !!protectedViewer.raw.isProtected,
            isExpired: !!protectedViewer.raw.isExpired,
            viewedAt: protectedViewer.raw.viewedAt,
            timerEndsAt: protectedViewer.raw.timerEndsAt,
            protectedMedia: {
              localUri: protectedViewer.raw.imageUrl ?? undefined,
              mediaType:
                protectedViewer.raw.type === 'video' ? 'video' : 'photo',
              timer: protectedViewer.raw.protectedMediaTimer ?? 0,
              viewingMode:
                protectedViewer.raw.protectedMediaViewingMode === 'hold'
                  ? 'hold'
                  : 'tap',
              isMirrored: !!protectedViewer.raw.protectedMediaIsMirrored,
              expiresDurationMs:
                (protectedViewer.raw.protectedMediaTimer ?? 0) * 1000,
            },
          }}
          onClose={() => setProtectedViewer(null)}
        />
      )}

      {/* NORMAL-MEDIA VIEWER:
          Fullscreen lightbox for non-protected photo/video. No timer, no
          expiry. Tap close to dismiss. */}
      {normalViewer && (
        <NormalMediaModal
          uri={normalViewer.uri}
          type={normalViewer.type}
          onClose={() => setNormalViewer(null)}
        />
      )}

      {/* Bottle spin game — only mount when active */}
      {showGameModal && tdState === 'active' && id && userId && (
        <BottleSpinGame
          visible={showGameModal}
          onClose={() => setShowGameModal(false)}
          onCancel={() => {
            // TD-PAUSE parity: user-initiated close should NOT auto-reopen.
            setTdPaused(true);
            setShowGameModal(false);
          }}
          conversationId={id}
          userId={userId}
          currentUserName={currentUserName}
          otherUserName={otherUserName}
          onSendResultMessage={handleSendResultMessage}
          autoAdvance
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    backgroundColor: C.background,
  },
  headerBtn: { padding: 6 },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginLeft: 2,
  },
  headerAvatarWrap: {
    width: 40,
    height: 40,
    marginRight: 10,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
  },
  headerAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerNameWrap: { flex: 1, minWidth: 0 },
  headerName: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    flexShrink: 1,
  },
  headerStatus: {
    fontSize: 12,
    color: C.primary,
    marginTop: 2,
    fontWeight: '500',
  },
  tdPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tdPillDisabled: { opacity: 0.5 },
  tdPillText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  tdPillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFD93D',
    marginLeft: 5,
  },
  menuBtn: { padding: 8 },
  waitingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: C.surface,
    gap: 8,
  },
  waitingText: { color: C.text, fontSize: 13, flexShrink: 1 },
  cooldownToast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 14,
    zIndex: 50,
    gap: 6,
  },
  cooldownText: { color: COLORS.white, fontSize: 13, fontWeight: '500' },
  listWrap: { flex: 1, backgroundColor: C.dmBackground ?? C.background },
  // BOTTOM-ANCHOR-FIX: flexGrow + justifyContent: 'flex-end' makes the message
  // list hug the bottom (just above composer) when content is shorter than the
  // viewport — same approach Phase-1 uses in ChatScreenInner.tsx. paddingBottom
  // is small because the composer is a sibling of FlashList inside the KAV.
  listContent: {
    flexGrow: 1,
    justifyContent: 'flex-end' as const,
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  emptyText: { color: C.textLight, fontSize: 14, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  inviteCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  inviteIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  inviteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  inviteSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 16,
  },
  inviteRow: { flexDirection: 'row', gap: 12, width: '100%' },
  inviteBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCancel: { backgroundColor: '#E5E5EA' },
  inviteCancelText: { color: COLORS.text, fontWeight: '600' },
  inviteSend: { backgroundColor: C.primary },
  inviteSendText: { color: COLORS.white, fontWeight: '600' },
  inviteCardWrap: { width: '100%', maxWidth: 380, alignItems: 'center' },
  modalDismiss: { marginTop: 14, padding: 10 },
  modalDismissText: { color: COLORS.white, fontSize: 14, fontWeight: '500' },
  // 3-dot menu / report sheet
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  menuHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 14,
  },
  menuItemText: {
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
  },
  menuCancel: {
    marginTop: 8,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  menuCancelText: { color: C.textLight, fontSize: 15, fontWeight: '500' },
  reportTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 18,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.7,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: C.background,
  },
  errorTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: C.primary,
    borderRadius: 22,
  },
  errorBtnText: { color: COLORS.white, fontWeight: '600' },
});
