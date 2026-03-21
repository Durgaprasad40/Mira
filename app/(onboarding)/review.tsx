/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/review.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 *
 * UNLOCKED: 2026-03-14 for Life Rhythm section addition (per explicit user request)
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import {
  COLORS,
  GENDER_OPTIONS,
  RELATIONSHIP_INTENTS,
  ACTIVITY_FILTERS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  KIDS_OPTIONS,
  EXERCISE_OPTIONS,
  PETS_OPTIONS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
  IDENTITY_ANCHOR_OPTIONS,
  SOCIAL_BATTERY_LEFT_LABEL,
  SOCIAL_BATTERY_RIGHT_LABEL,
  VALUE_TRIGGER_OPTIONS,
  // Life Rhythm
  SOCIAL_RHYTHM_OPTIONS,
  SLEEP_SCHEDULE_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  WORK_STYLE_OPTIONS,
  CORE_VALUES_OPTIONS,
} from "@/lib/constants";
import { Button } from "@/components/ui";
import { useOnboardingStore, LGBTQ_OPTIONS } from "@/stores/onboardingStore";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { Id } from "@/convex/_generated/dataModel";
import { isDemoMode } from "@/hooks/useConvex";
import { useDemoStore } from "@/stores/demoStore";
import { OnboardingProgressHeader } from "@/components/OnboardingProgressHeader";
import { saveAuthBootCache } from "@/stores/authBootCache";
import { useScreenTrace } from "@/lib/devTrace";

/**
 * Parse "YYYY-MM-DD" string to local Date object.
 * Uses noon to avoid DST edge cases.
 * DO NOT use new Date("YYYY-MM-DD") as it parses as UTC!
 */
