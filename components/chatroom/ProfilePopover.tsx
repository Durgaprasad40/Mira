import React, { useState, useEffect, useRef } from 'react';
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
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useChatRoomProfileStore } from '@/stores/chatRoomProfileStore';
import { useAuthStore } from '@/stores/authStore';
import type { Id } from '@/convex/_generated/dataModel';
import ChatThemeSelector from './ChatThemeSelector';

const C = INCOGNITO_COLORS;
const BIO_MAX_LENGTH = 250;

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
  /** Bio (read-only, from Convex-backed profile) */
  bio?: string;
  /** Called when user updates their chat room identity */
  onProfileUpdate?: (data: { username?: string; avatar?: string }) => void;
  /** Called when user wants to leave the room completely (session cleared) */
  onLeaveRoom?: () => void;
  /** Phase-2: Is this a private room (changes menu behavior) */
  isPrivateRoom?: boolean;
  /** Phase-2: Is current user the room owner */
  isRoomOwner?: boolean;
  /** Phase-2: Room password (only shown to owner, null for non-owners) */
  roomPassword?: string | null;
  /** Phase-2: Called when owner wants to end/delete the room */
  onEndRoom?: () => void;
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
  bio,
  onProfileUpdate,
  onLeaveRoom,
  isPrivateRoom = false,
  isRoomOwner = false,
  roomPassword,
  onEndRoom,
}: ProfilePopoverProps) {
  // Auth for Convex
  const authUserId = useAuthStore((s) => s.userId);

  // Convex mutation for saving chat room profile
  const updateChatRoomProfile = useMutation(api.chatRooms.createOrUpdateChatRoomProfile);
  // AVATAR-UPLOAD-FIX: Mutations for uploading avatar to Convex storage
  const generateUploadUrl = useMutation(api.chatRooms.generateChatRoomAvatarUploadUrl);
  const getAvatarUrl = useMutation(api.chatRooms.getChatRoomAvatarUrl);

  // Persisted profile store (for backwards compatibility)
  const { setProfile: persistProfile } = useChatRoomProfileStore();

  // Edit Profile modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  // Theme selector modal state
  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [editName, setEditName] = useState(username);
  const [editAvatar, setEditAvatar] = useState(avatar);
  // AVATAR-UPLOAD-FIX: Track if avatar was changed (to trigger upload on save)
  const [pendingAvatarLocalUri, setPendingAvatarLocalUri] = useState<string | null>(null);
  // PROFILE-EDIT-FIX: Use bio prop from Convex as source of truth, not local store
  const [editBio, setEditBio] = useState(bio ?? '');
  const [isSaving, setIsSaving] = useState(false);
  // PROFILE-EDIT-FIX: Track if form has been initialized to prevent stale state
  const formInitializedRef = useRef(false);

  // P2-AUD-004: Ref for save timeout cleanup
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, []);

  // PROFILE-EDIT-FIX: Reset edit state when popover opens, using Convex data as source of truth
  useEffect(() => {
    if (visible) {
      setEditName(username);
      setEditAvatar(avatar);
      setPendingAvatarLocalUri(null); // AVATAR-UPLOAD-FIX: Clear pending upload
      // PROFILE-EDIT-FIX: Use bio prop from Convex, NOT local store
      setEditBio(bio ?? '');
      formInitializedRef.current = true;
    } else {
      formInitializedRef.current = false;
    }
  }, [visible, username, avatar, bio]);

  const handleOpenEditProfile = () => {
    setEditModalVisible(true);
  };

  const handleCloseEditProfile = () => {
    setEditModalVisible(false);
    setEditName(username);
    setEditAvatar(avatar);
    setPendingAvatarLocalUri(null); // AVATAR-UPLOAD-FIX: Clear pending upload
    // PROFILE-EDIT-FIX: Use bio prop from Convex, NOT local store
    setEditBio(bio ?? '');
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
        const localUri = result.assets[0].uri;
        setEditAvatar(localUri); // Show preview immediately
        setPendingAvatarLocalUri(localUri); // AVATAR-UPLOAD-FIX: Mark for upload on save
      }
    } catch {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleSaveProfile = async () => {
    const trimmedName = editName.trim();

    // PROFILE-EDIT-FIX: Username validation - must start with letter
    if (!/^[a-zA-Z]/.test(trimmedName)) {
      Alert.alert('Invalid Name', 'Display name must start with a letter.');
      return;
    }
    // Prevent purely numeric names
    if (/^\d+$/.test(trimmedName)) {
      Alert.alert('Invalid Name', 'Display name cannot be purely numeric.');
      return;
    }

    if (trimmedName.length < 2) {
      Alert.alert('Invalid Name', 'Display name must be at least 2 characters.');
      return;
    }
    if (trimmedName.length > 30) {
      Alert.alert('Invalid Name', 'Display name must be 30 characters or less.');
      return;
    }

    const trimmedBio = editBio.trim();
    if (__DEV__) console.log('[PROFILE] bio_saved', { length: trimmedBio.length });

    if (!authUserId) {
      Alert.alert('Error', 'Not authenticated. Please try again.');
      return;
    }

    setIsSaving(true);

    try {
      // AVATAR-UPLOAD-FIX: Upload new avatar to Convex storage before saving
      let cloudAvatarUrl: string | undefined = undefined;

      if (pendingAvatarLocalUri) {
        // Step 1: Get upload URL from Convex
        const uploadUrl = await generateUploadUrl({ authUserId });

        // Step 2: Upload the image file to Convex storage
        const response = await fetch(pendingAvatarLocalUri);
        const blob = await response.blob();

        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'image/jpeg' },
          body: blob,
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload avatar image');
        }

        // Step 3: Get the storage ID from the upload response
        const uploadJson = await uploadResponse.json();
        const { storageId } = uploadJson;

        // Step 4: Get the cloud URL for the uploaded image
        cloudAvatarUrl = await getAvatarUrl({ storageId: storageId as Id<'_storage'> }) ?? undefined;
      }

      // CHAT ROOM IDENTITY: Save to Convex backend (persistent)
      // Use cloud URL if we uploaded, otherwise keep existing avatar
      const avatarUrlToSave = cloudAvatarUrl ?? (pendingAvatarLocalUri ? undefined : avatar);

      await updateChatRoomProfile({
        authUserId,
        nickname: trimmedName,
        avatarUrl: avatarUrlToSave,
        bio: trimmedBio || undefined,
      });

      // Also persist to local store for immediate UI feedback
      // Use cloud URL for local store too (so it works across app restarts)
      persistProfile({
        displayName: trimmedName,
        avatarUri: cloudAvatarUrl ?? avatar ?? null,
        bio: trimmedBio || null,
      });

      // Notify parent about the update
      onProfileUpdate?.({
        username: trimmedName !== username ? trimmedName : undefined,
        avatar: cloudAvatarUrl ?? (editAvatar !== avatar ? editAvatar : undefined),
      });
      setPendingAvatarLocalUri(null); // Clear pending upload
      setEditModalVisible(false);
      onClose();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
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
            {(age || gender || bio) && (
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
                {/* Bio (below gender) */}
                {bio && (
                  <View style={styles.identityRow}>
                    <Text style={styles.identityLabel}>Bio</Text>
                    <Text style={[styles.identityValue, styles.bioText]} numberOfLines={3}>{bio}</Text>
                  </View>
                )}
                {/* Phase-2: Room Password (private rooms only) */}
                {isPrivateRoom && (
                  <View style={styles.identityRow}>
                    <Text style={styles.identityLabel}>Room Password</Text>
                    <Text style={styles.identityValue}>
                      {isRoomOwner && roomPassword ? roomPassword : '••••••'}
                    </Text>
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

            {/* Profile (hidden for private rooms) */}
            {!isPrivateRoom && (
              <TouchableOpacity
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={handleOpenEditProfile}
              >
                <Ionicons name="create-outline" size={18} color={C.text} />
                <Text style={styles.menuLabel}>Profile</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textLight} />
              </TouchableOpacity>
            )}

            {/* Theme selector */}
            <TouchableOpacity
              style={styles.menuItem}
              activeOpacity={0.7}
              onPress={() => setThemeModalVisible(true)}
            >
              <Ionicons name="color-palette-outline" size={18} color={C.text} />
              <Text style={styles.menuLabel}>Theme</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textLight} />
            </TouchableOpacity>

            {/* Leave Room button */}
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

            {/* End Room (private rooms, owner only) */}
            {isPrivateRoom && isRoomOwner && (
              <TouchableOpacity
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={() => {
                  onClose();
                  onEndRoom?.();
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#FF4757" />
                <Text style={[styles.menuLabel, styles.leaveRoomText]}>End Room</Text>
              </TouchableOpacity>
            )}
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
        <KeyboardAvoidingView
          style={styles.editModalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View style={styles.editModalSheet}>
            <View style={styles.editModalHandle} />

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.editModalScrollContent}
            >
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

              {/* Bio input */}
              <View style={styles.editInputSection}>
                <Text style={styles.editInputLabel}>Bio</Text>
                <TextInput
                  style={[styles.editInput, styles.editBioInput]}
                  value={editBio}
                  onChangeText={(text) => setEditBio(text.slice(0, BIO_MAX_LENGTH))}
                  placeholder="Tell others about yourself..."
                  placeholderTextColor={C.textLight}
                  maxLength={BIO_MAX_LENGTH}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  autoComplete="off"
                  textContentType="none"
                  importantForAutofill="noExcludeDescendants"
                />
                <Text style={styles.editInputHint}>{editBio.length}/{BIO_MAX_LENGTH}</Text>
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
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Theme Selector Modal */}
      <ChatThemeSelector
        visible={themeModalVisible}
        onClose={() => setThemeModalVisible(false)}
      />
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
  bioText: {
    flex: 1,
    fontWeight: '400',
    fontStyle: 'italic',
    marginLeft: 12,
    textAlign: 'right',
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
    maxHeight: '90%',
  },
  editModalScrollContent: {
    flexGrow: 1,
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
  editBioInput: {
    minHeight: 80,
    paddingTop: 12,
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
