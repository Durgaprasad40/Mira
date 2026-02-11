import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { textForPublicSurface } from '@/lib/contentFilter';
import { ReportModal } from '@/components/private/ReportModal';
import { getTimeAgo } from '@/lib/utils';
import { DEMO_INCOGNITO_PROFILES } from '@/lib/demoData';

const C = INCOGNITO_COLORS;

const connectionIcon = (source: string) => {
  switch (source) {
    case 'tod': return 'flame';
    case 'room': return 'chatbubbles';
    case 'desire': return 'heart';
    case 'friend': return 'people';
    default: return 'chatbubble';
  }
};

/** Look up Phase-2 intent label for a participant */
const getIntentLabel = (participantId: string): string | null => {
  const profile = DEMO_INCOGNITO_PROFILES.find((p) => p.id === participantId);
  if (!profile?.privateIntentKey) return null;
  const category = PRIVATE_INTENT_CATEGORIES.find((c) => c.key === profile.privateIntentKey);
  return category?.label ?? null;
};

export default function ChatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const conversations = usePrivateChatStore((s) => s.conversations);
  const messages = usePrivateChatStore((s) => s.messages);
  const blockUser = usePrivateChatStore((s) => s.blockUser);
  const pruneDeletedMessages = usePrivateChatStore((s) => s.pruneDeletedMessages);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);

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
