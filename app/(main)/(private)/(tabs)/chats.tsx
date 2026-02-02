import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { textForPublicSurface } from '@/lib/contentFilter';
import { ReportModal } from '@/components/private/ReportModal';
import { getTimeAgo } from '@/lib/utils';

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

export default function ChatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const conversations = usePrivateChatStore((s) => s.conversations);
  const blockUser = usePrivateChatStore((s) => s.blockUser);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Ionicons name="mail" size={24} color={C.primary} />
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContent}>
        {conversations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="lock-open-outline" size={64} color={C.textLight} />
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySubtitle}>Accept a Truth or Dare or connect in a Room to start chatting</Text>
          </View>
        ) : (
          conversations.map((convo) => (
            <TouchableOpacity
              key={convo.id}
              style={styles.chatRow}
              onPress={() => router.push(`/(main)/incognito-chat?id=${convo.id}` as any)}
              onLongPress={() => setReportTarget({ id: convo.participantId, name: convo.participantName })}
              activeOpacity={0.8}
            >
              <View style={styles.chatAvatarWrap}>
                <Image source={{ uri: convo.participantPhotoUrl }} style={styles.chatAvatar} blurRadius={10} />
                <View style={[styles.connectionBadge, { backgroundColor: C.surface }]}>
                  <Ionicons name={connectionIcon(convo.connectionSource) as any} size={10} color={C.primary} />
                </View>
              </View>
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
            </TouchableOpacity>
          ))
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
  listContent: { padding: 16 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontSize: 13, color: C.textLight, textAlign: 'center' },

  chatRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: C.surface, borderRadius: 12, marginBottom: 8,
  },
  chatAvatarWrap: { position: 'relative' },
  chatAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.accent },
  connectionBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 20, height: 20,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.background,
  },
  chatInfo: { flex: 1, marginLeft: 12 },
  chatNameRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  chatName: { fontSize: 14, fontWeight: '600', color: C.text },
  chatTime: { fontSize: 11, color: C.textLight },
  chatLastMsg: { fontSize: 13, color: C.textLight },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8,
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
});
