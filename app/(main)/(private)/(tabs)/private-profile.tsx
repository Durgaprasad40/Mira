/**
 * Phase-2 Private Profile Screen
 *
 * Clean profile screen with:
 * - Profile header (avatar, nickname, age)
 * - Settings menu list
 *
 * All editing happens in Edit Profile screen.
 * Account actions (deactivate Deep Connect) are in Account screen.
 *
 * IMPORTANT:
 * - Nickname-only (no full name)
 * - Clean and minimal UI
 * - No data editing here
 * - No app-level actions (logout/deactivate account) - those are Phase-1 only
 */
import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  PHASE2_SECTION1_PROMPTS,
  PHASE2_SECTION2_PROMPTS,
  PHASE2_SECTION3_PROMPTS,
  PHASE2_PROMPT_MIN_TEXT_LENGTH,
  PHASE2_PROMPT_MAX_TEXT_LENGTH,
} from '@/lib/privateConstants';
import { useAuthStore } from '@/stores/authStore';
import { hydratePhotoBlurSettings } from '@/stores/privateProfileStore';
import { isDemoMode } from '@/hooks/useConvex';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useScreenTrace } from '@/lib/devTrace';

/** Calculate age from DOB string using local date parsing */
function calculateAgeFromDOB(dob: string): number {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 0;
  const [y, m, d] = dob.split("-").map(Number);
  const birthDate = new Date(y, m - 1, d, 12, 0, 0);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

const C = INCOGNITO_COLORS;
const MAIN_PHOTO_SIZE = 120;

/** Validate a photo URL is usable */
function isValidPhotoUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url === 'undefined' || url === 'null') return false;
  if (url.includes('/cache/ImagePicker/') || url.includes('/Cache/ImagePicker/')) {
    return false;
  }
  return url.startsWith('http') || url.startsWith('file://');
}

