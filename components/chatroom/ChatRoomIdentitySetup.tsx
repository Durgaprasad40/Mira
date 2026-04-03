/**
 * Chat Room Identity Setup Screen
 *
 * Shown when user doesn't have a chat room profile yet.
 * User MUST create a nickname before entering any chat room.
 * This identity is separate from the main profile.
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

interface ChatRoomIdentitySetupProps {
  onComplete: () => void;
}

export default function ChatRoomIdentitySetup({ onComplete }: ChatRoomIdentitySetupProps) {
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);
  const createOrUpdateProfile = useMutation(api.chatRooms.createOrUpdateChatRoomProfile);

  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmedNickname = nickname.trim();

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
      await createOrUpdateProfile({
        authUserId,
        nickname: trimmedNickname,
        bio: bio.trim() || undefined,
      });
      onComplete();
    } catch (error: any) {
      console.error('[ChatRoomIdentitySetup] Error:', error);
      Alert.alert('Error', error.message || 'Failed to create profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [nickname, bio, authUserId, createOrUpdateProfile, onComplete]);

  const isValid = nickname.trim().length >= 2;

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
            <View style={styles.iconCircle}>
              <Ionicons name="person" size={36} color={C.textLight} />
            </View>
            <Text style={styles.title}>Create Your Identity</Text>
            <Text style={styles.subtitle}>
              Choose a nickname for chat rooms.{'\n'}
              This is separate from your main profile.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Nickname Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nickname <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={nickname}
                onChangeText={setNickname}
                placeholder="Enter a nickname"
                placeholderTextColor={C.textLight}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.hint, nickname.length >= 2 && styles.hintValid]}>
                {nickname.length}/30 {nickname.length >= 2 && '✓'}
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
    marginBottom: 32,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
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
