import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  FlatList,
  StyleSheet,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoDM } from '@/lib/demoData';

const C = INCOGNITO_COLORS;

interface MessagesPopoverProps {
  visible: boolean;
  onClose: () => void;
  dms: DemoDM[];
  onOpenChat: (dm: DemoDM) => void;
  onHideDM: (dmId: string) => void;
}

export default function MessagesPopover({
  visible,
  onClose,
  dms,
  onOpenChat,
  onHideDM,
}: MessagesPopoverProps) {
  // Filter: visible=true AND not hiddenUntilNextMessage
  const visibleDMs = dms.filter(
    (dm) => dm.visible && !dm.hiddenUntilNextMessage
  );

  const handleRowPress = useCallback(
    (dm: DemoDM) => {
      onOpenChat(dm);
    },
    [onOpenChat]
  );

  const renderRow = ({ item }: { item: DemoDM }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => handleRowPress(item)}
      activeOpacity={0.7}
    >
      {item.peerAvatar ? (
        <Image source={{ uri: item.peerAvatar }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="person" size={14} color={C.textLight} />
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {item.peerName}
      </Text>
      {item.unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.unreadCount}</Text>
        </View>
      )}
      <TouchableOpacity
        onPress={() => onHideDM(item.id)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.hideBtn}
      >
        <Ionicons name="close" size={14} color={C.textLight} />
      </TouchableOpacity>
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
          <Text style={styles.title}>Private</Text>

          {visibleDMs.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons
                name="chatbubbles-outline"
                size={28}
                color={C.textLight}
              />
              <Text style={styles.emptyText}>No messages yet</Text>
            </View>
          ) : (
            <FlatList
              data={visibleDMs}
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
    width: 260,
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
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  hideBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
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
