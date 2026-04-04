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
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
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
  const { userId } = useAuthStore();

  // Backend profile query
  const backendProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    !isDemoMode && userId ? { authUserId: userId } : 'skip'
  );
  const backendProfileLoaded = backendProfile !== undefined;

  // Loading and error states
  const [hasLoadError, setHasLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const isLoading = !isDemoMode && userId && backendProfile === undefined && !hasLoadError;

  // Local store data
  const localSelectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const localDisplayName = usePrivateProfileStore((s) => s.displayName);
  const localAge = usePrivateProfileStore((s) => s.age);
  const blurMyPhoto = usePrivateProfileStore((s) => s.blurMyPhoto);
  const photoBlurSlots = usePrivateProfileStore((s) => s.photoBlurSlots);

  // Track mount state
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Error timeout
  useEffect(() => {
    if (isDemoMode || backendProfile !== undefined || hasLoadError) {
      if (hasLoadError && backendProfile !== undefined) {
        setHasLoadError(false);
      }
      return;
    }

    const timeout = setTimeout(() => {
      if (mountedRef.current && backendProfile === undefined) {
        setHasLoadError(true);
      }
    }, 15000);

    return () => clearTimeout(timeout);
  }, [backendProfile, hasLoadError, retryKey]);

  const handleRetry = useCallback(() => {
    setHasLoadError(false);
    setRetryKey((k) => k + 1);
  }, []);

  // Resolve data from backend or local store
  const displayName = useMemo(() => {
    if (isDemoMode) return localDisplayName;
    if (backendProfile?.displayName) return backendProfile.displayName;
    return localDisplayName;
  }, [isDemoMode, backendProfile, localDisplayName]);

  const age = useMemo(() => {
    if (isDemoMode) return localAge;
    if (backendProfile?.age) return backendProfile.age;
    return localAge;
  }, [isDemoMode, backendProfile, localAge]);

  // Get main photo URL for avatar
  const mainPhoto = useMemo(() => {
    const photos = isDemoMode
      ? localSelectedPhotoUrls
      : (localSelectedPhotoUrls.length > 0
          ? localSelectedPhotoUrls
          : backendProfile?.privatePhotoUrls || []);
    const validPhotos = photos.filter(isValidPhotoUrl);
    return validPhotos[0] || null;
  }, [isDemoMode, localSelectedPhotoUrls, backendProfile?.privatePhotoUrls]);

  // Check if main photo (slot 0) should be blurred
  // Matches the same blur logic used in Edit Profile
  const isMainPhotoBlurred = useMemo(() => {
    return blurMyPhoto && photoBlurSlots[0];
  }, [blurMyPhoto, photoBlurSlots]);

  // Age fallback from Phase-1
  const phase1Age = useMemo(() => {
    if (isDemoMode) {
      const demoUser = getDemoCurrentUser();
      return demoUser?.dateOfBirth ? calculateAgeFromDOB(demoUser.dateOfBirth) : 0;
    }
    return 0;
  }, []);

  const resolvedName = useMemo(() => {
    if (displayName && displayName.trim().length > 0) {
      return displayName;
    }
    return 'Anonymous';
  }, [displayName]);

  const resolvedAge = useMemo(() => {
    if (age && age > 0) return age;
    return phase1Age;
  }, [age, phase1Age]);

  // Navigate to Edit Profile
  const handleEditProfile = () => {
    router.push('/(main)/(private)/edit-profile' as any);
  };

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
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.7}>
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
          {mainPhoto ? (
            <View style={styles.avatarContainer}>
              <Image
                source={{ uri: mainPhoto }}
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

        {/* Settings Menu */}
        <View style={styles.menuSection}>
          {/* 1. Edit Profile */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={handleEditProfile}
            activeOpacity={0.7}
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
