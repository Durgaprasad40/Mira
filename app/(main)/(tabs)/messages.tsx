import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { ConversationItem } from '@/components/chat';
import { useMessageQuota } from '@/hooks/useMessageQuota';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '@/components/ui';

export default function MessagesScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const conversations = useQuery(
    api.messages.getConversations,
    userId ? { userId: userId as any } : 'skip'
  );

  const unreadCount = useQuery(
    api.messages.getUnreadCount,
    userId ? { userId: userId as any } : 'skip'
  );

  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId: userId as any } : 'skip'
  );

  const likesReceived = useQuery(
    api.likes.getLikesReceived,
    userId ? { userId: userId as any } : 'skip'
  );

  const onRefresh = async () => {
    setRefreshing(true);
    // Convex queries auto-refresh, just wait a bit
    setTimeout(() => setRefreshing(false), 1000);
  };

  const renderNewMatches = () => {
    if (!likesReceived || likesReceived.length === 0) return null;

    return (
      <View style={styles.newMatchesSection}>
        <Text style={styles.sectionTitle}>New Likes</Text>
        <FlatList
          horizontal
          data={likesReceived.slice(0, 10)}
          keyExtractor={(item) => item.likeId}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.newMatchItem}
              onPress={() => {
                // Navigate to profile or start conversation
                router.push(`/(main)/profile/${item.userId}`);
              }}
            >
              {item.isBlurred ? (
                <View style={[styles.newMatchAvatar, styles.blurredAvatar]}>
                  <Ionicons name="lock-closed" size={20} color={COLORS.textLight} />
                </View>
              ) : (
                <View style={styles.newMatchAvatar}>
                  {item.photoUrl ? (
                    <Text style={styles.avatarText}>{item.name?.[0] || '?'}</Text>
                  ) : (
                    <Ionicons name="person" size={24} color={COLORS.textLight} />
                  )}
                </View>
              )}
              {item.action === 'super_like' && (
                <View style={styles.superLikeBadge}>
                  <Ionicons name="star" size={12} color={COLORS.superLike} />
                </View>
              )}
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.newMatchesList}
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        {unreadCount !== undefined && unreadCount > 0 && (
          <Badge count={unreadCount} />
        )}
      </View>

      {renderQuotaBanner()}
      {renderNewMatches()}

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
    </View>
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
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
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
  newMatchesSection: {
    marginTop: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  newMatchesList: {
    paddingHorizontal: 16,
  },
  newMatchItem: {
    marginRight: 12,
    alignItems: 'center',
  },
  newMatchAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  blurredAvatar: {
    borderColor: COLORS.border,
    opacity: 0.6,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '600',
    color: COLORS.text,
  },
  superLikeBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: COLORS.superLike,
    borderRadius: 10,
    padding: 2,
  },
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

