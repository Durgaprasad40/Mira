import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import EmojiPicker from 'rn-emoji-keyboard';
import { COLORS } from '@/lib/constants';
import { isProbablyEmoji } from '@/lib/utils';
import { ConfessionChat, ConfessionRevealPolicy, TimedRevealOption } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { isDemoMode } from '@/hooks/useConvex';
import ConfessionCard from '@/components/confessions/ConfessionCard';
import ComposeConfessionModal from '@/components/confessions/ComposeConfessionModal';
import SecretCrushCard from '@/components/confessions/SecretCrushCard';
import ConfessionChatModal from '@/components/confessions/ConfessionChatModal';
import { useConfessionNotifications } from '@/hooks/useConfessionNotifications';

export default function ConfessionsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();
  const currentUserId = userId || 'demo_user_1';

  const {
    confessions: demoConfessions,
    userReactions,
    secretCrushes,
    chats,
    seedConfessions,
    addConfession,
    toggleReaction: demoToggleReaction,
    reportConfession: demoReportConfession,
    addChat,
    addChatMessage,
    revealCrush,
    agreeMutualReveal,
    declineMutualReveal,
    setTimedReveal,
  } = useConfessionStore();

  const { notifyReaction, notifyReply } = useConfessionNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [activeChatModal, setActiveChatModal] = useState<ConfessionChat | null>(null);
  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // Emoji picker state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiTargetConfessionId, setEmojiTargetConfessionId] = useState<string | null>(null);

  // Seed demo data on mount
  useEffect(() => {
    seedConfessions();
  }, []);

  // Convex queries (only when not in demo mode)
  const convexConfessions = useQuery(
    api.confessions.listConfessions,
    !isDemoMode ? { sortBy: 'latest' as const } : 'skip'
  );
  const convexTrending = useQuery(
    api.confessions.getTrendingConfessions,
    !isDemoMode ? {} : 'skip'
  );

  // Convex mutations
  const createConfessionMutation = useMutation(api.confessions.createConfession);
  const toggleReactionMutation = useMutation(api.confessions.toggleReaction);
  const reportConfessionMutation = useMutation(api.confessions.reportConfession);

  // Use Convex data when available, demo data as fallback
  const confessions = useMemo(() => {
    if (!isDemoMode && convexConfessions) {
      return convexConfessions.map((c: any) => ({
        id: c._id,
        userId: c.userId,
        text: c.text,
        isAnonymous: c.isAnonymous,
        mood: c.mood,
        authorName: c.authorName,
        authorPhotoUrl: c.authorPhotoUrl,
        topEmojis: c.topEmojis || [],
        replyPreviews: c.replyPreviews || [],
        replyCount: c.replyCount,
        reactionCount: c.reactionCount,
        createdAt: c.createdAt,
        visibility: c.visibility,
        revealPolicy: 'never' as const,
      }));
    }
    // Demo mode — sort by latest
    return [...demoConfessions].sort((a, b) => b.createdAt - a.createdAt);
  }, [isDemoMode, convexConfessions, demoConfessions]);

  // Trending confessions
  const trendingConfessions = useMemo(() => {
    if (!isDemoMode && convexTrending) {
      return convexTrending.map((c: any) => ({
        id: c._id,
        userId: c.userId,
        text: c.text,
        isAnonymous: c.isAnonymous,
        mood: c.mood,
        authorName: c.authorName as string | undefined,
        replyCount: c.replyCount,
        reactionCount: c.reactionCount,
        createdAt: c.createdAt,
        trendingScore: c.trendingScore,
      }));
    }
    // Demo mode — compute trending locally
    const now = Date.now();
    const cutoff = now - 48 * 60 * 60 * 1000;
    const recent = demoConfessions.filter((c) => c.createdAt > cutoff);
    const scored = recent.map((c) => {
      const hoursSince = (now - c.createdAt) / (1000 * 60 * 60);
      const score = (c.reactionCount * 3 + c.replyCount * 4) / (hoursSince + 2);
      return { ...c, trendingScore: score };
    });
    scored.sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0));
    return scored.slice(0, 5);
  }, [isDemoMode, convexTrending, demoConfessions]);

  const myCrushes = useMemo(
    () => secretCrushes.filter((sc) => sc.toUserId === currentUserId && !sc.isRevealed),
    [secretCrushes, currentUserId]
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleOpenEmojiPicker = useCallback((confessionId: string) => {
    setEmojiTargetConfessionId(confessionId);
    setShowEmojiPicker(true);
  }, []);

  const handleEmojiSelected = useCallback(
    (emojiObj: any) => {
      if (!emojiTargetConfessionId) return;
      const emoji = emojiObj.emoji;
      if (isDemoMode) {
        demoToggleReaction(emojiTargetConfessionId, emoji);
        notifyReaction(emojiTargetConfessionId);
        return;
      }
      demoToggleReaction(emojiTargetConfessionId, emoji);
      toggleReactionMutation({
        confessionId: emojiTargetConfessionId as any,
        userId: currentUserId as any,
        type: emoji,
      }).catch(() => {
        demoToggleReaction(emojiTargetConfessionId!, emoji);
      });
      notifyReaction(emojiTargetConfessionId);
    },
    [emojiTargetConfessionId, demoToggleReaction, notifyReaction, toggleReactionMutation, currentUserId]
  );

  const handleCompose = useCallback(
    async (
      text: string,
      isAnonymous: boolean,
      _topic: any,
      targetUserId?: string,
      revealPolicy?: ConfessionRevealPolicy,
      timedReveal?: TimedRevealOption,
      _imageUrl?: string,
    ) => {
      const confessionId = `conf_new_${Date.now()}`;
      const newConfession = {
        id: confessionId,
        userId: currentUserId,
        text,
        isAnonymous,
        mood: 'emotional' as const,
        topEmojis: [],
        replyPreviews: [],
        targetUserId,
        visibility: 'global' as const,
        replyCount: 0,
        reactionCount: 0,
        createdAt: Date.now(),
        revealPolicy: revealPolicy || 'never',
      };

      addConfession(newConfession);

      if (!isDemoMode) {
        try {
          await createConfessionMutation({
            userId: currentUserId as any,
            text: text.trim(),
            isAnonymous,
            mood: 'emotional' as any,
            visibility: 'global' as any,
          });
        } catch (error: any) {
          Alert.alert('Error', error.message || 'Failed to post confession');
        }
      }

      if (timedReveal && timedReveal !== 'never' && targetUserId) {
        setTimedReveal(confessionId, timedReveal, targetUserId);
      }

      if (targetUserId) {
        const { addSecretCrush } = useConfessionStore.getState();
        addSecretCrush({
          id: `sc_new_${Date.now()}`,
          fromUserId: currentUserId,
          toUserId: targetUserId,
          confessionText: text,
          isRevealed: false,
          createdAt: Date.now(),
          expiresAt: Date.now() + 1000 * 60 * 60 * 48,
        });
      }

      setShowCompose(false);

      setShowToast(true);
      Animated.sequence([
        Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(1500),
        Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start(() => setShowToast(false));
    },
    [currentUserId, addConfession, setTimedReveal, toastOpacity, createConfessionMutation]
  );

  const handleOpenThread = useCallback(
    (confessionId: string) => {
      router.push({
        pathname: '/(main)/confession-thread',
        params: { confessionId },
      } as any);
    },
    [router]
  );

  const handleReplyAnonymously = useCallback(
    (confessionId: string, confessionUserId: string) => {
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
        responderId: confessionUserId,
        messages: [],
        isRevealed: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000 * 60 * 60 * 24,
        mutualRevealStatus: 'none',
      };
      addChat(newChat);
      setActiveChatModal(newChat);
      notifyReply(confessionId);
    },
    [chats, currentUserId, addChat, notifyReply]
  );

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

  const handleReport = useCallback(
    (confessionId: string) => {
      Alert.alert('Report Confession', 'Are you sure you want to report this confession?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: () => {
            demoReportConfession(confessionId);
            if (!isDemoMode) {
              reportConfessionMutation({
                confessionId: confessionId as any,
                reporterId: currentUserId as any,
              }).catch(() => {});
            }
          },
        },
      ]);
    },
    [demoReportConfession, reportConfessionMutation, currentUserId]
  );

  const handleRevealCrush = useCallback(
    (crushId: string) => {
      Alert.alert('Reveal Identity', 'Are you sure you want to reveal who sent this?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reveal',
          onPress: () => revealCrush(crushId),
        },
      ]);
    },
    [revealCrush]
  );

  const isLoading = !isDemoMode && convexConfessions === undefined && demoConfessions.length === 0;

  // Trending hero card (first trending confession, shown large)
  const trendingHero = trendingConfessions.length > 0 ? trendingConfessions[0] : null;

  const renderListHeader = () => (
    <View>
      {/* Secret Crushes */}
      {myCrushes.length > 0 && (
        <View style={styles.crushSection}>
          {myCrushes.map((crush) => (
            <SecretCrushCard
              key={crush.id}
              crush={crush}
              onReveal={() => handleRevealCrush(crush.id)}
              onDismiss={() => revealCrush(crush.id)}
            />
          ))}
        </View>
      )}

      {/* Trending Section */}
      {trendingConfessions.length > 0 && (
        <View style={styles.trendingSection}>
          <View style={styles.trendingSectionHeader}>
            <Ionicons name="flame" size={16} color="#FF6B00" />
            <Text style={styles.trendingSectionTitle}>Trending</Text>
          </View>

          {/* Hero card (first trending) */}
          {trendingHero && (
            <TouchableOpacity
              style={styles.trendingHeroCard}
              onPress={() => handleOpenThread(trendingHero.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.trendingHeroText} numberOfLines={3}>
                {trendingHero.text}
              </Text>
              <View style={styles.trendingHeroMeta}>
                <View style={styles.trendingHeroStat}>
                  <Ionicons name="chatbubble-outline" size={12} color={COLORS.white} />
                  <Text style={styles.trendingHeroStatText}>{trendingHero.replyCount}</Text>
                </View>
                <View style={styles.trendingHeroStat}>
                  <Ionicons name="heart-outline" size={12} color={COLORS.white} />
                  <Text style={styles.trendingHeroStatText}>{trendingHero.reactionCount}</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {/* Smaller trending chips */}
          {trendingConfessions.length > 1 && (
            <FlatList<any>
              data={trendingConfessions.slice(1, 5)}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.trendingChipsContainer}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.trendingChip}
                  onPress={() => handleOpenThread(item.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.trendingChipText} numberOfLines={2}>
                    {item.text}
                  </Text>
                  <View style={styles.trendingChipMeta}>
                    <Ionicons name="chatbubble-outline" size={10} color={COLORS.textMuted} />
                    <Text style={styles.trendingChipCount}>{item.replyCount}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Compact header */}
      <View style={styles.header}>
        <Ionicons name="megaphone" size={16} color={COLORS.primary} />
        <Text style={styles.headerTitle}>Confess</Text>
      </View>

      {/* Feed */}
      <FlatList
        data={confessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderListHeader}
        renderItem={({ item }) => (
          <ConfessionCard
            id={item.id}
            text={item.text}
            isAnonymous={item.isAnonymous}
            mood={item.mood}
            topEmojis={item.topEmojis || []}
            userEmoji={userReactions[item.id] && isProbablyEmoji(userReactions[item.id]!) ? userReactions[item.id]! : null}
            replyPreviews={item.replyPreviews || []}
            replyCount={item.replyCount}
            reactionCount={item.reactionCount}
            authorName={(item as any).authorName}
            createdAt={item.createdAt}
            onPress={() => handleOpenThread(item.id)}
            onReact={() => handleOpenEmojiPicker(item.id)}
            onReplyAnonymously={() => handleReplyAnonymously(item.id, item.userId)}
            onReport={() => handleReport(item.id)}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.emptyContainer}>
              <Ionicons name="megaphone-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>No confessions yet</Text>
              <Text style={styles.emptySubtitle}>Be the first to share something!</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => setShowCompose(true)}>
                <Text style={styles.emptyButtonText}>Post a Confession</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />

      {/* Success Toast */}
      {showToast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Ionicons name="checkmark-circle" size={18} color="#34C759" />
          <Text style={styles.toastText}>Posted anonymously</Text>
        </Animated.View>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowCompose(true)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={24} color={COLORS.white} />
      </TouchableOpacity>

      {/* Emoji Picker for reactions */}
      <EmojiPicker
        onEmojiSelected={handleEmojiSelected}
        open={showEmojiPicker}
        onClose={() => {
          setShowEmojiPicker(false);
          setEmojiTargetConfessionId(null);
        }}
      />

      {/* Compose Modal */}
      <ComposeConfessionModal
        visible={showCompose}
        onClose={() => setShowCompose(false)}
        onSubmit={handleCompose}
      />

      {/* Chat Modal */}
      <ConfessionChatModal
        visible={!!activeChatModal}
        chat={activeChatModal}
        currentUserId={currentUserId}
        confessionText={
          activeChatModal
            ? confessions.find((c) => c.id === activeChatModal.confessionId)?.text
            : undefined
        }
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  crushSection: {
    marginBottom: 4,
  },
  // Trending
  trendingSection: {
    marginBottom: 8,
    paddingTop: 8,
  },
  trendingSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  trendingSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  trendingHeroCard: {
    marginHorizontal: 10,
    borderRadius: 14,
    padding: 16,
    backgroundColor: COLORS.primary,
    marginBottom: 10,
  },
  trendingHeroText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    color: COLORS.white,
    marginBottom: 10,
  },
  trendingHeroMeta: {
    flexDirection: 'row',
    gap: 14,
  },
  trendingHeroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendingHeroStatText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
    opacity: 0.85,
  },
  trendingChipsContainer: {
    paddingHorizontal: 10,
    gap: 8,
  },
  trendingChip: {
    width: 160,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  trendingChipText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    color: COLORS.text,
    marginBottom: 6,
  },
  trendingChipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendingChipCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 96,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 80,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  toast: {
    position: 'absolute',
    top: 56,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 100,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
