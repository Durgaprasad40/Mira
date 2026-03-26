/*
 * PHASE-2 PRIVATE CHATS SCREEN
 * P0-002 FIX: Migrated to use Phase-2 privateConversations backend
 *
 * Backend source: privateConversations, privateConversationParticipants, privateMessages
 * Query: api.privateConversations.getUserPrivateConversations
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Alert, ActivityIndicator } from 'react-native';
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
import { DEMO_INCOGNITO_PROFILES } from '@/lib/demoData';
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

/** Look up Phase-2 intent label for a participant */
const getIntentLabel = (participantId: string): string | null => {
  const profile = DEMO_INCOGNITO_PROFILES.find((p) => p.id === participantId);
  if (!profile?.privateIntentKey) return null;
  const category = PRIVATE_INTENT_CATEGORIES.find((c) => c.key === profile.privateIntentKey);
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

        // Navigate to chat using backend conversation ID
        router.push(`/(main)/incognito-chat?id=${backendConvoId}` as any);
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

  // Separate conversations into "new matches" (no messages) and "message threads" (has messages)
  const { newMatches, messageThreads } = useMemo(() => {
    const newM: typeof conversations = [];
    const threads: typeof conversations = [];

    conversations.forEach((convo) => {
      const convoMessages = messages[convo.id] || [];
      if (convoMessages.length === 0) {
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
  }, [conversations, messages]);

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
            return (
              <TouchableOpacity
                style={styles.matchItem}
                activeOpacity={0.7}
                // Phase-2: tap opens chat thread directly (conversation already exists)
                onPress={() => router.push(`/(main)/incognito-chat?id=${item.id}` as any)}
              >
                <View style={styles.matchAvatarContainer}>
                  <View style={[
                    styles.matchRing,
                    isSuperLike && { borderColor: COLORS.superLike, borderWidth: 3 }
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
                  {isSuperLike && (
                    <View style={styles.superLikeStarBadge}>
                      <Ionicons name="star" size={10} color="#FFFFFF" />
                    </View>
                  )}
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
        <View style={{ width: 32 }} />
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
            <Text style={styles.emptySubtitle}>Accept a Truth or Dare or connect in a Room to start chatting</Text>
          </View>
        ) : (
          /* Message threads */
          messageThreads.map((convo) => {
            // Check if this match originated from a super like
            const isSuperLike = convo.matchSource === 'super_like';
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
                    isSuperLike && { borderColor: COLORS.superLike, borderWidth: 2.5 }
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
                      {(() => {
                        const intentLabel = getIntentLabel(convo.participantId);
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
});
