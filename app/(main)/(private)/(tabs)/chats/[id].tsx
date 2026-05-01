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
import { LinearGradient } from 'expo-linear-gradient';
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
import { deriveMyRole } from '@/lib/bottleSpin';
import { uploadMediaToConvexWithProgress } from '@/lib/uploadUtils';
import { getCachedMediaUri } from '@/lib/mediaCache';
// ANON-LOADING-FIX: stable name resolver — never show "Anonymous" while loading.
import { resolveStableName } from '@/lib/identity';

// [P2_MEDIA_UPLOAD] Mirror Phase-1 ChatScreenInner.PendingSecureMessage
// (components/screens/ChatScreenInner.tsx:171-182). Drives the optimistic
// chat bubble during upload + send: localUri preview, progress ring,
// sending spinner, and persistent retry on failure. Phase-2 backend only.
type PendingPhase2Message = {
  _id: string;
  senderId: string;
  type: 'image' | 'video';
  content: string;
  createdAt: number;
  localUri: string;
  uploadStatus: 'uploading' | 'sending' | 'upload_failed' | 'send_failed';
  uploadProgress: number;
  // Cached after upload succeeds so `send_failed` retries can skip re-upload.
  storageId?: string;
  // Captured at confirm time so retries reuse the user's original choices.
  isProtected: boolean;
  protectedMediaTimer?: 0 | 30 | 60;
  protectedMediaViewingMode?: 'tap' | 'hold';
  protectedMediaIsMirrored?: boolean;
  clientMessageId: string;
};

