import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { safePush, safeReplace } from '@/lib/safeRouter';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Avatar, Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoStore } from '@/stores/demoStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { getDemoCurrentUser } from '@/lib/demoData';

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
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);

  // FIX C: Force re-render when navigating back from Edit Profile
  const [refreshKey, setRefreshKey] = useState(0);
  useFocusEffect(
    useCallback(() => {
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

  const deactivateAccount = useMutation(api.users.deactivateAccount);
  // 3A1-2: Server-side logout mutation
  const serverLogout = useMutation(api.auth.logout);

  // FIX C: Extract photos robustly from any format
  const extractPhotos = (user: any): { url: string; isPrimary: boolean }[] => {
    if (!user) return [];

    // Try user.photos first (most common)
    let rawPhotos = user.photos;

    // Fallback to user.photoUrls if photos doesn't exist
    if (!rawPhotos?.length && user.photoUrls?.length) {
      rawPhotos = user.photoUrls;
    }

    if (!rawPhotos?.length) return [];

    return rawPhotos
      .map((p: any, i: number) => {
        // Handle string URLs directly
        if (typeof p === 'string') {
          return { url: p, isPrimary: i === 0 };
        }
        // Handle { url: string } objects
        if (p?.url) {
          return { url: p.url, isPrimary: p.isPrimary ?? i === 0 };
        }
        return null;
      })
      .filter((p: any) => p && p.url);
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

  // FIX C: Get main photo (index 0 after reorder)
  const mainPhotoUrl = currentUser?.photos?.[0]?.url || null;

  // Blur status: detect from existing field names only (no new fields added)
  const blurEnabled = Boolean(
    (currentUser as any)?.blurMyPhoto ??
    (currentUser as any)?.blurPhoto ??
    (currentUser as any)?.blurEnabled ??
    (currentUser as any)?.photoVisibilityBlur ??
    false
  );

  // Preview toggle state (UI only, doesn't change settings)
  const [previewBlur, setPreviewBlur] = useState(false);

  if (__DEV__) {
    const source = isDemoMode ? 'demoStore' : 'convex';
    const count = currentUser?.photos?.length ?? 0;
    console.log('[ProfileTab] photoSource', {
      source,
      count,
      main: !!mainPhotoUrl,
      refreshKey,
      hydrated: demoHydrated,
    });
  }

  // 3A1-2: Logout clears client + server + onboarding
  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          // Clear local state FIRST for crash safety
          if (isDemoMode) {
            useDemoStore.getState().demoLogout();
          }
          useOnboardingStore.getState().reset();
          logout();
          safeReplace(router, '/(auth)/welcome', 'profile->logout');

          // Server logout in background (best-effort)
          if (!isDemoMode && token) {
            serverLogout({ token }).catch((e) => {
              console.warn('[Logout] Server logout failed:', e);
            });
          }
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
                await deactivateAccount({ userId: userId as any });
              } else {
                useDemoStore.getState().demoLogout();
              }
              // 3A1-2: Also clear onboarding store on deactivate
              useOnboardingStore.getState().reset();
              logout();
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
        <TouchableOpacity onPress={() => safePush(router, '/(main)/edit-profile', 'profile->edit')}>
          <Ionicons name="create-outline" size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.profileSection}>
        {/* Main photo - always clear for owner */}
        {mainPhotoUrl ? (
          <Image source={{ uri: mainPhotoUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <Avatar size={100} />
        )}

        {/* Blur status badge */}
        <View style={[styles.blurStatusBadge, blurEnabled ? styles.blurStatusOn : styles.blurStatusOff]}>
          <Ionicons
            name={blurEnabled ? 'eye-off' : 'eye'}
            size={16}
            color={blurEnabled ? COLORS.primary : COLORS.textLight}
          />
          <Text style={[styles.blurStatusText, blurEnabled && styles.blurStatusTextOn]}>
            {blurEnabled ? 'Blur ON — others see your photos blurred' : 'Blur OFF — others see your photos clearly'}
          </Text>
        </View>

        {/* Preview toggle */}
        {mainPhotoUrl && (
          <TouchableOpacity
            style={styles.previewToggle}
            onPress={() => setPreviewBlur((p) => !p)}
            activeOpacity={0.7}
          >
            <Ionicons name={previewBlur ? 'eye' : 'eye-off-outline'} size={14} color={COLORS.primary} />
            <Text style={styles.previewToggleText}>
              {previewBlur ? 'Hide preview' : 'Preview how others see it'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Blurred preview thumbnail */}
        {previewBlur && mainPhotoUrl && (
          <View style={styles.previewContainer}>
            <Image
              source={{ uri: mainPhotoUrl }}
              style={styles.previewThumbnail}
              contentFit="cover"
              blurRadius={blurEnabled ? 20 : 0}
            />
            <Text style={styles.previewLabel}>
              {blurEnabled ? 'Others see this (blurred)' : 'Others see this (clear)'}
            </Text>
            <Text style={styles.previewHint}>Preview only — does not change your setting</Text>
          </View>
        )}

        {currentUser.isVerified && (
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        )}
        <Text style={styles.name}>
          {currentUser.name}{age !== null ? `, ${age}` : ''}
        </Text>
        {currentUser.bio && <Text style={styles.bio}>{currentUser.bio}</Text>}
      </View>

      {subscriptionStatus && currentUser.gender === 'male' && (
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>Subscription</Text>
          <View style={styles.statsRow}>
            <Text style={styles.statsLabel}>Tier:</Text>
            <Text style={styles.statsValue}>
              {subscriptionStatus.tier.charAt(0).toUpperCase() + subscriptionStatus.tier.slice(1)}
            </Text>
          </View>
          {subscriptionStatus.isSubscribed && subscriptionStatus.expiresAt && (
            <View style={styles.statsRow}>
              <Text style={styles.statsLabel}>Expires:</Text>
              <Text style={styles.statsValue}>
                {new Date(subscriptionStatus.expiresAt).toLocaleDateString()}
              </Text>
            </View>
          )}
          <Button
            title="Manage Subscription"
            variant="outline"
            onPress={() => safePush(router, '/(main)/subscription', 'profile->subscription')}
            style={styles.subscriptionButton}
          />
        </View>
      )}

      <View style={styles.menuSection}>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/edit-profile', 'profile->editMenu')}
        >
          <Ionicons name="create-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/subscription', 'profile->subscriptionMenu')}
        >
          <Ionicons name="diamond-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Subscription</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings', 'profile->privacy')}
        >
          <Ionicons name="lock-closed-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Privacy</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings', 'profile->notifications')}
        >
          <Ionicons name="notifications-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Notifications</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings', 'profile->safety')}
        >
          <Ionicons name="shield-checkmark-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Safety</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => safePush(router, '/(main)/settings', 'profile->account')}
        >
          <Ionicons name="person-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Account</Text>
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

      <View style={styles.footer}>
        <Button title="Logout" variant="outline" onPress={handleLogout} />
        <TouchableOpacity onPress={handleDeactivate} style={styles.deactivateButton}>
          <Text style={styles.deactivateText}>Deactivate Account</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
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
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 12,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 12,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    marginLeft: 4,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  bio: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
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
  // Blur status badge
  blurStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 12,
    marginBottom: 8,
    gap: 6,
  },
  blurStatusOn: {
    backgroundColor: COLORS.primary + '20',
  },
  blurStatusOff: {
    backgroundColor: COLORS.backgroundDark,
  },
  blurStatusText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  blurStatusTextOn: {
    color: COLORS.primary,
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
});
