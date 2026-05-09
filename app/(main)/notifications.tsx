import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConvex } from 'convex/react';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { usePhase1Notifications, useDemoNotifStore, type AppNotification } from '@/hooks/useNotifications';
import { useDemoStore } from '@/stores/demoStore';
import { isDemoMode } from '@/hooks/useConvex';
import { api } from '@/convex/_generated/api';
import { log } from '@/utils/logger';

interface NotificationSection {
  title: string;
  data: AppNotification[];
}

// DEFENSIVE: Types that must NEVER render in notification screens (safety net if upstream filtering fails)
const BELL_RENDER_EXCLUDED = new Set(['message', 'new_message']);

export default function NotificationsScreen() {
  const router = useRouter();
  const convex = useConvex();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  // STABILITY: Track refresh timeout for cleanup on unmount
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Single source of truth — same hook the Phase-1 bell badge uses ──
  // STRICT ISOLATION: Phase-1 only. Phase-2 lives at /(main)/(private)/notifications.
  const { notifications, unseenCount, markAllSeen, markRead, cleanupExpiredNotifications } = usePhase1Notifications();

  // ── Demo mode: access likes and crossedPaths to validate notification invariants ──
  const demoLikes = useDemoStore((s) => s.likes);
  const demoCrossedPaths = useDemoStore((s) => s.crossedPaths);
  const removeLikeNotificationsForUser = useDemoNotifStore((s) => s.removeLikeNotificationsForUser);
  const removeCrossedPathNotificationsForUser = useDemoNotifStore((s) => s.removeCrossedPathNotificationsForUser);

  // ── Cleanup expired notifications on mount ──
  useEffect(() => {
    cleanupExpiredNotifications();
  }, [cleanupExpiredNotifications]);

  // STABILITY: Cleanup refresh timeout on unmount to prevent setState after unmount
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  const onRefresh = async () => {
    // STABILITY: Clear any existing timeout before starting new refresh
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    setRefreshing(true);
    refreshTimeoutRef.current = setTimeout(() => {
      setRefreshing(false);
      refreshTimeoutRef.current = null;
    }, 1000);
  };

  const groupNotifications = (notifs: AppNotification[]): NotificationSection[] => {
    if (!notifs || notifs.length === 0) return [];

    const now = Date.now();
    const today = new Date(now).setHours(0, 0, 0, 0);
    const yesterday = today - 24 * 60 * 60 * 1000;
    const thisWeek = today - 7 * 24 * 60 * 60 * 1000;

    const sections: NotificationSection[] = [
      { title: 'Today', data: [] },
      { title: 'Yesterday', data: [] },
      { title: 'This Week', data: [] },
      { title: 'Earlier', data: [] },
    ];

    notifs.forEach((notif) => {
      const notifTime = notif.createdAt;
      if (notifTime >= today) {
        sections[0].data.push(notif);
      } else if (notifTime >= yesterday) {
        sections[1].data.push(notif);
      } else if (notifTime >= thisWeek) {
        sections[2].data.push(notif);
      } else {
        sections[3].data.push(notif);
      }
    });

    return sections.filter((section) => section.data.length > 0);
  };

  // 4-4: Pass notificationId in navigation params so destination knows why it was opened
  const handleNotificationPress = async (notification: AppNotification) => {
    if (!notification.isRead) {
      markRead(notification._id);
    }

    // 4-4: Build common query params for context
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
      case 'super_like_received': {
        // INVARIANT: A like_received notification may exist IF AND ONLY IF a pending Like exists
        // Validate the like still exists before navigating to Likes screen
        const likeUserId = actorUserId;

        // Guard: Prevent crash if likeUserId is missing
        if (!likeUserId) {
          console.warn('[Notifications] like notification missing actorUserId, skipping navigation');
          break;
        }

        if (isDemoMode) {
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
      case 'phase2_private_message':
      case 'phase2_match':
        if (notification.data?.conversationId) {
          router.push(`/(main)/incognito-chat?id=${notification.data.conversationId}` as any);
        }
        break;
      case 'crossed_paths': {
        // Navigate to crossed-paths screen
        router.push({
          pathname: '/(main)/crossed-paths',
          params: {
            source: 'notification',
            notificationId: notification._id,
            // If notification contains userId, pass it for potential highlighting
            ...(notification.data?.userId && { highlightUserId: notification.data.userId }),
          },
        } as any);
        break;
      }
      case 'profile_viewed':
        router.push(`/(main)/(tabs)/home?${notifParams}${dedupeParam}` as any);
        break;
      case 'system':
        router.push(`/(main)/(tabs)/profile?${notifParams}${dedupeParam}` as any);
        break;
      case 'subscription':
        router.push(`/(main)/subscription?${notifParams}${dedupeParam}` as any);
        break;
      case 'comment_connect':
        router.push(`/(main)/comment-connect-requests?${notifParams}${dedupeParam}` as any);
        break;
      case 'confession_reaction':
      case 'confession_reply':
      case 'tagged_confession':
        if (notification.data?.confessionId) {
          try {
            const confession = await convex.query(api.confessions.getConfession, {
              confessionId: notification.data.confessionId as any,
            });

            if (!confession || (confession.expiresAt !== undefined && confession.expiresAt <= Date.now())) {
              Alert.alert(
                'Confession unavailable',
                'That confession expired or was removed before you opened it.'
              );
              return;
            }
          } catch (error) {
            log.warn('[Notifications]', 'failed to validate confession notification target', {
              notificationId: notification._id,
              confessionId: notification.data.confessionId,
              error: error instanceof Error ? error.message : String(error),
            });
            Alert.alert(
              'Unable to open confession',
              'Please try again in a moment.'
            );
            return;
          }

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
      case 'comment_connect':
        return 'chatbubble-ellipses';
      case 'weekly_refresh':
        return 'refresh';
      case 'confession_reaction':
        return 'heart';
      case 'confession_reply':
        return 'chatbubble-ellipses';
      case 'tagged_confession':
        return 'at';
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
      case 'comment_connect':
        return COLORS.primary;
      case 'confession_reaction':
      case 'confession_reply':
      case 'tagged_confession':
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

  // DEFENSIVE: Filter out message types at render level (safety net), then group
  const safeNotifications = notifications.filter((n) => !BELL_RENDER_EXCLUDED.has(n.type));
  const groupedNotifications = groupNotifications(safeNotifications);

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

      <SectionList
        sections={groupedNotifications}
        keyExtractor={(item) => item._id}
        renderItem={renderNotification}
        renderSectionHeader={({ section }) => (
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>{section.title}</Text>
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
        stickySectionHeadersEnabled={false}
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
