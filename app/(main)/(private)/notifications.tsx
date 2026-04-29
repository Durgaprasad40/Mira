/**
 * Phase-2 (Deep Connect) Notifications Screen
 *
 * STRICT ISOLATION: This screen reads ONLY from the Phase-2 `privateNotifications`
 * Convex table via `usePhase2Notifications`. It will NEVER show Phase-1 rows
 * (matches, likes, messages, crossed paths, profile views, etc.) because the
 * server query returns rows from a physically different table.
 *
 * P2-10 of the notification architecture separation.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePhase2Notifications, type AppNotification } from '@/hooks/useNotifications';

const C = INCOGNITO_COLORS;

interface NotificationSection {
  title: string;
  data: AppNotification[];
}

// DEFENSIVE: types that this screen renders. Anything else (Phase-1 leakage)
// is filtered at render time as a safety net — but the Convex query already
// returns Phase-2 rows only.
const PHASE2_RENDER_ALLOWED = new Set<string>([
  'phase2_match',
  'phase2_like',
  'phase2_private_message',
  'phase2_deep_connect',
  'phase2_chat_room',
]);

export default function PrivateNotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // STRICT ISOLATION: Phase-2 only.
  const {
    notifications,
    markAllSeen,
    markRead,
    cleanupExpiredNotifications,
  } = usePhase2Notifications();

  useEffect(() => {
    cleanupExpiredNotifications();
  }, [cleanupExpiredNotifications]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  const onRefresh = async () => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    setRefreshing(true);
    refreshTimeoutRef.current = setTimeout(() => {
      setRefreshing(false);
      refreshTimeoutRef.current = null;
    }, 800);
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
      const t = notif.createdAt;
      if (t >= today) sections[0].data.push(notif);
      else if (t >= yesterday) sections[1].data.push(notif);
      else if (t >= thisWeek) sections[2].data.push(notif);
      else sections[3].data.push(notif);
    });

    return sections.filter((s) => s.data.length > 0);
  };

  const handlePress = (notification: AppNotification) => {
    if (!notification.isRead) markRead(notification._id);

    const notifParams = `source=notification&notificationId=${notification._id}`;
    const dedupeParam = notification.dedupeKey
      ? `&dedupeKey=${encodeURIComponent(notification.dedupeKey)}`
      : '';

    // STRICT ISOLATION: route exclusively into Phase-2 surfaces.
    switch (notification.type) {
      case 'phase2_private_message': {
        const id =
          notification.data?.privateConversationId ??
          notification.data?.conversationId;
        if (id) {
          router.push(`/(main)/(private)/(tabs)/chats/${encodeURIComponent(id)}?${notifParams}${dedupeParam}` as any);
        }
        break;
      }
      case 'phase2_match': {
        const id =
          notification.data?.privateConversationId ??
          notification.data?.conversationId;
        if (id) {
          router.push(`/(main)/(private)/(tabs)/chats/${encodeURIComponent(id)}?${notifParams}${dedupeParam}` as any);
        } else {
          router.push(`/(main)/(private)?${notifParams}${dedupeParam}` as any);
        }
        break;
      }
      case 'phase2_like':
        router.push(`/(main)/(private)/phase2-likes?${notifParams}${dedupeParam}` as any);
        break;
      case 'phase2_deep_connect':
      case 'phase2_chat_room': {
        const roomId = notification.data?.chatRoomId;
        if (roomId) {
          router.push(`/(main)/(private)/(tabs)/chat-rooms/${roomId}?${notifParams}${dedupeParam}` as any);
        } else {
          router.push(`/(main)/(private)/(tabs)/chat-rooms?${notifParams}${dedupeParam}` as any);
        }
        break;
      }
      default:
        break;
    }
  };

  const getIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'phase2_match':
        return 'heart';
      case 'phase2_like':
        return 'heart-outline';
      case 'phase2_private_message':
        return 'chatbubble';
      case 'phase2_deep_connect':
      case 'phase2_chat_room':
        return 'people';
      default:
        return 'notifications';
    }
  };

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
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
      onPress={() => handlePress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <Ionicons name={getIcon(item.type)} size={22} color={C.primary} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, !item.isRead && styles.titleUnread]}>
          {item.title}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {item.body}
        </Text>
        <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
      </View>
      {!item.isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );

  // DEFENSIVE: render-time safety net to drop any non-Phase-2 row.
  const safe = notifications.filter((n) => PHASE2_RENDER_ALLOWED.has(n.type));
  const grouped = groupNotifications(safe);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Deep Connect</Text>
        <TouchableOpacity onPress={markAllSeen}>
          <Text style={styles.markAllText}>Mark All Read</Text>
        </TouchableOpacity>
      </View>

      <SectionList
        sections={grouped}
        keyExtractor={(item) => item._id}
        renderItem={renderNotification}
        renderSectionHeader={({ section }) => (
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>{section.title}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-outline" size={64} color={C.textLight} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySubtitle}>
              Deep Connect activity will appear here.
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
          />
        }
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text },
  markAllText: { fontSize: 14, color: C.primary, fontWeight: '500' },
  listContent: { paddingBottom: 16 },
  groupHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.surface,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  notificationItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.background,
  },
  unread: { backgroundColor: C.primary + '12' },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: C.primary + '20',
  },
  content: { flex: 1 },
  title: { fontSize: 15, fontWeight: '500', color: C.text, marginBottom: 4 },
  titleUnread: { fontWeight: '700' },
  body: { fontSize: 14, color: C.textLight, marginBottom: 4, lineHeight: 20 },
  time: { fontSize: 12, color: C.textLight },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
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
    color: C.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: { fontSize: 14, color: C.textLight, textAlign: 'center' },
});
