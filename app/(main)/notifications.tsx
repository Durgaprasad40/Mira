import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { useNotifications, useDemoNotifStore, type AppNotification } from '@/hooks/useNotifications';
import { useDemoStore } from '@/stores/demoStore';
import { isDemoMode } from '@/hooks/useConvex';
import { log } from '@/utils/logger';

interface NotificationGroup {
  title: string;
  notifications: AppNotification[];
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  // ── Single source of truth — same hook the bell badge uses ──
  const { notifications, unseenCount, markAllSeen, markRead, cleanupExpiredNotifications } = useNotifications();

  // ── Demo mode: access likes and crossedPaths to validate notification invariants ──
  const demoLikes = useDemoStore((s) => s.likes);
  const demoCrossedPaths = useDemoStore((s) => s.crossedPaths);
  const removeLikeNotificationsForUser = useDemoNotifStore((s) => s.removeLikeNotificationsForUser);
  const removeCrossedPathNotificationsForUser = useDemoNotifStore((s) => s.removeCrossedPathNotificationsForUser);

  // ── Cleanup expired notifications on mount ──
  useEffect(() => {
    cleanupExpiredNotifications();
  }, [cleanupExpiredNotifications]);

  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const groupNotifications = (notifs: AppNotification[]): NotificationGroup[] => {
    if (!notifs || notifs.length === 0) return [];

    const now = Date.now();
    const today = new Date(now).setHours(0, 0, 0, 0);
    const yesterday = today - 24 * 60 * 60 * 1000;
    const thisWeek = today - 7 * 24 * 60 * 60 * 1000;

    const groups: NotificationGroup[] = [
      { title: 'Today', notifications: [] },
      { title: 'Yesterday', notifications: [] },
      { title: 'This Week', notifications: [] },
      { title: 'Earlier', notifications: [] },
    ];

    notifs.forEach((notif) => {
      const notifTime = notif.createdAt;
      if (notifTime >= today) {
        groups[0].notifications.push(notif);
      } else if (notifTime >= yesterday) {
        groups[1].notifications.push(notif);
      } else if (notifTime >= thisWeek) {
        groups[2].notifications.push(notif);
      } else {
        groups[3].notifications.push(notif);
      }
    });

    return groups.filter((group) => group.notifications.length > 0);
  };

