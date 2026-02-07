import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { COLORS } from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { Id } from "@/convex/_generated/dataModel";

const PRIVACY_POLICY_URL = "https://mira.app/privacy"; // Placeholder

export default function ConsentScreen() {
  const { setStep } = useOnboardingStore();
  const { userId } = useAuthStore();
  const router = useRouter();
  const [isAgreed, setIsAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const acceptConsent = useMutation(api.auth.acceptConsent);

  const handlePrivacyPolicy = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
      Alert.alert("Error", "Unable to open privacy policy link");
    });
  };

  const handleContinue = async () => {
    if (!isAgreed) {
      Alert.alert(
        "Consent Required",
        "Please agree to the data collection terms to continue."
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (isDemoMode) {
        // Demo mode: update local store
        const demoStore = useDemoStore.getState();
        if (userId) {
          demoStore.saveDemoProfile(userId, {
            consentAcceptedAt: Date.now(),
          });
        }
      } else {
        // Live mode: save consent via Convex
        if (userId) {
          await acceptConsent({ userId: userId as Id<"users"> });
        }
      }

      setStep("photo_upload");
      router.push("/(onboarding)/photo-upload" as any);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to save consent");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Data & Privacy</Text>
      <Text style={styles.subtitle}>
        Before we continue, please review how Mira uses your data.
      </Text>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="location" size={28} color={COLORS.primary} />
          <Text style={styles.cardTitle}>Location Data</Text>
        </View>
        <Text style={styles.cardDescription}>
          We collect your location to power the Nearby feature, helping you
          discover people who cross your path. Your exact location is never
          shared with other users.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="camera" size={28} color={COLORS.primary} />
          <Text style={styles.cardTitle}>Photos</Text>
        </View>
        <Text style={styles.cardDescription}>
          Your photos are used for your profile and identity verification.
          Verification photos are securely processed and retained only as long
          as needed.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="shield-checkmark" size={28} color={COLORS.primary} />
          <Text style={styles.cardTitle}>Your Privacy</Text>
        </View>
        <Text style={styles.cardDescription}>
          We take your privacy seriously. Your data is encrypted, never sold,
          and you can request deletion at any time.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.checkboxRow}
        onPress={() => setIsAgreed(!isAgreed)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, isAgreed && styles.checkboxChecked]}>
          {isAgreed && (
            <Ionicons name="checkmark" size={16} color={COLORS.white} />
          )}
        </View>
        <Text style={styles.checkboxLabel}>
          I agree to the collection and use of my data as described above and in
          the{" "}
          <Text style={styles.link} onPress={handlePrivacyPolicy}>
            Privacy Policy
          </Text>
          .
        </Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleContinue}
          disabled={!isAgreed}
          loading={isSubmitting}
          fullWidth
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 24,
    lineHeight: 22,
  },
  card: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
  },
  cardDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 8,
    marginBottom: 24,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundDark,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  link: {
    color: COLORS.primary,
    textDecorationLine: "underline",
  },
  footer: {
    marginTop: 8,
  },
});
