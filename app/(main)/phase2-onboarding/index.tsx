import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { useIncognitoStore } from '@/stores/incognitoStore';
import { useScreenTrace } from '@/lib/devTrace';
import { PHASE2_ONBOARDING_ROUTE_MAP } from '@/lib/phase2Onboarding';

const C = INCOGNITO_COLORS;
const PHASE1_DISCOVER_ROUTE = '/(main)/(tabs)/home';

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
  const userId = useAuthStore((s) => s.userId);

  // FIX: Use getCurrentUser with userId instead of getCurrentUserFromToken with token
  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId } : 'skip'
  );

  // FIX: Use setPrivateWelcomeConfirmed with userId instead of acceptPrivateOnboardingConsent with token
  const acceptConsent = useMutation(api.users.setPrivateWelcomeConfirmed);

  const setAcceptedTermsAt = usePrivateProfileStore((s) => s.setAcceptedTermsAt);
  const acceptPrivateTerms = useIncognitoStore((s) => s.acceptPrivateTerms);

  const [rulesChecked, setRulesChecked] = useState(false);
  const [noSharingChecked, setNoSharingChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const importedBasics = useMemo(() => {
    if (!currentUser) return null;
    return {
      handle: currentUser.handle || 'Not available',
      age: calculateAge(currentUser.dateOfBirth),
      gender: currentUser.gender || 'Not available',
      city: currentUser.city || null,
      isVerified: !!currentUser.isVerified,
      hobbies: Array.isArray(currentUser.activities) ? currentUser.activities.slice(0, 4) : [],
    };
  }, [currentUser]);

  const isLoading = currentUser === undefined;
  const canContinue = !!userId && !!currentUser && rulesChecked && noSharingChecked && !isSubmitting;

  const handleExit = () => {
    router.replace(PHASE1_DISCOVER_ROUTE as any);
  };

  const handleContinue = async () => {
    if (!canContinue || !userId) return;

    setIsSubmitting(true);
    try {
      // FIX: setPrivateWelcomeConfirmed takes { userId } only
      const result = await acceptConsent({ userId });

      if (!result?.success) {
        throw new Error('Consent could not be saved');
      }

      setAcceptedTermsAt(Date.now());
      acceptPrivateTerms();
      router.push(PHASE2_ONBOARDING_ROUTE_MAP['select-photos'] as any);
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleExit} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={22} color={C.textLight} />
        </TouchableOpacity>
        <Text style={styles.stepIndicator}>Step 1 of 5</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark" size={40} color={C.primary} />
          </View>
          <Text style={styles.title}>Consent & eligibility</Text>
          <Text style={styles.subtitle}>
            Private Mode is a separate space. We only carry over the basics from your main profile and save
            your consent on your account before you continue.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Imported from your main profile</Text>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Nickname</Text>
              <Text style={styles.summaryValue}>{importedBasics.handle}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Age</Text>
              <Text style={styles.summaryValue}>{importedBasics.age > 0 ? importedBasics.age : 'Not available'}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Gender</Text>
              <Text style={styles.summaryValue}>{importedBasics.gender}</Text>
            </View>
            {importedBasics.city ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>City</Text>
                <Text style={styles.summaryValue}>{importedBasics.city}</Text>
              </View>
            ) : null}
            <View style={[styles.summaryRow, styles.summaryRowLast]}>
              <Text style={styles.summaryLabel}>Verified</Text>
              <Text style={styles.summaryValue}>{importedBasics.isVerified ? 'Yes' : 'No'}</Text>
            </View>
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Private Mode rules</Text>
          <View style={styles.rulesCard}>
            <Text style={styles.ruleBullet}>• Adults 18+ only</Text>
            <Text style={styles.ruleBullet}>• Consent and respect come first</Text>
            <Text style={styles.ruleBullet}>• No screenshots, recording, or sharing private content</Text>
            <Text style={styles.ruleBullet}>• Harassment, coercion, and abuse lead to removal</Text>
          </View>

          <TouchableOpacity
            style={[styles.checkboxRow, rulesChecked && styles.checkboxRowActive]}
            onPress={() => setRulesChecked((value) => !value)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={rulesChecked ? 'checkbox' : 'square-outline'}
              size={20}
              color={rulesChecked ? C.primary : C.textLight}
            />
            <Text style={styles.checkboxText}>I confirm I am 18+ and agree to the Private Mode rules</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.checkboxRow, noSharingChecked && styles.checkboxRowActive]}
            onPress={() => setNoSharingChecked((value) => !value)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={noSharingChecked ? 'checkbox' : 'square-outline'}
              size={20}
              color={noSharingChecked ? C.primary : C.textLight}
            />
            <Text style={styles.checkboxText}>I will not screenshot, record, or share private content</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <TouchableOpacity
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.continueButtonText}>Continue to photos</Text>
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
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  hero: {
    paddingTop: 12,
    paddingBottom: 24,
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: C.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: C.textLight,
    lineHeight: 22,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 12,
  },
  summaryCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.background,
  },
  summaryRowLast: {
    borderBottomWidth: 0,
  },
  summaryLabel: {
    fontSize: 14,
    color: C.textLight,
  },
  summaryValue: {
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
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: C.surface,
  },
  hobbyChipText: {
    fontSize: 12,
    color: C.text,
    fontWeight: '600',
  },
  rulesCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    marginBottom: 14,
  },
  ruleBullet: {
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.surface,
    marginBottom: 10,
  },
  checkboxRowActive: {
    borderWidth: 1,
    borderColor: C.primary,
  },
  checkboxText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
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
  continueButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
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
