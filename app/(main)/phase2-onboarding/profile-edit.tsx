import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import {
  PHASE2_DESIRE_MAX_LENGTH,
  PHASE2_DESIRE_MIN_LENGTH,
  PHASE2_MAX_INTENTS,
  PHASE2_MIN_INTENTS,
  usePrivateProfileStore,
} from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { useScreenTrace } from '@/lib/devTrace';

const C = INCOGNITO_COLORS;

export default function Phase2LookingForScreen() {
  useScreenTrace('P2_ONB_LOOKING_FOR');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);

  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const setIntentKeys = usePrivateProfileStore((s) => s.setIntentKeys);
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);

  const saveLookingFor = useMutation(api.privateProfiles.saveOnboardingLookingFor);
  const [isSaving, setIsSaving] = useState(false);

  const canContinue = useMemo(() => {
    const bioLength = privateBio.trim().length;
    return (
      !!token &&
      intentKeys.length >= PHASE2_MIN_INTENTS &&
      intentKeys.length <= PHASE2_MAX_INTENTS &&
      bioLength >= PHASE2_DESIRE_MIN_LENGTH &&
      bioLength <= PHASE2_DESIRE_MAX_LENGTH
    );
  }, [intentKeys.length, privateBio, token]);

  const toggleIntent = (key: string) => {
    if (intentKeys.includes(key as any)) {
      setIntentKeys(intentKeys.filter((existingKey) => existingKey !== key) as any);
      return;
    }

    if (intentKeys.length >= PHASE2_MAX_INTENTS) {
      return;
    }

    setIntentKeys([...intentKeys, key] as any);
  };

  const handleContinue = async () => {
    if (!token || !canContinue) return;

    setIsSaving(true);
    try {
      const result = await saveLookingFor({
        token,
        privateIntentKeys: intentKeys,
        privateBio,
      });

      if (!result?.success) {
        throw new Error('Looking For could not be saved');
      }

      router.push('/(main)/phase2-onboarding/prompts' as any);
    } catch (error) {
      Alert.alert(
        'Unable to continue',
        'We could not save what you are looking for. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const bioLength = privateBio.trim().length;
  const helperText =
    bioLength < PHASE2_DESIRE_MIN_LENGTH
      ? `Write ${PHASE2_DESIRE_MIN_LENGTH - bioLength} more character${PHASE2_DESIRE_MIN_LENGTH - bioLength === 1 ? '' : 's'}`
      : `${bioLength}/${PHASE2_DESIRE_MAX_LENGTH}`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Looking for</Text>
        <Text style={styles.stepLabel}>Step 3 of 5</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pick 1–3 intents</Text>
            <Text style={styles.sectionSubtitle}>
              Set your intent and bio here, then continue to your Private Mode prompts.
            </Text>
            <View style={styles.intentGrid}>
              {PRIVATE_INTENT_CATEGORIES.map((category) => {
                const selected = intentKeys.includes(category.key as any);
                return (
                  <TouchableOpacity
                    key={category.key}
                    style={[styles.intentChip, selected && styles.intentChipSelected]}
                    onPress={() => toggleIntent(category.key)}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={category.icon as any}
                      size={16}
                      color={selected ? C.primary : C.textLight}
                    />
                    <Text style={[styles.intentText, selected && styles.intentTextSelected]}>
                      {category.label}
                    </Text>
                    {selected ? <Ionicons name="checkmark" size={14} color={C.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.countText}>
              {intentKeys.length}/{PHASE2_MAX_INTENTS} selected
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Private bio</Text>
            <Text style={styles.sectionSubtitle}>
              Keep it short and clear. You will answer your Private Mode prompts on the next step.
            </Text>
            <View style={styles.bioCard}>
              <TextInput
                style={styles.bioInput}
                value={privateBio}
                onChangeText={setPrivateBio}
                placeholder="What are you looking for in Private Mode?"
                placeholderTextColor={C.textLight}
                multiline
                maxLength={PHASE2_DESIRE_MAX_LENGTH}
                textAlignVertical="top"
              />
            </View>
            <Text
              style={[
                styles.bioHelper,
                bioLength < PHASE2_DESIRE_MIN_LENGTH && styles.bioHelperWarning,
              ]}
            >
              {helperText}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {!canContinue ? (
          <Text style={styles.bottomHint}>
            {intentKeys.length < PHASE2_MIN_INTENTS
              ? `Select at least ${PHASE2_MIN_INTENTS} intent`
              : helperText}
          </Text>
        ) : null}
        <TouchableOpacity
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.continueButtonText}>Continue to prompts</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
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
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  stepLabel: {
    fontSize: 12,
    color: C.textLight,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  section: {
    marginBottom: 26,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: C.textLight,
    lineHeight: 20,
    marginBottom: 14,
  },
  intentGrid: {
    gap: 10,
  },
  intentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: C.surface,
  },
  intentChipSelected: {
    borderWidth: 1,
    borderColor: C.primary,
  },
  intentText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    fontWeight: '600',
  },
  intentTextSelected: {
    color: C.primary,
  },
  countText: {
    marginTop: 10,
    fontSize: 12,
    color: C.textLight,
  },
  bioCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    minHeight: 180,
  },
  bioInput: {
    minHeight: 150,
    fontSize: 15,
    color: C.text,
    lineHeight: 22,
  },
  bioHelper: {
    marginTop: 8,
    fontSize: 12,
    color: C.textLight,
  },
  bioHelperWarning: {
    color: '#FF8A65',
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  bottomHint: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 10,
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
  continueButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
