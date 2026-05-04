/*
 * LOCKED (PHASE-2 PRIVATE CHATS SCREEN)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - P0 audit passed: backend connectivity verified, Phase isolation confirmed
 * - No local-only operations, all messages via Convex backend
 *
 * Backend source: privateConversations, privateConversationParticipants, privateMessages
 * Query: api.privateConversations.getUserPrivateConversations
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, ActivityIndicator, AppState, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS, COLORS, moderateScale } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { TodAvatar } from '@/components/truthdare/TodAvatar';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useAuthStore } from '@/stores/authStore';
import { textForPublicSurface } from '@/lib/contentFilter';
import { ReportModal } from '@/components/private/ReportModal';
import { Toast } from '@/components/ui/Toast';
import { getTimeAgo } from '@/lib/utils';
// P1-004 FIX: Removed DEMO_INCOGNITO_PROFILES - now using backend participantIntentKey
import { useScreenTrace } from '@/lib/devTrace';
// P2-002: Centralized blur helper
import { getAvatarBlurRadius } from '@/lib/phase2UI';
// P2-006: Connection source types
import type { ConnectionSource, IncognitoConversation } from '@/types';
// P2-INSTRUMENTATION: Sentry breadcrumbs for Phase-2 debugging
import { P2 } from '@/lib/p2Instrumentation';

const C = INCOGNITO_COLORS;
const NEW_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

type Phase2LastMessageType = 'text' | 'image' | 'video' | 'voice' | 'system';

type Phase2Conversation = IncognitoConversation & {
  hasRealMessages?: boolean;
  lastMessageSenderId?: string | null;
  lastMessageType?: Phase2LastMessageType | string | null;
  lastMessageIsProtected?: boolean;
};

type StandOutPreviewUser = {
  userId?: string;
  displayName?: string | null;
  age?: number | null;
  blurredPhotoUrl?: string | null;
  photoBlurEnabled?: boolean | null;
  photoBlurSlots?: boolean[] | null;
};

type IncomingStandOutRow = {
  likeId: string;
  fromUserId?: string;
  message?: string | null;
  createdAt: number;
  sender?: StandOutPreviewUser | null;
};

type OutgoingStandOutRow = {
  likeId: string;
  toUserId?: string;
  message?: string | null;
  createdAt: number;
  receiver?: StandOutPreviewUser | null;
};

const PREVIEW_MARKER_RE = /^\[(?:SYSTEM|INTERNAL|PRIVATE|MEDIA|PROTECTED|SECURE):[^\]]+\]/i;

const getPhase2ConversationPreview = (convo: Phase2Conversation): string => {
  const rawContent = typeof convo.lastMessage === 'string' ? convo.lastMessage.trim() : '';
  const markerMatch = rawContent.match(PREVIEW_MARKER_RE);
  const displayContent = markerMatch ? rawContent.slice(markerMatch[0].length).trim() : rawContent;
  const type = convo.lastMessageType;
  const sentByCurrentUser = !!convo.lastMessageSenderId && convo.lastMessageSenderId !== convo.participantId;
  const previewPrefix = sentByCurrentUser ? 'You: ' : '';

  if (convo.lastMessageIsProtected) {
    return `${previewPrefix}${type === 'video' ? 'Secure video' : 'Secure photo'}`;
  }
  if (type === 'image') return `${previewPrefix}Photo`;
  if (type === 'video') return `${previewPrefix}Video`;
  if (type === 'voice') return `${previewPrefix}Voice message`;

  if (type === 'system' || markerMatch) {
    return textForPublicSurface(displayContent).trim() || 'New message';
  }

  if (displayContent) {
    return `${previewPrefix}${textForPublicSurface(displayContent)}`;
  }

  return 'New message';
};

const getStandOutDisplayName = (user?: StandOutPreviewUser | null): string => {
  const name = user?.displayName?.trim();
  return name || 'Someone';
};

const getStandOutNameLine = (user?: StandOutPreviewUser | null): string => {
  const name = getStandOutDisplayName(user);
  return typeof user?.age === 'number' && user.age > 0 ? `${name}, ${user.age}` : name;
};

const getStandOutMessagePreview = (message?: string | null): string => {
  const safeMessage = textForPublicSurface(message?.trim() || '').trim();
  return safeMessage || 'Sent a Stand Out';
};

const shouldBlurStandOutPhoto = (user?: StandOutPreviewUser | null): boolean => {
  return user?.photoBlurEnabled === true && Array.isArray(user.photoBlurSlots) && user.photoBlurSlots[0] === true;
};

// Phase-2 connection sources mapped to icons
const connectionIcon = (source: string) => {
  switch (source) {
    case 'tod': return 'flame';
    case 'room': return 'chatbubbles';
    case 'desire': return 'heart';
    case 'desire_match': return 'heart';
    case 'desire_super_like': return 'star';
    case 'friend': return 'people';
    default: return 'chatbubble';
  }
};

// P2-006 FIX: Preserve specific connection source without collapsing
// This maintains desire_super_like vs desire_match distinction for UI badges
const normalizeConnectionSource = (source: string): ConnectionSource => {
  const validSources: ConnectionSource[] = ['tod', 'room', 'desire', 'desire_match', 'desire_super_like', 'friend'];
  if (validSources.includes(source as ConnectionSource)) {
    return source as ConnectionSource;
  }
  return 'desire'; // Default for unknown Phase-2 matches
};

// Check if connectionSource is a Phase-2 source
const isPhase2Source = (source: string): boolean => {
  return ['tod', 'room', 'desire', 'desire_match', 'desire_super_like'].includes(source);
};

const getTodConversationPhotoBlurMode = (
  isPhotoBlurred?: boolean,
  canViewClearPhoto?: boolean
): 'none' | 'blur' => {
  return isPhotoBlurred && canViewClearPhoto === false ? 'blur' : 'none';
};

const isTodConversationAnonymous = (
  participantName: string | undefined,
  participantPhotoUrl: string | undefined
): boolean => {
  return !participantPhotoUrl && participantName?.trim().toLowerCase() === 'anonymous';
};

/**
 * P1-004 FIX: Look up Phase-2 intent label for a participant.
 * @param intentKey - The privateIntentKey from backend userPrivateProfiles
 * @returns The human-readable label or null if not found
 */
const getIntentLabelFromKey = (intentKey: string | null | undefined): string | null => {
  if (!intentKey) return null;
  const category = PRIVATE_INTENT_CATEGORIES.find((c) => c.key === intentKey);
  return category?.label ?? (intentKey ? 'Other' : null);
};

// ═══════════════════════════════════════════════════════════════════════════
// PRESENCE: Online status calculation (Phase-1 parity)
// ═══════════════════════════════════════════════════════════════════════════
type OnlineStatus = 'online' | 'recently_active' | 'offline';

/**
 * Calculate online status from lastActive timestamp.
 * Matches Phase-1 behavior:
 * - < 1 min → Online (green dot)
 * - 1 min – 24h → Recently Active
 * - > 24h → Offline
 */
const getOnlineStatus = (lastActive: number | undefined): OnlineStatus => {
  if (!lastActive) return 'offline';
  const now = Date.now();
  const diff = now - lastActive;
  const ONE_MINUTE = 60 * 1000;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  if (diff < ONE_MINUTE) return 'online';
  if (diff < ONE_DAY) return 'recently_active';
  return 'offline';
};

