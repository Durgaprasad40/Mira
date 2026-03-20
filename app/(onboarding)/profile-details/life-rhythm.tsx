/**
 * Phase-1 Onboarding: Life Rhythm
 *
 * Collects new matching/ranking signals:
 * 1. City / Location (hybrid GPS + editable) - Required
 * 2. Social Rhythm (single select) - Required
 * 3. Sleep Schedule (single select) - Required
 * 4. Travel Style (single select) - Optional
 * 5. Work Style (single select) - Optional
 * 6. Core Values (multi-select, 1-3) - Required
 *
 * Placed after Lifestyle, before Preferences.
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import {
  COLORS,
  SOCIAL_RHYTHM_PROMPT,
  SOCIAL_RHYTHM_OPTIONS,
  SLEEP_SCHEDULE_PROMPT,
  SLEEP_SCHEDULE_OPTIONS,
  TRAVEL_STYLE_PROMPT,
  TRAVEL_STYLE_OPTIONS,
  WORK_STYLE_PROMPT,
  WORK_STYLE_OPTIONS,
  CORE_VALUES_PROMPT,
  CORE_VALUES_OPTIONS,
  SocialRhythmValue,
  SleepScheduleValue,
  TravelStyleValue,
  WorkStyleValue,
  CoreValueValue,
} from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";
import { useScreenTrace } from "@/lib/devTrace";

export default function LifeRhythmScreen() {
  useScreenTrace("ONB_LIFE_RHYTHM");

  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();
  const isEditFromReview = params.editFromReview === "true";

  const { userId } = useAuthStore();
  const upsertDraft = useMutation(api.users.upsertOnboardingDraft);
  const convexHydrated = useOnboardingStore((s) => s._convexHydrated);

  // Store state
  const {
    lifeRhythm,
    setLifeRhythmCity,
    setLifeRhythmSocialRhythm,
    setLifeRhythmSleepSchedule,
    setLifeRhythmTravelStyle,
    setLifeRhythmWorkStyle,
    toggleLifeRhythmCoreValue,
    setStep,
  } = useOnboardingStore();

  // Local state for immediate UI feedback
  const [city, setLocalCity] = useState<string>(lifeRhythm.city || "");
  const [socialRhythm, setLocalSocialRhythm] = useState<SocialRhythmValue | null>(
    lifeRhythm.socialRhythm
  );
  const [sleepSchedule, setLocalSleepSchedule] = useState<SleepScheduleValue | null>(
    lifeRhythm.sleepSchedule
  );
  const [travelStyle, setLocalTravelStyle] = useState<TravelStyleValue | null>(
    lifeRhythm.travelStyle
  );
  const [workStyle, setLocalWorkStyle] = useState<WorkStyleValue | null>(
    lifeRhythm.workStyle
  );
  const [coreValues, setLocalCoreValues] = useState<CoreValueValue[]>(
    lifeRhythm.coreValues || []
  );

  // Location detection state
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // P0 STABILITY: Prevent double-submission on rapid taps
  const [isSubmitting, setIsSubmitting] = useState(false);

  // P1 STABILITY: Track mounted state to prevent setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // STABILITY FIX: Sync from store AFTER Convex hydration completes
  useEffect(() => {
    if (!isDemoMode && convexHydrated) {
      if (lifeRhythm.city) setLocalCity(lifeRhythm.city);
      if (lifeRhythm.socialRhythm) setLocalSocialRhythm(lifeRhythm.socialRhythm);
      if (lifeRhythm.sleepSchedule) setLocalSleepSchedule(lifeRhythm.sleepSchedule);
      if (lifeRhythm.travelStyle) setLocalTravelStyle(lifeRhythm.travelStyle);
      if (lifeRhythm.workStyle) setLocalWorkStyle(lifeRhythm.workStyle);
      if (lifeRhythm.coreValues?.length > 0) setLocalCoreValues(lifeRhythm.coreValues);
      if (__DEV__) {
        console.log("[LIFE_RHYTHM] Synced from hydrated store:", lifeRhythm);
      }
    }
  }, [convexHydrated]);

  // Sync from store on mount (for edit flow and demo mode)
  useEffect(() => {
    if (lifeRhythm.city) setLocalCity(lifeRhythm.city);
    if (lifeRhythm.socialRhythm) setLocalSocialRhythm(lifeRhythm.socialRhythm);
    if (lifeRhythm.sleepSchedule) setLocalSleepSchedule(lifeRhythm.sleepSchedule);
    if (lifeRhythm.travelStyle) setLocalTravelStyle(lifeRhythm.travelStyle);
    if (lifeRhythm.workStyle) setLocalWorkStyle(lifeRhythm.workStyle);
    if (lifeRhythm.coreValues?.length > 0) setLocalCoreValues(lifeRhythm.coreValues);
  }, []);

  // Auto-detect location on mount if city is empty
  useEffect(() => {
    if (!city && !isDetectingLocation) {
      detectCurrentCity();
    }
  }, []);

  // Detect current city using GPS
  const detectCurrentCity = useCallback(async () => {
    setIsDetectingLocation(true);
    setLocationError(null);

    try {
      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      // P1 STABILITY: Check mounted before setState after async
      if (!isMountedRef.current) return;
      if (status !== "granted") {
        setLocationError("Location permission not granted. Please enter your city manually.");
        setIsDetectingLocation(false);
        return;
      }

      // Get current position
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      // P1 STABILITY: Check mounted before setState after async
      if (!isMountedRef.current) return;

      // Reverse geocode to get city
      // ONB-014 FIX: Safely handle null/empty result from reverseGeocodeAsync
      const geocodeResult = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      // P1 STABILITY: Check mounted before setState after async
      if (!isMountedRef.current) return;

      const geocode = Array.isArray(geocodeResult) && geocodeResult.length > 0 ? geocodeResult[0] : null;
      if (geocode) {
        const detectedCity = geocode.city || geocode.subregion || geocode.region || "";
        if (detectedCity) {
          setLocalCity(detectedCity);
          if (__DEV__) {
            console.log("[LIFE_RHYTHM] Detected city:", detectedCity);
          }
        } else {
          setLocationError("Could not detect city. Please enter manually.");
        }
      } else {
        setLocationError("Could not detect city. Please enter manually.");
      }
    } catch (error) {
      if (__DEV__) {
        console.log("[LIFE_RHYTHM] Location detection error:", error);
      }
      // P1 STABILITY: Check mounted before setState in catch
      if (!isMountedRef.current) return;
      setLocationError("Could not detect location. Please enter your city manually.");
    } finally {
      // P1 STABILITY: Check mounted before setState in finally
      if (isMountedRef.current) {
        setIsDetectingLocation(false);
      }
    }
  }, []);

  // Handle core value toggle (max 3)
  const handleCoreValueToggle = (value: CoreValueValue) => {
    if (coreValues.includes(value)) {
      // Remove value
      setLocalCoreValues(coreValues.filter((v) => v !== value));
    } else if (coreValues.length < 3) {
      // Add value (max 3)
      setLocalCoreValues([...coreValues, value]);
    } else {
      // Max 3 reached
      Alert.alert("Limit Reached", "You can select up to 3 values only.");
    }
  };

  // Validation: city, socialRhythm, sleepSchedule, and at least 1 coreValue required
  const canContinue =
    city.trim().length > 0 &&
    socialRhythm !== null &&
    sleepSchedule !== null &&
    coreValues.length >= 1;

  const handleNext = async () => {
    // P0 STABILITY: Prevent double-tap
    if (!canContinue || isSubmitting) return;
    setIsSubmitting(true);

    // Save to store
    setLifeRhythmCity(city.trim());
    setLifeRhythmSocialRhythm(socialRhythm);
    setLifeRhythmSleepSchedule(sleepSchedule);
    setLifeRhythmTravelStyle(travelStyle);
    setLifeRhythmWorkStyle(workStyle);

    // Update core values in store
    const store = useOnboardingStore.getState();
    // Clear existing and set new
    store.lifeRhythm.coreValues.forEach((v) => {
      if (!coreValues.includes(v)) {
        toggleLifeRhythmCoreValue(v);
      }
    });
    coreValues.forEach((v) => {
      if (!store.lifeRhythm.coreValues.includes(v)) {
        toggleLifeRhythmCoreValue(v);
      }
    });

    // LIVE MODE: Persist to Convex onboarding draft
    // P1 STABILITY: Await draft save before navigation to prevent data loss
    if (!isDemoMode && userId) {
      const lifeRhythmData = {
        city: city.trim(),
        socialRhythm,
        sleepSchedule,
        travelStyle,
        workStyle,
        coreValues,
      };
      try {
        await upsertDraft({
          userId,
          patch: {
            lifeRhythm: lifeRhythmData,
            progress: { lastStepKey: "profile-details/life-rhythm" },
          },
        });
        if (__DEV__) console.log("[ONB_DRAFT] Saved lifeRhythm:", lifeRhythmData);
      } catch (error) {
        if (__DEV__) console.error("[LIFE_RHYTHM] Failed to save draft:", error);
        // P1 STABILITY: Block navigation on save failure, alert user
        if (isMountedRef.current) {
          setIsSubmitting(false);
          Alert.alert(
            "Save Failed",
            "Could not save your life rhythm details. Please check your connection and try again."
          );
        }
        return;
      }
    }

    // P1 STABILITY: Check mounted before continuing (async gap)
    if (!isMountedRef.current) return;

    // Navigate
    if (isEditFromReview) {
      if (__DEV__) console.log("[ONB] profile-details/life-rhythm -> review (editFromReview)");
      router.replace("/(onboarding)/review" as any);
    } else {
      if (__DEV__) console.log("[ONB] profile-details/life-rhythm -> preferences");
      setStep("life_rhythm");
      router.push("/(onboarding)/preferences" as any);
    }
    if (isMountedRef.current) setIsSubmitting(false);
  };

  const handlePrevious = () => {
    if (__DEV__) console.log("[ONB] profile-details/life-rhythm -> lifestyle (previous)");
    router.back();
  };

  // STABILITY FIX: Wait for Convex hydration before rendering form
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

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <OnboardingProgressHeader />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Life Rhythm</Text>
        <Text style={styles.stepIndicator}>Step 3 of 3</Text>
        <Text style={styles.subtitle}>
          Tell us a little about your lifestyle and values.
        </Text>

        {/* 1. City / Location */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Location</Text>
          <View style={styles.locationContainer}>
            <View style={styles.locationInputRow}>
              <TextInput
                style={styles.cityInput}
                value={city}
                onChangeText={setLocalCity}
                placeholder="Enter your city"
                placeholderTextColor={COLORS.textMuted}
                maxLength={100}
              />
              <TouchableOpacity
                style={styles.detectButton}
                onPress={detectCurrentCity}
                disabled={isDetectingLocation}
              >
                {isDetectingLocation ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Ionicons name="location" size={20} color={COLORS.white} />
                )}
              </TouchableOpacity>
            </View>
            {locationError && (
              <Text style={styles.locationErrorText}>{locationError}</Text>
            )}
            <Text style={styles.locationHint}>
              Tap the location icon to detect your city automatically
            </Text>
          </View>
        </View>

        {/* 2. Social Rhythm */}
        <View style={styles.section}>
          <Text style={styles.questionLabel}>{SOCIAL_RHYTHM_PROMPT}</Text>
          <View style={styles.optionsRow}>
            {SOCIAL_RHYTHM_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  socialRhythm === option.value && styles.optionChipSelected,
                ]}
                onPress={() =>
                  setLocalSocialRhythm(
                    socialRhythm === option.value ? null : option.value
                  )
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    socialRhythm === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 3. Sleep Schedule */}
        <View style={styles.section}>
          <Text style={styles.questionLabel}>{SLEEP_SCHEDULE_PROMPT}</Text>
          <View style={styles.optionsRow}>
            {SLEEP_SCHEDULE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  sleepSchedule === option.value && styles.optionChipSelected,
                ]}
                onPress={() =>
                  setLocalSleepSchedule(
                    sleepSchedule === option.value ? null : option.value
                  )
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    sleepSchedule === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 4. Travel Style (Optional) */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.questionLabel}>{TRAVEL_STYLE_PROMPT}</Text>
            <Text style={styles.optionalBadge}>Optional</Text>
          </View>
          <View style={styles.optionsRow}>
            {TRAVEL_STYLE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  travelStyle === option.value && styles.optionChipSelected,
                ]}
                onPress={() =>
                  setLocalTravelStyle(
                    travelStyle === option.value ? null : option.value
                  )
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    travelStyle === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 5. Work Style (Optional) */}
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.questionLabel}>{WORK_STYLE_PROMPT}</Text>
            <Text style={styles.optionalBadge}>Optional</Text>
          </View>
          <View style={styles.optionsRow}>
            {WORK_STYLE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  workStyle === option.value && styles.optionChipSelected,
                ]}
                onPress={() =>
                  setLocalWorkStyle(
                    workStyle === option.value ? null : option.value
                  )
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    workStyle === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 6. Core Values */}
        <View style={styles.section}>
          <Text style={styles.questionLabel}>{CORE_VALUES_PROMPT}</Text>
          <Text style={styles.helperText}>
            Select up to 3 ({coreValues.length}/3 selected)
          </Text>
          <View style={styles.optionsRow}>
            {CORE_VALUES_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  coreValues.includes(option.value) && styles.optionChipSelected,
                ]}
                onPress={() => handleCoreValueToggle(option.value)}
              >
                <Text
                  style={[
                    styles.optionText,
                    coreValues.includes(option.value) && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Button
            title="Next"
            variant="primary"
            onPress={handleNext}
            disabled={!canContinue}
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
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 12,
  },
  questionLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.text,
    marginBottom: 10,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  optionalBadge: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginLeft: 8,
    fontStyle: "italic",
  },
  helperText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 10,
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
  // Location styles
  locationContainer: {
    marginBottom: 8,
  },
  locationInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cityInput: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detectButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  locationHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 8,
  },
  locationErrorText: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: 6,
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
