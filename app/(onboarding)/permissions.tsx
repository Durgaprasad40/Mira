import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { COLORS } from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { Ionicons } from "@expo/vector-icons";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";

export default function PermissionsScreen() {
  const { setStep } = useOnboardingStore();
  const router = useRouter();
  const [locationGranted, setLocationGranted] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        setLocationGranted(true);

        // Also request background location if needed for Crossed Paths
        if (Platform.OS !== "web") {
          await Location.requestBackgroundPermissionsAsync();
        }
      } else {
        Alert.alert(
          "Location Permission",
          "Location access helps you find people nearby and use Crossed Paths feature. You can enable it later in settings.",
          [{ text: "OK" }],
        );
      }
    } catch (error) {
      Alert.alert("Error", "Failed to request location permission");
    }
  };

  const requestNotifications = () => {
    // expo-notifications not installed - show fallback message
    Alert.alert(
      "Notifications",
      "Notifications permission is not available in this build yet. You can enable notifications later in your device settings.",
      [{ text: "OK", onPress: () => setNotificationsGranted(true) }]
    );
  };

  const handleNext = () => {
    if (__DEV__) console.log('[ONB] permissions → review (continue)');
    setStep("review");
    router.push("/(onboarding)/review");
  };

  // POST-VERIFICATION: Previous goes back
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] permissions → bio (previous)');
    setStep("bio");
    router.push("/(onboarding)/bio");
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
          disabled={locationGranted}
          style={styles.permissionButton}
        />
      </View>

      <View style={styles.permissionCard}>
        <View style={styles.permissionHeader}>
          <Ionicons name="notifications" size={32} color={COLORS.primary} />
          <View style={styles.permissionInfo}>
            <Text style={styles.permissionTitle}>Notifications</Text>
            <Text style={styles.permissionDescription}>
              Get notified about new matches, messages, and likes
            </Text>
          </View>
        </View>
        <Button
          title={notificationsGranted ? "Granted ✓" : "Enable Notifications"}
          variant={notificationsGranted ? "outline" : "primary"}
          onPress={requestNotifications}
          disabled={notificationsGranted}
          style={styles.permissionButton}
        />
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle" size={20} color={COLORS.primary} />
        <Text style={styles.infoText}>
          You can change these permissions anytime in your device settings.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          fullWidth
        />
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navButton} onPress={handlePrevious}>
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
