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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import EmojiPicker from 'rn-emoji-keyboard';
import { COLORS } from '@/lib/constants';
import { isProbablyEmoji } from '@/lib/utils';
import { ConfessionChat } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { useDemoStore } from '@/stores/demoStore';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId } from '@/convex/id';
import ConfessionCard from '@/components/confessions/ConfessionCard';
import SecretCrushCard from '@/components/confessions/SecretCrushCard';
import { useConfessionNotifications } from '@/hooks/useConfessionNotifications';
import { useScreenSafety } from '@/hooks/useScreenSafety';

export default function ConfessionsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = userId || 'demo_user_1';

  // Individual selectors to avoid full re-render on any store change
  const demoConfessions = useConfessionStore((s) => s.confessions);
  const userReactions = useConfessionStore((s) => s.userReactions);
  const secretCrushes = useConfessionStore((s) => s.secretCrushes);
  const chats = useConfessionStore((s) => s.chats);
  const seedConfessions = useConfessionStore((s) => s.seedConfessions);
  const demoToggleReaction = useConfessionStore((s) => s.toggleReaction);
  const demoReportConfession = useConfessionStore((s) => s.reportConfession);
  const addChat = useConfessionStore((s) => s.addChat);
  const revealCrush = useConfessionStore((s) => s.revealCrush);

  // Global blocked user IDs (from profile/chat block actions)
  const globalBlockedIds = useDemoStore((s) => s.blockedUserIds);

  const { notifyReaction, notifyReply } = useConfessionNotifications();
  const { safeTimeout } = useScreenSafety();
  const [refreshing, setRefreshing] = useState(false);
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
  const toggleReactionMutation = useMutation(api.confessions.toggleReaction);
  const reportConfessionMutation = useMutation(api.confessions.reportConfession);

  // Use Convex data when available, demo data as fallback
  const confessions = useMemo(() => {
    let items;
    if (!isDemoMode && convexConfessions) {
      items = convexConfessions.map((c: any) => ({
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
    } else {
      // Demo mode — sort by latest
      items = [...demoConfessions].sort((a, b) => b.createdAt - a.createdAt);
    }
    // Filter out confessions from globally blocked users
    if (globalBlockedIds.length > 0) {
      items = items.filter((c) => !globalBlockedIds.includes(c.userId));
    }
    return items;
  }, [isDemoMode, convexConfessions, demoConfessions, globalBlockedIds]);

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
    return scored.slice(0, 1);
  }, [isDemoMode, convexTrending, demoConfessions]);

  const myCrushes = useMemo(
    () => secretCrushes.filter((sc) => sc.toUserId === currentUserId && !sc.isRevealed),
    [secretCrushes, currentUserId]
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    safeTimeout(() => setRefreshing(false), 800);
  }, [safeTimeout]);

  const handleOpenEmojiPicker = useCallback((confessionId: string) => {
    setEmojiTargetConfessionId(confessionId);
    setShowEmojiPicker(true);
  }, []);

  const toggleReaction = useCallback(
    (confessionId: string, emoji: string) => {
      if (isDemoMode) {
        demoToggleReaction(confessionId, emoji);
        notifyReaction(confessionId);
        return;
      }
      const convexUserId = asUserId(currentUserId);
      demoToggleReaction(confessionId, emoji);
      if (!convexUserId) return; // no valid user id — skip mutation
      toggleReactionMutation({
        confessionId: confessionId as any,
        userId: convexUserId,
        type: emoji,
      }).catch(() => {
        demoToggleReaction(confessionId, emoji);
      });
      notifyReaction(confessionId);
    },
    [demoToggleReaction, notifyReaction, toggleReactionMutation, currentUserId]
  );

  const handleEmojiSelected = useCallback(
    (emojiObj: any) => {
      if (!emojiTargetConfessionId) return;
      toggleReaction(emojiTargetConfessionId, emojiObj.emoji);
    },
    [emojiTargetConfessionId, toggleReaction]
  );

  const handleOpenCompose = useCallback(() => {
    router.push('/(main)/compose-confession' as any);
  }, [router]);

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
        router.push(`/(main)/confession-chat?chatId=${existing.id}` as any);
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
      router.push(`/(main)/confession-chat?chatId=${newChat.id}` as any);
      notifyReply(confessionId);
    },
    [chats, currentUserId, addChat, notifyReply, router]
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
              const convexUserId = asUserId(currentUserId);
              if (!convexUserId) return;
              reportConfessionMutation({
                confessionId: confessionId as any,
                reporterId: convexUserId,
              }).catch(console.error);
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

  const renderListHeader = useCallback(() => (
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

        </View>
      )}
    </View>
  ), [myCrushes, trendingConfessions, trendingHero, handleRevealCrush, revealCrush, handleOpenThread]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Compact header */}
      <View style={styles.header}>
        <Ionicons name="megaphone" size={16} color={COLORS.primary} />
        <Text style={styles.headerTitle}>Confess</Text>
      </View>

      {/* Top hint */}
      <Text style={styles.topHint}>Anonymous by default • Be respectful</Text>

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
            onToggleEmoji={(emoji) => toggleReaction(item.id, emoji)}
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
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Finding confessions...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>No confessions yet</Text>
              <Text style={styles.emptySubtitle}>Be the first to share something — it's anonymous by default.</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={handleOpenCompose}>
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
        onPress={handleOpenCompose}
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
  topHint: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 80,
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
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
    marginBottom: 24,
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
