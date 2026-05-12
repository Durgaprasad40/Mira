/*
 * LOCKED (NOTIFICATIONS SETTINGS)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { Toast } from '@/components/ui/Toast';

/**
 * Simplified Notifications Settings Screen
 *
 * Single toggle: "Enable Notifications"
 * - Backend-connected via api.users.updateNotificationSettings
 * - Persists across restart, device change, sign out/in
 * - Default: ON (notificationsEnabled = true in schema)
 */
export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const { token, userId } = useAuthStore();

  // Query current user to get notification setting (backend source of truth)
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && token ? { token } : 'skip'
  );

  // Mutation to update notification setting
  const updateNotificationSettings = useMutation(api.users.updateNotificationSettings);

  // Track hydration to prevent toggle flicker on load
  const [isHydrated, setIsHydrated] = useState(isDemoMode);
  const [timedOut, setTimedOut] = useState(false);

  // Local state for toggle (synced from backend)
  // Default to true until backend value loads
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // Sync state from backend when user data loads
  useEffect(() => {
    if (currentUser) {
      // Backend field: notificationsEnabled (defaults to true if undefined)
      setNotificationsEnabled(currentUser.notificationsEnabled !== false);
      setIsHydrated(true);

      if (__DEV__) {
        console.log('[Notifications] Hydrated from backend:', {
          notificationsEnabled: currentUser.notificationsEnabled,
        });
      }
    }
  }, [currentUser]);

  useEffect(() => {
    if (isDemoMode || isHydrated || !token) return;

    const timeout = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  }, [isHydrated, token]);

  const isLoading = !isDemoMode && !!token && !isHydrated && currentUser !== null && !timedOut;
  const isUnavailable = !isDemoMode && (!token || currentUser === null || (!isHydrated && timedOut));

  // Handle toggle change - persists to backend immediately
  const handleToggle = async (enabled: boolean) => {
    // Optimistic UI update
    const previousValue = notificationsEnabled;
    setNotificationsEnabled(enabled);

    // Demo mode: local only
    if (isDemoMode) {
      if (__DEV__) console.log('[Notifications] Demo mode - local toggle only');
      return;
    }

    if (!token || !userId) {
      setNotificationsEnabled(previousValue);
      return;
    }

    try {
      if (__DEV__) {
        console.log('[Notifications] Saving to backend:', { enabled });
      }

      await updateNotificationSettings({
        token,
        authUserId: userId,
        notificationsEnabled: enabled,
      });

      if (__DEV__) {
        console.log('[Notifications] Backend save successful');
      }
    } catch (error) {
      // Revert on failure
      setNotificationsEnabled(previousValue);
      Toast.show('Couldn\u2019t update notification settings. Please try again.');

      if (__DEV__) {
        console.error('[Notifications] Backend save failed:', error);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateText}>Loading your notification settings...</Text>
        </View>
      ) : isUnavailable ? (
        <View style={styles.stateContainer}>
          <Ionicons name="notifications-off-outline" size={40} color={COLORS.textMuted} />
          <Text style={styles.stateText}>We couldn&apos;t load your notification settings.</Text>
          <TouchableOpacity
            style={styles.stateButton}
            onPress={() => router.replace('/(main)/(tabs)/profile' as any)}
            accessibilityLabel="Back to profile"
          >
            <Text style={styles.stateButtonText}>Back to Profile</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.content}>
          {/* Single Toggle Row */}
          <View style={styles.toggleContainer}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <View style={styles.iconContainer}>
                  <Ionicons name="notifications" size={22} color={COLORS.white} />
                </View>
                <Text style={styles.toggleTitle}>Enable Notifications</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleToggle}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor={COLORS.white}
                accessibilityLabel="Enable notifications"
              />
            </View>

            {/* Helper text */}
            <Text style={styles.helperText}>
              Turn this off to stop push updates from Mira.
            </Text>
          </View>
        </View>
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
    paddingTop: 24,
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
  toggleContainer: {
    paddingHorizontal: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  helperText: {
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 20,
    marginTop: 12,
    paddingLeft: 54, // Align with text after icon
  },
});
