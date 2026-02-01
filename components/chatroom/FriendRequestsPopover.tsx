import React from 'react';
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
import { DemoFriendRequest } from '@/lib/demoData';

const C = INCOGNITO_COLORS;

interface FriendRequestsPopoverProps {
  visible: boolean;
  onClose: () => void;
  requests: DemoFriendRequest[];
  onAccept: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export default function FriendRequestsPopover({
  visible,
  onClose,
  requests,
  onAccept,
  onReject,
}: FriendRequestsPopoverProps) {
  if (!visible) return null;

  const renderRow = ({ item }: { item: DemoFriendRequest }) => (
    <View style={styles.row}>
      {item.fromAvatar ? (
        <Image source={{ uri: item.fromAvatar }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="person" size={14} color={C.textLight} />
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {item.fromName}
      </Text>
      <TouchableOpacity
        onPress={() => onAccept(item.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.acceptBtn}
      >
        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onReject(item.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.rejectBtn}
      >
        <Ionicons name="close" size={16} color="#FFFFFF" />
      </TouchableOpacity>
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
          <Text style={styles.title}>Friend Requests</Text>

          {requests.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={28} color={C.textLight} />
              <Text style={styles.emptyText}>No pending requests</Text>
            </View>
          ) : (
            <FlatList
              data={requests}
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
  acceptBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#00B894',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.primary,
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
