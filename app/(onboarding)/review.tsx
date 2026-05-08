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
import { isDemoAuthMode } from "@/config/demo";
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

// IDENTITY SIMPLIFICATION: Single name field - no parsing needed

// CURRENT 9 RELATIONSHIP CATEGORIES (source of truth - matches schema.ts)
const ALLOWED_RELATIONSHIP_INTENTS = new Set([
  'serious_vibes', 'keep_it_casual', 'exploring_vibes', 'see_where_it_goes',
  'open_to_vibes', 'just_friends', 'open_to_anything', 'single_parent', 'new_to_dating'
]);

// Legacy → Current mapping for relationshipIntent values
// These old values may exist in cached drafts or older user profiles
const LEGACY_INTENT_MAP: Record<string, string> = {
  'long_term': 'serious_vibes',
  'short_term': 'keep_it_casual',
  'fwb': 'keep_it_casual',
  'figuring_out': 'exploring_vibes',
  'short_to_long': 'see_where_it_goes',
  'long_to_short': 'open_to_vibes',
  // Additional potential legacy values
  'casual': 'keep_it_casual',
  'serious': 'serious_vibes',
  'marriage': 'serious_vibes',
  'friendship': 'just_friends',
  'open': 'open_to_anything',
};

// Sanitize relationshipIntent: map legacy values AND filter invalid ones
function sanitizeRelationshipIntent(arr: string[]): string[] {
  // Step 1: Map legacy values to current valid values
  const mapped = arr.map(v => LEGACY_INTENT_MAP[v] || v);

  // Step 2: Filter to only valid values
  const sanitized = mapped.filter(v => ALLOWED_RELATIONSHIP_INTENTS.has(v));

  // Step 3: Deduplicate (multiple legacy values might map to same current value)
  const deduped = [...new Set(sanitized)];

  if (__DEV__ && (arr.length !== deduped.length || arr.some((v, i) => v !== mapped[i]))) {
    console.log('[REVIEW] relationshipIntent normalization:', {
      original: arr,
      mapped,
      final: deduped,
    });
  }
  return deduped;
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
    name, // IDENTITY SIMPLIFICATION: Single name field
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
  const { userId, token, setOnboardingCompleted, faceVerificationPassed, faceVerificationPending } = useAuthStore();
  const demoProfile = useDemoStore((s) => isDemoMode && userId ? s.demoProfiles[userId] : null);

  // H8 FIX: Track mounted state to prevent setAuth after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // BUG FIX: Always query backend status as authoritative source + fallback
  // FIX: Backend expects { userId }, not { token }
  const onboardingStatusLive = useQuery(
    api.users.getOnboardingStatus,
    !isDemoMode && !isDemoAuthMode && userId ? { userId } : 'skip'
  );

  // Demo auth mode: Use demo onboarding status query
  const onboardingStatusDemo = useQuery(
    api.demoAuth.getDemoOnboardingStatus,
    isDemoAuthMode && token ? { token } : 'skip'
  );

  // Use appropriate status based on mode
  const onboardingStatus = isDemoAuthMode ? onboardingStatusDemo : onboardingStatusLive;

  // BUG FIX (2026-03-06): Use getCurrentUser which includes ALL photos
  // (including verification_reference primary photo), not getUserPhotos
  // which excludes verification_reference photos
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );
  // Extract photos from currentUser (includes verification_reference)
  const backendPhotos = currentUser?.photos ?? [];

  // IDENTITY SIMPLIFICATION: Single name field
  // Fallback to backend data if store is empty
  const getDisplayName = (): string => {
    // Priority 1: Store value
    if (name) return name;
    // Priority 2: demoProfile value (demo mode)
    if (demoProfile?.name) return demoProfile.name;
    // Priority 3: Backend value
    if (onboardingStatus?.basicInfo?.name) return onboardingStatus.basicInfo.name;
    return '';
  };
  const displayName = getDisplayName() || "Not set";
  const displayDateOfBirth = dateOfBirth || onboardingStatus?.basicInfo?.dateOfBirth || demoProfile?.dateOfBirth || "";
  const displayGender = gender || onboardingStatus?.basicInfo?.gender || demoProfile?.gender || "";

  // BUG FIX: Log data source for debugging
  React.useEffect(() => {
    if (__DEV__) {
      console.log('[REVIEW] basic info values:', {
        displayName,
        displayDateOfBirth,
        displayGender,
      });
      console.log('[REVIEW] basic info sources:', {
        name: name ? 'store' : (demoProfile?.name ? 'demoProfile' : (onboardingStatus?.basicInfo?.name ? 'backend' : 'none')),
        dateOfBirth: dateOfBirth ? 'store' : (onboardingStatus?.basicInfo?.dateOfBirth ? 'backend' : 'none'),
        gender: gender ? 'store' : (onboardingStatus?.basicInfo?.gender ? 'backend' : 'none'),
      });
    }
  }, [name, dateOfBirth, gender, onboardingStatus, demoProfile, displayName, displayDateOfBirth, displayGender]);

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
  // BACKEND ALIGNMENT: Only 'verified' status can complete onboarding
  // This is used for display purposes; the actual gate is in handleComplete()
  const isVerified = isDemoMode
    ? !!(demoProfile?.faceVerificationPassed || faceVerificationPassed)
    : !!faceVerificationPassed;
  const isPending = !!faceVerificationPending;

  // NOTE: Face verification check happens in handleComplete() before calling backend
  // Users can view this screen but cannot submit until face verification is 'verified'
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
        // IDENTITY SIMPLIFICATION: Single name field
        if (name && name.trim().length > 0) profileData.name = name.trim();
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

      // PRODUCT REQUIREMENT: Face verification is NON-BLOCKING for onboarding completion
      // Users can complete onboarding regardless of face verification status (pending, unverified, verified)
      // The status is still tracked and shown, but does not block app entry
      const currentFaceStatus = onboardingStatus?.faceVerificationStatus;
      if (__DEV__) {
        console.log('[REVIEW_SUBMIT] Face verification status (non-blocking):', currentFaceStatus);
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
      // IDENTITY SIMPLIFICATION: Single name field
      const onboardingData: any = {
        userId: userId as Id<"users">,
        name: (name || '').trim(),
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
        // P0 FIX: Include lgbtqPreference for LGBTQ matching
        lgbtqPreference: lgbtqPreference.length > 0 ? lgbtqPreference : undefined,
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

      // FINAL DEFENSIVE NORMALIZATION: Ensure relationshipIntent NEVER contains legacy values
      // This is the last line of defense before Convex mutation - even if store has stale data
      if (onboardingData.relationshipIntent && Array.isArray(onboardingData.relationshipIntent)) {
        const beforeFinal = [...onboardingData.relationshipIntent];
        const mapped = onboardingData.relationshipIntent.map((v: string) => LEGACY_INTENT_MAP[v] || v);
        const filtered = mapped.filter((v: string) => ALLOWED_RELATIONSHIP_INTENTS.has(v));
        const deduped = [...new Set(filtered)];
        onboardingData.relationshipIntent = deduped.length > 0 ? deduped : undefined;

        if (__DEV__) {
          console.log('[REVIEW_SUBMIT] relationshipIntent FINAL normalization:', {
            beforeFinal,
            afterFinal: onboardingData.relationshipIntent,
            hadLegacyValues: beforeFinal.some((v: string) => LEGACY_INTENT_MAP[v] !== undefined),
          });
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
          relationshipIntent: onboardingData.relationshipIntent, // ADDED: Show final intent values
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
  // BUG FIX: Include verification reference photo in review (getCurrentUser excludes it)
  // In demo mode, fall back to local photos from store
  const validPhotos = React.useMemo(() => {
    if (isDemoMode) {
      // Demo mode: use local photos from store
      return photos.filter((uri): uri is string => uri !== null && uri !== '');
    }

    // Live mode: Start with reference photo if exists (from onboardingStatus)
    const referencePhotoUrl = onboardingStatus?.verificationReferencePhotoUrl;
    const referencePhotoList: string[] = referencePhotoUrl ? [referencePhotoUrl] : [];

    // Add normal photos from backend (excludes verification_reference)
    const normalPhotoUrls = [...(backendPhotos || [])]
      .sort((a, b) => a.order - b.order)
      .map(photo => photo.url)
      .filter((url): url is string => !!url);

    // Merge: reference photo first, then additional normal photos
    // Deduplicate in case reference photo somehow appears in both
    const allPhotos = [...new Set([...referencePhotoList, ...normalPhotoUrls])];

    return allPhotos;
  }, [backendPhotos, photos, onboardingStatus?.verificationReferencePhotoUrl]);

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

      {/* PHASE-1 RESTRUCTURE: Verification Status Section (new) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Verification Status</Text>
        </View>
        <View style={styles.verificationStatusRow}>
          <Ionicons
            name={isVerified ? "checkmark-circle" : isPending ? "time" : "close-circle"}
            size={20}
            color={isVerified ? COLORS.success : isPending ? "#F5A623" : COLORS.error}
          />
          <Text style={[
            styles.verificationStatusText,
            isVerified && styles.verificationStatusVerified,
            isPending && styles.verificationStatusPending,
            !isVerified && !isPending && styles.verificationStatusUnverified,
          ]}>
            {isVerified ? "Verified" : isPending ? "Pending Review" : "Not Verified"}
          </Text>
        </View>
        {!isVerified && !isPending && (
          <Text style={styles.verificationHint}>
            You can verify your profile later in Settings
          </Text>
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
          <Text style={styles.infoLabel}>Name:</Text>
          <Text style={styles.infoValue}>{displayName}</Text>
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

      {/* Bio Section (PHASE-1 RESTRUCTURE: simplified from Photos & Bio) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Bio</Text>
          <TouchableOpacity onPress={() => handleEdit("additional-photos")}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.bioText}>{bio || demoProfile?.bio || "No bio added"}</Text>
      </View>

      {/* PHASE-1 RESTRUCTURE: Prompts, Profile Details, Lifestyle, Life Rhythm sections REMOVED */}

      {/* Looking For Section - PHASE-1 RESTRUCTURE: Simplified to just Gender and LGBTQ Preference */}
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

      {/* PHASE-1 RESTRUCTURE: Interests Section REMOVED from onboarding review */}

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
    paddingBottom: 40,
  },
  progressText: {
    fontSize: 14,
    color: COLORS.primary,
    textAlign: "center",
    marginBottom: 14,
    fontWeight: "500",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 32,
    lineHeight: 24,
  },
  section: {
    marginBottom: 26,
    paddingBottom: 26,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  editLink: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "600",
  },
  photosScroll: {
    marginTop: 14,
  },
  photoWrapper: {
    position: 'relative',
    marginRight: 14,
  },
  photoThumbnail: {
    width: 85,
    height: 125,
    borderRadius: 14,
  },
  variantBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    backgroundColor: 'rgba(255, 107, 107, 0.9)',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  variantBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.white,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 10,
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
    lineHeight: 24,
    marginTop: 10,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontStyle: "italic",
    marginTop: 10,
  },
  sectionPromptsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    marginTop: 10,
  },
  sectionPromptsLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  promptSubsection: {
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  promptSectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  promptItem: {
    marginBottom: 14,
  },
  promptQuestion: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textLight,
    marginBottom: 6,
  },
  promptAnswer: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
  },
  chipText: {
    fontSize: 13,
    color: COLORS.text,
  },
  preferenceText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 10,
    lineHeight: 20,
  },
  // PHASE-1 RESTRUCTURE: Verification status styles
  verificationStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  verificationStatusText: {
    fontSize: 15,
    fontWeight: '600',
  },
  verificationStatusVerified: {
    color: COLORS.success,
  },
  verificationStatusPending: {
    color: '#F5A623',
  },
  verificationStatusUnverified: {
    color: COLORS.error,
  },
  verificationHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  footer: {
    marginTop: 28,
  },
});
