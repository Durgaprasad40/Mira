import React, { useMemo, useState, useCallback } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { LinearGradient } from 'expo-linear-gradient';
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

// Fluid layout constants
const CONTENT_PADDING = 16;
const CHIP_GAP = 8;

export default function Phase2LookingForScreen() {
  useScreenTrace('P2_ONB_LOOKING_FOR');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const isEditingFromReview = returnTo === 'review';
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const setIntentKeys = usePrivateProfileStore((s) => s.setIntentKeys);
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);

  const saveLookingFor = useMutation(api.privateProfiles.updateFieldsByAuthId);
  const [isSaving, setIsSaving] = useState(false);
  const [bioFocused, setBioFocused] = useState(false);

  const bioLength = privateBio.trim().length;
  const bioValid = bioLength >= PHASE2_DESIRE_MIN_LENGTH;
  const intentsValid = intentKeys.length >= PHASE2_MIN_INTENTS && intentKeys.length <= PHASE2_MAX_INTENTS;

  const canContinue = useMemo(() => {
    return !!userId && intentsValid && bioValid && bioLength <= PHASE2_DESIRE_MAX_LENGTH;
  }, [userId, intentsValid, bioValid, bioLength]);

  const toggleIntent = useCallback((key: string) => {
    if (intentKeys.includes(key as any)) {
      setIntentKeys(intentKeys.filter((existingKey) => existingKey !== key) as any);
      return;
    }

    if (intentKeys.length >= PHASE2_MAX_INTENTS) {
      // Visual feedback that max is reached
      return;
    }

    setIntentKeys([...intentKeys, key] as any);
  }, [intentKeys, setIntentKeys]);

  const handleContinue = async () => {
    if (!userId || !token || !canContinue) return;

    setIsSaving(true);
    try {
      const result = await saveLookingFor({
        token,
        authUserId: userId,
        privateIntentKeys: intentKeys,
        privateBio: privateBio.trim(),
      });

      if (!result?.success) {
        throw new Error('Relationship goal could not be saved');
      }

      if (isEditingFromReview) {
        router.replace('/(main)/phase2-onboarding/profile-setup' as any);
      } else {
        router.push('/(main)/phase2-onboarding/prompts' as any);
      }
    } catch (error) {
      Alert.alert(
        'Unable to continue',
        'We could not save your preferences. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Bio helper text - soft and encouraging
  const getBioHelper = () => {
    if (bioLength === 0) {
      return { text: `Min ${PHASE2_DESIRE_MIN_LENGTH} characters`, color: C.textLight };
    }
    if (bioLength < PHASE2_DESIRE_MIN_LENGTH) {
      const remaining = PHASE2_DESIRE_MIN_LENGTH - bioLength;
      return { text: `${remaining} more to go`, color: C.textLight };
    }
    return { text: `${bioLength}/${PHASE2_DESIRE_MAX_LENGTH}`, color: C.primary };
  };

  const bioHelper = getBioHelper();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Relationship goal</Text>
          <Text style={styles.stepLabel}>Step 3 of 5</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Intents Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Pick 1–3 goals</Text>
              <View style={styles.counterBadge}>
                <Text style={[
                  styles.counterText,
                  intentKeys.length > 0 && styles.counterTextActive
                ]}>
                  {intentKeys.length}/{PHASE2_MAX_INTENTS}
                </Text>
              </View>
            </View>
            <Text style={styles.sectionSubtitle}>
              What kind of connection are you looking for?
            </Text>

            {/* Intent Chips - Fluid Wrap */}
            <View style={styles.intentGrid}>
              {PRIVATE_INTENT_CATEGORIES.map((category) => {
                const selected = intentKeys.includes(category.key as any);
                const disabled = !selected && intentKeys.length >= PHASE2_MAX_INTENTS;

                return (
                  <TouchableOpacity
                    key={category.key}
                    style={[
                      styles.intentChip,
                      selected && styles.intentChipSelected,
                      disabled && styles.intentChipDisabled,
                    ]}
                    onPress={() => toggleIntent(category.key)}
                    activeOpacity={disabled ? 1 : 0.7}
                    disabled={disabled}
                  >
                    <Ionicons
                      name={category.icon as any}
                      size={16}
                      color={selected ? category.color : C.textLight}
                    />
                    <Text
                      style={[
                        styles.intentText,
                        selected && styles.intentTextSelected,
                        disabled && styles.intentTextDisabled,
                      ]}
                    >
                      {category.label}
                    </Text>
                    {selected && (
                      <View style={[styles.checkCircle, { backgroundColor: category.color }]}>
                        <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {intentKeys.length >= PHASE2_MAX_INTENTS && (
              <Text style={styles.maxReachedHint}>
                Maximum 3 goals selected
              </Text>
            )}
          </View>

          {/* Private Bio Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Private bio</Text>
            <Text style={styles.sectionSubtitle}>
              Keep it short and clear. This stays private.
            </Text>

            <View style={[
              styles.bioCard,
              bioFocused && styles.bioCardFocused,
              bioValid && styles.bioCardValid,
            ]}>
              <TextInput
                style={styles.bioInput}
                value={privateBio}
                onChangeText={setPrivateBio}
                placeholder="Briefly share what you're looking for. Stays private."
                placeholderTextColor={C.textLight}
                multiline
                maxLength={PHASE2_DESIRE_MAX_LENGTH}
                textAlignVertical="top"
                onFocus={() => setBioFocused(true)}
                onBlur={() => setBioFocused(false)}
              />
              <View style={styles.bioFooter}>
                <Text style={[styles.bioHelper, { color: bioHelper.color }]}>
                  {bioHelper.text}
                </Text>
                {bioValid && (
                  <View style={styles.bioValidBadge}>
                    <Ionicons name="checkmark-circle" size={16} color={C.primary} />
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Spacer for bottom bar */}
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom CTA */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {/* Progress indicators */}
        <View style={styles.progressRow}>
          <View style={styles.progressItem}>
            <Ionicons
              name={intentsValid ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={intentsValid ? C.primary : C.textLight}
            />
            <Text style={[styles.progressText, intentsValid && styles.progressTextDone]}>
              {intentKeys.length} goal{intentKeys.length !== 1 ? 's' : ''} selected
            </Text>
          </View>
          <View style={styles.progressDot} />
          <View style={styles.progressItem}>
            <Ionicons
              name={bioValid ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={bioValid ? C.primary : C.textLight}
            />
            <Text style={[styles.progressText, bioValid && styles.progressTextDone]}>
              Bio ready
            </Text>
          </View>
        </View>

        {/* Continue Button */}
        <TouchableOpacity
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue || isSaving}
          activeOpacity={0.85}
        >
          {canContinue ? (
            <LinearGradient
              colors={[C.primary, '#9333EA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.buttonGradient}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.continueButtonText}>
                    {isEditingFromReview ? 'Save changes' : 'Continue to prompts'}
                  </Text>
                  <Ionicons
                    name={isEditingFromReview ? 'checkmark' : 'arrow-forward'}
                    size={18}
                    color="#FFFFFF"
                  />
                </>
              )}
            </LinearGradient>
          ) : (
            <View style={styles.buttonDisabledInner}>
              <Text style={styles.continueButtonTextDisabled}>
                {isEditingFromReview ? 'Save changes' : 'Continue to prompts'}
              </Text>
              <Ionicons
                name={isEditingFromReview ? 'checkmark' : 'arrow-forward'}
                size={18}
                color={C.textLight}
              />
            </View>
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
    paddingVertical: 14,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: C.surface,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  stepLabel: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  headerSpacer: {
    width: 40,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 8,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
  },
  counterBadge: {
    backgroundColor: C.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
  },
  counterTextActive: {
    color: C.primary,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: C.textLight,
    lineHeight: 20,
    marginBottom: 16,
  },
  intentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CHIP_GAP,
  },
  intentChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.surface,
    maxWidth: '100%',
  },
  intentChipSelected: {
    borderColor: C.primary,
    backgroundColor: C.primary + '15',
  },
  intentChipDisabled: {
    opacity: 0.35,
  },
  intentIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intentText: {
    fontSize: 13,
    color: C.textLight,
    fontWeight: '600',
    flexShrink: 1,
  },
  intentTextSelected: {
    color: C.text,
  },
  intentTextDisabled: {
    color: C.textLight,
  },
  checkCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  maxReachedHint: {
    marginTop: 12,
    fontSize: 13,
    color: C.primary,
    textAlign: 'center',
    fontWeight: '500',
  },
  bioCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    minHeight: 160,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  bioCardFocused: {
    borderColor: C.primary + '50',
  },
  bioCardValid: {
    borderColor: C.primary + '30',
  },
  bioInput: {
    minHeight: 100,
    fontSize: 15,
    color: C.text,
    lineHeight: 22,
  },
  bioFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.background,
  },
  bioHelper: {
    fontSize: 13,
    fontWeight: '500',
  },
  bioValidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: C.background,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    gap: 8,
  },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressText: {
    fontSize: 13,
    color: C.textLight,
    fontWeight: '500',
  },
  progressTextDone: {
    color: C.text,
  },
  progressDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surface,
  },
  continueButton: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  continueButtonDisabled: {
    backgroundColor: C.surface,
  },
  buttonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  buttonDisabledInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 14,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  continueButtonTextDisabled: {
    fontSize: 16,
    fontWeight: '700',
    color: C.textLight,
  },
});
