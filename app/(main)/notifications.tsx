import React, { useState } from 'react';
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
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Avatar, Badge } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

interface NotificationGroup {
  title: string;
  notifications: any[];
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const notifications = useQuery(
    api.notifications.getNotifications,
    userId ? { userId } : 'skip'
  );

  const markAsRead = useMutation(api.notifications.markAsRead);
  const markAllAsRead = useMutation(api.notifications.markAllAsRead);

  const onRefresh = async () => {
    setRefreshing(true);
    // Refresh logic
    setTimeout(() => setRefreshing(false), 1000);
  };

  const groupNotifications = (notifs: any[]): NotificationGroup[] => {
    if (!notifs) return [];

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

  const handleNotificationPress = async (notification: any) => {
    if (!notification.isRead) {
      await markAsRead({ notificationId: notification._id });
    }

    // Navigate based on notification type
    switch (notification.type) {
      case 'new_match':
        router.push(`/(main)/match-celebration?matchId=${notification.data?.matchId}&userId=${notification.data?.userId}`);
        break;
      case 'new_message':
        router.push(`/(main)/chat/${notification.data?.userId}`);
        break;
      case 'superlike':
        router.push('/(main)/(tabs)/messages');
        break;
      case 'subscription':
        router.push('/(main)/subscription');
        break;
      default:
        break;
    }
  };

  const handleMarkAllAsRead = async () => {
    if (userId) {
      await markAllAsRead({ userId });
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'new_match':
        return 'heart';
      case 'new_message':
        return 'chatbubble';
      case 'superlike':
        return 'star';
      case 'subscription':
        return 'card';
      case 'crossed_paths':
        return 'location';
      case 'dare':
        return 'dice';
      default:
        return 'notifications';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'new_match':
        return COLORS.primary;
      case 'new_message':
        return COLORS.secondary;
      case 'superlike':
        return COLORS.superLike;
      default:
        return COLORS.textLight;
    }
  };

  const renderNotification = ({ item }: { item: any }) => (
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

  const groupedNotifications = groupNotifications(notifications || []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity onPress={handleMarkAllAsRead}>
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