export default function PrivateProfileScreen() {
  useScreenTrace("P2_PROFILE");
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Auth
  const { userId, token } = useAuthStore();
  const demoUser = useMemo(
    () => (isDemoMode ? getDemoCurrentUser() : null),
    [isDemoMode]
  );
  const [queryPaused, setQueryPaused] = useState(false);

  // Backend profile query
  const backendProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    !isDemoMode && userId && token && !queryPaused ? { token, authUserId: userId } : 'skip'
  );
  const backendProfileLoaded = backendProfile !== undefined;

  // Loading and error states
  const [hasLoadError, setHasLoadError] = useState(false);
  const [showSlowNetworkHint, setShowSlowNetworkHint] = useState(false);
  const isLoading = !isDemoMode && userId && backendProfile === undefined && !hasLoadError;
  const isMissingProfile = !isDemoMode && backendProfileLoaded && backendProfile === null;
  const isSignedOut = !isDemoMode && !userId;

  // Track mount state
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Self-healing: fix invalid age from backend (runs at most once per screen lifecycle)
  const healProfile = useMutation(api.privateProfiles.getAndHealByAuthUserId);
  const hasHealedRef = useRef(false);

  useEffect(() => {
    if (!backendProfile) return; // wait for data
    if (isDemoMode) return; // skip demo

    const age = backendProfile.age;

    const needsHealing =
      typeof age !== 'number' ||
      age <= 0 ||
      age >= 120;

    if (needsHealing && !hasHealedRef.current && userId && token) {
      hasHealedRef.current = true;

      healProfile({ token, authUserId: userId })
        .catch((err) => {
          if (__DEV__) {
            console.warn('[P2_PROFILE] Age healing failed');
          }
        });
    }
  }, [backendProfile?.age, isDemoMode, token, userId, healProfile]);

  // Error timeout
  useEffect(() => {
    if (isDemoMode || backendProfile !== undefined || hasLoadError) {
      if (hasLoadError && backendProfile !== undefined) {
        setHasLoadError(false);
      }
      setShowSlowNetworkHint(false);
      return;
    }

    const slowHint = setTimeout(() => {
      if (mountedRef.current && backendProfile === undefined) {
        setShowSlowNetworkHint(true);
      }
    }, 5000);

    const timeout = setTimeout(() => {
      if (mountedRef.current && backendProfile === undefined) {
        setHasLoadError(true);
      }
    }, 8000);

    return () => {
      clearTimeout(slowHint);
      clearTimeout(timeout);
    };
  }, [backendProfile, hasLoadError, queryPaused, isDemoMode]);

  const handleRetry = useCallback(() => {
    setHasLoadError(false);
    setQueryPaused(true);
    requestAnimationFrame(() => {
      if (mountedRef.current) {
        setQueryPaused(false);
      }
    });
  }, []);

  // Resolve data from backend only in live mode
  const displayName = useMemo(() => {
    if (isDemoMode) return demoUser?.name || 'Anonymous';
    return backendProfile?.displayName?.trim() || 'Anonymous';
  }, [backendProfile?.displayName, demoUser, isDemoMode]);

  const age = useMemo(() => {
    if (isDemoMode) {
      return demoUser?.dateOfBirth ? calculateAgeFromDOB(demoUser.dateOfBirth) : 0;
    }
    // Backend source of truth only
    return backendProfile?.age || 0;
  }, [backendProfile?.age, demoUser, isDemoMode]);

  // Get main photo URL + index for avatar
  // P0-1: Track the source index so blur flag is read from the matching slot,
  // not always slot 0 (which can mismatch when earlier slots are invalid).
  const mainPhotoEntry = useMemo(() => {
    const photos = isDemoMode
      ? (demoUser?.photos?.map((p) => p.url) || [])
      : (backendProfile?.privatePhotoUrls || []);

    for (let i = 0; i < photos.length; i++) {
      if (isValidPhotoUrl(photos[i])) {
        return { url: photos[i], index: i };
      }
    }
    return null;
  }, [backendProfile?.privatePhotoUrls, demoUser, isDemoMode]);

  const isMainPhotoBlurred = useMemo(() => {
    if (isDemoMode) return false;
    if (!backendProfile) return false;
    if (!mainPhotoEntry) return false;
    const { photoBlurEnabled, photoBlurSlots } = hydratePhotoBlurSettings(backendProfile);
    return Boolean(photoBlurEnabled && photoBlurSlots[mainPhotoEntry.index]);
  }, [backendProfile, isDemoMode, mainPhotoEntry]);

  const resolvedName = useMemo(() => {
    if (displayName && displayName.trim().length > 0) {
      return displayName;
    }
    return 'Anonymous';
  }, [displayName]);

  const resolvedAge = useMemo(() => {
    if (age && age > 0) return age;
    return 0;
  }, [age]);

  const photoCount = useMemo(() => {
    if (isDemoMode) {
      return (demoUser?.photos?.map((photo) => photo.url).filter(isValidPhotoUrl) || []).length;
    }
    return (backendProfile?.privatePhotoUrls || []).filter(isValidPhotoUrl).length;
  }, [backendProfile?.privatePhotoUrls, demoUser, isDemoMode]);

  const hasBio = useMemo(() => {
    if (isDemoMode) {
      return false;
    }
    return Boolean(backendProfile?.privateBio?.trim());
  }, [backendProfile?.privateBio, isDemoMode]);

  const promptSectionStatus = useMemo(() => {
    if (isDemoMode) return { s1: 0, s2: 0, s3: 0, complete: false };

    const answered = new Map<string, string>(
      (backendProfile?.promptAnswers || [])
        .filter((a) => typeof a?.promptId === 'string' && typeof a?.answer === 'string')
        .map((a) => [a.promptId, a.answer.trim()])
    );

    const isValidText = (v: string) =>
      v.length >= PHASE2_PROMPT_MIN_TEXT_LENGTH &&
      v.length <= PHASE2_PROMPT_MAX_TEXT_LENGTH;

    const s1 = PHASE2_SECTION1_PROMPTS.filter((p) => (answered.get(p.id) || '').length > 0).length;
    const s2 = PHASE2_SECTION2_PROMPTS.filter((p) => isValidText(answered.get(p.id) || '')).length;
    const s3 = PHASE2_SECTION3_PROMPTS.filter((p) => isValidText(answered.get(p.id) || '')).length;

    return { s1, s2, s3, complete: s1 === 3 && s2 >= 1 && s3 >= 1 };
  }, [backendProfile?.promptAnswers, isDemoMode]);

  const hasIntentSelection = useMemo(() => {
    if (isDemoMode) {
      return false;
    }
    return (backendProfile?.privateIntentKeys?.length || 0) > 0;
  }, [backendProfile?.privateIntentKeys, isDemoMode]);

  // P0-2: Backend is canonical for gender (no store fallback, no `as any`).
  const gender = useMemo(() => {
    if (isDemoMode) return '';
    return (backendProfile?.gender || '').trim();
  }, [backendProfile?.gender, isDemoMode]);

  // Cast to access optional schema fields
  const profileWithDetails = backendProfile as typeof backendProfile & {
    height?: number;
    weight?: number;
    smoking?: string;
    drinking?: string;
    education?: string;
    religion?: string;
    hobbies?: string[];
    gender?: string;
  };

  // P3-3: Completion checklist. The 12 `hidden: false` items are the ones
  // shown to the user, used for the % bar, the "Missing: …" nudge, and the
  // `isProfileReady` gate. Weight + Religion are kept here as `hidden: true`
  // so the data is still tracked for analytics, but they do NOT count toward
  // % and do NOT block readiness (otherwise the visible checklist would say
  // "complete" while readiness silently failed on hidden fields).
  const completionItems = useMemo(() => ([
    // Core identity (always complete after onboarding)
    {
      label: 'Nickname',
      complete: !!displayName?.trim() && displayName !== 'Anonymous',
      detail: displayName?.trim() ? 'Set' : 'Add a nickname',
      hidden: false,
    },
    {
      label: 'Age',
      complete: age > 0,
      detail: age > 0 ? `${age} years` : 'Add your age',
      hidden: false,
    },
    {
      label: 'Gender',
      complete: !!gender?.trim(),
      detail: gender ? 'Set' : 'Add your gender',
      hidden: false,
    },
    // Photos & Content
    {
      label: 'Photos',
      complete: photoCount >= 2,
      detail: photoCount >= 2 ? `${photoCount} added` : `Add at least 2 photos (${photoCount}/2)`,
      hidden: false,
    },
    {
      label: 'Bio',
      complete: hasBio,
      detail: hasBio ? 'Added' : 'Add a short bio',
      hidden: false,
    },
    {
      label: 'Prompts',
      complete: promptSectionStatus.complete,
      detail: promptSectionStatus.complete
        ? 'Answered'
        : `Quick ${promptSectionStatus.s1}/3 · Values ${promptSectionStatus.s2}/1 · Personality ${promptSectionStatus.s3}/1`,
      hidden: false,
    },
    {
      label: 'Looking for',
      complete: hasIntentSelection,
      detail: hasIntentSelection ? 'Selected' : 'Choose what you are looking for',
      hidden: false,
    },
    // Visible details (shown in DeepConnect profile)
    {
      label: 'Height',
      complete: typeof profileWithDetails?.height === 'number' && profileWithDetails.height > 0,
      detail: profileWithDetails?.height ? `${profileWithDetails.height} cm` : 'Add your height',
      hidden: false,
    },
    {
      label: 'Smoking',
      complete: typeof profileWithDetails?.smoking === 'string' && profileWithDetails.smoking.length > 0,
      detail: profileWithDetails?.smoking ? 'Set' : 'Add smoking preference',
      hidden: false,
    },
    {
      label: 'Drinking',
      complete: typeof profileWithDetails?.drinking === 'string' && profileWithDetails.drinking.length > 0,
      detail: profileWithDetails?.drinking ? 'Set' : 'Add drinking preference',
      hidden: false,
    },
    {
      label: 'Education',
      complete: typeof profileWithDetails?.education === 'string' && profileWithDetails.education.length > 0,
      detail: profileWithDetails?.education ? 'Set' : 'Add your education',
      hidden: false,
    },
    {
      label: 'Interests',
      complete: (profileWithDetails?.hobbies?.length ?? 0) > 0,
      detail: (profileWithDetails?.hobbies?.length ?? 0) > 0 ? `${profileWithDetails?.hobbies?.length} selected` : 'Add your interests',
      hidden: false,
    },
    // Hidden details (kept for analytics; do NOT count toward % or readiness)
    {
      label: 'Weight',
      complete: typeof profileWithDetails?.weight === 'number' && profileWithDetails.weight > 0,
      detail: profileWithDetails?.weight ? `${profileWithDetails.weight} kg` : 'Add your weight',
      hidden: true,
    },
    {
      label: 'Religion',
      complete: typeof profileWithDetails?.religion === 'string' && profileWithDetails.religion.length > 0,
      detail: profileWithDetails?.religion ? 'Set' : 'Add your religion',
      hidden: true,
    },
  ]), [
    displayName,
    age,
    gender,
    profileWithDetails,
    hasBio,
    hasIntentSelection,
    photoCount,
    promptSectionStatus,
  ]);

  // P3-3: Single source of truth for "missing" — visible items only. Hidden
  // items (weight/religion) are intentionally excluded from %, readiness, and
  // the "Missing: …" nudge so they all stay consistent with the visible list.
  const visibleMissingItems = useMemo(
    () => completionItems.filter((item) => !item.complete && !item.hidden),
    [completionItems]
  );

  const completionPercentage = useMemo(() => {
    const visible = completionItems.filter((i) => !i.hidden);
    const total = visible.length || 1;
    const completed = visible.filter((i) => i.complete).length;
    return Math.round((completed / total) * 100);
  }, [completionItems]);

  const completionNudge = useMemo(() => {
    // One concise improvement message (premium-style) - only show visible items
    const next = visibleMissingItems[0]?.label;
    switch (next) {
      case 'Photos':
        return photoCount > 0 ? 'Add more photos to improve your profile' : 'Add photos to improve your profile';
      case 'Bio':
        return 'Add a bio to improve your profile';
      case 'Prompts':
        return 'Answer a prompt to strengthen your profile';
      case 'Looking for':
        return "Choose what you're looking for";
      case 'Height':
      case 'Smoking':
      case 'Drinking':
      case 'Education':
        return 'Complete your details for better matches';
      case 'Interests':
        return 'Add interests to find like-minded people';
      case 'Nickname':
        return 'Add a nickname to personalize your profile';
      default:
        // P3-3: All visible items complete. Hidden items (weight/religion)
        // don't affect % or readiness, so the user is done.
        return 'Your private profile is ready';
    }
  }, [visibleMissingItems, photoCount]);

  const isProfileReady = useMemo(() => {
    if (isDemoMode) {
      return true;
    }
    // P3-3: Readiness must match the visible checklist. The % bar already
    // ignores hidden items, so requiring hidden items here would let users
    // hit "100% complete" yet stay flagged as not-ready.
    return Boolean(backendProfile?.isSetupComplete) && visibleMissingItems.length === 0;
  }, [backendProfile?.isSetupComplete, isDemoMode, visibleMissingItems.length]);

  // Navigate to Edit Profile
  const handleEditProfile = () => {
    router.push('/(main)/(private)/edit-profile' as any);
  };

  /** Deep Connect intents live on discovery-preferences (Phase-2), not edit-profile */
  const handleOpenPhase2DiscoveryPreferences = useCallback(() => {
    router.push({
      pathname: '/(main)/discovery-preferences',
      params: { mode: 'phase2' },
    } as any);
  }, [router]);

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Ionicons name="person-circle" size={24} color={C.primary} />
          <Text style={styles.headerTitle}>My Private Profile</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
          {showSlowNetworkHint ? (
            // P3-3: hitSlop widens the touch target on small text without
            // changing visual layout. accessibilityRole exposes it as a button.
            <TouchableOpacity
              onPress={handleRetry}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Retry loading profile"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.slowNetworkHint}>Still loading — tap to retry</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  if (isSignedOut) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Ionicons name="person-circle" size={24} color={C.primary} />
          <Text style={styles.headerTitle}>My Private Profile</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="person-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.errorTitle}>Sign in required</Text>
          <Text style={styles.errorText}>Please sign in again to load your private profile.</Text>
        </View>
      </View>
    );
  }

  // Error state
  if (hasLoadError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Ionicons name="person-circle" size={24} color={C.primary} />
          <Text style={styles.headerTitle}>My Private Profile</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={48} color={C.textLight} />
          <Text style={styles.errorTitle}>Unable to load profile</Text>
          <Text style={styles.errorText}>Please check your connection and try again.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isMissingProfile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Ionicons name="person-circle" size={24} color={C.primary} />
          <Text style={styles.headerTitle}>My Private Profile</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="person-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.errorTitle}>Private profile unavailable</Text>
          <Text style={styles.errorText}>
            We couldn&apos;t find your saved private profile data. Complete setup or try again after reconnecting.
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="person-circle" size={24} color={C.primary} />
        <Text style={styles.headerTitle}>My Private Profile</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header Section */}
        <View style={styles.profileHeader}>
          {/* Main Photo */}
          {mainPhotoEntry ? (
            <View style={styles.avatarContainer}>
              <Image
                source={{ uri: mainPhotoEntry.url }}
                style={styles.avatarImage}
                contentFit="cover"
                blurRadius={isMainPhotoBlurred ? 8 : 0}
                transition={200}
              />
            </View>
          ) : (
            <View style={styles.avatarEmpty}>
              <Ionicons name="person" size={50} color={C.textLight} />
            </View>
          )}

          {/* Name and Age */}
          <View style={styles.nameSection}>
            <View style={styles.nameRow}>
              <Text style={styles.nameText}>{resolvedName}</Text>
              {resolvedAge > 0 && <Text style={styles.ageText}>, {resolvedAge}</Text>}
            </View>
            <View style={styles.labelRow}>
              <Ionicons name="eye-off" size={14} color={C.primary} />
              <Text style={styles.labelText}>Private Profile</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.completionCard}
          onPress={handleEditProfile}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Profile completion ${completionPercentage} percent. Tap to edit.`}
        >
          <View style={styles.completionTopRow}>
            <View style={styles.completionIcon}>
              <Ionicons name="sparkles" size={18} color={C.primary} />
            </View>
            <View style={styles.completionCopy}>
              <Text style={styles.completionTitle}>{completionPercentage}% complete</Text>
              <Text style={styles.completionSubtitle} numberOfLines={1}>
                {completionPercentage >= 100 ? 'Your private profile is ready.' : completionNudge}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.textLight} />
          </View>

          <View style={styles.completionProgressOuter}>
            <View
              style={[
                styles.completionProgressInner,
                { width: `${Math.max(0, Math.min(100, completionPercentage))}%` },
              ]}
            />
          </View>

          {!isProfileReady && visibleMissingItems.length > 0 ? (
            <View>
              <Text style={styles.completionHint} numberOfLines={1}>
                Tap to edit your private profile
              </Text>
              {/* P3-3: Only list visible items so the "Missing: …" copy stays
                  consistent with the % bar and the visible checklist. */}
              {visibleMissingItems.length <= 4 && (
                <Text style={styles.completionMissingList} numberOfLines={2}>
                  Missing: {visibleMissingItems.map((i) => i.label).join(', ')}
                </Text>
              )}
            </View>
          ) : null}
        </TouchableOpacity>

        {/* Settings Menu */}
        {/* P3-3: Each row exposes accessibilityRole="button" + a stable label
            for screen readers. Row height (~56px) already meets the 44pt
            touch-target minimum so no extra hitSlop is needed. */}
        <View style={styles.menuSection}>
          {/* 1. Edit Profile */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={handleEditProfile}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Edit Profile"
            accessibilityHint="Opens the full edit profile screen"
          >
            <Ionicons name="create-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          {/* 2. Privacy */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.push('/(main)/(private)/settings/private-privacy' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Privacy"
            accessibilityHint="Opens privacy settings"
          >
            <Ionicons name="lock-closed-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Privacy</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          {/* 3. Notifications */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.push('/(main)/(private)/settings/private-notifications' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            accessibilityHint="Opens notification preferences"
          >
            <Ionicons name="notifications-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Notifications</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          {/* 4. Safety */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.push('/(main)/(private)/settings/private-safety' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Safety"
            accessibilityHint="Opens safety settings"
          >
            <Ionicons name="shield-checkmark-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Safety</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          {/* 5. Account */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.push('/(main)/(private)/settings/private-account' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Account"
            accessibilityHint="Opens account settings"
          >
            <Ionicons name="person-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Account</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          {/* 6. Support & FAQ */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.push('/(main)/(private)/settings/private-support' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Support and FAQ"
            accessibilityHint="Opens support and frequently asked questions"
          >
            <Ionicons name="help-circle-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Support & FAQ</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    flex: 1,
    marginLeft: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },

  // Profile Header
  profileHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarContainer: {
    width: MAIN_PHOTO_SIZE,
    height: MAIN_PHOTO_SIZE,
    borderRadius: MAIN_PHOTO_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: C.accent,
    borderWidth: 3,
    borderColor: C.primary,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarEmpty: {
    width: MAIN_PHOTO_SIZE,
    height: MAIN_PHOTO_SIZE,
    borderRadius: MAIN_PHOTO_SIZE / 2,
    backgroundColor: C.surface,
    borderWidth: 3,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameSection: {
    alignItems: 'center',
    marginTop: 16,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  nameText: {
    fontSize: 26,
    fontWeight: '700',
    color: C.text,
  },
  ageText: {
    fontSize: 22,
    fontWeight: '400',
    color: C.text,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  labelText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
  },

  // Premium completion card (Phase-1 quality, Phase-2 theme)
  completionCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  completionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  completionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionCopy: {
    flex: 1,
  },
  completionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: C.text,
    letterSpacing: -0.2,
  },
  completionSubtitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
  },
  completionProgressOuter: {
    marginTop: 12,
    height: 8,
    backgroundColor: C.accent,
    borderRadius: 4,
    overflow: 'hidden',
  },
  completionProgressInner: {
    height: '100%',
    backgroundColor: C.primary,
    borderRadius: 4,
  },
  completionHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '600',
    color: C.textLight,
  },
  completionMissingList: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '500',
    color: C.primary,
    fontStyle: 'italic',
  },
  statusCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  statusIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  statusIconReady: {
    backgroundColor: C.primary,
  },
  statusIconNeedsWork: {
    backgroundColor: C.textLight,
  },
  statusCopy: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 20,
    color: C.textLight,
    marginTop: 4,
  },
  checklist: {
    marginTop: 16,
    gap: 12,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checklistRowTappable: {
    alignItems: 'center',
  },
  checklistCopy: {
    flex: 1,
  },
  checklistLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  checklistDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: C.textLight,
    marginTop: 2,
  },
  statusAction: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  statusActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
  },

  // Menu Section
  menuSection: {
    marginTop: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  menuText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginLeft: 12,
  },

  // Loading/Error States
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
    color: C.textLight,
  },
  slowNetworkHint: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    marginTop: 8,
  },
  errorText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: C.primary,
    borderRadius: 24,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
