import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { useIncognitoStore } from '@/stores/incognitoStore';
import { useScreenTrace } from '@/lib/devTrace';
import {
  PHASE2_NICKNAME_MAX_LENGTH,
  PHASE2_NICKNAME_MIN_LENGTH,
  PHASE2_ONBOARDING_ROUTE_MAP,
  sanitizeNickname,
  validateNickname,
} from '@/lib/phase2Onboarding';

const C = INCOGNITO_COLORS;
const PHASE1_DISCOVER_ROUTE = '/(main)/(tabs)/home';
const TOTAL_STEPS = 5;

function calculateAge(dateOfBirth?: string | null): number {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return 0;
  }

  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const birthDate = new Date(year, month - 1, day, 12, 0, 0);
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

export default function Phase2OnboardingConsentScreen() {
  useScreenTrace('P2_ONB_CONSENT');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const isEditingFromReview = returnTo === 'review';
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  // FIX: Use getCurrentUser with userId instead of getCurrentUserFromToken with token
  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId } : 'skip'
  );
  const currentPrivateProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    userId && token ? { token, authUserId: userId } : 'skip'
  );

  // FIX: Use setPrivateWelcomeConfirmed with userId instead of acceptPrivateOnboardingConsent with token
  const acceptConsent = useMutation(api.users.setPrivateWelcomeConfirmed);
  const updateDisplayName = useMutation(api.privateProfiles.updateDisplayNameByAuthId);

  const setAcceptedTermsAt = usePrivateProfileStore((s) => s.setAcceptedTermsAt);
  const setStoreDisplayName = usePrivateProfileStore((s) => s.setDisplayName);
  const storeDisplayName = usePrivateProfileStore((s) => s.displayName);
  const acceptPrivateTerms = useIncognitoStore((s) => s.acceptPrivateTerms);

  const [rulesChecked, setRulesChecked] = useState(false);
  const [noSharingChecked, setNoSharingChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [nicknameTouched, setNicknameTouched] = useState(false);
  const [nicknameFocused, setNicknameFocused] = useState(false);
  const [nicknameRemoteError, setNicknameRemoteError] = useState<string | null>(null);
  const nicknamePrefilledRef = useRef(false);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    if (currentUser.consentAcceptedAt) {
      setAcceptedTermsAt(currentUser.consentAcceptedAt);
      acceptPrivateTerms();
      setRulesChecked(true);
      setNoSharingChecked(true);
    }
  }, [
    acceptPrivateTerms,
    currentUser,
    setAcceptedTermsAt,
  ]);

  useEffect(() => {
    if (nicknamePrefilledRef.current || currentPrivateProfile === undefined) {
      return;
    }

    const nextNickname =
      typeof currentPrivateProfile?.displayName === 'string' && currentPrivateProfile.displayName.trim()
        ? currentPrivateProfile.displayName
        : storeDisplayName;

    if (nextNickname) {
      setNicknameDraft(sanitizeNickname(nextNickname));
      nicknamePrefilledRef.current = true;
    }
  }, [currentPrivateProfile, storeDisplayName]);

  const importedBasics = useMemo(() => {
    if (!currentUser) return null;
    return {
      age: calculateAge(currentUser.dateOfBirth),
      gender: currentUser.gender || 'Not available',
      city: currentUser.city || null,
      hobbies: Array.isArray(currentUser.activities) ? currentUser.activities.slice(0, 4) : [],
    };
  }, [currentUser]);

  const isLoading = currentUser === undefined || (!!userId && !!token && currentPrivateProfile === undefined);

  const nicknameValidation = useMemo(() => validateNickname(nicknameDraft), [nicknameDraft]);
  const nicknameIsValid = nicknameValidation.ok;
  const liveNicknameError =
    nicknameRemoteError ??
    (nicknameTouched && !nicknameValidation.ok && nicknameDraft.length > 0
      ? nicknameValidation.message
      : null);

  const canContinue =
    !!userId &&
    !!token &&
    !!currentUser &&
    nicknameIsValid &&
    rulesChecked &&
    noSharingChecked &&
    !isSubmitting;

  const handleExit = () => {
    router.replace(PHASE1_DISCOVER_ROUTE as any);
  };

  const handleContinue = async () => {
    if (!canContinue || !userId || !token) return;

    const nextNickname = nicknameDraft.trim();
    const finalCheck = validateNickname(nextNickname);
    if (!finalCheck.ok) {
      setNicknameTouched(true);
      setNicknameRemoteError(finalCheck.message);
      return;
    }

    setIsSubmitting(true);
    setNicknameRemoteError(null);
    try {
      if (currentPrivateProfile) {
        const existingDisplayName =
          typeof currentPrivateProfile.displayName === 'string'
            ? currentPrivateProfile.displayName.trim()
            : '';

        if (nextNickname !== existingDisplayName) {
          const updateResult = await updateDisplayName({
            token,
            authUserId: userId,
            displayName: nextNickname,
          });

          if (!updateResult?.success) {
            if (updateResult?.error === 'Nickname change limit reached') {
              Alert.alert('Nickname locked', 'You have already used your Private Mode nickname change.');
              return;
            }

            setNicknameRemoteError('That nickname is not allowed. Please try another.');
            setNicknameTouched(true);
            return;
          }
        }
      }

      // FIX: setPrivateWelcomeConfirmed takes { userId } only
      const result = await acceptConsent({ token, authUserId: userId });

      if (!result?.success) {
        throw new Error('Consent could not be saved');
      }

      setStoreDisplayName(nextNickname);
      setAcceptedTermsAt(Date.now());
      acceptPrivateTerms();
      if (isEditingFromReview) {
        router.replace(PHASE2_ONBOARDING_ROUTE_MAP['profile-setup'] as any);
      } else {
        router.push(PHASE2_ONBOARDING_ROUTE_MAP['select-photos'] as any);
      }
    } catch (error) {
      Alert.alert(
        'Unable to continue',
        'We could not save your Private Mode consent. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centerState}>
          <Ionicons name="alert-circle-outline" size={42} color={C.textLight} />
          <Text style={styles.stateTitle}>Session required</Text>
          <Text style={styles.stateText}>Please sign in again before entering Private Mode.</Text>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.stateText}>Loading your profile…</Text>
        </View>
      </View>
    );
  }

  if (!currentUser || !importedBasics) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centerState}>
          <Ionicons name="person-circle-outline" size={42} color={C.textLight} />
          <Text style={styles.stateTitle}>Finish Phase-1 first</Text>
          <Text style={styles.stateText}>We could not load your main profile for Private Mode.</Text>
        </View>
      </View>
    );
  }

  const charCount = nicknameDraft.length;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 12}
    >
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={handleExit}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.closeButton}
          accessibilityLabel="Exit Private Mode setup"
        >
          <Ionicons name="close" size={20} color={C.textLight} />
        </TouchableOpacity>
        <View style={styles.progressTrack} accessible accessibilityLabel="Step 1 of 5">
          {Array.from({ length: TOTAL_STEPS }).map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.progressDot,
                idx === 0 ? styles.progressDotActive : null,
              ]}
            />
          ))}
        </View>
        <Text style={styles.stepIndicator}>1 / {TOTAL_STEPS}</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark" size={32} color={C.primary} />
          </View>
          <Text style={styles.title}>Consent & eligibility</Text>
          <Text style={styles.subtitle}>
            Private Mode is a separate, opt-in space. We carry over only the basics from your main profile and save
            your consent before you continue.
          </Text>
        </View>

        {/* Card 1 — Nickname (PRIMARY action) */}
        <View style={styles.section}>
          <View style={styles.nicknameCard}>
            <View style={styles.nicknameHeader}>
              <View style={styles.nicknameBadge}>
                <Ionicons name="sparkles" size={14} color={C.primary} />
              </View>
              <View style={styles.nicknameHeaderText}>
                <Text style={styles.nicknameTitle}>Choose your Private Mode nickname</Text>
                <Text style={styles.nicknameHelper}>This is how you'll appear in private mode.</Text>
              </View>
            </View>

            <View
              style={[
                styles.nicknameInputWrap,
                nicknameFocused ? styles.nicknameInputWrapFocused : null,
                liveNicknameError ? styles.nicknameInputWrapError : null,
              ]}
            >
              <TextInput
                value={nicknameDraft}
                onChangeText={(value) => {
                  const cleaned = sanitizeNickname(value);
                  setNicknameDraft(cleaned);
                  if (!nicknameTouched && cleaned.length > 0) {
                    setNicknameTouched(true);
                  }
                  if (nicknameRemoteError) {
                    setNicknameRemoteError(null);
                  }
                }}
                onFocus={() => setNicknameFocused(true)}
                onBlur={() => {
                  setNicknameFocused(false);
                  if (nicknameDraft.length > 0) {
                    setNicknameTouched(true);
                  }
                }}
                placeholder="Choose a nickname"
                placeholderTextColor={C.textLight}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={PHASE2_NICKNAME_MAX_LENGTH}
                returnKeyType="done"
                style={styles.nicknameInput}
                accessibilityLabel="Private Mode nickname"
              />
              {nicknameIsValid && nicknameDraft.length > 0 ? (
                <Ionicons name="checkmark-circle" size={20} color="#7CE7B0" />
              ) : null}
            </View>

            <View style={styles.nicknameFooter}>
              <Text
                style={[
                  styles.nicknameFooterText,
                  liveNicknameError ? styles.nicknameFooterError : null,
                  !liveNicknameError && nicknameIsValid && charCount > 0 ? styles.nicknameFooterValid : null,
                ]}
                numberOfLines={1}
              >
                {liveNicknameError
                  ? liveNicknameError
                  : nicknameIsValid && charCount > 0
                    ? 'Looks good.'
                    : `${PHASE2_NICKNAME_MIN_LENGTH}–${PHASE2_NICKNAME_MAX_LENGTH} characters`}
              </Text>
              <Text style={styles.nicknameCount}>
                {charCount}/{PHASE2_NICKNAME_MAX_LENGTH}
              </Text>
            </View>
          </View>
        </View>

        {/* Card 2 — Imported basics (READ-ONLY, no Verified row) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>From your main profile</Text>
          <View style={styles.basicsCard}>
            <View style={styles.basicsRow}>
              <Text style={styles.basicsLabel}>Age</Text>
              <Text style={styles.basicsValue}>
                {importedBasics.age > 0 ? importedBasics.age : 'Not available'}
              </Text>
            </View>
            <View
              style={[
                styles.basicsRow,
                !importedBasics.city ? styles.basicsRowLast : null,
              ]}
            >
              <Text style={styles.basicsLabel}>Gender</Text>
              <Text style={styles.basicsValue}>{importedBasics.gender}</Text>
            </View>
            {importedBasics.city ? (
              <View style={[styles.basicsRow, styles.basicsRowLast]}>
                <Text style={styles.basicsLabel}>City</Text>
                <Text style={styles.basicsValue}>{importedBasics.city}</Text>
              </View>
            ) : null}
          </View>
          {importedBasics.hobbies.length > 0 ? (
            <View style={styles.hobbiesWrap}>
              {importedBasics.hobbies.map((hobby: string) => (
                <View key={hobby} style={styles.hobbyChip}>
                  <Text style={styles.hobbyChipText}>{hobby}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Card 3 — Private Mode rules + consent */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Private Mode rules</Text>
          <View style={styles.rulesCard}>
            <View style={styles.ruleRow}>
              <View style={styles.ruleDot} />
              <Text style={styles.ruleText}>Adults 18+ only</Text>
            </View>
            <View style={styles.ruleRow}>
              <View style={styles.ruleDot} />
              <Text style={styles.ruleText}>Consent and respect come first</Text>
            </View>
            <View style={styles.ruleRow}>
              <View style={styles.ruleDot} />
              <Text style={styles.ruleText}>No screenshots, recording, or sharing private content</Text>
            </View>
            <View style={styles.ruleRow}>
              <View style={styles.ruleDot} />
              <Text style={styles.ruleText}>Harassment, coercion, and abuse lead to removal</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.checkboxRow, rulesChecked && styles.checkboxRowActive]}
            onPress={() => setRulesChecked((value) => !value)}
            activeOpacity={0.85}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rulesChecked }}
          >
            <Ionicons
              name={rulesChecked ? 'checkbox' : 'square-outline'}
              size={22}
              color={rulesChecked ? C.primary : C.textLight}
            />
            <Text style={styles.checkboxText}>I confirm I am 18+ and agree to the Private Mode rules</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.checkboxRow, noSharingChecked && styles.checkboxRowActive]}
            onPress={() => setNoSharingChecked((value) => !value)}
            activeOpacity={0.85}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: noSharingChecked }}
          >
            <Ionicons
              name={noSharingChecked ? 'checkbox' : 'square-outline'}
              size={22}
              color={noSharingChecked ? C.primary : C.textLight}
            />
            <Text style={styles.checkboxText}>I will not screenshot, record, or share private content</Text>
          </TouchableOpacity>
        </View>

        {/* Continue — inline in scroll flow, directly below the consent checkboxes */}
        <TouchableOpacity
          style={[
            styles.continueButton,
            canContinue ? styles.continueButtonActive : styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canContinue }}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text
                style={canContinue ? styles.continueButtonText : styles.continueButtonTextDisabled}
              >
                {isEditingFromReview ? 'Save changes' : 'Continue'}
              </Text>
              <Ionicons
                name={isEditingFromReview ? 'checkmark' : 'arrow-forward'}
                size={18}
                color={canContinue ? '#FFFFFF' : C.textLight}
              />
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Original Private Mode palette (restored after device feedback):
//   background  #1A1A2E  dark navy / midnight base
//   surface     #16213E  blue card
//   accent      #0F3460  richer blue used as input fill (visibly lifts above surface)
//   primary     #E94560  pink/red — focus, active, CTA
//   border      #2D3748  subtle hairline
//   text        #E0E0E0  primary copy
//   textLight   #9E9E9E  secondary copy
const ACTIVE_OVERLAY = 'rgba(233, 69, 96, 0.10)'; // subtle pink wash for active checkbox
const ERROR_RED = '#FF8B8B';
const SUCCESS_GREEN = '#7CE7B0';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  progressTrack: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressDot: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surface,
  },
  progressDotActive: {
    backgroundColor: C.primary,
  },
  stepIndicator: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'right',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  hero: {
    paddingTop: 18,
    paddingBottom: 22,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: C.textLight,
    lineHeight: 21,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textLight,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // ──────────────────────────────────────────────────────────
  // Nickname card — PRIMARY surface, must stand out
  // ──────────────────────────────────────────────────────────
  nicknameCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
  },
  nicknameHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  nicknameBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nicknameHeaderText: {
    flex: 1,
  },
  nicknameTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  nicknameHelper: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  // Input fill uses C.accent (#0F3460) — a richer blue that visibly lifts above
  // the surface card (#16213E), giving the input clear separation without
  // resorting to a light fill.
  nicknameInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.accent,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    paddingHorizontal: 14,
    minHeight: 54,
  },
  nicknameInputWrapFocused: {
    borderColor: C.primary,
    backgroundColor: C.accent,
  },
  nicknameInputWrapError: {
    borderColor: ERROR_RED,
  },
  nicknameInput: {
    flex: 1,
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 14,
  },
  nicknameFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 12,
  },
  nicknameFooterText: {
    flex: 1,
    fontSize: 12,
    color: C.textLight,
    lineHeight: 16,
  },
  nicknameFooterError: {
    color: ERROR_RED,
    fontWeight: '600',
  },
  nicknameFooterValid: {
    color: SUCCESS_GREEN,
    fontWeight: '600',
  },
  nicknameCount: {
    fontSize: 12,
    color: C.textLight,
    fontVariant: ['tabular-nums'],
  },

  // ──────────────────────────────────────────────────────────
  // Imported basics — READ-ONLY, intentionally lighter weight
  // ──────────────────────────────────────────────────────────
  basicsCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  basicsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  basicsRowLast: {
    borderBottomWidth: 0,
  },
  basicsLabel: {
    fontSize: 14,
    color: C.textLight,
  },
  basicsValue: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  hobbiesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  hobbyChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  hobbyChipText: {
    fontSize: 12,
    color: C.text,
    fontWeight: '600',
  },

  // ──────────────────────────────────────────────────────────
  // Rules + consent
  // ──────────────────────────────────────────────────────────
  rulesCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  ruleDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 8,
    backgroundColor: C.primary,
  },
  ruleText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: C.surface,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  checkboxRowActive: {
    borderColor: C.primary,
    backgroundColor: ACTIVE_OVERLAY,
  },
  checkboxText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },

  // ──────────────────────────────────────────────────────────
  // Continue — inline in scroll flow (NOT a floating bottom bar)
  // Active = solid C.primary (#E94560) — original Private Mode CTA.
  // Disabled = surface + border, still reads as a button shape.
  // ──────────────────────────────────────────────────────────
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  continueButtonActive: {
    backgroundColor: C.primary,
  },
  continueButtonDisabled: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  continueButtonTextDisabled: {
    fontSize: 15,
    fontWeight: '700',
    color: C.textLight,
    letterSpacing: 0.2,
  },

  // ──────────────────────────────────────────────────────────
  // Loading / error states
  // ──────────────────────────────────────────────────────────
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  stateText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
});
