import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useChatRoomProfileStore } from '@/stores/chatRoomProfileStore';

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
  /** Called when user updates their chat room identity */
  onProfileUpdate?: (data: { username?: string; avatar?: string }) => void;
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
  onProfileUpdate,
  onLeaveRoom,
}: ProfilePopoverProps) {
  // Persisted profile store
  const { setProfile: persistProfile } = useChatRoomProfileStore();

  // Edit Profile modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState(username);
  const [editAvatar, setEditAvatar] = useState(avatar);
  const [isSaving, setIsSaving] = useState(false);

  // Reset edit state when popover opens
  useEffect(() => {
    if (visible) {
      setEditName(username);
      setEditAvatar(avatar);
    }
  }, [visible, username, avatar]);

  const handleOpenEditProfile = () => {
    setEditModalVisible(true);
  };

  const handleCloseEditProfile = () => {
    setEditModalVisible(false);
    setEditName(username);
    setEditAvatar(avatar);
  };

  const handlePickImage = async (source: 'camera' | 'gallery') => {
    try {
      let result;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Camera access is needed to take photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Gallery access is needed to select photos.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets[0]) {
        setEditAvatar(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleSaveProfile = () => {
    const trimmedName = editName.trim();
    if (trimmedName.length < 2) {
      Alert.alert('Invalid Name', 'Display name must be at least 2 characters.');
      return;
    }

    setIsSaving(true);

    // Persist to local store (AsyncStorage)
    persistProfile({
      displayName: trimmedName,
      avatarUri: editAvatar ?? null,
    });

    // Notify parent about the update
    setTimeout(() => {
      onProfileUpdate?.({
        username: trimmedName !== username ? trimmedName : undefined,
        avatar: editAvatar !== avatar ? editAvatar : undefined,
      });
      setIsSaving(false);
      setEditModalVisible(false);
      onClose();
    }, 300);
  };

  if (!visible) return null;

  return (
    <>
      <Modal
        visible={visible && !editModalVisible}
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

            {/* Profile */}
            <TouchableOpacity
              style={styles.menuItem}
              activeOpacity={0.7}
              onPress={handleOpenEditProfile}
            >
              <Ionicons name="create-outline" size={18} color={C.text} />
              <Text style={styles.menuLabel}>Profile</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textLight} />
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

      {/* Edit Profile Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCloseEditProfile}
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalSheet}>
            <View style={styles.editModalHandle} />

            <Text style={styles.editModalTitle}>Edit Profile</Text>
            <Text style={styles.editModalSubtitle}>Update your chat room identity</Text>

            {/* Avatar picker */}
            <View style={styles.editAvatarSection}>
              <TouchableOpacity
                style={styles.editAvatarContainer}
                onPress={() => {
                  Alert.alert('Change Photo', 'Choose a source', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Gallery', onPress: () => handlePickImage('gallery') },
                    { text: 'Camera', onPress: () => handlePickImage('camera') },
                  ]);
                }}
              >
                {editAvatar ? (
                  <Image source={{ uri: editAvatar }} style={styles.editAvatar} />
                ) : (
                  <View style={styles.editAvatarPlaceholder}>
                    <Ionicons name="person" size={32} color={C.textLight} />
                  </View>
                )}
                <View style={styles.editAvatarBadge}>
                  <Ionicons name="camera" size={14} color="#FFFFFF" />
                </View>
              </TouchableOpacity>
            </View>

            {/* Name input */}
            <View style={styles.editInputSection}>
              <Text style={styles.editInputLabel}>Display Name</Text>
              <TextInput
                style={styles.editInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Enter display name"
                placeholderTextColor={C.textLight}
                maxLength={20}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="noExcludeDescendants"
              />
              <Text style={styles.editInputHint}>{editName.length}/20 characters</Text>
            </View>

            {/* Action buttons */}
            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.editCancelBtn}
                onPress={handleCloseEditProfile}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editSaveBtn, isSaving && styles.editSaveBtnDisabled]}
                onPress={handleSaveProfile}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.editSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
    width: 220,
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
  profileHeader: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginBottom: 6,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  username: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 11,
    color: C.textLight,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: C.accent,
    marginVertical: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
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
    paddingVertical: 6,
    gap: 2,
  },
  identityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  identityLabel: {
    fontSize: 12,
    color: C.textLight,
  },
  identityValue: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text,
  },
  // Leave Room button (danger)
  leaveRoomItem: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.accent,
  },
  leaveRoomText: {
    color: '#FF4757',
  },
  // ── Edit Profile Modal ──
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  editModalSheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  editModalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    alignSelf: 'center',
    marginBottom: 16,
  },
  editModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
  },
  editModalSubtitle: {
    fontSize: 13,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  editAvatarSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  editAvatarContainer: {
    position: 'relative',
  },
  editAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  editAvatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editAvatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },
  editInputSection: {
    marginBottom: 20,
  },
  editInputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 8,
  },
  editInput: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    borderWidth: 1,
    borderColor: C.accent,
  },
  editInputHint: {
    fontSize: 11,
    color: C.textLight,
    marginTop: 6,
    textAlign: 'right',
  },
  editActions: {
    flexDirection: 'row',
    gap: 12,
  },
  editCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: 'center',
  },
  editCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  editSaveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
  },
  editSaveBtnDisabled: {
    opacity: 0.6,
  },
  editSaveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
