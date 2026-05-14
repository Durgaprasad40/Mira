/**
 * Chat Room Identity Setup Screen
 *
 * Shown when user doesn't have a chat room profile yet.
 * User MUST create a nickname before entering any chat room.
 * This identity is separate from the main profile.
 *
 * PROFILE-SETUP-FIX: Now includes avatar upload during initial setup.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery } from 'convex/react';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS } from '@/lib/constants';
import type { Id } from '@/convex/_generated/dataModel';

const C = INCOGNITO_COLORS;

interface ChatRoomIdentitySetupProps {
  onComplete: () => void;
}

function isValidChatRoomNickname(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length >= 2 &&
    trimmed.length <= 30 &&
    /^[a-zA-Z]/.test(trimmed) &&
    !/^\d+$/.test(trimmed)
  );
}

export default function ChatRoomIdentitySetup({ onComplete }: ChatRoomIdentitySetupProps) {
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const privateProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    authUserId && token ? { token, authUserId } : 'skip'
  );
  const createOrUpdateProfile = useMutation(api.chatRooms.createOrUpdateChatRoomProfile);
  // PROFILE-SETUP-FIX: Avatar upload mutations
  const generateUploadUrl = useMutation(api.chatRooms.generateChatRoomAvatarUploadUrl);
  const getAvatarUrl = useMutation(api.chatRooms.getChatRoomAvatarUrl);

  const [nickname, setNickname] = useState('');
  const [nicknamePrefilledFromProfile, setNicknamePrefilledFromProfile] = useState(false);
  const [bio, setBio] = useState('');
  // PROFILE-SETUP-FIX: Avatar state
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [pendingAvatarLocalUri, setPendingAvatarLocalUri] = useState<string | null>(null);
  const [galleryPermissionDenied, setGalleryPermissionDenied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasTypedNicknameRef = useRef(false);
  const didPrefillNicknameRef = useRef(false);

  useEffect(() => {
    if (didPrefillNicknameRef.current || hasTypedNicknameRef.current || nickname.trim().length > 0) {
      return;
    }

    const profileDisplayName = privateProfile?.displayName?.trim();
    if (!profileDisplayName || !isValidChatRoomNickname(profileDisplayName)) {
      return;
    }

    setNickname(profileDisplayName);
    setNicknamePrefilledFromProfile(true);
    didPrefillNicknameRef.current = true;
  }, [nickname, privateProfile?.displayName]);

  // Log form initialization

  // PROFILE-SETUP-FIX: Pick avatar image
  const handlePickAvatar = useCallback(async (source: 'camera' | 'gallery') => {
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
          setGalleryPermissionDenied(true);
          return;
        }
        setGalleryPermissionDenied(false);
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets[0]) {
        const localUri = result.assets[0].uri;
        setAvatarPreview(localUri);
        setPendingAvatarLocalUri(localUri);
        setGalleryPermissionDenied(false);
      }
    } catch {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  }, []);

  const handleAvatarPress = useCallback(() => {
    void handlePickAvatar('gallery');
  }, [handlePickAvatar]);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      Alert.alert('Open Settings', 'Please open Settings to enable gallery access.');
    });
  }, []);

  const handleNicknameChange = useCallback((value: string) => {
    hasTypedNicknameRef.current = true;
    setNicknamePrefilledFromProfile(false);
    setNickname(value);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmedNickname = nickname.trim();
    const trimmedBio = bio.trim();

    // PROFILE-SETUP-FIX: Username validation - must start with letter
    if (!/^[a-zA-Z]/.test(trimmedNickname)) {
      Alert.alert('Invalid Nickname', 'Nickname must start with a letter.');
      return;
    }
    // Prevent purely numeric nicknames
    if (/^\d+$/.test(trimmedNickname)) {
      Alert.alert('Invalid Nickname', 'Nickname cannot be purely numeric.');
      return;
    }

    if (trimmedNickname.length < 2) {
      Alert.alert('Invalid Nickname', 'Nickname must be at least 2 characters.');
      return;
    }
    if (trimmedNickname.length > 30) {
      Alert.alert('Invalid Nickname', 'Nickname must be 30 characters or less.');
      return;
    }

    if (!authUserId || !token) {
      Alert.alert('Error', 'Not authenticated. Please try again.');
      return;
    }

    setIsSubmitting(true);
    try {
      // PROFILE-SETUP-FIX: Upload avatar if selected
      let cloudAvatarUrl: string | undefined = undefined;

      if (pendingAvatarLocalUri) {
        // Step 1: Get upload URL
        const uploadUrl = await generateUploadUrl({ token });

        // Step 2: Upload the image
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

        // Step 3: Get storage ID and cloud URL
        const { storageId } = await uploadResponse.json();
        cloudAvatarUrl = await getAvatarUrl({ storageId: storageId as Id<'_storage'>, token }) ?? undefined;
      }

      await createOrUpdateProfile({
        authUserId,
        sessionToken: token,
        nickname: trimmedNickname,
        avatarUrl: cloudAvatarUrl,
        bio: trimmedBio || undefined,
      });

      onComplete();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [nickname, bio, authUserId, token, pendingAvatarLocalUri, createOrUpdateProfile, generateUploadUrl, getAvatarUrl, onComplete]);

  const isValid = isValidChatRoomNickname(nickname);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Set up your room identity</Text>
            <Text style={styles.subtitle}>
              This is how you’ll appear in chat rooms — separate from your main profile, so you can stay anonymous.
            </Text>
          </View>

          {/* PROFILE-SETUP-FIX: Avatar picker at top */}
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={handleAvatarPress}
            activeOpacity={0.8}
          >
            {avatarPreview ? (
              <Image source={{ uri: avatarPreview }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={40} color={C.textLight} />
              </View>
            )}
            <View style={styles.avatarBadge}>
              <Ionicons name="camera" size={16} color="#FFFFFF" />
            </View>
            <Text style={styles.avatarHint}>
              {avatarPreview ? 'Tap to change room photo' : 'Add a room photo (optional)'}
            </Text>
          </TouchableOpacity>
          {galleryPermissionDenied ? (
            <View style={styles.permissionMessage}>
              <Text style={styles.permissionText}>Gallery access is off. </Text>
              <TouchableOpacity onPress={handleOpenSettings} activeOpacity={0.7}>
                <Text style={styles.permissionLink}>Open Settings</Text>
              </TouchableOpacity>
              <Text style={styles.permissionText}> to enable, or skip this for now.</Text>
            </View>
          ) : null}

          {/* Form */}
          <View style={styles.form}>
            {/* Nickname Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nickname <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={nickname}
                onChangeText={handleNicknameChange}
                placeholder="Enter a nickname (starts with letter)"
                placeholderTextColor={C.textLight}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.hint, isValid && styles.hintValid]}>
                {nicknamePrefilledFromProfile
                  ? 'Using your profile name. Tap to change.'
                  : '2–30 characters, must start with a letter.'}
              </Text>
            </View>

            {/* Bio Input (Optional) */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Bio <Text style={styles.optional}>(optional)</Text></Text>
              <TextInput
                style={[styles.input, styles.bioInput]}
                value={bio}
                onChangeText={setBio}
                placeholder="A brief intro about yourself"
                placeholderTextColor={C.textLight}
                maxLength={150}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
              <Text style={styles.hint}>{bio.length}/150</Text>
            </View>
          </View>

          {/* Privacy Notice */}
          <View style={styles.privacyNotice}>
            <Ionicons name="shield-checkmark" size={18} color="#22C55E" />
            <Text style={styles.privacyText}>
              Your real name and photos stay private in chat rooms.
            </Text>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!isValid || isSubmitting}
            activeOpacity={0.8}
            style={[styles.submitButton, !isValid && styles.submitButtonDisabled]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.submitButtonText}>Continue</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  // PROFILE-SETUP-FIX: Avatar picker styles
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#6D28D9',
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 20,
    right: '35%',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },
  avatarHint: {
    marginTop: 10,
    fontSize: 13,
    color: C.textLight,
  },
  permissionMessage: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -14,
    marginBottom: 24,
    paddingHorizontal: 12,
  },
  permissionText: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
    textAlign: 'center',
  },
  permissionLink: {
    fontSize: 12,
    color: C.primary,
    fontWeight: '700',
    lineHeight: 18,
  },
  form: {
    gap: 20,
    marginBottom: 24,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  required: {
    color: '#EF4444',
  },
  optional: {
    fontWeight: '400',
    color: C.textLight,
  },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: C.text,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  bioInput: {
    minHeight: 80,
    paddingTop: 14,
  },
  hint: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'right',
  },
  hintValid: {
    color: '#22C55E',
  },
  privacyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  privacyText: {
    flex: 1,
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  submitButton: {
    backgroundColor: '#6D28D9',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
