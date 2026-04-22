/*
 * LOCKED (PROFILE TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { safePush, safeReplace } from '@/lib/safeRouter';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, FONT_SIZE, SPACING, SIZES, lineHeight, moderateScale } from '@/lib/constants';
import { Avatar } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { usePrivacyStore } from '@/stores/privacyStore';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useScreenTrace } from '@/lib/devTrace';
import { ProfileCompletionCard } from '@/components/profile/ProfileCompletionCard';

/**
 * Calculate age from DOB string ("YYYY-MM-DD").
 * Returns null for invalid/missing DOB to avoid false adult age display.
 * SAFETY: Never default to a fake age — could bypass age verification.
 */
function calculateAge(dob: string | undefined | null): number | null {
  // Reject missing or malformed DOB — do NOT default to a fake date
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return null;
  }
  const [y, m, d] = dob.split("-").map(Number);
  // Parse to local Date at noon to avoid DST edge cases
  const birthDate = new Date(y, m - 1, d, 12, 0, 0);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

const TEXT_MAX_SCALE = 1.2;
const TEXT_PROPS = { maxFontSizeMultiplier: TEXT_MAX_SCALE } as const;
const HEADER_TITLE_SIZE = FONT_SIZE.h2;
const PROFILE_NAME_SIZE = FONT_SIZE.title;
const PROFILE_BIO_SIZE = moderateScale(15, 0.4);
const MODAL_BODY_SIZE = moderateScale(15, 0.4);
const STATUS_BUTTON_TEXT_SIZE = FONT_SIZE.body2;
const MENU_TEXT_SIZE = FONT_SIZE.lg;
const FAILURE_ICON_SIZE = moderateScale(44, 0.3);
const PROFILE_ICON_SIZE = SIZES.icon.lg;
const CHEVRON_ICON_SIZE = SIZES.icon.md;
const STATUS_ICON_SIZE = SIZES.icon.sm;
const MODAL_STATUS_ICON_SIZE = SIZES.icon.xl;
const PHOTO_PREVIEW_CLOSE_ICON_SIZE = moderateScale(28, 0.25);
const AVATAR_BORDER_WIDTH = moderateScale(4, 0.25);
const LOADING_AVATAR_SIZE = moderateScale(96, 0.25);
const VERIFICATION_MODAL_RADIUS = moderateScale(20, 0.25);
const VERIFICATION_MODAL_MAX_WIDTH = moderateScale(340, 0.25);
const VERIFICATION_MODAL_ICON_SIZE = moderateScale(60, 0.25);

