import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { ConfessionMood, ConfessionReply } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import {
  DEMO_CONFESSIONS,
  DEMO_CONFESSION_REPLIES,
  DEMO_CONFESSION_USER_REACTIONS,
} from '@/lib/demoData';

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

  const confession = useMemo(
    () => DEMO_CONFESSIONS.find((c) => c.id === confessionId),
    [confessionId]
  );

  const [replies, setReplies] = useState<ConfessionReply[]>(
    () => (confessionId ? DEMO_CONFESSION_REPLIES[confessionId] : undefined) || []
  );
  const [replyText, setReplyText] = useState('');
  const [hasReacted, setHasReacted] = useState(
    () => !!(confessionId && DEMO_CONFESSION_USER_REACTIONS[confessionId])
  );
  const [reactionCount, setReactionCount] = useState(
    () => confession?.reactionCount ?? 0
  );

  const handleSendReply = useCallback(() => {
    if (!replyText.trim() || !confessionId) return;
    const newReply: ConfessionReply = {
      id: `cr_new_${Date.now()}`,
      confessionId,
      userId: userId || 'demo_user_1',
      text: replyText.trim(),
      isAnonymous: true,
      createdAt: Date.now(),
    };
    setReplies((prev) => [...prev, newReply]);
    setReplyText('');
  }, [replyText, confessionId, userId]);

  const handleToggleReaction = useCallback(() => {
    setHasReacted((prev) => {
      setReactionCount((c) => (prev ? Math.max(0, c - 1) : c + 1));
      return !prev;
    });
  }, []);

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

  const moodInfo = MOOD_CONFIG[confession.mood];
  const isOP = (replyUserId: string) =>
    replyUserId === confession.userId;

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
          <View style={{ width: 24 }} />
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
                <View style={[styles.moodBadge, { backgroundColor: moodInfo.bg }]}>
                  <Text style={styles.moodEmoji}>{moodInfo.emoji}</Text>
                  <Text style={[styles.moodLabel, { color: moodInfo.color }]}>{moodInfo.label}</Text>
                </View>
              </View>

              {/* Full text */}
              <Text style={styles.confessionText}>{confession.text}</Text>

              {/* Actions */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleToggleReaction}
                >
                  <Ionicons
                    name={hasReacted ? 'heart' : 'heart-outline'}
                    size={22}
                    color={hasReacted ? COLORS.primary : COLORS.textMuted}
                  />
                  <Text style={[styles.actionCount, hasReacted && { color: COLORS.primary }]}>
                    {reactionCount}
                  </Text>
                </TouchableOpacity>
                <View style={styles.actionButton}>
                  <Ionicons name="chatbubble-outline" size={20} color={COLORS.textMuted} />
                  <Text style={styles.actionCount}>{replies.length}</Text>
                </View>
              </View>

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
  moodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  moodEmoji: {
    fontSize: 12,
  },
  moodLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  confessionText: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.text,
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
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
