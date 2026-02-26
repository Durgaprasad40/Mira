import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePrivacyStore } from '@/stores/privacyStore';

// Key for tracking if user has seen the hide-from-discover warning
const HIDE_DISCOVER_WARNING_KEY = 'mira:privacy:hideDiscoverWarningShown';

export default function PrivacySettingsScreen() {
  const router = useRouter();

  // Privacy toggles from persisted store
  const hideFromDiscover = usePrivacyStore((s) => s.hideFromDiscover);
  const hideAge = usePrivacyStore((s) => s.hideAge);
  const hideDistance = usePrivacyStore((s) => s.hideDistance);
  const disableReadReceipts = usePrivacyStore((s) => s.disableReadReceipts);

  const setHideFromDiscover = usePrivacyStore((s) => s.setHideFromDiscover);
  const setHideAge = usePrivacyStore((s) => s.setHideAge);
  const setHideDistance = usePrivacyStore((s) => s.setHideDistance);
  const setDisableReadReceipts = usePrivacyStore((s) => s.setDisableReadReceipts);

  // Track if warning has been shown this session (to avoid checking storage every toggle)
  const [warningShownThisSession, setWarningShownThisSession] = useState(false);

  // Handle "Hide from Discover" toggle with one-time warning
  const handleHideFromDiscoverChange = useCallback(async (newValue: boolean) => {
    if (newValue && !warningShownThisSession) {
      // Check if user has ever seen the warning
      try {
        const hasSeenWarning = await AsyncStorage.getItem(HIDE_DISCOVER_WARNING_KEY);
        if (!hasSeenWarning) {
          // Show one-time warning
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
                onPress: async () => {
                  // Mark warning as shown permanently
                  await AsyncStorage.setItem(HIDE_DISCOVER_WARNING_KEY, 'true');
                  setWarningShownThisSession(true);
                  setHideFromDiscover(true);
                },
              },
            ]
          );
          return; // Don't toggle yet, wait for user confirmation
        }
      } catch (error) {
        // If storage fails, still allow the toggle
        if (__DEV__) console.log('[Privacy] Failed to check warning status:', error);
      }
    }
    setHideFromDiscover(newValue);
  }, [warningShownThisSession]);

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
              onValueChange={setHideAge}
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
              onValueChange={setHideDistance}
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
              onValueChange={setDisableReadReceipts}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>
        </View>

        {/* Account Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(main)/settings/account' as any)}
            activeOpacity={0.7}
          >
            <View style={styles.menuRowLeft}>
              <Ionicons name="trash-outline" size={22} color={COLORS.error} />
              <View style={styles.menuRowInfo}>
                <Text style={[styles.menuRowTitle, { color: COLORS.error }]}>Delete account</Text>
                <Text style={styles.menuRowSubtitle}>Permanently remove your account and data</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
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
  // Menu rows (for navigation items)
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  menuRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  menuRowInfo: {
    flex: 1,
  },
  menuRowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  menuRowSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
});
