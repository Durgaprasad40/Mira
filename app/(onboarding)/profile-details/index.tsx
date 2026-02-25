import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, EDUCATION_OPTIONS, RELIGION_OPTIONS } from "@/lib/constants";
import { Input, Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useDemoStore } from "@/stores/demoStore";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";
import { EducationLevel, Religion } from "@/types";

export default function ProfileDetailsBasicScreen() {
  const {
    height,
    weight,
    jobTitle,
    company,
    school,
    education,
    educationOther,
    religion,
    setHeight,
    setWeight,
    setJobTitle,
    setCompany,
    setSchool,
    setEducation,
    setEducationOther,
    setReligion,
    setStep,
  } = useOnboardingStore();
  const { userId } = useAuthStore();
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // CENTRAL EDIT HUB: Detect if editing from Review screen
  const isEditFromReview = params.editFromReview === 'true';

  // Validation error state
  const [educationOtherError, setEducationOtherError] = useState<string | null>(null);

  // Prefill from demoProfiles if onboardingStore is empty
  useEffect(() => {
    if (isDemoMode && demoHydrated && demoProfile) {
      let loaded = false;
      if (demoProfile.height != null && !height) {
        setHeight(demoProfile.height);
        loaded = true;
      }
      if (demoProfile.weight != null && !weight) {
        setWeight(demoProfile.weight);
        loaded = true;
      }
      if (demoProfile.jobTitle && !jobTitle) {
        setJobTitle(demoProfile.jobTitle);
        loaded = true;
      }
      if (demoProfile.company && !company) {
        setCompany(demoProfile.company);
        loaded = true;
      }
      if (demoProfile.school && !school) {
        setSchool(demoProfile.school);
        loaded = true;
      }
      if (demoProfile.education && !education) {
        setEducation(demoProfile.education as EducationLevel);
        loaded = true;
      }
      if (demoProfile.educationOther && !educationOther) {
        setEducationOther(demoProfile.educationOther);
        loaded = true;
      }
      if (demoProfile.religion && !religion) {
        setReligion(demoProfile.religion as Religion);
        loaded = true;
      }
      if (loaded) console.log('[PROFILE-DETAILS] prefilled fields from demoProfile');
    }
  }, [demoHydrated, demoProfile]);

  const handleNext = () => {
    // Validate: if education is "other", educationOther must be non-empty
    if (education === 'other' && !educationOther.trim()) {
      setEducationOtherError('Please specify your education');
      return;
    }
    setEducationOtherError(null);

    // SAVE-AS-YOU-GO: Persist to demoProfiles immediately
    if (isDemoMode && userId) {
      const demoStore = useDemoStore.getState();
      const dataToSave: Record<string, any> = {};
      if (height != null) dataToSave.height = height;
      if (weight != null) dataToSave.weight = weight;
      if (jobTitle) dataToSave.jobTitle = jobTitle;
      if (company) dataToSave.company = company;
      if (school) dataToSave.school = school;
      if (education) dataToSave.education = education;
      // Clear educationOther when education is not "other" to prevent ghost data
      if (education === 'other' && educationOther.trim()) {
        dataToSave.educationOther = educationOther.trim();
      } else if (education !== 'other') {
        // Explicitly delete educationOther when not needed
        dataToSave.educationOther = undefined;
      }
      if (religion) dataToSave.religion = religion;
      if (Object.keys(dataToSave).length > 0) {
        demoStore.saveDemoProfile(userId, dataToSave);
        console.log(`[PROFILE-DETAILS] saved: ${JSON.stringify(dataToSave)}`);
      }
    }

    // CENTRAL EDIT HUB: Return to Review if editing from there
    if (isEditFromReview) {
      if (__DEV__) console.log('[ONB] profile-details/basic → review (editFromReview)');
      router.replace('/(onboarding)/review' as any);
      return;
    }

    if (__DEV__) console.log('[ONB] profile-details/basic → lifestyle');
    setStep('profile_details');
    router.push("/(onboarding)/profile-details/lifestyle");
  };

  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] profile-details/basic → back (previous)');
    router.back();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <OnboardingProgressHeader />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Profile Details</Text>
        <Text style={styles.stepIndicator}>Step 1 of 2</Text>
        <Text style={styles.subtitle}>
          Share more about yourself. These details help others get to know you better.
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

        {/* Education & Religion Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Education & Religion</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Education</Text>
            <View style={styles.chipsContainer}>
              {EDUCATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    education === option.value && styles.chipSelected,
                  ]}
                  onPress={() => {
                    setEducation(
                      education === option.value ? null : (option.value as EducationLevel)
                    );
                    // Clear error when selection changes
                    if (educationOtherError) setEducationOtherError(null);
                  }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      education === option.value && styles.chipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* Show text input when "Other" is selected */}
            {education === 'other' && (
              <View style={styles.otherInputContainer}>
                <TextInput
                  style={[
                    styles.otherInput,
                    educationOtherError && styles.otherInputError,
                  ]}
                  value={educationOther}
                  onChangeText={(text) => {
                    setEducationOther(text);
                    if (educationOtherError) setEducationOtherError(null);
                  }}
                  placeholder="Please specify your education"
                  placeholderTextColor={COLORS.textMuted}
                  maxLength={100}
                />
                {educationOtherError && (
                  <Text style={styles.errorText}>{educationOtherError}</Text>
                )}
              </View>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Religion</Text>
            <View style={styles.chipsContainer}>
              {RELIGION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    religion === option.value && styles.chipSelected,
                  ]}
                  onPress={() =>
                    setReligion(
                      religion === option.value ? null : (option.value as Religion)
                    )
                  }
                >
                  <Text
                    style={[
                      styles.chipText,
                      religion === option.value && styles.chipTextSelected,
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
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.text,
    marginBottom: 8,
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  chipTextSelected: {
    color: COLORS.white,
    fontWeight: "600",
  },
  otherInputContainer: {
    marginTop: 12,
  },
  otherInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  otherInputError: {
    borderColor: COLORS.error,
    borderWidth: 2,
  },
  errorText: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: 4,
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
