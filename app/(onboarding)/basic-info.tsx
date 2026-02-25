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
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";
import { COLORS, VALIDATION, GENDER_OPTIONS } from "@/lib/constants";
import { Input, Button } from "@/components/ui";
import { useOnboardingStore, LGBTQ_OPTIONS, LgbtqOption } from "@/stores/onboardingStore";
import { useAuthStore } from "@/stores/authStore";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Gender } from "@/types";
import { isDemoMode, convex } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { useAuthSubmit } from "@/hooks/useAuthSubmit";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { validateRequired, scrollToFirstInvalid, ValidationRule } from "@/lib/onboardingValidation";

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
    lgbtqSelf,
    email,
    password,
    nickname,
    setName,
    setDateOfBirth,
    setGender,
    setNickname,
    toggleLgbtqSelf,
    setLgbtqSelf,
    setStep,
  } = useOnboardingStore();
  const { setAuth, userId } = useAuthStore();
  const router = useRouter();
  const params = useLocalSearchParams();

  // Read-only mode: when confirm=true (existing user login)
  const isConfirmMode = params.confirm === "true";

  // Edit from Review mode: when editFromReview=true (editing LGBTQ only from Review screen)
  const isEditFromReview = params.editFromReview === "true";

  // Recovery mode: confirm=true but basic fields missing in demoProfile
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);

  // Effective read-only: confirm mode (but NOT recovery mode) OR editFromReview mode
  // In editFromReview mode, name/handle/DOB/gender are read-only, only LGBTQ is editable
  const isReadOnly = (isConfirmMode && !isRecoveryMode) || isEditFromReview;

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    parseDOBString(dateOfBirth), // Uses local date parsing, not UTC
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showTopError, setShowTopError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ageBlocked, setAgeBlocked] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Refs for scroll-to-invalid behavior
  const scrollRef = useRef<ScrollView>(null);
  const nameFieldRef = useRef<View>(null);
  const nicknameFieldRef = useRef<View>(null);
  const dobFieldRef = useRef<View>(null);
  const genderFieldRef = useRef<View>(null);

  // Read-only mode state for displaying existing user data
  const [displayName, setDisplayName] = useState("");
  const [displayDOB, setDisplayDOB] = useState("");
  const [displayGender, setDisplayGender] = useState<Gender | "">("");
  const [displayHandle, setDisplayHandle] = useState("");
  const [lgbtqError, setLgbtqError] = useState("");

  // Nickname availability state (for new users)
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isNicknameAvailable, setIsNicknameAvailable] = useState<boolean | null>(null);
  const availabilityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch existing user data in read-only mode (live mode only)
  const existingUserData = useQuery(
    api.auth.getUserBasicInfo,
    !isDemoMode && isReadOnly && userId ? { userId } : "skip"
  );

  // Demo mode: reactively subscribe to demoStore profile (handles hydration timing)
  const demoProfile = useDemoStore((s) =>
    isDemoMode && isConfirmMode && userId ? s.demoProfiles[userId] : null
  );
  const demoHydrated = useDemoStore((s) => s._hasHydrated);

  // Debug logging on mount and cleanup
  useEffect(() => {
    // Comprehensive diagnostic logging on mount
    const demoStore = useDemoStore.getState();
    const profile = isDemoMode && userId ? demoStore.demoProfiles[userId] : null;

    console.log('[BASIC] ════════════════════════════════════════');
    console.log(`[BASIC] MOUNT DIAGNOSTIC`);
    console.log(`[BASIC]   userId=${userId || 'none'}`);
    console.log(`[BASIC]   confirm=${params.confirm}, isConfirmMode=${isConfirmMode}`);
    console.log(`[BASIC]   demoHydrated=${demoHydrated}`);
    console.log(`[BASIC]   demoProfile exists=${!!profile}`);
    if (profile) {
      console.log(`[BASIC]   demoProfile.name=${profile.name || '(empty)'}`);
      console.log(`[BASIC]   demoProfile.handle=${profile.handle || '(empty)'}`);
      console.log(`[BASIC]   demoProfile.dateOfBirth=${profile.dateOfBirth || '(empty)'}`);
      console.log(`[BASIC]   demoProfile.gender=${profile.gender || '(empty)'}`);
    }
    console.log(`[BASIC]   onboardingStore.name=${name || '(empty)'}`);
    console.log(`[BASIC]   onboardingStore.nickname=${nickname || '(empty)'}`);
    console.log(`[BASIC]   onboardingStore.dateOfBirth=${dateOfBirth || '(empty)'}`);
    console.log(`[BASIC]   onboardingStore.gender=${gender || '(empty)'}`);
    console.log('[BASIC] ════════════════════════════════════════');

    // Cleanup timeout on unmount
    return () => {
      if (availabilityTimeoutRef.current) {
        clearTimeout(availabilityTimeoutRef.current);
      }
    };
  }, []);

  // Load existing data into display state OR detect recovery mode
  useEffect(() => {
    // Handle editFromReview mode: pre-fill all fields from demoProfile
    if (isEditFromReview && isDemoMode && demoHydrated && demoProfile) {
      console.log('[BASIC] editFromReview mode - pre-filling from demoProfile');
      setDisplayName(demoProfile.name || "");
      setDisplayDOB(demoProfile.dateOfBirth || "");
      setDisplayGender((demoProfile.gender as Gender) || "");
      setDisplayHandle(demoProfile.handle || "");
      if (demoProfile.dateOfBirth) {
        setSelectedDate(parseDOBString(demoProfile.dateOfBirth));
      }
      // Pre-fill LGBTQ Self
      if (demoProfile.lgbtqSelf && demoProfile.lgbtqSelf.length > 0 && lgbtqSelf.length === 0) {
        setLgbtqSelf(demoProfile.lgbtqSelf as LgbtqOption[]);
        console.log(`[BASIC] editFromReview: pre-populated lgbtqSelf from demoProfile`);
      }
      return; // Don't run confirm mode logic
    }

    if (isConfirmMode && isDemoMode && demoHydrated) {
      if (demoProfile) {
        // Check if ALL basic fields are present (strict check)
        const hasName = !!demoProfile.name && demoProfile.name.trim().length > 0;
        const hasHandle = !!demoProfile.handle && demoProfile.handle.trim().length > 0;
        const hasDOB = !!demoProfile.dateOfBirth && demoProfile.dateOfBirth.length > 0;
        const hasGender = !!demoProfile.gender && demoProfile.gender.length > 0;
        const hasAllFields = hasName && hasHandle && hasDOB && hasGender;

        console.log(`[BASIC] confirm mode check: name=${hasName}, handle=${hasHandle}, dob=${hasDOB}, gender=${hasGender}, allPresent=${hasAllFields}`);

        if (hasAllFields) {
          // ALL fields present → normal confirm mode (read-only)
          setIsRecoveryMode(false);
          setDisplayName(demoProfile.name!);
          setDisplayDOB(demoProfile.dateOfBirth!);
          setDisplayGender(demoProfile.gender as Gender);
          setDisplayHandle(demoProfile.handle!);
          setSelectedDate(parseDOBString(demoProfile.dateOfBirth!));
          // LGBTQ Self is always editable - prefill from demoProfile if available
          if (demoProfile.lgbtqSelf && demoProfile.lgbtqSelf.length > 0 && lgbtqSelf.length === 0) {
            setLgbtqSelf(demoProfile.lgbtqSelf as LgbtqOption[]);
            console.log(`[BASIC] pre-populated lgbtqSelf from demoProfile`);
          }
          console.log('[BASIC] → read-only mode (all fields present)');
        } else {
          // Some fields missing → recovery mode (editable)
          // CRITICAL: Pre-populate onboardingStore with existing partial data
          // This prevents losing data that DOES exist
          setIsRecoveryMode(true);
          console.log('[BASIC] → recovery mode (some fields missing)');

          // Pre-populate onboardingStore from demoProfile's existing data
          if (hasName && !name) {
            setName(demoProfile.name!);
            console.log(`[BASIC] pre-populated name="${demoProfile.name}" from demoProfile`);
          }
          if (hasHandle && !nickname) {
            setNickname(demoProfile.handle!);
            console.log(`[BASIC] pre-populated nickname="${demoProfile.handle}" from demoProfile`);
          }
          if (hasDOB && !dateOfBirth) {
            setDateOfBirth(demoProfile.dateOfBirth!);
            setSelectedDate(parseDOBString(demoProfile.dateOfBirth!));
            console.log(`[BASIC] pre-populated dateOfBirth="${demoProfile.dateOfBirth}" from demoProfile`);
          }
          if (hasGender && !gender) {
            setGender(demoProfile.gender as Gender);
            console.log(`[BASIC] pre-populated gender="${demoProfile.gender}" from demoProfile`);
          }
          // LGBTQ Self is always editable - prefill in recovery mode too
          if (demoProfile.lgbtqSelf && demoProfile.lgbtqSelf.length > 0 && lgbtqSelf.length === 0) {
            setLgbtqSelf(demoProfile.lgbtqSelf as LgbtqOption[]);
            console.log(`[BASIC] pre-populated lgbtqSelf from demoProfile`);
          }
        }
      } else {
        // No profile at all - recovery mode, nothing to pre-populate
        setIsRecoveryMode(true);
        console.log('[BASIC] → recovery mode (no demoProfile exists)');
      }
    } else if (isConfirmMode && !isDemoMode && existingUserData) {
      // Live mode: use query result
      setDisplayName(existingUserData.name || "");
      setDisplayDOB(existingUserData.dateOfBirth || "");
      setDisplayGender((existingUserData.gender as Gender) || "");
      setDisplayHandle(existingUserData.handle || "");
      if (existingUserData.dateOfBirth) {
        setSelectedDate(parseDOBString(existingUserData.dateOfBirth));
      }
    }
  }, [isConfirmMode, isEditFromReview, demoHydrated, demoProfile, existingUserData]);

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
        clearFieldError("dateOfBirth");
        return;
      }
      setAgeBlocked(false);
      setDateOfBirth(dobString);
      clearFieldError("dateOfBirth");
    }
  };

  // Clear a single field error
  const clearFieldError = (field: string) => {
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
      setShowTopError(false);
    }
  };

  // Validation rules for all required fields
  const validationRules: Record<string, ValidationRule> = {
    name: (value: string) => {
      if (!value || value.trim().length < VALIDATION.NAME_MIN_LENGTH) {
        return `Name must be at least ${VALIDATION.NAME_MIN_LENGTH} characters`;
      }
      if (value.length > VALIDATION.NAME_MAX_LENGTH) {
        return `Name must be no more than ${VALIDATION.NAME_MAX_LENGTH} characters`;
      }
      // Allow letters, spaces, dots, underscores, hyphens, apostrophes
      if (!/^[a-zA-Z\s.\-_']+$/.test(value)) {
        return "Name can only contain letters, spaces, dots, hyphens, underscores, and apostrophes";
      }
      return undefined;
    },
    nickname: (value: string) => {
      if (!value || value.length < 3) {
        return "Nickname must be at least 3 characters";
      }
      // Only allow letters, numbers, underscores (no spaces, no dots)
      // Input is normalized to lowercase in onChangeText, so check lowercase pattern
      if (!/^[a-z0-9_]+$/.test(value)) {
        return "Nickname can only contain letters, numbers, and underscores (no spaces or dots)";
      }
      return undefined;
    },
    dateOfBirth: (value: string) => {
      if (!value) {
        return "Please select your date of birth";
      }
      const age = calculateAge(value);
      if (age < VALIDATION.MIN_AGE) {
        return `You must be at least ${VALIDATION.MIN_AGE} years old`;
      }
      return undefined;
    },
    gender: (value: string) => {
      if (!value) {
        return "Please select your gender";
      }
      return undefined;
    },
  };

  // Handle Continue in READ-ONLY mode (existing user OR edit from Review)
  const handleReadOnlyContinue = () => {
    // LGBTQ Self is always editable - save any changes before continuing
    if (isDemoMode && userId) {
      // Only save lgbtqSelf (don't touch other fields)
      useDemoStore.getState().saveDemoProfile(userId, { lgbtqSelf });
      console.log(`[BASIC] saved lgbtqSelf: ${JSON.stringify(lgbtqSelf)}`);
    }

    // If editing from Review, go back to Review (not through onboarding flow)
    if (isEditFromReview) {
      if (__DEV__) console.log("[ONB] basic_info editFromReview → back to review");
      router.replace("/(onboarding)/review" as any);
      return;
    }

    if (__DEV__) console.log("[ONB] basic_info_confirm readOnly=true → continue_to_consent");
    setStep("consent");
    router.replace("/(onboarding)/consent" as any);
  };

  // Handle Continue in RECOVERY mode (existing user with missing fields)
  const handleRecoveryContinue = () => {
    // Run validation using the helper
    const result = validateRequired(
      { name, nickname, dateOfBirth, gender },
      validationRules
    );

    if (!result.ok) {
      setErrors(result.errors as Record<string, string>);
      setShowTopError(true);
      // Scroll to first invalid field
      const fieldRefs = {
        name: nameFieldRef,
        nickname: nicknameFieldRef,
        dateOfBirth: dobFieldRef,
        gender: genderFieldRef,
      };
      scrollToFirstInvalid(scrollRef, fieldRefs, result.firstInvalidKey as string);
      return;
    }

    // Clear errors
    setErrors({});
    setShowTopError(false);

    // Save recovered data to demoProfiles (user already exists)
    // GUARD: Only save non-empty values to avoid overwriting existing data with empty strings
    if (isDemoMode && userId) {
      const demoStore = useDemoStore.getState();
      const dataToSave: Record<string, string | string[]> = {};

      // Only include non-empty values
      if (name && name.trim().length > 0) dataToSave.name = name.trim();
      if (nickname && nickname.length > 0) dataToSave.handle = nickname;
      if (dateOfBirth && dateOfBirth.length > 0) dataToSave.dateOfBirth = dateOfBirth;
      if (gender) dataToSave.gender = gender;
      // LGBTQ Self is optional - only save if user selected any
      if (lgbtqSelf.length > 0) dataToSave.lgbtqSelf = lgbtqSelf;

      // Log exactly what we're saving
      console.log('[BASIC] ════════════════════════════════════════');
      console.log('[BASIC] RECOVERY SAVE');
      console.log(`[BASIC]   userId=${userId}`);
      console.log(`[BASIC]   saving: ${JSON.stringify(dataToSave)}`);
      console.log('[BASIC] ════════════════════════════════════════');

      demoStore.saveDemoProfile(userId, dataToSave);
    }

    // Proceed to consent
    console.log("[ONB] basic_info recovery → consent");
    setStep("consent");
    router.replace("/(onboarding)/consent" as any);
  };

  // Handle Continue in EDIT mode (new signup) - first validates, then shows modal
  const handleNextWithConfirmation = () => {
    // Run validation using the helper
    const result = validateRequired(
      { name, nickname, dateOfBirth, gender },
      validationRules
    );

    if (!result.ok) {
      setErrors(result.errors as Record<string, string>);
      setShowTopError(true);
      // Scroll to first invalid field
      const fieldRefs = {
        name: nameFieldRef,
        nickname: nicknameFieldRef,
        dateOfBirth: dobFieldRef,
        gender: genderFieldRef,
      };
      scrollToFirstInvalid(scrollRef, fieldRefs, result.firstInvalidKey as string);
      return;
    }

    // Additional async checks (nickname availability)
    if (isCheckingAvailability) {
      setErrors({ nickname: "Please wait while we check nickname availability" });
      setShowTopError(true);
      scrollToFirstInvalid(scrollRef, { nickname: nicknameFieldRef }, "nickname");
      return;
    }
    if (isNicknameAvailable === false) {
      setErrors({ nickname: "This nickname is already taken. Please choose another." });
      setShowTopError(true);
      scrollToFirstInvalid(scrollRef, { nickname: nicknameFieldRef }, "nickname");
      return;
    }

    // Clear errors and show confirmation modal
    setErrors({});
    setShowTopError(false);
    setShowConfirmModal(true);
  };

  // Handle confirmed submission (after user confirms in modal)
  const handleNext = async () => {
    // Close modal
    setShowConfirmModal(false);

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
        // BUG A FIX: Save basic info to demoProfiles immediately so it's available
        // if user logs out and back in before completing full onboarding
        const dataToSave: Record<string, any> = {
          name: name.trim(),
          handle: nickname,
          dateOfBirth,
          gender: gender ?? undefined,
          photos: [], // Empty initially, will be filled later in onboarding
        };
        // LGBTQ Self is optional - only save if user selected any
        if (lgbtqSelf.length > 0) dataToSave.lgbtqSelf = lgbtqSelf;

        // Log exactly what we're saving
        console.log('[BASIC] ════════════════════════════════════════');
        console.log('[BASIC] NEW SIGNUP SAVE');
        console.log(`[BASIC]   userId=${newUserId}`);
        console.log(`[BASIC]   saving: ${JSON.stringify(dataToSave)}`);
        console.log('[BASIC] ════════════════════════════════════════');

        demoStore.saveDemoProfile(newUserId, dataToSave);
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
        gender: gender!, // Validated above - gender is not null here
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
  if (isReadOnly) {
    // Demo mode: wait for demoStore to hydrate
    if (isDemoMode && !demoHydrated) {
      return (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      );
    }
    // Live mode: wait for Convex query
    if (!isDemoMode && existingUserData === undefined) {
      return (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      );
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <OnboardingProgressHeader />
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Top error banner (only in edit mode) */}
      {!isReadOnly && showTopError && (
        <View style={styles.topErrorBanner}>
          <Text style={styles.topErrorText}>Please complete highlighted fields.</Text>
        </View>
      )}

      <Text style={styles.title}>Tell us about yourself</Text>
      <Text style={styles.subtitle}>
        {isReadOnly
          ? "Please verify your information before continuing."
          : isRecoveryMode
          ? "We couldn't load your details. Please re-enter to continue."
          : "This information will be shown on your profile."}
      </Text>

      {/* Name field */}
      <View ref={nameFieldRef} style={styles.field}>
        <Input
          label="Name"
          value={currentName}
          onChangeText={isReadOnly ? undefined : (text) => {
            setName(text);
            clearFieldError("name");
          }}
          placeholder="Your first name"
          autoCapitalize="words"
          maxLength={VALIDATION.NAME_MAX_LENGTH}
          editable={!isReadOnly}
          style={[isReadOnly ? styles.disabledInput : undefined, errors.name ? styles.inputError : undefined]}
        />
        {!isReadOnly && (
          <Text style={styles.hint}>
            {name.length}/{VALIDATION.NAME_MAX_LENGTH} characters
          </Text>
        )}
        {errors.name ? <Text style={styles.fieldError}>{errors.name}</Text> : null}
      </View>

      {/* Nickname (User ID) field */}
      <View ref={nicknameFieldRef} style={styles.field}>
        <Input
          label="Nickname (User ID)"
          value={isReadOnly ? (displayHandle || "—") : nickname}
          onChangeText={isReadOnly ? undefined : (text) => {
            // Only allow alphanumeric and underscores, lowercase
            const sanitized = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
            setNickname(sanitized);
            clearFieldError("nickname");
            // Trigger availability check for new users
            checkNicknameAvailability(sanitized);
          }}
          placeholder="Choose a unique username"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          editable={!isReadOnly}
          style={[isReadOnly ? styles.disabledInput : undefined, errors.nickname ? styles.inputError : undefined]}
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
        {errors.nickname ? <Text style={styles.fieldError}>{errors.nickname}</Text> : null}
      </View>

      {/* Date of Birth field */}
      <View ref={dobFieldRef} style={styles.field}>
        <Text style={styles.label}>Date of Birth</Text>
        <Button
          title={currentDOB ? formatDate(currentDOB) : "Select your date of birth"}
          variant="outline"
          onPress={() => !isReadOnly && setShowDatePicker(true)}
          style={{ ...styles.dateButton, ...(isReadOnly ? styles.disabledButton : {}), ...(errors.dateOfBirth ? styles.buttonError : {}) }}
          disabled={isReadOnly}
        />
        {currentDOB && (
          <Text style={styles.ageText}>
            Age: {calculateAge(currentDOB)} years old
          </Text>
        )}
        {errors.dateOfBirth ? <Text style={styles.fieldError}>{errors.dateOfBirth}</Text> : null}
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
      <View ref={genderFieldRef} style={styles.field}>
        <Text style={styles.label}>I am a</Text>
        <View style={[styles.genderContainer, errors.gender ? styles.genderContainerError : undefined]}>
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
                clearFieldError("gender");
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
        {errors.gender ? <Text style={styles.fieldError}>{errors.gender}</Text> : null}
      </View>

      {/* LGBTQ Self (Optional) - "What am I?" - ALWAYS editable, even in read-only mode */}
      <View style={styles.field}>
        <Text style={styles.label}>LGBTQ (Optional) — What am I?</Text>
        <Text style={styles.hint}>Select up to 2 options</Text>
        <View style={styles.lgbtqContainer}>
          {LGBTQ_OPTIONS.map((option) => {
            const isSelected = lgbtqSelf.includes(option.value);
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.lgbtqOption,
                  isSelected && styles.lgbtqOptionSelected,
                ]}
                onPress={() => {
                  const success = toggleLgbtqSelf(option.value);
                  if (!success) {
                    setLgbtqError("You can select up to 2 options");
                    // Clear error after 2 seconds
                    setTimeout(() => setLgbtqError(""), 2000);
                  } else {
                    setLgbtqError("");
                    // Save-as-you-go: update demoProfile immediately
                    if (isDemoMode && userId) {
                      const newLgbtqSelf = lgbtqSelf.includes(option.value)
                        ? lgbtqSelf.filter((o) => o !== option.value)
                        : [...lgbtqSelf, option.value];
                      useDemoStore.getState().saveDemoProfile(userId, { lgbtqSelf: newLgbtqSelf });
                    }
                  }
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.lgbtqText,
                    isSelected && styles.lgbtqTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {lgbtqError ? <Text style={styles.fieldError}>{lgbtqError}</Text> : null}
      </View>

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
          onPress={isReadOnly ? handleReadOnlyContinue : isRecoveryMode ? handleRecoveryContinue : handleNextWithConfirmation}
          loading={!isReadOnly && !isRecoveryMode && isSubmitting}
          disabled={!isReadOnly && !isRecoveryMode && ageBlocked}
          fullWidth
        />
      </View>

      {/* Confirmation Modal (only for new signups, not confirm/recovery mode) */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Basic info is fixed</Text>
            <Text style={styles.modalMessage}>
              Your Name, User ID, Date of Birth and Gender can't be changed later. Please make sure they are correct.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonEdit}
                onPress={() => setShowConfirmModal(false)}
              >
                <Text style={styles.modalButtonEditText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonConfirm}
                onPress={handleNext}
              >
                <Text style={styles.modalButtonConfirmText}>Confirm & Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  topErrorBanner: {
    backgroundColor: COLORS.error + "15",
    borderWidth: 1,
    borderColor: COLORS.error + "40",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  topErrorText: {
    fontSize: 14,
    color: COLORS.error,
    fontWeight: "500",
    textAlign: "center",
  },
  inputError: {
    borderColor: COLORS.error,
    borderWidth: 2,
  },
  buttonError: {
    borderColor: COLORS.error,
    borderWidth: 2,
  },
  fieldError: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 6,
  },
  genderContainerError: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.error,
    padding: 2,
    margin: -2,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 15,
    color: COLORS.textLight,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButtonEdit: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  modalButtonEditText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalButtonConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  modalButtonConfirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  lgbtqContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  lgbtqOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  lgbtqOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  lgbtqText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  lgbtqTextSelected: {
    color: COLORS.primary,
  },
});
