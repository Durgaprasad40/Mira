/*
 * UNLOCKED (PROFILE TAB)
 * Active development area
 * Changes allowed
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { safePush, safeReplace } from '@/lib/safeRouter';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Avatar } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useScreenTrace } from '@/lib/devTrace';

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

export default function ProfileScreen() {
  useScreenTrace("PROFILE");
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);

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

  const convexUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  // DEBUG ONLY: In demo mode + dev, check if Convex has photos for this userId
  // Skip in production to avoid unnecessary network calls
  const convexPhotosDebug = useQuery(
    api.users.getCurrentUser,
    __DEV__ && isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const subscriptionStatus = useQuery(
    api.subscriptions.getSubscriptionStatus,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  // Admin check for showing admin menu
  const adminCheck = useQuery(
    api.users.checkIsAdmin,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );
  const isAdmin = adminCheck?.isAdmin === true;

  // CONSISTENCY FIX: Use same photo source as Edit Profile (api.photos.getUserPhotos)
  // This ensures Profile Tab shows the SAME photos as Edit Profile grid
  const backendPhotos = useQuery(
    api.photos.getUserPhotos,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );

  const deactivateAccount = useMutation(api.users.deactivateAccount);
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
      .map((p: any, i: number) => {
        // Handle string URLs directly
        if (typeof p === 'string') {
          return { url: p, isPrimary: i === 0, isBlurred: undefined, order: undefined };
        }
        // Handle { url: string } objects - preserve isBlurred and order from backend
        if (p?.url) {
          return {
            url: p.url,
            isPrimary: p.isPrimary ?? i === 0,
            isBlurred: p.isBlurred as boolean | undefined,
            order: p.order as number | undefined,
          };
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

  // MAIN PHOTO SOURCE OF TRUTH:
  // - Live mode: Use photo with isPrimary=true from currentUser.photos (getCurrentUser)
  // - Demo mode: Use first photo from demoStore
  // BUG FIX: Use currentUser.photos instead of backendPhotos (getUserPhotos)
  // getUserPhotos EXCLUDES verification_reference photos, causing primary photo to be missed
  // currentUser.photos from getCurrentUser includes ALL photos with isPrimary flag
  const mainPhotoUrl = React.useMemo(() => {
    if (isDemoMode) {
      // Demo mode: use first photo from demoStore
      return currentUser?.photos?.[0]?.url || null;
    }
    // Live mode: Find photo with isPrimary=true from currentUser.photos (authoritative)
    // Fallback to first photo if no isPrimary found
    const primaryPhoto = currentUser?.photos?.find((p: any) => p.isPrimary);
    const mainPhoto = primaryPhoto || currentUser?.photos?.[0];

    if (__DEV__ && currentUser?.photos?.length) {
      console.log('[ProfileTab] 📸 Main photo selection:', {
        hasPrimaryFlag: !!primaryPhoto,
        selectedUrl: mainPhoto?.url?.slice(-30),
        isPrimary: mainPhoto?.isPrimary,
        totalPhotos: currentUser?.photos?.length,
      });
    }

    return mainPhoto?.url || null;
  }, [isDemoMode, currentUser?.photos]);

  // PER-PHOTO BLUR CHECK: Read from backend photo.isBlurred field (source of truth)
  // Edit Profile persists blur state to Convex on Save via api.photos.setPhotosBlur
  // A photo is individually blurred when photo.isBlurred === true
  const mainPhotoIsBlurred = React.useMemo(() => {
    if (isDemoMode) {
      // Demo mode: check first photo's isBlurred field
      const firstPhoto = currentUser?.photos?.[0];
      return firstPhoto?.isBlurred === true;
    }
    // Live mode: find the primary photo and check its isBlurred field from backend
    const primaryPhoto = currentUser?.photos?.find((p: any) => p.isPrimary);
    const mainPhoto = primaryPhoto || currentUser?.photos?.[0];
    return mainPhoto?.isBlurred === true;
  }, [isDemoMode, currentUser?.photos]);

  // PERF: Prefetch top photos after hydration
  React.useEffect(() => {
    const photos = currentUser?.photos;
    if (photos && photos.length > 0) {
      const topPhotos = photos.slice(0, Math.min(6, photos.length));
      topPhotos.forEach((photo) => {
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
  }, [currentUser?.photos]);

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

  // Preview toggle state (UI only, doesn't change settings)
  const [previewBlur, setPreviewBlur] = useState(false);

  // Full-screen photo preview state
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);

  if (__DEV__) {
    // CONSISTENCY DEBUG: Show both sources to verify they match
    const backendPhotoCount = backendPhotos?.length ?? 0;
    const demoPhotoCount = currentUser?.photos?.length ?? 0;
    const source = isDemoMode ? 'demoStore' : 'api.photos.getUserPhotos';

    console.log('[ProfileTab] 📸 Photo source consistency check:', {
      source,
      isDemoMode,
      // Backend photos (same query as Edit Profile)
      backendPhotoCount,
      backendSlot0: backendPhotos?.[0]?.url?.slice(-30) || null,
      // What we're displaying
      mainPhotoUrl: mainPhotoUrl?.slice(-30) || null,
      // For comparison with Edit Profile logs
      refreshKey,
    });

    // CRITICAL: If in demo mode, warn that Convex photos are being ignored
    if (isDemoMode) {
      console.warn('[ProfileTab] ⚠️ DEMO MODE ACTIVE - Using demoStore photos');

      // DEBUG: Check if Convex actually has photos for this user
      if (convexPhotosDebug) {
        const convexPhotoCount = convexPhotosDebug.photos?.length ?? 0;
        if (convexPhotoCount > 0) {
          console.warn('[ProfileTab] ⚠️ Convex has', convexPhotoCount, 'photos but demo mode ignores them');
        }
      }
    } else {
      // LIVE MODE: Log for consistency verification with Edit Profile
      console.log('[ProfileTab] ✅ LIVE MODE - Using api.photos.getUserPhotos (same as Edit Profile)');
    }
  }

  // 3A1-2: Logout clears client + server + onboarding
  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          // SEC-3 FIX: Server logout FIRST (with timeout) to invalidate session
          // This ensures the token is invalidated server-side before we clear local state
          if (!isDemoMode && token) {
            try {
              // Use Promise.race with 3s timeout - don't block UX indefinitely
              await Promise.race([
                serverLogout({ token }),
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
          // H5 FIX: Await async logout to ensure SecureStore is cleared before navigation
          await logout();
          safeReplace(router, '/(auth)/welcome', 'profile->logout');
        },
      },
    ]);
  };

  const handleDeactivate = () => {
    if (!userId) return;
    Alert.alert(
      'Deactivate Account',
      'Are you sure you want to deactivate your account? You can reactivate it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!isDemoMode) {
                await deactivateAccount({ authUserId: userId });
              } else {
                useDemoStore.getState().demoLogout();
              }
              // 3A1-2: Also clear onboarding store on deactivate
              useOnboardingStore.getState().reset();
              // H5 FIX: Await async logout to ensure SecureStore is cleared before navigation
              await logout();
              safeReplace(router, '/(auth)/welcome', 'profile->deactivate');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to deactivate account');
            }
          },
        },
      ]
    );
  };

  if (!currentUser) {
    return (
      <SafeAreaView edges={['top']} style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const age = calculateAge(currentUser.dateOfBirth);

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity
          onPress={() => safePush(router, '/(main)/edit-profile', 'profile->edit')}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <Ionicons name="create-outline" size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.profileSection}>
        {/* Main photo - large with shadow, tappable for full-screen view */}
        {/* BLUR FIX: Apply soft blur (radius 8) when photoBlurred is true */}
        {mainPhotoUrl ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setShowPhotoPreview(true)}
            accessibilityRole="imagebutton"
            accessibilityLabel="View profile photo full screen"
            style={styles.avatarContainer}
          >
            <Image
              source={{ uri: mainPhotoUrl }}
              style={styles.avatar}
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
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.avatarContainer}>
            <Avatar size={120} />
          </View>
        )}

        {/* Name + Age + Verified (inline) */}
        <View style={styles.nameRow}>
          <Text style={styles.name}>
            {currentUser.name}{age !== null ? `, ${age}` : ''}
          </Text>
          {currentUser.isVerified && (
            <View style={styles.verifiedInline}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
              <Text style={styles.verifiedInlineText}>Verified</Text>
            </View>
          )}
        </View>

        {/* Bio */}
        {currentUser.bio && <Text style={styles.bio}>{currentUser.bio}</Text>}

        {/* Photo visibility status - based on main photo's individual blur state */}
        <View style={styles.visibilityRow}>
          <Ionicons
            name={mainPhotoIsBlurred ? 'eye-off-outline' : 'eye-outline'}
            size={16}
            color={COLORS.textMuted}
          />
          <Text style={styles.visibilityText}>
            {mainPhotoIsBlurred ? 'Photo blurred to others' : 'Photos visible to others'}
          </Text>
        </View>

        {/* Preview toggle (only if main photo is individually blurred) */}
        {mainPhotoIsBlurred && mainPhotoUrl && (
          <TouchableOpacity
            style={styles.previewToggle}
            onPress={() => setPreviewBlur((p) => !p)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={previewBlur ? 'Hide blur preview' : 'Preview how others see your photo'}
          >
            <Text style={styles.previewToggleText}>
              {previewBlur ? 'Hide preview' : 'See how others view you'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Blurred preview thumbnail - only shown if main photo is individually blurred */}
        {previewBlur && mainPhotoIsBlurred && mainPhotoUrl && (
          <View style={styles.previewContainer}>
            <Image
              source={{ uri: mainPhotoUrl }}
              style={styles.previewThumbnail}
              contentFit="cover"
              blurRadius={8}
              transition={100}
            />
            <Text style={styles.previewHint}>How others see your photo</Text>
          </View>
        )}
      </View>

      {/* Section divider */}
      <View style={styles.sectionDivider} />

{/* HIDDEN: Subscription UI temporarily removed per product rules */}

      <View style={styles.menuSection}>
        {/* 1. Edit Profile */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/edit-profile', 'profile->editMenu')}
          accessibilityRole="button"
          accessibilityLabel="Edit Profile"
        >
          <Ionicons name="create-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 2. Privacy */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/privacy', 'profile->privacy')}
          accessibilityRole="button"
          accessibilityLabel="Privacy settings"
        >
          <Ionicons name="lock-closed-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Privacy</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 3. Notifications */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/notifications', 'profile->notifications')}
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
        >
          <Ionicons name="notifications-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Notifications</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 4. Safety */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/safety', 'profile->safety')}
          accessibilityRole="button"
          accessibilityLabel="Safety settings"
        >
          <Ionicons name="shield-checkmark-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Safety</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 5. Account */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/account', 'profile->account')}
          accessibilityRole="button"
          accessibilityLabel="Account settings"
        >
          <Ionicons name="person-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Account</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 6. Support & FAQ */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings/support', 'profile->support')}
          accessibilityRole="button"
          accessibilityLabel="Support and FAQ"
        >
          <Ionicons name="help-circle-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Support & FAQ</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* 7. Log Out */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Ionicons name="log-out-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Log Out</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {isAdmin && (
          <>
            <TouchableOpacity
              style={[styles.menuItem, styles.adminMenuItem]}
              onPress={() => safePush(router, '/(main)/admin/verification', 'profile->adminVerification')}
            >
              <Ionicons name="shield-outline" size={24} color={COLORS.primary} />
              <Text style={[styles.menuText, { color: COLORS.primary }]}>Admin: Verification Queue</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.adminMenuItem]}
              onPress={() => safePush(router, '/(main)/admin/logs', 'profile->adminLogs')}
            >
              <Ionicons name="document-text-outline" size={24} color={COLORS.primary} />
              <Text style={[styles.menuText, { color: COLORS.primary }]}>Admin: Audit Logs</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* 8. Deactivate Account - destructive action at bottom */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleDeactivate}
          style={styles.deactivateButton}
          accessibilityRole="button"
          accessibilityLabel="Deactivate account"
        >
          <Text style={styles.deactivateText}>Deactivate Account</Text>
        </TouchableOpacity>
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
            style={styles.photoPreviewCloseButton}
            onPress={() => setShowPhotoPreview(false)}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  profileSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  avatarContainer: {
    marginBottom: 16,
    // Soft shadow for premium feel
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: COLORS.white,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  verifiedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedInlineText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  bio: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  visibilityText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  sectionDivider: {
    height: 8,
    backgroundColor: COLORS.backgroundDark,
  },
  statsCard: {
    backgroundColor: COLORS.backgroundDark,
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statsLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  statsValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  subscriptionButton: {
    marginTop: 12,
  },
  menuSection: {
    marginTop: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  adminMenuItem: {
    backgroundColor: COLORS.primary + '10',
    borderBottomColor: COLORS.primary + '30',
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    marginLeft: 16,
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
  },
  deactivateButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  deactivateText: {
    fontSize: 14,
    color: COLORS.error,
    fontWeight: '500',
  },
  // Preview toggle
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  previewToggleText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  // Preview container
  previewContainer: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
    padding: 12,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
  },
  previewThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 8,
  },
  previewLabel: {
    fontSize: 11,
    color: COLORS.text,
    fontWeight: '500',
    marginBottom: 2,
  },
  previewHint: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  // Full-screen photo preview
  photoPreviewContainer: {
    flex: 1,
    backgroundColor: '#000',
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
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
