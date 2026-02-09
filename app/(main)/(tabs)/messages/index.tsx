import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LoadingGuard } from '@/components/safety';
import { Image } from 'expo-image';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { ConversationItem } from '@/components/chat';
import { useMessageQuota } from '@/hooks/useMessageQuota';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '@/components/ui';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId } from '@/convex/id';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { isActiveNow } from '@/lib/formatLastSeen';
import { useScreenSafety } from '@/hooks/useScreenSafety';
import { getProfileCompleteness, NUDGE_MESSAGES } from '@/lib/profileCompleteness';
import { ProfileNudge } from '@/components/ui/ProfileNudge';
import {
  processThreadsIntegrity,
  processLikesIntegrity,
  type ProcessedThread,
  type LikeItem,
} from '@/lib/threadsIntegrity';

export default function MessagesScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const convexUserId = asUserId(userId);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0); // For LoadingGuard retry
  const { safeTimeout } = useScreenSafety();

  // Demo store — seed on mount, read mutable matches/likes
  const demoMatches = useDemoStore((s) => s.matches);
  const demoLikes = useDemoStore((s) => s.likes);
  const demoSeed = useDemoStore((s) => s.seed);
  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);
  React.useEffect(() => { if (isDemoMode) demoSeed(); }, [demoSeed]);

  const convexConversations = useQuery(
    api.messages.getConversations,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  const convexUnreadCount = useQuery(
    api.messages.getUnreadCount,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  const convexCurrentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  const convexLikesReceived = useQuery(
    api.likes.getLikesReceived,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // In demo mode, build thread model from DM store messages using threadsIntegrity
  const demoMeta = useDemoDmStore((s) => s.meta);
  const demoConversations = useDemoDmStore((s) => s.conversations);
  const cleanupExpiredThreads = useDemoDmStore((s) => s.cleanupExpiredThreads);

  // Single source of truth: use processThreadsIntegrity for all demo thread categorization
  const {
    newMatches: demoNewMatches,
    messageThreads: demoMessageThreads,
    confessionThreads: demoConfessionThreads,
    expiredThreadIds,
    totalUnreadCount: demoUnreadCount,
  } = useMemo(() => {
    if (!isDemoMode) {
      return {
        newMatches: [],
        messageThreads: [],
        confessionThreads: [],
        expiredThreadIds: [],
        totalUnreadCount: 0,
      };
    }
    return processThreadsIntegrity({
      matches: demoMatches,
      conversations: demoConversations,
      meta: demoMeta,
      blockedUserIds,
      currentUserId: userId ?? undefined,
    });
  }, [isDemoMode, demoMatches, demoConversations, demoMeta, blockedUserIds, userId]);

  // Cleanup expired threads on mount/refresh
  useEffect(() => {
    if (isDemoMode && expiredThreadIds.length > 0) {
      cleanupExpiredThreads(expiredThreadIds);
    }
  }, [isDemoMode, expiredThreadIds, cleanupExpiredThreads]);

  // Combine message threads + confession threads for the main list
  const demoThreads = useMemo(() => {
    if (!isDemoMode) return [];
    // Merge and sort by activity (already sorted individually, merge-sort)
    return [...demoMessageThreads, ...demoConfessionThreads].sort(
      (a, b) => b._sortTs - a._sortTs
    );
  }, [isDemoMode, demoMessageThreads, demoConfessionThreads]);

  const conversations = isDemoMode ? demoThreads : convexConversations;
  const unreadCount = isDemoMode ? demoUnreadCount : convexUnreadCount;
  const currentUser = isDemoMode ? { gender: 'male', messagesRemaining: 999999, messagesResetAt: undefined, subscriptionTier: 'premium' as const } : convexCurrentUser;

  // Build matched user IDs set for likes filtering
  const matchedUserIds = useMemo(() => {
    return new Set(demoMatches.map((m) => m.otherUser?.id).filter(Boolean) as string[]);
  }, [demoMatches]);

  // In demo mode, use processLikesIntegrity for likes processing
  const { superLikes, regularLikes } = useMemo(() => {
    if (!isDemoMode) {
      // For Convex mode, process similarly but from convexLikesReceived
      const likes = (convexLikesReceived || []) as LikeItem[];
      return processLikesIntegrity({
        likes,
        blockedUserIds,
        matchedUserIds,
      });
    }
    return processLikesIntegrity({
      likes: demoLikes.map((l) => ({ ...l, isBlurred: false })) as LikeItem[],
      blockedUserIds,
      matchedUserIds,
    });
  }, [isDemoMode, demoLikes, convexLikesReceived, blockedUserIds, matchedUserIds]);

  // Profile completeness nudge — messages tab only shows for needs_both
  const dismissedNudges = useDemoStore((s) => s.dismissedNudges);
  const dismissNudge = useDemoStore((s) => s.dismissNudge);
  const nudgeUser = isDemoMode ? getDemoCurrentUser() : convexCurrentUser;
  const messagesNudgeStatus = nudgeUser
    ? getProfileCompleteness({
        photoCount: Array.isArray(nudgeUser.photos) ? nudgeUser.photos.length : 0,
        bioLength: (nudgeUser as any).bio?.length ?? 0,
      })
    : 'complete';
  const showMessagesNudge =
    messagesNudgeStatus === 'needs_both' && !dismissedNudges.includes('messages');

  // Convex queries are real-time/reactive — no manual refetch needed.
  // Short spinner provides tactile feedback for the pull gesture.
  const onRefresh = async () => {
    setRefreshing(true);
    safeTimeout(() => setRefreshing(false), 300);
  };

  // superLikes and regularLikes are now computed via processLikesIntegrity above
  const renderSuperLikesRow = () => {
    if (superLikes.length === 0) return null;

    return (
      <View style={styles.superLikesSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="star" size={18} color={COLORS.superLike} />
          <Text style={styles.sectionTitle}>Super Likes</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{superLikes.length}</Text>
          </View>
        </View>
        <FlatList
          horizontal
          data={superLikes.slice(0, 10)}
          keyExtractor={(item: any) => item.likeId}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={styles.superLikeItem}
              activeOpacity={0.7}
              onPress={() => router.push(`/(main)/profile/${item.userId}` as any)}
            >
              <View style={styles.superLikeAvatarContainer}>
                <View style={styles.superLikeRing}>
                  {item.photoUrl && !item.isBlurred ? (
                    <Image
                      source={{ uri: item.photoUrl }}
                      style={styles.superLikeAvatar}
                      contentFit="cover"
                    />
                  ) : item.isBlurred ? (
                    <View style={[styles.superLikeAvatar, styles.blurredAvatar]}>
                      <Ionicons name="lock-closed" size={18} color={COLORS.textLight} />
                    </View>
                  ) : (
                    <View style={[styles.superLikeAvatar, styles.placeholderAvatar]}>
                      <Text style={styles.avatarInitial}>{item.name?.[0] || '?'}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.superLikeStarBadge}>
                  <Ionicons name="star" size={10} color={COLORS.white} />
                </View>
              </View>
              <Text style={styles.superLikeName} numberOfLines={1}>{item.name || 'Someone'}</Text>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.superLikesList}
        />
      </View>
    );
  };

  const renderNewLikes = () => {
    if (regularLikes.length === 0) return null;

    return (
      <View style={styles.newLikesSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="heart" size={18} color={COLORS.primary} />
          <Text style={styles.sectionTitle}>Likes</Text>
          <View style={[styles.countBadge, { backgroundColor: COLORS.primary + '20' }]}>
            <Text style={[styles.countBadgeText, { color: COLORS.primary }]}>{regularLikes.length}</Text>
          </View>
          <TouchableOpacity
            style={styles.viewAllButton}
            onPress={() => router.push('/(main)/likes' as any)}
          >
            <Text style={styles.viewAllText}>View all</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          horizontal
          data={regularLikes.slice(0, 10)}
          keyExtractor={(item: any) => item.likeId}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={styles.likeItem}
              activeOpacity={0.7}
              onPress={() => router.push(`/(main)/profile/${item.userId}` as any)}
            >
              <View style={styles.likeAvatarContainer}>
                {item.photoUrl && !item.isBlurred ? (
                  <Image
                    source={{ uri: item.photoUrl }}
                    style={styles.likeAvatar}
                    contentFit="cover"
                  />
                ) : item.isBlurred ? (
                  <View style={[styles.likeAvatar, styles.blurredAvatar]}>
                    <Ionicons name="lock-closed" size={18} color={COLORS.textLight} />
                  </View>
                ) : (
                  <View style={[styles.likeAvatar, styles.placeholderAvatar]}>
                    <Text style={styles.avatarInitial}>{item.name?.[0] || '?'}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.likeName} numberOfLines={1}>{item.name || 'Someone'}</Text>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.likesList}
        />
      </View>
    );
  };

  // ── New Matches row (demo mode) ──
  // Shows matches that have NO messages yet as a horizontal avatar row.
  // Now uses demoNewMatches from processThreadsIntegrity (single source of truth).
  const newMatches = demoNewMatches;

  const renderNewMatchesRow = () => {
    if (newMatches.length === 0) return null;
    return (
      <View style={styles.newMatchesSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="heart-circle" size={18} color={COLORS.primary} />
          <Text style={styles.sectionTitle}>New Matches</Text>
          <View style={[styles.countBadge, { backgroundColor: COLORS.primary + '20' }]}>
            <Text style={[styles.countBadgeText, { color: COLORS.primary }]}>{newMatches.length}</Text>
          </View>
        </View>
        <FlatList
          horizontal
          data={newMatches}
          keyExtractor={(item: any) => item.id}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={styles.matchItem}
              activeOpacity={0.7}
              onPress={() => router.push(`/(main)/(tabs)/messages/chat/${item.conversationId}` as any)}
            >
              <View style={styles.matchAvatarContainer}>
                <View style={styles.matchRing}>
                  {item.otherUser?.photoUrl ? (
                    <Image
                      source={{ uri: item.otherUser.photoUrl }}
                      style={styles.matchAvatar}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.matchAvatar, styles.placeholderAvatar]}>
                      <Text style={styles.avatarInitial}>{item.otherUser?.name?.[0] || '?'}</Text>
                    </View>
                  )}
                </View>
              </View>
              <Text style={styles.matchName} numberOfLines={1}>{item.otherUser?.name || 'Someone'}</Text>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.matchesList}
        />
      </View>
    );
  };

  const renderQuotaBanner = () => {
    if (isDemoMode) return null; // demo = unlimited, no quota banner
    if (!currentUser || currentUser.gender === 'female') return null;
    if (currentUser.messagesRemaining === undefined) return null;

    const messagesRemaining = currentUser.messagesRemaining || 0;
    const resetDate = currentUser.messagesResetAt
      ? new Date(currentUser.messagesResetAt)
      : null;

    if (messagesRemaining <= 0 && resetDate) {
      return (
        <View style={styles.quotaBanner}>
          <Ionicons name="information-circle" size={20} color={COLORS.warning} />
          <View style={styles.quotaContent}>
            <Text style={styles.quotaTitle}>No messages remaining</Text>
            <Text style={styles.quotaSubtitle}>
              Resets {resetDate.toLocaleDateString()}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.upgradeButton}
            onPress={() => router.push('/(main)/subscription')}
          >
            <Text style={styles.upgradeButtonText}>Upgrade</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (messagesRemaining > 0) {
      return (
        <View style={[styles.quotaBanner, styles.quotaBannerActive]}>
          <Ionicons name="chatbubbles" size={20} color={COLORS.primary} />
          <Text style={styles.quotaText}>
            {messagesRemaining} {messagesRemaining === 1 ? 'message' : 'messages'} remaining this week
          </Text>
        </View>
      );
    }

    return null;
  };

  // Loading state — live mode only; demo data is instant
  const isLoading = !isDemoMode && conversations === undefined;

  if (isLoading) {
    return (
      <LoadingGuard
        isLoading={true}
        onRetry={() => setRetryKey((k) => k + 1)}
        title="Loading conversations…"
        subtitle="This is taking longer than expected. Check your connection and try again."
      >
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          <View style={styles.header}>
            <Text style={styles.title}>Messages</Text>
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.helperText}>Loading your conversations...</Text>
          </View>
        </SafeAreaView>
      </LoadingGuard>
    );
  }

  useEffect(() => {
    if (__DEV__ && isDemoMode) {
      console.log(`[Messages] DEMO COUNTS: threads=${(conversations || []).length} newMatches=${newMatches.length} confessionThreads=${demoConfessionThreads.length} likes=${regularLikes.length} super=${superLikes.length} matched=${matchedUserIds.size} storeLikes=${demoLikes.length} user=${userId ?? 'none'}`);
    }
  }, [conversations, newMatches, demoConfessionThreads, regularLikes, superLikes, matchedUserIds, demoLikes, userId]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        {unreadCount !== undefined && unreadCount > 0 && (
          <Badge count={unreadCount} />
        )}
      </View>

      <FlatList
        data={(conversations || []) as any[]}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }: { item: any }) => (
          <ConversationItem
            id={item.id}
            otherUser={item.otherUser}
            lastMessage={item.lastMessage}
            unreadCount={item.unreadCount}
            isPreMatch={item.isPreMatch}
            onPress={() => router.push(`/(main)/(tabs)/messages/chat/${item.conversationId || item.id}` as any)}
          />
        )}
        ListHeaderComponent={
          <>
            {showMessagesNudge && (
              <ProfileNudge
                message={NUDGE_MESSAGES.needs_both.messages}
                onDismiss={() => dismissNudge('messages')}
              />
            )}
            {renderQuotaBanner()}
            {renderNewMatchesRow()}
            {renderSuperLikesRow()}
            {renderNewLikes()}
            {(newMatches.length > 0 || superLikes.length > 0 || regularLikes.length > 0) && (conversations || []).length > 0 && (
              <View style={styles.threadsSectionHeader}>
                <Text style={styles.sectionTitle}>Messages</Text>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySubtitle}>
              When you match or start a chat, it will appear here.
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={
          (!conversations || conversations.length === 0) && newMatches.length === 0 && !(superLikes.length > 0 || regularLikes.length > 0)
            ? styles.emptyListContainer
            : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  quotaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning + '20',
    padding: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  quotaBannerActive: {
    backgroundColor: COLORS.primary + '20',
  },
  quotaContent: {
    flex: 1,
    marginLeft: 12,
  },
  quotaTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  quotaSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  quotaText: {
    fontSize: 14,
    color: COLORS.primary,
    marginLeft: 12,
    fontWeight: '500',
  },
  upgradeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  upgradeButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },

  // ── New Matches Section ──
  newMatchesSection: {
    marginTop: 16,
    marginBottom: 4,
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
    marginBottom: 6,
  },
  matchRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  matchAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.backgroundDark,
  },
  matchName: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
    textAlign: 'center',
  },

  // ── Super Likes Section (Tinder-style) ──
  superLikesSection: {
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
    color: COLORS.text,
  },
  countBadge: {
    backgroundColor: COLORS.superLike + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.superLike,
  },
  superLikesList: {
    paddingLeft: 16,
    paddingRight: 24,
  },
  superLikeItem: {
    marginRight: 16,
    alignItems: 'center',
    width: 72,
  },
  superLikeAvatarContainer: {
    position: 'relative',
    marginBottom: 6,
  },
  superLikeRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2.5,
    borderColor: COLORS.superLike,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  superLikeAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.backgroundDark,
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
    borderColor: COLORS.background,
  },
  superLikeName: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
    textAlign: 'center',
  },

  // ── New Likes Section ──
  newLikesSection: {
    marginTop: 12,
    marginBottom: 4,
  },
  likesList: {
    paddingLeft: 16,
    paddingRight: 24,
  },
  likeItem: {
    marginRight: 14,
    alignItems: 'center',
    width: 64,
  },
  likeAvatarContainer: {
    marginBottom: 6,
  },
  likeAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  blurredAvatar: {
    borderColor: COLORS.border,
    opacity: 0.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: '600',
    color: COLORS.text,
  },
  likeName: {
    fontSize: 11,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  viewAllButton: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },

  // ── Threads section divider ──
  threadsSectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 12,
  },

  // ── Loading ──
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  helperText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },

  // ── Conversations List ──
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyListContainer: {
    flexGrow: 1,
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
    lineHeight: 20,
  },
});
