/**
 * MentionsPopover - Dropdown list showing user's @mention notifications
 * Displays who mentioned the user, in which room, with message preview
 * Tapping opens the room and navigates to the exact message
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

/** Mention item from the backend */
export interface MentionItem {
  id: string;
  senderUserId: string;
  senderNickname: string;
  roomId: string;
  roomName: string;
  messageId: string;
  messagePreview: string;
  createdAt: number;
  isRead: boolean;
  readAt?: number;
}

interface MentionsPopoverProps {
  visible: boolean;
  onClose: () => void;
  mentions: MentionItem[];
  isLoading?: boolean;
  onOpenMention: (mention: MentionItem) => void;
  onMarkAllRead?: () => void;
}

/** Format timestamp to relative time */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function MentionsPopover({
  visible,
  onClose,
  mentions,
  isLoading = false,
  onOpenMention,
  onMarkAllRead,
}: MentionsPopoverProps) {
  const handleRowPress = useCallback(
    (mention: MentionItem) => {
      onOpenMention(mention);
    },
    [onOpenMention]
  );

  const unreadCount = mentions.filter((m) => !m.isRead).length;

  const renderRow = ({ item }: { item: MentionItem }) => (
    <TouchableOpacity
      style={[styles.row, !item.isRead && styles.rowUnread]}
      onPress={() => handleRowPress(item)}
      activeOpacity={0.7}
    >
      {/* Unread indicator */}
      {!item.isRead && <View style={styles.unreadDot} />}

      {/* Content */}
      <View style={styles.content}>
        {/* Header: sender + room + time */}
        <View style={styles.header}>
          <Text style={styles.sender} numberOfLines={1}>
            {item.senderNickname}
          </Text>
          <Text style={styles.inText}>in</Text>
          <Text style={styles.room} numberOfLines={1}>
            {item.roomName}
          </Text>
          <Text style={styles.time}>{formatRelativeTime(item.createdAt)}</Text>
        </View>

        {/* Message preview */}
        <Text style={styles.preview} numberOfLines={2}>
          {item.messagePreview || 'Mentioned you'}
        </Text>
      </View>

      {/* Arrow indicator */}
      <Ionicons name="chevron-forward" size={16} color={C.textLight} />
    </TouchableOpacity>
  );

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.popover} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={styles.titleRow}>
            <Ionicons name="at" size={18} color={C.primary} />
            <Text style={styles.title}>Mentions</Text>
            {unreadCount > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{unreadCount}</Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            {unreadCount > 0 && onMarkAllRead && (
              <TouchableOpacity onPress={onMarkAllRead} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.markAllText}>Mark all read</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Loading state */}
          {isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.loadingText}>Loading mentions...</Text>
            </View>
          ) : mentions.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="at-outline" size={32} color={C.textLight} />
              <Text style={styles.emptyText}>No mentions yet</Text>
              <Text style={styles.emptySubtext}>
                When someone tags you with @, it will appear here
              </Text>
            </View>
          ) : (
            <FlatList
              data={mentions}
              keyExtractor={(item) => item.id}
              renderItem={renderRow}
              showsVerticalScrollIndicator={false}
              style={styles.list}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 100,
    paddingRight: 12,
  },
  popover: {
    width: 300,
    maxHeight: 400,
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  markAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.primary,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 6,
    gap: 10,
  },
  rowUnread: {
    backgroundColor: 'rgba(109, 40, 217, 0.08)',
    borderRadius: 8,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
    marginRight: 4,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  sender: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
    maxWidth: 80,
  },
  inText: {
    fontSize: 12,
    color: C.textLight,
  },
  room: {
    fontSize: 13,
    fontWeight: '500',
    color: C.primary,
    maxWidth: 90,
    flex: 1,
  },
  time: {
    fontSize: 11,
    color: C.textLight,
  },
  preview: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 2,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: C.textLight,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  emptySubtext: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
