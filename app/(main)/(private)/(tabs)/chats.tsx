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
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator, Modal, AppState, RefreshControl, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { TodAvatar } from '@/components/truthdare/TodAvatar';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useAuthStore } from '@/stores/authStore';
import { textForPublicSurface } from '@/lib/contentFilter';
import { ReportModal } from '@/components/private/ReportModal';
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
const LOADING_SKELETON_ROWS = [0, 1, 2, 3];
const STANDOUT_PREVIEW_LIMIT = 3;
const NEW_MATCH_RECENCY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type Phase2LastMessageType = 'text' | 'image' | 'video' | 'voice' | 'system';

type Phase2Conversation = IncognitoConversation & {
  hasRealMessages?: boolean;
  lastMessageSenderId?: string | null;
  lastMessageType?: Phase2LastMessageType | string | null;
  lastMessageIsProtected?: boolean;
};

type StandoutPreview = {
  likeId: string;
  displayName: string;
  message: string;
  photoUrl?: string | null;
  shouldBlurPhoto: boolean;
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

const isRetryableTodError = (error: unknown): boolean => {
  const retryableFlag =
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    (error as { retryable?: boolean }).retryable === true;
  if (retryableFlag) {
    return true;
  }

  const message =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: string }).message === 'string'
      ? (error as { message: string }).message.toLowerCase()
      : '';

  return (
    message.includes('network') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('offline') ||
    message.includes('unable to connect') ||
    message.includes('fetch failed') ||
    message.includes('connection')
  );
};

const PRESENCE_HEARTBEAT_INTERVAL = 15000; // 15 seconds