// [P2_MEDIA_UPLOAD] 50ms throttle matches Phase-1 (ChatScreenInner.tsx:558).
const P2_PROGRESS_UPDATE_INTERVAL_MS = 50;

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
  // P2_HEADER_PARITY: Phase-2-isolated presence writer. Writes ONLY to
  // `privateUserPresence` (never `users.lastActive`) — see
  // convex/privateConversations.ts:1531. Drives the header online dot +
  // subtitle on the other side via `participantLastActive` returned by
  // `getPrivateConversation`.
  const updatePrivatePresence = useMutation(
    api.privateConversations.updatePresence
  );
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
  // MENU-CLEANUP: Phase-2 Unmatch path. Mirrors Phase-1's
  // `api.matches.unmatch` but stays inside the Phase-2 swipe/match graph
  // (`privateMatches` + caller-side `participantState.isHidden`). Phase-1
  // tables are NEVER touched by this mutation.
  const unmatchPrivate = useMutation(api.privateSwipes.unmatchPrivate);

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

  // P2_TD_PARITY (spin-hint chip): Phase-1 ChatScreenInner.tsx:795-797 — when
  // it is my turn to spin and the game modal is closed, show a short
  // "Your turn — tap to spin" chip below the header for ~3s. Local state
  // only — never persisted, never goes through the message thread.
  const [showSpinHint, setShowSpinHint] = useState(false);
  const spinHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpinHintKeyRef = useRef<string | null>(null);

  // P2_TD_PARITY (waiting-for-start banner): Phase-1
  // ChatScreenInner.tsx:2821-2829 — invitee sees a soft hourglass banner
  // immediately after acceptance, until the inviter taps Start. Driven by
  // the live game session (state='active' && !gameStartedAt && amInvitee).

  // P2_TD_PARITY (ephemeral choice toast): mirrors Phase-1's autoAdvance
  // toasts inside BottleSpinGame, but for events the user sees from outside
  // the modal (e.g. opponent picked truth/dare/skipped while my modal is
  // closed). Dedupe key is `${role}:${lastActionAt}` so query refreshes never
  // re-fire the same toast.
  const [tdToast, setTdToast] = useState<string | null>(null);
  const tdToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastToastKeyRef = useRef<string | null>(null);

  // SECURE-MEDIA REVIEW STATE (Phase-1 parity):
  // After camera capture or gallery pick, hold the asset URI + media type so
  // <Phase2CameraPhotoSheet> can review it and let the user pick Normal /
  // Once / 30s / 60s before upload + send.
  const [pendingMediaUri, setPendingMediaUri] = useState<string | null>(null);
  const [pendingMediaType, setPendingMediaType] = useState<'photo' | 'video'>(
    'photo'
  );
  const [pendingIsMirrored, setPendingIsMirrored] = useState(false);

  // [P2_MEDIA_UPLOAD] Optimistic pending media bubbles (mirrors Phase-1
  // ChatScreenInner.tsx:556 `pendingSecureMessages`). Array, not scalar, so
  // the user can stage a second send before the first finishes uploading.
  const [pendingPhase2Messages, setPendingPhase2Messages] = useState<
    PendingPhase2Message[]
  >([]);
  // [P2_MEDIA_UPLOAD_FIX] Ref mirror of pending state. The previous
  // `setPendingPhase2Messages((prev) => { pending = prev.find(...); return prev; })`
  // pattern was unreliable because React 18 schedules updater functions and
  // they may run AFTER the line that reads `pending`. The ref is mutated
  // synchronously inside every helper, so async code (the upload runner +
  // retry handler) can read the latest snapshot without going through state.
  const pendingMessagesRef = useRef<PendingPhase2Message[]>([]);
  // [P2_MEDIA_UPLOAD] Throttle map keyed by pending id, mirrors Phase-1
  // ChatScreenInner.tsx:559. Prevents per-chunk progress callbacks from
  // re-rendering the FlashList faster than ~20 fps.
  const lastP2ProgressUpdateRef = useRef<Map<string, number>>(new Map());

  // [P2_MEDIA_UPLOAD] Helpers (mirrors Phase-1 `addPendingSecureMessage`,
  // `updatePendingSecureMessage`, `removePendingSecureMessage`). Local-only
  // — never round-trips through Convex. Each helper writes to the ref
  // synchronously THEN commits the new array to React state so the UI
  // re-renders.
  const addPendingPhase2Message = useCallback(
    (msg: PendingPhase2Message) => {
      pendingMessagesRef.current = [...pendingMessagesRef.current, msg];
      setPendingPhase2Messages(pendingMessagesRef.current);
    },
    []
  );
  const updatePendingPhase2Message = useCallback(
    (pendingId: string, patch: Partial<PendingPhase2Message>) => {
      pendingMessagesRef.current = pendingMessagesRef.current.map((m) =>
        m._id === pendingId ? { ...m, ...patch } : m
      );
      setPendingPhase2Messages(pendingMessagesRef.current);
    },
    []
  );
  const removePendingPhase2Message = useCallback((pendingId: string) => {
    pendingMessagesRef.current = pendingMessagesRef.current.filter(
      (m) => m._id !== pendingId
    );
    setPendingPhase2Messages(pendingMessagesRef.current);
    lastP2ProgressUpdateRef.current.delete(pendingId);
  }, []);

  // [P2_MEDIA_UPLOAD] Reset pending bubbles + throttle map when conversation
  // switches (mirrors Phase-1 ChatScreenInner.tsx:587-589).
  useEffect(() => {
    pendingMessagesRef.current = [];
    setPendingPhase2Messages([]);
    lastP2ProgressUpdateRef.current.clear();
  }, [id]);

  // P2_HEADER_PARITY: Heartbeat presence while the chat is open. Mirrors
  // Phase-1 ChatScreenInner.tsx:1441-1457 but uses the Phase-2-isolated
  // `privateUserPresence` table via api.privateConversations.updatePresence
  // (Phase-1's `users.lastActive` is NEVER touched). Ticks once on mount
  // and every 30s thereafter so the OTHER side sees a fresh "Online" dot
  // and ladder subtitle in their header.
  useEffect(() => {
    if (!userId) return;
    updatePrivatePresence({ authUserId: userId }).catch(() => {
      // Silent fail — presence is best-effort.
    });
    const interval = setInterval(() => {
      updatePrivatePresence({ authUserId: userId }).catch(() => {
        // Silent fail — presence is best-effort.
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [userId, updatePrivatePresence]);

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
  // ANON-LOADING-FIX:
  //   participantName may be undefined (query loading), null (backend has no
  //   private profile/handle yet), or the literal string "Anonymous" from
  //   pre-fix backends. Use resolveStableName + a ref of the last good name
  //   so the header never flickers to "Anonymous" during hydration. For
  //   non-render uses (Alerts, prop strings), fall back to a neutral
  //   "this user" label — never "Anonymous".
  const lastStableOtherNameRef = useRef<string | undefined>(undefined);
  const stableOtherUserName = resolveStableName(
    (conversation as any)?.participantName as string | null | undefined,
    lastStableOtherNameRef.current,
  );
  if (stableOtherUserName) {
    lastStableOtherNameRef.current = stableOtherUserName;
  }
  const otherUserName = stableOtherUserName ?? 'this user';
  const otherPhotoUrl = (conversation as any)?.participantPhotoUrl as
    | string
    | undefined;
  // P2_HEADER_PARITY: lastActive timestamp for the other participant, sourced
  // from the Phase-2-isolated `privateUserPresence` table (NOT users.lastActive)
  // via `api.privateConversations.getPrivateConversation`. Mirrors Phase-1's
  // `otherUserLastActive` (ChatScreenInner.tsx:2697-2741) and powers the
  // header presence dot + status subtitle ladder below.
  const participantLastActive =
    ((conversation as any)?.participantLastActive as number | undefined) ?? 0;

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
  // P2_TD_PARITY: surface the same session fields Phase-1 uses for the spin
  // hint and choice toast dedupe (ChatScreenInner.tsx:804-805).
  const truthDareLastActionAt = (gameSession as any)?.lastActionAt as
    | number
    | undefined;
  const truthDareSpinTurnRole = (gameSession as any)?.spinTurnRole as
    | 'inviter'
    | 'invitee'
    | undefined;
  const truthDareTurnPhase = (gameSession as any)?.turnPhase as
    | 'idle'
    | 'spinning'
    | 'choosing'
    | 'complete'
    | undefined;
  const truthDareLastSpinResult = (gameSession as any)?.lastSpinResult as
    | { role?: 'inviter' | 'invitee'; choice?: 'truth' | 'dare' | 'skipped' }
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

  // P2_TD_RECEIVER_PARITY: Auto-open the invite modal on the invitee's
  // device as soon as the live game-session query reports a pending invite
  // addressed to us. Phase-1 (`components/screens/ChatScreenInner.tsx:3204`)
  // renders the `TruthDareInviteCard` automatically whenever
  // `gameSession?.state === 'pending' && isTruthDareInvitee` — no header-
  // button tap required. Phase-2 keeps the same card but wraps it inside
  // `<Modal visible={showInviteModal}>` (line ~1422), and the previous
  // implementation only flipped `showInviteModal=true` from
  // `handleTruthDarePress`, so the invitee never saw the popup until they
  // manually tapped the T/D header — that is the bug.
  //
  // Mirror Phase-1 by tracking the auto-opened session id in a ref so we:
  //   1. open the modal exactly once per fresh pending invite (no re-open
  //      loop during the brief 'pending'→'active' query refresh window
  //      after accept, since the sessionId is unchanged);
  //   2. dismiss the modal automatically when the session leaves 'pending'
  //      via accept (→active), decline (→cooldown), timeout (→expired) or
  //      cancel (→none), so the invitee never sees a stale prompt;
  //   3. leave the inviter's manually-opened "Send invite" form alone
  //      (the ref is only ever set inside the `amInvitee` branch).
  const autoOpenedInviteSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const pendingSessionId = (gameSession as any)?.sessionId as
      | string
      | undefined;
    if (tdState === 'pending' && amInvitee && pendingSessionId) {
      if (autoOpenedInviteSessionRef.current !== pendingSessionId) {
        console.log('[P2_TD_RECEIVE_AUTO_OPEN]', {
          id,
          sessionId: pendingSessionId,
        });
        autoOpenedInviteSessionRef.current = pendingSessionId;
        setShowInviteModal(true);
      }
      return;
    }
    if (
      autoOpenedInviteSessionRef.current !== null &&
      tdState !== 'pending'
    ) {
      console.log('[P2_TD_RECEIVE_AUTO_CLOSE]', {
        id,
        nextState: tdState,
      });
      autoOpenedInviteSessionRef.current = null;
      setShowInviteModal(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tdState, amInvitee, gameSession]);

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

  // P2_TD_PARITY: cleanup spin-hint + ephemeral toast timers on unmount.
  // Mirrors Phase-1 ChatScreenInner.tsx:952-959 for the spin-hint timer.
  useEffect(() => {
    return () => {
      if (spinHintTimerRef.current) {
        clearTimeout(spinHintTimerRef.current);
        spinHintTimerRef.current = null;
      }
      if (tdToastTimerRef.current) {
        clearTimeout(tdToastTimerRef.current);
        tdToastTimerRef.current = null;
      }
    };
  }, []);

  // P2_TD_PARITY: spin-hint trigger. Direct port of Phase-1
  // ChatScreenInner.tsx:962-1007. Show "Your turn — tap to spin" once per
  // turn, dedupe via `${spinTurnRole}:${lastActionAt}`, auto-hide after 3s.
  useEffect(() => {
    if (!gameSession || !userId) return;
    if (tdState !== 'active') return;
    if (truthDareTurnPhase !== 'idle') return;
    if (!gameStartedAt) return;
    if (showGameModal) return;
    if (tdPaused) return;

    const myRole = deriveMyRole(gameSession, userId);
    const spinTurnRole = truthDareSpinTurnRole || 'inviter';
    if (!myRole || spinTurnRole !== myRole) return;

    const hintKey = `${spinTurnRole}:${truthDareLastActionAt ?? 0}`;
    if (lastSpinHintKeyRef.current === hintKey) return;
    lastSpinHintKeyRef.current = hintKey;

    if (spinHintTimerRef.current) {
      clearTimeout(spinHintTimerRef.current);
    }

    setShowSpinHint(true);
    console.log('[P2_TD_SPIN_HINT_SHOW]', {
      conversationId: id,
      spinTurnRole,
      lastActionAt: truthDareLastActionAt,
    });

    spinHintTimerRef.current = setTimeout(() => {
      setShowSpinHint(false);
      spinHintTimerRef.current = null;
      console.log('[P2_TD_SPIN_HINT_HIDE]', { conversationId: id });
    }, 3000);
  }, [
    id,
    userId,
    gameSession,
    tdState,
    truthDareTurnPhase,
    gameStartedAt,
    showGameModal,
    tdPaused,
    truthDareSpinTurnRole,
    truthDareLastActionAt,
  ]);

  // P2_TD_PARITY: ephemeral choice toast. When the OTHER player's spin
  // resolves to a choice (truth/dare/skipped) while my game modal is closed,
  // surface a brief Phase-1-style toast — never persist a system message
  // row. Dedupe via `${role}:${lastActionAt}`.
  useEffect(() => {
    if (!gameSession || !userId) return;
    if (tdState !== 'active') return;
    if (!gameStartedAt) return;
    if (!truthDareLastSpinResult) return;
    const choice = truthDareLastSpinResult.choice;
    const role = truthDareLastSpinResult.role;
    if (!choice || !role) return;

    const toastKey = `${role}:${choice}:${truthDareLastActionAt ?? 0}`;
    if (lastToastKeyRef.current === toastKey) return;
    lastToastKeyRef.current = toastKey;

    // Suppress for the side whose modal is currently open — they already see
    // the inline result inside BottleSpinGame.
    if (showGameModal) return;

    const myRole = deriveMyRole(gameSession, userId);
    const actorIsMe = !!myRole && role === myRole;
    const actorName = actorIsMe ? currentUserName : otherUserName;

    let label: string | null = null;
    if (choice === 'truth') label = `${actorName} chose Truth`;
    else if (choice === 'dare') label = `${actorName} chose Dare`;
    else if (choice === 'skipped') label = `${actorName} skipped this turn`;
    if (!label) return;

    if (tdToastTimerRef.current) {
      clearTimeout(tdToastTimerRef.current);
    }
    setTdToast(label);
    console.log('[P2_TD_TOAST_SHOW]', { conversationId: id, label });
    tdToastTimerRef.current = setTimeout(() => {
      setTdToast(null);
      tdToastTimerRef.current = null;
    }, 2000);
  }, [
    id,
    userId,
    gameSession,
    tdState,
    gameStartedAt,
    truthDareLastSpinResult,
    truthDareLastActionAt,
    showGameModal,
    currentUserName,
    otherUserName,
  ]);

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

  // P2_TD_PARITY (REMOVED): the previous `sendSystemMessage` helper wrote
  // `[SYSTEM:truthdare]…` rows into the conversation thread for game events
  // (invite, accept, decline, choice, end). Phase-1 NEVER persists T/D
  // events as chat rows — it surfaces them as ephemeral toasts/banners only
  // (`components/screens/ChatScreenInner.tsx`). All Phase-2 call sites that
  // used to invoke this helper now drive local UI state instead (spin hint,
  // waiting-for-start banner, choice toast). The helper is intentionally
  // removed so no future caller can accidentally write a T/D row.

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
            // P2_TD_PARITY: do NOT write a "[SYSTEM:truthdare]Game started!"
            // chat row. Phase-1 surfaces this transition by removing the
            // waiting-for-start banner and opening BottleSpinGame, not via a
            // persisted message.
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
      // P2_TD_PARITY: do NOT announce the invite as a chat row. Phase-1
      // (ChatScreenInner.tsx) shows the inviter waiting bar (already rendered
      // below) and the invitee's auto-opened TruthDareInviteCard — no
      // persisted system message.
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
      // P2_TD_PARITY: do NOT post an "X is ready to play" chat row. Phase-1
      // surfaces acceptance through the live game session transition (state
      // becomes 'active') which is read by the inviter to enable Start! and
      // by the invitee to render the waiting-for-start banner below — no
      // persisted system message.
    } catch (err: any) {
      Alert.alert('Could not accept', String(err?.message ?? err));
    }
  }, [userId, id, respondInvite]);

  const handleDeclineInvite = useCallback(async () => {
    if (!userId || !id) return;
    try {
      await respondInvite({
        authUserId: userId,
        conversationId: id,
        accept: false,
      });
      setShowInviteModal(false);
      // P2_TD_PARITY: do NOT post an "X declined" chat row. The decline drops
      // the session into 'cooldown'/'none', which the inviter sees through
      // the existing cooldown toast / T/D button label.
    } catch (err: any) {
      Alert.alert('Could not decline', String(err?.message ?? err));
    }
  }, [userId, id, respondInvite]);

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
  // "${name} ended the game"). Phase-1 surfaces these as ephemeral toasts
  // inside BottleSpinGame (autoAdvance) and as outside-the-modal toasts
  // driven from the live game session — never as persisted [SYSTEM:truthdare]
  // chat rows. Phase-2 mirrors that here: we still intercept the End-Game
  // string to call endBottleSpinGame (so the session transitions to
  // cooldown and the modal closes), but we no longer write any chat row.
  const handleSendResultMessage = useCallback(
    async (msg: string) => {
      if (!id || !userId) return;
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
      // No chat-row write: the choice/skipped/end events are surfaced via
      // the local `tdToast` effect above and via the BottleSpinGame modal's
      // own inline UI for the active player.
    },
    [id, userId, endGame]
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

  // [P2_MEDIA_UPLOAD] Drive the pending bubble through upload (with real byte
  // progress) → sending → server insert. On failure, mark the bubble
  // upload_failed or send_failed and leave it in chat for the user to retry.
  // Mirrors Phase-1 ChatScreenInner.tsx:2099-2213 + 2254-2390.
  const runP2UploadAndSend = useCallback(
    async (pendingId: string) => {
      if (!id || !token || !userId) {
        console.warn('[P2_MEDIA_UPLOAD_START] missing id/token/userId', {
          hasId: !!id,
          hasToken: !!token,
          hasUserId: !!userId,
        });
        return;
      }
      // [P2_MEDIA_UPLOAD_FIX] Synchronous read from the ref — guaranteed to
      // contain the row that handleConfirmSecureSend just pushed.
      const pending = pendingMessagesRef.current.find(
        (m) => m._id === pendingId
      );
      if (!pending) {
        console.warn('[P2_MEDIA_UPLOAD_START] pending row not in ref', {
          pendingId,
          refLen: pendingMessagesRef.current.length,
        });
        return;
      }

      const isVideo = pending.type === 'video';
      const mediaTypeForUpload: 'photo' | 'video' = isVideo ? 'video' : 'photo';
      console.log('[P2_MEDIA_UPLOAD_START]', {
        pendingId,
        type: pending.type,
        isProtected: pending.isProtected,
        hasStorageId: !!pending.storageId,
      });

      try {
        // ---------------------------------------------------------------- upload
        let storageId = pending.storageId;
        if (!storageId) {
          updatePendingPhase2Message(pendingId, {
            uploadStatus: 'uploading',
            uploadProgress: 0,
          });
          lastP2ProgressUpdateRef.current.set(pendingId, 0);

          console.log('[P2_MEDIA_UPLOAD_URL_REQUEST]', { pendingId });
          storageId = (await uploadMediaToConvexWithProgress(
            pending.localUri,
            async () => {
              const url = await generateMediaUploadUrl({ token });
              console.log('[P2_MEDIA_UPLOAD_URL_OK]', {
                pendingId,
                hasUrl: !!url,
              });
              return url as unknown as string;
            },
            mediaTypeForUpload,
            (pct) => {
              const now = Date.now();
              const last =
                lastP2ProgressUpdateRef.current.get(pendingId) ?? 0;
              if (
                pct < 100 &&
                now - last < P2_PROGRESS_UPDATE_INTERVAL_MS
              ) {
                return;
              }
              lastP2ProgressUpdateRef.current.set(pendingId, now);
              const clamped = Math.max(0, Math.min(100, pct));
              // Sample log at 0/25/50/75/100 so we don't flood logcat.
              const rounded = Math.round(clamped);
              if (rounded % 25 === 0) {
                console.log('[P2_MEDIA_UPLOAD_PROGRESS]', {
                  pendingId,
                  pct: rounded,
                });
              }
              updatePendingPhase2Message(pendingId, {
                uploadProgress: clamped,
              });
            }
          )) as unknown as string;

          console.log('[P2_MEDIA_UPLOAD_STORAGE_ID]', {
            pendingId,
            storageId,
          });
          updatePendingPhase2Message(pendingId, {
            storageId,
            uploadProgress: 100,
          });
        }

        // ---------------------------------------------------------------- send
        updatePendingPhase2Message(pendingId, { uploadStatus: 'sending' });
        console.log('[P2_MEDIA_SEND_START]', {
          pendingId,
          storageId,
          isProtected: pending.isProtected,
        });

        if (!pending.isProtected) {
          await sendPrivateMessage({
            token,
            conversationId: id as any,
            type: isVideo ? 'video' : 'image',
            content: pending.content,
            imageStorageId: storageId as any,
            clientMessageId: pending.clientMessageId,
          });
        } else {
          await sendPrivateMessage({
            token,
            conversationId: id as any,
            type: isVideo ? 'video' : 'image',
            content: pending.content,
            imageStorageId: storageId as any,
            isProtected: true,
            protectedMediaTimer: pending.protectedMediaTimer,
            protectedMediaViewingMode: pending.protectedMediaViewingMode,
            protectedMediaIsMirrored: pending.protectedMediaIsMirrored,
            clientMessageId: pending.clientMessageId,
          });
        }

        // ---------------------------------------------------------------- success
        // Server insert succeeded. The optimistic bubble can now be dropped:
        // the canonical message will arrive via getPrivateMessages and render
        // in the same chronological position.
        console.log('[P2_MEDIA_SEND_OK]', { pendingId });
        removePendingPhase2Message(pendingId);
      } catch (err: any) {
        // [P2_MEDIA_UPLOAD] Split failure path mirrors Phase-1: keep the
        // bubble in chat with the appropriate retry state. We do NOT show
        // an Alert because the user already sees the failure state inline.
        const msg = String(err?.message ?? err);
        // [P2_MEDIA_UPLOAD_FIX] Read the latest storageId from the ref
        // (it may have just been set inside the try block above).
        const latestRow = pendingMessagesRef.current.find(
          (m) => m._id === pendingId
        );
        const latestStorageId = latestRow?.storageId;
        const failedDuringSend =
          !!latestStorageId || msg.toLowerCase().includes('send');
        const nextStatus: PendingPhase2Message['uploadStatus'] = latestStorageId
          ? 'send_failed'
          : failedDuringSend
            ? 'send_failed'
            : 'upload_failed';
        updatePendingPhase2Message(pendingId, { uploadStatus: nextStatus });
        console.warn('[P2_MEDIA_UPLOAD_FAILED]', {
          pendingId,
          nextStatus,
          hasStorageId: !!latestStorageId,
          err: msg,
        });
      }
    },
    [
      id,
      token,
      userId,
      generateMediaUploadUrl,
      sendPrivateMessage,
      updatePendingPhase2Message,
      removePendingPhase2Message,
    ]
  );

  // Confirm callback from <Phase2CameraPhotoSheet>: stage an optimistic
  // pending bubble immediately, then upload + send in the background.
  // Phase-1 timer values:
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
      if (!id || !token || !userId) {
        clearPendingMedia();
        return;
      }
      const isVideo = pendingMediaType === 'video';
      const isMirrored = pendingIsMirrored;
      const timer = options.timer; // -1 | 0 | 30 | 60
      const isNormal = timer < 0;

      // [P2_MEDIA_UPLOAD] Build the optimistic pending row BEFORE clearing
      // the review-sheet state, so we never lose the user's chosen URI.
      const pendingId = `pending_p2_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const clientMessageId = `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const pending: PendingPhase2Message = {
        _id: pendingId,
        senderId: userId,
        type: isVideo ? 'video' : 'image',
        content: isNormal
          ? isVideo
            ? 'Video'
            : 'Photo'
          : isVideo
            ? 'Secure Video'
            : 'Secure Photo',
        createdAt: Date.now(),
        localUri: uri,
        uploadStatus: 'uploading',
        uploadProgress: 0,
        isProtected: !isNormal,
        protectedMediaTimer: isNormal ? undefined : (timer as 0 | 30 | 60),
        protectedMediaViewingMode: isNormal ? undefined : options.viewingMode,
        protectedMediaIsMirrored:
          isNormal ? undefined : isVideo && isMirrored,
        clientMessageId,
      };
      addPendingPhase2Message(pending);
      clearPendingMedia();

      // Fire-and-forget: the bubble already shows progress; runP2UploadAndSend
      // updates state internally and never throws to the caller.
      void runP2UploadAndSend(pendingId);
    },
    [
      id,
      token,
      userId,
      pendingMediaType,
      pendingIsMirrored,
      addPendingPhase2Message,
      clearPendingMedia,
      runP2UploadAndSend,
    ]
  );

  // [P2_MEDIA_UPLOAD] Tap-to-retry handler (Phase-1 parity:
  // ChatScreenInner.tsx:2254-2390). Two paths:
  //   - send_failed → reuse cached storageId, only re-run sendPrivateMessage.
  //   - upload_failed (no storageId) → re-upload from localUri then send.
  // runP2UploadAndSend already branches on the cached storageId, so the
  // retry just resets the bubble to the appropriate starting state.
  const handleRetryPendingPhase2Media = useCallback(
    (pendingId: string) => {
      // [P2_MEDIA_UPLOAD_FIX] Synchronous read from ref — no setState callback
      // race. The upload runner also reads from the ref so the cached
      // storageId (if any) survives the retry without re-uploading.
      const pending = pendingMessagesRef.current.find(
        (m) => m._id === pendingId
      );
      if (!pending) return;
      if (pending.uploadStatus === 'send_failed' && pending.storageId) {
        updatePendingPhase2Message(pendingId, {
          uploadStatus: 'sending',
        });
      } else {
        // upload_failed (or send_failed without a cached storageId for some
        // reason): retry from the upload step.
        updatePendingPhase2Message(pendingId, {
          uploadStatus: 'uploading',
          uploadProgress: 0,
          storageId: undefined,
        });
        lastP2ProgressUpdateRef.current.set(pendingId, 0);
      }
      void runP2UploadAndSend(pendingId);
    },
    [updatePendingPhase2Message, runP2UploadAndSend]
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

  // MENU-CLEANUP: Phase-2 Unmatch — replaces the old "End connection" path.
  // Calls `api.privateSwipes.unmatchPrivate` (sets privateMatches.isActive
  // false + caller's participantState.isHidden true) then best-effort
  // `leavePrivateConversation` so the row drops off the chat list
  // immediately, then navigates back. Phase-1 tables are never touched.
  const handleUnmatch = useCallback(() => {
    setShowMenu(false);
    if (!userId || !id) return;
    Alert.alert(
      'Unmatch?',
      `This will remove your match and close the conversation with ${otherUserName}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await unmatchPrivate({
                authUserId: userId,
                conversationId: id as any,
              });
              if (!result?.success) {
                throw new Error(
                  (result as any)?.error || 'Failed to unmatch.'
                );
              }
              if (token) {
                try {
                  await leaveConversation({
                    token,
                    conversationId: id as any,
                  });
                } catch {
                  // best-effort hide — unmatch already flipped isActive=false
                }
              }
              router.replace('/(main)/(private)/(tabs)/chats' as any);
            } catch (err: any) {
              Alert.alert('Could not unmatch', String(err?.message ?? err));
            }
          },
        },
      ]
    );
  }, [
    userId,
    id,
    otherUserName,
    unmatchPrivate,
    leaveConversation,
    token,
    router,
  ]);

  const handleReportReason = useCallback(
    async (
      reason:
        | 'fake_profile'
        | 'inappropriate_photos'
        | 'harassment'
        | 'underage'
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

  // MENU-CLEANUP: Phase-2 Scam quick action. Frontend-only mapping to
  // backend `reason: 'other'` + description so no new backend literal is
  // required. Moderators see the descriptive label in the audit row.
  const handleScam = useCallback(async () => {
    setShowMenu(false);
    if (!userId || !otherUserId) return;
    try {
      await reportUser({
        authUserId: userId,
        reportedUserId: otherUserId as any,
        reason: 'other',
        description: 'Scam/fraudulent behavior',
      });
      Alert.alert(
        'Reported as scam',
        'Thanks — our team will review this report.'
      );
    } catch (err: any) {
      Alert.alert('Could not submit report', String(err?.message ?? err));
    }
  }, [userId, otherUserId, reportUser]);

  // --------------------------------------------------------------------- render helpers
  // MESSAGES-STABILIZE: Convex `useQuery` returns `undefined` whenever its
  // args flip to `'skip'` (transient `userId`/`id` re-resolution during
  // thread open, auth refresh, brief route param re-parse, etc.). Without
  // caching, that flips the body render gate from FlashList back to the
  // centered ActivityIndicator — the visible content → blank → content
  // flicker the user reported. Cache the last non-undefined messages array
  // in a ref so the body keeps showing the previous content while the
  // subscription re-establishes. Reset on conversation switch so the
  // previous thread's messages can never bleed into the new one. Backend
  // remains source of truth — this ref is UI stabilization only.
  const lastStableMessagesRef = useRef<any[] | null>(null);
  // P2_THREAD_FIRST_PAINT: Replaces the older `hasRenderedContentRef` lock.
  // The previous lock flipped the moment `messageList.length > 0`, which
  // produced a cascading multi-stage open: (1) centered spinner; (2)
  // spinner disappears + 36 bubbles pop in (lock flips here); (3) header
  // T/D pill state changes when `gameSession` resolves a tick later. The
  // user perceived that 3-step cascade as "appears / changes / appears".
  //
  // The new lock only flips once ALL of (conversation, stableMessages,
  // currentUser, gameSession) are defined. Until then we hold a single
  // stable loading overlay; the moment everything is ready the overlay
  // is removed in one frame and content + T/D pill + header presence
  // appear together. After the lock flips, transient query refreshes can
  // never bring the overlay back (matches the prior "never replace
  // content with loading/blank" guarantee). Reset on conversation switch.
  const hasInitialPayloadRef = useRef(false);
  useEffect(() => {
    // New conversation → drop caches so a fresh thread starts from a clean
    // skeleton state and never momentarily renders the prior thread.
    lastStableMessagesRef.current = null;
    hasInitialPayloadRef.current = false;
  }, [id]);
  useEffect(() => {
    if (messages !== undefined) {
      lastStableMessagesRef.current = messages as any[];
    }
  }, [messages]);
  const stableMessages: any[] | undefined =
    messages !== undefined
      ? (messages as any[])
      : lastStableMessagesRef.current ?? undefined;

  // P2_THREAD_FIRST_PAINT: Coordinated opening gate. All four queries must
  // resolve before we lift the loading overlay so the body, header T/D
  // pill, presence dot, and message bubbles all appear in the same frame.
  // `gameSession` is included because the T/D pill in the header depends
  // on it and we don't want it visibly swapping right after messages
  // appear. The synchronous render-time ref mutation is safe (no setState).
  const isInitialPayloadReady =
    conversation !== undefined &&
    stableMessages !== undefined &&
    currentUser !== undefined &&
    gameSession !== undefined;
  if (isInitialPayloadReady) {
    hasInitialPayloadRef.current = true;
  }

  // [P2_MEDIA_UPLOAD] Merge server messages with optimistic pending bubbles,
  // sort by (createdAt, _id) so the pending bubble lands in the right slot
  // and survives clock skew between client + server (mirrors Phase-1
  // ChatScreenInner.tsx:715-720).
  const messageList = useMemo(() => {
    const server = (stableMessages ?? []) as any[];
    if (pendingPhase2Messages.length === 0) return server;
    const pendingAsRows = pendingPhase2Messages.map((p) => ({
      // FlashList keyExtractor reads `id`; the rest of `item.*` is consumed
      // by renderItem.
      id: p._id,
      _isPendingPhase2: true,
      pending: p,
      senderId: p.senderId,
      type: p.type,
      content: p.content,
      createdAt: p.createdAt,
    }));
    return [...server, ...pendingAsRows].sort((a, b) => {
      const diff = (a.createdAt ?? 0) - (b.createdAt ?? 0);
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [stableMessages, pendingPhase2Messages]);

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const isOwn = item.senderId === userId;
      // AVATAR GROUPING: last in group when next message has different sender
      // or this is the most recent message in the list.
      const next = messageList[index + 1];
      const isLastInGroup = !next || next.senderId !== item.senderId;

      // [P2_MEDIA_UPLOAD] Optimistic pending media bubble: render through the
      // shared MessageBubble pending path (components/chat/MessageBubble.tsx
      // :270-351). Phase-1 already ships the upload ring + sending spinner +
      // tap-to-retry UI; we just need to pass the pending props.
      if (item._isPendingPhase2) {
        const p = item.pending as PendingPhase2Message;
        return (
          <MessageBubble
            message={{
              id: p._id,
              senderId: p.senderId,
              type: p.type,
              content: p.content,
              createdAt: p.createdAt,
              isPending: true,
              localUri: p.localUri,
              uploadStatus: p.uploadStatus,
              uploadProgress: p.uploadProgress,
            }}
            isOwn
            otherUserName={otherUserName}
            currentUserId={userId ?? undefined}
            currentUserToken={token ?? undefined}
            showAvatar={false}
            isLastInGroup={isLastInGroup}
            onRetryPendingMedia={handleRetryPendingPhase2Media}
            theme="phase2"
          />
        );
      }

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
          // LOAD-FIRST UX (Option A): Show a tap-to-load arrow on remote
          // photo/video tiles so receivers don't auto-download every
          // message. The MediaMessage caches via mediaCache and only
          // opens the viewer on the second tap. Doodles bypass the gate
          // internally in MediaMessage.
          requireMediaDownloadBeforeOpen
          autoDownloadMedia={false}
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
                    // LOAD-FIRST: pass the remote URL so the bubble can render
                    // the tap-to-load arrow and pre-cache via mediaCache before
                    // the viewer opens. Sender (isOwn) bypasses internally.
                    mediaUrl={item.imageUrl ?? undefined}
                    mediaKind={item.type === 'video' ? 'video' : 'image'}
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
          theme="phase2"
        />
      );
    },
    [
      userId,
      token,
      otherUserName,
      otherPhotoUrl,
      messageList,
      handleRetryPendingPhase2Media,
    ]
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

  // --------------------------------------------------------------------- early-return: loading shell
  // P2_THREAD_FIRST_PAINT: Single full-screen loading shell shown while the
  // initial payload (conversation + stableMessages + currentUser +
  // gameSession) is still resolving. The user sees ONE stable screen —
  // never a real header/composer/FlashList paired with a body spinner that
  // later swaps in messages and a final T/D pill state. Once
  // `hasInitialPayloadRef.current` latches true (set during render in the
  // gate block above), this early-return is bypassed for the rest of the
  // route session; transient query refreshes (Convex tick, inbox
  // markAllDelivered, optimistic→server id swap) can never bring the
  // shell back. The conversation-switch effect resets the ref on [id]
  // change so a brand-new thread re-enters this shell instead of briefly
  // rendering the previous thread's frame. The loading shell uses the
  // same gradient + safe-area padding as the real thread, so the
  // transition into the real thread is a single in-place reveal — no
  // background flash, no composer slide-in, no header pop-in.
  if (!hasInitialPayloadRef.current) {
    return (
      <LinearGradient
        colors={['#101426', '#1A1633', '#16213E']}
        locations={[0, 0.55, 1]}
        style={[
          styles.container,
          styles.gradientContainer,
          { paddingTop: insets.top },
        ]}
      >
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </LinearGradient>
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
    <LinearGradient
      // PHASE-2 PREMIUM: deep midnight navy → midnight plum → tab-bar surface.
      // Bottom stop matches the Phase-2 tab bar (C.surface = #16213E) so the
      // thread → composer → tab-bar transition reads as one cohesive surface.
      colors={['#101426', '#1A1633', '#16213E']}
      locations={[0, 0.55, 1]}
      style={[styles.container, styles.gradientContainer, { paddingTop: insets.top }]}
    >
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
            {/* P2_HEADER_PARITY: small presence dot overlaid on the avatar
                bottom-right, mirroring Phase-1 ChatScreenInner.tsx:2697-2706.
                Shown only when the backend has a presence record so we don't
                paint a stale "offline" dot on first load. Online = green when
                the participant heartbeat is < 60s old, neutral otherwise. */}
            {participantLastActive > 0 && (
              <View
                style={[
                  styles.headerPresenceDot,
                  Date.now() - participantLastActive < 60_000
                    ? styles.headerPresenceDotOnline
                    : styles.headerPresenceDotOffline,
                ]}
              />
            )}
          </View>
          <View style={styles.headerNameWrap}>
            {stableOtherUserName ? (
              <Text style={styles.headerName} numberOfLines={1}>
                {stableOtherUserName}
              </Text>
            ) : (
              // ANON-LOADING-FIX: skeleton placeholder while real name is
              // unknown — never print "Anonymous" for a loading state.
              <View
                style={{
                  width: 120,
                  height: 14,
                  borderRadius: 4,
                  backgroundColor: C.accent,
                }}
              />
            )}
            {/* P2_HEADER_PARITY: presence ladder subtitle, identical strings
                to Phase-1 ChatScreenInner.tsx:2729-2740. T/D state must NEVER
                replace this subtitle — keep it rendered unconditionally so
                the participant identity row stays stable across game phases. */}
            <Text style={styles.headerStatus} numberOfLines={1}>
              {(() => {
                const diff = Date.now() - participantLastActive;
                if (diff < 60_000) return 'Online';
                if (diff < 5 * 60_000) return 'Active now';
                if (participantLastActive > 0) return 'Recently active';
                return 'Offline';
              })()}
            </Text>
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

      {/* P2_TD_PARITY: waiting-for-start banner shown to the invitee after
          they accept. Phase-1 ChatScreenInner.tsx:2821-2829. Driven entirely
          by the live game session — no persisted system message needed.
          PHASE-2 PREMIUM: hourglass tinted rose to harmonize with the new
          dark-glass banner. State-condition + duration unchanged. */}
      {tdState === 'active' && !gameStartedAt && amInvitee && (
        <View style={styles.waitingStartBanner}>
          <Ionicons name="hourglass-outline" size={16} color="#E94560" />
          <Text style={styles.waitingStartBannerText} numberOfLines={1}>
            Waiting for {otherUserName} to start the game
          </Text>
        </View>
      )}

      {/* P2_TD_PARITY: my-turn spin hint chip. Phase-1 ChatScreenInner.tsx:
          2805-2819. Auto-hides after 3s; dedupe handled in the trigger
          effect via lastSpinHintKeyRef. */}
      {showSpinHint && (
        <View
          style={[styles.spinHintAnchor, { top: insets.top + 56 }]}
          pointerEvents="none"
        >
          <View style={styles.spinHintCaret} />
          <View style={styles.spinHintChip}>
            <View style={styles.spinHintDot} />
            <Text style={styles.spinHintText}>Your turn — tap to spin</Text>
          </View>
        </View>
      )}

      {/* P2_TD_PARITY: ephemeral T/D choice toast (truth/dare/skipped) for
          the side whose game modal is currently closed. Lives ~2s, dedupe
          via lastToastKeyRef. Never persists into the message thread. */}
      {tdToast && (
        <View
          style={[styles.tdToast, { top: insets.top + 64 }]}
          pointerEvents="none"
        >
          <Ionicons name="wine-outline" size={14} color={COLORS.white} />
          <Text style={styles.tdToastText} numberOfLines={1}>
            {tdToast}
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
          {/* P2_THREAD_FIRST_PAINT: This main return is reached ONLY after
              `hasInitialPayloadRef.current` is true (see early-return
              loading shell above). Everything below — header, T/D pill,
              FlashList, composer — appears together in a single in-place
              reveal. The list never re-mounts after this point: transient
              Convex refreshes are absorbed by `lastStableMessagesRef`, and
              true deleted/missing-conversation states are surfaced by the
              bad-id early-return above and by backend-driven navigation
              away (unmatch / block / leave). The empty overlay is shown
              only for a real empty conversation (server returned []) and
              cannot be triggered by a transient `messages === undefined`
              tick because the early-return blocks the first frame until
              `stableMessages` is defined. */}
          <FlashList
            ref={listRef}
            data={messageList}
            keyExtractor={(item: any) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={handleContentSizeChange}
          />
          {messageList.length === 0 && (
            <View
              style={[styles.emptyState, StyleSheet.absoluteFillObject]}
              pointerEvents="none"
            >
              <Ionicons
                name="chatbubbles-outline"
                size={42}
                color={C.textLight}
              />
              <Text style={styles.emptyText}>
                Say hi to {otherUserName} to get started
              </Text>
            </View>
          )}
        </View>

        <MessageInput
          onSend={handleSendText}
          onSendCamera={handleSendCameraPress}
          onSendGallery={handleSendGalleryPress}
          onSendVoice={handleSendVoiceMessage}
          theme="phase2"
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
                theme="phase2"
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

      {/* 3-dot menu — Unmatch / Block / Report / Scam / Cancel
          MENU-CLEANUP: aligned with Phase-1. "End connection" replaced
          by "Unmatch" (wired to api.privateSwipes.unmatchPrivate). */}
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
              onPress={handleUnmatch}
            >
              <Ionicons
                name="close-circle-outline"
                size={20}
                color={C.primary}
              />
              <Text style={[styles.menuItemText, { color: C.primary }]}>
                Unmatch
              </Text>
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
              onPress={handleScam}
            >
              <Ionicons name="alert-circle-outline" size={20} color={C.text} />
              <Text style={styles.menuItemText}>Scam</Text>
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

      {/* Report reason sheet — MENU-CLEANUP: 4 reasons only
          (Spam and Other removed). */}
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
              ['underage', 'Underage'],
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
              // LOAD-FIRST hand-off: prefer the already-cached local file
              // (downloaded by Phase2ProtectedMediaBubble's tap-to-load
              // gate) over the remote URL — avoids a second fetch when
              // the receiver actually opens the viewer.
              localUri:
                (protectedViewer.raw.imageUrl
                  ? getCachedMediaUri(protectedViewer.raw.imageUrl)
                  : undefined) ??
                protectedViewer.raw.imageUrl ??
                undefined,
              // LOAD-FIRST cleanup: pass the original remote URL so the
              // viewer can wipe the on-disk cached file when the message
              // is marked expired (once-view close, timer→0, etc.).
              remoteUrl: protectedViewer.raw.imageUrl ?? undefined,
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
          theme="phase2"
        />
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  // PHASE-2 PREMIUM: when the outer wrapper is a LinearGradient, the inherited
  // backgroundColor from `container` would obscure the gradient. This style is
  // appended to the LinearGradient's style array to clear it. Functionally
  // identical to `container` minus the solid bg — preserves flex:1 + paddings.
  gradientContainer: { backgroundColor: 'transparent' },
  // PHASE-2 PREMIUM: softer header divider (subtle white-on-dark hairline
  // instead of the heavier C.border slate). Gives a more premium edge,
  // closer to the iMessage / WhatsApp dark mode look.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
    // PHASE-2 PREMIUM: transparent so the LinearGradient backdrop bleeds
    // through the header edge, giving a soft "infinite surface" feel.
    backgroundColor: 'transparent',
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
    // P2_HEADER_PARITY: position relative is required so the absolutely
    // positioned presence dot anchors to the avatar bottom-right (Phase-1
    // ChatScreenInner.tsx styles `avatarContainer` does the same).
    position: 'relative',
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
  // P2_HEADER_PARITY: 10x10 dot with 2px white border, anchored to avatar
  // bottom-right. Matches the Phase-1 presenceDot/presenceDotOnline/Offline
  // shape (ChatScreenInner.tsx:3354-3371). Color set inline via the Online/
  // Offline variants below based on the freshness of participantLastActive.
  headerPresenceDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: C.background,
  },
  headerPresenceDotOnline: {
    backgroundColor: '#22C55E',
  },
  headerPresenceDotOffline: {
    backgroundColor: C.textLight,
    opacity: 0.5,
  },
  headerNameWrap: { flex: 1, minWidth: 0 },
  headerName: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    flexShrink: 1,
  },
  // P2_HEADER_PARITY: muted subtitle color matching Phase-1's headerStatus
  // (ChatScreenInner.tsx:3383-3388). Previously used C.primary + bold weight
  // because no subtitle was ever rendered; tone it down now that it carries
  // the presence ladder text.
  headerStatus: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  // PHASE-2 PREMIUM (T/D): rose pill with rose-tinted glow. Layout / hit-slop
  // / size unchanged — only visual harmony with the dark gradient surface.
  tdPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary, // INCOGNITO_COLORS.primary === '#E94560' rose
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#E94560',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
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
  // PHASE-2 PREMIUM (T/D): inviter waiting strip uses dark-glass surface +
  // soft rose hairline so it feels like part of the gradient instead of a
  // hard slate band. Behavior, copy, and visibility logic unchanged.
  waitingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(34, 34, 58, 0.85)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(233, 69, 96, 0.32)',
    gap: 8,
  },
  waitingText: { color: C.text, fontSize: 13, flexShrink: 1 },
  // PHASE-2 PREMIUM (T/D): waiting-for-start banner. Dropped the green tint
  // (looked disconnected from the new rose-accented dark theme); now reads as
  // a glassy plum strip with a rose hourglass to feel cohesive with tdPill.
  waitingStartBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(34, 34, 58, 0.85)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(233, 69, 96, 0.32)',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  waitingStartBannerText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(224, 224, 232, 0.88)',
    flexShrink: 1,
  },
  // PHASE-2 PREMIUM (T/D): spin-hint chip switched from white-on-light to
  // dark-glass with a rose dot. Caret now matches the chip surface so the
  // tooltip blends with the gradient backdrop. Position / dedupe unchanged.
  spinHintAnchor: {
    position: 'absolute',
    right: 16,
    zIndex: 30,
    elevation: 30,
    alignItems: 'flex-end',
  },
  spinHintCaret: {
    width: 10,
    height: 10,
    marginRight: 34,
    marginBottom: -5,
    backgroundColor: 'rgba(34, 34, 58, 0.96)',
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: 'rgba(233, 69, 96, 0.32)',
    transform: [{ rotate: '45deg' }],
  },
  spinHintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34, 34, 58, 0.96)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(233, 69, 96, 0.32)',
    shadowColor: '#E94560',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 6,
  },
  spinHintDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#E94560',
  },
  spinHintText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F2F3F8',
  },
  // PHASE-2 PREMIUM (T/D): floating choice toast. Uses the same midnight-plum
  // backdrop as the spin hint chip with a rose hairline border so multiple
  // T/D ephemerals share a single visual language. Timing / dedupe unchanged.
  tdToast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(15, 12, 30, 0.92)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(233, 69, 96, 0.32)',
    shadowColor: '#E94560',
    shadowOpacity: 0.30,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    zIndex: 50,
    gap: 6,
  },
  tdToastText: {
    color: '#F2F3F8',
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 260,
  },
  // PHASE-2 PREMIUM (T/D): cooldown pill mirrors tdToast — same dark-glass +
  // rose hairline so they feel like one design system. Live tick unchanged.
  cooldownToast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(15, 12, 30, 0.92)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(233, 69, 96, 0.32)',
    shadowColor: '#E94560',
    shadowOpacity: 0.30,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    zIndex: 50,
    gap: 6,
  },
  cooldownText: { color: '#F2F3F8', fontSize: 13, fontWeight: '500' },
  // PHASE-2 PREMIUM: transparent so the LinearGradient backdrop is visible
  // through the FlashList wrapper. Bubbles paint themselves; the surface
  // stays gradient-driven for the cohesive thread look.
  listWrap: { flex: 1, backgroundColor: 'transparent' },
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
  // PHASE-2 PREMIUM (T/D): deeper plum-tinted backdrop so the invite modal
  // sits inside the same midnight palette as the gradient surface.
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 6, 16, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  // PHASE-2 PREMIUM (T/D): "Send invite?" card — dark glass with a soft rose
  // hairline + glow. Replaces the previous solid white surface that looked
  // disconnected from the rest of the Phase-2 thread.
  inviteCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#22223A',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(233, 69, 96, 0.28)',
    padding: 22,
    alignItems: 'center',
    shadowColor: '#E94560',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  inviteIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E94560',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#E94560',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  inviteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F2F3F8',
    marginBottom: 6,
  },
  inviteSubtitle: {
    fontSize: 14,
    color: 'rgba(224, 224, 232, 0.72)',
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 20,
  },
  inviteRow: { flexDirection: 'row', gap: 12, width: '100%' },
  inviteBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // PHASE-2 PREMIUM (T/D): Cancel = neutral dark glass with a subtle white
  // border (no bright iOS grey). Send = rose with a soft glow to feel like
  // the primary action.
  inviteCancel: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  inviteCancelText: { color: '#F2F3F8', fontWeight: '600' },
  inviteSend: {
    backgroundColor: '#E94560',
    shadowColor: '#E94560',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  inviteSendText: { color: COLORS.white, fontWeight: '700', letterSpacing: 0.2 },
  inviteCardWrap: { width: '100%', maxWidth: 380, alignItems: 'center' },
  modalDismiss: { marginTop: 14, padding: 10 },
  modalDismissText: {
    color: 'rgba(224, 224, 232, 0.78)',
    fontSize: 14,
    fontWeight: '500',
  },
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
