/*
 * PHASE-2 PRIVATE CHATS SCREEN
 * P0-002 FIX: Migrated to use Phase-2 privateConversations backend
 *
 * Backend source: privateConversations, privateConversationParticipants, privateMessages
 * Query: api.privateConversations.getUserPrivateConversations
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Alert, ActivityIndicator, Modal } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useAuthStore } from '@/stores/authStore';
import { textForPublicSurface } from '@/lib/contentFilter';
import { ReportModal } from '@/components/private/ReportModal';
import { getTimeAgo } from '@/lib/utils';
// P1-004 FIX: Removed DEMO_INCOGNITO_PROFILES - now using backend participantIntentKey
import { useScreenTrace } from '@/lib/devTrace';

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

// Normalize Phase-2 connectionSource for local store compatibility
const normalizeConnectionSource = (source: string): 'tod' | 'room' | 'desire' | 'friend' => {
  if (source === 'desire_match' || source === 'desire_super_like') return 'desire';
  if (source === 'tod' || source === 'room' || source === 'desire' || source === 'friend') {
    return source as 'tod' | 'room' | 'desire' | 'friend';
  }
  return 'desire'; // Default for Phase-2 matches
};

// Check if connectionSource is a Phase-2 source
const isPhase2Source = (source: string): boolean => {
  return ['tod', 'room', 'desire', 'desire_match', 'desire_super_like'].includes(source);
};

/**
 * P1-004 FIX: Look up Phase-2 intent label for a participant.
 * @param intentKey - The privateIntentKey from backend userPrivateProfiles
 * @returns The human-readable label or null if not found
 */
