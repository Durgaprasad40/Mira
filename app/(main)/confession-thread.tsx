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
  LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import EmojiPicker from 'rn-emoji-keyboard';
import * as Clipboard from 'expo-clipboard';
import { COLORS, CONFESSION_TOPICS } from '@/lib/constants';
import { isProbablyEmoji } from '@/lib/utils';
import { Toast } from '@/components/ui/Toast';
import { ConfessionMood, ConfessionReply, ConfessionChat } from '@/types';
import ReactionBar from '@/components/confessions/ReactionBar';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { useDemoStore } from '@/stores/demoStore';
import { useBlockStore } from '@/stores/blockStore';
import { isDemoMode } from '@/hooks/useConvex';
import {
  DEMO_CONFESSION_REPLIES,
} from '@/lib/demoData';
import { shouldBlockConfessionOpen } from '@/lib/confessionsIntegrity';
import { logDebugEvent } from '@/lib/debugEventLogger';

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
  const insets = useSafeAreaInsets();
  const { confessionId } = useLocalSearchParams<{ confessionId: string }>();
  const { userId } = useAuthStore();
  const currentUserId = userId || 'demo_user_1';

  // Individual selectors to avoid full re-render on any store change
  const confessions = useConfessionStore((s) => s.confessions);
  const userReactions = useConfessionStore((s) => s.userReactions);
  const chats = useConfessionStore((s) => s.chats);
  const toggleReaction = useConfessionStore((s) => s.toggleReaction);
  const reportConfession = useConfessionStore((s) => s.reportConfession);
  const addChat = useConfessionStore((s) => s.addChat);
  const reportedIds = useConfessionStore((s) => s.reportedIds);
  const cleanupExpiredConfessions = useConfessionStore((s) => s.cleanupExpiredConfessions);
  const globalBlockedIds = useBlockStore((s) => s.blockedUserIds);

  const confession = useMemo(
    () => confessions.find((c) => c.id === confessionId),
    [confessions, confessionId]
  );

  // Navigation guard: prevent opening expired/blocked confessions
  const [guardTriggered, setGuardTriggered] = useState(false);
  useEffect(() => {
    if (guardTriggered || !confessionId) return;

    const blockReason = shouldBlockConfessionOpen(
      confessionId,
      confessions,
      globalBlockedIds,
      reportedIds,
    );

    if (blockReason) {
      setGuardTriggered(true);
      logDebugEvent('CHAT_EXPIRED', `Confession thread blocked: ${blockReason}`);

      // If expired, cleanup
      if (blockReason === 'expired') {
        cleanupExpiredConfessions([confessionId]);
      }

      router.back();
    }
  }, [confessionId, confessions, globalBlockedIds, reportedIds, guardTriggered, router, cleanupExpiredConfessions]);

  // Convex replies (live mode)
  const convexReplies = useQuery(
    api.confessions.getReplies,
    !isDemoMode && confessionId ? { confessionId: confessionId as any } : 'skip'
  );

  // Local demo replies
  const [demoReplies, setDemoReplies] = useState<ConfessionReply[]>(
    () => (confessionId ? DEMO_CONFESSION_REPLIES[confessionId] : undefined) || []
  );

  const replies: ConfessionReply[] = useMemo(() => {
    let items: ConfessionReply[];
    if (!isDemoMode && convexReplies) {
      items = convexReplies.map((r: any) => ({
        id: r._id,
        confessionId: r.confessionId,
        userId: r.userId,
        text: r.text,
        isAnonymous: r.isAnonymous,
        type: r.type || 'text',
        voiceUrl: r.voiceUrl,
        voiceDurationSec: r.voiceDurationSec,
        createdAt: r.createdAt,
      }));
    } else {
      items = demoReplies;
    }
    // Filter out replies from globally blocked users
    if (globalBlockedIds.length > 0) {
      items = items.filter((r) => !globalBlockedIds.includes(r.userId));
    }
    return items;
  }, [isDemoMode, convexReplies, demoReplies, globalBlockedIds]);

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  // Measure nav bar height for KeyboardAvoidingView offset
  const [navBarHeight, setNavBarHeight] = useState(0);
  const onNavBarLayout = useCallback((e: LayoutChangeEvent) => {
    setNavBarHeight(e.nativeEvent.layout.height);
  }, []);

  // Convex mutations
  const createReplyMutation = useMutation(api.confessions.createReply);
  const deleteReplyMutation = useMutation(api.confessions.deleteReply);
  const reportMutation = useMutation(api.confessions.reportConfession);
  const toggleReactionMutation = useMutation(api.confessions.toggleReaction);

  const handleSendReply = useCallback(async () => {
    if (!replyText.trim() || !confessionId || sending) return;

    const submittedText = replyText.trim();
    const newReply: ConfessionReply = {
      id: `cr_new_${Date.now()}`,
      confessionId,
      userId: currentUserId,
      text: submittedText,
      isAnonymous: true,
      type: 'text',
      createdAt: Date.now(),
    };

    setDemoReplies((prev) => [...prev, newReply]);
    setReplyText('');
    setSending(true);

    if (!isDemoMode) {
      try {
        await createReplyMutation({
          confessionId: confessionId as any,
          userId: currentUserId as any,
          text: submittedText,
          isAnonymous: true,
          type: 'text',
        });
      } catch {
        Toast.show('Couldn\u2019t send reply. Please try again.');
        setDemoReplies((prev) => prev.filter((r) => r.id !== newReply.id));
        setReplyText(submittedText);
      }
    }
    setSending(false);
  }, [replyText, confessionId, currentUserId, createReplyMutation, sending]);

  const handleDeleteReply = useCallback(async (reply: ConfessionReply) => {
    if (reply.userId !== currentUserId) return;

    Alert.alert('Delete Reply', 'Are you sure you want to delete this reply?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDemoReplies((prev) => prev.filter((r) => r.id !== reply.id));
          if (!isDemoMode) {
            try {
              await deleteReplyMutation({
                replyId: reply.id as any,
                userId: currentUserId as any,
              });
            } catch (error: any) {
              setDemoReplies((prev) => [...prev, reply]);
              Toast.show('Couldn\u2019t delete reply. Please try again.');
            }
          }
        },
      },
    ]);
  }, [currentUserId, deleteReplyMutation]);

  const handleReactEmoji = useCallback(
    (emojiObj: any) => {
      if (!confession) return;
      const emoji = emojiObj.emoji;
      toggleReaction(confession.id, emoji);
      if (!isDemoMode) {
        toggleReactionMutation({
          confessionId: confession.id as any,
          userId: currentUserId as any,
          type: emoji,
        }).catch(() => {
          toggleReaction(confession.id, emoji);
        });
      }
    },
    [confession, toggleReaction, toggleReactionMutation, currentUserId]
  );

  const handleReplyAnonymously = useCallback(() => {
    if (!confession || !confessionId) return;
    const existing = chats.find(
      (c) => c.confessionId === confessionId &&
        (c.initiatorId === currentUserId || c.responderId === currentUserId)
    );
    if (existing) {
      router.push(`/(main)/confession-chat?chatId=${existing.id}` as any);
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
    router.push(`/(main)/confession-chat?chatId=${newChat.id}` as any);
  }, [confession, confessionId, chats, currentUserId, addChat, router]);

  const handleReport = useCallback(() => {
    if (!confessionId) return;
    Alert.alert('Report Confession', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () => {
          reportConfession(confessionId);
          if (!isDemoMode) {
            reportMutation({
              confessionId: confessionId as any,
              reporterId: currentUserId as any,
            }).catch(console.error);
          }
          router.back();
        },
      },
    ]);
  }, [confessionId, reportConfession, reportMutation, currentUserId, router]);

  const handleCopyText = useCallback(async () => {
    if (!confession) return;
    await Clipboard.setStringAsync(confession.text);
  }, [confession]);

  const handleMenu = useCallback(() => {
    Alert.alert('Options', undefined, [
      { text: 'Copy Text', onPress: handleCopyText },
      { text: 'Report', style: 'destructive', onPress: handleReport },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleCopyText, handleReport]);

  const handleEmojiSelected = useCallback((emoji: any) => {
    setReplyText((prev) => prev + emoji.emoji);
  }, []);

  if (!confession) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>💬</Text>
          <Text style={styles.emptyTitle}>Confession not found</Text>
          <Text style={styles.emptySubtitle}>It may have been removed or is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const badgeInfo = confession.topic
    ? CONFESSION_TOPICS[confession.topic]
    : MOOD_CONFIG[confession.mood];
  const rawReaction = userReactions[confession.id] || null;
  const myReaction = rawReaction && isProbablyEmoji(rawReaction) ? rawReaction : null;
  const topEmojis = confession.topEmojis || [];
  const isOP = (replyUserId: string) => replyUserId === confession.userId;
  const displayName = confession.isAnonymous ? 'Anonymous' : ((confession as any).authorName || 'Someone');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        {/* Nav Bar */}
        <View style={styles.navBar} onLayout={onNavBarLayout}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Thread</Text>
          <TouchableOpacity onPress={handleMenu} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
                  <Text style={styles.authorName}>{displayName}</Text>
                  <Text style={styles.timeAgo}>{getTimeAgo(confession.createdAt)}</Text>
                </View>
                <View style={[styles.topicBadge, { backgroundColor: badgeInfo.bg }]}>
                  <Text style={styles.topicEmoji}>{badgeInfo.emoji}</Text>
                  <Text style={[styles.topicLabel, { color: badgeInfo.color }]}>{badgeInfo.label}</Text>
                </View>
              </View>

              {/* Full text */}
              <Text style={styles.confessionText}>{confession.text}</Text>

              {/* Emoji Reactions */}
              <View style={styles.reactionBarWrap}>
                <ReactionBar
                  topEmojis={topEmojis}
                  userEmoji={myReaction}
                  reactionCount={confession.reactionCount}
                  onReact={() => setShowReactionPicker(true)}
                  onToggleEmoji={(emoji) => {
                    toggleReaction(confession.id, emoji);
                    if (!isDemoMode) {
                      toggleReactionMutation({
                        confessionId: confession.id as any,
                        userId: currentUserId as any,
                        type: emoji,
                      }).catch(() => {
                        toggleReaction(confession.id, emoji);
                      });
                    }
                  }}
                  size="regular"
                />
              </View>

              {/* Anonymous Reply Button */}
              <TouchableOpacity style={styles.anonReplyButton} onPress={handleReplyAnonymously}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.primary} />
                <Text style={styles.anonReplyText}>Reply Anonymously</Text>
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.divider} />
              <Text style={styles.repliesHeader}>
                {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? 'Reply' : 'Replies'}` : 'No replies yet. Be the first!'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.replyCard}
              onLongPress={() => {
                if (item.userId === currentUserId) {
                  handleDeleteReply(item);
                }
              }}
              activeOpacity={0.8}
            >
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
                {item.type === 'voice' && (
                  <View style={styles.voiceBadge}>
                    <Ionicons name="mic" size={10} color={COLORS.primary} />
                  </View>
                )}
                <Text style={styles.replyTime}>{getTimeAgo(item.createdAt)}</Text>
                {item.userId === currentUserId && (
                  <TouchableOpacity
                    onPress={() => handleDeleteReply(item)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginLeft: 4 }}
                  >
                    <Ionicons name="trash-outline" size={14} color={COLORS.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.replyText}>
                {item.type === 'voice' ? `🎙️ Voice reply (${item.voiceDurationSec || 0}s)` : item.text}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={[styles.listContent, { paddingBottom: 16 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        />

        {/* Reply Input Bar — text + emoji only (no camera/media) */}
        <View style={[styles.replyInputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TouchableOpacity onPress={() => setShowEmojiPicker(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 20 }}>🙂</Text>
          </TouchableOpacity>
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
              (!replyText.trim() || sending) && styles.sendButtonDisabled,
            ]}
            onPress={handleSendReply}
            disabled={!replyText.trim() || sending}
          >
            <Ionicons
              name="send"
              size={18}
              color={replyText.trim() && !sending ? COLORS.white : COLORS.textMuted}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Emoji Picker for reply text */}
      <EmojiPicker
        onEmojiSelected={handleEmojiSelected}
        open={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
      />

      {/* Emoji Picker for reactions */}
      <EmojiPicker
        onEmojiSelected={handleReactEmoji}
        open={showReactionPicker}
        onClose={() => setShowReactionPicker(false)}
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
    padding: 24,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
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
  reactionBarWrap: {
    marginBottom: 8,
  },
  anonReplyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
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
  voiceBadge: {
    backgroundColor: 'rgba(255,107,107,0.1)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
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
    paddingTop: 10,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.border,
  },
});
