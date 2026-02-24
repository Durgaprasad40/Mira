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
import { COLORS } from "@/lib/constants";
import { Input, Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";

export default function ProfileDetailsBasicScreen() {
  const {
    height,
    weight,
    jobTitle,
    company,
    school,
    setHeight,
    setWeight,
    setJobTitle,
    setCompany,
    setSchool,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();

  const handleNext = () => {
    if (__DEV__) console.log('[ONB] profile-details/basic → lifestyle');
    setStep('profile_details');
    router.push("/(onboarding)/profile-details/lifestyle");
  };

  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] profile-details/basic → prompts (previous)');
    setStep("prompts");
    router.push("/(onboarding)/prompts");
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
        <Text style={styles.stepIndicator}>Step 1 of 3</Text>
        <Text style={styles.subtitle}>
          Share more about yourself. These details help others get to know you
          better.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Basic Info</Text>
          <View style={styles.field}>
            <Input
              label="Height (cm)"
              value={height ? height.toString() : ""}
              onChangeText={(text) => setHeight(text ? parseInt(text) : null)}
              placeholder="Enter height in cm"
              keyboardType="numeric"
            />
          </View>
          <View style={styles.field}>
            <Input
              label="Weight (kg) - Optional"
              value={weight ? weight.toString() : ""}
              onChangeText={(text) => setWeight(text ? parseInt(text) : null)}
              placeholder="Enter weight (optional)"
              keyboardType="numeric"
            />
          </View>
          <View style={styles.field}>
            <Input
              label="Job Title"
              value={jobTitle}
              onChangeText={setJobTitle}
              placeholder="Your job title"
            />
          </View>
          <View style={styles.field}>
            <Input
              label="Company"
              value={company}
              onChangeText={setCompany}
              placeholder="Company name"
            />
          </View>
          <View style={styles.field}>
            <Input
              label="School/University"
              value={school}
              onChangeText={setSchool}
              placeholder="Your alma mater"
            />
          </View>
        </View>

        <View style={styles.footer}>
          <Button
            title="Next"
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
    marginBottom: 4,
  },
  stepIndicator: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 10,
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
  footer: {
    marginTop: 24,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
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
