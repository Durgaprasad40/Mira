/*
 * LOCKED (PRIVACY SETTINGS)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { usePrivacyStore } from '@/stores/privacyStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Toast } from '@/components/ui/Toast';

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const { token, userId } = useAuthStore();

  // Query current user privacy settings (live mode only)
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  // Mutations for backend sync
  const updatePrivacySettings = useMutation(api.users.updatePrivacySettings);

  // Privacy toggles from persisted store
  const hideFromDiscover = usePrivacyStore((s) => s.hideFromDiscover);
  const hideAge = usePrivacyStore((s) => s.hideAge);
  const hideDistance = usePrivacyStore((s) => s.hideDistance);
  const disableReadReceipts = usePrivacyStore((s) => s.disableReadReceipts);

  const setHideFromDiscover = usePrivacyStore((s) => s.setHideFromDiscover);
  const setHideAge = usePrivacyStore((s) => s.setHideAge);
  const setHideDistance = usePrivacyStore((s) => s.setHideDistance);
  const setDisableReadReceipts = usePrivacyStore((s) => s.setDisableReadReceipts);
  const [isHydrated, setIsHydrated] = useState(isDemoMode);
  const [timedOut, setTimedOut] = useState(false);
  const [discoveryPauseEndsAt, setDiscoveryPauseEndsAt] = useState<number | null>(null);

  // P1-042 FIX: Track if initial sync has been done to prevent overwriting pending changes
  const initialSyncDoneRef = React.useRef(false);

  // Hydrate local state from backend on load (live mode only)
  // P1-042 FIX: Only sync once on initial load to prevent overwriting user's pending changes
  useEffect(() => {
    if (currentUser && !initialSyncDoneRef.current) {
      initialSyncDoneRef.current = true;
      const pauseUntil =
        typeof currentUser.discoveryPausedUntil === 'number' &&
        currentUser.discoveryPausedUntil > Date.now()
          ? currentUser.discoveryPausedUntil
          : null;
      setDiscoveryPauseEndsAt(pauseUntil);
      const isHiddenFromDiscover =
        currentUser.hideFromDiscover === true || !!pauseUntil;
      setHideFromDiscover(isHiddenFromDiscover);
      setHideAge(currentUser.hideAge === true);
      setHideDistance(currentUser.hideDistance === true);
      setDisableReadReceipts(currentUser.disableReadReceipts === true);
      setIsHydrated(true);
    }
  }, [
    currentUser,
    setDisableReadReceipts,
    setHideAge,
    setHideDistance,
    setHideFromDiscover,
  ]);

  useEffect(() => {
    if (isDemoMode || isHydrated || !token) return;

    const timeout = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  }, [isHydrated, token]);

  useEffect(() => {
    if (!discoveryPauseEndsAt) return;

    const remainingMs = discoveryPauseEndsAt - Date.now();
    if (remainingMs <= 0) {
      setDiscoveryPauseEndsAt(null);
      // Only reflect legacy pause expiry here; persistent hideFromDiscover stays on.
      if (currentUser?.hideFromDiscover !== true) {
        setHideFromDiscover(false);
      }
      return;
    }

    const timeout = setTimeout(() => {
      setDiscoveryPauseEndsAt(null);
      if (currentUser?.hideFromDiscover !== true) {
        setHideFromDiscover(false);
      }
    }, remainingMs + 250);

    return () => clearTimeout(timeout);
  }, [currentUser?.hideFromDiscover, discoveryPauseEndsAt, setHideFromDiscover]);

  // Track if warning has been shown this session (session-only, no persistence needed)
  const [warningShownThisSession, setWarningShownThisSession] = useState(false);

  const isLoading = !isDemoMode && !!token && !isHydrated && currentUser !== null && !timedOut;
  const isUnavailable = !isDemoMode && (!token || currentUser === null || (!isHydrated && timedOut));

  // Handle "Hide from Discover" toggle with one-time warning (session-only)
  const handleHideFromDiscoverChange = useCallback(async (newValue: boolean) => {
    const applyChange = async () => {
      setHideFromDiscover(newValue);
      // Sync to backend in live mode
      if (!isDemoMode && userId) {
        try {
          await updatePrivacySettings({ authUserId: userId, hideFromDiscover: newValue });
          // Keep any existing legacy pause countdown if present. When turning OFF, clear countdown.
          setDiscoveryPauseEndsAt(newValue ? discoveryPauseEndsAt : null);
        } catch {
          Toast.show("Couldn't update setting. Please try again.");
          setHideFromDiscover(!newValue); // Revert on error
          setDiscoveryPauseEndsAt(discoveryPauseEndsAt);
        }
      }
    };

    if (newValue && !warningShownThisSession) {
      // Show one-time warning (session-scoped, no AsyncStorage needed)
      Alert.alert(
        'Hide from Discover',
        'While hidden, your profile won\'t appear in Discover. Existing matches can still chat with you.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'I Understand',
            onPress: () => {
              // Mark warning as shown for this session only
              setWarningShownThisSession(true);
              applyChange();
            },
          },
        ]
      );
      return; // Don't toggle yet, wait for user confirmation
    }
    applyChange();
  }, [warningShownThisSession, setHideFromDiscover, updatePrivacySettings, userId, discoveryPauseEndsAt]);

  const handleHideAgeChange = useCallback(async (newValue: boolean) => {
    setHideAge(newValue);
    if (!isDemoMode && userId) {
      try {
        await updatePrivacySettings({ authUserId: userId, hideAge: newValue });
      } catch {
        Toast.show("Couldn't update setting. Please try again.");
        setHideAge(!newValue);
      }
    }
  }, [setHideAge, updatePrivacySettings, userId]);

  const handleHideDistanceChange = useCallback(async (newValue: boolean) => {
    setHideDistance(newValue);
    if (!isDemoMode && userId) {
      try {
        await updatePrivacySettings({ authUserId: userId, hideDistance: newValue });
      } catch {
        Toast.show("Couldn't update setting. Please try again.");
        setHideDistance(!newValue);
      }
    }
  }, [setHideDistance, updatePrivacySettings, userId]);

  const handleDisableReadReceiptsChange = useCallback(async (newValue: boolean) => {
    setDisableReadReceipts(newValue);
    if (!isDemoMode && userId) {
      try {
        await updatePrivacySettings({ authUserId: userId, disableReadReceipts: newValue });
      } catch {
        Toast.show("Couldn't update setting. Please try again.");
        setDisableReadReceipts(!newValue);
      }
    }
  }, [setDisableReadReceipts, updatePrivacySettings, userId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateText}>Loading your privacy settings...</Text>
        </View>
      ) : isUnavailable ? (
        <View style={styles.stateContainer}>
          <Ionicons name="shield-outline" size={40} color={COLORS.textMuted} />
          <Text style={styles.stateText}>We couldn&apos;t load your privacy settings.</Text>
          <TouchableOpacity
            style={styles.stateButton}
            onPress={() => router.replace('/(main)/(tabs)/profile' as any)}
          >
            <Text style={styles.stateButtonText}>Back to Profile</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Visibility Toggles */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visibility</Text>

          {/* Hide from Discover */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Hide from Discover</Text>
              <Text style={styles.toggleDescription}>
                Your profile won't appear in Discover while this is on.
              </Text>
            </View>
            <Switch
              value={hideFromDiscover}
              onValueChange={handleHideFromDiscoverChange}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>

        </View>

        {/* Messaging */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Messaging</Text>

          {/* Disable read receipts */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Disable read receipts</Text>
              <Text style={styles.toggleDescription}>
                Others won't see when you've read their Phase-1 messages.
              </Text>
            </View>
            <Switch
              value={disableReadReceipts}
              onValueChange={handleDisableReadReceiptsChange}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>
        </View>

        {/* Profile */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile</Text>

          {/* Hide my age */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Hide my age</Text>
              <Text style={styles.toggleDescription}>
                Your age won't be shown on your Phase-1 profile.
              </Text>
            </View>
            <Switch
              value={hideAge}
              onValueChange={handleHideAgeChange}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>

          {/* Hide my distance */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Hide my distance</Text>
              <Text style={styles.toggleDescription}>
                Others won't see how far away you are in Phase-1.
              </Text>
            </View>
            <Switch
              value={hideDistance}
              onValueChange={handleHideDistanceChange}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>
        </View>

        {/* Location & Nearby */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location</Text>

          {/* Nearby Settings Link */}
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/(main)/nearby-settings' as any)}
          >
            <View style={styles.linkInfo}>
              <Ionicons name="location-outline" size={22} color={COLORS.text} style={styles.linkIcon} />
              <View>
                <Text style={styles.linkTitle}>Nearby Settings</Text>
                <Text style={styles.linkDescription}>
                  Control your visibility and discovery preferences
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

      </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stateText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  stateButton: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  stateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  // Toggle rows
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  // Link rows (for navigation items)
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  linkInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  linkIcon: {
    marginRight: 12,
  },
  linkTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  linkDescription: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
});
