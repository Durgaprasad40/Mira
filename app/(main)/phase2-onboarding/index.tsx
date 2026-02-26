/**
 * Phase 2 Onboarding - Step 1: Terms & Consent
 *
 * Fresh start for Phase-2:
 * - NO auto-import from Phase-1
 * - User must agree to Private Mode rules
 * - Proceeds to photo selection (Step 2)
 *
 * 18+ check already done by PrivateConsentGate in _layout.tsx
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { INCOGNITO_COLORS } from "@/lib/constants";
import { usePrivateProfileStore } from "@/stores/privateProfileStore";

const C = INCOGNITO_COLORS;

export default function Phase2OnboardingTerms() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Terms checkboxes
  const [rulesChecked, setRulesChecked] = useState(false);
  const [screenshotChecked, setScreenshotChecked] = useState(false);

  const setAcceptedTermsAt = usePrivateProfileStore((s) => s.setAcceptedTermsAt);

  const canContinue = rulesChecked && screenshotChecked;

  const handleContinue = () => {
    // Mark terms accepted
    setAcceptedTermsAt(Date.now());

    // Proceed to photo selection (fresh start, no Phase-1 import)
    router.push("/(main)/phase2-onboarding/photo-select" as any);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.replace("/(main)/(tabs)" as any)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={22} color={C.textLight} />
        </TouchableOpacity>
        <Text style={styles.stepIndicator}>Step 1 of 3</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome Section */}
        <View style={styles.welcomeSection}>
          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark" size={48} color={C.primary} />
          </View>
          <Text style={styles.welcomeTitle}>Welcome to Private Mode</Text>
          <Text style={styles.welcomeSubtitle}>
            Create a fresh, separate identity for your private connections.
            Your Phase-2 profile is completely independent from your main profile.
          </Text>
        </View>

        {/* Terms Section */}
        <View style={styles.termsSection}>
          <View style={styles.sectionHeader}>
            <Ionicons name="document-text-outline" size={20} color={C.primary} />
            <Text style={styles.sectionTitle}>Private Mode Rules</Text>
          </View>

          <View style={styles.termsBox}>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> Adults 18+ only — no exceptions
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> Consent comes first — always ask, never assume
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> "No" means no — stop immediately when asked
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> Respect boundaries — no pressure, no manipulation
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> No harassment, threats, stalking, or coercion
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> No screenshots, recording, or sharing outside the app
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> No unsolicited explicit photos or messages
            </Text>
            <Text style={styles.termsBullet}>
              <Text style={styles.bulletIcon}>•</Text> Violations result in suspension or permanent ban
            </Text>
          </View>

          {/* Checkboxes */}
          <TouchableOpacity
            style={[styles.checkRow, rulesChecked && styles.checkRowActive]}
            onPress={() => setRulesChecked(!rulesChecked)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={rulesChecked ? "checkbox" : "square-outline"}
              size={20}
              color={rulesChecked ? C.primary : C.textLight}
            />
            <Text style={styles.checkLabel}>
              I agree to respect consent and boundaries
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.checkRow,
              screenshotChecked && styles.checkRowActive,
            ]}
            onPress={() => setScreenshotChecked(!screenshotChecked)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={screenshotChecked ? "checkbox" : "square-outline"}
              size={20}
              color={screenshotChecked ? C.primary : C.textLight}
            />
            <Text style={styles.checkLabel}>
              I will not screenshot or share private content
            </Text>
          </TouchableOpacity>
        </View>

        {/* Info Note */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={18} color={C.textLight} />
          <Text style={styles.infoNoteText}>
            Your Private profile is separate from your main profile.
            You'll create new photos and preferences specifically for Private Mode.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Action */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[
            styles.continueBtn,
            !canContinue && styles.continueBtnDisabled,
          ]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.continueBtnText,
              !canContinue && styles.continueBtnTextDisabled,
            ]}
          >
            Continue
          </Text>
          <Ionicons
            name="arrow-forward"
            size={18}
            color={canContinue ? "#FFFFFF" : C.textLight}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scrollView: { flex: 1 },

  // Top bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  stepIndicator: {
    fontSize: 11,
    color: C.textLight,
    fontWeight: "500",
  },

  // Welcome section
  welcomeSection: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    alignItems: "center",
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.primary + "15",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: C.text,
    textAlign: "center",
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: C.textLight,
    textAlign: "center",
    lineHeight: 20,
  },

  // Terms section
  termsSection: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
  },
  termsBox: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  termsBullet: {
    fontSize: 13,
    color: C.text,
    lineHeight: 22,
  },
  bulletIcon: {
    color: C.primary,
    fontWeight: "700",
  },

  // Checkboxes
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  checkRowActive: {
    borderColor: C.primary + "50",
    backgroundColor: C.primary + "0A",
  },
  checkLabel: {
    fontSize: 13,
    color: C.text,
    flex: 1,
    lineHeight: 18,
  },

  // Info note
  infoNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderRadius: 8,
    marginBottom: 16,
  },
  infoNoteText: {
    flex: 1,
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  continueBtn: {
    flexDirection: "row",
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtnDisabled: {
    backgroundColor: C.surface,
  },
  continueBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  continueBtnTextDisabled: {
    color: C.textLight,
  },
});
