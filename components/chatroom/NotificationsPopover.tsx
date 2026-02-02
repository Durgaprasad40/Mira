import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoAnnouncement } from '@/lib/demoData';

const C = INCOGNITO_COLORS;

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface NotificationsPopoverProps {
  visible: boolean;
  onClose: () => void;
  announcements: DemoAnnouncement[];
  onMarkAllSeen: () => void;
}

export default function NotificationsPopover({
  visible,
  onClose,
  announcements,
  onMarkAllSeen,
}: NotificationsPopoverProps) {
  // Mark all as seen when popover opens
  useEffect(() => {
    if (visible) {
      onMarkAllSeen();
    }
  }, [visible]);

  if (!visible) return null;

  const renderRow = ({ item }: { item: DemoAnnouncement }) => (
    <View style={[styles.row, !item.seen && styles.rowUnseen]}>
      <View style={styles.iconCircle}>
        <Ionicons
          name="information-circle-outline"
          size={16}
          color={C.primary}
        />
      </View>
      <View style={styles.content}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowTime}>{formatTimeAgo(item.createdAt)}</Text>
      </View>
    </View>
  );

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
          <Text style={styles.title}>Notifications</Text>

          {announcements.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons
                name="notifications-off-outline"
                size={28}
                color={C.textLight}
              />
              <Text style={styles.emptyText}>No notifications</Text>
            </View>
          ) : (
            <FlatList
              data={announcements}
              keyExtractor={(item) => item.id}
              renderItem={renderRow}
              showsVerticalScrollIndicator={false}
              style={styles.list}
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
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 100,
    paddingRight: 12,
  },
  popover: {
    width: 270,
    maxHeight: 340,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginBottom: 10,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  rowUnseen: {
    opacity: 1,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(233,69,96,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  rowTime: {
    fontSize: 11,
    color: C.textLight,
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 6,
  },
  emptyText: {
    fontSize: 13,
    color: C.textLight,
  },
});