const getIntentLabelFromKey = (intentKey: string | null | undefined): string | null => {
  if (!intentKey) return null;
  const category = PRIVATE_INTENT_CATEGORIES.find((c) => c.key === intentKey);
  return category?.label ?? null;
};

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
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);

  // Auth for queries and mutations
  const currentUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  // ═══════════════════════════════════════════════════════════════════════════
  // P2_LIKES: Incoming likes (people who liked current user, pending match)
  // ═══════════════════════════════════════════════════════════════════════════
  const incomingLikes = useQuery(
    api.privateSwipes.getIncomingLikes,
    currentUserId ? { userId: currentUserId as any } : 'skip'
  );
  const incomingLikesCount = useQuery(
    api.privateSwipes.getIncomingLikesCount,
    currentUserId ? { userId: currentUserId as any } : 'skip'
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
  // DELIVERED-TICK-FIX: Mark ALL messages as delivered when messages list loads
  // Following Phase-1 pattern: delivery state set when device receives messages
  // ═══════════════════════════════════════════════════════════════════════════
  const markAllDeliveredMutation = useMutation(api.privateConversations.markAllPrivateMessagesDelivered);
  const hasMarkedDeliveredRef = useRef(false);

  useEffect(() => {
    if (!token || hasMarkedDeliveredRef.current) return;
    hasMarkedDeliveredRef.current = true;

    markAllDeliveredMutation({ token }).catch((err) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Phase2Chats] Failed to mark all messages delivered:', err);
      }
    });
  }, [token, markAllDeliveredMutation]);

  // T&D Pending Connect Requests (still uses truthDare API - T&D is a separate feature)
  const pendingRequests = useQuery(
    api.truthDare.getPendingConnectRequests,
    currentUserId ? { authUserId: currentUserId } : 'skip'
  );
  const respondToConnect = useMutation(api.truthDare.respondToConnect);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  // P0-FIX: Success sheet state for post-accept celebration
  // FIX: Include both users' info for proper match display
  const [successSheet, setSuccessSheet] = useState<{
    visible: boolean;
    conversationId: string;
    senderName: string;
    senderPhotoUrl: string;
    recipientName: string;
    recipientPhotoUrl: string;
  } | null>(null);

  // [T/D RECEIVE UI] Debug logs for pending connect requests
  useEffect(() => {
    if (__DEV__) {
      console.log('[T/D RECEIVE UI] State:', {
        currentUserId: currentUserId?.slice(-8) ?? 'NULL',
        querySkipped: !currentUserId,
        pendingRequestsLoading: pendingRequests === undefined,
        pendingRequestsCount: pendingRequests?.length ?? 0,
        pendingRequestIds: pendingRequests?.map((r) => r._id?.slice(-8)) ?? [],
      });
    }
  }, [currentUserId, pendingRequests]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002 FIX: Backend conversations from Phase-2 privateConversations table
  // ═══════════════════════════════════════════════════════════════════════════
  const backendConversations = useQuery(
    api.privateConversations.getUserPrivateConversations,
    currentUserId ? { authUserId: currentUserId } : 'skip'
  );

  // P1-003 FIX: Bidirectional sync from Phase-2 backend to local store
  // Reconciles additions, updates, AND removals (unmatch/block/delete)
  useEffect(() => {
    // Handle empty backend gracefully - reconcile with empty array to clear stale local data
    if (!backendConversations) return;

    // Transform backend conversations to local format
    const normalizedBackend: import('@/types').IncognitoConversation[] = backendConversations
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
          lastMessage: bc.lastMessage || 'Say hi!',
          lastMessageAt: bc.lastMessageAt,
          unreadCount: bc.unreadCount,
          connectionSource: normalizeConnectionSource(source),
          // Preserve super_like info for UI badges
          matchSource: source === 'desire_super_like' ? 'super_like' as const : undefined,
        };
      });

    // Single reconciliation pass: add/update/remove
    reconcileConversations(normalizedBackend);
  }, [backendConversations, reconcileConversations]);

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

    setRespondingTo(requestId);
    try {
      const result = await respondToConnect({
        requestId: requestId as any,
        action: 'connect',
        authUserId: currentUserId,
      });

      if (result?.success && result.action === 'connected') {
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
          recipientName: result.recipientName || 'You',
          recipientPhotoUrl: result.recipientPhotoUrl || '',
        });
      } else {
        Alert.alert('Error', result?.reason || 'Failed to accept connection.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to accept connection. Please try again.');
    } finally {
      setRespondingTo(null);
    }
  }, [currentUserId, respondToConnect, conversations, unlockUser, createConversation, router]);

  // Handle reject T&D connect request
  const handleRejectConnect = useCallback(async (requestId: string) => {
    if (!currentUserId) return;

    setRespondingTo(requestId);
    try {
      await respondToConnect({
        requestId: requestId as any,
        action: 'remove',
        authUserId: currentUserId,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to decline connection. Please try again.');
    } finally {
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
      const isNewMatch = !lastMsg || NEW_MATCH_MESSAGES.some(
        (placeholder) => lastMsg.toLowerCase() === placeholder.toLowerCase()
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
    if (!pendingRequests || pendingRequests.length === 0) return null;

    return (
      <View style={styles.pendingRequestsSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="flame" size={18} color={C.primary} />
          <Text style={styles.sectionTitle}>T&D Connect Requests</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{pendingRequests.length}</Text>
          </View>
        </View>
        {pendingRequests.map((req) => {
          const isResponding = respondingTo === req._id;
          return (
            <View key={req._id} style={styles.pendingRequestCard}>
              <View style={styles.pendingRequestHeader}>
                {req.senderPhotoUrl ? (
                  <Image source={{ uri: req.senderPhotoUrl }} style={styles.pendingAvatar} blurRadius={8} />
                ) : (
                  <View style={[styles.pendingAvatar, styles.pendingAvatarPlaceholder]}>
                    <Ionicons name="person" size={20} color={C.textLight} />
                  </View>
                )}
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
                    {item.participantPhotoUrl ? (
                      <Image
                        source={{ uri: item.participantPhotoUrl }}
                        style={styles.matchAvatar}
                        contentFit="cover"
                        blurRadius={10}
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContent}>
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
            {/* P1-003 FIX: Updated copy to mention Desire Land */}
            <Text style={styles.emptySubtitle}>Match in Desire Land, play Truth or Dare, or connect in a Room to start chatting</Text>
          </View>
        ) : (
          /* Message threads */
          messageThreads.map((convo) => {
            // Check if this match originated from a super like
            const isSuperLike = convo.matchSource === 'super_like';
            // Check if this is a T/D connection
            const isTodConnect = convo.connectionSource === 'tod';
            return (
              <TouchableOpacity
                key={convo.id}
                style={styles.chatRow}
                onPress={() => router.push(`/(main)/incognito-chat?id=${convo.id}` as any)}
                onLongPress={() => setReportTarget({ id: convo.participantId, name: convo.participantName })}
                activeOpacity={0.8}
              >
                <View style={styles.chatAvatarWrap}>
                  <View style={[
                    styles.chatAvatarRing,
                    isSuperLike && { borderColor: COLORS.superLike, borderWidth: 2.5 },
                    isTodConnect && !isSuperLike && { borderColor: '#FF7849', borderWidth: 2.5 }
                  ]}>
                    {convo.participantPhotoUrl ? (
                      <Image source={{ uri: convo.participantPhotoUrl }} style={styles.chatAvatar} blurRadius={10} />
                    ) : (
                      <View style={[styles.chatAvatar, styles.placeholderChatAvatar]}>
                        <Text style={styles.chatAvatarInitial}>{convo.participantName?.[0] || '?'}</Text>
                      </View>
                    )}
                  </View>
                  {isSuperLike ? (
                    <View style={styles.chatSuperLikeBadge}>
                      <Ionicons name="star" size={8} color="#FFFFFF" />
                    </View>
                  ) : isTodConnect ? (
                    <View style={styles.chatTodFlameBadge}>
                      <Ionicons name="flame" size={8} color="#FFFFFF" />
                    </View>
                  ) : (
                    <View style={[styles.connectionBadge, { backgroundColor: C.surface }]}>
                      <Ionicons name={connectionIcon(convo.connectionSource) as any} size={10} color={C.primary} />
                    </View>
                  )}
                </View>
                <View style={styles.chatInfo}>
                  <View style={styles.chatNameRow}>
                    <View style={styles.chatNameCol}>
                      <Text style={styles.chatName}>{convo.participantName}</Text>
                      {/* P1-004 FIX: Use backend participantIntentKey instead of demo data */}
                      {(() => {
                        const intentLabel = getIntentLabelFromKey(convo.participantIntentKey);
                        return intentLabel ? (
                          <Text style={styles.chatIntentLabel}>{intentLabel}</Text>
                        ) : null;
                      })()}
                    </View>
                    <Text style={styles.chatTime}>{getTimeAgo(convo.lastMessageAt)}</Text>
                  </View>
                  <Text style={styles.chatLastMsg} numberOfLines={1}>{textForPublicSurface(convo.lastMessage)}</Text>
                </View>
                {convo.unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{convo.unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {reportTarget && (
        <ReportModal
          visible
          targetName={reportTarget.name}
          onClose={() => setReportTarget(null)}
          onReport={() => setReportTarget(null)}
          onBlock={() => { blockUser(reportTarget.id); setReportTarget(null); }}
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
                  {successSheet.senderPhotoUrl ? (
                    <Image
                      source={{ uri: successSheet.senderPhotoUrl }}
                      style={styles.successAvatar}
                      blurRadius={8}
                    />
                  ) : (
                    <View style={[styles.successAvatar, styles.successAvatarPlaceholder]}>
                      <Text style={styles.successAvatarInitial}>
                        {successSheet.senderName?.[0] || '?'}
                      </Text>
                    </View>
                  )}
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
                  {successSheet.recipientPhotoUrl ? (
                    <Image
                      source={{ uri: successSheet.recipientPhotoUrl }}
                      style={styles.successAvatar}
                      blurRadius={8}
                    />
                  ) : (
                    <View style={[styles.successAvatar, styles.successAvatarPlaceholder]}>
                      <Text style={styles.successAvatarInitial}>
                        {successSheet.recipientName?.[0] || '?'}
                      </Text>
                    </View>
                  )}
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
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text, flex: 1, marginLeft: 10 },
  listContent: { paddingBottom: 16 },
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
  chatRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: C.surface, borderRadius: 12, marginBottom: 8,
    marginHorizontal: 16,
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
  chatName: { fontSize: 14, fontWeight: '600', color: C.text },
  chatIntentLabel: { fontSize: 11, color: C.primary, marginTop: 1, opacity: 0.85 },
  chatTime: { fontSize: 11, color: C.textLight },
  chatLastMsg: { fontSize: 13, color: C.textLight },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8,
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
