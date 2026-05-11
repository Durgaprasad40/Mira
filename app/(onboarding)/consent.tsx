/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/consent.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";
import { useScreenTrace } from "@/lib/devTrace";

const PRIVACY_POLICY_URL = "https://mira.app/privacy"; // Placeholder
const TERMS_OF_SERVICE_URL = "https://mira.app/terms";

export default function ConsentScreen() {
  useScreenTrace("ONB_CONSENT");
  const { setStep } = useOnboardingStore();
  const { userId } = useAuthStore();
  const router = useRouter();
  const params = useLocalSearchParams<{
    returnTo?: string;
    roomId?: string;
    roomName?: string;
    isPrivate?: string;
  }>();
  const [isAgreed, setIsAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const acceptConsent = useMutation(api.auth.acceptConsent);

  // P1 STABILITY: Track mounted state to prevent setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handlePrivacyPolicy = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
      Alert.alert("Error", "Unable to open privacy policy link");
    });
  };
  const handleTermsOfService = () => {
    Linking.openURL(TERMS_OF_SERVICE_URL).catch(() => {
      Alert.alert("Error", "Unable to open terms link");
    });
  };
  const handleCommunityGuidelines = () => {
    router.push("/(main)/community-guidelines" as any);
  };

  const handleContinue = async () => {
    if (!isAgreed) {
      Alert.alert(
        "Consent Required",
        "Please agree to Mira’s Terms of Service, Privacy Policy, and Community Guidelines to continue."
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (isDemoMode) {
        // Demo mode: update local store
        const demoStore = useDemoStore.getState();
        if (userId) {
          const acceptedAt = Date.now();
          demoStore.saveDemoProfile(userId, {
            consentAcceptedAt: acceptedAt,
            termsAcceptedAt: acceptedAt,
            communityGuidelinesAcceptedAt: acceptedAt,
          } as any);
        }
      } else {
        // Live mode: save consent via Convex
        if (userId) {
          await acceptConsent({
            userId: userId as Id<"users">,
            acceptedTerms: true,
            acceptedPrivacy: true,
            acceptedCommunityGuidelines: true,
          });
        }
      }

      if (params.returnTo === "review") {
        setStep("review" as any);
        router.replace("/(onboarding)/review" as any);
      } else if (params.returnTo === "chatRoom" && typeof params.roomId === "string") {
        router.replace({
          pathname: `/(main)/(private)/(tabs)/chat-rooms/${params.roomId}`,
          params: {
            ...(typeof params.roomName === "string" ? { roomName: params.roomName } : {}),
            ...(typeof params.isPrivate === "string" ? { isPrivate: params.isPrivate } : {}),
          },
        } as any);
      } else if (params.returnTo === "chatRooms") {
        router.replace("/(main)/(private)/(tabs)/chat-rooms" as any);
      } else {
        setStep("prompts");
        router.push("/(onboarding)/prompts" as any);
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to save consent");
    } finally {
      // P1 STABILITY: Guard setState after async
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <OnboardingProgressHeader />
      <View style={styles.content}>
        <Text style={styles.title}>Data & Privacy</Text>
        <Text style={styles.subtitle}>
          Before we continue, please review and accept Mira’s policies.
        </Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="location" size={24} color={COLORS.primary} />
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
            <Ionicons name="camera" size={24} color={COLORS.primary} />
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
            <Ionicons name="shield-checkmark" size={24} color={COLORS.primary} />
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
            I agree to Mira’s{" "}
            <Text style={styles.link} onPress={handleTermsOfService}>
              Terms of Service
            </Text>
            ,{" "}
            <Text style={styles.link} onPress={handlePrivacyPolicy}>
              Privacy Policy
            </Text>
            , and{" "}
            <Text style={styles.link} onPress={handleCommunityGuidelines}>
              Community Guidelines
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    padding: 20,
    paddingTop: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
    lineHeight: 20,
  },
  card: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.text,
  },
  cardDescription: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 18,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 6,
  },
  checkbox: {
    width: 22,
    height: 22,
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
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18,
  },
  link: {
    color: COLORS.primary,
    textDecorationLine: "underline",
  },
  footer: {
    marginTop: "auto",
    paddingTop: 12,
  },
});
