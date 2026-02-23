import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { COLORS, VALIDATION, GENDER_OPTIONS } from "@/lib/constants";
import { Input, Button } from "@/components/ui";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useAuthStore } from "@/stores/authStore";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Gender } from "@/types";
import { isDemoMode, convex } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { useAuthSubmit } from "@/hooks/useAuthSubmit";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";

// =============================================================================
// DOB Date Helpers - Avoid UTC conversion bugs
// =============================================================================

/**
 * Parse "YYYY-MM-DD" string to local Date object.
 * Uses noon to avoid DST edge cases.
 * DO NOT use new Date("YYYY-MM-DD") as it parses as UTC!
 */
function parseDOBString(dobString: string): Date {
  if (!dobString || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) {
    return new Date(2000, 0, 1, 12, 0, 0); // Default
  }
  const [y, m, d] = dobString.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // Noon local time
}

/**
 * Convert Date object to "YYYY-MM-DD" string using LOCAL date components.
 * DO NOT use toISOString() as it converts to UTC first!
 */
function formatDOBToString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function BasicInfoScreen() {
  const {
    name,
    dateOfBirth,
    gender,
    email,
    password,
    nickname,
    setName,
    setDateOfBirth,
    setGender,
    setNickname,
    setStep,
  } = useOnboardingStore();
  const { setAuth, userId } = useAuthStore();
  const router = useRouter();
  const params = useLocalSearchParams();

  // Read-only mode: when confirm=true (existing user login)
  const isReadOnly = params.confirm === "true";

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    parseDOBString(dateOfBirth), // Uses local date parsing, not UTC
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ageBlocked, setAgeBlocked] = useState(false);

  // Read-only mode state for displaying existing user data
  const [displayName, setDisplayName] = useState("");
  const [displayDOB, setDisplayDOB] = useState("");
  const [displayGender, setDisplayGender] = useState<Gender | "">("");
  const [displayHandle, setDisplayHandle] = useState("");

  // Nickname availability state (for new users)
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isNicknameAvailable, setIsNicknameAvailable] = useState<boolean | null>(null);
  const availabilityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch existing user data in read-only mode (live mode only)
  const existingUserData = useQuery(
    api.auth.getUserBasicInfo,
    !isDemoMode && isReadOnly && userId ? { userId } : "skip"
  );

  // Debug logging on mount and cleanup
  useEffect(() => {
    console.log('[BASIC] ========================================');
    console.log(`[BASIC] mounted mode=${isReadOnly ? 'existing' : 'new'}, userId=${userId || 'none'}, confirm=${params.confirm}`);
    console.log(`[BASIC] inputs editable=${!isReadOnly} reason=${isReadOnly ? 'confirm=true (existing user)' : 'new signup'}`);
    console.log('[BASIC] ========================================');

    // Cleanup timeout on unmount
    return () => {
      if (availabilityTimeoutRef.current) {
        clearTimeout(availabilityTimeoutRef.current);
      }
    };
  }, []);

  // Load existing data into display state
  useEffect(() => {
    if (isReadOnly) {
      if (isDemoMode && userId) {
        // Demo mode: get from demoStore
        const demoStore = useDemoStore.getState();
        const profile = demoStore.demoProfiles[userId];
        if (profile) {
          setDisplayName(profile.name || "");
          setDisplayDOB(profile.dateOfBirth || "");
          setDisplayGender((profile.gender as Gender) || "");
          setDisplayHandle(profile.handle || "");
          if (profile.dateOfBirth) {
            setSelectedDate(parseDOBString(profile.dateOfBirth));
          }
        }
      } else if (existingUserData) {
        // Live mode: use query result
        setDisplayName(existingUserData.name || "");
        setDisplayDOB(existingUserData.dateOfBirth || "");
        setDisplayGender((existingUserData.gender as Gender) || "");
        setDisplayHandle(existingUserData.handle || "");
        if (existingUserData.dateOfBirth) {
          setSelectedDate(parseDOBString(existingUserData.dateOfBirth));
        }
      }
    }
  }, [isReadOnly, userId, existingUserData]);

  const { submitEmailRegistration } = useAuthSubmit();

  // Debounced nickname availability check (only for new users)
  const checkNicknameAvailability = useCallback(async (handle: string) => {
    // Clear any pending check
    if (availabilityTimeoutRef.current) {
      clearTimeout(availabilityTimeoutRef.current);
    }

    // Reset state if handle is too short
    if (!handle || handle.length < 3) {
      setIsCheckingAvailability(false);
      setIsNicknameAvailable(null);
      return;
    }

    // Start checking indicator
    setIsCheckingAvailability(true);
    setIsNicknameAvailable(null);

    // Log demo mode status for debugging
    console.log(`[BASIC] EXPO_PUBLIC_DEMO_MODE=${process.env.EXPO_PUBLIC_DEMO_MODE}, isDemoMode=${isDemoMode}`);

    // Debounce the actual check
    availabilityTimeoutRef.current = setTimeout(async () => {
      try {
        console.log(`[BASIC] nickname=${handle} checking availability...`);

        if (isDemoMode) {
          // Demo mode: check against demoStore handles
          const demoStore = useDemoStore.getState();
          const profiles = Object.values(demoStore.demoProfiles);
          const taken = profiles.some((p: any) => p.handle === handle);
          console.log(`[BASIC] nickname=${handle} available=${!taken} (demo mode - checked local demoStore)`);
          setIsNicknameAvailable(!taken);
        } else {
          // Live mode: query Convex database for handle availability
          console.log(`[BASIC] nickname=${handle} querying Convex checkHandleExists...`);
          const result = await convex.query(api.auth.checkHandleExists, { handle });
          const available = !result.exists;
          console.log(`[BASIC] nickname=${handle} available=${available} (live mode - Convex DB, exists=${result.exists})`);
          setIsNicknameAvailable(available);
        }
      } catch (error) {
        console.error('[BASIC] availability check error:', error);
        setIsNicknameAvailable(null);
      } finally {
        setIsCheckingAvailability(false);
      }
    }, 400); // 400ms debounce
  }, []);

  const calculateAge = (dob: string) => {
    if (!dob) return 0;
    const birthDate = parseDOBString(dob); // Use local parsing, not UTC
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
    if (date && !isReadOnly) {
      setSelectedDate(date);
      // Use LOCAL date components, NOT toISOString() which converts to UTC
      const dobString = formatDOBToString(date);
      console.log("[DOB] selected", date.toString(), "saved", dobString);
      const age = calculateAge(dobString);
      if (age < VALIDATION.MIN_AGE) {
        setAgeBlocked(true);
        setError("");
        return;
      }
      setAgeBlocked(false);
      setDateOfBirth(dobString);
      setError("");
    }
  };

  // Handle Continue in READ-ONLY mode (existing user)
  const handleReadOnlyContinue = () => {
    if (__DEV__) console.log("[ONB] basic_info_confirm readOnly=true → continue_to_consent");
    setStep("consent");
    router.replace("/(onboarding)/consent" as any);
  };

  // Handle Continue in EDIT mode (new signup)
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
    if (!nickname || nickname.length < 3) {
      setError("Nickname must be at least 3 characters");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(nickname)) {
      setError("Nickname can only contain lowercase letters, numbers, and underscores");
      return;
    }
    // Block if nickname availability is still checking or known to be taken
    if (isCheckingAvailability) {
      setError("Please wait while we check nickname availability");
      return;
    }
    if (isNicknameAvailable === false) {
      setError("This nickname is already taken. Please choose another.");
      return;
    }

    // Create user account
    setIsSubmitting(true);
    try {
      if (isDemoMode) {
        // Demo mode: local account creation via demoStore
        const demoStore = useDemoStore.getState();
        let newUserId: string;
        try {
          newUserId = demoStore.demoSignUp(email, password);
        } catch (signUpError: any) {
          // If email already exists, try sign-in
          if (signUpError.message?.includes("already exists")) {
            try {
              const result = demoStore.demoSignIn(email, password);
              newUserId = result.userId;
              setAuth(newUserId, "demo_token", result.onboardingComplete);
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
        setAuth(newUserId, "demo_token", false);
        setStep("consent");
        router.push("/(onboarding)/consent" as any);
        return;
      }

      // Live mode: register via Convex using central auth hook
      const result = await submitEmailRegistration({
        email,
        password,
        name,
        handle: nickname,
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
    const d = parseDOBString(date); // Use local parsing, not UTC
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Values to display (read-only uses fetched data, edit uses store)
  const currentName = isReadOnly ? displayName : name;
  const currentDOB = isReadOnly ? displayDOB : dateOfBirth;
  const currentGender = isReadOnly ? displayGender : gender;

  // Loading state for read-only mode
  if (isReadOnly && !isDemoMode && existingUserData === undefined) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Tell us about yourself</Text>
      <Text style={styles.subtitle}>
        {isReadOnly
          ? "Please verify your information before continuing."
          : "This information will be shown on your profile."}
      </Text>

      {/* Name field */}
      <View style={styles.field}>
        <Input
          label="Name"
          value={currentName}
          onChangeText={isReadOnly ? undefined : (text) => {
            setName(text);
            setError("");
          }}
          placeholder="Your first name"
          autoCapitalize="words"
          maxLength={VALIDATION.NAME_MAX_LENGTH}
          editable={!isReadOnly}
          style={isReadOnly ? styles.disabledInput : undefined}
        />
        {!isReadOnly && (
          <Text style={styles.hint}>
            {name.length}/{VALIDATION.NAME_MAX_LENGTH} characters
          </Text>
        )}
      </View>

      {/* Nickname (User ID) field */}
      <View style={styles.field}>
        <Input
          label="Nickname (User ID)"
          value={isReadOnly ? (displayHandle || "—") : nickname}
          onChangeText={isReadOnly ? undefined : (text) => {
            // Only allow alphanumeric and underscores, lowercase
            const sanitized = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
            setNickname(sanitized);
            setError("");
            // Trigger availability check for new users
            checkNicknameAvailability(sanitized);
          }}
          placeholder="Choose a unique username"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          editable={!isReadOnly}
          style={isReadOnly ? styles.disabledInput : undefined}
        />
        {/* Availability indicator (only for new users) */}
        {!isReadOnly && nickname.length >= 3 && (
          <View style={styles.availabilityRow}>
            {isCheckingAvailability ? (
              <>
                <ActivityIndicator size="small" color={COLORS.textLight} />
                <Text style={styles.availabilityChecking}>Checking...</Text>
              </>
            ) : isNicknameAvailable === true ? (
              <>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                <Text style={styles.availabilitySuccess}>Available</Text>
              </>
            ) : isNicknameAvailable === false ? (
              <>
                <Ionicons name="close-circle" size={16} color={COLORS.error} />
                <Text style={styles.availabilityError}>Taken</Text>
              </>
            ) : null}
          </View>
        )}
        {!isReadOnly && (
          <Text style={styles.hint}>
            Letters, numbers, and underscores only. {nickname.length}/20
          </Text>
        )}
      </View>

      {/* Date of Birth field */}
      <View style={styles.field}>
        <Text style={styles.label}>Date of Birth</Text>
        <Button
          title={currentDOB ? formatDate(currentDOB) : "Select your date of birth"}
          variant="outline"
          onPress={() => !isReadOnly && setShowDatePicker(true)}
          style={{ ...styles.dateButton, ...(isReadOnly ? styles.disabledButton : {}) }}
          disabled={isReadOnly}
        />
        {currentDOB && (
          <Text style={styles.ageText}>
            Age: {calculateAge(currentDOB)} years old
          </Text>
        )}
      </View>

      {showDatePicker && !isReadOnly && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleDateChange}
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
        />
      )}

      {/* Gender field */}
      <View style={styles.field}>
        <Text style={styles.label}>I am a</Text>
        <View style={styles.genderContainer}>
          {GENDER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.genderOption,
                currentGender === option.value && styles.genderOptionSelected,
                isReadOnly && styles.disabledGenderOption,
              ]}
              onPress={isReadOnly ? undefined : () => {
                setGender(option.value as Gender);
                setError("");
              }}
              disabled={isReadOnly}
              activeOpacity={isReadOnly ? 1 : 0.7}
            >
              <Text
                style={[
                  styles.genderText,
                  currentGender === option.value && styles.genderTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Error display (only in edit mode) */}
      {!isReadOnly && error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Age blocked warning (only in edit mode) */}
      {!isReadOnly && ageBlocked && (
        <View style={styles.ageBlockedContainer}>
          <Text style={styles.ageBlockedTitle}>You must be 18+ to use Mira</Text>
          <Text style={styles.ageBlockedText}>
            Mira is only available for users who are 18 years of age or older.
            We take age requirements seriously to ensure a safe experience for everyone.
          </Text>
        </View>
      )}

      {/* Continue button */}
      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={isReadOnly ? handleReadOnlyContinue : handleNext}
          loading={!isReadOnly && isSubmitting}
          disabled={!isReadOnly && (ageBlocked || isNicknameAvailable === false || isCheckingAvailability)}
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
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
  availabilityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  availabilityChecking: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  availabilitySuccess: {
    fontSize: 12,
    color: COLORS.success,
    fontWeight: "500",
  },
  availabilityError: {
    fontSize: 12,
    color: COLORS.error,
    fontWeight: "500",
  },
  dateButton: {
    marginTop: 8,
  },
  disabledButton: {
    opacity: 0.7,
  },
  disabledInput: {
    opacity: 0.7,
  },
  disabledGenderOption: {
    opacity: 0.7,
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
