import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoAnnouncement } from '@/lib/demoData';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  announcements: DemoAnnouncement[];
  onMarkAllSeen?: () => void;
}

export default function NotificationsModal({
  visible,
  onClose,
  announcements,
  onMarkAllSeen,
}: NotificationsModalProps) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      onMarkAllSeen?.();
    }
    Animated.spring(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [visible]);

  if (!visible) return null;

  const renderAnnouncement = ({ item }: { item: DemoAnnouncement }) => (
    <View style={styles.announcementItem}>
      <View style={styles.announcementHeader}>
        {!item.seen && <View style={styles.unseenDot} />}
        <Text style={[styles.announcementTitle, !item.seen && styles.unseenTitle]}>
          {item.title}
        </Text>
        <Text style={styles.announcementTime}>{formatTimeAgo(item.createdAt)}</Text>
      </View>
      <Text style={styles.announcementText}>{item.text}</Text>
    </View>
  );

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Notifications</Text>

        {announcements.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="notifications-off-outline" size={40} color={C.textLight} />
            <Text style={styles.emptyText}>No announcements</Text>
          </View>
        ) : (
          <FlatList
            data={announcements}
            keyExtractor={(item) => item.id}
            renderItem={renderAnnouncement}
            showsVerticalScrollIndicator={false}
            style={styles.list}
          />
        )}

        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    maxHeight: SCREEN_HEIGHT * 0.65,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    marginBottom: 12,
  },
  list: {
    flexGrow: 0,
  },
  announcementItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
    gap: 6,
  },
  announcementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unseenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  announcementTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  unseenTitle: {
    fontWeight: '700',
  },
  announcementTime: {
    fontSize: 11,
    color: C.textLight,
  },
  announcementText: {
    fontSize: 13,
    lineHeight: 18,
    color: C.textLight,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: C.textLight,
  },
  closeButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 20,
    backgroundColor: C.accent,
    marginTop: 16,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
});
