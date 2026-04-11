/**
 * NotificationPopover - Dropdown notification list shown when bell icon is tapped
 *
 * Replaces navigation to full notifications screen with an inline popover.
 * Shows notifications grouped by time with tap-to-navigate behavior.
 */
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Pressable,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { useNotifications, type AppNotification } from '@/hooks/useNotifications';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const POPOVER_WIDTH = Math.min(SCREEN_WIDTH - 32, 360);
const POPOVER_MAX_HEIGHT = SCREEN_HEIGHT * 0.6;

interface NotificationPopoverProps {
  visible: boolean;
  onClose: () => void;
  /** Anchor position for the popover (right offset from screen edge) */
  anchorRight?: number;
  /** Anchor position for the popover (top offset from header) */
  anchorTop?: number;
}

export function NotificationPopover({
  visible,
  onClose,
  anchorRight = 16,
  anchorTop = 56,
}: NotificationPopoverProps) {
  const { notifications, markAllSeen, markRead, cleanupExpiredNotifications } = useNotifications();

  // Keep expiry cleanup on open, but don't clear unread state until the user
  // opens an item or explicitly taps "Mark all read".
  useEffect(() => {
    if (visible) {
      cleanupExpiredNotifications();
    }
  }, [visible, cleanupExpiredNotifications]);

  const handleNotificationPress = (notification: AppNotification) => {
    if (!notification.isRead) {
      markRead(notification._id);
    }

    // Close popover first
    onClose();

    // Build common query params for context
    const notifParams = `source=notification&notificationId=${notification._id}`;
    const dedupeParam = notification.dedupeKey ? `&dedupeKey=${encodeURIComponent(notification.dedupeKey)}` : '';
    const actorUserId =
      notification.data?.actorUserId ??
      notification.data?.otherUserId ??
      notification.data?.userId;

    switch (notification.type) {
      case 'match':
      case 'new_match':
      case 'match_created':
        if (actorUserId) {
          const mId = notification.data?.matchId ?? `match_${actorUserId}`;
          router.push(`/(main)/match-celebration?matchId=${mId}&userId=${actorUserId}&${notifParams}${dedupeParam}` as any);
        }
        break;
      case 'like':
      case 'like_received':
      case 'super_like':
      case 'superlike':
      case 'super_like_received':
        if (!actorUserId) {
          break;
        }
        router.push({
          pathname: '/(main)/(tabs)/messages',
          params: {
            focus: 'likes',
            profileId: actorUserId,
            source: 'notification',
            notificationId: notification._id,
            dedupeKey: notification.dedupeKey,
          },
        } as any);
        break;
      case 'message':
      case 'new_message':
        if (notification.data?.conversationId) {
          router.push(`/(main)/(tabs)/messages/chat/${notification.data.conversationId}?${notifParams}${dedupeParam}` as any);
        } else if (notification.data?.userId) {
          router.push(`/(main)/(tabs)/messages/chat/${notification.data.userId}?${notifParams}${dedupeParam}` as any);
        }
        break;
      case 'crossed_paths':
        router.push({
          pathname: '/(main)/(tabs)/nearby',
          params: { source: 'notification', notificationId: notification._id },
        } as any);
        break;
      case 'profile_viewed':
        router.push(`/(main)/(tabs)/home?${notifParams}${dedupeParam}` as any);
        break;
      case 'system':
        router.push(`/(main)/(tabs)/profile?${notifParams}${dedupeParam}` as any);
        break;
      case 'subscription':
        router.push(`/(main)/subscription?${notifParams}${dedupeParam}` as any);
        break;
      default:
        break;
    }
  };

  const getNotificationIcon = (type: string): keyof typeof Ionicons.glyphMap => {
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
      default:
        return 'notifications';
    }
  };

  const getNotificationColor = (type: string): string => {
    switch (type) {
      case 'match':
      case 'new_match':
      case 'match_created':
      case 'like':
      case 'like_received':
        return COLORS.primary;
      case 'super_like':
      case 'superlike':
      case 'super_like_received':
        return COLORS.superLike || '#FFD700';
      case 'message':
      case 'new_message':
        return COLORS.secondary || '#4ECDC4';
      case 'crossed_paths':
        return '#FF9800';
      case 'profile_viewed':
        return '#607D8B';
      case 'system':
        return '#2196F3';
      default:
        return COLORS.textLight;
    }
  };

  const formatTime = (timestamp: number): string => {
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
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: getNotificationColor(item.type) + '20' },
        ]}
      >
        <Ionicons
          name={getNotificationIcon(item.type)}
          size={18}
          color={getNotificationColor(item.type)}
        />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, !item.isRead && styles.titleUnread]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.body} numberOfLines={1}>
          {item.body}
        </Text>
        <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
      </View>
      {!item.isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );

  // Limit to most recent 5 notifications for popover
  const displayNotifications = notifications.slice(0, 5);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Popover container - positioned near bell icon */}
        <Pressable
          style={[
            styles.popover,
            {
              right: anchorRight,
              top: anchorTop,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Notifications</Text>
            {notifications.length > 0 && (
              <TouchableOpacity onPress={markAllSeen}>
                <Text style={styles.markAllText}>Mark all read</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Notifications list */}
          {displayNotifications.length > 0 ? (
            <FlatList
              data={displayNotifications}
              keyExtractor={(item) => item._id}
              renderItem={renderNotification}
              style={styles.list}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="notifications-outline" size={40} color={COLORS.textLight} />
              <Text style={styles.emptyTitle}>No notifications</Text>
              <Text style={styles.emptySubtitle}>New activity will show up here.</Text>
            </View>
          )}

          {/* See all link */}
          {notifications.length > 5 && (
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => {
                onClose();
                router.push('/(main)/notifications' as any);
              }}
            >
              <Text style={styles.seeAllText}>
                See all {notifications.length} notifications
              </Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
            </TouchableOpacity>
          )}

          {/* Arrow pointer */}
          <View style={styles.arrow} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  popover: {
    position: 'absolute',
    width: POPOVER_WIDTH,
    maxHeight: POPOVER_MAX_HEIGHT,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  arrow: {
    position: 'absolute',
    top: -8,
    right: 20,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.background,
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
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  markAllText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  list: {
    maxHeight: POPOVER_MAX_HEIGHT - 120,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  unread: {
    backgroundColor: COLORS.primary + '08',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  titleUnread: {
    fontWeight: '700',
  },
  body: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  time: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 4,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
});
