/**
 * Chat Room Identity Setup Screen
 *
 * Shown when user doesn't have a chat room profile yet.
 * User MUST create a nickname before entering any chat room.
 * This identity is separate from the main profile.
 *
 * PROFILE-SETUP-FIX: Now includes avatar upload during initial setup.
 */
import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from 'convex/react';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS } from '@/lib/constants';
import type { Id } from '@/convex/_generated/dataModel';

const C = INCOGNITO_COLORS;

interface ChatRoomIdentitySetupProps {
  onComplete: () => void;
}

export default function ChatRoomIdentitySetup({ onComplete }: ChatRoomIdentitySetupProps) {
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);
  const createOrUpdateProfile = useMutation(api.chatRooms.createOrUpdateChatRoomProfile);
  // PROFILE-SETUP-FIX: Avatar upload mutations
  const generateUploadUrl = useMutation(api.chatRooms.generateChatRoomAvatarUploadUrl);
  const getAvatarUrl = useMutation(api.chatRooms.getChatRoomAvatarUrl);

  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  // PROFILE-SETUP-FIX: Avatar state
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [pendingAvatarLocalUri, setPendingAvatarLocalUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Log form initialization
  if (__DEV__) {
    console.log('[CHAT_PROFILE_FORM_INIT] ChatRoomIdentitySetup mounted', {
      authUserId: authUserId?.slice(-8),
      isNewUser: true,
    });
  }

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
        setAvatarPreview(localUri);
        setPendingAvatarLocalUri(localUri);
      }
    } catch {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  }, []);

  const handleAvatarPress = useCallback(() => {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Gallery', onPress: () => handlePickAvatar('gallery') },
      { text: 'Camera', onPress: () => handlePickAvatar('camera') },
    ]);
  }, [handlePickAvatar]);

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

    if (!authUserId) {
      Alert.alert('Error', 'Not authenticated. Please try again.');
      return;
    }

    setIsSubmitting(true);
    try {
      // PROFILE-SETUP-FIX: Upload avatar if selected
      let cloudAvatarUrl: string | undefined = undefined;

      if (pendingAvatarLocalUri) {
        // Step 1: Get upload URL
        const uploadUrl = await generateUploadUrl({ authUserId });

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
        cloudAvatarUrl = await getAvatarUrl({ storageId: storageId as Id<'_storage'> }) ?? undefined;
      }

      await createOrUpdateProfile({
        authUserId,
        nickname: trimmedNickname,
        avatarUrl: cloudAvatarUrl,
        bio: trimmedBio || undefined,
      });

      onComplete();
    } catch (error: any) {
      console.error('[ChatRoomIdentitySetup] Error:', error);
      Alert.alert('Error', error.message || 'Failed to create profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [nickname, bio, authUserId, pendingAvatarLocalUri, createOrUpdateProfile, generateUploadUrl, getAvatarUrl, onComplete]);

  const isValid = nickname.trim().length >= 2 && /^[a-zA-Z]/.test(nickname.trim());

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
            <Text style={styles.title}>Create Your Identity</Text>
            <Text style={styles.subtitle}>
              Choose a nickname and avatar for chat rooms.{'\n'}
              This is separate from your main profile.
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
              {avatarPreview ? 'Tap to change photo' : 'Add a photo (optional)'}
            </Text>
          </TouchableOpacity>

          {/* Form */}
          <View style={styles.form}>
            {/* Nickname Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nickname <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={nickname}
                onChangeText={setNickname}
                placeholder="Enter a nickname (starts with letter)"
                placeholderTextColor={C.textLight}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.hint, nickname.length >= 2 && /^[a-zA-Z]/.test(nickname) && styles.hintValid]}>
                {nickname.length}/30 {nickname.length >= 2 && /^[a-zA-Z]/.test(nickname) && '✓'}
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
