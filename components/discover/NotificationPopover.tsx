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
import {
  usePhase1Notifications,
  usePhase2Notifications,
  type AppNotification,
} from '@/hooks/useNotifications';

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
  /**
   * STRICT ISOLATION: which phase's notifications this popover renders.
   * Phase-1 hosts (Discover) MUST pass 'phase1'. Phase-2 hosts (Deep Connect)
   * MUST pass 'phase2'. There is no auto-detect — the host owns the choice.
   */
  phase: 'phase1' | 'phase2';
}

export function NotificationPopover({
  visible,
  onClose,
  anchorRight = 16,
  anchorTop = 56,
  phase,
}: NotificationPopoverProps) {
  // STRICT ISOLATION: bind to the phase-specific hook so this popover never
  // sees rows from the other phase's table.
  // Both hooks are called unconditionally (rules of hooks); the unused branch
  // is gated server-side via `'skip'` and contributes no rows.
  const phase1Data = usePhase1Notifications();
  const phase2Data = usePhase2Notifications();
  const { notifications, markAllSeen, markRead, cleanupExpiredNotifications } =
    phase === 'phase1' ? phase1Data : phase2Data;

  // Additional safeguard: ensure notifications is always an array
  const safeNotifications = notifications ?? [];

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

    // STRICT ISOLATION: route by phase. Phase-2 rows must never route to
    // Phase-1 surfaces (Discover / nearby / messages tab) and vice versa.
    if (phase === 'phase2') {
      switch (notification.type) {
        case 'phase2_private_message': {
          const p2ConvoId =
            notification.data?.privateConversationId ??
            notification.data?.conversationId;
          if (p2ConvoId) {
            // PHASE2_NOTIF_BACK_FIX: Switch to Messages tab home first, then
            // push the chat thread. This ensures back from the thread returns
            // to the Messages list (not DeepConnect or wherever the bell was
            // tapped from). The legacy /(main)/incognito-chat redirect would
            // <Redirect> in place, leaving the originating tab in the back stack.
            router.push('/(main)/(private)/(tabs)/chats' as any);
            setTimeout(() => {
              router.push(
                `/(main)/(private)/(tabs)/chats/${encodeURIComponent(p2ConvoId)}?${notifParams}${dedupeParam}` as any
              );
            }, 50);
          }
          break;
        }
        case 'phase2_match': {
          const p2ConvoId =
            notification.data?.privateConversationId ??
            notification.data?.conversationId;
          if (p2ConvoId) {
            // PHASE2_NOTIF_BACK_FIX: see phase2_private_message above.
            router.push('/(main)/(private)/(tabs)/chats' as any);
            setTimeout(() => {
              router.push(
                `/(main)/(private)/(tabs)/chats/${encodeURIComponent(p2ConvoId)}?${notifParams}${dedupeParam}` as any
              );
            }, 50);
          } else {
            router.push(`/(main)/(private)/(tabs)/chats?${notifParams}${dedupeParam}` as any);
          }
          break;
        }
        case 'phase2_like':
          router.push(`/(main)/(private)?${notifParams}${dedupeParam}` as any);
          break;
        case 'phase2_deep_connect': {
          const requestId = notification.data?.threadId;
          const requestParam = requestId
            ? `&focusRequestId=${encodeURIComponent(requestId)}`
            : '';
          router.push(
            `/(main)/(private)/(tabs)/truth-or-dare?openRequests=1${requestParam}&${notifParams}${dedupeParam}` as any
          );
          break;
        }
        case 'phase2_chat_room': {
          const roomId = notification.data?.chatRoomId;
          if (roomId) {
            router.push(`/(main)/(private)/chat-room/${roomId}?${notifParams}${dedupeParam}` as any);
          } else {
            router.push(`/(main)/(private)?${notifParams}${dedupeParam}` as any);
          }
          break;
        }
        default:
          // Unknown Phase-2 type — stay in Phase-2 home rather than leaking
          // to a Phase-1 surface.
          if (__DEV__) {
            console.warn('[NotificationPopover] unknown phase2 type:', notification.type);
          }
          break;
      }
      return;
    }

    // ── phase === 'phase1' ────────────────────────────────────────────
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
      case 'confession_connect_requested':
        router.push({
          pathname: '/(main)/comment-connect-requests',
          params: {
            source: 'notification',
            notificationId: notification._id,
            ...(notification.dedupeKey && { dedupeKey: notification.dedupeKey }),
            ...(notification.data?.connectId && { connectId: notification.data.connectId }),
            ...(notification.data?.confessionId && { confessionId: notification.data.confessionId }),
          },
        } as any);
        break;
      case 'confession_connect_accepted':
        if (notification.data?.conversationId) {
          const params: Record<string, string> = {
            conversationId: notification.data.conversationId,
            source: 'confession',
            phase: 'phase1',
            notificationId: notification._id,
          };
          if (notification.dedupeKey) params.dedupeKey = notification.dedupeKey;
          if (notification.data.matchId) params.matchId = notification.data.matchId;
          if (notification.data.otherUserId) {
            params.userId = notification.data.otherUserId;
            params.otherUserId = notification.data.otherUserId;
          }
          router.push({
            pathname: '/(main)/match-celebration',
            params,
          } as any);
        }
        break;
      case 'confession_connect_rejected':
      case 'confession_reaction':
      case 'confession_reply':
      case 'tagged_confession':
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

  const getNotificationIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'match':
      case 'new_match':
      case 'match_created':
      case 'phase2_match':
        return 'heart';
      case 'like':
      case 'like_received':
      case 'phase2_like':
        return 'heart-outline';
      case 'super_like':
      case 'superlike':
      case 'super_like_received':
        return 'star';
      case 'message':
      case 'new_message':
      case 'phase2_private_message':
        return 'chatbubble';
      case 'phase2_chat_room':
      case 'phase2_deep_connect':
        return 'people';
      case 'crossed_paths':
        return 'location';
      case 'profile_viewed':
        return 'eye';
      case 'system':
        return 'information-circle';
      case 'subscription':
        return 'card';
      case 'tagged_confession':
        return 'at';
      case 'confession_connect_requested':
        return 'person-add';
      case 'confession_connect_accepted':
        return 'chatbubbles';
      case 'confession_connect_rejected':
        return 'person-remove-outline';
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
      case 'phase2_match':
      case 'phase2_like':
      case 'phase2_deep_connect':
      case 'phase2_chat_room':
        return COLORS.primary;
      case 'super_like':
      case 'superlike':
      case 'super_like_received':
        return COLORS.superLike || '#FFD700';
      case 'message':
      case 'new_message':
      case 'phase2_private_message':
        return COLORS.secondary || '#4ECDC4';
      case 'crossed_paths':
        return '#FF9800';
      case 'profile_viewed':
        return '#607D8B';
      case 'system':
        return '#2196F3';
      case 'tagged_confession':
      case 'confession_connect_requested':
      case 'confession_connect_accepted':
      case 'confession_connect_rejected':
        return '#9C27B0';
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
  const displayNotifications = safeNotifications.slice(0, 5);

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
            {safeNotifications.length > 0 && (
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

          {/* See all link — phase-aware route */}
          {safeNotifications.length > 5 && (
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => {
                onClose();
                const target =
                  phase === 'phase2'
                    ? '/(main)/(private)/notifications'
                    : '/(main)/notifications';
                router.push(target as any);
              }}
            >
              <Text style={styles.seeAllText}>
                See all {safeNotifications.length} notifications
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
