import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
  Image,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoDM } from '@/lib/demoData';
import PrivateChatView from './PrivateChatView';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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

interface MessagesInboxProps {
  visible: boolean;
  onClose: () => void;
  dms: DemoDM[];
  onMarkRead?: (dmId: string) => void;
  onHideDM?: (dmId: string) => void;
}

export default function MessagesInbox({
  visible,
  onClose,
  dms,
  onMarkRead,
  onHideDM,
}: MessagesInboxProps) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const [openDM, setOpenDM] = useState<DemoDM | null>(null);

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
    // Reset private chat view when inbox closes
    if (!visible) {
      setOpenDM(null);
    }
  }, [visible]);

  const handleOpenChat = useCallback(
    (dm: DemoDM) => {
      // Mark thread as read immediately when entering
      onMarkRead?.(dm.id);
      setOpenDM(dm);
    },
    [onMarkRead]
  );

  const handleBackFromChat = useCallback(() => {
    // Mark read again on return (ensures badge is cleared)
    if (openDM) {
      onMarkRead?.(openDM.id);
    }
    setOpenDM(null);
  }, [openDM, onMarkRead]);

  const handleHide = useCallback(
    (dmId: string) => {
      onHideDM?.(dmId);
    },
    [onHideDM]
  );

  if (!visible) return null;

  // Filter: visible=true AND not hiddenUntilNextMessage
  const visibleDMs = dms.filter(
    (dm) => dm.visible && !dm.hiddenUntilNextMessage
  );

  // If a private chat is open, show that instead of the inbox list
  if (openDM) {
    return (
      <View style={styles.overlay}>
        <Animated.View style={[styles.fullSheet, { transform: [{ translateY }] }]}>
          <PrivateChatView dm={openDM} onBack={handleBackFromChat} />
        </Animated.View>
      </View>
    );
  }

  const renderDM = ({ item }: { item: DemoDM }) => (
    <TouchableOpacity
      style={styles.dmItem}
      onPress={() => handleOpenChat(item)}
      activeOpacity={0.7}
    >
      {item.peerAvatar ? (
        <Image source={{ uri: item.peerAvatar }} style={styles.dmAvatar} />
      ) : (
        <View style={styles.dmAvatarPlaceholder}>
          <Ionicons name="person" size={18} color={C.textLight} />
        </View>
      )}
      <View style={styles.dmContent}>
        <View style={styles.dmTopRow}>
          <Text style={styles.dmName}>{item.peerName}</Text>
          <Text style={styles.dmTime}>{formatTimeAgo(item.lastMessageAt)}</Text>
        </View>
        <Text style={styles.dmPreview} numberOfLines={1}>
          {item.lastMessage}
        </Text>
      </View>
      {item.unreadCount > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadText}>{item.unreadCount}</Text>
        </View>
      )}
      {/* X hide button */}
      <TouchableOpacity
        onPress={() => handleHide(item.id)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.hideButton}
      >
        <Ionicons name="close" size={16} color={C.textLight} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Messages</Text>

        {visibleDMs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={40} color={C.textLight} />
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>
              Messages appear here when someone replies to you
            </Text>
          </View>
        ) : (
          <FlatList
            data={visibleDMs}
            keyExtractor={(item) => item.id}
            renderItem={renderDM}
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
    maxHeight: SCREEN_HEIGHT * 0.7,
  },
  fullSheet: {
    flex: 1,
    backgroundColor: C.background,
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
  dmItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
    gap: 12,
  },
  dmAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  dmAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmContent: {
    flex: 1,
  },
  dmTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  dmName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  dmTime: {
    fontSize: 11,
    color: C.textLight,
  },
  dmPreview: {
    fontSize: 13,
    color: C.textLight,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  unreadText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  hideButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textLight,
  },
  emptySubtext: {
    fontSize: 13,
    color: C.textLight,
    textAlign: 'center',
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
