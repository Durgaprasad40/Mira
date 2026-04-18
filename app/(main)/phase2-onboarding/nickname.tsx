import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useScreenTrace } from '@/lib/devTrace';
import { PHASE2_ONBOARDING_ROUTE_MAP } from '@/lib/phase2Onboarding';

const C = INCOGNITO_COLORS;
const MAX_LEN = 20;

function sanitizeNickname(input: string) {
  // Letters + numbers only, no spaces/symbols. Preserve case as typed.
  return input.replace(/[^a-zA-Z0-9]/g, '');
}

function isValidNickname(input: string) {
  const trimmed = input.trim();
  return trimmed.length >= 3 && trimmed.length <= MAX_LEN && /^[a-zA-Z0-9]+$/.test(trimmed);
}

export default function Phase2NicknameScreen() {
  useScreenTrace('P2_ONB_NICKNAME');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  const currentPrivateProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    userId && token ? { token, authUserId: userId } : 'skip',
  );

  const setStoreDisplayName = usePrivateProfileStore((s) => s.setDisplayName);
  const existingDisplayName = usePrivateProfileStore((s) => s.displayName);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const updateDisplayName = useMutation(api.privateProfiles.updateDisplayNameByAuthId);

  useEffect(() => {
    // Prefill:
    // - If private profile exists, use its displayName (preserve existing users).
    // - Else fall back to store (imported data or prior progress).
    if (currentPrivateProfile && typeof currentPrivateProfile.displayName === 'string') {
      setDraft(currentPrivateProfile.displayName);
      return;
    }
    if (!currentPrivateProfile && existingDisplayName) {
      setDraft(existingDisplayName);
    }
  }, [currentPrivateProfile, existingDisplayName]);

  const helperText = useMemo(() => {
    return 'How you appear in Private Mode. Letters and numbers only.';
  }, []);

  const canContinue = useMemo(() => {
    return !!userId && isValidNickname(draft) && !isSaving;
  }, [draft, isSaving, userId]);

  const handleContinue = useCallback(async () => {
    if (!userId) return;
    const next = draft.trim();
    if (!isValidNickname(next)) {
      setError('Nickname must be 3–20 characters and use letters and numbers only.');
      return;
    }

    setIsSaving(true);
    try {
      // If profile already exists, enforce server-side edit limits via updateDisplayNameByAuthId.
      if (currentPrivateProfile) {
        if (!token) {
          throw new Error('Missing session token');
        }
        const res = await updateDisplayName({ token, authUserId: userId, displayName: next });
        if (!res?.success) {
          const err = (res as any)?.error;
          if (err === 'Nickname change limit reached') {
            Alert.alert('Nickname locked', 'Your Private Mode nickname is now locked.');
          } else {
            Alert.alert('Error', 'Could not save your nickname. Please try again.');
          }
          return;
        }
      } else {
        // No private profile yet: just store it; it will be applied during skeleton creation (select-photos).
        // Keep store in sync for the next steps.
        setStoreDisplayName(next);
      }

      router.push(PHASE2_ONBOARDING_ROUTE_MAP['select-photos'] as any);
    } catch {
      Alert.alert('Error', 'Could not save your nickname. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [currentPrivateProfile, draft, router, setStoreDisplayName, token, updateDisplayName, userId]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color={C.textLight} />
        </TouchableOpacity>
        <Text style={styles.stepIndicator}>Step 2 of 6</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="person-circle-outline" size={40} color={C.primary} />
          </View>
          <Text style={styles.title}>Choose your Private Mode nickname</Text>
          <Text style={styles.subtitle}>{helperText}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Nickname</Text>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={(t) => {
              const sanitized = sanitizeNickname(t);
              setDraft(sanitized);
              if (error) setError(null);
            }}
            placeholder="e.g. Mira123"
            placeholderTextColor={C.textLight}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={MAX_LEN}
            style={[styles.input, error ? styles.inputError : undefined]}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canContinue) void handleContinue();
            }}
          />
          <Text style={styles.meta}>{draft.length}/{MAX_LEN}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <TouchableOpacity
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          <Text style={styles.continueText}>Continue</Text>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  stepIndicator: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  hero: {
    marginTop: 8,
    marginBottom: 18,
    gap: 10,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: C.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: C.textLight,
    lineHeight: 20,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    backgroundColor: C.background,
  },
  inputError: {
    borderColor: '#E25555',
  },
  meta: {
    marginTop: 8,
    fontSize: 12,
    color: C.textLight,
    textAlign: 'right',
    fontWeight: '600',
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    color: '#E25555',
    fontWeight: '600',
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  continueButton: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  continueButtonDisabled: {
    backgroundColor: C.surface,
  },
  continueText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
