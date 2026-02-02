import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import { DEMO_MATCHES, DEMO_LIKES } from '@/lib/demoData';
import { isActiveNow } from '@/lib/formatLastSeen';

export default function MessagesScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const convexConversations = useQuery(
    api.messages.getConversations,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const convexUnreadCount = useQuery(
    api.messages.getUnreadCount,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const convexCurrentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const convexLikesReceived = useQuery(
    api.likes.getLikesReceived,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const conversations = isDemoMode ? DEMO_MATCHES as any : convexConversations;
  const unreadCount = isDemoMode ? 1 : convexUnreadCount;
  const currentUser = isDemoMode ? { gender: 'male', messagesRemaining: 99, messagesResetAt: undefined } : convexCurrentUser;
  const likesReceived = isDemoMode ? DEMO_LIKES : convexLikesReceived;

  // Convex queries are real-time/reactive — no manual refetch needed.
  // Short spinner provides tactile feedback for the pull gesture.
  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 300);
  };

  // Separate super likes from regular likes
  const superLikes = (likesReceived || []).filter((l: any) => l.action === 'super_like');
  const regularLikes = (likesReceived || []).filter((l: any) => l.action !== 'super_like');

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
              onPress={() => router.push(`/profile/${item.userId}` as any)}
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
          <Text style={styles.sectionTitle}>New Likes</Text>
          <View style={[styles.countBadge, { backgroundColor: COLORS.primary + '20' }]}>
            <Text style={[styles.countBadgeText, { color: COLORS.primary }]}>{regularLikes.length}</Text>
          </View>
        </View>
        <FlatList
          horizontal
          data={regularLikes.slice(0, 10)}
          keyExtractor={(item: any) => item.likeId}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={styles.likeItem}
              activeOpacity={0.7}
              onPress={() => router.push(`/profile/${item.userId}` as any)}
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

  const renderQuotaBanner = () => {
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        {unreadCount !== undefined && unreadCount > 0 && (
          <Badge count={unreadCount} />
        )}
      </View>

      {renderQuotaBanner()}
      {renderSuperLikesRow()}
      {renderNewLikes()}

      <FlatList
        data={conversations || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ConversationItem
            id={item.id}
            otherUser={item.otherUser}
            lastMessage={item.lastMessage}
            unreadCount={item.unreadCount}
            isPreMatch={item.isPreMatch}
            onPress={() => router.push(`/(main)/chat/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySubtitle}>
              Start swiping to find matches and begin conversations!
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={
          (!conversations || conversations.length === 0) && styles.emptyListContainer
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
    paddingHorizontal: 16,
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
    paddingHorizontal: 16,
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
