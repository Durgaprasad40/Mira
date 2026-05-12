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
// Visual target for the New Matches strip. When fewer than this many real
// matches exist, ghost (empty) avatar slots fill the remainder so the row
// reads as a real "ready to fill" UI rather than a blank empty-state card.
const NEW_MATCHES_TARGET_SLOTS = 4;

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
  token,
  onReady,
}: {
  conversationId: string;
  userId: string;
  token: string;
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
    token,
  });
  const gs = useQuery(api.games.getBottleSpinSession, { conversationId, authUserId: userId });
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
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
  }, []);
  useEffect(() => {
    if (searchQuery.length === 0) {
      setDebouncedSearchQuery('');
      return;
    }

    const handle = setTimeout(() => setDebouncedSearchQuery(searchQuery), 120);
    return () => clearTimeout(handle);
  }, [searchQuery]);

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
  // Compact-strip + two-mode sheet model:
  //  - detailTarget: opens the OVERVIEW sheet (profile preview + Ignore/Accept/Reply)
  //  - replyTarget : opens the REPLY composer sheet (TextInput + Send Reply)
  // Tapping an incoming Stand Out strip item sets detailTarget. Tapping
  // "Reply" inside the overview swaps detailTarget → replyTarget.
  const [detailTarget, setDetailTarget] = useState<IncomingStandOutRow | null>(null);
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
      setDetailTarget(null);
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
      setDetailTarget(null);
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

  const openDetailSheet = useCallback((request: IncomingStandOutRow) => {
    if (activeStandOutAction) return;
    setReplyTarget(null);
    setDetailTarget(request);
  }, [activeStandOutAction]);

  const closeDetailSheet = useCallback(() => {
    setDetailTarget(null);
  }, []);

  const openReplyComposer = useCallback((request: IncomingStandOutRow) => {
    if (activeStandOutAction) return;
    setReplyText('');
    setDetailTarget(null);
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

  // Tap-to-view-profile from inside the Stand Out detail sheet. Uses the same
  // Phase-2 profile route that Deep Connect / phase2-likes already use:
  //   /(main)/(private)/p2-profile/[userId]
  // We close BOTH detailTarget and replyTarget first so the sheet doesn't
  // remain mounted on top of the profile screen. The pending Stand Out is
  // unaffected — `handledStandOutIds` is only mutated by accept/ignore/reply
  // mutations, so when the user navigates back the request is still pending
  // and they can tap it again to reopen the sheet.
  const handleViewStandOutSenderProfile = useCallback(
    (request: IncomingStandOutRow) => {
      const targetUserId = request.fromUserId
        ? String(request.fromUserId)
        : request.sender?.userId
          ? String(request.sender.userId)
          : null;
      if (!targetUserId) {
        Toast.show('Profile unavailable');
        return;
      }
      setDetailTarget(null);
      setReplyTarget(null);
      router.push(`/(main)/(private)/p2-profile/${targetUserId}` as any);
    },
    [router],
  );

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

  // PRODUCT RULE: pending Stand Outs MUST appear ONLY in the Stand Out
  // Requests / Stand Outs Sent strips — never in New Matches or Recent Chats.
  // Backend `getUserPrivateConversations` already excludes pending Stand Outs
  // (a privateConversations row is created only on accept/reply), so this is a
  // defensive client-side filter that keeps the UI consistent if a transient
  // backend race ever surfaces a stale conversation row.
  const pendingStandOutUserIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    incomingStandOuts.forEach((row) => {
      if (row.fromUserId) set.add(String(row.fromUserId));
    });
    outgoingStandOuts.forEach((row) => {
      if (row.toUserId) set.add(String(row.toUserId));
    });
    return set;
  }, [incomingStandOuts, outgoingStandOuts]);

  // Separate conversations into "new matches" (no real messages) and "message threads" (has real messages)
  // BUG-3 FIX: Use backend real-message state instead of placeholder display text
  const { newMatches, messageThreads } = useMemo(() => {
    const newM: typeof conversations = [];
    const threads: typeof conversations = [];

    conversations.forEach((convo) => {
      // Defensive: skip any conversation whose participant is currently a
      // pending Stand Out — that user belongs in the Stand Out strip only.
      if (pendingStandOutUserIds.has(String(convo.participantId))) return;

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
  }, [conversations, hasRealMessagesByConversationId, pendingStandOutUserIds]);

  const rawSearchQuery = searchQuery.trim();
  const normalizedSearchQuery = (debouncedSearchQuery.trim() || rawSearchQuery).toLowerCase();
  const isSearchActive = rawSearchQuery.length > 0;
  const filteredSearchResults = useMemo(() => {
    if (!isSearchActive) return messageThreads;

    return conversations.filter((convo) => {
      // Same defensive exclusion as newMatches/messageThreads.
      if (pendingStandOutUserIds.has(String(convo.participantId))) return false;
      const participantName = (convo.participantName ?? '').toLowerCase();
      return participantName.includes(normalizedSearchQuery);
    });
  }, [conversations, isSearchActive, messageThreads, normalizedSearchQuery, pendingStandOutUserIds]);

  // PHASE-2 PREMIUM (compact strip): three avatar size variants.
  //  - 'strip'      → 56dp circle used inside the horizontal Stand Out
  //                   Requests strip on the messages list.
  //  - 'stripSent'  → 48dp dimmer circle for the outgoing Stand Outs Sent
  //                   strip (slightly smaller + reduced opacity for hierarchy).
  //  - 'detail'     → 80dp hero circle used inside the detail sheet.
  const renderStandOutAvatar = (
    user: StandOutPreviewUser | null | undefined,
    sizeStyle: 'strip' | 'stripSent' | 'detail' = 'strip',
  ) => {
    const name = getStandOutDisplayName(user);
    const style =
      sizeStyle === 'detail'
        ? styles.standOutDetailAvatar
        : sizeStyle === 'stripSent'
          ? styles.standOutStripAvatarSent
          : styles.standOutStripAvatar;
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
        <Text
          style={
            sizeStyle === 'detail'
              ? styles.standOutDetailInitial
              : styles.standOutAvatarInitial
          }
        >
          {name[0] || '?'}
        </Text>
      </View>
    );
  };

  // PHASE-2 PREMIUM compact strip — replaces the previous large stacked
  // request cards. Each item is a tap-target that opens the detail sheet
  // (overview mode). Layout rules:
  //  - 1-4 items  → row left-aligned with consistent gap (NOT flex:1 — that
  //                 distribution is reserved for New Matches so the two
  //                 sections are visually distinct at a glance).
  //  - 5+ items   → horizontal scroll, no centering.
  // A small star badge sits at bottom-right of every avatar; if the sender
  // attached a message, a subtle chat-bubble badge appears at bottom-left.
  const renderIncomingStandOutRequests = () => {
    if (incomingStandOuts.length === 0) return null;
    const sectionCount = handledStandOutIds.size > 0
      ? incomingStandOuts.length
      : standOutCounts?.incoming ?? incomingStandOuts.length;
    const useScroll = incomingStandOuts.length > 4;

    const items = incomingStandOuts.map((request) => {
      const sender = request.sender ?? null;
      const firstName = getStandOutDisplayName(sender).split(' ')[0] || 'Someone';
      const hasMessage = !!(request.message && request.message.trim().length > 0);
      const isAnyActionActive = !!activeStandOutAction;
      return (
        <TouchableOpacity
          key={request.likeId}
          style={styles.standOutStripItem}
          activeOpacity={0.82}
          disabled={isAnyActionActive}
          onPress={() => openDetailSheet(request)}
        >
          <View style={styles.standOutStripAvatarWrap}>
            {renderStandOutAvatar(sender, 'strip')}
            <View style={styles.standOutStripStarBadge}>
              <Ionicons name="star" size={10} color="#FFFFFF" />
            </View>
            {hasMessage && (
              <View style={styles.standOutStripMessageBadge}>
                <Ionicons
                  name="chatbubble-ellipses"
                  size={9}
                  color="#FFFFFF"
                />
              </View>
            )}
          </View>
          <Text style={styles.standOutStripName} numberOfLines={1}>
            {firstName}
          </Text>
        </TouchableOpacity>
      );
    });

    return (
      <View style={styles.standOutSection}>
        <View style={styles.standOutSectionHeader}>
          <View style={styles.standOutHeaderLeft}>
            <View style={styles.standOutIconWrap}>
              <Ionicons name="star" size={13} color="#FFFFFF" />
            </View>
            <Text style={styles.standOutSectionTitle}>
              Stand Out Requests ({sectionCount})
            </Text>
          </View>
        </View>

        {useScroll ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.standOutStripScroll}
          >
            {items}
          </ScrollView>
        ) : (
          <View style={styles.standOutStripRow}>{items}</View>
        )}
      </View>
    );
  };

  // PHASE-2 PREMIUM compact dimmer strip for outgoing Stand Outs. Smaller,
  // muted, "Pending" pill below the name. Tap shows a brief toast (no
  // detail sheet — there's nothing the sender can do until the receiver
  // responds).
  const renderOutgoingStandOutsSent = () => {
    if (outgoingStandOuts.length === 0) return null;
    const sectionCount = handledStandOutIds.size > 0
      ? outgoingStandOuts.length
      : standOutCounts?.outgoing ?? outgoingStandOuts.length;
    const useScroll = outgoingStandOuts.length > 4;

    const items = outgoingStandOuts.map((sent) => {
      const receiver = sent.receiver ?? null;
      const firstName = getStandOutDisplayName(receiver).split(' ')[0] || 'Someone';
      return (
        <TouchableOpacity
          key={sent.likeId}
          style={styles.standOutSentStripItem}
          activeOpacity={0.82}
          onPress={handleOutgoingStandOutPress}
        >
          <View style={styles.standOutSentAvatarWrap}>
            {renderStandOutAvatar(receiver, 'stripSent')}
          </View>
          <Text
            style={[styles.standOutStripName, styles.standOutSentStripName]}
            numberOfLines={1}
          >
            {firstName}
          </Text>
          <View style={styles.standOutSentStripPendingPill}>
            <Text style={styles.standOutSentStripPendingText}>Pending</Text>
          </View>
        </TouchableOpacity>
      );
    });

    return (
      <View style={styles.standOutSentSection}>
        <View style={styles.standOutSectionHeader}>
          <View style={styles.standOutHeaderLeft}>
            <View style={[styles.standOutIconWrap, styles.standOutSentIcon]}>
              <Ionicons name="paper-plane" size={12} color="#FFFFFF" />
            </View>
            <Text style={styles.standOutSectionTitle}>
              Stand Outs Sent ({sectionCount})
            </Text>
          </View>
        </View>

        {useScroll ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.standOutStripScroll}
          >
            {items}
          </ScrollView>
        ) : (
          <View style={styles.standOutStripRow}>{items}</View>
        )}
      </View>
    );
  };

  // New Matches row - Phase-2 style (blurred avatars, tap → profile preview).
  // ALWAYS renders so the row is visible even when there are zero matches.
  // Layout switches based on real-match count:
  //  - realCount ≤ NEW_MATCHES_TARGET_SLOTS  → fixed even-distribution row
  //    (each slot uses flex:1 so 4 circles are evenly spread across the
  //    available width; ghost slots fill the empty positions).
  //  - realCount  > NEW_MATCHES_TARGET_SLOTS → horizontal scroll of just
  //    the real avatars, no ghost fillers (user can swipe through them).
  // PHASE-2 PREMIUM empty slot: glassy dark ring + soft inner blush of the
  // primary rose accent + muted heart-outline so the slot reads as a
  // "future match" instead of a missing image. No fake names, no fake photos.
  const renderEmptyMatchSlot = (key: string) => (
    <View key={key} pointerEvents="none" style={{ alignItems: 'center' }}>
      <View style={styles.matchAvatarContainer}>
        <View style={[styles.matchRing, styles.matchRingEmpty]}>
          <View style={[styles.matchAvatar, styles.matchAvatarEmpty]}>
            <Ionicons name="heart-outline" size={22} color="rgba(233,69,96,0.55)" />
          </View>
        </View>
      </View>
    </View>
  );

  const renderRealMatchSlot = (item: (typeof newMatches)[number], key: string) => {
    const isSuperLike = item.matchSource === 'super_like';
    const isTodConnect = item.connectionSource === 'tod';
    const isRecentConnect = Date.now() - item.lastMessageAt < NEW_MATCH_WINDOW_MS;
    return (
      <TouchableOpacity
        key={key}
        style={{ alignItems: 'center' }}
        activeOpacity={0.7}
        // P2_THREAD_OPEN_GATE: route through the prefetch handler so the
        // thread mounts with all four queries already cached.
        disabled={!!openingId && openingId !== String(item.id)}
        onPress={() => handleOpenConversation(String(item.id))}
      >
        <View pointerEvents="none" style={{ alignItems: 'center' }}>
          <View style={styles.matchAvatarContainer}>
            {openingId === String(item.id) ? (
              <View style={styles.newConnectionBadge}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : isRecentConnect ? (
              <View style={styles.newConnectionBadge}>
                <Text style={styles.newConnectionText}>NEW</Text>
              </View>
            ) : null}
            <View
              style={[
                styles.matchRing,
                isSuperLike && { borderColor: COLORS.superLike, borderWidth: 3 },
                isTodConnect && !isSuperLike && { borderColor: '#FF7849', borderWidth: 3 },
              ]}
            >
              {isTodConnect ? (
                <TodAvatar
                  size={58}
                  photoUrl={item.participantPhotoUrl || null}
                  isAnonymous={isTodConversationAnonymous(
                    item.participantName,
                    item.participantPhotoUrl,
                  )}
                  photoBlurMode={getTodConversationPhotoBlurMode(
                    item.isPhotoBlurred,
                    item.canViewClearPhoto,
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
          <Text style={styles.matchName} numberOfLines={1} ellipsizeMode="tail">
            {item.participantName}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderNewMatchesRow = () => {
    const realCount = newMatches.length;
    const useEvenRow = realCount <= NEW_MATCHES_TARGET_SLOTS;

    return (
      <View style={styles.newMatchesSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="heart-circle" size={18} color={C.primary} />
          <Text style={styles.sectionTitle}>New Matches</Text>
          {realCount > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{realCount}</Text>
            </View>
          )}
        </View>

        {useEvenRow ? (
          <View style={styles.newMatchesEvenRow}>
            {Array.from({ length: NEW_MATCHES_TARGET_SLOTS }).map((_, idx) => {
              const realItem = newMatches[idx];
              return (
                <View key={`nm-slot-${idx}`} style={styles.newMatchesEvenSlot}>
                  {realItem
                    ? renderRealMatchSlot(realItem, `real-${realItem.id}`)
                    : renderEmptyMatchSlot(`empty-${idx}`)}
                </View>
              );
            })}
          </View>
        ) : (
          <FlatList
            horizontal
            data={newMatches}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <View style={styles.matchScrollItem}>
                {renderRealMatchSlot(item, `real-${item.id}`)}
              </View>
            )}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.matchesList}
          />
        )}
      </View>
    );
  };

  const hasStandOutContent = incomingStandOuts.length > 0 || outgoingStandOuts.length > 0;
  const displayedThreads = isSearchActive ? filteredSearchResults : messageThreads;

  return (
    <LinearGradient
      // PHASE-2 PREMIUM: deepened four-stop dark gradient — near-black at the
      // very top fades through deep navy, warm purple-violet, into a softer
      // midnight blue. Avoids the previous "flat blue" feel and gives the
      // screen real visual depth without being garish. Stays cohesive with
      // chats/[id].tsx which uses the same family of hues.
      colors={['#070A18', '#0F1430', '#1B1340', '#161E3D']}
      locations={[0, 0.35, 0.7, 1]}
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

      <View style={styles.searchSection}>
        <View style={styles.searchInputWrap}>
          <Ionicons name="search" size={18} color={C.textLight} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search chats or matches"
            placeholderTextColor={C.textLight}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="never"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={clearSearch}
              style={styles.searchClearButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color={C.textLight} />
            </TouchableOpacity>
          )}
        </View>
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
            {!isSearchActive && renderIncomingStandOutRequests()}
            {!isSearchActive && renderOutgoingStandOutsSent()}

            {/* New Matches Row — always renders when not searching; ghost
                avatar slots fill the row when there are zero (or fewer than
                NEW_MATCHES_TARGET_SLOTS) real matches. */}
            {!isSearchActive && renderNewMatchesRow()}

            {!isSearchActive && (
              <View style={styles.recentChatsHeader}>
                <Text style={styles.recentChatsLabel}>Recent Chats</Text>
              </View>
            )}

            {isSearchActive && displayedThreads.length === 0 ? (
              <View style={styles.searchEmptyContainer}>
                <Text style={styles.searchEmptyText}>No matches for "{rawSearchQuery}"</Text>
              </View>
            ) : conversations.length === 0 && !hasStandOutContent && !isSearchActive ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="lock-open-outline" size={64} color={C.textLight} />
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            {/* P1-003 FIX: Updated copy to mention Deep Connect */}
            <Text style={styles.emptySubtitle}>Match in Deep Connect, play Truth or Dare, or connect in a Room to start chatting</Text>
          </View>
        ) : (
          /* Message threads */
          displayedThreads.map((convo) => {
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
      {openingId && currentUserId && token ? (
        <Phase2ChatThreadPrefetcher
          conversationId={openingId}
          userId={currentUserId}
          token={token}
          onReady={() => navigateToThread(openingId)}
        />
      ) : null}

      {/*
       * PHASE-2 PREMIUM Stand Out detail sheet — two-mode bottom sheet.
       *  - OVERVIEW MODE  (detailTarget !== null): hero avatar, name+age,
       *    "Sent you a Stand Out" caption (or message callout if attached),
       *    three actions — Ignore, Accept, Reply.
       *  - REPLY MODE     (replyTarget  !== null): hero avatar, name+age,
       *    optional original-message callout, multi-line TextInput,
       *    "Sending a reply also accepts the request." caption, Cancel /
       *    Send Reply.
       * Reply button visual emphasis depends on whether the sender attached a
       * message: filled bordered pill when there's a real message to reply
       * to; lower-emphasis text-only style when there isn't, so Accept stays
       * the primary call to action.
       */}
      {(() => {
        const overviewActive = !!detailTarget;
        const replyActive = !!replyTarget;
        const sheetTarget = replyTarget ?? detailTarget;
        if (!sheetTarget) return null;

        const sender = sheetTarget.sender ?? null;
        const hasMessage = !!(
          sheetTarget.message && sheetTarget.message.trim().length > 0
        );
        const acceptKey = `accept:${sheetTarget.likeId}`;
        const replyKey = `reply:${sheetTarget.likeId}`;
        const ignoreKey = `ignore:${sheetTarget.likeId}`;
        const isAnyActionActive = !!activeStandOutAction;
        const isAccepting = activeStandOutAction === acceptKey;
        const isReplying = activeStandOutAction === replyKey;
        const isIgnoring = activeStandOutAction === ignoreKey;
        const isReplyInFlight = activeStandOutAction?.startsWith('reply:');

        const onClose = replyActive ? closeReplyComposer : closeDetailSheet;

        return (
          <Modal
            transparent
            visible={overviewActive || replyActive}
            animationType="fade"
            onRequestClose={onClose}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.replyModalOverlay}
            >
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={onClose}
              />
              <View
                style={[
                  styles.replySheet,
                  {
                    // SAFE-AREA FIX: lift the sheet above the Android nav /
                    // gesture area. `insets.bottom` is 0 on most iPhones
                    // (handled separately by the iOS home indicator) but is
                    // ~24-48dp on Android devices with on-screen nav buttons
                    // or a tall gesture pill. We add a baseline of 12dp so
                    // even devices reporting `insets.bottom = 0` still get
                    // a visible breathing gap below the action buttons.
                    marginBottom: Math.max(insets.bottom + 12, 16),
                  },
                ]}
              >
                <View style={styles.replySheetHandle} />

                {/* Profile preview block — shared across both modes. */}
                <View style={styles.standOutDetailHeader}>
                  <TouchableOpacity
                    style={styles.standOutDetailAvatarWrap}
                    activeOpacity={0.85}
                    onPress={() => handleViewStandOutSenderProfile(sheetTarget)}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${getStandOutDisplayName(sender)}'s profile`}
                  >
                    {renderStandOutAvatar(sender, 'detail')}
                    <View style={styles.standOutDetailStarBadge}>
                      <Ionicons name="star" size={12} color="#FFFFFF" />
                    </View>
                    {/* Subtle chevron-on-the-corner affordance — premium hint
                        that the avatar is interactive without cluttering the
                        sheet with extra text. */}
                    <View style={styles.standOutDetailViewProfileChip}>
                      <Ionicons
                        name="chevron-forward"
                        size={11}
                        color="#FFFFFF"
                      />
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.standOutDetailName} numberOfLines={1}>
                    {getStandOutNameLine(sender)}
                  </Text>
                  {/* Subtle "tap photo" hint — reinforces that the avatar is
                      a tappable shortcut to the full profile. Hidden in
                      reply-composer mode to keep that view focused. */}
                  {!replyActive && (
                    <Text style={styles.standOutDetailViewProfileHint}>
                      Tap photo to view profile
                    </Text>
                  )}
                  {hasMessage ? (
                    <View style={styles.standOutDetailMessageCallout}>
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={14}
                        color={COLORS.superLike}
                      />
                      <Text
                        style={styles.standOutDetailMessageText}
                        numberOfLines={3}
                      >
                        {getStandOutMessagePreview(sheetTarget.message)}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.standOutDetailNoMessage}>
                      Sent you a Stand Out
                    </Text>
                  )}
                </View>

                {replyActive ? (
                  <>
                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder={
                        hasMessage
                          ? 'Write your reply...'
                          : 'Say hi to accept and start the chat...'
                      }
                      placeholderTextColor={C.textLight}
                      style={styles.replyInput}
                      multiline
                      maxLength={500}
                      editable={!isReplyInFlight}
                      textAlignVertical="top"
                      autoFocus
                    />
                    <Text style={styles.standOutDetailReplyCaption}>
                      Sending a reply also accepts the request.
                    </Text>
                    <View style={styles.replySheetActions}>
                      <TouchableOpacity
                        style={styles.replyCancelButton}
                        onPress={closeReplyComposer}
                        disabled={isReplyInFlight}
                      >
                        <Text style={styles.replyCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.replySendButton}
                        onPress={handleSubmitStandOutReply}
                        disabled={isReplyInFlight}
                      >
                        {isReplyInFlight ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.replySendText}>Send Reply</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <View style={styles.standOutDetailActions}>
                    <TouchableOpacity
                      style={styles.standOutDetailIgnoreButton}
                      disabled={isAnyActionActive}
                      onPress={() => handleIgnoreStandOut(sheetTarget)}
                      activeOpacity={0.78}
                    >
                      {isIgnoring ? (
                        <ActivityIndicator size="small" color={C.textLight} />
                      ) : (
                        <Text style={styles.standOutDetailIgnoreText}>
                          Ignore
                        </Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.standOutDetailAcceptButton}
                      disabled={isAnyActionActive}
                      onPress={() => handleAcceptStandOut(sheetTarget)}
                      activeOpacity={0.85}
                    >
                      {isAccepting ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.standOutDetailAcceptText}>
                          Accept
                        </Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={
                        hasMessage
                          ? styles.standOutDetailReplyButton
                          : styles.standOutDetailReplyButtonLowEmphasis
                      }
                      disabled={isAnyActionActive}
                      onPress={() => openReplyComposer(sheetTarget)}
                      activeOpacity={0.78}
                    >
                      {isReplying ? (
                        <ActivityIndicator
                          size="small"
                          color={COLORS.superLike}
                        />
                      ) : (
                        <Text
                          style={
                            hasMessage
                              ? styles.standOutDetailReplyText
                              : styles.standOutDetailReplyTextLowEmphasis
                          }
                        >
                          Reply
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </KeyboardAvoidingView>
          </Modal>
        );
      })()}

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
  // PHASE-2 PREMIUM: hairline divider on the deepened gradient reads cleaner
  // than a solid surface-coloured bar; keeps clear separation from search.
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text, flex: 1, marginLeft: 10 },
  listContent: { paddingBottom: 16 },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  // PHASE-2 PREMIUM: glassy dark pill with rose-tinted hairline border + soft
  // black drop shadow. Reads as a polished translucent control floating on
  // the deepened gradient — not a flat input field.
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: C.text,
    paddingVertical: 11,
    letterSpacing: 0.1,
  },
  searchClearButton: {
    paddingVertical: 4,
    paddingLeft: 4,
  },
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
  // Ghost avatar slot — overrides the coloured ring/fill of `matchRing`
  // and `matchAvatar` so the slot reads as "empty / waiting" while keeping
  // the exact same outer geometry as a real match avatar.
  // PHASE-2 PREMIUM: warm-rose-tinted hairline ring (echoes the primary
  // accent at very low opacity) + dark glassy fill — the slot reads as
  // "future match", not a missing image, and ties into Mira's brand colour.
  matchRingEmpty: {
    borderColor: 'rgba(233,69,96,0.20)',
    borderWidth: 1.25,
    shadowOpacity: 0,
    elevation: 0,
  },
  matchAvatarEmpty: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(233,69,96,0.10)',
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
  standOutAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  standOutAvatarInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },

  // ── Stand Out Requests / Sent strips (compact horizontal items) ──
  // Items left-align (gap, no flex:1) so the strip doesn't visually mimic
  // the New Matches even-distribution row. 5+ items switch to horizontal
  // scroll via the `useScroll` flag in the renderer.
  standOutStripRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingBottom: 4,
    gap: 14,
  },
  standOutStripScroll: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingBottom: 4,
    paddingRight: 16,
    gap: 14,
  },
  standOutStripItem: {
    width: 64,
    alignItems: 'center',
  },
  standOutStripAvatarWrap: {
    position: 'relative',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: COLORS.superLike,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.superLike,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 3,
  },
  standOutStripAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.accent,
  },
  standOutStripStarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.superLike,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },
  // Bottom-LEFT chat-bubble badge — only rendered when sender attached a
  // message. Subtle dark fill with rose-tinted hairline so it doesn't
  // compete with the bottom-right star badge for attention.
  standOutStripMessageBadge: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },
  standOutStripName: {
    marginTop: 6,
    fontSize: 12,
    color: C.text,
    fontWeight: '500',
    textAlign: 'center',
    width: '100%',
  },

  // ── Outgoing Stand Outs Sent strip (smaller, dimmer) ──
  standOutSentStripItem: {
    width: 60,
    alignItems: 'center',
    opacity: 0.78,
  },
  standOutSentAvatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  standOutStripAvatarSent: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.accent,
  },
  standOutSentStripName: {
    fontSize: 11,
    color: C.textLight,
  },
  standOutSentStripPendingPill: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(233,69,96,0.16)',
  },
  standOutSentStripPendingText: {
    fontSize: 9,
    fontWeight: '800',
    color: C.primary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // ── Detail sheet (overview + reply mode) ──
  // Hero avatar + name + message callout + actions. Reused for both modes;
  // composer-only elements (TextInput, caption, Cancel/Send) sit below this
  // shared header inside the same sheet.
  standOutDetailHeader: {
    alignItems: 'center',
    marginBottom: 14,
  },
  standOutDetailAvatarWrap: {
    position: 'relative',
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2.5,
    borderColor: COLORS.superLike,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.superLike,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 10,
  },
  standOutDetailAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.accent,
  },
  standOutDetailInitial: {
    fontSize: 30,
    fontWeight: '700',
    color: C.text,
  },
  standOutDetailStarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.superLike,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#171B31',
  },
  // Tiny chevron chip on the bottom-LEFT of the detail-sheet hero avatar.
  // Mirror image of the bottom-right star badge — together they read as
  // "Stand Out (right) + Tap-to-view-profile (left)".
  standOutDetailViewProfileChip: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#171B31',
  },
  standOutDetailName: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  standOutDetailViewProfileHint: {
    fontSize: 11,
    color: C.textLight,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    fontWeight: '700',
    opacity: 0.75,
    marginBottom: 10,
  },
  standOutDetailNoMessage: {
    fontSize: 13,
    color: C.textLight,
    fontStyle: 'italic',
  },
  standOutDetailMessageCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.superLike + '14',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.superLike + '40',
    alignSelf: 'stretch',
  },
  standOutDetailMessageText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: C.text,
  },
  standOutDetailActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  standOutDetailIgnoreButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  standOutDetailIgnoreText: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textLight,
  },
  standOutDetailAcceptButton: {
    flex: 1.4,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.superLike,
    shadowColor: COLORS.superLike,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  standOutDetailAcceptText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // Reply button when there's an original message — bordered pill, brand
  // color, equal weight to Ignore. Encourages a substantive response.
  standOutDetailReplyButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.superLike + '14',
    borderWidth: 1,
    borderColor: COLORS.superLike + '50',
  },
  standOutDetailReplyText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.superLike,
  },
  // Reply button when there's NO original message — text-only, lower
  // emphasis so Accept stays the primary action (you don't *need* to write
  // anything to accept a no-message Stand Out).
  standOutDetailReplyButtonLowEmphasis: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  standOutDetailReplyTextLowEmphasis: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.superLike,
    opacity: 0.85,
  },
  standOutDetailReplyCaption: {
    marginTop: 8,
    fontSize: 11,
    color: C.textLight,
    textAlign: 'center',
    fontStyle: 'italic',
    letterSpacing: 0.2,
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
  // ── Even-row mode (≤ NEW_MATCHES_TARGET_SLOTS real matches) ──
  // Each slot wrapper uses flex:1 so the 4 circles distribute evenly across
  // the available width — no awkward right-side empty space.
  newMatchesEvenRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  newMatchesEvenSlot: {
    flex: 1,
    alignItems: 'center',
  },
  // ── Scroll mode (> NEW_MATCHES_TARGET_SLOTS real matches) ──
  // Uses fixed-width slots so horizontal swipe feels natural.
  matchScrollItem: {
    width: moderateScale(72, 0.25),
    marginRight: 16,
    alignItems: 'center',
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
  recentChatsHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  // PHASE-2 PREMIUM: small-caps style label (uppercased, generous tracking,
  // muted text colour) so the section divider reads as a calm typographic
  // separator rather than a heading competing with the chat rows.
  recentChatsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textLight,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    opacity: 0.9,
  },
  searchEmptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 34,
  },
  searchEmptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textLight,
    textAlign: 'center',
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
  // PHASE-2 PREMIUM: subtle green halo + white-tinted ring lifts the dot off
  // the avatar so "online" reads instantly without being noisy. Position is
  // bottom-right so it never collides with the avatar ring corner.
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: C.surface,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 4,
    elevation: 3,
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
