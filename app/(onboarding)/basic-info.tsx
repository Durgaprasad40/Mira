import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { COLORS, VALIDATION, GENDER_OPTIONS } from "@/lib/constants";
import { Input, Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useAuthStore } from "@/stores/authStore";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Gender } from "@/types";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { useAuthSubmit } from "@/hooks/useAuthSubmit";

export default function BasicInfoScreen() {
  const {
    name,
    dateOfBirth,
    gender,
    email,
    password,
    setName,
    setDateOfBirth,
    setGender,
    setStep,
  } = useOnboardingStore();
  const { setAuth } = useAuthStore();
  const router = useRouter();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    dateOfBirth ? new Date(dateOfBirth) : new Date(2000, 0, 1),
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ageBlocked, setAgeBlocked] = useState(false);

  const { submitEmailRegistration } = useAuthSubmit();

  const calculateAge = (dob: string) => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }
    return age;
  };

  const handleDateChange = (event: any, date?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (date) {
      setSelectedDate(date);
      const age = calculateAge(date.toISOString().split("T")[0]);
      if (age < VALIDATION.MIN_AGE) {
        setAgeBlocked(true);
        setError("");
        return;
      }
      setAgeBlocked(false);
      setDateOfBirth(date.toISOString().split("T")[0]);
      setError("");
    }
  };

  const handleNext = async () => {
    if (!name || name.length < VALIDATION.NAME_MIN_LENGTH) {
      setError(
        `Name must be at least ${VALIDATION.NAME_MIN_LENGTH} characters`,
      );
      return;
    }
    if (name.length > VALIDATION.NAME_MAX_LENGTH) {
      setError(
        `Name must be no more than ${VALIDATION.NAME_MAX_LENGTH} characters`,
      );
      return;
    }
    if (!/^[a-zA-Z\s]+$/.test(name)) {
      setError("Name can only contain letters");
      return;
    }
    if (!dateOfBirth) {
      setError("Please select your date of birth");
      return;
    }
    const age = calculateAge(dateOfBirth);
    if (age < VALIDATION.MIN_AGE) {
      setError(`You must be at least ${VALIDATION.MIN_AGE} years old`);
      return;
    }
    if (!gender) {
      setError("Please select your gender");
      return;
    }

    // Create user account
    setIsSubmitting(true);
    try {
      if (isDemoMode) {
        // Demo mode: local account creation via demoStore
        const demoStore = useDemoStore.getState();
        let userId: string;
        try {
          userId = demoStore.demoSignUp(email, password);
        } catch (signUpError: any) {
          // If email already exists, try sign-in
          if (signUpError.message?.includes("already exists")) {
            try {
              const result = demoStore.demoSignIn(email, password);
              userId = result.userId;
              setAuth(userId, "demo_token", result.onboardingComplete);
              if (result.onboardingComplete) {
                router.replace("/(main)/(tabs)/home");
                return;
              }
              setStep("consent");
              router.push("/(onboarding)/consent" as any);
              return;
            } catch (loginError: any) {
              Alert.alert("Error", loginError.message || "Failed to login. Please check your password.");
              return;
            }
          } else {
            Alert.alert("Error", signUpError.message || "Failed to create account");
            return;
          }
        }
        setAuth(userId, "demo_token", false);
        setStep("consent");
        router.push("/(onboarding)/consent" as any);
        return;
      }

      // Live mode: register via Convex using central auth hook
      const result = await submitEmailRegistration({
        email,
        password,
        name,
        dateOfBirth,
        gender,
      });

      // If result is null, USER_EXISTS was handled (Alert shown, routing done)
      // Stop execution immediately - do NOT continue onboarding
      if (!result) {
        return;
      }

      if (result.success && result.userId && result.token) {
        setAuth(result.userId, result.token, false);
        setStep("consent");
        router.push("/(onboarding)/consent" as any);
      }
    } catch (error: any) {
      // Handle unexpected errors (USER_EXISTS is already handled by the hook)
      Alert.alert("Error", error.message || "Failed to create account");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (date: string) => {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Tell us about yourself</Text>
      <Text style={styles.subtitle}>
        This information will be shown on your profile.
      </Text>

      <View style={styles.field}>
        <Input
          label="Name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError("");
          }}
          placeholder="Your first name"
          autoCapitalize="words"
          maxLength={VALIDATION.NAME_MAX_LENGTH}
        />
        <Text style={styles.hint}>
          {name.length}/{VALIDATION.NAME_MAX_LENGTH} characters
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Date of Birth</Text>
        <Button
          title={
            dateOfBirth ? formatDate(dateOfBirth) : "Select your date of birth"
          }
          variant="outline"
          onPress={() => setShowDatePicker(true)}
          style={styles.dateButton}
        />
        {dateOfBirth && (
          <Text style={styles.ageText}>
            Age: {calculateAge(dateOfBirth)} years old
          </Text>
        )}
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleDateChange}
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
        />
      )}

      <View style={styles.field}>
        <Text style={styles.label}>I am a</Text>
        <View style={styles.genderContainer}>
          {GENDER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.genderOption,
                gender === option.value && styles.genderOptionSelected,
              ]}
              onPress={() => {
                setGender(option.value as Gender);
                setError("");
              }}
            >
              <Text
                style={[
                  styles.genderText,
                  gender === option.value && styles.genderTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {ageBlocked && (
        <View style={styles.ageBlockedContainer}>
          <Text style={styles.ageBlockedTitle}>You must be 18+ to use Mira</Text>
          <Text style={styles.ageBlockedText}>
            Mira is only available for users who are 18 years of age or older.
            We take age requirements seriously to ensure a safe experience for everyone.
          </Text>
        </View>
      )}

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          loading={isSubmitting}
          disabled={ageBlocked}
          fullWidth
        />
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
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.text,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 4,
  },
  dateButton: {
    marginTop: 8,
  },
  ageText: {
    fontSize: 14,
    color: COLORS.primary,
    marginTop: 8,
    fontWeight: "500",
  },
  error: {
    fontSize: 14,
    color: COLORS.error,
    marginBottom: 16,
  },
  footer: {
    marginTop: 24,
  },
  genderContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  genderOption: {
    flex: 1,
    minWidth: "45%",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  genderOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + "10",
  },
  genderText: {
    fontSize: 16,
    fontWeight: "500",
    color: COLORS.text,
  },
  genderTextSelected: {
    color: COLORS.primary,
  },
  ageBlockedContainer: {
    backgroundColor: COLORS.error + "10",
    borderWidth: 1,
    borderColor: COLORS.error + "30",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  ageBlockedTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.error,
    marginBottom: 8,
  },
  ageBlockedText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: "center",
    lineHeight: 20,
  },
});
