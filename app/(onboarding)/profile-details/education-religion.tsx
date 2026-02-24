import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  COLORS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
} from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";

export default function ProfileDetailsEducationReligionScreen() {
  const {
    education,
    religion,
    setEducation,
    setReligion,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();

  const handleContinue = () => {
    if (__DEV__) console.log('[ONB] profile-details/education-religion → preferences (continue)');
    setStep("preferences");
    router.push("/(onboarding)/preferences");
  };

  const handleSkip = () => {
    if (__DEV__) console.log('[ONB] profile-details/education-religion → preferences (skip)');
    setStep("preferences");
    router.push("/(onboarding)/preferences");
  };

  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] profile-details/education-religion → lifestyle (previous)');
    router.back();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Profile Details</Text>
        <Text style={styles.stepIndicator}>Step 3 of 3</Text>
        <Text style={styles.subtitle}>
          Share your education and beliefs.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Education & Religion</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Education</Text>
            <View style={styles.selectContainer}>
              {EDUCATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.selectOption,
                    education === option.value && styles.selectOptionSelected,
                  ]}
                  onPress={() =>
                    setEducation(
                      education === option.value ? null : (option.value as any),
                    )
                  }
                >
                  <Text
                    style={[
                      styles.selectText,
                      education === option.value && styles.selectTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Religion</Text>
            <View style={styles.selectContainer}>
              {RELIGION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.selectOption,
                    religion === option.value && styles.selectOptionSelected,
                  ]}
                  onPress={() =>
                    setReligion(
                      religion === option.value ? null : (option.value as any),
                    )
                  }
                >
                  <Text
                    style={[
                      styles.selectText,
                      religion === option.value && styles.selectTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Button
            title="Continue"
            variant="primary"
            onPress={handleContinue}
            fullWidth
          />
          <View style={styles.navRow}>
            <TouchableOpacity style={styles.navButton} onPress={handlePrevious}>
              <Text style={styles.navText}>Previous</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.navButton} onPress={handleSkip}>
              <Text style={styles.navText}>Skip</Text>
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
    marginBottom: 4,
  },
  stepIndicator: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 24,
    lineHeight: 22,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 16,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.text,
    marginBottom: 8,
  },
  selectContainer: {
    gap: 8,
  },
  selectOption: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectOptionSelected: {
    backgroundColor: COLORS.primary + "20",
    borderColor: COLORS.primary,
  },
  selectText: {
    fontSize: 15,
    color: COLORS.text,
  },
  selectTextSelected: {
    color: COLORS.primary,
    fontWeight: "600",
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
