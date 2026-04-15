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
  const demoUser = isDemoMode ? getDemoCurrentUser() : null;
  const [queryPaused, setQueryPaused] = useState(false);

  // Backend profile query
  const backendProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    !isDemoMode && userId && !queryPaused ? { authUserId: userId } : 'skip'
  );
  const backendProfileLoaded = backendProfile !== undefined;

  // Loading and error states
  const [hasLoadError, setHasLoadError] = useState(false);
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
    return backendProfile?.age || 0;
  }, [backendProfile?.age, demoUser, isDemoMode]);

  // Get main photo URL for avatar
  const mainPhoto = useMemo(() => {
    const photos = isDemoMode
      ? (demoUser?.photos?.map((photo) => photo.url) || [])
      : (backendProfile?.privatePhotoUrls || []);
    const validPhotos = photos.filter(isValidPhotoUrl);
    return validPhotos[0] || null;
  }, [backendProfile?.privatePhotoUrls, demoUser, isDemoMode]);

  const isMainPhotoBlurred = useMemo(() => {
    if (isDemoMode) return false;
    return Boolean(backendProfile?.photoBlurSlots?.[0]);
  }, [backendProfile?.photoBlurSlots, isDemoMode]);

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

  const promptCount = useMemo(() => {
    if (isDemoMode) {
      return 0;
    }
    return (backendProfile?.promptAnswers || []).filter((answer) => answer.answer.trim().length > 0).length;
  }, [backendProfile?.promptAnswers, isDemoMode]);

  const hasIntentSelection = useMemo(() => {
    if (isDemoMode) {
      return false;
    }
    return (backendProfile?.privateIntentKeys?.length || 0) > 0;
  }, [backendProfile?.privateIntentKeys, isDemoMode]);

  const completionItems = useMemo(() => ([
    {
      label: 'Photos',
      complete: photoCount >= 2,
      detail: photoCount >= 2 ? `${photoCount} added` : `Add at least 2 photos (${photoCount}/2)`,
    },
    {
      label: 'Bio',
      complete: hasBio,
      detail: hasBio ? 'Added' : 'Add a short bio',
    },
    {
      label: 'Prompts',
      complete: promptCount > 0,
      detail: promptCount > 0 ? `${promptCount} answered` : 'Add at least 1 answer',
    },
    {
      label: 'Looking for',
      complete: hasIntentSelection,
      detail: hasIntentSelection ? 'Selected' : 'Choose what you are looking for',
    },
  ]), [hasBio, hasIntentSelection, photoCount, promptCount]);

  const missingCompletionItems = useMemo(
    () => completionItems.filter((item) => !item.complete),
    [completionItems]
  );

  const isProfileReady = useMemo(() => {
    if (isDemoMode) {
      return true;
    }
    return Boolean(backendProfile?.isSetupComplete) && missingCompletionItems.length === 0;
  }, [backendProfile?.isSetupComplete, isDemoMode, missingCompletionItems.length]);

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
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.7}>
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

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={[styles.statusIcon, isProfileReady ? styles.statusIconReady : styles.statusIconNeedsWork]}>
              <Ionicons
                name={isProfileReady ? 'checkmark-circle' : 'construct-outline'}
                size={16}
                color="#FFFFFF"
              />
            </View>
            <View style={styles.statusCopy}>
              <Text style={styles.statusTitle}>
                {isProfileReady ? 'Profile ready' : 'Keep building your profile'}
              </Text>
              <Text style={styles.statusText}>
                {isProfileReady
                  ? 'Your photos, bio, prompts, and intent are ready for Deep Connect.'
                  : missingCompletionItems.length === 1
                    ? `One thing still needs attention: ${missingCompletionItems[0]?.label.toLowerCase()}.`
                    : `${missingCompletionItems.length} areas still need attention before your profile feels complete.`}
              </Text>
            </View>
          </View>

          <View style={styles.checklist}>
            {completionItems.map((item) => {
              const openLookingFor =
                !isDemoMode && item.label === 'Looking for' && !item.complete;
              if (openLookingFor) {
                return (
                  <TouchableOpacity
                    key={item.label}
                    style={[styles.checklistRow, styles.checklistRowTappable]}
                    onPress={handleOpenPhase2DiscoveryPreferences}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={item.complete ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={item.complete ? C.primary : C.textLight}
                    />
                    <View style={styles.checklistCopy}>
                      <Text style={styles.checklistLabel}>{item.label}</Text>
                      <Text style={styles.checklistDetail}>{item.detail}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={C.primary} />
                  </TouchableOpacity>
                );
              }
              return (
                <View key={item.label} style={styles.checklistRow}>
                  <Ionicons
                    name={item.complete ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={item.complete ? C.primary : C.textLight}
                  />
                  <View style={styles.checklistCopy}>
                    <Text style={styles.checklistLabel}>{item.label}</Text>
                    <Text style={styles.checklistDetail}>{item.detail}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {!isProfileReady && (
            <TouchableOpacity
              style={styles.statusAction}
              onPress={handleEditProfile}
              activeOpacity={0.7}
            >
              <Text style={styles.statusActionText}>Continue editing</Text>
              <Ionicons name="chevron-forward" size={16} color={C.primary} />
            </TouchableOpacity>
          )}
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
