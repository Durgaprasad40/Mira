/**
 * Phase 2 Onboarding - Step 1: Terms & Conditions Gate
 *
 * Compact single-screen terms with checkboxes. No scrolling.
 * 18+ check already done by PrivateConsentGate in _layout.tsx
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Phase1ProfileData } from '@/stores/privateProfileStore';

const C = INCOGNITO_COLORS;

export default function Phase2OnboardingTerms() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);

  const [rulesChecked, setRulesChecked] = useState(false);
  const [screenshotChecked, setScreenshotChecked] = useState(false);

  const importPhase1Data = usePrivateProfileStore((s) => s.importPhase1Data);
  const setAcceptedTermsAt = usePrivateProfileStore((s) => s.setAcceptedTermsAt);

  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoProfiles = useDemoStore((s) => s.demoProfiles);

  const convexProfile = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const canContinue = rulesChecked && screenshotChecked;

  const handleContinue = () => {
    setAcceptedTermsAt(Date.now());

    let phase1Data: Phase1ProfileData | null = null;

    if (isDemoMode) {
      const demoProfile = currentDemoUserId ? demoProfiles[currentDemoUserId] : null;
      if (demoProfile) {
        phase1Data = {
          name: demoProfile.name,
          photos: demoProfile.photos || [],
          bio: demoProfile.bio,
          gender: demoProfile.gender,
          dateOfBirth: demoProfile.dateOfBirth,
          city: demoProfile.city,
          activities: demoProfile.activities,
          maxDistance: demoProfile.maxDistance,
          isVerified: true,
        };
      }
    } else if (convexProfile) {
      const photos = convexProfile.photos?.map((p: { url: string }) => ({ url: p.url })) || [];
      phase1Data = {
        name: convexProfile.name || '',
        photos,
        bio: convexProfile.bio,
        gender: convexProfile.gender,
        dateOfBirth: convexProfile.dateOfBirth,
        city: convexProfile.city,
        activities: convexProfile.activities,
        maxDistance: convexProfile.maxDistance,
        isVerified: convexProfile.verificationStatus === 'verified',
      };
    }

    if (phase1Data) {
      importPhase1Data(phase1Data);
    }

    router.push('/(main)/phase2-onboarding/photo-select' as any);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Minimal top bar: close button + step indicator */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={22} color={C.textLight} />
        </TouchableOpacity>
        <Text style={styles.stepIndicator}>Step 1 of 3</Text>
      </View>

      {/* Main content area */}
      <View style={styles.content}>
        {/* Title */}
        <View style={styles.titleRow}>
          <Ionicons name="shield-checkmark" size={24} color={C.primary} />
          <Text style={styles.title}>Private Mode Rules</Text>
        </View>

        {/* Compact terms box */}
        <View style={styles.termsBox}>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> This space is for adults 18+ only — no exceptions</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> Consent comes first — always ask, never assume</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> "No" means no — stop immediately when asked</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> Respect boundaries — no pressure, no manipulation</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> No harassment, threats, stalking, or coercion</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> No hate speech, discrimination, or bullying</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> No screenshots, recording, or sharing outside the app</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> Keep private content private — don't redistribute</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> No unsolicited explicit photos or messages</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> Practice safe meetups — public places first</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> Be smart about your safety and protection</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> Don't aggressively request personal info</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> No spam, solicitation, ads, or payment requests</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> Block and report anyone who makes you uncomfortable</Text>
          <Text style={styles.termsBullet}><Text style={styles.bulletIcon}>•</Text> Violations result in suspension or permanent ban</Text>
        </View>

        {/* Compact checkboxes */}
        <TouchableOpacity
          style={[styles.checkRow, rulesChecked && styles.checkRowActive]}
          onPress={() => setRulesChecked(!rulesChecked)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={rulesChecked ? 'checkbox' : 'square-outline'}
            size={20}
            color={rulesChecked ? C.primary : C.textLight}
          />
          <Text style={styles.checkLabel}>I have read the rules above and agree to respect consent and boundaries</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.checkRow, screenshotChecked && styles.checkRowActive]}
          onPress={() => setScreenshotChecked(!screenshotChecked)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={screenshotChecked ? 'checkbox' : 'square-outline'}
            size={20}
            color={screenshotChecked ? C.primary : C.textLight}
          />
          <Text style={styles.checkLabel}>I will not record, screenshot, or share private content outside the app</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom action */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.continueBtn, !canContinue && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          <Text style={[styles.continueBtnText, !canContinue && styles.continueBtnTextDisabled]}>
            Continue
          </Text>
          <Ionicons name="arrow-forward" size={18} color={canContinue ? '#FFFFFF' : C.textLight} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  // Minimal top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  stepIndicator: {
    fontSize: 11,
    color: C.textLight,
    fontWeight: '500',
  },

  // Main content
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },

  // Terms box
  termsBox: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  termsBullet: {
    fontSize: 12,
    color: C.text,
    lineHeight: 18,
  },
  bulletIcon: {
    color: C.primary,
    fontWeight: '700',
  },

  // Checkboxes
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  checkRowActive: {
    borderColor: C.primary + '50',
    backgroundColor: C.primary + '0A',
  },
  checkLabel: {
    fontSize: 12,
    color: C.text,
    flex: 1,
    lineHeight: 16,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  continueBtn: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  continueBtnDisabled: {
    backgroundColor: C.surface,
  },
  continueBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  continueBtnTextDisabled: {
    color: C.textLight,
  },
});