const PRESENCE_HEARTBEAT_INTERVAL = 15000; // 15 seconds

/**
 * P2_THREAD_OPEN_GATE
 *
 * Hidden helper that subscribes to the same four Convex queries the Phase-2
 * thread (`chats/[id].tsx`) needs on first paint:
 *   - api.privateConversations.getPrivateConversation
 *   - api.privateConversations.getPrivateMessages
 *   - api.users.getUserById          (current user)
 *   - api.games.getBottleSpinSession (T/D pill)
 *
 * The Convex client shares a single subscription cache across the React tree.
 * By starting these subscriptions on the Messages tab BEFORE we navigate, the
 * thread route mounts with all four results already cached, which means its
 * `isInitialPayloadReady` gate is `true` on the very first render and the
 * dark loading shell is never shown. The user perceives one stable Messages
 * list → final thread, with no intermediate "thread mounted but waiting"
 * paint.
 *
 * Renders nothing. Calls `onReady()` exactly once when all four queries have
 * resolved (defined, not skip). The parent guarantees `conversationId` and
 * `userId` are non-empty before mounting this — so there's no `'skip'` arg
 * branch needed here.
 */
function Phase2ChatThreadPrefetcher({
  conversationId,
  userId,
  onReady,
}: {
  conversationId: string;
  userId: string;
  onReady: () => void;
}) {
  const conv = useQuery(api.privateConversations.getPrivateConversation, {
    conversationId: conversationId as any,
    authUserId: userId,
  });
  const msgs = useQuery(api.privateConversations.getPrivateMessages, {
    conversationId: conversationId as any,
    authUserId: userId,
    limit: 100,
  });
  const cu = useQuery(api.users.getUserById, {
    userId: userId as any,
    viewerId: userId as any,
  });
  const gs = useQuery(api.games.getBottleSpinSession, { conversationId });
  const ready =
    conv !== undefined &&
    msgs !== undefined &&
    cu !== undefined &&
    gs !== undefined;
  const firedRef = useRef(false);
  useEffect(() => {
    if (ready && !firedRef.current) {
      firedRef.current = true;
      onReady();
    }
  }, [ready, onReady]);
  return null;
}