export default function ProfileScreen() {
  useScreenTrace("PROFILE");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const avatarSize = useMemo(
    () => Math.max(
      moderateScale(112, 0.25),
      Math.min(windowWidth * 0.32, moderateScale(124, 0.25))
    ),
    [windowWidth]
  );
  const avatarStyle = useMemo(
    () => ({
      width: avatarSize,
      height: avatarSize,
      borderRadius: avatarSize / 2,
    }),
    [avatarSize]
  );
  const scrollContentStyle = useMemo(
    () => ({
      paddingBottom: SPACING.xxxl + insets.bottom,
    }),
    [insets.bottom]
  );
  const photoPreviewCloseButtonStyle = useMemo(
    () => ({
      top: Math.max(insets.top + SPACING.base, SPACING.xl),
      right: SPACING.base,
    }),
    [insets.top]
  );

  // PERF: Track screen focus time for photo load measurement
  const focusTimeRef = React.useRef(0);
  const hasLoggedPhotoLoad = React.useRef(false);

  // FIX C: Force re-render when navigating back from Edit Profile
  const [refreshKey, setRefreshKey] = useState(0);
  useFocusEffect(
    useCallback(() => {
      // PERF: Mark focus time for instrumentation
      if (__DEV__) {
        focusTimeRef.current = Date.now();
        hasLoggedPhotoLoad.current = false;
      }
      // Increment key to force re-read of demoStore/convex data
      setRefreshKey((k) => k + 1);
    }, [])
  );

  // FIX C: Subscribe to demoStore photos reactively (so changes trigger re-render)
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  // FIX D: Subscribe to hydration status to re-render when hydration completes
  const demoHydrated = useDemoStore((s) => s._hasHydrated);

  // FIX: Use getCurrentUser with userId instead of getCurrentUserProfileState with token
  const currentUserData = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId } : 'skip'
  );
  const convexUser = !isDemoMode ? (currentUserData ?? undefined) : undefined;
  const isCurrentUserLoading = !isDemoMode && !!userId && currentUserData === undefined;

  // Admin check for showing admin menu
  // FIX: Use checkIsAdmin with userId instead of checkCurrentUserIsAdmin with token
  const adminCheck = useQuery(
    api.users.checkIsAdmin,
    !isDemoMode && userId ? { userId } : 'skip'
  );
  const isAdmin = adminCheck?.isAdmin === true;

  // Query verification status for details (date, pending session)
  // FIX: Backend expects { userId }, not { token }
  const verificationDetails = useQuery(
    api.verification.getVerificationStatus,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  // CONSISTENCY FIX: Use same photo source as Edit Profile (api.photos.getUserPhotos)
  // This ensures Profile Tab shows the SAME photos as Edit Profile grid
  // FIX: Use getUserPhotos with userId instead of getCurrentUserPhotos with token
  const backendPhotos = useQuery(
    api.photos.getUserPhotos,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  // HYDRATION FIX: Distinguish loading vs empty to prevent flicker
  // - backendPhotos === undefined → loading (query not yet resolved)
  // - backendPhotos is array (even empty) → loaded
  const isPhotosLoading = !isDemoMode && backendPhotos === undefined;

  // HYDRATION FIX: Keep last valid photos to prevent flicker during re-fetch
  // CRITICAL: This ref MUST persist across renders to provide stable fallback
  const lastValidPhotosRef = React.useRef<typeof backendPhotos>(undefined);
  const hydrationStartRef = React.useRef<number>(0);

  // Update last valid photos BEFORE computing effectivePhotos
  // Use layout effect to ensure ref is updated before render computations
  if (!isDemoMode && backendPhotos !== undefined && backendPhotos !== lastValidPhotosRef.current) {
    lastValidPhotosRef.current = backendPhotos;
  }

  // EFFECTIVE PHOTOS: THE authoritative source for all photo logic
  // RULE: During loading, NEVER return null/empty if we have cached data
  // This prevents UI from showing incorrect empty state during hydration
  const effectivePhotos = React.useMemo(() => {
    if (isDemoMode) {
      return undefined; // Demo mode uses currentUser.photos directly
    }
    // CRITICAL: Use lastValidPhotos during loading to prevent flicker
    if (isPhotosLoading) {
      // Return cached data if available, undefined only if truly first load
      return lastValidPhotosRef.current;
    }
    // Not loading - use actual backend data
    return backendPhotos;
  }, [isDemoMode, isPhotosLoading, backendPhotos]);

  // Track if we have any cached photos (for render guards)
  const hasCachedPhotos = lastValidPhotosRef.current !== undefined && lastValidPhotosRef.current.length > 0;

  // Track hydration timing
  React.useEffect(() => {
    if (isPhotosLoading && hydrationStartRef.current === 0) {
      hydrationStartRef.current = Date.now();
      if (__DEV__) {
        console.log('[ProfileTab] ⏳ Photo hydration started', {
          hasCachedPhotos,
          cachedCount: lastValidPhotosRef.current?.length ?? 0,
        });
      }
    }
    if (!isPhotosLoading && hydrationStartRef.current > 0) {
      const hydrationTime = Date.now() - hydrationStartRef.current;
      if (__DEV__) {
        console.log('[ProfileTab] ✅ Photo hydration complete:', {
          hydrationTimeMs: hydrationTime,
          photoCount: backendPhotos?.length ?? 0,
        });
      }
      hydrationStartRef.current = 0;
    }
  }, [isPhotosLoading, backendPhotos?.length, hasCachedPhotos]);

  // 3A1-2: Server-side logout mutation
  const serverLogout = useMutation(api.auth.logout);

  // FIX C: Extract photos robustly from any format, preserving isBlurred for backend blur
  const extractPhotos = (user: any): { url: string; isPrimary: boolean; isBlurred?: boolean; order?: number }[] => {
    if (!user) return [];

    // Try user.photos first (most common)
    let rawPhotos = user.photos;

    // Fallback to user.photoUrls if photos doesn't exist
    if (!rawPhotos?.length && user.photoUrls?.length) {
      rawPhotos = user.photoUrls;
    }

    // P1-013 FIX: Guard against non-array values with length property
    if (!rawPhotos?.length || !Array.isArray(rawPhotos)) return [];

    return rawPhotos
      .map((p: any, i: number): { url: string; isPrimary: boolean; isBlurred?: boolean; order?: number } | null => {
        // Handle string URLs directly
        if (typeof p === 'string') {
          return { url: p, isPrimary: i === 0 };
        }
        // Handle { url: string } objects - preserve isBlurred and order from backend
        // ORDER-BASED PRIMARY: First photo (i === 0) is always primary (order is source of truth)
        if (p?.url) {
          const result: { url: string; isPrimary: boolean; isBlurred?: boolean; order?: number } = {
            url: p.url,
            // ORDER IS SOURCE OF TRUTH: First photo in sorted array is primary
            isPrimary: i === 0,
          };
          if (typeof p.isBlurred === 'boolean') result.isBlurred = p.isBlurred;
          if (typeof p.order === 'number') result.order = p.order;
          return result;
        }
        return null;
      })
      .filter((p): p is { url: string; isPrimary: boolean; isBlurred?: boolean; order?: number } => p !== null && !!p.url);
  };

  // BUGFIX #26: Build currentUser reactively from subscribed demoProfiles
  // Use demoProfiles[currentDemoUserId] directly instead of getDemoCurrentUser() for reactivity
  const demoUserProfile = isDemoMode && currentDemoUserId && demoHydrated
    ? demoProfiles[currentDemoUserId]
    : null;
  const demoUserBase = isDemoMode ? getDemoCurrentUser() : null;

  const currentUser = isDemoMode
    ? demoUserProfile || demoUserBase
      ? {
          name: demoUserProfile?.name ?? demoUserBase?.name ?? '',
          dateOfBirth: demoUserProfile?.dateOfBirth ?? demoUserBase?.dateOfBirth ?? '',
          bio: demoUserProfile?.bio ?? demoUserBase?.bio ?? '',
          gender: demoUserProfile?.gender ?? demoUserBase?.gender ?? '',
          isVerified: demoUserBase?.isVerified ?? false,
          // BUGFIX #26: Use reactive demoUserProfile.photos first, then fall back
          photos: extractPhotos(demoUserProfile ?? demoUserBase),
          // Use existing blur fields from demoUser (if any exist)
          blurMyPhoto: (demoUserBase as any)?.blurMyPhoto,
          blurPhoto: (demoUserBase as any)?.blurPhoto,
          blurEnabled: (demoUserBase as any)?.blurEnabled,
          photoVisibilityBlur: (demoUserBase as any)?.photoVisibilityBlur,
        }
      : null
    : convexUser
      ? {
          ...convexUser,
          photos: extractPhotos(convexUser),
        }
      : null;
  const hasCurrentUserFailure = !isDemoMode && !isCurrentUserLoading && !currentUser;

  const handleProfileRetry = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleProfileRecovery = useCallback(async () => {
    if (!token || !currentUserData) {
      await logout();
      safeReplace(router, '/(auth)/welcome', 'profile->auth-recovery');
      return;
    }
    safeReplace(router, '/(main)/(tabs)/home', 'profile->load-recovery');
  }, [logout, currentUserData, router, token]);

  // MAIN PHOTO SOURCE OF TRUTH:
  // PRIMARY PHOTO = api.photos.getUserPhotos()[0]
  //
  // This is the EXACT same expression Confess comment identity uses. No
  // filtering, no reordering, no `isPrimary` re-selection, and — crucially —
  // no hydration-cache indirection. The previous implementation routed this
  // through `effectivePhotos`, which falls back to `lastValidPhotosRef.current`
  // during subscription transitions; that cache can hold a STALE photo URL
  // when the user has changed their primary photo, causing Profile UI to
  // diverge from Confess comments. Reading `backendPhotos[0]` directly keeps
  // Profile in lockstep with Convex and with Confess.
  const mainPhotoUrl = React.useMemo(() => {
    if (isDemoMode) {
      return currentUser?.photos?.[0]?.url || null;
    }

    const mainPhoto = backendPhotos?.[0];

    if (__DEV__) {
      console.log('[PROFILE_MAIN_PHOTO_DEBUG]', {
        selectedPhotoId: (mainPhoto as any)?._id ?? null,
        selectedPhotoUrl: mainPhoto?.url ? mainPhoto.url.slice(-30) : null,
        sourceUsed: 'api.photos.getUserPhotos[0]',
        indexUsed: 0,
        totalPhotos: backendPhotos?.length ?? 0,
      });
    }

    return mainPhoto?.url || null;
  }, [isDemoMode, currentUser?.photos, backendPhotos]);

  // PER-PHOTO BLUR CHECK: Read from backend photo.isBlurred field (source of truth)
  // Edit Profile persists blur state to Convex on Save via api.photos.setPhotosBlur
  // HYDRATION FIX: Use effectivePhotos to prevent flicker during loading
  const mainPhotoIsBlurred = React.useMemo(() => {
    if (isDemoMode) {
      // Demo mode: check first photo's isBlurred field
      const firstPhoto = currentUser?.photos?.[0];
      return firstPhoto?.isBlurred === true;
    }
    // Live mode: Use effectivePhotos (cached during loading)
    if (!effectivePhotos?.length) {
      return false;
    }
    // SINGLE SOURCE OF TRUTH: First photo (index 0) is always main
    const mainPhoto = effectivePhotos[0];
    return mainPhoto?.isBlurred === true;
  }, [isDemoMode, currentUser?.photos, effectivePhotos]);

  // PERF: Prefetch top photos after hydration (only when not loading)
  // HYDRATION FIX: Use effectivePhotos for live mode, currentUser.photos for demo mode
  React.useEffect(() => {
    // Skip prefetch during loading to avoid wasted work
    if (isPhotosLoading) return;

    const photos = isDemoMode ? currentUser?.photos : effectivePhotos;
    if (photos && photos.length > 0) {
      const topPhotos = photos.slice(0, Math.min(6, photos.length));
      topPhotos.forEach((photo: any) => {
        if (photo.url) {
          Image.prefetch(photo.url).catch(() => {
            // Silently ignore prefetch errors
          });
        }
      });
      if (__DEV__) {
        console.log('[PERF ProfileTab] Prefetching', topPhotos.length, 'photos');
      }
    }
  }, [isDemoMode, currentUser?.photos, effectivePhotos, isPhotosLoading]);

  // Global blur feature toggle (enables per-photo blur controls, does NOT mean "blur all")
  const blurFeatureEnabled = Boolean((currentUser as any)?.photoBlurred ?? false);

  // __DEV__ LOG: Blur state tracing
  if (__DEV__) {
    console.log('[ProfileTab] 🔒 Blur state:', {
      photoBlurred: (currentUser as any)?.photoBlurred,
      blurFeatureEnabled,
      mainPhotoIsBlurred,
      userId: userId?.slice(-8),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICATION STATUS - Computed display info
  // ═══════════════════════════════════════════════════════════════════════════
  const verificationStatusInfo = useMemo(() => {
    // Demo mode: use isVerified flag
    if (isDemoMode) {
      return {
        status: currentUser?.isVerified ? 'verified' : 'unverified',
        label: currentUser?.isVerified ? 'Verified' : 'Not Verified',
        icon: currentUser?.isVerified ? 'checkmark-circle' : 'alert-circle-outline',
        color: currentUser?.isVerified ? COLORS.success : COLORS.textMuted,
        bgColor: currentUser?.isVerified ? COLORS.successSubtle : COLORS.backgroundDark,
        buttonLabel: currentUser?.isVerified ? 'View Status' : 'Verify Now',
        date: null,
      } as const;
    }

    // Live mode: use verificationDetails from backend
    const status = verificationDetails?.status || (convexUser as any)?.verificationStatus || 'unverified';
    const completedAt = verificationDetails?.completedAt;

    // Format date if available
    let dateLabel: string | null = null;
    if (completedAt && status === 'verified') {
      const date = new Date(completedAt);
      dateLabel = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    if (status === 'verified') {
      return {
        status: 'verified',
        label: dateLabel ? `Verified (${dateLabel})` : 'Verified',
        icon: 'checkmark-circle',
        color: COLORS.success,
        bgColor: COLORS.successSubtle,
        buttonLabel: 'View Status',
        date: dateLabel,
      } as const;
    } else if (status === 'pending_verification' || status === 'pending') {
      return {
        status: 'pending',
        label: 'Pending Review',
        icon: 'time-outline',
        color: COLORS.warning,
        bgColor: COLORS.warningSubtle,
        buttonLabel: 'Check Status',
        date: null,
      } as const;
    } else {
      return {
        status: 'unverified',
        label: 'Not Verified',
        icon: 'alert-circle-outline',
        color: COLORS.textMuted,
        bgColor: COLORS.backgroundDark,
        buttonLabel: 'Verify Now',
        date: null,
      } as const;
    }
  }, [isDemoMode, currentUser?.isVerified, verificationDetails, convexUser]);

  // Preview toggle state (UI only, doesn't change settings)
  const [previewBlur, setPreviewBlur] = useState(false);

  // Full-screen photo preview state
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);

  // Verification details modal state
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  // P2-033 FIX: Track main photo load error to show fallback
  const [mainPhotoError, setMainPhotoError] = useState(false);

  // P2-033 FIX: Reset error state when photo URL changes
  React.useEffect(() => {
    setMainPhotoError(false);
  }, [mainPhotoUrl]);

  if (__DEV__) {
    // PHOTO_SOURCE_AUDIT: Unified source for all photo displays
    // Live mode: api.photos.getUserPhotos (excludes verification_reference)
    // Demo mode: demoStore
    const resolvedPhotoCount = isDemoMode
      ? (currentUser?.photos?.length ?? 0)
      : (effectivePhotos?.length ?? 0);
    const source = isDemoMode ? 'demoStore' : 'api.photos.getUserPhotos (pre-filtered)';
    const photoIds = isDemoMode
      ? currentUser?.photos?.map((p: any) => p._id?.slice?.(-6) || 'local').join(',')
      : effectivePhotos?.map((p: any) => p._id?.slice(-6)).join(',');

    console.log('[PHOTO_SOURCE_AUDIT] [PROFILE_MAIN_PHOTO] Profile Tab loaded:', {
      source,
      totalRegularPhotos: resolvedPhotoCount,
      mainPhotoUrl: mainPhotoUrl?.slice(-30) || null,
      photoIds: photoIds || 'none',
      isPhotosLoading,
    });

    // Only log loading state if we're actually loading
    if (isPhotosLoading) {
      console.log('[ProfileTab] ⏳ Loading photos...', {
        usingCachedData: hasCachedPhotos,
        cachedCount: lastValidPhotosRef.current?.length ?? 0,
      });
    }

    if (isDemoMode) {
      console.warn('[ProfileTab] ⚠️ DEMO MODE - Using demoStore photos');
    }
  }

  // 3A1-2: Logout clears client + server + onboarding
  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          // SEC-3 FIX: Server logout FIRST (with timeout) to invalidate session
          // This ensures the token is invalidated server-side before we clear local state
          if (!isDemoMode && token && userId) {
            try {
              // Use Promise.race with 3s timeout - don't block UX indefinitely
              await Promise.race([
                serverLogout({ token, authUserId: userId }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
              ]);
              if (__DEV__) console.log('[Logout] Server session invalidated');
            } catch (e) {
              // Log but continue - local logout is more important for UX
              console.warn('[Logout] Server logout failed or timed out:', e);
            }
          }

          // Clear local state after server logout attempt
          if (isDemoMode) {
            useDemoStore.getState().demoLogout();
          }
          useOnboardingStore.getState().reset();
          // P0-002 FIX: Reset privacy store to prevent leaking settings to next user
          usePrivacyStore.getState().resetPrivacy();
          // H5 FIX: Await async logout to ensure SecureStore is cleared before navigation
          await logout();
          safeReplace(router, '/(auth)/welcome', 'profile->logout');
        },
      },
    ]);
  };

  if (isCurrentUserLoading) {
    return (
      <SafeAreaView edges={['top']} style={styles.container}>
        <View style={styles.loadingContainer}>
          <View style={styles.loadingAvatar} />
          <Text {...TEXT_PROPS} style={styles.loadingText}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (hasCurrentUserFailure) {
    const needsAuthRecovery = !token || !currentUserData;

    return (
      <SafeAreaView edges={['top']} style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="person-circle-outline" size={FAILURE_ICON_SIZE} color={COLORS.textMuted} />
          <Text {...TEXT_PROPS} style={styles.loadingText}>
            {needsAuthRecovery
              ? 'Please sign in again to open your profile.'
              : 'We couldn’t load your profile right now. Please try again.'}
          </Text>
          <TouchableOpacity
            style={styles.profileRetryButton}
            onPress={handleProfileRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading profile"
          >
            <Text {...TEXT_PROPS} style={styles.profileRetryButtonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleProfileRecovery}
            accessibilityRole="button"
            accessibilityLabel={needsAuthRecovery ? 'Go to Sign In' : 'Go Home'}
          >
            <Text {...TEXT_PROPS} style={styles.profileRecoveryText}>
              {needsAuthRecovery ? 'Go to Sign In' : 'Go Home'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentUser) {
    return (
      <SafeAreaView edges={['top']} style={styles.container}>
        <View style={styles.loadingContainer}>
          <View style={styles.loadingAvatar} />
          <Text {...TEXT_PROPS} style={styles.loadingText}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const age = calculateAge(currentUser.dateOfBirth);

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
    <ScrollView
      style={styles.scrollView}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={scrollContentStyle}
    >
      <View style={styles.header}>
        <Text {...TEXT_PROPS} style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity
          onPress={() => safePush(router, '/(main)/edit-profile', 'profile->edit')}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <Ionicons name="create-outline" size={PROFILE_ICON_SIZE} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.profileSection}>
        {/* Main photo - large with shadow, tappable for full-screen view */}
        {/* BLUR FIX: Apply soft blur (radius 8) when photoBlurred is true */}
        {/* P2-033 FIX: Show fallback Avatar if photo fails to load */}
        {mainPhotoUrl && !mainPhotoError ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setShowPhotoPreview(true)}
            accessibilityRole="imagebutton"
            accessibilityLabel="View profile photo full screen"
            style={styles.avatarContainer}
          >
            <Image
              source={{ uri: mainPhotoUrl }}
              style={[styles.avatar, avatarStyle]}
              contentFit="cover"
              transition={200}
              blurRadius={0}
              onLoadEnd={() => {
                // PERF: Log photo load time once per focus
                if (__DEV__ && !hasLoggedPhotoLoad.current && focusTimeRef.current > 0) {
                  const loadTime = Date.now() - focusTimeRef.current;
                  console.log('[PERF ProfileTab] Main photo loaded:', { loadTimeMs: loadTime, mainPhotoIsBlurred });
                  hasLoggedPhotoLoad.current = true;
                }
              }}
              onError={() => {
                // P2-033 FIX: Show fallback Avatar when image fails to load
                setMainPhotoError(true);
              }}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.avatarContainer}>
            <Avatar size={Math.round(avatarSize)} />
          </View>
        )}

        {/* Name + Age + Verified Badge (always visible, interactive) */}
        <View style={styles.nameRow}>
          <Text {...TEXT_PROPS} style={styles.name}>
            {currentUser.name}{age !== null ? `, ${age}` : ''}
          </Text>
          <TouchableOpacity
            onPress={() => setShowVerificationModal(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Verification status: ${verificationStatusInfo.label}. Tap for details.`}
          >
            <View style={[
              styles.verifiedInline,
              { backgroundColor: verificationStatusInfo.bgColor }
            ]}>
              <Ionicons
                name={verificationStatusInfo.icon as any}
                size={STATUS_ICON_SIZE}
                color={verificationStatusInfo.color}
              />
              <Text {...TEXT_PROPS} style={[
                styles.verifiedInlineText,
                { color: verificationStatusInfo.color }
              ]}>
                {verificationStatusInfo.status === 'verified' ? 'Verified' :
                 verificationStatusInfo.status === 'pending' ? 'Pending' : 'Unverified'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Bio */}
        {currentUser.bio && <Text {...TEXT_PROPS} style={styles.bio}>{currentUser.bio}</Text>}

        {/* REMOVED: Interests Section - per user request, interests should NOT appear on profile homepage */}
        {/* Interests are only shown/edited in the Edit Profile screen */}

        {/* Verification Status Row - Always Visible */}
        <View style={styles.verificationStatusRow}>
          <View style={styles.verificationStatusLeft}>
            <View style={[
              styles.verificationStatusDot,
              {
                backgroundColor: verificationStatusInfo.status === 'verified'
                  ? COLORS.success
                  : verificationStatusInfo.status === 'pending'
                    ? COLORS.warning
                    : COLORS.textMuted
              }
            ]} />
            <Text {...TEXT_PROPS} style={styles.verificationStatusLabel}>
              {verificationStatusInfo.label}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.verificationActionButton,
              verificationStatusInfo.status === 'verified' && styles.verificationActionButtonSecondary
            ]}
            onPress={() => safePush(router, '/(main)/verification', 'profile->verification')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={verificationStatusInfo.buttonLabel}
          >
            <Text {...TEXT_PROPS} style={[
              styles.verificationActionButtonText,
              verificationStatusInfo.status === 'verified' && styles.verificationActionButtonTextSecondary
            ]}>
              {verificationStatusInfo.buttonLabel}
            </Text>
          </TouchableOpacity>
        </View>

      </View>

      {/* Section divider */}
      <View style={styles.sectionDivider} />

{/* HIDDEN: Subscription UI temporarily removed per product rules */}

      {/* PROFILE COMPLETION - Compact card below photos, above menu */}
      <ProfileCompletionCard
        userData={{
          name: currentUser.name,
          dateOfBirth: currentUser.dateOfBirth,
          gender: currentUser.gender,
          isVerified: currentUser.isVerified,
          faceVerificationPassed: (currentUser as any).faceVerificationPassed,
          photos: isDemoMode ? currentUser.photos : effectivePhotos,
          bio: currentUser.bio,
          profilePrompts: (currentUser as any).profilePrompts,
          education: (currentUser as any).education,
          jobTitle: (currentUser as any).jobTitle,
          company: (currentUser as any).company,
          school: (currentUser as any).school,
          height: (currentUser as any).height,
          smoking: (currentUser as any).smoking,
          drinking: (currentUser as any).drinking,
          kids: (currentUser as any).kids,
          exercise: (currentUser as any).exercise,
          pets: (currentUser as any).pets,
          activities: (currentUser as any).activities,
          lifeRhythm: (currentUser as any).lifeRhythm,
        }}
        compact={true}
      />

      <View style={styles.menuSection}>
        {/* 1. Edit Profile */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/edit-profile', 'profile->editMenu')}
          accessibilityRole="button"
          accessibilityLabel="Edit Profile"
        >
          <Ionicons name="create-outline" size={PROFILE_ICON_SIZE} color={COLORS.text} />
          <Text {...TEXT_PROPS} style={styles.menuText}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 2. Privacy */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/privacy', 'profile->privacy')}
          accessibilityRole="button"
          accessibilityLabel="Privacy settings"
        >
          <Ionicons name="lock-closed-outline" size={PROFILE_ICON_SIZE} color={COLORS.text} />
          <Text {...TEXT_PROPS} style={styles.menuText}>Privacy</Text>
          <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 3. Notifications */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/notifications', 'profile->notifications')}
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
        >
          <Ionicons name="notifications-outline" size={PROFILE_ICON_SIZE} color={COLORS.text} />
          <Text {...TEXT_PROPS} style={styles.menuText}>Notifications</Text>
          <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 4. Safety */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/safety', 'profile->safety')}
          accessibilityRole="button"
          accessibilityLabel="Safety settings"
        >
          <Ionicons name="shield-checkmark-outline" size={PROFILE_ICON_SIZE} color={COLORS.text} />
          <Text {...TEXT_PROPS} style={styles.menuText}>Safety</Text>
          <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 5. Account */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/account', 'profile->account')}
          accessibilityRole="button"
          accessibilityLabel="Account settings"
        >
          <Ionicons name="person-outline" size={PROFILE_ICON_SIZE} color={COLORS.text} />
          <Text {...TEXT_PROPS} style={styles.menuText}>Account</Text>
          <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 6. Support & FAQ */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/support', 'profile->support')}
          accessibilityRole="button"
          accessibilityLabel="Support and FAQ"
        >
          <Ionicons name="help-circle-outline" size={PROFILE_ICON_SIZE} color={COLORS.text} />
          <Text {...TEXT_PROPS} style={styles.menuText}>Support & FAQ</Text>
          <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 7. Log Out */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
          accessibilityHint="Signs you out of Mira on this device."
        >
          <Ionicons name="log-out-outline" size={PROFILE_ICON_SIZE} color={COLORS.text} />
          <Text {...TEXT_PROPS} style={styles.menuText}>Log Out</Text>
          <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.textLight} />
        </TouchableOpacity>

        {isAdmin && (
          <>
            <TouchableOpacity
              style={[styles.menuItem, styles.adminMenuItem]}
              onPress={() => safePush(router, '/(main)/admin/verification', 'profile->adminVerification')}
            >
              <Ionicons name="shield-outline" size={PROFILE_ICON_SIZE} color={COLORS.primary} />
              <Text {...TEXT_PROPS} style={[styles.menuText, { color: COLORS.primary }]}>Admin: Verification Queue</Text>
              <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.adminMenuItem]}
              onPress={() => safePush(router, '/(main)/admin/logs', 'profile->adminLogs')}
            >
              <Ionicons name="document-text-outline" size={PROFILE_ICON_SIZE} color={COLORS.primary} />
              <Text {...TEXT_PROPS} style={[styles.menuText, { color: COLORS.primary }]}>Admin: Audit Logs</Text>
              <Ionicons name="chevron-forward" size={CHEVRON_ICON_SIZE} color={COLORS.primary} />
            </TouchableOpacity>
          </>
        )}
      </View>

    </ScrollView>

      {/* Full-screen photo preview modal */}
      <Modal
        visible={showPhotoPreview}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowPhotoPreview(false)}
      >
        <View style={styles.photoPreviewContainer}>
          <TouchableOpacity
            style={styles.photoPreviewCloseArea}
            activeOpacity={1}
            onPress={() => setShowPhotoPreview(false)}
            accessibilityRole="button"
            accessibilityLabel="Close photo preview"
          >
            {mainPhotoUrl && (
              <Image
                source={{ uri: mainPhotoUrl }}
                style={styles.photoPreviewImage}
                contentFit="contain"
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.photoPreviewCloseButton, photoPreviewCloseButtonStyle]}
            onPress={() => setShowPhotoPreview(false)}
            accessibilityLabel="Close full screen photo"
          >
            <Ionicons name="close" size={PHOTO_PREVIEW_CLOSE_ICON_SIZE} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Verification Details Modal */}
      <Modal
        visible={showVerificationModal}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setShowVerificationModal(false)}
      >
        <Pressable
          style={styles.verificationModalOverlay}
          onPress={() => setShowVerificationModal(false)}
        >
          <Pressable style={styles.verificationModalContent} onPress={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <View style={styles.verificationModalHeader}>
              <View style={[
                styles.verificationModalIcon,
                { backgroundColor: verificationStatusInfo.bgColor }
              ]}>
                <Ionicons
                  name={verificationStatusInfo.icon as any}
                  size={MODAL_STATUS_ICON_SIZE}
                  color={verificationStatusInfo.color}
                />
              </View>
              <Text {...TEXT_PROPS} style={styles.verificationModalTitle}>
                {verificationStatusInfo.status === 'verified' ? 'Face Verified' :
                 verificationStatusInfo.status === 'pending' ? 'Verification Pending' :
                 'Not Yet Verified'}
              </Text>
            </View>

            {/* Status Details */}
            <View style={styles.verificationModalBody}>
              {verificationStatusInfo.status === 'verified' && (
                <>
                  <Text {...TEXT_PROPS} style={styles.verificationModalText}>
                    Your face has been verified. This badge helps build trust with other users.
                  </Text>
                  {verificationStatusInfo.date && (
                    <View style={styles.verificationModalRow}>
                      <Ionicons name="calendar-outline" size={STATUS_ICON_SIZE} color={COLORS.textLight} />
                      <Text {...TEXT_PROPS} style={styles.verificationModalRowText}>
                        Verified: {verificationStatusInfo.date}
                      </Text>
                    </View>
                  )}
                </>
              )}
              {verificationStatusInfo.status === 'pending' && (
                <Text {...TEXT_PROPS} style={styles.verificationModalText}>
                  We're reviewing your verification. This usually takes less than 24 hours. You'll be notified once complete.
                </Text>
              )}
              {verificationStatusInfo.status === 'unverified' && (
                <Text {...TEXT_PROPS} style={styles.verificationModalText}>
                  Verify your face to get a badge, unlock full visibility, and build trust with matches.
                </Text>
              )}
            </View>

            {/* Action Button */}
            <TouchableOpacity
              style={[
                styles.verificationModalButton,
                verificationStatusInfo.status === 'verified' && styles.verificationModalButtonSecondary
              ]}
              onPress={() => {
                setShowVerificationModal(false);
                safePush(router, '/(main)/verification', 'profile->verification-modal');
              }}
              activeOpacity={0.7}
              accessibilityLabel={verificationStatusInfo.buttonLabel}
            >
              <Text {...TEXT_PROPS} style={[
                styles.verificationModalButtonText,
                verificationStatusInfo.status === 'verified' && styles.verificationModalButtonTextSecondary
              ]}>
                {verificationStatusInfo.buttonLabel}
              </Text>
            </TouchableOpacity>

            {/* Close */}
            <TouchableOpacity
              style={styles.verificationModalClose}
              onPress={() => setShowVerificationModal(false)}
              accessibilityLabel="Close verification details"
            >
              <Text {...TEXT_PROPS} style={styles.verificationModalCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ═══════════════════════════════════════════════════════════════════════════
  // CONTAINER - Clean background
  // ═══════════════════════════════════════════════════════════════════════════
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    padding: SPACING.xl,
  },
  loadingText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '500',
    color: COLORS.textMuted,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  loadingAvatar: {
    width: LOADING_AVATAR_SIZE,
    height: LOADING_AVATAR_SIZE,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.backgroundDark,
  },
  profileRetryButton: {
    marginTop: SPACING.base,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm + SPACING.xs,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.primary,
  },
  profileRetryButtonText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.white,
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
  },
  profileRecoveryText: {
    marginTop: SPACING.md,
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    color: COLORS.primary,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER - Clean, minimal top bar
  // ═══════════════════════════════════════════════════════════════════════════
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
  },
  headerTitle: {
    fontSize: HEADER_TITLE_SIZE,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: lineHeight(HEADER_TITLE_SIZE, 1.2),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILE SECTION - Prominent photo and identity
  // ═══════════════════════════════════════════════════════════════════════════
  profileSection: {
    alignItems: 'center',
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  avatarContainer: {
    marginBottom: SPACING.lg,
    // Premium shadow
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  avatar: {
    borderWidth: AVATAR_BORDER_WIDTH,
    borderColor: COLORS.white,
    backgroundColor: COLORS.backgroundDark,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: moderateScale(10, 0.25),
    marginBottom: SPACING.sm,
  },
  name: {
    fontSize: PROFILE_NAME_SIZE,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: lineHeight(PROFILE_NAME_SIZE, 1.2),
  },
  verifiedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.primarySubtle,
    paddingHorizontal: moderateScale(10, 0.25),
    paddingVertical: SPACING.xs,
    borderRadius: SIZES.radius.md,
  },
  verifiedInlineText: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.primary,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.2),
  },
  bio: {
    fontSize: PROFILE_BIO_SIZE,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(PROFILE_BIO_SIZE, 1.35),
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
    maxWidth: moderateScale(300, 0.25),
  },
  interestsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  interestChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: moderateScale(6, 0.25),
    borderRadius: SIZES.radius.lg,
    backgroundColor: COLORS.primarySubtle,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  interestChipText: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.primary,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.body2, 1.2),
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION DIVIDER - Subtle separation
  // ═══════════════════════════════════════════════════════════════════════════
  sectionDivider: {
    height: SPACING.sm,
    backgroundColor: COLORS.backgroundDark,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS CARD (if used)
  // ═══════════════════════════════════════════════════════════════════════════
  statsCard: {
    backgroundColor: COLORS.backgroundDark,
    margin: SPACING.base,
    padding: SPACING.base,
    borderRadius: SIZES.radius.lg,
  },
  statsTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
    marginBottom: SPACING.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  statsLabel: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
  },
  statsValue: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MENU SECTION - Clean settings list
  // ═══════════════════════════════════════════════════════════════════════════
  menuSection: {
    paddingTop: SPACING.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.base,
    paddingHorizontal: SPACING.lg,
    minHeight: SIZES.button.lg,
    backgroundColor: COLORS.background,
  },
  adminMenuItem: {
    backgroundColor: COLORS.primarySubtle,
  },
  menuText: {
    flex: 1,
    fontSize: MENU_TEXT_SIZE,
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: lineHeight(MENU_TEXT_SIZE, 1.35),
    marginLeft: moderateScale(14, 0.25),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHOTO PREVIEW MODAL - Full-screen view
  // ═══════════════════════════════════════════════════════════════════════════
  photoPreviewContainer: {
    flex: 1,
    backgroundColor: COLORS.black,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPreviewCloseArea: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPreviewImage: {
    width: '100%',
    height: '100%',
  },
  photoPreviewCloseButton: {
    position: 'absolute',
    width: SIZES.button.md,
    height: SIZES.button.md,
    borderRadius: SIZES.radius.full,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICATION STATUS ROW - Always visible status + action button
  // ═══════════════════════════════════════════════════════════════════════════
  verificationStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: SIZES.radius.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.base,
    marginTop: SPACING.base,
    marginBottom: SPACING.md,
    width: '100%',
    maxWidth: moderateScale(340, 0.25),
  },
  verificationStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(10, 0.25),
    flex: 1,
  },
  verificationStatusDot: {
    width: moderateScale(10, 0.25),
    height: moderateScale(10, 0.25),
    borderRadius: SIZES.radius.full,
  },
  verificationStatusLabel: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
    color: COLORS.text,
    flex: 1,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
  },
  verificationActionButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    paddingHorizontal: moderateScale(14, 0.25),
    borderRadius: SIZES.radius.lg,
  },
  verificationActionButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  verificationActionButtonText: {
    fontSize: STATUS_BUTTON_TEXT_SIZE,
    fontWeight: '600',
    color: COLORS.white,
    lineHeight: lineHeight(STATUS_BUTTON_TEXT_SIZE, 1.2),
  },
  verificationActionButtonTextSecondary: {
    color: COLORS.text,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICATION DETAILS MODAL
  // ═══════════════════════════════════════════════════════════════════════════
  verificationModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  verificationModalContent: {
    backgroundColor: COLORS.background,
    borderRadius: VERIFICATION_MODAL_RADIUS,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: VERIFICATION_MODAL_MAX_WIDTH,
    alignItems: 'center',
  },
  verificationModalHeader: {
    alignItems: 'center',
    marginBottom: SPACING.base,
  },
  verificationModalIcon: {
    width: VERIFICATION_MODAL_ICON_SIZE,
    height: VERIFICATION_MODAL_ICON_SIZE,
    borderRadius: SIZES.radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  verificationModalTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.xxl, 1.2),
  },
  verificationModalBody: {
    width: '100%',
    marginBottom: SPACING.lg,
  },
  verificationModalText: {
    fontSize: MODAL_BODY_SIZE,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(MODAL_BODY_SIZE, 1.35),
  },
  verificationModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: SIZES.radius.sm,
  },
  verificationModalRowText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
  },
  verificationModalButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: SIZES.radius.xl,
    width: '100%',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  verificationModalButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  verificationModalButtonText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    color: COLORS.white,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.2),
  },
  verificationModalButtonTextSecondary: {
    color: COLORS.text,
  },
  verificationModalClose: {
    paddingVertical: SPACING.sm,
  },
  verificationModalCloseText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textMuted,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
  },
});