function parseDOBString(dobString: string): Date {
  if (!dobString || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) {
    return new Date(2000, 0, 1, 12, 0, 0);
  }
  const [y, m, d] = dobString.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Parse backend full name into firstName/lastName for display
 */
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

// CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
const ALLOWED_RELATIONSHIP_INTENTS = new Set([
  'serious_vibes', 'keep_it_casual', 'exploring_vibes', 'see_where_it_goes',
  'open_to_vibes', 'just_friends', 'open_to_anything', 'single_parent', 'new_to_dating'
]);

// Sanitize relationshipIntent to only include schema-valid values
function sanitizeRelationshipIntent(arr: string[]): string[] {
  const sanitized = arr.filter(v => ALLOWED_RELATIONSHIP_INTENTS.has(v));
  if (__DEV__ && sanitized.length !== arr.length) {
    const removed = arr.filter(v => !ALLOWED_RELATIONSHIP_INTENTS.has(v));
    console.warn('[REVIEW] Removed invalid relationshipIntent values:', removed);
  }
  return sanitized;
}

export default function ReviewScreen() {
  useScreenTrace("ONB_REVIEW");

  // M5 FIX: Force re-render when returning from Edit screens
  const [refreshKey, setRefreshKey] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setRefreshKey((k) => k + 1);
    }, [])
  );

  const {
    firstName,
    lastName,
    nickname,
    dateOfBirth,
    gender,
    lgbtqSelf,
    lgbtqPreference,
    photos,
    bio,
    height,
    weight,
    smoking,
    drinking,
    kids,
    exercise,
    pets,
    insect,
    education,
    educationOther,
    religion,
    jobTitle,
    company,
    school,
    lifeRhythm,
    lookingFor,
    relationshipIntent,
    activities,
    profilePrompts,
    seedQuestions,
    minAge,
    maxAge,
    maxDistance,
    displayPhotoVariant,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();
  const { userId, setOnboardingCompleted, faceVerificationPassed, faceVerificationPending } = useAuthStore();
  const demoProfile = useDemoStore((s) => isDemoMode && userId ? s.demoProfiles[userId] : null);

  // H8 FIX: Track mounted state to prevent setAuth after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // BUG FIX: Always query backend status as authoritative source + fallback
  const onboardingStatus = useQuery(
    api.users.getOnboardingStatus,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  // BUG FIX (2026-03-06): Use getCurrentUser which includes ALL photos
  // (including verification_reference primary photo), not getUserPhotos
  // which excludes verification_reference photos
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );
  // Extract photos from currentUser (includes verification_reference)
  const backendPhotos = currentUser?.photos ?? [];

  // Fallback to backend data if store is empty
  // Parse backend name into firstName/lastName for display
  const getDisplayNames = (): { firstName: string; lastName: string } => {
    // Priority 1: Store values
    if (firstName || lastName) {
      return { firstName: firstName || '', lastName: lastName || '' };
    }
    // Priority 2: demoProfile values (demo mode)
    if (demoProfile?.firstName || demoProfile?.lastName) {
      return { firstName: demoProfile.firstName || '', lastName: demoProfile.lastName || '' };
    }
    // Priority 3: Parse from backend or demoProfile name
    const backendName = onboardingStatus?.basicInfo?.name || demoProfile?.name || '';
    if (backendName) {
      return parseFullName(backendName);
    }
    return { firstName: '', lastName: '' };
  };
  const displayNames = getDisplayNames();
  const displayFirstName = displayNames.firstName || "Not set";
  const displayLastName = displayNames.lastName || "—";
  const displayNickname = nickname || onboardingStatus?.basicInfo?.nickname || demoProfile?.handle || "—";
  const displayDateOfBirth = dateOfBirth || onboardingStatus?.basicInfo?.dateOfBirth || demoProfile?.dateOfBirth || "";
  const displayGender = gender || onboardingStatus?.basicInfo?.gender || demoProfile?.gender || "";

  // BUG FIX: Log data source for debugging
  React.useEffect(() => {
    if (__DEV__) {
      console.log('[REVIEW] basic info values:', {
        displayFirstName,
        displayLastName,
        displayNickname,
        displayDateOfBirth,
        displayGender,
      });
      console.log('[REVIEW] basic info sources:', {
        firstName: firstName ? 'store' : (demoProfile?.firstName ? 'demoProfile' : (onboardingStatus?.basicInfo?.name ? 'backend' : 'none')),
        lastName: lastName ? 'store' : (demoProfile?.lastName ? 'demoProfile' : 'none'),
        nickname: nickname ? 'store' : (onboardingStatus?.basicInfo?.nickname ? 'backend' : 'none'),
        dateOfBirth: dateOfBirth ? 'store' : (onboardingStatus?.basicInfo?.dateOfBirth ? 'backend' : 'none'),
        gender: gender ? 'store' : (onboardingStatus?.basicInfo?.gender ? 'backend' : 'none'),
      });
    }
  }, [firstName, lastName, nickname, dateOfBirth, gender, onboardingStatus, demoProfile, displayFirstName, displayLastName, displayNickname, displayDateOfBirth, displayGender]);

  // PERFORMANCE LOG: Track photo rendering speed
  React.useEffect(() => {
    if (__DEV__) {
      const timestamp = new Date().toISOString();
      if (currentUser === undefined) {
        console.log('[REVIEW_PHOTOS] ⏳ Loading user + photos...', { timestamp });
      } else if (backendPhotos.length === 0) {
        console.log('[REVIEW_PHOTOS] ✓ User loaded, 0 photos (first paint ready)', { timestamp });
      } else {
        console.log('[REVIEW_PHOTOS] ✓ User + photos loaded - rendering immediately', {
          timestamp,
          count: backendPhotos.length,
          urls: backendPhotos.map((p: any) => p.url?.substring(0, 50) + '...'),
        });
      }
    }
  }, [currentUser, backendPhotos]);

  // CRITICAL: Check demoProfile.faceVerificationPassed for demo mode (persisted across logout)
  // Backend requires faceVerificationStatus === 'verified' - pending is NOT sufficient
  const isVerified = isDemoMode
    ? !!(demoProfile?.faceVerificationPassed || faceVerificationPassed)
    : !!faceVerificationPassed;

  // CHECKPOINT GATE: Block access if face verification not completed
  React.useEffect(() => {
    if (isVerified) {
      if (__DEV__) {
        console.log("[REVIEW_GATE] verified=true (faceVerificationPassed) -> allow");
        console.log("[REVIEW_GATE] faceVerificationPassed:", faceVerificationPassed);
      }
      return;
    }
    if (__DEV__) console.log("[REVIEW_GATE] verified=false -> redirect to face-verification");
    router.replace("/(onboarding)/face-verification" as any);
  }, [isVerified, router, faceVerificationPassed, faceVerificationPending]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState("");

  const completeOnboarding = useMutation(api.users.completeOnboarding);

  const calculateAge = (dob: string) => {
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

  const handleComplete = async () => {
    if (__DEV__) {
      console.log("[REVIEW] handleComplete called");
      console.log("[REVIEW] userId:", userId);
      console.log("[REVIEW] isSubmitting:", isSubmitting);
      console.log("[REVIEW] faceVerificationPassed:", faceVerificationPassed);
      console.log("[REVIEW] faceVerificationPending:", faceVerificationPending);
    }

    if (!userId) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isDemoMode) {
        // Demo mode: save profile locally, skip Convex
        // OB-4 fix: Do NOT mark onboarding complete here — that happens in tutorial.tsx
        // to ensure user sees the tutorial before being marked complete.
        setUploadProgress("Saving profile...");
        const demoStore = useDemoStore.getState();
        // Filter out null slots for display/storage
        const validPhotos = photos.filter((p): p is string => p !== null && p !== '');

        // Build profile data, only including basic fields if they're not empty
        // This prevents overwriting existing demoProfile data with empty values
        // if onboardingStore was reset (e.g., after forced logout)
        const profileData: any = {
          bio,
          photos: validPhotos.map((uri) => ({ url: uri })),
          height,
          weight,
          smoking,
          drinking,
          kids,
          exercise,
          pets: pets as string[],
          insect: insect ?? undefined,
          education,
          religion,
          jobTitle,
          company,
          school,
          lookingFor: lookingFor as string[],
          relationshipIntent: sanitizeRelationshipIntent(relationshipIntent as string[]),
          activities: activities as string[],
          profilePrompts,
          seedQuestions,
          minAge,
          maxAge,
          maxDistance,
        };

        // Only include basic fields if they have values (don't overwrite with empty)
        // Store firstName/lastName separately and construct name for backend compat
        if (firstName && firstName.trim().length > 0) profileData.firstName = firstName.trim();
        if (lastName && lastName.trim().length > 0) profileData.lastName = lastName.trim();
        // Construct full name from firstName/lastName for backward compat
        const fullName = `${(firstName || '').trim()} ${(lastName || '').trim()}`.trim();
        if (fullName.length > 0) profileData.name = fullName;
        if (nickname && nickname.length > 0) profileData.handle = nickname;
        if (dateOfBirth && dateOfBirth.length > 0) profileData.dateOfBirth = dateOfBirth;
        if (gender) profileData.gender = gender;
        // LGBTQ fields are optional - only save if user selected any
        if (lgbtqSelf.length > 0) profileData.lgbtqSelf = lgbtqSelf;
        if (lgbtqPreference.length > 0) profileData.lgbtqPreference = lgbtqPreference;

        demoStore.saveDemoProfile(userId, profileData);
        // OB-4: Profile saved, but completion flags set ONLY in tutorial.tsx after user finishes tutorial
        setStep("tutorial");
        router.push("/(onboarding)/tutorial" as any);
        return;
      }

      // Live mode: Photos are already uploaded in additional-photos screen
      // Just get their storageIds from backend query
      if (__DEV__) {
        console.log('[REVIEW] pendingUploads', 0); // No uploads happen here
      }

      setUploadProgress("Saving profile...");

      // BUG FIX: Build gender from reliable source with fallbacks
      // Priority: 1) onboardingStore, 2) backend user.gender, 3) onboardingDraft
      const payloadGender = gender || onboardingStatus?.basicInfo?.gender || '';

      // CRITICAL: Block submission if gender is still missing
      if (!payloadGender) {
        console.error('[REVIEW_SUBMIT] ❌ BLOCKED: gender is null/empty', {
          storeGender: gender,
          backendGender: onboardingStatus?.basicInfo?.gender,
          displayGender,
        });
        Alert.alert(
          'Missing Information',
          'Gender information is required. Please go back and complete your basic info.',
          [{ text: 'OK' }]
        );
        setIsSubmitting(false);
        return;
      }

      if (__DEV__) {
        console.log('[REVIEW_SUBMIT] Payload gender:', payloadGender);
        console.log('[REVIEW_SUBMIT] Gender source:', gender ? 'store' : 'backend');
      }

      // Prepare onboarding data
      // Construct full name from firstName/lastName for backend
      const fullName = `${(firstName || '').trim()} ${(lastName || '').trim()}`.trim();
      const onboardingData: any = {
        userId: userId as Id<"users">,
        name: fullName,
        dateOfBirth,
        gender: payloadGender,
        bio,
        height: height || undefined,
        weight: weight || undefined,
        smoking: smoking || undefined,
        drinking: drinking || undefined,
        kids: kids || undefined,
        exercise: exercise || undefined,
        pets: pets.length > 0 ? pets : undefined,
        insect: insect ?? undefined,
        education: education || undefined,
        religion: religion || undefined,
        jobTitle: jobTitle || undefined,
        company: company || undefined,
        school: school || undefined,
        lookingFor: lookingFor.length > 0 ? lookingFor : undefined,
        // STABILITY FIX: Sanitize relationshipIntent before sending to Convex
        relationshipIntent: (() => {
          const sanitized = sanitizeRelationshipIntent(relationshipIntent as string[]);
          return sanitized.length > 0 ? sanitized : undefined;
        })(),
        activities: activities.length > 0 ? activities : undefined,
        minAge,
        maxAge,
        maxDistance,
        // FIX: Add missing fields from demo mode payload
        profilePrompts: profilePrompts.length > 0 ? profilePrompts : undefined,
        lgbtqSelf: lgbtqSelf.length > 0 ? lgbtqSelf : undefined,
        // photoStorageIds omitted - photos already uploaded in additional-photos screen
      };

      // Remove undefined values
      Object.keys(onboardingData).forEach((key) => {
        if (onboardingData[key] === undefined) {
          delete onboardingData[key];
        }
      });

      // Sanitize activities array before submission to prevent validation errors
      if (onboardingData.activities && Array.isArray(onboardingData.activities)) {
        const ALLOWED_ACTIVITIES = [
          "coffee", "date_night", "sports", "movies", "free_tonight", "foodie",
          "gym_partner", "concerts", "travel", "outdoors", "art_culture", "gaming",
          "nightlife", "brunch", "study_date", "this_weekend", "beach_pool",
          "road_trip", "photography", "volunteering"
        ];

        const before = [...onboardingData.activities];

        // Transform and filter activities
        const sanitized = onboardingData.activities
          .map((activity: string) => {
            // Map late_night_talks to nightlife
            if (activity === "late_night_talks") return "nightlife";
            return activity;
          })
          .filter((activity: string) => ALLOWED_ACTIVITIES.includes(activity));

        // Deduplicate
        const after = [...new Set(sanitized)];

        onboardingData.activities = after;

        if (__DEV__) {
          console.log('[ONB_SANITIZE] activities before/after', { before, after });
        }
      }

      // Debug log before mutation to verify all required fields
      if (__DEV__) {
        console.log('[REVIEW_SUBMIT] Final payload:', {
          userId: onboardingData.userId,
          name: onboardingData.name,
          dateOfBirth: onboardingData.dateOfBirth,
          gender: onboardingData.gender,
          bio: onboardingData.bio?.substring(0, 50),
          hasHeight: !!onboardingData.height,
          hasWeight: !!onboardingData.weight,
          activitiesCount: onboardingData.activities?.length || 0,
        });
      }

      // H7 FIX: Capture auth version before async operation
      const capturedAuthVersion = useAuthStore.getState().authVersion;

      // Submit all onboarding data to backend
      // ONB-005 FIX: Capture and validate result before marking complete
      const result = await completeOnboarding(onboardingData);
      if (!result) {
        throw new Error('Failed to complete onboarding - server returned no result');
      }

      // H7 FIX: Check if logout happened during mutation (version changed)
      if (useAuthStore.getState().authVersion !== capturedAuthVersion) {
        if (__DEV__) console.log('[AUTH] Logout detected during onboarding completion - ignoring result');
        return;
      }

      // H8 FIX: Check if component unmounted during async onboarding
      if (!mountedRef.current) {
        if (__DEV__) console.log('[AUTH] Component unmounted during onboarding completion - ignoring result');
        return;
      }

      setOnboardingCompleted(true);

      // Persist onboardingCompleted flag to SecureStore for fast-path boot
      // This is the true final completion point (after successful mutation)
      const authState = useAuthStore.getState();
      if (authState.token && authState.userId) {
        await saveAuthBootCache(authState.token, authState.userId, { onboardingCompleted: true });
      }

      setStep("tutorial");
      router.push("/(onboarding)/tutorial" as any);
    } catch (error: any) {
      console.error("Onboarding error:", error);
      Alert.alert("Error", error.message || "Failed to complete onboarding");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (step: string) => {
    // CENTRAL EDIT HUB: All edits from Review pass editFromReview=true
    // so each screen knows to:
    // 1. Pre-fill from demoProfile
    // 2. Return directly to Review on Continue (not continue through onboarding flow)
    router.push(`/(onboarding)/${step}?editFromReview=true` as any);
  };

  // PERFORMANCE FIX: Use backend photos directly (instant display, no download wait)
  // In demo mode, fall back to local photos from store
  const validPhotos = React.useMemo(() => {
    if (isDemoMode) {
      // Demo mode: use local photos from store
      return photos.filter((uri): uri is string => uri !== null && uri !== '');
    }
    // Live mode: use backend photos (sorted by order)
    if (!backendPhotos || backendPhotos.length === 0) {
      return [];
    }
    return [...backendPhotos]
      .sort((a, b) => a.order - b.order)
      .map(photo => photo.url)
      .filter((url): url is string => !!url);
  }, [backendPhotos, photos]);

  // Helper to get label from options array
  const getLabel = (options: { value: string; label: string }[], value: string | null) => {
    if (!value) return null;
    return options.find((o) => o.value === value)?.label ?? value;
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
    <OnboardingProgressHeader />
    <ScrollView key={refreshKey} style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Review Your Profile</Text>
      <Text style={styles.subtitle}>
        Make sure everything looks good before you start matching!
      </Text>

      {/* Photos Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <TouchableOpacity onPress={() => handleEdit("additional-photos")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {validPhotos.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.photosScroll}
          >
            {validPhotos.map((uri, index) => (
              <View key={index} style={styles.photoWrapper}>
                <Image
                  source={{ uri }}
                  style={styles.photoThumbnail}
                  cachePolicy="memory"
                  contentFit="cover"
                  transition={200}
                />
                {index === 0 && displayPhotoVariant !== 'original' && (
                  <View style={styles.variantBadge}>
                    <Text style={styles.variantBadgeText}>
                      {displayPhotoVariant === 'blurred' ? 'Blurred' : 'Cartoon'}
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.emptyText}>No photos added</Text>
        )}
      </View>

      {/* Basic Info Section - Name, Handle, Age, Gender, LGBTQ Identity */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Basic Info</Text>
          <TouchableOpacity onPress={() => handleEdit("basic-info")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>First Name:</Text>
          <Text style={styles.infoValue}>{displayFirstName}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Last Name:</Text>
          <Text style={styles.infoValue}>{displayLastName}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>User ID:</Text>
          <Text style={styles.infoValue}>@{displayNickname}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Age:</Text>
          <Text style={styles.infoValue}>
            {displayDateOfBirth ? calculateAge(displayDateOfBirth) : "N/A"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Gender:</Text>
          <Text style={styles.infoValue}>
            {displayGender ? GENDER_OPTIONS.find((g) => g.value === displayGender)?.label : "Not set"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>LGBTQ (Identity):</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const values = lgbtqSelf.length > 0 ? lgbtqSelf : (demoProfile?.lgbtqSelf || []);
              if (values.length === 0) return "–";
              return values.map((v: string) => LGBTQ_OPTIONS.find((o) => o.value === v)?.label || v).join(", ");
            })()}
          </Text>
        </View>
      </View>

      {/* Photos & Bio Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Photos & Bio</Text>
          <TouchableOpacity onPress={() => handleEdit("additional-photos")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.bioText}>{bio || demoProfile?.bio || "No bio added"}</Text>
      </View>

      {/* Prompts Section (New 2-Page System) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>About You</Text>
          <TouchableOpacity onPress={() => handleEdit("prompts")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Seed Questions */}
        {(seedQuestions.identityAnchor || seedQuestions.socialBattery || seedQuestions.valueTrigger) ? (
          <View style={styles.promptSubsection}>
            {seedQuestions.identityAnchor && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Describes you:</Text>
                <Text style={styles.infoValue}>
                  {IDENTITY_ANCHOR_OPTIONS.find(o => o.value === seedQuestions.identityAnchor)?.label || seedQuestions.identityAnchor}
                </Text>
              </View>
            )}
            {seedQuestions.socialBattery && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Social energy:</Text>
                <Text style={styles.infoValue}>
                  {seedQuestions.socialBattery <= 2 ? SOCIAL_BATTERY_LEFT_LABEL :
                   seedQuestions.socialBattery >= 4 ? SOCIAL_BATTERY_RIGHT_LABEL :
                   'Balanced'} ({seedQuestions.socialBattery}/5)
                </Text>
              </View>
            )}
            {seedQuestions.valueTrigger && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Good person sign:</Text>
                <Text style={styles.infoValue}>
                  {VALUE_TRIGGER_OPTIONS.find(o => o.value === seedQuestions.valueTrigger)?.label || seedQuestions.valueTrigger}
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Profile Prompts (Unified System) */}
        {(() => {
          const hasPrompts = profilePrompts && profilePrompts.length > 0;
          return (
            <>
              <View style={styles.sectionPromptsHeader}>
                <Text style={styles.sectionPromptsLabel}>Your Prompts</Text>
                <TouchableOpacity onPress={() => handleEdit("prompts-part2")}>
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
              </View>
              {hasPrompts ? (
                profilePrompts.map((prompt, index) => (
                  <View key={index} style={styles.promptItem}>
                    <Text style={styles.promptQuestion}>{prompt.question}</Text>
                    <Text style={styles.promptAnswer}>{prompt.answer}</Text>
                  </View>
                ))
              ) : (
                <TouchableOpacity onPress={() => handleEdit("prompts-part2")}>
                  <Text style={styles.emptyText}>No prompts added — Tap to add</Text>
                </TouchableOpacity>
              )}
            </>
          );
        })()}
      </View>

      {/* Profile Details Section - Height, Weight, Job, Company, School, Education, Religion */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Profile Details</Text>
          <TouchableOpacity onPress={() => handleEdit("profile-details")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Height:</Text>
          <Text style={styles.infoValue}>{(height || demoProfile?.height) ? `${height || demoProfile?.height} cm` : "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Weight:</Text>
          <Text style={styles.infoValue}>{(weight || demoProfile?.weight) ? `${weight || demoProfile?.weight} kg` : "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Job Title:</Text>
          <Text style={styles.infoValue}>{jobTitle || demoProfile?.jobTitle || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Company:</Text>
          <Text style={styles.infoValue}>{company || demoProfile?.company || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>School:</Text>
          <Text style={styles.infoValue}>{school || demoProfile?.school || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Education:</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const eduValue = education || demoProfile?.education || null;
              if (!eduValue) return "–";
              if (eduValue === 'other') {
                const otherText = educationOther || demoProfile?.educationOther || '';
                return otherText ? `Other: ${otherText}` : 'Other';
              }
              return getLabel(EDUCATION_OPTIONS, eduValue) || "–";
            })()}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Religion:</Text>
          <Text style={styles.infoValue}>{getLabel(RELIGION_OPTIONS, religion || demoProfile?.religion || null) || "–"}</Text>
        </View>
      </View>

      {/* Lifestyle Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Lifestyle</Text>
          <TouchableOpacity onPress={() => handleEdit("profile-details/lifestyle")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Smoking:</Text>
          <Text style={styles.infoValue}>{getLabel(SMOKING_OPTIONS, smoking || demoProfile?.smoking || null) || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Drinking:</Text>
          <Text style={styles.infoValue}>{getLabel(DRINKING_OPTIONS, drinking || demoProfile?.drinking || null) || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Kids:</Text>
          <Text style={styles.infoValue}>{getLabel(KIDS_OPTIONS, kids || demoProfile?.kids || null) || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Exercise:</Text>
          <Text style={styles.infoValue}>{getLabel(EXERCISE_OPTIONS, exercise || demoProfile?.exercise || null) || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Pets:</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const petsData = pets.length > 0 ? pets : (demoProfile?.pets || []);
              if (petsData.length === 0) return "–";
              return petsData.map((p) => PETS_OPTIONS.find((o) => o.value === p)?.label ?? p).join(", ");
            })()}
          </Text>
        </View>
      </View>

      {/* Life Rhythm Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Life Rhythm</Text>
          <TouchableOpacity onPress={() => handleEdit("profile-details/life-rhythm")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>City:</Text>
          <Text style={styles.infoValue}>{lifeRhythm.city || "–"}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Social Energy:</Text>
          <Text style={styles.infoValue}>
            {lifeRhythm.socialRhythm
              ? SOCIAL_RHYTHM_OPTIONS.find((o) => o.value === lifeRhythm.socialRhythm)?.label || "–"
              : "–"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Sleep Schedule:</Text>
          <Text style={styles.infoValue}>
            {lifeRhythm.sleepSchedule
              ? SLEEP_SCHEDULE_OPTIONS.find((o) => o.value === lifeRhythm.sleepSchedule)?.label || "–"
              : "–"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Travel Style:</Text>
          <Text style={styles.infoValue}>
            {lifeRhythm.travelStyle
              ? TRAVEL_STYLE_OPTIONS.find((o) => o.value === lifeRhythm.travelStyle)?.label || "–"
              : "–"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Work Style:</Text>
          <Text style={styles.infoValue}>
            {lifeRhythm.workStyle
              ? WORK_STYLE_OPTIONS.find((o) => o.value === lifeRhythm.workStyle)?.label || "–"
              : "–"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Core Values:</Text>
          <Text style={styles.infoValue}>
            {lifeRhythm.coreValues && lifeRhythm.coreValues.length > 0
              ? lifeRhythm.coreValues
                  .map((v) => CORE_VALUES_OPTIONS.find((o) => o.value === v)?.label || v)
                  .join(", ")
              : "–"}
          </Text>
        </View>
      </View>

      {/* Looking For Section - Gender Preference, LGBTQ Preference, Age, Distance */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Looking For</Text>
          <TouchableOpacity onPress={() => handleEdit("preferences")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Gender:</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const lookingForData = lookingFor.length > 0 ? lookingFor : (demoProfile?.lookingFor || []);
              if (lookingForData.length === 0) return "–";
              return lookingForData.map((g) => GENDER_OPTIONS.find((opt) => opt.value === g)?.label || g).join(", ");
            })()}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>LGBTQ (Preference):</Text>
          <Text style={styles.infoValue}>
            {(() => {
              const values = lgbtqPreference.length > 0 ? lgbtqPreference : (demoProfile?.lgbtqPreference || []);
              if (values.length === 0) return "–";
              return values.map((v: string) => LGBTQ_OPTIONS.find((o) => o.value === v)?.label || v).join(", ");
            })()}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Age Range:</Text>
          <Text style={styles.infoValue}>{minAge || demoProfile?.minAge || 18} - {maxAge || demoProfile?.maxAge || 70} years</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Distance:</Text>
          <Text style={styles.infoValue}>Up to {maxDistance || demoProfile?.maxDistance || 50} miles</Text>
        </View>
      </View>

      {/* Relationship Goals Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Relationship Goals</Text>
          <TouchableOpacity onPress={() => handleEdit("preferences")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {(() => {
          const intentData = relationshipIntent.length > 0 ? relationshipIntent : (demoProfile?.relationshipIntent || []);
          if (intentData.length === 0) return <Text style={styles.emptyText}>Not specified</Text>;
          return (
            <View style={styles.chipsContainer}>
              {intentData.map((intent) => {
                const intentObj = RELATIONSHIP_INTENTS.find((r) => r.value === intent);
                return (
                  <View key={intent} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {intentObj?.emoji} {intentObj?.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })()}
      </View>

      {/* Interests Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Interests</Text>
          <TouchableOpacity onPress={() => handleEdit("preferences")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {(() => {
          const activitiesData = activities.length > 0 ? activities : (demoProfile?.activities || []);
          if (activitiesData.length === 0) return <Text style={styles.emptyText}>No interests selected</Text>;
          return (
            <View style={styles.chipsContainer}>
              {activitiesData.map((activity) => {
                const activityObj = ACTIVITY_FILTERS.find((a) => a.value === activity);
                return (
                  <View key={activity} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {activityObj?.emoji} {activityObj?.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })()}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        {uploadProgress ? (
          <Text style={styles.progressText}>{uploadProgress}</Text>
        ) : null}
        <Button
          title={isSubmitting ? "Please wait..." : "Complete Profile"}
          variant="primary"
          onPress={handleComplete}
          loading={isSubmitting}
          disabled={isSubmitting}
          fullWidth
        />
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
  progressText: {
    fontSize: 14,
    color: COLORS.primary,
    textAlign: "center",
    marginBottom: 12,
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
    marginBottom: 32,
    lineHeight: 22,
  },
  section: {
    marginBottom: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
  },
  editLink: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "500",
  },
  photosScroll: {
    marginTop: 12,
  },
  photoWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  photoThumbnail: {
    width: 80,
    height: 120,
    borderRadius: 12,
  },
  variantBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: COLORS.primary + 'E0',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  variantBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.white,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 15,
    color: COLORS.textLight,
    width: 100,
  },
  infoValue: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: "500",
    flex: 1,
  },
  bioText: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontStyle: "italic",
    marginTop: 8,
  },
  sectionPromptsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    marginTop: 8,
  },
  sectionPromptsLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
  },
  promptSubsection: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  promptSectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
    marginBottom: 10,
  },
  promptItem: {
    marginBottom: 12,
  },
  promptQuestion: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textLight,
    marginBottom: 4,
  },
  promptAnswer: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 20,
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
  },
  chipText: {
    fontSize: 13,
    color: COLORS.text,
  },
  preferenceText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
  },
  footer: {
    marginTop: 24,
  },
});