export default function ChatsScreen() {
  useScreenTrace("P2_CHATS");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const conversations = usePrivateChatStore((s) => s.conversations);
  const messages = usePrivateChatStore((s) => s.messages);
  const blockUser = usePrivateChatStore((s) => s.blockUser);
  const createConversation = usePrivateChatStore((s) => s.createConversation);
  const unlockUser = usePrivateChatStore((s) => s.unlockUser);
  const reconcileConversations = usePrivateChatStore((s) => s.reconcileConversations);
  const pruneDeletedMessages = usePrivateChatStore((s) => s.pruneDeletedMessages);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string; conversationId: string } | null>(null);

  // P2-003: Error and retry state for queries
  const [retryKey, setRetryKey] = useState(0);
  const [hasQueryError, setHasQueryError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Log incoming likes count
  useEffect(() => {
    if (__DEV__ && incomingLikes !== undefined) {
      console.log('[P2_FRONTEND_LIKES]', {
        count: incomingLikes.length,
        likes: incomingLikes.map(l => ({ from: l.fromUserId?.slice(-8), action: l.action }))
      });
    }
  }, [incomingLikes]);

  const standoutPreviews = useMemo<StandoutPreview[]>(() => {
    if (!incomingLikes) return [];

    return incomingLikes
      .filter((like) => {
        const message = typeof like.message === 'string' ? like.message.trim() : '';
        return like.action === 'super_like' && message.length > 0;
      })
      .slice(0, STANDOUT_PREVIEW_LIMIT)
      .map((like) => {
        const photoBlurSlots: boolean[] | undefined = Array.isArray(like.profile?.photoBlurSlots)
          ? like.profile.photoBlurSlots
          : undefined;
        const message = typeof like.message === 'string' ? like.message.trim() : '';

        return {
          likeId: String(like.likeId),
          displayName: like.profile?.displayName || 'Someone',
          message: textForPublicSurface(message),
          photoUrl: like.profile?.blurredPhotoUrl ?? null,
          shouldBlurPhoto: like.profile?.photoBlurEnabled === true && Boolean(photoBlurSlots?.[0]),
        };
      });
  }, [incomingLikes]);

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

  // T&D Pending Connect Requests (still uses truthDare API - T&D is a separate feature)
  // P0-AUTH-CRASH-FIX: Gate on canRunQueries to prevent early query errors
  // FIX: Use authUserId instead of token (backend expects authUserId)
  const pendingRequests = useQuery(
    api.truthDare.getPendingConnectRequests,
    canRunQueries && currentUserId ? { authUserId: currentUserId } : 'skip'
  );
  const respondToConnect = useMutation(api.truthDare.respondToConnect);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const pendingConnectResponseRef = useRef<Set<string>>(new Set());
  const [processedPendingRequestIds, setProcessedPendingRequestIds] = useState<Set<string>>(new Set());
  const visiblePendingRequests = useMemo(() => {
    if (!pendingRequests) return [];
    return pendingRequests.filter((request) => !processedPendingRequestIds.has(request._id));
  }, [pendingRequests, processedPendingRequestIds]);

  // P0-FIX: Success sheet state for post-accept celebration
  // FIX: Include both users' info for proper match display
  const [successSheet, setSuccessSheet] = useState<{
    visible: boolean;
    conversationId: string;
    senderName: string;
    senderPhotoUrl: string;
    senderPhotoBlurMode?: 'none' | 'blur';
    senderIsAnonymous?: boolean;
    recipientName: string;
    recipientPhotoUrl: string;
    recipientPhotoBlurMode?: 'none' | 'blur';
    recipientIsAnonymous?: boolean;
  } | null>(null);

  // [T/D RECEIVE UI] Debug logs for pending connect requests
  useEffect(() => {
    if (__DEV__) {
      console.log('[T/D RECEIVE UI] State:', {
        currentUserId: currentUserId?.slice(-8) ?? 'NULL',
        querySkipped: !currentUserId,
        pendingRequestsLoading: pendingRequests === undefined,
        pendingRequestsCount: visiblePendingRequests.length,
        pendingRequestIds: visiblePendingRequests.map((r) => r._id?.slice(-8)) ?? [],
      });
    }
  }, [currentUserId, pendingRequests, visiblePendingRequests]);

  useEffect(() => {
    if (!pendingRequests) return;

    setProcessedPendingRequestIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const liveIds = new Set(pendingRequests.map((request) => String(request._id)));
      const next = new Set(Array.from(prev).filter((requestId) => liveIds.has(requestId)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingRequests]);

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

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      setRefreshing(false);
      refreshTimeoutRef.current = null;
    }, 700);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
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
          participantName: bc.participantName,
          participantAge: bc.participantAge || 0,
          participantPhotoUrl: bc.participantPhotoUrl || '',
          // P1-004 FIX: Include participantIntentKey from backend for intent label lookup
          participantIntentKey: (bc as any).participantIntentKey ?? null,
          // PRESENCE: Include lastActive for online status display
          participantLastActive: (bc as any).participantLastActive ?? 0,
          lastMessage: bc.lastMessage || 'Say hi!',
          lastMessageAt: bc.lastMessageAt,
          unreadCount: bc.unreadCount,
          hasRealMessages: (bc as any).hasRealMessages === true,
          lastMessageSenderId: (bc as any).lastMessageSenderId
            ? String((bc as any).lastMessageSenderId)
            : null,
          lastMessageType: (bc as any).lastMessageType ?? null,
          lastMessageIsProtected: (bc as any).lastMessageIsProtected === true,
          connectionSource: normalizeConnectionSource(source),
          // Preserve super_like info for UI badges
          matchSource: source === 'desire_super_like' ? 'super_like' as const : undefined,
          // PHOTO-BLUR-FIX: Include blur flags from backend for consistent photo display
          isPhotoBlurred: (bc as any).isPhotoBlurred ?? false,
          canViewClearPhoto: (bc as any).canViewClearPhoto ?? true,
        };
      }) as Phase2Conversation[];
  }, [backendConversations]);

  const hasRealMessagesByConversationId = useMemo(() => {
    if (!normalizedBackend) return null;

    return new Map(
      normalizedBackend.map((convo) => [convo.id, convo.hasRealMessages === true])
    );
  }, [normalizedBackend]);

  const conversationPreviewById = useMemo(() => {
    if (!normalizedBackend) return null;

    return new Map(
      normalizedBackend.map((convo) => [convo.id, getPhase2ConversationPreview(convo)])
    );
  }, [normalizedBackend]);

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

  // Handle accept T&D connect request
  const handleAcceptConnect = useCallback(async (requestId: string) => {
    if (!currentUserId) return;
    if (pendingConnectResponseRef.current.has(`connect:${requestId}`)) return;

    pendingConnectResponseRef.current.add(`connect:${requestId}`);
    setRespondingTo(requestId);
    try {
      const result = await respondToConnect({
        requestId: requestId as any,
        action: 'connect',
        authUserId: currentUserId,
      });

      if (result?.success && result.action === 'connected') {
        setProcessedPendingRequestIds((prev) => {
          const next = new Set(prev);
          next.add(requestId);
          return next;
        });
        // Backend created the conversation - use the backend conversation ID
        const backendConvoId = result.conversationId;

        // Check if conversation already exists in local store
        const existingConvo = conversations.find((c) => c.id === backendConvoId);
        if (!existingConvo) {
          // Unlock user
          unlockUser({
            id: result.senderUserId!,
            username: result.senderName || 'Someone',
            photoUrl: result.senderPhotoUrl || '',
            age: result.senderAge || 0,
            source: 'tod',
            unlockedAt: Date.now(),
          });

          // Create local conversation with backend ID
          createConversation({
            id: backendConvoId!,
            participantId: result.senderUserId!,
            participantName: result.senderName || 'Someone',
            participantAge: result.senderAge || 0,
            participantPhotoUrl: result.senderPhotoUrl || '',
            lastMessage: 'T&D connection accepted! Say hi!',
            lastMessageAt: Date.now(),
            unreadCount: 0,
            connectionSource: 'tod',
          });
        }

        // P0-FIX: Show success sheet instead of navigating immediately
        // FIX: Include both users' info for proper match display
        setSuccessSheet({
          visible: true,
          conversationId: backendConvoId!,
          senderName: result.senderName || 'Someone',
          senderPhotoUrl: result.senderPhotoUrl || '',
          senderPhotoBlurMode: result.senderPhotoBlurMode || 'none',
          senderIsAnonymous: !!result.senderIsAnonymous,
          recipientName: result.recipientName || 'You',
          recipientPhotoUrl: result.recipientPhotoUrl || '',
          recipientPhotoBlurMode: result.recipientPhotoBlurMode || 'none',
          recipientIsAnonymous: !!result.recipientIsAnonymous,
        });
      } else {
        Alert.alert('Error', result?.reason || 'Failed to accept connection.');
      }
    } catch (error) {
      if (isRetryableTodError(error)) {
        Alert.alert(
          'Connection Unconfirmed',
          'We could not confirm this request was accepted. Pull to refresh before trying again.'
        );
      } else {
        Alert.alert('Error', 'Failed to accept connection. Please try again.');
      }
    } finally {
      pendingConnectResponseRef.current.delete(`connect:${requestId}`);
      setRespondingTo(null);
    }
  }, [currentUserId, respondToConnect, conversations, unlockUser, createConversation, router]);

  // Handle reject T&D connect request
  const handleRejectConnect = useCallback(async (requestId: string) => {
    if (!currentUserId) return;
    if (pendingConnectResponseRef.current.has(`remove:${requestId}`)) return;

    pendingConnectResponseRef.current.add(`remove:${requestId}`);
    setRespondingTo(requestId);
    try {
      await respondToConnect({
        requestId: requestId as any,
        action: 'remove',
        authUserId: currentUserId,
      });
      setProcessedPendingRequestIds((prev) => {
        const next = new Set(prev);
        next.add(requestId);
        return next;
      });
    } catch (error) {
      if (isRetryableTodError(error)) {
        Alert.alert(
          'Decline Unconfirmed',
          'We could not confirm this request was declined. Pull to refresh before trying again.'
        );
      } else {
        Alert.alert('Error', 'Failed to decline connection. Please try again.');
      }
    } finally {
      pendingConnectResponseRef.current.delete(`remove:${requestId}`);
      setRespondingTo(null);
    }
  }, [currentUserId, respondToConnect]);

  // Separate conversations into "new matches" (no real messages) and "message threads" (has real messages)
  // BUG-3 FIX: Use backend real-message state instead of placeholder display text.
  const { newMatches, messageThreads } = useMemo(() => {
    const newM: typeof conversations = [];
    const threads: typeof conversations = [];

    conversations.forEach((convo) => {
      const backendHasRealMessages = hasRealMessagesByConversationId?.get(convo.id);
      const localHasRealMessages = (convo as Phase2Conversation).hasRealMessages;
      const isNewMatch = !(backendHasRealMessages ?? localHasRealMessages ?? false);

      if (isNewMatch) {
        newM.push(convo);
      } else {
        threads.push(convo);
      }
    });

    // Sort new matches by most recent first
    newM.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    // Sort threads by most recent activity
    threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    return { newMatches: newM, messageThreads: threads };
  }, [conversations, hasRealMessagesByConversationId]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSearchingMessages = normalizedSearchQuery.length > 0;

  const filteredMessageThreads = useMemo(() => {
    if (!isSearchingMessages) {
      return messageThreads as Phase2Conversation[];
    }

    return (messageThreads as Phase2Conversation[]).filter((convo) => {
      const participantName = convo.participantName?.toLowerCase() ?? '';
      const previewText = (
        conversationPreviewById?.get(convo.id) ?? getPhase2ConversationPreview(convo)
      ).toLowerCase();

      return (
        participantName.includes(normalizedSearchQuery) ||
        previewText.includes(normalizedSearchQuery)
      );
    });
  }, [conversationPreviewById, isSearchingMessages, messageThreads, normalizedSearchQuery]);

  // Render T&D Pending Connect Requests
  const renderPendingConnectRequests = () => {
    if (visiblePendingRequests.length === 0) return null;

    return (
      <View style={styles.pendingRequestsSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="flame" size={18} color={C.primary} />
          <Text style={styles.sectionTitle}>T&D Connect Requests</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{visiblePendingRequests.length}</Text>
          </View>
        </View>
        {visiblePendingRequests.map((req) => {
          const isResponding = respondingTo === req._id;
          return (
              <View key={req._id} style={styles.pendingRequestCard}>
              <View style={styles.pendingRequestHeader}>
                <TodAvatar
                  size={40}
                  photoUrl={req.senderPhotoUrl ?? null}
                  isAnonymous={req.senderIsAnonymous}
                  photoBlurMode={req.senderPhotoBlurMode ?? 'none'}
                  label={req.senderName}
                  style={styles.pendingAvatar}
                  backgroundColor={C.background}
                  textColor={C.text}
                  iconColor={C.textLight}
                />
                <View style={styles.pendingInfo}>
                  <Text style={styles.pendingName}>
                    {req.senderName}{req.senderAge ? `, ${req.senderAge}` : ''}
                  </Text>
                  <Text style={styles.pendingContext} numberOfLines={1}>
                    wants to connect from a {req.promptType}
                  </Text>
                </View>
              </View>
              <Text style={styles.pendingPromptPreview} numberOfLines={2}>
                "{req.promptText}"
              </Text>
              <View style={styles.pendingActions}>
                <TouchableOpacity
                  style={styles.pendingRejectBtn}
                  onPress={() => handleRejectConnect(req._id)}
                  disabled={isResponding}
                >
                  {isResponding ? (
                    <ActivityIndicator size="small" color={C.textLight} />
                  ) : (
                    <Text style={styles.pendingRejectText}>Decline</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pendingAcceptBtn}
                  onPress={() => handleAcceptConnect(req._id)}
                  disabled={isResponding}
                >
                  {isResponding ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="chatbubble" size={14} color="#FFF" />
                      <Text style={styles.pendingAcceptText}>Accept</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderStandoutPreviewSection = () => {
    if (standoutPreviews.length === 0) return null;

    return (
      <TouchableOpacity
        style={styles.standoutPreviewSection}
        onPress={() => router.push('/(main)/(private)/phase2-likes' as any)}
        activeOpacity={0.85}
      >
        <View style={styles.standoutPreviewHeader}>
          <View style={styles.standoutTitleRow}>
            <View style={styles.standoutIconWrap}>
              <Ionicons name="star" size={14} color="#FFFFFF" />
            </View>
            <Text style={styles.standoutPreviewTitle}>Standout messages</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{standoutPreviews.length}</Text>
            </View>
          </View>
          <View style={styles.standoutViewCta}>
            <Text style={styles.standoutViewText}>View</Text>
            <Ionicons name="chevron-forward" size={14} color={C.primary} />
          </View>
        </View>

        {standoutPreviews.map((preview) => (
          <View key={preview.likeId} style={styles.standoutPreviewRow}>
            {preview.photoUrl ? (
              <Image
                source={{ uri: preview.photoUrl }}
                style={styles.standoutAvatar}
                contentFit="cover"
                blurRadius={preview.shouldBlurPhoto ? 10 : 0}
              />
            ) : (
              <View style={[styles.standoutAvatar, styles.standoutAvatarPlaceholder]}>
                <Text style={styles.standoutAvatarInitial}>{preview.displayName?.[0] || '?'}</Text>
              </View>
            )}
            <View style={styles.standoutPreviewCopy}>
              <Text style={styles.standoutSenderName} numberOfLines={1}>
                {preview.displayName}
              </Text>
              <Text style={styles.standoutMessagePreview} numberOfLines={1}>
                "{preview.message}"
              </Text>
            </View>
          </View>
        ))}
      </TouchableOpacity>
    );
  };

  const renderMessageSearchBar = () => {
    if (messageThreads.length === 0 && !isSearchingMessages) return null;

    return (
      <View style={styles.searchSection}>
        <View style={styles.searchInputWrap}>
          <Ionicons name="search" size={17} color={C.textLight} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search messages"
            placeholderTextColor={C.textLight}
            style={styles.searchInput}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {isSearchingMessages && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.searchClearButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={17} color={C.textLight} />
            </TouchableOpacity>
          )}
        </View>
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
            const isRecentConnect = Date.now() - item.lastMessageAt < NEW_MATCH_RECENCY_THRESHOLD_MS;
            return (
              <TouchableOpacity
                style={styles.matchItem}
                activeOpacity={0.7}
                // Phase-2: tap opens chat thread directly (conversation already exists)
                onPress={() => router.push(`/(main)/incognito-chat?id=${item.id}` as any)}
              >
                <View style={styles.matchAvatarContainer}>
                  {/* NEW badge for very recent connections */}
                  {isRecentConnect && (
                    <View style={styles.newConnectionBadge}>
                      <Text style={styles.newConnectionText}>NEW</Text>
                    </View>
                  )}
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
                <Text style={styles.matchName} numberOfLines={1}>{item.participantName}</Text>
              </TouchableOpacity>
            );
          }}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.matchesList}
        />
      </View>
    );
  };

  const renderConversationRow = useCallback(({ item: convo }: { item: Phase2Conversation }) => {
    // PRESENCE: Calculate online status for green dot indicator
    const onlineStatus = getOnlineStatus((convo as any).participantLastActive);
    const previewText = conversationPreviewById?.get(convo.id) ?? getPhase2ConversationPreview(convo);
    const hasUnread = convo.unreadCount > 0;
    return (
      <TouchableOpacity
        style={[styles.chatRow, hasUnread && styles.chatRowUnread]}
        onPress={() => router.push(`/(main)/incognito-chat?id=${convo.id}` as any)}
        onLongPress={() => setReportTarget({ id: convo.participantId, name: convo.participantName, conversationId: convo.id })}
        activeOpacity={0.8}
      >
        {/* CLEAN UI: Profile photo only (no extra badges/icons) */}
        <View style={styles.chatAvatarWrap}>
          <View style={[styles.chatAvatarRing, hasUnread && styles.chatAvatarRingUnread]}>
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
                <Text style={styles.chatAvatarInitial}>{convo.participantName?.[0] || '?'}</Text>
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
            <View style={styles.chatNameCol}>
              <Text style={[styles.chatName, hasUnread && styles.chatNameUnread]} numberOfLines={1}>
                {convo.participantName}
              </Text>
            </View>
            <Text style={[styles.chatTime, hasUnread && styles.chatTimeUnread]}>{getTimeAgo(convo.lastMessageAt)}</Text>
          </View>
          <View style={styles.chatMessageRow}>
            <Text style={[styles.chatLastMsg, hasUnread && styles.chatLastMsgUnread]} numberOfLines={1}>{previewText}</Text>
            {hasUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{convo.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [conversationPreviewById, router]);

  const listHeaderComponent = (
    <>
      {/* P2-003: Loading state */}
      {isQueryLoading && (
        <View style={styles.loadingSkeletonContainer}>
          {LOADING_SKELETON_ROWS.map((row) => (
            <View key={row} style={styles.skeletonChatRow}>
              <View style={styles.skeletonAvatarRing}>
                <View style={styles.skeletonAvatar} />
              </View>
              <View style={styles.skeletonChatInfo}>
                <View style={styles.skeletonNameRow}>
                  <View style={[
                    styles.skeletonLine,
                    row === 1 ? styles.skeletonNameLineShort : styles.skeletonNameLine,
                  ]} />
                  <View style={styles.skeletonTimeLine} />
                </View>
                <View style={[
                  styles.skeletonLine,
                  row === 2 ? styles.skeletonMessageLineShort : styles.skeletonMessageLine,
                ]} />
              </View>
              {row === 0 && <View style={styles.skeletonUnreadDot} />}
            </View>
          ))}
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
          {/* T&D Pending Connect Requests */}
          {renderPendingConnectRequests()}

          {/* Standout message previews */}
          {renderStandoutPreviewSection()}

          {/* New Matches Row */}
          {renderNewMatchesRow()}

          {/* Search normal message threads only */}
          {renderMessageSearchBar()}

          {/* Messages section header (only show if we have both new matches and threads) */}
          {newMatches.length > 0 && messageThreads.length > 0 && (
            <View style={styles.threadsSectionHeader}>
              <Text style={styles.sectionTitle}>Messages</Text>
            </View>
          )}

          {/* Empty state - only show if NO conversations at all */}
          {conversations.length === 0 && (
            <View style={styles.emptyContainer}>
              <Ionicons name="lock-open-outline" size={64} color={C.textLight} />
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              {/* P1-003 FIX: Updated copy to mention Deep Connect */}
              <Text style={styles.emptySubtitle}>Match in Deep Connect, play Truth or Dare, or connect in a Room to start chatting</Text>
            </View>
          )}
        </>
      )}
    </>
  );

  const hasIncomingLikes = (incomingLikesCount ?? 0) > 0;
  const incomingLikesBadgeText = (incomingLikesCount ?? 0) > 99 ? '99+' : String(incomingLikesCount ?? 0);
  const showSearchEmptyState =
    !isQueryLoading &&
    !hasQueryError &&
    isSearchingMessages &&
    messageThreads.length > 0 &&
    filteredMessageThreads.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        {/* Likes button with badge - navigates to Phase-2 likes page */}
        <TouchableOpacity
          style={[styles.likesButton, hasIncomingLikes && styles.likesButtonActive]}
          onPress={() => router.push('/(main)/(private)/phase2-likes' as any)}
        >
          <Ionicons name="heart" size={22} color={hasIncomingLikes ? '#E94560' : C.textLight} />
          {hasIncomingLikes && (
            <View style={styles.likesBadge}>
              <Text style={styles.likesBadgeText}>
                {incomingLikesBadgeText}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={!isQueryLoading && !hasQueryError && conversations.length > 0 ? filteredMessageThreads : []}
        keyExtractor={(item) => item.id}
        renderItem={renderConversationRow}
        ListHeaderComponent={listHeaderComponent}
        ListEmptyComponent={
          showSearchEmptyState ? (
            <View style={styles.searchEmptyState}>
              <Ionicons name="search-outline" size={34} color={C.textLight} />
              <Text style={styles.searchEmptyTitle}>No chats found</Text>
              <Text style={styles.searchEmptySubtitle}>Try a name or phrase from a recent message.</Text>
            </View>
          ) : null
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
            progressBackgroundColor={C.surface}
          />
        }
      />

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

      {/* P0-FIX: Post-accept success sheet with both users' photos */}
      {successSheet?.visible && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setSuccessSheet(null)}
        >
          <View style={styles.successOverlay}>
            <View style={styles.successSheet}>
              {/* Both users' photos side by side */}
              <View style={styles.successAvatarsRow}>
                {/* Sender photo (T/D requester) */}
                <View style={styles.successAvatarContainer}>
                  <TodAvatar
                    size={70}
                    photoUrl={successSheet.senderPhotoUrl ?? null}
                    isAnonymous={successSheet.senderIsAnonymous}
                    photoBlurMode={successSheet.senderPhotoBlurMode ?? 'none'}
                    label={successSheet.senderName}
                    borderWidth={3}
                    borderColor={C.primary}
                    backgroundColor={C.background}
                    textColor={C.text}
                    iconColor={C.textLight}
                    style={styles.successAvatar}
                  />
                  <Text style={styles.successAvatarName} numberOfLines={1}>
                    {successSheet.senderName}
                  </Text>
                </View>

                {/* Heart icon between photos */}
                <View style={styles.successHeartContainer}>
                  <Ionicons name="heart" size={32} color={C.primary} />
                </View>

                {/* Recipient photo (current user / acceptor) */}
                <View style={styles.successAvatarContainer}>
                  <TodAvatar
                    size={70}
                    photoUrl={successSheet.recipientPhotoUrl ?? null}
                    isAnonymous={successSheet.recipientIsAnonymous}
                    photoBlurMode={successSheet.recipientPhotoBlurMode ?? 'none'}
                    label={successSheet.recipientName}
                    borderWidth={3}
                    borderColor={C.primary}
                    backgroundColor={C.background}
                    textColor={C.text}
                    iconColor={C.textLight}
                    style={styles.successAvatar}
                  />
                  <Text style={styles.successAvatarName} numberOfLines={1}>
                    {successSheet.recipientName}
                  </Text>
                </View>
              </View>

              {/* Title */}
              <Text style={styles.successTitle}>You're Connected! 🎉</Text>
              <Text style={styles.successSubtitle}>
                You and {successSheet.senderName} can now chat
              </Text>

              {/* Actions */}
              <View style={styles.successActions}>
                <TouchableOpacity
                  style={styles.successPrimaryBtn}
                  onPress={() => {
                    const convoId = successSheet.conversationId;
                    setSuccessSheet(null);
                    router.push(`/(main)/incognito-chat?id=${convoId}` as any);
                  }}
                >
                  <Ionicons name="chatbubble" size={18} color="#FFF" />
                  <Text style={styles.successPrimaryText}>Say Hi</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.successSecondaryBtn}
                  onPress={() => setSuccessSheet(null)}
                >
                  <Text style={styles.successSecondaryText}>Keep Discovering</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Note: Incoming Likes Modal removed - now uses dedicated page */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: C.text, flex: 1 },
  listContent: { paddingBottom: 16 },
  // P2-003: Loading state styles
  loadingSkeletonContainer: {
    paddingTop: 16,
  },
  skeletonChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: C.surface,
    borderRadius: 12,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  skeletonAvatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: C.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.accent,
  },
  skeletonChatInfo: {
    flex: 1,
    marginLeft: 12,
  },
  skeletonNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
    backgroundColor: C.textLight + '22',
  },
  skeletonNameLine: {
    width: '42%',
  },
  skeletonNameLineShort: {
    width: '34%',
  },
  skeletonTimeLine: {
    width: 36,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.textLight + '1A',
  },
  skeletonMessageLine: {
    width: '68%',
  },
  skeletonMessageLineShort: {
    width: '52%',
  },
  skeletonUnreadDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary + '30',
    marginLeft: 8,
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

  // ── T&D Pending Connect Requests ──
  pendingRequestsSection: {
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  pendingRequestCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  pendingRequestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  pendingAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  pendingAvatarPlaceholder: {
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingInfo: {
    marginLeft: 10,
    flex: 1,
  },
  pendingName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  pendingContext: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  pendingPromptPreview: {
    fontSize: 12,
    fontStyle: 'italic',
    color: C.textLight,
    marginBottom: 10,
  },
  pendingActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  pendingRejectBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.background,
  },
  pendingRejectText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
  },
  pendingAcceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: C.primary,
  },
  pendingAcceptText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
  },

  // ── Standout Messages Preview ──
  standoutPreviewSection: {
    marginTop: 16,
    marginBottom: 4,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: COLORS.superLike + '45',
  },
  standoutPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  standoutTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  standoutIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.superLike,
    alignItems: 'center',
    justifyContent: 'center',
  },
  standoutPreviewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  standoutViewCta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  standoutViewText: {
    fontSize: 13,
    fontWeight: '700',
    color: C.primary,
  },
  standoutPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
  },
  standoutAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.accent,
  },
  standoutAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  standoutAvatarInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  standoutPreviewCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
  },
  standoutSenderName: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    marginBottom: 1,
  },
  standoutMessagePreview: {
    fontSize: 12,
    color: C.textLight,
  },

  // ── Message Search ──
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
    paddingHorizontal: 8,
    color: C.text,
    fontSize: 14,
  },
  searchClearButton: {
    padding: 2,
  },
  searchEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 34,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: C.surface,
  },
  searchEmptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginTop: 10,
  },
  searchEmptySubtitle: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 4,
  },

  // ── New Matches Section ──
  newMatchesSection: {
    marginTop: 16,
    marginBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
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
  matchesList: {
    paddingLeft: 16,
    paddingRight: 24,
  },
  matchItem: {
    marginRight: 16,
    alignItems: 'center',
    width: 72,
  },
  matchAvatarContainer: {
    position: 'relative',
    marginBottom: 6,
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
    top: -4,
    left: 10,
    right: 10,
    backgroundColor: '#FF7849',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    zIndex: 10,
    alignItems: 'center',
  },
  newConnectionText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  matchName: {
    fontSize: 12,
    color: C.text,
    fontWeight: '500',
    textAlign: 'center',
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
  chatRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: C.surface, borderRadius: 14, marginBottom: 8,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 2,
  },
  chatRowUnread: {
    borderColor: C.primary + '45',
    backgroundColor: '#1A2750',
  },
  chatAvatarWrap: { position: 'relative' },
  chatAvatarRing: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 2, borderColor: C.primary + '70',
    alignItems: 'center', justifyContent: 'center',
  },
  chatAvatarRingUnread: { borderColor: C.primary },
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
  chatNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  chatNameCol: { flex: 1, minWidth: 0, marginRight: 8 },
  nameWithStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatName: { fontSize: 14, fontWeight: '600', color: C.text },
  chatNameUnread: { fontWeight: '700' },
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
  chatTimeUnread: { color: C.primary, fontWeight: '700' },
  chatMessageRow: { flexDirection: 'row', alignItems: 'center' },
  chatLastMsg: { flex: 1, fontSize: 13, color: C.textLight, lineHeight: 18, marginRight: 8 },
  chatLastMsgUnread: { color: C.text, fontWeight: '600' },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },

  // P0-FIX: Success sheet styles
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  successSheet: {
    backgroundColor: C.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
  },
  successIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 28,
  },
  successActions: {
    width: '100%',
    gap: 12,
  },
  successPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  successPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  successSecondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  successSecondaryText: {
    fontSize: 15,
    fontWeight: '500',
    color: C.textLight,
  },
  // FIX: Styles for both users' photos in success sheet
  successAvatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 12,
  },
  successAvatarContainer: {
    alignItems: 'center',
    width: 80,
  },
  successAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: C.primary,
  },
  successAvatarPlaceholder: {
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successAvatarInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
  },
  successAvatarName: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text,
    marginTop: 6,
    textAlign: 'center',
  },
  successHeartContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Likes Button & Badge ──
  likesButton: {
    position: 'relative',
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  likesButtonActive: {
    backgroundColor: '#E945601A',
    borderWidth: 1,
    borderColor: '#E9456040',
  },
  likesBadge: {
    position: 'absolute',
    top: -3,
    right: -5,
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
