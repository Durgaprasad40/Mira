/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/basic-info.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
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
  BackHandler,
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
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Ionicons } from "@expo/vector-icons";
import { validateRequired, scrollToFirstInvalid, ValidationRule } from "@/lib/onboardingValidation";
import { useScreenTrace } from "@/lib/devTrace";

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

// Parse backend full name into firstName/lastName
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

export default function BasicInfoScreen() {
  useScreenTrace("ONB_BASIC_INFO");
  const {
    firstName,
    lastName,
    dateOfBirth,
    gender,
    lgbtqSelf,
    email,
    password,
    nickname,
    setFirstName,
    setLastName,
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
  const nicknameFieldRef = useRef<View>(null);
  const dobFieldRef = useRef<View>(null);
  const genderFieldRef = useRef<View>(null);

  // Read-only mode state for displaying existing user data
  const [displayFirstName, setDisplayFirstName] = useState("");
  const [displayLastName, setDisplayLastName] = useState("");
  const [displayDOB, setDisplayDOB] = useState("");
  const [displayGender, setDisplayGender] = useState<Gender | "">("");
  const [displayHandle, setDisplayHandle] = useState("");
  const [lgbtqError, setLgbtqError] = useState("");

  // Refs for scroll-to-invalid behavior (additional refs for first/last name)
  const firstNameFieldRef = useRef<View>(null);
  const lastNameFieldRef = useRef<View>(null);

  // Guard ref to prevent re-prefilling firstName/lastName after user starts editing in editFromReview mode
  const hasPrefilledEditFromReviewRef = useRef(false);

  // Nickname availability state (for new users)
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isNicknameAvailable, setIsNicknameAvailable] = useState<boolean | null>(null);
  const availabilityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true); // Track mounted state to ignore late async results

  // FIX: Handle Android back button when basic-info is root screen
  // Prevents "GO_BACK was not handled" error when navigated here directly on boot
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (router.canGoBack()) {
        router.back();
        return true;
      }
      // No screen to go back to - prevent default (exit app) behavior
      // User is on onboarding entry point, back should do nothing
      return true;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [router]);

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
      console.log(`[BASIC]   demoProfile.firstName=${profile.firstName || '(empty)'}`);
      console.log(`[BASIC]   demoProfile.lastName=${profile.lastName || '(empty)'}`);
      console.log(`[BASIC]   demoProfile.handle=${profile.handle || '(empty)'}`);
      console.log(`[BASIC]   demoProfile.dateOfBirth=${profile.dateOfBirth || '(empty)'}`);
      console.log(`[BASIC]   demoProfile.gender=${profile.gender || '(empty)'}`);
    }
    console.log(`[BASIC]   onboardingStore.firstName=${firstName || '(empty)'}`);
    console.log(`[BASIC]   onboardingStore.lastName=${lastName || '(empty)'}`);
    console.log(`[BASIC]   onboardingStore.nickname=${nickname || '(empty)'}`);
    console.log(`[BASIC]   onboardingStore.dateOfBirth=${dateOfBirth || '(empty)'}`);
    console.log(`[BASIC]   onboardingStore.gender=${gender || '(empty)'}`);
    console.log('[BASIC] ════════════════════════════════════════');

    // Cleanup on unmount: clear timeout and mark as unmounted
    return () => {
      isMountedRef.current = false;
      if (availabilityTimeoutRef.current) {
        clearTimeout(availabilityTimeoutRef.current);
      }
    };
  }, []);

  // STABILITY FIX (2026-03-04): Cancel pending checks when mode changes to prevent stale updates
  useEffect(() => {
    // Clear any pending nickname availability check when demo mode changes
    if (availabilityTimeoutRef.current) {
      clearTimeout(availabilityTimeoutRef.current);
      availabilityTimeoutRef.current = null;
    }
    // Reset availability state to prevent stale results from different mode
    setIsCheckingAvailability(false);
    setIsNicknameAvailable(null);
  }, [isDemoMode]);

  // Load existing data into display state OR detect recovery mode
  useEffect(() => {
    // Handle editFromReview mode: pre-fill all fields from demoProfile
    // CRITICAL: Only prefill ONCE on entry, then let user freely edit firstName/lastName
    if (isEditFromReview && isDemoMode && demoHydrated && demoProfile) {
      // Guard: Only prefill once per editFromReview session
      if (hasPrefilledEditFromReviewRef.current) {
        return; // Already prefilled, don't overwrite user edits
      }
      hasPrefilledEditFromReviewRef.current = true;
      console.log('[BASIC] editFromReview mode - pre-filling ONCE from demoProfile');
      // Parse name into firstName/lastName or use stored firstName/lastName
      if (demoProfile.firstName || demoProfile.lastName) {
        setDisplayFirstName(demoProfile.firstName || "");
        setDisplayLastName(demoProfile.lastName || "");
        // Populate the editable store fields for firstName/lastName
        setFirstName(demoProfile.firstName || "");
        setLastName(demoProfile.lastName || "");
      } else if (demoProfile.name) {
        const parsed = parseFullName(demoProfile.name);
        setDisplayFirstName(parsed.firstName);
        setDisplayLastName(parsed.lastName);
        // Populate the editable store fields for firstName/lastName
        setFirstName(parsed.firstName);
        setLastName(parsed.lastName);
      }
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

    // BUG FIX: Handle editFromReview mode in LIVE mode (non-demo)
    // CRITICAL: Only prefill ONCE on entry, then let user freely edit firstName/lastName
    if (isEditFromReview && !isDemoMode && existingUserData) {
      // Guard: Only prefill once per editFromReview session
      if (hasPrefilledEditFromReviewRef.current) {
        return; // Already prefilled, don't overwrite user edits
      }
      hasPrefilledEditFromReviewRef.current = true;
      console.log('[BASIC] editFromReview LIVE mode - pre-filling ONCE from existingUserData');
      // Parse name into firstName/lastName
      if (existingUserData.name) {
        const parsed = parseFullName(existingUserData.name);
        setDisplayFirstName(parsed.firstName);
        setDisplayLastName(parsed.lastName);
        // Populate the editable store fields for firstName/lastName
        setFirstName(parsed.firstName);
        setLastName(parsed.lastName);
      }
      setDisplayDOB(existingUserData.dateOfBirth || "");
      setDisplayGender((existingUserData.gender as Gender) || "");
      setDisplayHandle(existingUserData.handle || "");
      if (existingUserData.dateOfBirth) {
        setSelectedDate(parseDOBString(existingUserData.dateOfBirth));
      }
      return; // Don't run confirm mode logic
    }

    if (isConfirmMode && isDemoMode && demoHydrated) {
      if (demoProfile) {
        // Check if ALL basic fields are present (strict check)
        // Support both old `name` field and new firstName/lastName fields
        const hasFirstName = !!demoProfile.firstName && demoProfile.firstName.trim().length > 0;
        const hasLastName = !!demoProfile.lastName && demoProfile.lastName.trim().length > 0;
        const hasLegacyName = !!demoProfile.name && demoProfile.name.trim().length > 0;
        const hasName = (hasFirstName) || hasLegacyName; // firstName required, lastName optional
        const hasHandle = !!demoProfile.handle && demoProfile.handle.trim().length > 0;
        const hasDOB = !!demoProfile.dateOfBirth && demoProfile.dateOfBirth.length > 0;
        const hasGender = !!demoProfile.gender && demoProfile.gender.length > 0;
        const hasAllFields = hasName && hasHandle && hasDOB && hasGender;

        console.log(`[BASIC] confirm mode check: name=${hasName}, handle=${hasHandle}, dob=${hasDOB}, gender=${hasGender}, allPresent=${hasAllFields}`);

        if (hasAllFields) {
          // ALL fields present → normal confirm mode (read-only)
          setIsRecoveryMode(false);
          // Parse name into firstName/lastName
          if (hasFirstName) {
            setDisplayFirstName(demoProfile.firstName!);
            setDisplayLastName(demoProfile.lastName || "");
          } else if (hasLegacyName) {
            const parsed = parseFullName(demoProfile.name!);
            setDisplayFirstName(parsed.firstName);
            setDisplayLastName(parsed.lastName);
          }
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
          if (hasFirstName && !firstName) {
            setFirstName(demoProfile.firstName!);
            console.log(`[BASIC] pre-populated firstName="${demoProfile.firstName}" from demoProfile`);
          }
          if (hasLastName && !lastName) {
            setLastName(demoProfile.lastName!);
            console.log(`[BASIC] pre-populated lastName="${demoProfile.lastName}" from demoProfile`);
          }
          if (!hasFirstName && hasLegacyName && !firstName) {
            const parsed = parseFullName(demoProfile.name!);
            setFirstName(parsed.firstName);
            setLastName(parsed.lastName);
            console.log(`[BASIC] pre-populated firstName/lastName from legacy name="${demoProfile.name}"`);
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
      // Live mode: use query result - parse name into firstName/lastName
      if (existingUserData.name) {
        const parsed = parseFullName(existingUserData.name);
        setDisplayFirstName(parsed.firstName);
        setDisplayLastName(parsed.lastName);
      }
      setDisplayDOB(existingUserData.dateOfBirth || "");
      setDisplayGender((existingUserData.gender as Gender) || "");
      setDisplayHandle(existingUserData.handle || "");
      if (existingUserData.dateOfBirth) {
        setSelectedDate(parseDOBString(existingUserData.dateOfBirth));
      }
    }
  }, [isConfirmMode, isEditFromReview, demoHydrated, demoProfile, existingUserData]);

  const { submitEmailRegistration } = useAuthSubmit();

  // BUG-002 FIX: Mutation for persisting basic info to onboarding draft
  const upsertDraft = useMutation(api.users.upsertOnboardingDraft);

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
          // Only update state if still mounted
          if (isMountedRef.current) {
            setIsNicknameAvailable(!taken);
          }
        } else {
          // Live mode: query Convex database for handle availability
          console.log(`[BASIC] nickname=${handle} querying Convex checkHandleExists...`);
          const result = await convex.query(api.auth.checkHandleExists, { handle });
          const available = !result.exists;
          console.log(`[BASIC] nickname=${handle} available=${available} (live mode - Convex DB, exists=${result.exists})`);
          // Only update state if still mounted
          if (isMountedRef.current) {
            setIsNicknameAvailable(available);
          }
        }
      } catch (error) {
        console.error('[BASIC] availability check error:', error);
        // Only update state if still mounted
        if (isMountedRef.current) {
          setIsNicknameAvailable(null);
        }
      } finally {
        // Only update state if still mounted
        if (isMountedRef.current) {
          setIsCheckingAvailability(false);
        }
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
    firstName: (value: string) => {
      if (!value || value.trim().length < VALIDATION.FIRST_NAME_MIN_LENGTH) {
        return `First name must be at least ${VALIDATION.FIRST_NAME_MIN_LENGTH} character`;
      }
      if (value.length > VALIDATION.FIRST_NAME_MAX_LENGTH) {
        return `First name must be no more than ${VALIDATION.FIRST_NAME_MAX_LENGTH} characters`;
      }
      // Allow letters, spaces, hyphens, apostrophes
      if (!/^[a-zA-Z\s\-']+$/.test(value)) {
        return "First name can only contain letters, spaces, hyphens, and apostrophes";
      }
      return undefined;
    },
    lastName: (value: string) => {
      if (!value || value.trim().length < VALIDATION.LAST_NAME_MIN_LENGTH) {
        return `Last name must be at least ${VALIDATION.LAST_NAME_MIN_LENGTH} character`;
      }
      if (value.length > VALIDATION.LAST_NAME_MAX_LENGTH) {
        return `Last name must be no more than ${VALIDATION.LAST_NAME_MAX_LENGTH} characters`;
      }
      // Allow letters, spaces, hyphens, apostrophes
      if (!/^[a-zA-Z\s\-']+$/.test(value)) {
        return "Last name can only contain letters, spaces, hyphens, and apostrophes";
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
    // In editFromReview mode, firstName/lastName are editable - validate before saving
    if (isEditFromReview) {
      // Validate firstName and lastName
      const result = validateRequired(
        { firstName, lastName },
        {
          firstName: validationRules.firstName,
          lastName: validationRules.lastName,
        }
      );

      if (!result.ok) {
        setErrors(result.errors as Record<string, string>);
        setShowTopError(true);
        const fieldRefs = {
          firstName: firstNameFieldRef,
          lastName: lastNameFieldRef,
        };
        scrollToFirstInvalid(scrollRef, fieldRefs, result.firstInvalidKey as string);
        return;
      }

      // Clear errors
      setErrors({});
      setShowTopError(false);

      // Save changes (demo mode)
      if (isDemoMode && userId) {
        // Construct full name for backend compat
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        useDemoStore.getState().saveDemoProfile(userId, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          name: fullName,
          lgbtqSelf,
        });
        console.log(`[BASIC] saved firstName/lastName and lgbtqSelf`);
      }

      if (__DEV__) console.log("[ONB] basic_info editFromReview → back to review");
      router.replace("/(onboarding)/review" as any);
      return;
    }

    // Regular read-only mode (confirm mode)
    if (isDemoMode && userId) {
      // Only save lgbtqSelf (don't touch other fields)
      useDemoStore.getState().saveDemoProfile(userId, { lgbtqSelf });
      console.log(`[BASIC] saved lgbtqSelf: ${JSON.stringify(lgbtqSelf)}`);
    }

    if (__DEV__) console.log("[ONB] basic_info_confirm readOnly=true → continue_to_consent");
    setStep("consent");
    router.replace("/(onboarding)/consent" as any);
  };

  // Handle Continue in RECOVERY mode (existing user with missing fields)
  const handleRecoveryContinue = () => {
    // Run validation using the helper
    const result = validateRequired(
      { firstName, lastName, nickname, dateOfBirth, gender },
      validationRules
    );

    if (!result.ok) {
      setErrors(result.errors as Record<string, string>);
      setShowTopError(true);
      // Scroll to first invalid field
      const fieldRefs = {
        firstName: firstNameFieldRef,
        lastName: lastNameFieldRef,
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
      // Store firstName/lastName separately and construct name for backend compat
      if (firstName && firstName.trim().length > 0) dataToSave.firstName = firstName.trim();
      if (lastName && lastName.trim().length > 0) dataToSave.lastName = lastName.trim();
      // Construct full name for backend compatibility
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      if (fullName.length > 0) dataToSave.name = fullName;
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
      { firstName, lastName, nickname, dateOfBirth, gender },
      validationRules
    );

    if (!result.ok) {
      setErrors(result.errors as Record<string, string>);
      setShowTopError(true);
      // Scroll to first invalid field
      const fieldRefs = {
        firstName: firstNameFieldRef,
        lastName: lastNameFieldRef,
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

    // H7 FIX: Capture auth version at start of handleNext (before any async/branching)
    const capturedAuthVersion = useAuthStore.getState().authVersion;

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
              setAuth(newUserId, "demo_token", result.onboardingComplete, capturedAuthVersion);
              if (result.onboardingComplete) {
                // ONB-001 FIX: Reset isSubmitting before early return to prevent stuck button
                setIsSubmitting(false);
                router.replace("/(main)/(tabs)/home");
                return;
              }
              setIsSubmitting(false);
              setStep("consent");
              router.push("/(onboarding)/consent" as any);
              return;
            } catch (loginError: any) {
              setIsSubmitting(false);
              Alert.alert("Error", loginError.message || "Failed to login. Please check your password.");
              return;
            }
          } else {
            setIsSubmitting(false);
            Alert.alert("Error", signUpError.message || "Failed to create account");
            return;
          }
        }
        // BUG A FIX: Save basic info to demoProfiles immediately so it's available
        // if user logs out and back in before completing full onboarding
        // Construct full name for backend compatibility
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        const dataToSave: Record<string, any> = {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          name: fullName, // Backend compat
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
        setAuth(newUserId, "demo_token", false, capturedAuthVersion);
        setStep("consent");
        router.push("/(onboarding)/consent" as any);
        return;
      }

      // Live mode: register via Convex using central auth hook
      // Construct full name from firstName + lastName for backend
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

      // H7 FIX: capturedAuthVersion already captured at start of handleNext

      const result = await submitEmailRegistration({
        email,
        password,
        name: fullName,
        handle: nickname,
        dateOfBirth,
        gender: gender!, // Validated above - gender is not null here
        lgbtqSelf: lgbtqSelf.length > 0 ? lgbtqSelf : undefined, // LGBTQ identity (optional)
      });

      // H7 FIX: Check if logout happened during mutation (version changed)
      if (useAuthStore.getState().authVersion !== capturedAuthVersion) {
        if (__DEV__) console.log('[AUTH] Logout detected during registration - ignoring result');
        return;
      }

      // H8 FIX: Check if component unmounted during async registration
      if (!isMountedRef.current) {
        if (__DEV__) console.log('[AUTH] Component unmounted during registration - ignoring result');
        return;
      }

      // If result is null, USER_EXISTS was handled (Alert shown, routing done)
      // Stop execution immediately - do NOT continue onboarding
      if (!result) {
        return;
      }

      if (result.success && result.userId && result.token) {
        setAuth(result.userId, result.token, false, capturedAuthVersion);

        // STABILITY FIX (2026-03-04): Wrap token persistence in try-catch to prevent navigation on failure
        try {
          const { saveAuthBootCache } = require('@/stores/authBootCache');
          await saveAuthBootCache(result.token, result.userId);
        } catch (persistError: any) {
          console.error('[BASIC_INFO] Failed to persist auth token:', persistError);
          Alert.alert(
            'Error',
            'Failed to save login session. Please try again.',
            [{ text: 'OK' }]
          );
          setIsSubmitting(false);
          return; // DO NOT navigate if token persistence fails
        }

        // BUG-002 FIX: Persist basic info to onboarding draft (non-blocking)
        upsertDraft({
          userId: result.userId,
          patch: {
            basicInfo: {
              name: [firstName, lastName].filter(Boolean).join(" ").trim(),
              handle: nickname,
              dateOfBirth,
              gender,
            },
            progress: {
              lastStepKey: 'basic_info',
            },
          },
        }).catch(console.error);

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
  // CRITICAL: In editFromReview mode, firstName/lastName must use store values (editable)
  const currentFirstName = (isReadOnly && !isEditFromReview) ? displayFirstName : firstName;
  const currentLastName = (isReadOnly && !isEditFromReview) ? displayLastName : lastName;
  const currentDOB = isReadOnly ? displayDOB : dateOfBirth;
  const currentGender = isReadOnly ? displayGender : gender;

  // NEW EDIT RESTRICTION LOGIC:
  // In editFromReview mode: firstName/lastName are EDITABLE, others are LOCKED
  // In other modes (initial onboarding): ALL fields editable
  const isFieldLocked = (field: string): boolean => {
    if (!isEditFromReview) return false;
    return ['nickname', 'dateOfBirth', 'gender'].includes(field);
  };

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

      {/* First Name field - always editable in editFromReview mode */}
      <View ref={firstNameFieldRef} style={styles.field}>
        <Input
          label="First Name"
          value={currentFirstName}
          onChangeText={(isReadOnly && !isEditFromReview) ? undefined : (text) => {
            setFirstName(text);
            clearFieldError("firstName");
          }}
          placeholder="Your first name"
          autoCapitalize="words"
          maxLength={VALIDATION.FIRST_NAME_MAX_LENGTH}
          editable={!isReadOnly || isEditFromReview}
          style={[(isReadOnly && !isEditFromReview) ? styles.disabledInput : undefined, errors.firstName ? styles.inputError : undefined]}
        />
        {(!isReadOnly || isEditFromReview) && (
          <Text style={styles.hint}>
            {firstName.length}/{VALIDATION.FIRST_NAME_MAX_LENGTH} characters
          </Text>
        )}
        {errors.firstName ? <Text style={styles.fieldError}>{errors.firstName}</Text> : null}
      </View>

      {/* Last Name field - always editable in editFromReview mode */}
      <View ref={lastNameFieldRef} style={styles.field}>
        <Input
          label="Last Name"
          value={currentLastName}
          onChangeText={(isReadOnly && !isEditFromReview) ? undefined : (text) => {
            setLastName(text);
            clearFieldError("lastName");
          }}
          placeholder="Your last name"
          autoCapitalize="words"
          maxLength={VALIDATION.LAST_NAME_MAX_LENGTH}
          editable={!isReadOnly || isEditFromReview}
          style={[(isReadOnly && !isEditFromReview) ? styles.disabledInput : undefined, errors.lastName ? styles.inputError : undefined]}
        />
        {(!isReadOnly || isEditFromReview) && (
          <Text style={styles.hint}>
            {lastName.length}/{VALIDATION.LAST_NAME_MAX_LENGTH} characters
          </Text>
        )}
        {errors.lastName ? <Text style={styles.fieldError}>{errors.lastName}</Text> : null}
      </View>

      {/* Nickname (User ID) field - LOCKED in editFromReview mode */}
      <View ref={nicknameFieldRef} style={styles.field}>
        <Input
          label="Nickname (User ID)"
          value={isReadOnly ? (displayHandle || "—") : nickname}
          onChangeText={(isReadOnly || isFieldLocked('nickname')) ? undefined : (text) => {
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
          editable={!isReadOnly && !isFieldLocked('nickname')}
          style={[(isReadOnly || isFieldLocked('nickname')) ? styles.disabledInput : undefined, errors.nickname ? styles.inputError : undefined]}
        />
        {/* Availability indicator (only for new users) */}
        {!isReadOnly && !isFieldLocked('nickname') && nickname.length >= 3 && (
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
        {!isReadOnly && !isFieldLocked('nickname') && (
          <Text style={styles.hint}>
            Letters, numbers, and underscores only. {nickname.length}/20
          </Text>
        )}
        {isFieldLocked('nickname') && (
          <Text style={styles.lockedHint}>This field cannot be changed after initial setup</Text>
        )}
        {errors.nickname ? <Text style={styles.fieldError}>{errors.nickname}</Text> : null}
      </View>

      {/* Date of Birth field - LOCKED in editFromReview mode */}
      <View ref={dobFieldRef} style={styles.field}>
        <Text style={styles.label}>Date of Birth</Text>
        <Button
          title={currentDOB ? formatDate(currentDOB) : "Select your date of birth"}
          variant="outline"
          onPress={() => !isReadOnly && !isFieldLocked('dateOfBirth') && setShowDatePicker(true)}
          style={{ ...styles.dateButton, ...((isReadOnly || isFieldLocked('dateOfBirth')) ? styles.disabledButton : {}), ...(errors.dateOfBirth ? styles.buttonError : {}) }}
          disabled={isReadOnly || isFieldLocked('dateOfBirth')}
        />
        {currentDOB && (
          <Text style={styles.ageText}>
            Age: {calculateAge(currentDOB)} years old
          </Text>
        )}
        {isFieldLocked('dateOfBirth') && (
          <Text style={styles.lockedHint}>This field cannot be changed after initial setup</Text>
        )}
        {errors.dateOfBirth ? <Text style={styles.fieldError}>{errors.dateOfBirth}</Text> : null}
      </View>

      {showDatePicker && !isReadOnly && !isFieldLocked('dateOfBirth') && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleDateChange}
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
        />
      )}

      {/* Gender field - LOCKED in editFromReview mode */}
      <View ref={genderFieldRef} style={styles.field}>
        <Text style={styles.label}>I am a</Text>
        <View style={[styles.genderContainer, errors.gender ? styles.genderContainerError : undefined]}>
          {GENDER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.genderOption,
                currentGender === option.value && styles.genderOptionSelected,
                (isReadOnly || isFieldLocked('gender')) && styles.disabledGenderOption,
              ]}
              onPress={(isReadOnly || isFieldLocked('gender')) ? undefined : () => {
                setGender(option.value as Gender);
                clearFieldError("gender");
              }}
              disabled={isReadOnly || isFieldLocked('gender')}
              activeOpacity={(isReadOnly || isFieldLocked('gender')) ? 1 : 0.7}
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
        {isFieldLocked('gender') && (
          <Text style={styles.lockedHint}>This field cannot be changed after initial setup</Text>
        )}
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
                      // ONB-008 FIX: Compute new value, update React state, then save
                      const newLgbtqSelf = lgbtqSelf.includes(option.value)
                        ? lgbtqSelf.filter((o) => o !== option.value)
                        : [...lgbtqSelf, option.value];
                      setLgbtqSelf(newLgbtqSelf);
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
            <Text style={styles.modalTitle}>Review your information</Text>
            <Text style={styles.modalMessage}>
              Your Nickname, Date of Birth and Gender can't be changed later. First and Last Name can be edited anytime. Please make sure everything is correct.
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
  lockedHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
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
