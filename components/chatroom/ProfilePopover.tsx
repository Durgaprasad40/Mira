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
  /** Age (read-only in chat room context) */
  age?: number;
  /** Gender (read-only in chat room context) */
  gender?: string;
  /** Called when user wants to change profile photo (stubbed for now) */
  onChangePhoto?: () => void;
  /** Called when user wants to exit to Chat Rooms Home (session retained) */
  onExitToHome?: () => void;
  /** Called when user wants to leave the room completely (session cleared) */
  onLeaveRoom?: () => void;
}

export default function ProfilePopover({
  visible,
  onClose,
  username,
  avatar,
  isActive,
  coins,
  age,
  gender,
  onChangePhoto,
  onExitToHome,
  onLeaveRoom,
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
              {isActive ? 'Online in Room' : 'Offline'}
            </Text>
          </View>

          {/* Identity info (read-only) */}
          {(age || gender) && (
            <View style={styles.identitySection}>
              {age && (
                <View style={styles.identityRow}>
                  <Text style={styles.identityLabel}>Age</Text>
                  <Text style={styles.identityValue}>{age}</Text>
                </View>
              )}
              {gender && (
                <View style={styles.identityRow}>
                  <Text style={styles.identityLabel}>Gender</Text>
                  <Text style={styles.identityValue}>{gender}</Text>
                </View>
              )}
              <Text style={styles.identityNote}>Identity cannot be changed in chat rooms</Text>
            </View>
          )}

          {/* Divider */}
          <View style={styles.divider} />

          {/* Menu items */}
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.7}>
            <Ionicons name="wallet-outline" size={18} color={C.text} />
            <Text style={styles.menuLabel}>Wallet</Text>
            <Text style={styles.menuValue}>{coins}</Text>
          </TouchableOpacity>

          {/* Change Photo - stubbed for now */}
          <TouchableOpacity
            style={styles.menuItem}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onChangePhoto?.();
            }}
          >
            <Ionicons name="camera-outline" size={18} color={C.text} />
            <Text style={styles.menuLabel}>Change Photo</Text>
            <Ionicons name="chevron-forward" size={16} color={C.textLight} />
          </TouchableOpacity>

          {/* Exit to Chat Rooms Home (session retained) */}
          <TouchableOpacity
            style={[styles.menuItem, styles.exitHomeItem]}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onExitToHome?.();
            }}
          >
            <Ionicons name="home-outline" size={18} color={C.primary} />
            <Text style={[styles.menuLabel, styles.exitHomeText]}>Exit to Chat Rooms Home</Text>
          </TouchableOpacity>

          {/* Leave Room button (clears session) */}
          <TouchableOpacity
            style={[styles.menuItem, styles.leaveRoomItem]}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onLeaveRoom?.();
            }}
          >
            <Ionicons name="log-out-outline" size={18} color="#FF4757" />
            <Text style={[styles.menuLabel, styles.leaveRoomText]}>Leave Room</Text>
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
  // Identity section (read-only)
  identitySection: {
    paddingVertical: 8,
    gap: 4,
  },
  identityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  identityLabel: {
    fontSize: 13,
    color: C.textLight,
  },
  identityValue: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
  },
  identityNote: {
    fontSize: 10,
    color: C.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
  },
  // Exit to Home button
  exitHomeItem: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.accent,
  },
  exitHomeText: {
    color: C.primary,
  },
  // Leave Room button (danger)
  leaveRoomItem: {
    marginTop: 4,
  },
  leaveRoomText: {
    color: '#FF4757',
  },
});
