import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  COLORS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  KIDS_OPTIONS,
  EXERCISE_OPTIONS,
  PETS_OPTIONS,
  INSECT_OPTIONS,
} from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { ExerciseStatus, PetType, InsectType } from "@/types";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";

export default function ProfileDetailsLifestyleScreen() {
  const {
    smoking,
    drinking,
    kids,
    exercise,
    pets,
    insect,
    setSmoking,
    setDrinking,
    setKids,
    setExercise,
    togglePet,
    setInsect,
  } = useOnboardingStore();
  const router = useRouter();

  const handleNext = () => {
    if (__DEV__) console.log('[ONB] profile-details/lifestyle → education-religion');
    router.push("/(onboarding)/profile-details/education-religion");
  };

  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] profile-details/lifestyle → basic (previous)');
    router.back();
  };

  const handlePetToggle = (pet: PetType) => {
    const success = togglePet(pet);
    if (!success) {
      Alert.alert("Limit Reached", "You can select up to 3 pets only.");
    }
  };

  const handleInsectToggle = (insectValue: InsectType) => {
    if (insect === insectValue) {
      setInsect(null);
    } else {
      setInsect(insectValue);
    }
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
        <Text style={styles.stepIndicator}>Step 2 of 3</Text>
        <Text style={styles.subtitle}>
          Tell us about your lifestyle preferences.
        </Text>

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
            <Text style={styles.label}>Pets (select up to 3)</Text>
            <View style={styles.optionsRow}>
              {PETS_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionChip,
                    pets.includes(option.value as PetType) &&
                      styles.optionChipSelected,
                  ]}
                  onPress={() => handlePetToggle(option.value as PetType)}
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

          <View style={styles.field}>
            <Text style={styles.label}>Insects (optional)</Text>
            <View style={styles.optionsRow}>
              {INSECT_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionChip,
                    insect === option.value && styles.optionChipSelected,
                  ]}
                  onPress={() => handleInsectToggle(option.value as InsectType)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      insect === option.value && styles.optionTextSelected,
                    ]}
                  >
                    {option.emoji} {option.label}
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