  // 4-4: Pass notificationId in navigation params so destination knows why it was opened
  const handleNotificationPress = (notification: AppNotification) => {
    if (!notification.isRead) {
      markRead(notification._id);
    }

    // 4-4: Build common query params for context
    const notifParams = `source=notification&notificationId=${notification._id}`;
    const dedupeParam = notification.dedupeKey ? `&dedupeKey=${encodeURIComponent(notification.dedupeKey)}` : '';

    switch (notification.type) {
      case 'match':
      case 'new_match':
      case 'match_created':
        if (notification.data?.otherUserId) {
          const mId = notification.data.matchId ?? `match_${notification.data.otherUserId}`;
          router.push(`/(main)/match-celebration?matchId=${mId}&userId=${notification.data.otherUserId}&${notifParams}${dedupeParam}` as any);
        }
        break;
      case 'like':
      case 'like_received':
      case 'super_like':
      case 'superlike':
      case 'super_like_received': {
        // INVARIANT: A like_received notification may exist IF AND ONLY IF a pending Like exists
        // Validate the like still exists before navigating to Likes screen
        const likeUserId = notification.data?.otherUserId;

        if (isDemoMode && likeUserId) {
          const likeExists = demoLikes.some((l) => l.userId === likeUserId);

          if (!likeExists) {
            // Like no longer exists - this is an orphaned notification
            log.warn('[BUG]', 'like_notification_without_like', { profileId: likeUserId });

            // Remove the orphaned notification to prevent future taps
            removeLikeNotificationsForUser(likeUserId);

            // Navigate to Messages home instead of Likes (NEVER show empty Likes screen)
            router.push({
              pathname: '/(main)/(tabs)/messages',
              params: {
                source: 'notification',
                notificationId: notification._id,
              },
            } as any);
            return;
          }
        }

        // Like exists - navigate to Messages tab with focus on Likes section
        router.push({
          pathname: '/(main)/(tabs)/messages',
          params: {
            focus: 'likes',
            profileId: likeUserId,
            source: 'notification',
            notificationId: notification._id,
            dedupeKey: notification.dedupeKey,
          },
        } as any);
        break;
      }
      case 'message':
      case 'new_message':
        if (notification.data?.conversationId) {
          router.push(`/(main)/(tabs)/messages/chat/${notification.data.conversationId}?${notifParams}${dedupeParam}` as any);
        } else if (notification.data?.userId) {
          router.push(`/(main)/(tabs)/messages/chat/${notification.data.userId}?${notifParams}${dedupeParam}` as any);
        }
        break;
      case 'crossed_paths': {
        // INVARIANT: A crossed_paths notification may exist IF AND ONLY IF a crossedPaths entry exists
        // Validate the crossed path still exists before navigating to Nearby screen
        const crossedUserId = notification.data?.otherUserId;

        if (isDemoMode && crossedUserId) {
          const crossedPathExists = demoCrossedPaths.some((cp) => cp.otherUserId === crossedUserId);

          if (!crossedPathExists) {
            // Crossed path no longer exists - this is an orphaned notification
            log.warn('[BUG]', 'crossed_paths_notification_without_entry', { profileId: crossedUserId });

            // Remove the orphaned notification to prevent future taps
            removeCrossedPathNotificationsForUser(crossedUserId);

            // Navigate to Nearby home instead of focusing on a specific profile
            router.push({
              pathname: '/(main)/(tabs)/nearby',
              params: {
                source: 'notification',
                notificationId: notification._id,
              },
            } as any);
            return;
          }
        }

        // Crossed path exists - navigate to Nearby with focus on crossed_paths section
        router.push({
          pathname: '/(main)/(tabs)/nearby',
          params: {
            focus: 'crossed_paths',
            profileId: crossedUserId,
            source: 'notification',
            notificationId: notification._id,
            dedupeKey: notification.dedupeKey,
          },
        } as any);
        break;
      }
      case 'profile_viewed':
        router.push(`/(main)/(tabs)/home?${notifParams}${dedupeParam}` as any);
        break;
      case 'system':
        router.push(`/(main)/settings?${notifParams}${dedupeParam}` as any);
        break;
      case 'subscription':
        router.push(`/(main)/subscription?${notifParams}${dedupeParam}` as any);
        break;
      case 'confession_reaction':
      case 'confession_reply':
        if (notification.data?.confessionId) {
          router.push({
            pathname: '/(main)/confession-thread',
            params: {
              confessionId: notification.data.confessionId,
              source: 'notification',
              notificationId: notification._id,
              dedupeKey: notification.dedupeKey,
            },
          } as any);
        }
        break;
      default:
        break;
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'match':
      case 'new_match':
      case 'match_created':
        return 'heart';
      case 'like':
      case 'like_received':
        return 'heart-outline';
      case 'super_like':
      case 'superlike':
      case 'super_like_received':
        return 'star';
      case 'message':
      case 'new_message':
        return 'chatbubble';
      case 'crossed_paths':
        return 'location';
      case 'profile_viewed':
        return 'eye';
      case 'system':
        return 'information-circle';
      case 'subscription':
        return 'card';
      case 'weekly_refresh':
        return 'refresh';
      case 'confession_reaction':
        return 'heart';
      case 'confession_reply':
        return 'chatbubble-ellipses';
      default:
        return 'notifications';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'match':
      case 'new_match':
      case 'match_created':
        return COLORS.primary;
      case 'like':
      case 'like_received':
        return COLORS.primary;
      case 'super_like':
      case 'superlike':
      case 'super_like_received':
        return COLORS.superLike;
      case 'message':
      case 'new_message':
        return COLORS.secondary;
      case 'crossed_paths':
        return '#FF9800';
      case 'profile_viewed':
        return '#607D8B';
      case 'system':
        return '#2196F3';
      case 'confession_reaction':
      case 'confession_reply':
        return '#9C27B0';
      default:
        return COLORS.textLight;
    }
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const renderNotification = ({ item }: { item: AppNotification }) => (
    <TouchableOpacity
      style={[styles.notificationItem, !item.isRead && styles.unread]}
      onPress={() => handleNotificationPress(item)}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: getNotificationColor(item.type) + '20' },
        ]}
      >
        <Ionicons
          name={getNotificationIcon(item.type) as any}
          size={24}
          color={getNotificationColor(item.type)}
        />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, !item.isRead && styles.titleUnread]}>
          {item.title}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {item.body}
        </Text>
        <Text style={styles.time}>
          {formatTime(item.createdAt)}
        </Text>
      </View>
      {!item.isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );

  const groupedNotifications = groupNotifications(notifications);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity onPress={markAllSeen}>
          <Text style={styles.markAllText}>Mark All Read</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={groupedNotifications}
        keyExtractor={(item, index) => `group-${index}`}
        renderItem={({ item: group }) => (
          <View>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{group.title}</Text>
            </View>
            {group.notifications.map((notif) => (
              <View key={notif._id}>
                {renderNotification({ item: notif })}
              </View>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySubtitle}>
              You're all caught up!
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.listContent}
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
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  markAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  listContent: {
    paddingBottom: 16,
  },
  groupHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.backgroundDark,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
    textTransform: 'uppercase',
  },
  notificationItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  unread: {
    backgroundColor: COLORS.primary + '05',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 4,
  },
  titleUnread: {
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 4,
    lineHeight: 20,
  },
  time: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 8,
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 100,
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
  },
});
