/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/permissions.tsx
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
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { COLORS } from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";
import { useDemoDmStore } from "@/stores/demoDmStore";
import { isDemoMode } from "@/hooks/useConvex";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";
import { useScreenTrace } from "@/lib/devTrace";

export default function PermissionsScreen() {
  useScreenTrace("ONB_PERMISSIONS");
  const { setStep, reset } = useOnboardingStore();
  const { userId, token, setOnboardingCompleted } = useAuthStore();
  const router = useRouter();
  const [locationGranted, setLocationGranted] = useState(false);
  // PHASE-1 RESTRUCTURE: Notification permission removed

  // P2 STABILITY: Busy flags to prevent concurrent permission requests
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  // PHASE-1 RESTRUCTURE: isRequestingNotifications removed

  // PHASE-1 RESTRUCTURE: completeOnboarding state
  const [isCompleting, setIsCompleting] = useState(false);
  const completeOnboardingMutation = useMutation(api.users.completeOnboarding);

  // P1 STABILITY: Track mounted state to prevent setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const requestLocation = async () => {
    // P2 STABILITY: Prevent concurrent permission requests
    if (isRequestingLocation || locationGranted) return;
    setIsRequestingLocation(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      // P1 STABILITY: Check mounted after async
      if (!isMountedRef.current) return;
      if (status === "granted") {
        setLocationGranted(true);
      } else {
        Alert.alert(
          "Location Permission",
          "Location access helps you find people nearby and use Crossed Paths feature. You can enable it later in settings.",
          [{ text: "OK" }],
        );
      }
    } catch (error) {
      Alert.alert("Error", "Failed to request location permission");
    } finally {
      // P1 STABILITY: Guard setState after async
      if (isMountedRef.current) setIsRequestingLocation(false);
    }
  };

  // PHASE-1 RESTRUCTURE: Notification permission removed

  // PHASE-1 RESTRUCTURE: handleNext now calls completeOnboarding directly
  const handleNext = async () => {
    if (isCompleting || !isMountedRef.current) return;
    setIsCompleting(true);

    try {
      // LIVE MODE: Call completeOnboarding mutation
      if (!isDemoMode) {
        if (!userId || !token) {
          throw new Error('Please sign in to complete onboarding.');
        }
        if (__DEV__) console.log('[ONB] permissions: calling completeOnboarding...');
        await completeOnboardingMutation({
          userId: userId as Id<"users">,
          token,
        });
        if (__DEV__) console.log('[ONB] permissions: completeOnboarding success');
      }

      // Mark onboarding complete in auth store
      setOnboardingCompleted(true);
      reset();

      // DEMO MODE: Handle demo-specific completion
      if (isDemoMode) {
        if (userId) {
          useDemoStore.getState().setDemoOnboardingComplete(userId);
        }
        // OB-8 fix: Only clear DM data if store is empty (fresh onboarding)
        const dmState = useDemoDmStore.getState();
        const hasExistingData = Object.keys(dmState.conversations).length > 0;
        if (!hasExistingData) {
          useDemoDmStore.setState({ conversations: {}, meta: {}, drafts: {} });
        }
        // Seed demo profiles/matches/likes
        useDemoStore.getState().seed();
      }

      // Navigate to tutorial
      if (__DEV__) console.log('[ONB] permissions → tutorial (continue)');
      if (isMountedRef.current) {
        router.push("/(onboarding)/tutorial");
      }
    } catch (error) {
      if (__DEV__) console.error('[ONB] permissions: completeOnboarding failed:', error);
      Alert.alert("Error", "Failed to complete onboarding. Please try again.");
      if (isMountedRef.current) {
        setIsCompleting(false);
      }
    }
  };

  // PHASE-1 RESTRUCTURE: Previous goes back to preferences
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] permissions → preferences (previous)');
    setStep("preferences");
    router.push("/(onboarding)/preferences");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <OnboardingProgressHeader />
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Enable Permissions</Text>
      <Text style={styles.subtitle}>
        These permissions help Mira work better and keep you connected.
      </Text>

      <View style={styles.permissionCard}>
        <View style={styles.permissionHeader}>
          <Ionicons name="location" size={32} color={COLORS.primary} />
          <View style={styles.permissionInfo}>
            <Text style={styles.permissionTitle}>Location</Text>
            <Text style={styles.permissionDescription}>
              Find people nearby and use Crossed Paths feature
            </Text>
          </View>
        </View>
        <Button
          title={locationGranted ? "Granted ✓" : "Enable Location"}
          variant={locationGranted ? "outline" : "primary"}
          onPress={requestLocation}
          disabled={locationGranted || isRequestingLocation}
          loading={isRequestingLocation}
          style={styles.permissionButton}
        />
      </View>

      {/* PHASE-1 RESTRUCTURE: Notification permission removed */}

      <View style={styles.infoBox}>
        <Ionicons name="information-circle" size={20} color={COLORS.primary} />
        <Text style={styles.infoText}>
          You can change these permissions anytime in your device settings.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          title={isCompleting ? "Finishing..." : "Complete Setup"}
          variant="primary"
          onPress={handleNext}
          disabled={isCompleting}
          loading={isCompleting}
          fullWidth
        />
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navButton} onPress={handlePrevious} disabled={isCompleting}>
            <Text style={styles.navText}>Previous</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
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
    marginBottom: 32,
    lineHeight: 22,
  },
  permissionCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  permissionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
    gap: 16,
  },
  permissionInfo: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 4,
  },
  permissionDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
  },
  permissionButton: {
    marginTop: 0,
  },
  infoBox: {
    flexDirection: "row",
    backgroundColor: COLORS.primary + "20",
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18,
  },
  footer: {
    marginTop: 24,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  navButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  navText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: "500",
  },
});
