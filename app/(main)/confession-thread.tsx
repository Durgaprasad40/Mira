import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CONFESSION_TOPICS } from '@/lib/constants';
import { ConfessionMood, ConfessionReply, ConfessionReactionType, ConfessionTopic, ConfessionChat } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import {
  DEMO_CONFESSION_REPLIES,
} from '@/lib/demoData';
import ReactionBar from '@/components/confessions/ReactionBar';
import ConfessionChatModal from '@/components/confessions/ConfessionChatModal';

const MOOD_CONFIG: Record<ConfessionMood, { emoji: string; label: string; color: string; bg: string }> = {
  romantic: { emoji: '\u2764\uFE0F', label: 'Romantic', color: '#E91E63', bg: 'rgba(233,30,99,0.12)' },
  spicy: { emoji: '\uD83D\uDD25', label: 'Spicy', color: '#FF5722', bg: 'rgba(255,87,34,0.12)' },
  emotional: { emoji: '\uD83D\uDE22', label: 'Emotional', color: '#2196F3', bg: 'rgba(33,150,243,0.12)' },
  funny: { emoji: '\uD83D\uDE02', label: 'Funny', color: '#FF9800', bg: 'rgba(255,152,0,0.12)' },
};

function getTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ConfessionThreadScreen() {
  const router = useRouter();
  const { confessionId } = useLocalSearchParams<{ confessionId: string }>();
  const { userId } = useAuthStore();
  const currentUserId = userId || 'demo_user_1';

  const {
    confessions,
    userReactions,
    chats,
    toggleReaction,
    reportConfession,
    addChat,
    addChatMessage,
    agreeMutualReveal,
    declineMutualReveal,
  } = useConfessionStore();

  const confession = useMemo(
    () => confessions.find((c) => c.id === confessionId),
    [confessions, confessionId]
  );

  const [replies, setReplies] = useState<ConfessionReply[]>(
    () => (confessionId ? DEMO_CONFESSION_REPLIES[confessionId] : undefined) || []
  );
  const [replyText, setReplyText] = useState('');
  const [activeChatModal, setActiveChatModal] = useState<ConfessionChat | null>(null);

  const handleSendReply = useCallback(() => {
    if (!replyText.trim() || !confessionId) return;
    const newReply: ConfessionReply = {
      id: `cr_new_${Date.now()}`,
      confessionId,
      userId: currentUserId,
      text: replyText.trim(),
      isAnonymous: true,
      createdAt: Date.now(),
    };
    setReplies((prev) => [...prev, newReply]);
    setReplyText('');
  }, [replyText, confessionId, currentUserId]);

  const handleReplyAnonymously = useCallback(() => {
    if (!confession || !confessionId) return;
    const existing = chats.find(
      (c) => c.confessionId === confessionId &&
        (c.initiatorId === currentUserId || c.responderId === currentUserId)
    );
    if (existing) {
      setActiveChatModal(existing);
      return;
    }

    const newChat: ConfessionChat = {
      id: `cc_new_${Date.now()}`,
      confessionId,
      initiatorId: currentUserId,
      responderId: confession.userId,
      messages: [],
      isRevealed: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24,
      mutualRevealStatus: 'none',
    };
    addChat(newChat);
    setActiveChatModal(newChat);
  }, [confession, confessionId, chats, currentUserId, addChat]);

  const handleSendChatMessage = useCallback(
    (text: string) => {
      if (!activeChatModal) return;
      const message = {
        id: `ccm_new_${Date.now()}`,
        chatId: activeChatModal.id,
        senderId: currentUserId,
        text,
        createdAt: Date.now(),
      };
      addChatMessage(activeChatModal.id, message);
      setActiveChatModal((prev) =>
        prev ? { ...prev, messages: [...prev.messages, message] } : null
      );
    },
    [activeChatModal, currentUserId, addChatMessage]
  );

  const handleReport = useCallback(() => {
    if (!confessionId) return;
    Alert.alert('Report Confession', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () => {
          reportConfession(confessionId);
          router.back();
        },
      },
    ]);
  }, [confessionId, reportConfession, router]);

  if (!confession) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Confession not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const badgeInfo = confession.topic
    ? CONFESSION_TOPICS[confession.topic]
    : MOOD_CONFIG[confession.mood];
  const reactions = confession.reactions || { relatable: 0, feel_you: 0, bold: 0, curious: 0 };
  const myReactions = userReactions[confession.id] || [];
  const isOP = (replyUserId: string) => replyUserId === confession.userId;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Nav Bar */}
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Thread</Text>
          <TouchableOpacity onPress={handleReport} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="ellipsis-vertical" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={replies}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={styles.confessionFull}>
              {/* Header */}
              <View style={styles.confessionHeader}>
                <View style={styles.authorRow}>
                  <View style={[styles.avatar, confession.isAnonymous && styles.avatarAnonymous]}>
                    <Ionicons
                      name={confession.isAnonymous ? 'eye-off' : 'person'}
                      size={16}
                      color={confession.isAnonymous ? COLORS.textMuted : COLORS.primary}
                    />
                  </View>
                  <Text style={styles.authorName}>
                    {confession.isAnonymous ? 'Anonymous' : 'Someone'}
                  </Text>
                  <Text style={styles.timeAgo}>{getTimeAgo(confession.createdAt)}</Text>
                </View>
                <View style={[styles.topicBadge, { backgroundColor: badgeInfo.bg }]}>
                  <Text style={styles.topicEmoji}>{badgeInfo.emoji}</Text>
                  <Text style={[styles.topicLabel, { color: badgeInfo.color }]}>{badgeInfo.label}</Text>
                </View>
              </View>

              {/* Full text */}
              <Text style={styles.confessionText}>{confession.text}</Text>

              {/* Reactions */}
              <ReactionBar
                reactions={reactions}
                userReactions={myReactions}
                onToggleReaction={(type) => toggleReaction(confession.id, type)}
              />

              {/* Anonymous Reply Button */}
              <TouchableOpacity style={styles.anonReplyButton} onPress={handleReplyAnonymously}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.primary} />
                <Text style={styles.anonReplyText}>Reply Anonymously</Text>
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.divider} />
              <Text style={styles.repliesHeader}>
                {replies.length > 0 ? 'Replies' : 'No replies yet. Be the first!'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.replyCard}>
              <View style={styles.replyHeader}>
                <View style={[styles.replyAvatar, item.isAnonymous && styles.avatarAnonymous]}>
                  <Ionicons
                    name={item.isAnonymous ? 'eye-off' : 'person'}
                    size={12}
                    color={item.isAnonymous ? COLORS.textMuted : COLORS.primary}
                  />
                </View>
                <Text style={styles.replyAuthor}>
                  {item.isAnonymous ? 'Anonymous' : 'Someone'}
                </Text>
                {isOP(item.userId) && (
                  <View style={styles.opBadge}>
                    <Text style={styles.opBadgeText}>OP</Text>
                  </View>
                )}
                <Text style={styles.replyTime}>{getTimeAgo(item.createdAt)}</Text>
              </View>
              <Text style={styles.replyText}>{item.text}</Text>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />

        {/* Reply Input */}
        <View style={styles.replyInputBar}>
          <TextInput
            style={styles.replyInput}
            placeholder="Reply anonymously..."
            placeholderTextColor={COLORS.textMuted}
            value={replyText}
            onChangeText={setReplyText}
            maxLength={300}
            multiline
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !replyText.trim() && styles.sendButtonDisabled,
            ]}
            onPress={handleSendReply}
            disabled={!replyText.trim()}
          >
            <Ionicons
              name="send"
              size={18}
              color={replyText.trim() ? COLORS.white : COLORS.textMuted}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Chat Modal */}
      <ConfessionChatModal
        visible={!!activeChatModal}
        chat={activeChatModal}
        currentUserId={currentUserId}
        confessionText={confession?.text}
        onClose={() => setActiveChatModal(null)}
        onSendMessage={handleSendChatMessage}
        onAgreeReveal={() => {
          if (!activeChatModal) return;
          agreeMutualReveal(activeChatModal.id, currentUserId);
          const updated = useConfessionStore.getState().chats.find((c) => c.id === activeChatModal.id);
          if (updated) setActiveChatModal({ ...updated });
        }}
        onDeclineReveal={() => {
          if (!activeChatModal) return;
          declineMutualReveal(activeChatModal.id, currentUserId);
          const updated = useConfessionStore.getState().chats.find((c) => c.id === activeChatModal.id);
          if (updated) setActiveChatModal({ ...updated });
        }}
        onBlock={() => {
          setActiveChatModal(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
  confessionFull: {
    backgroundColor: COLORS.white,
    padding: 16,
    marginBottom: 8,
  },
  confessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  authorName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  timeAgo: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  topicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  topicEmoji: {
    fontSize: 12,
  },
  topicLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  confessionText: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.text,
    marginBottom: 16,
  },
  anonReplyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,107,107,0.08)',
    alignSelf: 'flex-start',
  },
  anonReplyText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginTop: 16,
    marginBottom: 12,
  },
  repliesHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  replyCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  replyAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  opBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  opBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  replyTime: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },
  replyText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
  },
  listContent: {
    paddingBottom: 16,
  },
  replyInputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  replyInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 80,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.border,
  },
});
