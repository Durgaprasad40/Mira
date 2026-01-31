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
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Gender } from "@/types";

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

  const registerWithEmail = useMutation(api.auth.registerWithEmail);
  const loginWithEmail = useMutation(api.auth.loginWithEmail);

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
      // Try to register
      const result = await registerWithEmail({
        email,
        password,
        name,
        dateOfBirth,
        gender,
      });

      if (result.success && result.userId && result.token) {
        setAuth(result.userId, result.token, false);
        setStep("photo_upload");
        router.push("/(onboarding)/photo-upload" as any);
      }
    } catch (error: any) {
      // If user already exists, try to login
      if (error.message?.includes("already registered")) {
        try {
          const loginResult = await loginWithEmail({ email, password });
          if (loginResult.success && loginResult.userId && loginResult.token) {
            setAuth(
              loginResult.userId,
              loginResult.token,
              loginResult.onboardingCompleted || false,
            );
            if (loginResult.onboardingCompleted) {
              router.replace("/(main)/(tabs)/discover");
            } else {
              setStep("photo_upload");
              router.push("/(onboarding)/photo-upload" as any);
            }
          }
        } catch (loginError: any) {
          Alert.alert(
            "Error",
            loginError.message ||
              "Failed to login. Please check your password.",
          );
        }
      } else {
        Alert.alert("Error", error.message || "Failed to create account");
      }
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
