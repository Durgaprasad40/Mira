import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import {
  COLORS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  KIDS_OPTIONS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
  EXERCISE_OPTIONS,
  PETS_OPTIONS,
} from "@/lib/constants";
import { Input, Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { ExerciseStatus, PetType } from "@/types";

export default function ProfileDetailsScreen() {
  const {
    height,
    weight,
    smoking,
    drinking,
    kids,
    exercise,
    pets,
    education,
    religion,
    jobTitle,
    company,
    school,
    setHeight,
    setWeight,
    setSmoking,
    setDrinking,
    setKids,
    setExercise,
    setPets,
    togglePet,
    setEducation,
    setReligion,
    setJobTitle,
    setCompany,
    setSchool,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();

  const handleNext = () => {
    if (__DEV__) console.log('[ONB] profile-details → preferences (continue)');
    setStep("preferences");
    router.push("/(onboarding)/preferences");
  };

  // POST-VERIFICATION: Skip advances to next step
  const handleSkip = () => {
    if (__DEV__) console.log('[ONB] profile-details → preferences (skip)');
    setStep("preferences");
    router.push("/(onboarding)/preferences");
  };

  // POST-VERIFICATION: Previous goes back
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] profile-details → prompts (previous)');
    setStep("prompts");
    router.push("/(onboarding)/prompts");
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profile Details</Text>
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
            placeholder="170"
            keyboardType="numeric"
          />
        </View>
        <View style={styles.field}>
          <Input
            label="Weight (kg) - Optional"
            value={weight ? weight.toString() : ""}
            onChangeText={(text) => setWeight(text ? parseInt(text) : null)}
            placeholder="70"
            keyboardType="numeric"
          />
        </View>
        <View style={styles.field}>
          <Input
            label="Job Title"
            value={jobTitle}
            onChangeText={setJobTitle}
            placeholder="Software Engineer"
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Lifestyle</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Smoking</Text>
          <View style={styles.optionsRow}>
            {SMOKING_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  smoking === option.value && styles.optionChipSelected,
                ]}
                onPress={() =>
                  setSmoking(
                    smoking === option.value ? null : (option.value as any),
                  )
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    smoking === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Drinking</Text>
          <View style={styles.optionsRow}>
            {DRINKING_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  drinking === option.value && styles.optionChipSelected,
                ]}
                onPress={() =>
                  setDrinking(
                    drinking === option.value ? null : (option.value as any),
                  )
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    drinking === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Kids</Text>
          <View style={styles.optionsRow}>
            {KIDS_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  kids === option.value && styles.optionChipSelected,
                ]}
                onPress={() =>
                  setKids(kids === option.value ? null : (option.value as any))
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    kids === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Exercise</Text>
          <View style={styles.optionsRow}>
            {EXERCISE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  exercise === option.value && styles.optionChipSelected,
                ]}
                onPress={() =>
                  setExercise(
                    exercise === option.value
                      ? null
                      : (option.value as ExerciseStatus),
                  )
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    exercise === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Pets</Text>
          <View style={styles.optionsRow}>
            {PETS_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  pets.includes(option.value as PetType) &&
                    styles.optionChipSelected,
                ]}
                onPress={() => togglePet(option.value as PetType)}
              >
                <Text
                  style={[
                    styles.optionText,
                    pets.includes(option.value as PetType) &&
                      styles.optionTextSelected,
                  ]}
                >
                  {option.emoji} {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

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
          onPress={handleNext}
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
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  optionText: {
    fontSize: 14,
    color: COLORS.text,
  },
  optionTextSelected: {
    color: COLORS.white,
    fontWeight: "600",
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
