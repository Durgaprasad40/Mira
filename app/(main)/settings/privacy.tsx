/*
 * LOCKED (PRIVACY SETTINGS)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 */
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
  const { token } = useAuthStore();

  // Query current user privacy settings (live mode only)
  const currentUser = useQuery(
    api.users.getCurrentUserFromToken,
    !isDemoMode && token ? { token } : 'skip'
  );

  // Mutations for backend sync
  const toggleDiscoveryPause = useMutation(api.users.toggleDiscoveryPause);

  // Privacy toggles from persisted store
  const hideFromDiscover = usePrivacyStore((s) => s.hideFromDiscover);

  const setHideFromDiscover = usePrivacyStore((s) => s.setHideFromDiscover);
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
      setHideFromDiscover(!!pauseUntil);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!discoveryPauseEndsAt) return;

    const remainingMs = discoveryPauseEndsAt - Date.now();
    if (remainingMs <= 0) {
      setDiscoveryPauseEndsAt(null);
      setHideFromDiscover(false);
      return;
    }

    const timeout = setTimeout(() => {
      setDiscoveryPauseEndsAt(null);
      setHideFromDiscover(false);
    }, remainingMs + 250);

    return () => clearTimeout(timeout);
  }, [discoveryPauseEndsAt, setHideFromDiscover]);

  // Track if warning has been shown this session (session-only, no persistence needed)
  const [warningShownThisSession, setWarningShownThisSession] = useState(false);

  // Handle "Hide from Discover" toggle with one-time warning (session-only)
  const handleHideFromDiscoverChange = useCallback(async (newValue: boolean) => {
    const applyChange = async () => {
      setHideFromDiscover(newValue);
      // Sync to backend in live mode
      if (!isDemoMode && token) {
        try {
          await toggleDiscoveryPause({ token, paused: newValue });
          setDiscoveryPauseEndsAt(newValue ? Date.now() + 24 * 60 * 60 * 1000 : null);
        } catch {
          Toast.show("Couldn't update setting. Please try again.");
          setHideFromDiscover(!newValue); // Revert on error
          setDiscoveryPauseEndsAt(newValue ? null : discoveryPauseEndsAt);
        }
      }
    };

    if (newValue && !warningShownThisSession) {
      // Show one-time warning (session-scoped, no AsyncStorage needed)
      Alert.alert(
        'Pause Discovery for 24 hours',
        'While paused, your profile won\'t appear in Discover for 24 hours. Existing matches can still chat with you.',
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
  }, [warningShownThisSession, setHideFromDiscover, toggleDiscoveryPause, token, discoveryPauseEndsAt]);

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
              <Text style={styles.toggleTitle}>Pause Discovery for 24 hours</Text>
              <Text style={styles.toggleDescription}>
                Your profile stays out of Discover for 24 hours, then turns back on automatically.
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
