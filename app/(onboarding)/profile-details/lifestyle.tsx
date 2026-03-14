/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/profile-details/lifestyle.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import React, { useEffect } from "react";
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
import { useRouter, useLocalSearchParams } from "expo-router";
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
import { useDemoStore } from "@/stores/demoStore";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ExerciseStatus, PetType, InsectType } from "@/types";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";
import { useScreenTrace } from "@/lib/devTrace";

export default function ProfileDetailsLifestyleScreen() {
  useScreenTrace("ONB_PROFILE_LIFESTYLE");
  const {
    smoking,
    drinking,
    kids,
    exercise,
    pets,
    insect,
    religion, // BUG FIX: Read religion to preserve it during lifestyle save
    setSmoking,
    setDrinking,
    setKids,
    setExercise,
    togglePet,
    setPets,
    setInsect,
  } = useOnboardingStore();
  const convexHydrated = useOnboardingStore((s) => s._convexHydrated);
  const { userId } = useAuthStore();
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const upsertDraft = useMutation(api.users.upsertOnboardingDraft);
  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // CENTRAL EDIT HUB: Detect if editing from Review screen
  const isEditFromReview = params.editFromReview === 'true';

  // STABILITY FIX: Wait for Convex hydration before rendering form
  // This prevents data loss when user navigates before hydration completes
  if (!isDemoMode && !convexHydrated) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <OnboardingProgressHeader />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Prefill from demoProfiles if onboardingStore is empty
  useEffect(() => {
    if (isDemoMode && demoHydrated && demoProfile) {
      let loaded = false;
      if (demoProfile.smoking && !smoking) {
        setSmoking(demoProfile.smoking as any);
        loaded = true;
      }
      if (demoProfile.drinking && !drinking) {
        setDrinking(demoProfile.drinking as any);
        loaded = true;
      }
      if (demoProfile.kids && !kids) {
        setKids(demoProfile.kids as any);
        loaded = true;
      }
      if (demoProfile.exercise && !exercise) {
        setExercise(demoProfile.exercise as ExerciseStatus);
        loaded = true;
      }
      if (demoProfile.pets && demoProfile.pets.length > 0 && pets.length === 0) {
        demoProfile.pets.forEach((p) => togglePet(p as PetType));
        loaded = true;
      }
      if (demoProfile.insect && !insect) {
        setInsect(demoProfile.insect as InsectType);
        loaded = true;
      }
      if (loaded) console.log('[LIFESTYLE] prefilled lifestyle fields from demoProfile');
    }
  }, [demoHydrated, demoProfile]);

  const handleNext = () => {
    // SAVE-AS-YOU-GO: Persist to demoProfiles immediately
    if (isDemoMode && userId) {
      const demoStore = useDemoStore.getState();
      const dataToSave: Record<string, any> = {};
      if (smoking) dataToSave.smoking = smoking;
      if (drinking) dataToSave.drinking = drinking;
      if (kids) dataToSave.kids = kids;
      if (exercise) dataToSave.exercise = exercise;
      if (pets.length > 0) dataToSave.pets = pets;
      if (insect) dataToSave.insect = insect;
      if (Object.keys(dataToSave).length > 0) {
        demoStore.saveDemoProfile(userId, dataToSave);
        console.log(`[LIFESTYLE] saved: ${JSON.stringify(dataToSave)}`);
      }
    }

    // LIVE MODE: Persist to Convex onboarding draft
    if (!isDemoMode && userId) {
      const lifestyle: Record<string, any> = {};
      if (smoking) lifestyle.smoking = smoking;
      if (drinking) lifestyle.drinking = drinking;
      if (kids) lifestyle.kids = kids;
      if (exercise) lifestyle.exercise = exercise;
      if (pets.length > 0) lifestyle.pets = pets;
      if (insect) lifestyle.insect = insect;
      // BUG FIX: Preserve religion from store (set in profile-details/index.tsx)
      // This ensures religion isn't lost due to race conditions between saves
      if (religion) lifestyle.religion = religion;

      if (Object.keys(lifestyle).length > 0) {
        if (__DEV__) {
          console.log('[LIFESTYLE] Saving with religion preserved:', {
            religion: religion ?? 'null',
            lifestyleKeys: Object.keys(lifestyle),
          });
        }
        upsertDraft({
          userId,
          patch: {
            lifestyle,
            progress: { lastStepKey: 'profile-details/lifestyle' },
          },
        }).catch((error) => {
          if (__DEV__) console.error('[LIFESTYLE] Failed to save draft:', error);
        });
      }
    }

    // CENTRAL EDIT HUB: Return to Review if editing from there
    if (isEditFromReview) {
      if (__DEV__) console.log('[ONB] profile-details/lifestyle → review (editFromReview)');
      router.replace('/(onboarding)/review' as any);
      return;
    }

    if (__DEV__) console.log('[ONB] profile-details/lifestyle → preferences');
    router.push("/(onboarding)/preferences");
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
        <Text style={styles.stepIndicator}>Step 2 of 2</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
});
