/**
 * Phase-2 Edit Desire Screen
 *
 * Allows editing the desire/bio text for the private profile.
 * This is a standalone edit screen within Phase-2 (no onboarding navigation).
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore, PHASE2_DESIRE_MIN_LENGTH, PHASE2_DESIRE_MAX_LENGTH } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;

export default function EditDesireScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Store
  const currentBio = usePrivateProfileStore((s) => s.privateBio);
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);
  const convexProfileId = usePrivateProfileStore((s) => s.convexProfileId);
  const userId = useAuthStore((s) => s.userId);

  // Convex mutation for backend sync (auth-safe, no ctx.auth.getUserIdentity)
  const updateFields = useMutation(api.privateProfiles.updateFieldsByAuthId);

  // Local state
  const [desireText, setDesireText] = useState(currentBio || '');
  const [isSaving, setIsSaving] = useState(false);

  // Track mount status to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  // Synchronous guard against double-tap (React state is async and race-prone)
  const isSavingRef = useRef(false);

  // Validation
  const charCount = desireText.trim().length;
  const isValid = charCount >= PHASE2_DESIRE_MIN_LENGTH && charCount <= PHASE2_DESIRE_MAX_LENGTH;
  const remainingMin = Math.max(0, PHASE2_DESIRE_MIN_LENGTH - charCount);

  // Check for unsaved changes
  const hasChanges = desireText.trim() !== (currentBio || '').trim();

  // Handle close with unsaved changes warning
  const handleClose = () => {
    if (hasChanges) {
      Alert.alert(
        'Discard Changes?',
        'You have unsaved changes. Are you sure you want to discard them?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  };

  const handleSave = async () => {
    if (!isValid || isSaving) return;
    if (isSavingRef.current) return; // Synchronous double-tap guard
    isSavingRef.current = true;

    setIsSaving(true);
    try {
      // Update local store immediately
      setPrivateBio(desireText.trim());

      // Sync to backend (if not demo mode) - auth-safe mutation
      if (!isDemoMode && userId) {
        const result = await updateFields({
          authUserId: userId,
          privateBio: desireText.trim(),
        });
        if (__DEV__ && result.success) {
          console.log('[EditDesire] Backend sync success');
        }
      }

      // Navigate back
      router.back();
    } catch (error) {
      if (__DEV__) {
        console.error('[EditDesire] Save error:', error);
      }
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      isSavingRef.current = false;
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Desire</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!isValid || isSaving}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.saveBtn, (!isValid || isSaving) && styles.saveBtnDisabled]}>
            {isSaving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Instructions */}
        <Text style={styles.label}>What are you looking for?</Text>
        <Text style={styles.hint}>
          Describe what you desire in a connection. Be honest and specific.
        </Text>

        {/* Text Input */}
        <TextInput
          style={styles.textInput}
          value={desireText}
          onChangeText={setDesireText}
          placeholder="Express your desires..."
          placeholderTextColor={C.textLight}
          multiline
          maxLength={PHASE2_DESIRE_MAX_LENGTH}
          textAlignVertical="top"
          autoFocus
        />

        {/* Character count */}
        <View style={styles.charCountRow}>
          {remainingMin > 0 ? (
            <Text style={styles.charCountWarning}>
              {remainingMin} more character{remainingMin !== 1 ? 's' : ''} needed
            </Text>
          ) : (
            <Text style={styles.charCount}>
              {charCount}/{PHASE2_DESIRE_MAX_LENGTH}
            </Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  saveBtn: {
    fontSize: 16,
    fontWeight: '600',
    color: C.primary,
  },
  saveBtnDisabled: {
    color: C.textLight,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: C.textLight,
    marginBottom: 16,
    lineHeight: 20,
  },
  textInput: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: C.text,
    minHeight: 160,
    lineHeight: 22,
  },
  charCountRow: {
    marginTop: 8,
    alignItems: 'flex-end',
  },
  charCount: {
    fontSize: 13,
    color: C.textLight,
  },
  charCountWarning: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '500',
  },
});