export default function ChatsScreen() {
  useScreenTrace("P2_CHATS");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const conversations = usePrivateChatStore((s) => s.conversations);
  const messages = usePrivateChatStore((s) => s.messages);
  const blockUser = usePrivateChatStore((s) => s.blockUser);
  const reconcileConversations = usePrivateChatStore((s) => s.reconcileConversations);
  const pruneDeletedMessages = usePrivateChatStore((s) => s.pruneDeletedMessages);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string; conversationId: string } | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // P2_THREAD_OPEN_GATE
  // Track which conversation row the user just tapped. While `openingId` is
  // non-null we prefetch the thread payload (see Phase2ChatThreadPrefetcher
  // above) and only navigate once Convex has cached all four required
  // queries — guaranteeing the thread paints final UI on its first frame.
  // The failsafe timer ensures we never block the user for more than
  // OPENING_FAILSAFE_MS even if a query is unusually slow; in that
  // worst-case we fall back to the thread's own loading shell, which is
  // exactly the previous behavior.
  // ─────────────────────────────────────────────────────────────────────────
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (openingTimeoutRef.current) {
        clearTimeout(openingTimeoutRef.current);
        openingTimeoutRef.current = null;
      }
    };
  }, []);
  // Clear the opening state if the tab loses focus (e.g., user switched
  // tabs mid-tap) so a stale prefetcher doesn't trigger a delayed push.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (openingTimeoutRef.current) {
          clearTimeout(openingTimeoutRef.current);
          openingTimeoutRef.current = null;
        }
        setOpeningId(null);
      };
    }, [])
  );

  // P2-003: Error and retry state for queries
  const [retryKey, setRetryKey] = useState(0);
  const [hasQueryError, setHasQueryError] = useState(false);

  // Auth for queries and mutations
  const currentUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  // P0-AUTH-FIX: Wait for Convex auth identity to be ready before running queries
  // This prevents "No auth identity" errors during initial hydration
  const authReady = useAuthStore((s) => s.authReady);

  // P0-AUTH-CRASH-FIX: Simple gating - requires userId + authReady
  // Note: useConvexAuth was removed as it caused release crashes
  // The query will return undefined until auth is ready, which is handled gracefully
  const isAuthReadyForQueries = !!(currentUserId && authReady);

  // ─────────────────────────────────────────────────────────────────────────
  // P2_THREAD_OPEN_GATE: navigate + tap handler.
  // `OPENING_FAILSAFE_MS` is intentionally short — the goal is "warm cache"
  // not "artificial delay". In the typical case Convex returns all four
  // results in well under this budget and we navigate the moment the
  // prefetcher's `onReady` fires (usually <300ms). The failsafe only
  // matters on a cold connection or during a backend hiccup.
  // ─────────────────────────────────────────────────────────────────────────
  const OPENING_FAILSAFE_MS = 800;
  const navigateToThread = useCallback(
    (id: string) => {
      if (openingTimeoutRef.current) {
        clearTimeout(openingTimeoutRef.current);
        openingTimeoutRef.current = null;
      }
      setOpeningId(null);
      router.push({
        pathname: '/(main)/(private)/(tabs)/chats/[id]',
        params: { id: String(id) },
      } as any);
    },
    [router]
  );
  const handleOpenConversation = useCallback(
    (id: string) => {
      // Ignore taps on other rows while one open is in flight (single-flight).
      if (openingId) return;
      console.log('[P2_CHAT_OPEN] chat-row', id);
      // No userId yet (rare — auth hydrating) → fall through to immediate
      // navigation; the thread route's own loading shell will cover it.
      if (!currentUserId) {
        navigateToThread(id);
        return;
      }
      setOpeningId(id);
      openingTimeoutRef.current = setTimeout(() => {
        navigateToThread(id);
      }, OPENING_FAILSAFE_MS);
    },
    [openingId, currentUserId, navigateToThread]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // P2_LIKES: Incoming likes (people who liked current user, pending match)
  // P0-AUTH-CRASH-FIX: Gate queries AND add delayed auth confirmation
  // The query is skipped until auth is confirmed ready to prevent release crashes
  // ═══════════════════════════════════════════════════════════════════════════
  // P0-AUTH-CRASH-FIX: Use delayed auth confirmation to ensure Convex identity is synced
  // The Convex JWT (ctx.auth.getUserIdentity) takes longer to sync than Clerk token
  // Using 500ms delay to ensure identity is fully propagated before firing queries
  const [authConfirmed, setAuthConfirmed] = useState(false);
  useEffect(() => {
    if (isAuthReadyForQueries && !authConfirmed) {
      // Longer delay to ensure Convex identity (JWT) is fully propagated
      // Note: Clerk token (Zustand) syncs faster than Convex identity
      const timer = setTimeout(() => setAuthConfirmed(true), 500);
      return () => clearTimeout(timer);
    }
    if (!isAuthReadyForQueries) {
      setAuthConfirmed(false);
    }
  }, [isAuthReadyForQueries, authConfirmed]);

  // Final query gate - only fire after auth is fully confirmed
  const canRunQueries = isAuthReadyForQueries && authConfirmed;

  const incomingLikes = useQuery(
    api.privateSwipes.getIncomingLikes,
    canRunQueries && currentUserId ? { authUserId: currentUserId } : 'skip'
  );
  const incomingLikesCount = useQuery(
    api.privateSwipes.getIncomingLikesCount,
    canRunQueries && currentUserId ? { authUserId: currentUserId } : 'skip'
  );
  const incomingStandOutsResult = useQuery(
    api.privateSwipes.getIncomingStandOuts,
    canRunQueries && currentUserId ? { authUserId: currentUserId } : 'skip'
  );
  const outgoingStandOutsResult = useQuery(
    api.privateSwipes.getOutgoingStandOuts,
    canRunQueries && currentUserId ? { authUserId: currentUserId } : 'skip'
  );
  const standOutCounts = useQuery(
    api.privateSwipes.getStandOutCounts,
    canRunQueries && currentUserId ? { authUserId: currentUserId } : 'skip'
  );
  const acceptStandOutMutation = useMutation(api.privateSwipes.acceptStandOut);
  const replyToStandOutMutation = useMutation(api.privateSwipes.replyToStandOut);
  const ignoreStandOutMutation = useMutation(api.privateSwipes.ignoreStandOut);
  const [handledStandOutIds, setHandledStandOutIds] = useState<Set<string>>(() => new Set());
  const [activeStandOutAction, setActiveStandOutAction] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<IncomingStandOutRow | null>(null);
  const [replyText, setReplyText] = useState('');

  const incomingStandOuts = useMemo<IncomingStandOutRow[]>(() => {
    if (!Array.isArray(incomingStandOutsResult)) return [];
    return (incomingStandOutsResult as any[])
      .map((row) => ({ ...row, likeId: String(row.likeId) }) as IncomingStandOutRow)
      .filter((row) => !handledStandOutIds.has(row.likeId));
  }, [handledStandOutIds, incomingStandOutsResult]);

  const outgoingStandOuts = useMemo<OutgoingStandOutRow[]>(() => {
    if (!Array.isArray(outgoingStandOutsResult)) return [];
    return (outgoingStandOutsResult as any[])
      .map((row) => ({ ...row, likeId: String(row.likeId) }) as OutgoingStandOutRow)
      .filter((row) => !handledStandOutIds.has(row.likeId));
  }, [handledStandOutIds, outgoingStandOutsResult]);

  const markStandOutHandled = useCallback((likeId: string) => {
    setHandledStandOutIds((prev) => {
      const next = new Set(prev);
      next.add(likeId);
      return next;
    });
  }, []);

  // Log incoming likes count
  useEffect(() => {
    if (__DEV__ && incomingLikes !== undefined) {
      console.log('[P2_FRONTEND_LIKES]', {
        count: incomingLikes.length,
        likes: incomingLikes.map(l => ({ from: l.fromUserId?.slice(-8), action: l.action }))
      });
    }
  }, [incomingLikes]);

  const getStandOutActionError = useCallback((error: unknown) => {
    const message = String((error as any)?.message ?? error ?? '');
    if (/already|handled|not found|no longer|blocked|available/i.test(message)) {
      return 'This Stand Out is no longer available. It may already have been handled.';
    }
    return message || 'Something went wrong. Please try again.';
  }, []);

  const handleAcceptStandOut = useCallback(async (request: IncomingStandOutRow) => {
    if (!currentUserId || activeStandOutAction) return;
    const actionKey = `accept:${request.likeId}`;
    setActiveStandOutAction(actionKey);
    try {
      const result = await acceptStandOutMutation({
        authUserId: currentUserId,
        likeId: request.likeId as any,
      });
      markStandOutHandled(request.likeId);
      const conversationId = (result as any)?.conversationId;
      if (conversationId) {
        handleOpenConversation(String(conversationId));
      } else {
        Toast.show('Stand Out accepted');
      }
    } catch (error) {
      Alert.alert('Could not accept', getStandOutActionError(error));
    } finally {
      setActiveStandOutAction(null);
    }
  }, [
    acceptStandOutMutation,
    activeStandOutAction,
    currentUserId,
    getStandOutActionError,
    handleOpenConversation,
    markStandOutHandled,
  ]);

  const handleIgnoreStandOut = useCallback(async (request: IncomingStandOutRow) => {
    if (!currentUserId || activeStandOutAction) return;
    const actionKey = `ignore:${request.likeId}`;
    setActiveStandOutAction(actionKey);
    try {
      await ignoreStandOutMutation({
        authUserId: currentUserId,
        likeId: request.likeId as any,
      });
      markStandOutHandled(request.likeId);
      Toast.show('Request ignored');
    } catch (error) {
      Alert.alert('Could not ignore', getStandOutActionError(error));
    } finally {
      setActiveStandOutAction(null);
    }
  }, [
    activeStandOutAction,
    currentUserId,
    getStandOutActionError,
    ignoreStandOutMutation,
    markStandOutHandled,
  ]);

  const openReplyComposer = useCallback((request: IncomingStandOutRow) => {
    if (activeStandOutAction) return;
    setReplyText('');
    setReplyTarget(request);
  }, [activeStandOutAction]);

  const closeReplyComposer = useCallback(() => {
    if (activeStandOutAction?.startsWith('reply:')) return;
    setReplyTarget(null);
    setReplyText('');
  }, [activeStandOutAction]);

  const handleSubmitStandOutReply = useCallback(async () => {
    if (!currentUserId || !replyTarget || activeStandOutAction) return;
    const trimmedReply = replyText.trim();
    if (!trimmedReply) {
      Alert.alert('Reply required', 'Write a short reply to accept this Stand Out.');
      return;
    }

    const actionKey = `reply:${replyTarget.likeId}`;
    setActiveStandOutAction(actionKey);
    try {
      const result = await replyToStandOutMutation({
        authUserId: currentUserId,
        likeId: replyTarget.likeId as any,
        replyText: trimmedReply,
      });
      markStandOutHandled(replyTarget.likeId);
      setReplyTarget(null);
      setReplyText('');
      const conversationId = (result as any)?.conversationId;
      if (conversationId) {
        handleOpenConversation(String(conversationId));
      } else {
        Toast.show('Reply sent');
      }
    } catch (error) {
      Alert.alert('Could not reply', getStandOutActionError(error));
    } finally {
      setActiveStandOutAction(null);
    }
  }, [
    activeStandOutAction,
    currentUserId,
    getStandOutActionError,
    handleOpenConversation,
    markStandOutHandled,
    replyTarget,
    replyText,
    replyToStandOutMutation,
  ]);

  const handleOutgoingStandOutPress = useCallback(() => {
    Toast.show('Waiting for their response');
  }, []);

  // Note: Likes modal removed - now uses dedicated page at /(main)/(private)/phase2-likes

  // ═══════════════════════════════════════════════════════════════════════════
  // DELIVERED-TICK-FIX: Mark ALL messages as delivered REACTIVELY
  // ROOT CAUSE FIX: Previous code only ran ONCE on mount, missing new messages
  // NOW: Runs on every focus AND when conversation list has unread messages
  // ═══════════════════════════════════════════════════════════════════════════
  const markAllDeliveredMutation = useMutation(api.privateConversations.markAllPrivateMessagesDelivered);

  // FIX: Use useFocusEffect to mark delivered every time tab gains focus
  useFocusEffect(
    useCallback(() => {
      if (!currentUserId) return;

      // P2-INSTRUMENTATION: Bulk deliver on tab focus
      // CONTRACT FIX: Use authUserId instead of token
      if (__DEV__) console.log('[P2_MSG_DELIVER] Tab focused, marking all delivered');
      P2.messages.deliverRequested('bulk-focus');
      markAllDeliveredMutation({ authUserId: currentUserId })
        .then((result) => {
          const count = (result as any)?.count || 0;
          if (__DEV__) console.log('[P2_MSG_DELIVER] Bulk delivered count:', count);
          P2.messages.deliverSuccess('bulk-focus', count);
        })
        .catch((err) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[Phase2Chats] Failed to mark all messages delivered:', err);
          }
        });
    }, [currentUserId, markAllDeliveredMutation])
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PRESENCE: Heartbeat to update lastActive timestamp (Phase-2 isolated)
  // FIX: Use ref guards to prevent duplicate intervals and memory leaks
  // ═══════════════════════════════════════════════════════════════════════════
  const updatePresenceMutation = useMutation(api.privateConversations.updatePresence);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHeartbeatActiveRef = useRef(false);

  // Update presence on mount and start heartbeat
  useFocusEffect(
    useCallback(() => {
      if (!currentUserId) return;

      // FIX: Prevent duplicate intervals using ref guard
      if (isHeartbeatActiveRef.current) {
        return;
      }
      isHeartbeatActiveRef.current = true;

      // P2-INSTRUMENTATION: Messages list focused
      P2.presence.chatFocused('messages-list', currentUserId);
      P2.presence.heartbeatStarted(currentUserId, PRESENCE_HEARTBEAT_INTERVAL);

      // Update presence immediately on focus
      P2.presence.mutationRequested(currentUserId);
      updatePresenceMutation({ authUserId: currentUserId })
        .then(() => P2.presence.mutationSuccess(currentUserId))
        .catch(() => {});

      // FIX: Clear any existing interval before creating new one
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      // Start heartbeat interval (only ONE)
      heartbeatRef.current = setInterval(() => {
        P2.presence.heartbeatTick(currentUserId);
        P2.presence.mutationRequested(currentUserId);
        updatePresenceMutation({ authUserId: currentUserId })
          .then(() => P2.presence.mutationSuccess(currentUserId))
          .catch(() => {});
      }, PRESENCE_HEARTBEAT_INTERVAL);

      // Cleanup on blur
      return () => {
        P2.presence.heartbeatStopped(currentUserId);
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        isHeartbeatActiveRef.current = false;
      };
    }, [currentUserId, updatePresenceMutation])
  );

  // Update presence when app comes to foreground
  useEffect(() => {
    if (!currentUserId) return;

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        updatePresenceMutation({ authUserId: currentUserId }).catch(() => {});
      }
    });

    return () => subscription.remove();
  }, [currentUserId, updatePresenceMutation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002 FIX: Backend conversations from Phase-2 privateConversations table
  // P0-AUTH-FIX: Gate on isAuthReadyForQueries to prevent early query errors
  // ═══════════════════════════════════════════════════════════════════════════
  // Note: retryKey is tracked locally but not passed to query (forces React to re-render)
  // P0-AUTH-CRASH-FIX: Gate on canRunQueries to prevent early query errors
  const backendConversations = useQuery(
    api.privateConversations.getUserPrivateConversations,
    canRunQueries ? { authUserId: currentUserId } : 'skip'
  );

  // P2-INSTRUMENTATION: Track conversation list sync
  useEffect(() => {
    if (backendConversations) {
      P2.messages.listSynced(backendConversations.length);
    }
  }, [backendConversations]);

  // ═══════════════════════════════════════════════════════════════════════════
  // REALTIME-DELIVERY-FIX: Mark messages delivered when subscription updates
  // ROOT CAUSE FIX: Delivery wasn't happening when messages arrived in background
  // NOW: Triggers delivery whenever conversation list shows new unread messages
  // ═══════════════════════════════════════════════════════════════════════════
  const lastUnreadHashRef = useRef<string>('');
  useEffect(() => {
    if (!backendConversations || !token) return;

    // Calculate hash of unread messages across all conversations
    const unreadHash = backendConversations
      .filter((c) => (c.unreadCount || 0) > 0)
      .map((c) => `${c.id}:${c.unreadCount}`)
      .join('|');

    // If unread hash changed (new messages arrived), mark them as delivered
    // CONTRACT FIX: Use authUserId instead of token
    if (unreadHash && unreadHash !== lastUnreadHashRef.current && currentUserId) {
      if (__DEV__) console.log('[P2_MSG_DELIVER] Subscription detected new unread, marking delivered');
      P2.messages.deliverRequested('subscription-update');
      markAllDeliveredMutation({ authUserId: currentUserId })
        .then((result) => {
          const count = (result as any)?.count || 0;
          if (__DEV__) console.log('[P2_MSG_DELIVER] Reactive delivered count:', count);
          P2.messages.deliverSuccess('subscription-update', count);
        })
        .catch(() => {});
    }
    lastUnreadHashRef.current = unreadHash;
  }, [backendConversations, currentUserId, markAllDeliveredMutation]);

  // P2-003: Error detection - timeout after 10s of loading
  const isQueryLoading = backendConversations === undefined && !hasQueryError;

  // FIX: Use functional update to clear error without needing hasQueryError in deps
  // This prevents potential re-render cycles from deps including state we're updating
  useEffect(() => {
    if (backendConversations !== undefined) {
      // Clear error state using functional update (only changes if currently true)
      setHasQueryError((prev) => (prev ? false : prev));
      return;
    }

    // P2-PARITY: 10s timeout (matches Phase 1 for faster feedback)
    const timeout = setTimeout(() => {
      setHasQueryError(true);
      if (__DEV__) {
        console.warn('[P2_CHATS] Query timeout - showing error state');
      }
    }, 10000);

    return () => clearTimeout(timeout);
  }, [backendConversations, retryKey]);

  // P2-003: Retry handler
  const handleRetryQuery = useCallback(() => {
    setHasQueryError(false);
    setRetryKey((k) => k + 1);
  }, []);

  // P1-003 FIX: Bidirectional sync from Phase-2 backend to local store
  // Reconciles additions, updates, AND removals (unmatch/block/delete)
  // FIX: Memoize normalizedBackend to prevent unnecessary reconciliation calls
  const normalizedBackend = useMemo(() => {
    if (!backendConversations) return null;

    return backendConversations
      .filter((bc) => isPhase2Source(bc.connectionSource as string))
      .map((bc) => {
        const source = bc.connectionSource as string;
        return {
          id: bc.id as string,
          participantId: bc.participantId as string,
          // ANON-LOADING-FIX: backend may now return null when displayName +
          // handle are both missing. Coerce to '' so IncognitoConversation
          // typing (string) is preserved; the row renderer treats '' as a
          // missing-name placeholder and shows a skeleton — never "Anonymous".
          participantName: bc.participantName ?? '',
          participantAge: bc.participantAge || 0,
          participantPhotoUrl: bc.participantPhotoUrl || '',
          // P1-004 FIX: Include participantIntentKey from backend for intent label lookup
          participantIntentKey: (bc as any).participantIntentKey ?? null,
          // PRESENCE: Include lastActive for online status display
          participantLastActive: (bc as any).participantLastActive ?? 0,
          lastMessage: bc.lastMessage || 'Say hi!',
          lastMessageAt: bc.lastMessageAt,
          lastMessageSenderId: (bc as any).lastMessageSenderId ?? null,
          lastMessageType: (bc as any).lastMessageType ?? null,
          lastMessageIsProtected: (bc as any).lastMessageIsProtected === true,
          hasRealMessages: (bc as any).hasRealMessages === true,
          unreadCount: bc.unreadCount,
          connectionSource: normalizeConnectionSource(source),
          // Preserve super_like info for UI badges
          matchSource: source === 'desire_super_like' ? 'super_like' as const : undefined,
          // PHOTO-BLUR-FIX: Include blur flags from backend for consistent photo display
          isPhotoBlurred: (bc as any).isPhotoBlurred ?? false,
          canViewClearPhoto: (bc as any).canViewClearPhoto ?? true,
        };
      }) as import('@/types').IncognitoConversation[];
  }, [backendConversations]);

  useEffect(() => {
    // Handle empty backend gracefully - reconcile with empty array to clear stale local data
    if (!normalizedBackend) return;

    // Single reconciliation pass: add/update/remove
    // NOTE: reconcileConversations is a stable Zustand store function, not in deps
    reconcileConversations(normalizedBackend);
  }, [normalizedBackend, reconcileConversations]);

  // Auto-cleanup: Prune expired messages when entering Phase-2 messages tab
  useEffect(() => {
    pruneDeletedMessages();
  }, [pruneDeletedMessages]);

  // Debug log for Phase 2 Messages
  useEffect(() => {
    if (__DEV__) {
      console.log('[Phase2Messages] conversations=', conversations.length, conversations.map(c => c.id));
    }
  }, [conversations]);

  const hasRealMessagesByConversationId = useMemo(() => {
    if (!normalizedBackend) return null;

    return new Map(
      normalizedBackend.map((convo) => [convo.id, (convo as any).hasRealMessages === true])
    );
  }, [normalizedBackend]);

  const previewMetadataByConversationId = useMemo(() => {
    if (!normalizedBackend) return null;

    return new Map(
      normalizedBackend.map((convo) => [
        convo.id,
        {
          lastMessageSenderId: (convo as any).lastMessageSenderId ?? null,
          lastMessageType: (convo as any).lastMessageType ?? null,
          lastMessageIsProtected: (convo as any).lastMessageIsProtected === true,
        },
      ])
    );
  }, [normalizedBackend]);

  // Separate conversations into "new matches" (no real messages) and "message threads" (has real messages)
  // BUG-3 FIX: Use backend real-message state instead of placeholder display text
  const { newMatches, messageThreads } = useMemo(() => {
    const newM: typeof conversations = [];
    const threads: typeof conversations = [];

    conversations.forEach((convo) => {
      const hasRealMessages =
        hasRealMessagesByConversationId?.get(convo.id) ?? (convo as any).hasRealMessages === true;

      if (hasRealMessages) {
        threads.push(convo);
      } else {
        newM.push(convo);
      }
    });

    // Sort new matches by most recent first
    newM.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    // Sort threads by most recent activity
    threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    return { newMatches: newM, messageThreads: threads };
  }, [conversations, hasRealMessagesByConversationId]);

  const renderStandOutAvatar = (
    user: StandOutPreviewUser | null | undefined,
    sizeStyle: 'request' | 'sent' = 'request'
  ) => {
    const name = getStandOutDisplayName(user);
    const style = sizeStyle === 'sent' ? styles.standOutSentAvatar : styles.standOutRequestAvatar;
    if (user?.blurredPhotoUrl) {
      return (
        <Image
          source={{ uri: user.blurredPhotoUrl }}
          style={style}
          contentFit="cover"
          blurRadius={shouldBlurStandOutPhoto(user) ? 10 : 0}
        />
      );
    }

    return (
      <View style={[style, styles.standOutAvatarFallback]}>
        <Text style={styles.standOutAvatarInitial}>{name[0] || '?'}</Text>
      </View>
    );
  };

  const renderIncomingStandOutRequests = () => {
    if (incomingStandOuts.length === 0) return null;
    const sectionCount = handledStandOutIds.size > 0
      ? incomingStandOuts.length
      : standOutCounts?.incoming ?? incomingStandOuts.length;

    return (
      <View style={styles.standOutSection}>
        <View style={styles.standOutSectionHeader}>
          <View style={styles.standOutHeaderLeft}>
            <View style={styles.standOutIconWrap}>
              <Ionicons name="star" size={13} color="#FFFFFF" />
            </View>
            <Text style={styles.standOutSectionTitle}>Stand Out Requests ({sectionCount})</Text>
          </View>
        </View>

        {incomingStandOuts.map((request) => {
          const sender = request.sender ?? null;
          const acceptKey = `accept:${request.likeId}`;
          const replyKey = `reply:${request.likeId}`;
          const ignoreKey = `ignore:${request.likeId}`;
          const isAnyActionActive = !!activeStandOutAction;
          const isAccepting = activeStandOutAction === acceptKey;
          const isReplying = activeStandOutAction === replyKey;
          const isIgnoring = activeStandOutAction === ignoreKey;

          return (
            <View key={request.likeId} style={styles.standOutRequestCard}>
              <View style={styles.standOutRequestTop}>
                <View style={styles.standOutAvatarWrap}>
                  {renderStandOutAvatar(sender)}
                  <View style={styles.standOutStarBadge}>
                    <Ionicons name="star" size={9} color="#FFFFFF" />
                  </View>
                </View>
                <View style={styles.standOutRequestCopy}>
                  <View style={styles.standOutNameRow}>
                    <Text style={styles.standOutName} numberOfLines={1}>
                      {getStandOutNameLine(sender)}
                    </Text>
                    <View style={styles.standOutBadge}>
                      <Text style={styles.standOutBadgeText}>Stand Out</Text>
                    </View>
                  </View>
                  <Text style={styles.standOutMessage} numberOfLines={2}>
                    {getStandOutMessagePreview(request.message)}
                  </Text>
                </View>
              </View>

              <View style={styles.standOutActions}>
                <TouchableOpacity
                  style={[styles.standOutActionButton, styles.standOutReplyButton]}
                  disabled={isAnyActionActive}
                  onPress={() => openReplyComposer(request)}
                  activeOpacity={0.8}
                >
                  {isReplying ? (
                    <ActivityIndicator size="small" color={COLORS.superLike} />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color={COLORS.superLike} />
                      <Text style={styles.standOutReplyText}>Reply</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.standOutActionButton, styles.standOutAcceptButton]}
                  disabled={isAnyActionActive}
                  onPress={() => handleAcceptStandOut(request)}
                  activeOpacity={0.85}
                >
                  {isAccepting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.standOutAcceptText}>Accept</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.standOutActionButton, styles.standOutIgnoreButton]}
                  disabled={isAnyActionActive}
                  onPress={() => handleIgnoreStandOut(request)}
                  activeOpacity={0.75}
                >
                  {isIgnoring ? (
                    <ActivityIndicator size="small" color={C.textLight} />
                  ) : (
                    <Text style={styles.standOutIgnoreText}>Ignore</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderOutgoingStandOutsSent = () => {
    if (outgoingStandOuts.length === 0) return null;
    const sectionCount = handledStandOutIds.size > 0
      ? outgoingStandOuts.length
      : standOutCounts?.outgoing ?? outgoingStandOuts.length;

    return (
      <View style={styles.standOutSentSection}>
        <View style={styles.standOutSectionHeader}>
          <View style={styles.standOutHeaderLeft}>
            <View style={[styles.standOutIconWrap, styles.standOutSentIcon]}>
              <Ionicons name="paper-plane" size={12} color="#FFFFFF" />
            </View>
            <Text style={styles.standOutSectionTitle}>Stand Outs Sent ({sectionCount})</Text>
          </View>
        </View>

        {outgoingStandOuts.map((sent) => {
          const receiver = sent.receiver ?? null;
          return (
            <TouchableOpacity
              key={sent.likeId}
              style={styles.standOutSentCard}
              activeOpacity={0.82}
              onPress={handleOutgoingStandOutPress}
            >
              <View style={styles.standOutAvatarWrap}>
                {renderStandOutAvatar(receiver, 'sent')}
              </View>
              <View style={styles.standOutSentCopy}>
                <View style={styles.standOutNameRow}>
                  <Text style={styles.standOutName} numberOfLines={1}>
                    {getStandOutNameLine(receiver)}
                  </Text>
                  <View style={styles.standOutPendingBadge}>
                    <Text style={styles.standOutPendingText}>Pending</Text>
                  </View>
                </View>
                <Text style={styles.standOutSentMessage} numberOfLines={1}>
                  {getStandOutMessagePreview(sent.message)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // New Matches row - Phase-2 style (blurred avatars, tap → profile preview)
  const renderNewMatchesRow = () => {
    if (newMatches.length === 0) return null;

    return (
      <View style={styles.newMatchesSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="heart-circle" size={18} color={C.primary} />
          <Text style={styles.sectionTitle}>New Matches</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{newMatches.length}</Text>
          </View>
        </View>
        <FlatList
          horizontal
          data={newMatches}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            // Check if this match originated from a super like
            const isSuperLike = item.matchSource === 'super_like';
            // Check if this is a T/D connection
            const isTodConnect = item.connectionSource === 'tod';
            // Check if this is a recent connection (within 24 hours)
            const isRecentConnect = Date.now() - item.lastMessageAt < NEW_MATCH_WINDOW_MS;
            return (
              <TouchableOpacity
                style={styles.matchItem}
                activeOpacity={0.7}
                // P2_THREAD_OPEN_GATE: route through the prefetch handler so
                // the thread mounts with all four queries already cached;
                // see Phase2ChatThreadPrefetcher above.
                disabled={!!openingId && openingId !== String(item.id)}
                onPress={() => handleOpenConversation(String(item.id))}
              >
                <View pointerEvents="none" style={{ alignItems: 'center' }}>
                <View style={styles.matchAvatarContainer}>
                  {/* P2_THREAD_OPEN_GATE: row-level opening spinner — replaces
                      the NEW chip while the thread payload is being prefetched
                      so the user has clear feedback that their tap was received. */}
                  {openingId === String(item.id) ? (
                    <View style={styles.newConnectionBadge}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    </View>
                  ) : isRecentConnect ? (
                    <View style={styles.newConnectionBadge}>
                      <Text style={styles.newConnectionText}>NEW</Text>
                    </View>
                  ) : null}
                  <View style={[
                    styles.matchRing,
                    isSuperLike && { borderColor: COLORS.superLike, borderWidth: 3 },
                    isTodConnect && !isSuperLike && { borderColor: '#FF7849', borderWidth: 3 }
                  ]}>
                    {isTodConnect ? (
                      <TodAvatar
                        size={58}
                        photoUrl={item.participantPhotoUrl || null}
                        isAnonymous={isTodConversationAnonymous(
                          item.participantName,
                          item.participantPhotoUrl
                        )}
                        photoBlurMode={getTodConversationPhotoBlurMode(
                          item.isPhotoBlurred,
                          item.canViewClearPhoto
                        )}
                        label={item.participantName}
                        style={styles.matchAvatar}
                        backgroundColor={C.surface}
                        textColor={C.text}
                        iconColor={C.textLight}
                      />
                    ) : item.participantPhotoUrl ? (
                      <Image
                        source={{ uri: item.participantPhotoUrl }}
                        style={styles.matchAvatar}
                        contentFit="cover"
                        // PHOTO-BLUR-FIX: Use consistent blur based on backend flags
                        blurRadius={getAvatarBlurRadius({
                          isPhotoBlurred: item.isPhotoBlurred,
                          canViewClearPhoto: item.canViewClearPhoto,
                        })}
                      />
                    ) : (
                      <View style={[styles.matchAvatar, styles.placeholderAvatar]}>
                        <Text style={styles.avatarInitial}>{item.participantName?.[0] || '?'}</Text>
                      </View>
                    )}
                  </View>
                  {isSuperLike ? (
                    <View style={styles.superLikeStarBadge}>
                      <Ionicons name="star" size={10} color="#FFFFFF" />
                    </View>
                  ) : isTodConnect ? (
                    <View style={styles.todFlameBadge}>
                      <Ionicons name="flame" size={10} color="#FFFFFF" />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.matchName} numberOfLines={1} ellipsizeMode="tail">{item.participantName}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.matchesList}
        />
      </View>
    );
  };

  const hasStandOutContent = incomingStandOuts.length > 0 || outgoingStandOuts.length > 0;

  return (
    <LinearGradient
      // PHASE-2 PREMIUM: matches the thread (chats/[id].tsx) gradient so the
      // tab → list → thread → tab transition stays cohesive.
      colors={['#101426', '#1A1633', '#16213E']}
      locations={[0, 0.55, 1]}
      style={[styles.container, styles.gradientContainer, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        {/* Likes button with badge - navigates to Phase-2 likes page */}
        <TouchableOpacity
          style={styles.likesButton}
          onPress={() => router.push('/(main)/(private)/phase2-likes' as any)}
        >
          {(() => {
            const hasIncomingLikes = (incomingLikesCount ?? 0) > 0;
            return (
              <>
                <Ionicons
                  name="heart"
                  size={24}
                  color={hasIncomingLikes ? C.primary : C.textLight}
                />
                {hasIncomingLikes && (
                  <View style={styles.likesBadge}>
                    <Text style={styles.likesBadgeText}>
                      {incomingLikesCount! > 99 ? '99+' : incomingLikesCount}
                    </Text>
                  </View>
                )}
              </>
            );
          })()}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="always"
      >
        {/* P2-003: Loading state */}
        {isQueryLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.loadingText}>Loading messages...</Text>
          </View>
        )}

        {/* P2-003: Error state with retry */}
        {hasQueryError && (
          <View style={styles.errorContainer}>
            <Ionicons name="cloud-offline-outline" size={64} color={C.textLight} />
            <Text style={styles.errorTitle}>Couldn't load messages</Text>
            <Text style={styles.errorSubtitle}>
              Please check your connection and try again
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRetryQuery}>
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Content - only show when not loading and no error */}
        {!isQueryLoading && !hasQueryError && (
          <>
            {/* Stand Out requests stay pending here until accepted/replied */}
            {renderIncomingStandOutRequests()}
            {renderOutgoingStandOutsSent()}

            {/* New Matches Row */}
            {renderNewMatchesRow()}

            {/* Messages section header (only show if we have both new matches and threads) */}
            {newMatches.length > 0 && messageThreads.length > 0 && (
              <View style={styles.threadsSectionHeader}>
                <Text style={styles.sectionTitle}>Messages</Text>
              </View>
            )}

            {/* Empty state - only show if NO conversations or pending Stand Outs */}
            {conversations.length === 0 && !hasStandOutContent ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="lock-open-outline" size={64} color={C.textLight} />
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            {/* P1-003 FIX: Updated copy to mention Deep Connect */}
            <Text style={styles.emptySubtitle}>Match in Deep Connect, play Truth or Dare, or connect in a Room to start chatting</Text>
          </View>
        ) : (
          /* Message threads */
          messageThreads.map((convo) => {
            // PRESENCE: Calculate online status for green dot indicator
            const onlineStatus = getOnlineStatus((convo as any).participantLastActive);
            const previewConvo = {
              ...convo,
              ...(previewMetadataByConversationId?.get(convo.id) ?? {}),
            } as Phase2Conversation;
            const isOpeningThisRow = openingId === String(convo.id);
            return (
              <TouchableOpacity
                key={convo.id}
                style={styles.chatRow}
                disabled={!!openingId && !isOpeningThisRow}
                onPress={() => handleOpenConversation(String(convo.id))}
                onLongPress={() => setReportTarget({ id: convo.participantId, name: convo.participantName, conversationId: convo.id })}
                activeOpacity={0.8}
              >
                <View
                  pointerEvents="none"
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                >
                {/* CLEAN UI: Profile photo only (no extra badges/icons) */}
                <View style={styles.chatAvatarWrap}>
                  <View style={styles.chatAvatarRing}>
                    {convo.connectionSource === 'tod' ? (
                      <TodAvatar
                        size={46}
                        photoUrl={convo.participantPhotoUrl || null}
                        isAnonymous={isTodConversationAnonymous(
                          convo.participantName,
                          convo.participantPhotoUrl
                        )}
                        photoBlurMode={getTodConversationPhotoBlurMode(
                          convo.isPhotoBlurred,
                          convo.canViewClearPhoto
                        )}
                        label={convo.participantName}
                        style={styles.chatAvatar}
                        backgroundColor={C.accent}
                        textColor={C.text}
                        iconColor={C.textLight}
                      />
                    ) : convo.participantPhotoUrl ? (
                      // PHOTO-BLUR-FIX: Use consistent blur based on backend flags
                      <Image
                        source={{ uri: convo.participantPhotoUrl }}
                        style={styles.chatAvatar}
                        blurRadius={getAvatarBlurRadius({
                          isPhotoBlurred: convo.isPhotoBlurred,
                          canViewClearPhoto: convo.canViewClearPhoto,
                        })}
                      />
                    ) : (
                      <View style={[styles.chatAvatar, styles.placeholderChatAvatar]}>
                        {/* ANON-LOADING-FIX: treat missing/legacy "Anonymous"
                            string as unknown — show '?' rather than 'A'. */}
                        <Text style={styles.chatAvatarInitial}>{(() => {
                          const n = (convo.participantName ?? '').trim();
                          if (!n || n.toLowerCase() === 'anonymous') return '?';
                          return n[0];
                        })()}</Text>
                      </View>
                    )}
                  </View>
                  {/* PRESENCE: Online indicator (green dot) - kept for essential status */}
                  {onlineStatus === 'online' && (
                    <View style={styles.onlineDot} />
                  )}
                </View>
                {/* CLEAN UI: Name, Last message, Time only (no "Active" text, no intent labels) */}
                <View style={styles.chatInfo}>
                  <View style={styles.chatNameRow}>
                    {/* ANON-LOADING-FIX: never render the literal "Anonymous"
                        as the row name during loading. Show a skeleton bar
                        instead so identity stays stable across hydration.
                        Intentional TOD anonymous rows are handled by the
                        TodAvatar branch above (which preserves the existing
                        isTodConversationAnonymous flow). */}
                    {(() => {
                      const n = (convo.participantName ?? '').trim();
                      const isUnknown = !n || n.toLowerCase() === 'anonymous';
                      return isUnknown ? (
                        <View
                          style={{
                            width: 110,
                            height: 14,
                            borderRadius: 4,
                            backgroundColor: C.accent,
                          }}
                        />
                      ) : (
                        <Text style={styles.chatName}>{n}</Text>
                      );
                    })()}
                    <Text style={styles.chatTime}>{getTimeAgo(convo.lastMessageAt)}</Text>
                  </View>
                  <Text style={styles.chatLastMsg} numberOfLines={1}>{getPhase2ConversationPreview(previewConvo)}</Text>
                </View>
                {isOpeningThisRow ? (
                  <View style={styles.unreadBadge}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  </View>
                ) : convo.unreadCount > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{convo.unreadCount}</Text>
                  </View>
                ) : null}
                </View>
              </TouchableOpacity>
            );
          })
        )}
          </>
        )}
      </ScrollView>

      {/*
       * P2_THREAD_PREFETCH_GATE:
       * When the user taps a row, we set `openingId` and mount this hidden
       * helper. It subscribes (via Convex's shared `useQuery` cache) to the
       * exact 4 queries the thread screen needs: conversation, messages,
       * current user, and bottle-spin session. As soon as all four resolve
       * to a defined value, `onReady` fires and we navigate. Because the
       * thread screen will then mount with those subscriptions already warm,
       * its own `isInitialPayloadReady` gate flips on the first render and
       * the loading shell never shows. A failsafe timer (OPENING_FAILSAFE_MS)
       * navigates anyway if the warm-up is unexpectedly slow, so the user
       * is never blocked.
       */}
      {openingId && currentUserId ? (
        <Phase2ChatThreadPrefetcher
          conversationId={openingId}
          userId={currentUserId}
          onReady={() => navigateToThread(openingId)}
        />
      ) : null}

      <Modal
        transparent
        visible={!!replyTarget}
        animationType="fade"
        onRequestClose={closeReplyComposer}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.replyModalOverlay}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeReplyComposer}
          />
          <View style={styles.replySheet}>
            <View style={styles.replySheetHandle} />
            <View style={styles.replySheetHeader}>
              <View style={styles.standOutIconWrap}>
                <Ionicons name="star" size={13} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.replySheetTitle}>Reply to Stand Out</Text>
                <Text style={styles.replySheetSubtitle} numberOfLines={1}>
                  {replyTarget ? getStandOutNameLine(replyTarget.sender) : ''}
                </Text>
              </View>
            </View>
            {replyTarget && (
              <Text style={styles.replyOriginalMessage} numberOfLines={2}>
                {getStandOutMessagePreview(replyTarget.message)}
              </Text>
            )}
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Write a short reply..."
              placeholderTextColor={C.textLight}
              style={styles.replyInput}
              multiline
              maxLength={500}
              editable={!activeStandOutAction?.startsWith('reply:')}
              textAlignVertical="top"
            />
            <View style={styles.replySheetActions}>
              <TouchableOpacity
                style={styles.replyCancelButton}
                onPress={closeReplyComposer}
                disabled={activeStandOutAction?.startsWith('reply:')}
              >
                <Text style={styles.replyCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.replySendButton}
                onPress={handleSubmitStandOutReply}
                disabled={activeStandOutAction?.startsWith('reply:')}
              >
                {activeStandOutAction?.startsWith('reply:') ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.replySendText}>Send Reply</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {reportTarget && (
        <ReportModal
          visible
          targetName={reportTarget.name}
          targetUserId={reportTarget.id}
          authToken={token || undefined}
          conversationId={reportTarget.conversationId}
          onClose={() => setReportTarget(null)}
          onBlockSuccess={() => setReportTarget(null)}
          onLeaveSuccess={() => setReportTarget(null)}
        />
      )}

      {/* Note: Incoming Likes Modal removed - now uses dedicated page */}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  // PHASE-2 PREMIUM: appended to the LinearGradient style array to clear the
  // solid backgroundColor inherited from `container`, letting the gradient
  // paint the full surface.
  gradientContainer: { backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text, flex: 1, marginLeft: 10 },
  listContent: { paddingBottom: 16 },
  // P2-003: Loading state styles
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: C.textLight,
  },
  // P2-003: Error state styles
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 60,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    marginTop: 16,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontSize: 13, color: C.textLight, textAlign: 'center' },

  // ── New Matches Section ──
  newMatchesSection: {
    marginTop: 20,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    marginBottom: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.primary + '15',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  countBadge: {
    backgroundColor: C.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.primary,
  },
  standOutSection: {
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  standOutSentSection: {
    marginTop: 8,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  standOutSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  standOutHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  standOutIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.superLike,
    alignItems: 'center',
    justifyContent: 'center',
  },
  standOutSentIcon: {
    backgroundColor: C.primary,
  },
  standOutSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  standOutRequestCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: COLORS.superLike + '38',
    marginBottom: 8,
  },
  standOutRequestTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  standOutAvatarWrap: {
    position: 'relative',
  },
  standOutRequestAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.accent,
  },
  standOutSentAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.accent,
  },
  standOutAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  standOutAvatarInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  standOutStarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.superLike,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },
  standOutRequestCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  standOutNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  standOutName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  standOutBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.superLike + '20',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.superLike + '55',
  },
  standOutBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.superLike,
  },
  standOutMessage: {
    fontSize: 13,
    lineHeight: 18,
    color: C.textLight,
    fontStyle: 'italic',
  },
  standOutActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  standOutActionButton: {
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
  },
  standOutReplyButton: {
    flex: 1,
    backgroundColor: COLORS.superLike + '14',
    borderWidth: 1,
    borderColor: COLORS.superLike + '45',
  },
  standOutAcceptButton: {
    flex: 1,
    backgroundColor: COLORS.superLike,
  },
  standOutIgnoreButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
  },
  standOutReplyText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.superLike,
  },
  standOutAcceptText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  standOutIgnoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textLight,
  },
  standOutSentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.09)',
    marginBottom: 7,
  },
  standOutSentCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
  },
  standOutPendingBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: C.primary + '18',
  },
  standOutPendingText: {
    fontSize: 10,
    fontWeight: '800',
    color: C.primary,
  },
  standOutSentMessage: {
    fontSize: 12,
    color: C.textLight,
    fontStyle: 'italic',
  },
  matchesList: {
    paddingLeft: 16,
    paddingRight: 24,
    paddingTop: 8,
  },
  matchItem: {
    marginRight: 16,
    alignItems: 'center',
    width: moderateScale(72, 0.25),
  },
  matchAvatarContainer: {
    position: 'relative',
    marginBottom: 6,
    paddingTop: 12,
    paddingHorizontal: 2,
    overflow: 'visible',
  },
  matchRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2.5,
    borderColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  matchAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.surface,
  },
  placeholderAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: '600',
    color: C.text,
  },
  superLikeStarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.superLike,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },
  todFlameBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF7849',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },
  newConnectionBadge: {
    position: 'absolute',
    top: -8,
    left: 6,
    right: 6,
    backgroundColor: '#FF7849',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    zIndex: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  newConnectionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  matchName: {
    fontSize: 12,
    color: C.text,
    fontWeight: '500',
    textAlign: 'center',
    width: '100%',
  },

  // ── Threads section divider ──
  threadsSectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: C.surface,
    marginTop: 12,
  },

  // ── Chat rows ──
  // PHASE-2 PREMIUM: subtle elevation + faint inner border give the card a
  // premium "lifted" feel against the dark background, mirroring iOS dark
  // mode list cells. Background and corner radius unchanged.
  chatRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: C.surface, borderRadius: 14, marginBottom: 8,
    marginHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  chatAvatarWrap: { position: 'relative' },
  chatAvatarRing: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 2, borderColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  chatAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.accent },
  placeholderChatAvatar: { alignItems: 'center', justifyContent: 'center' },
  chatAvatarInitial: { fontSize: 18, fontWeight: '600', color: C.text },
  chatSuperLikeBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 18, height: 18,
    borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.superLike, borderWidth: 2, borderColor: C.background,
  },
  chatTodFlameBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 18, height: 18,
    borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FF7849', borderWidth: 2, borderColor: C.background,
  },
  connectionBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 20, height: 20,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.background,
  },
  chatInfo: { flex: 1, marginLeft: 12 },
  chatNameRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  chatNameCol: { flex: 1 },
  nameWithStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatName: { fontSize: 14, fontWeight: '600', color: C.text },
  chatIntentLabel: { fontSize: 11, color: C.primary, marginTop: 1, opacity: 0.85 },
  // PRESENCE: Online status styles
  onlineDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4ADE80', // Green
    borderWidth: 2,
    borderColor: C.background,
    zIndex: 10,
  },
  recentlyActiveText: {
    fontSize: 11,
    color: '#4ADE80',
    fontWeight: '500',
  },
  chatTime: { fontSize: 11, color: C.textLight },
  chatLastMsg: { fontSize: 13, color: C.textLight },
  // PHASE-2 PREMIUM: rose glow on unread badge for an iconic, eye-catching
  // accent against the dark list. Same color and shape — added shadow only.
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 3,
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },

  // ── Stand Out Reply Sheet ──
  replyModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  replySheet: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#171B31',
    borderWidth: 1,
    borderColor: COLORS.superLike + '35',
  },
  replySheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 14,
  },
  replySheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  replySheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: C.text,
  },
  replySheetSubtitle: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  replyOriginalMessage: {
    fontSize: 13,
    lineHeight: 18,
    color: C.textLight,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  replyInput: {
    minHeight: 92,
    maxHeight: 130,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    color: C.text,
    fontSize: 14,
    lineHeight: 19,
  },
  replySheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  replyCancelButton: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  replyCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textLight,
  },
  replySendButton: {
    flex: 1.3,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.superLike,
  },
  replySendText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // ── Likes Button & Badge ──
  likesButton: {
    position: 'relative',
    padding: 4,
  },
  likesBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E94560',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  likesBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
  },

  // Note: Likes modal styles removed - now uses dedicated page at /(main)/(private)/phase2-likes
});
