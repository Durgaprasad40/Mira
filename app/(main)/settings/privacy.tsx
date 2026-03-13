import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
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
  const { userId, token } = useAuthStore();

  // Query current user privacy settings (live mode only)
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  // Mutations for backend sync
  const toggleDiscoveryPause = useMutation(api.users.toggleDiscoveryPause);
  const updateNearbySettings = useMutation(api.users.updateNearbySettings);
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

  // Hydrate local state from backend on load (live mode only)
  useEffect(() => {
    if (currentUser) {
      // Sync hideFromDiscover from isDiscoveryPaused
      if (currentUser.isDiscoveryPaused !== undefined) {
        setHideFromDiscover(currentUser.isDiscoveryPaused);
      }
      // Sync hideDistance
      if (currentUser.hideDistance !== undefined) {
        setHideDistance(currentUser.hideDistance);
      }
      // Sync hideAge
      if (currentUser.hideAge !== undefined) {
        setHideAge(currentUser.hideAge);
      }
      // Sync disableReadReceipts
      if (currentUser.disableReadReceipts !== undefined) {
        setDisableReadReceipts(currentUser.disableReadReceipts);
      }
    }
  }, [currentUser]);

  // Track if warning has been shown this session (session-only, no persistence needed)
  const [warningShownThisSession, setWarningShownThisSession] = useState(false);

  // Handle "Hide from Discover" toggle with one-time warning (session-only)
  const handleHideFromDiscoverChange = useCallback(async (newValue: boolean) => {
    const applyChange = async () => {
      setHideFromDiscover(newValue);
      // Sync to backend in live mode
      if (!isDemoMode && userId && currentUser?._id) {
        try {
          await toggleDiscoveryPause({ userId: currentUser._id, token: token ?? undefined, paused: newValue });
        } catch {
          Toast.show("Couldn't update setting. Please try again.");
          setHideFromDiscover(!newValue); // Revert on error
        }
      }
    };

    if (newValue && !warningShownThisSession) {
      // Show one-time warning (session-scoped, no AsyncStorage needed)
      Alert.alert(
        'Hide from Discover',
        'While hidden from Discover, you won\'t get new matches. Existing matches can still chat with you.',
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
  }, [warningShownThisSession, setHideFromDiscover, userId, currentUser, toggleDiscoveryPause, token]);

  // Handle "Hide Distance" toggle with backend sync
  const handleHideDistanceChange = useCallback(async (newValue: boolean) => {
    setHideDistance(newValue);
    // Sync to backend in live mode
    if (!isDemoMode && userId && currentUser?._id) {
      try {
        await updateNearbySettings({ userId: currentUser._id, token: token ?? undefined, hideDistance: newValue });
      } catch {
        Toast.show("Couldn't update setting. Please try again.");
        setHideDistance(!newValue); // Revert on error
      }
    }
  }, [setHideDistance, userId, currentUser, updateNearbySettings, token]);

  // Handle "Hide Age" toggle with backend sync
  const handleHideAgeChange = useCallback(async (newValue: boolean) => {
    setHideAge(newValue);
    // Sync to backend in live mode
    if (!isDemoMode && userId && currentUser?._id) {
      try {
        await updatePrivacySettings({ userId: currentUser._id, token: token ?? undefined, hideAge: newValue });
      } catch {
        Toast.show("Couldn't update setting. Please try again.");
        setHideAge(!newValue); // Revert on error
      }
    }
  }, [setHideAge, userId, currentUser, updatePrivacySettings, token]);

  // Handle "Disable Read Receipts" toggle with backend sync
  const handleDisableReadReceiptsChange = useCallback(async (newValue: boolean) => {
    setDisableReadReceipts(newValue);
    // Sync to backend in live mode
    if (!isDemoMode && userId && currentUser?._id) {
      try {
        await updatePrivacySettings({ userId: currentUser._id, token: token ?? undefined, disableReadReceipts: newValue });
      } catch {
        Toast.show("Couldn't update setting. Please try again.");
        setDisableReadReceipts(!newValue); // Revert on error
      }
    }
  }, [setDisableReadReceipts, userId, currentUser, updatePrivacySettings, token]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Visibility Toggles */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visibility</Text>

          {/* Hide from Discover */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Hide me from Discover</Text>
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

          {/* Hide Age */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Hide my age</Text>
              <Text style={styles.toggleDescription}>
                Your age will not be shown on your profile.
              </Text>
            </View>
            <Switch
              value={hideAge}
              onValueChange={handleHideAgeChange}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>

          {/* Hide Distance */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Hide my distance</Text>
              <Text style={styles.toggleDescription}>
                Other users won't see how far away you are.
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

        {/* Messaging */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Messaging</Text>

          {/* Disable Read Receipts (asymmetric) */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Disable read receipts</Text>
              <Text style={styles.toggleDescription}>
                Others won't see when you read their messages. You can still see theirs.
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

      </ScrollView>
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
});
