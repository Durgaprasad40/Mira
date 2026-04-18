/**
 * Phase-2 Privacy Settings Screen
 *
 * Deep Connect specific privacy controls:
 * - Hide from Deep Connect (not Discover)
 * - Hide age
 * - Hide distance
 * - Disable read receipts
 *
 * Uses Phase-2 dark premium styling (INCOGNITO_COLORS).
 * No Nearby or Phase-1 specific features.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Toast } from '@/components/ui/Toast';

const C = INCOGNITO_COLORS;

export default function PrivatePrivacyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Auth and backend mutation
  const { userId, token } = useAuthStore();
  const updatePrivateProfile = useMutation(api.privateProfiles.updateFieldsByAuthId);

  // Local store state (now persisted to backend via P0-1 fix)
  const hideFromDeepConnect = usePrivateProfileStore((s) => s.hideFromDeepConnect);
  const hideAge = usePrivateProfileStore((s) => s.hideAge);
  const hideDistance = usePrivateProfileStore((s) => s.hideDistance);
  const disableReadReceipts = usePrivateProfileStore((s) => s.disableReadReceipts);

  const setHideFromDeepConnect = usePrivateProfileStore((s) => s.setHideFromDeepConnect);
  const setHideAge = usePrivateProfileStore((s) => s.setHideAge);
  const setHideDistance = usePrivateProfileStore((s) => s.setHideDistance);
  const setDisableReadReceipts = usePrivateProfileStore((s) => s.setDisableReadReceipts);

  // Warning shown state (session only)
  const [warningShownThisSession, setWarningShownThisSession] = useState(false);

  // P0-001 FIX: Track which field is saving to prevent double-toggles and show loading
  const [savingField, setSavingField] = useState<string | null>(null);

  // P0-001 FIX: Helper to persist privacy setting to backend
  // Returns true on success, false on failure. Does NOT do optimistic UI update.
  const persistToBackend = useCallback(async (field: string, value: boolean): Promise<boolean> => {
    if (isDemoMode) {
      // Demo mode: Allow immediate UI update
      return true;
    }
    if (!userId || !token) {
      Toast.show('Please sign in to change settings.');
      return false;
    }

    setSavingField(field);
    try {
      await updatePrivateProfile({
        token,
        authUserId: userId,
        [field]: value,
      });
      return true;
    } catch (error) {
      if (__DEV__) console.error('[PrivatePrivacy] Backend sync failed:', error);
      Toast.show('Failed to save setting. Please try again.');
      return false;
    } finally {
      setSavingField(null);
    }
  }, [token, userId, updatePrivateProfile]);

  // P0-001 FIX: Handle "Hide from Deep Connect" toggle - waits for backend confirmation
  const handleHideFromDeepConnectChange = useCallback(async (newValue: boolean) => {
    if (savingField) return; // Prevent double-toggle while saving

    if (newValue && !warningShownThisSession) {
      Alert.alert(
        'Hide from Deep Connect',
        'While hidden, you won\'t appear in Deep Connect searches. Existing connections can still message you.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'I Understand',
            onPress: async () => {
              setWarningShownThisSession(true);
              const success = await persistToBackend('hideFromDeepConnect', newValue);
              if (success) {
                setHideFromDeepConnect(newValue);
              }
            },
          },
        ]
      );
      return;
    }
    const success = await persistToBackend('hideFromDeepConnect', newValue);
    if (success) {
      setHideFromDeepConnect(newValue);
    }
  }, [savingField, warningShownThisSession, setHideFromDeepConnect, persistToBackend]);

  // P0-001 FIX: Handle "Hide Age" toggle - waits for backend confirmation
  const handleHideAgeChange = useCallback(async (newValue: boolean) => {
    if (savingField) return;
    const success = await persistToBackend('hideAge', newValue);
    if (success) {
      setHideAge(newValue);
    }
  }, [savingField, setHideAge, persistToBackend]);

  // P0-001 FIX: Handle "Hide Distance" toggle - waits for backend confirmation
  const handleHideDistanceChange = useCallback(async (newValue: boolean) => {
    if (savingField) return;
    const success = await persistToBackend('hideDistance', newValue);
    if (success) {
      setHideDistance(newValue);
    }
  }, [savingField, setHideDistance, persistToBackend]);

  // P0-001 FIX: Handle "Disable Read Receipts" toggle - waits for backend confirmation
  const handleDisableReadReceiptsChange = useCallback(async (newValue: boolean) => {
    if (savingField) return;
    const success = await persistToBackend('disableReadReceipts', newValue);
    if (success) {
      setDisableReadReceipts(newValue);
    }
  }, [savingField, setDisableReadReceipts, persistToBackend]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Visibility Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visibility</Text>
          <Text style={styles.sectionSubtitle}>Control how you appear in Deep Connect</Text>

          {/* Hide from Deep Connect */}
          <View style={styles.toggleCard}>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => handleHideFromDeepConnectChange(!hideFromDeepConnect)}
              activeOpacity={0.7}
            >
              <View style={styles.toggleInfo}>
                <View style={[styles.toggleIconBox, hideFromDeepConnect && styles.toggleIconBoxActive]}>
                  <Ionicons name="eye-off-outline" size={20} color={hideFromDeepConnect ? '#FFF' : C.text} />
                </View>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.toggleTitle}>Hide from Deep Connect</Text>
                  <Text style={styles.toggleDescription}>
                    Your profile won't appear in Deep Connect while this is on
                  </Text>
                </View>
              </View>
              {savingField === 'hideFromDeepConnect' ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <Switch
                  value={hideFromDeepConnect}
                  onValueChange={handleHideFromDeepConnectChange}
                  trackColor={{ false: C.border, true: C.primary }}
                  thumbColor="#FFF"
                  disabled={savingField !== null}
                />
              )}
            </TouchableOpacity>
          </View>

          {/* Hide Age */}
          <View style={styles.toggleCard}>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => handleHideAgeChange(!hideAge)}
              activeOpacity={0.7}
            >
              <View style={styles.toggleInfo}>
                <View style={[styles.toggleIconBox, hideAge && styles.toggleIconBoxActive]}>
                  <Ionicons name="calendar-outline" size={20} color={hideAge ? '#FFF' : C.text} />
                </View>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.toggleTitle}>Hide my age</Text>
                  <Text style={styles.toggleDescription}>
                    Your age won't be shown on your profile
                  </Text>
                </View>
              </View>
              {savingField === 'hideAge' ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <Switch
                  value={hideAge}
                  onValueChange={handleHideAgeChange}
                  trackColor={{ false: C.border, true: C.primary }}
                  thumbColor="#FFF"
                  disabled={savingField !== null}
                />
              )}
            </TouchableOpacity>
          </View>

          {/* Hide Distance */}
          <View style={styles.toggleCard}>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => handleHideDistanceChange(!hideDistance)}
              activeOpacity={0.7}
            >
              <View style={styles.toggleInfo}>
                <View style={[styles.toggleIconBox, hideDistance && styles.toggleIconBoxActive]}>
                  <Ionicons name="location-outline" size={20} color={hideDistance ? '#FFF' : C.text} />
                </View>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.toggleTitle}>Hide my distance</Text>
                  <Text style={styles.toggleDescription}>
                    Others won't see how far away you are
                  </Text>
                </View>
              </View>
              {savingField === 'hideDistance' ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <Switch
                  value={hideDistance}
                  onValueChange={handleHideDistanceChange}
                  trackColor={{ false: C.border, true: C.primary }}
                  thumbColor="#FFF"
                  disabled={savingField !== null}
                />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Messaging Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Messaging</Text>
          <Text style={styles.sectionSubtitle}>Control messaging behavior</Text>

          {/* Disable Read Receipts */}
          <View style={styles.toggleCard}>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => handleDisableReadReceiptsChange(!disableReadReceipts)}
              activeOpacity={0.7}
            >
              <View style={styles.toggleInfo}>
                <View style={[styles.toggleIconBox, disableReadReceipts && styles.toggleIconBoxActive]}>
                  <Ionicons name="checkmark-done-outline" size={20} color={disableReadReceipts ? '#FFF' : C.text} />
                </View>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.toggleTitle}>Disable read receipts</Text>
                  <Text style={styles.toggleDescription}>
                    Others won't see when you read their messages
                  </Text>
                </View>
              </View>
              {savingField === 'disableReadReceipts' ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <Switch
                  value={disableReadReceipts}
                  onValueChange={handleDisableReadReceiptsChange}
                  trackColor={{ false: C.border, true: C.primary }}
                  thumbColor="#FFF"
                  disabled={savingField !== null}
                />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Privacy Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoCard}>
            <Ionicons name="shield-checkmark-outline" size={22} color={C.primary} />
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoTitle}>Your Privacy Matters</Text>
              <Text style={styles.infoText}>
                These settings only affect your Deep Connect profile. Your Phase-1 profile settings are managed separately.
              </Text>
            </View>
          </View>
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
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 14,
  },
  toggleCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  toggleIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  toggleIconBoxActive: {
    backgroundColor: C.primary,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 17,
  },
  infoSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
});
