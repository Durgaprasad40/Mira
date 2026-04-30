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
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Alert, ActivityIndicator, Modal, AppState } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
import type { ConnectionSource } from '@/types';
// P2-INSTRUMENTATION: Sentry breadcrumbs for Phase-2 debugging
import { P2 } from '@/lib/p2Instrumentation';

const C = INCOGNITO_COLORS;

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
  const shouldQueryTodRequests = canRunQueries && !!currentUserId;
  const pendingRequests = useQuery(
    api.truthDare.getPendingConnectRequests,
    shouldQueryTodRequests ? { authUserId: currentUserId } : 'skip'
  );
  const pendingRequestsLoading = shouldQueryTodRequests && pendingRequests === undefined;
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
        authReady,
        authConfirmed,
        canRunQueries,
        querySkipped: !shouldQueryTodRequests,
        pendingRequestsLoading,
        pendingRequestsCount: visiblePendingRequests.length,
        pendingRequestIds: visiblePendingRequests.map((r) => r._id?.slice(-8)) ?? [],
      });
    }
  }, [authReady, authConfirmed, canRunQueries, currentUserId, pendingRequestsLoading, shouldQueryTodRequests, visiblePendingRequests]);

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
  // FIX: Use backend lastMessage field instead of local messages store for consistent cross-device state
  const { newMatches, messageThreads } = useMemo(() => {
    const newM: typeof conversations = [];
    const threads: typeof conversations = [];

    // System/placeholder messages that indicate "new match" state (no real conversation yet)
    const NEW_MATCH_MESSAGES = [
      'Say hi!',
      'T&D connection accepted! Say hi!',
      'T&D connection accepted! Say hi 👋',
      'You matched! Say hi!',
      'New match! Start the conversation.',
    ];

    conversations.forEach((convo) => {
      // Check backend-provided lastMessage to determine if it's a real conversation
      const lastMsg = convo.lastMessage?.trim() || '';
      const normalizedLastMsg = lastMsg.replace(/^\[SYSTEM:[^\]]+\]/, '').trim();
      const isNewMatch = !normalizedLastMsg || NEW_MATCH_MESSAGES.some(
        (placeholder) => normalizedLastMsg.toLowerCase() === placeholder.toLowerCase()
      );

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
  }, [conversations]);

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
            // Check if this is a very recent connection (within 30 minutes)
            const isRecentConnect = Date.now() - item.lastMessageAt < 30 * 60 * 1000;
            return (
              <TouchableOpacity
                style={styles.matchItem}
                activeOpacity={0.7}
                // Phase-2: tap opens chat thread directly (conversation already exists)
                onPress={() => {
                  console.log('[P2_CHAT_OPEN] match-row', item.id);
                  router.push({
                    pathname: '/(main)/(private)/(tabs)/chats/[id]',
                    params: { id: String(item.id) },
                  } as any);
                }}
              >
                <View pointerEvents="none" style={{ alignItems: 'center' }}>
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

  return (
    <LinearGradient
      // PHASE-2 PREMIUM: matches the thread (chats/[id].tsx) gradient so the
      // tab → list → thread → tab transition stays cohesive.
      colors={['#101426', '#1A1633', '#16213E']}
      locations={[0, 0.55, 1]}
      style={[styles.container, styles.gradientContainer, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <Ionicons name="mail" size={24} color={C.primary} />
        <Text style={styles.headerTitle}>Messages</Text>
        {/* Likes button with badge - navigates to Phase-2 likes page */}
        <TouchableOpacity
          style={styles.likesButton}
          onPress={() => router.push('/(main)/(private)/phase2-likes' as any)}
        >
          <Ionicons name="heart" size={24} color={C.primary} />
          {(incomingLikesCount ?? 0) > 0 && (
            <View style={styles.likesBadge}>
              <Text style={styles.likesBadgeText}>
                {incomingLikesCount! > 9 ? '9+' : incomingLikesCount}
              </Text>
            </View>
          )}
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
            {/* T&D Pending Connect Requests */}
            {renderPendingConnectRequests()}

            {/* New Matches Row */}
            {renderNewMatchesRow()}

            {/* Messages section header (only show if we have both new matches and threads) */}
            {newMatches.length > 0 && messageThreads.length > 0 && (
              <View style={styles.threadsSectionHeader}>
                <Text style={styles.sectionTitle}>Messages</Text>
              </View>
            )}

            {/* Empty state - only show if NO conversations at all */}
            {conversations.length === 0 ? (
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
            return (
              <TouchableOpacity
                key={convo.id}
                style={styles.chatRow}
                onPress={() => {
                  console.log('[P2_CHAT_OPEN] chat-row', convo.id);
                  router.push({
                    pathname: '/(main)/(private)/(tabs)/chats/[id]',
                    params: { id: String(convo.id) },
                  } as any);
                }}
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
                    <Text style={styles.chatName}>{convo.participantName}</Text>
                    <Text style={styles.chatTime}>{getTimeAgo(convo.lastMessageAt)}</Text>
                  </View>
                  <Text style={styles.chatLastMsg} numberOfLines={1}>{textForPublicSurface(convo.lastMessage)}</Text>
                </View>
                {convo.unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{convo.unreadCount}</Text>
                  </View>
                )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
          </>
        )}
      </ScrollView>

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
                    console.log('[P2_CHAT_OPEN] success-sheet', convoId);
                    router.push({
                      pathname: '/(main)/(private)/(tabs)/chats/[id]',
                      params: { id: String(convoId) },
                    } as any);
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
