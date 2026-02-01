import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

interface ProfilePopoverProps {
  visible: boolean;
  onClose: () => void;
  username: string;
  avatar?: string;
  isActive: boolean;
  coins: number;
  onEditProfile?: () => void;
  onLogout?: () => void;
}

export default function ProfilePopover({
  visible,
  onClose,
  username,
  avatar,
  isActive,
  coins,
  onEditProfile,
  onLogout,
}: ProfilePopoverProps) {
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
          {/* Profile header */}
          <View style={styles.profileHeader}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={22} color={C.textLight} />
              </View>
            )}
            <View style={styles.nameRow}>
              <Text style={styles.username}>{username}</Text>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isActive ? '#00B894' : C.textLight },
                ]}
              />
            </View>
            <Text style={styles.statusLabel}>
              {isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Menu items */}
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.7}>
            <Ionicons name="wallet-outline" size={18} color={C.text} />
            <Text style={styles.menuLabel}>Wallet</Text>
            <Text style={styles.menuValue}>{coins}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onEditProfile?.();
            }}
          >
            <Ionicons name="create-outline" size={18} color={C.text} />
            <Text style={styles.menuLabel}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={16} color={C.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onLogout?.();
            }}
          >
            <Ionicons name="log-out-outline" size={18} color={C.primary} />
            <Text style={[styles.menuLabel, { color: C.primary }]}>Logout</Text>
          </TouchableOpacity>
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
    width: 240,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  profileHeader: {
    alignItems: 'center',
    paddingBottom: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 8,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  username: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: C.accent,
    marginVertical: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  menuLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  menuValue: {
    fontSize: 14,
    fontWeight: '700',
    color: C.primary,
  },
});
