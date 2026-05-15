import React, { useCallback, useState } from 'react';
import { Alert, View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';

const C = INCOGNITO_COLORS;

type PhotoVisibility = 'public' | 'blurred' | 'private';
type SecureMediaTimer = 0 | 10 | 30;
type SecureMediaViewingMode = 'tap' | 'hold';
type SavingField =
  | 'defaultPhotoVisibility'
  | 'allowUnblurRequests'
  | 'defaultSecureMediaTimer'
  | 'defaultSecureMediaViewingMode'
  | null;

export default function PhotoMediaPrivacyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const updateFieldsByAuthId = useMutation(api.privateProfiles.updateFieldsByAuthId);

  const defaultPhotoVisibility = usePrivateProfileStore((s) => s.defaultPhotoVisibility);
  const allowUnblurRequests = usePrivateProfileStore((s) => s.allowUnblurRequests);
  const defaultSecureMediaTimer = usePrivateProfileStore((s) => s.defaultSecureMediaTimer);
  const defaultSecureMediaViewingMode = usePrivateProfileStore((s) => s.defaultSecureMediaViewingMode);

  const setDefaultPhotoVisibility = usePrivateProfileStore((s) => s.setDefaultPhotoVisibility);
  const setAllowUnblurRequests = usePrivateProfileStore((s) => s.setAllowUnblurRequests);
  const setDefaultSecureMediaTimer = usePrivateProfileStore((s) => s.setDefaultSecureMediaTimer);
  const setDefaultSecureMediaViewingMode = usePrivateProfileStore((s) => s.setDefaultSecureMediaViewingMode);

  const [savingField, setSavingField] = useState<SavingField>(null);

  const showSaveErrorAlert = useCallback(() => {
    Alert.alert('Could not save settings', 'Please try again.');
  }, []);

  /**
   * Persist current store snapshot, with optimistic-update + rollback on failure.
   * Mirrors the awaited pattern used in private-notifications.tsx.
   */
  const persistField = useCallback(
    async (
      field: Exclude<SavingField, null>,
      rollback: () => void,
    ) => {
      if (!authUserId || !token) {
        rollback();
        showSaveErrorAlert();
        return;
      }

      setSavingField(field);
      try {
        const {
          defaultPhotoVisibility: nextVisibility,
          allowUnblurRequests: nextAllowUnblur,
          defaultSecureMediaTimer: nextTimer,
          defaultSecureMediaViewingMode: nextViewingMode,
        } = usePrivateProfileStore.getState();

        const res = await updateFieldsByAuthId({
          token,
          authUserId,
          defaultPhotoVisibility: nextVisibility,
          allowUnblurRequests: nextAllowUnblur,
          defaultSecureMediaTimer: nextTimer,
          defaultSecureMediaViewingMode: nextViewingMode,
        });

        if (!res?.success) {
          rollback();
          showSaveErrorAlert();
          if (__DEV__) {
            console.warn('[PhotoMediaPrivacy] updateFieldsByAuthId:', res?.error);
          }
        }
      } catch (err) {
        rollback();
        showSaveErrorAlert();
        if (__DEV__) {
          console.warn('[PhotoMediaPrivacy] updateFieldsByAuthId failed', err);
        }
      } finally {
        setSavingField(null);
      }
    },
    [authUserId, token, updateFieldsByAuthId, showSaveErrorAlert],
  );

  const onVisibilityChange = useCallback(
    (visibility: PhotoVisibility) => {
      if (savingField || visibility === defaultPhotoVisibility) return;
      const prev = defaultPhotoVisibility;
      setDefaultPhotoVisibility(visibility);
      void persistField('defaultPhotoVisibility', () => setDefaultPhotoVisibility(prev));
    },
    [savingField, defaultPhotoVisibility, setDefaultPhotoVisibility, persistField],
  );

  const onAllowUnblurChange = useCallback(
    (allow: boolean) => {
      if (savingField || allow === allowUnblurRequests) return;
      const prev = allowUnblurRequests;
      setAllowUnblurRequests(allow);
      void persistField('allowUnblurRequests', () => setAllowUnblurRequests(prev));
    },
    [savingField, allowUnblurRequests, setAllowUnblurRequests, persistField],
  );

  const onSecureMediaTimerChange = useCallback(
    (timer: SecureMediaTimer) => {
      if (savingField || timer === defaultSecureMediaTimer) return;
      const prev = defaultSecureMediaTimer;
      setDefaultSecureMediaTimer(timer);
      void persistField('defaultSecureMediaTimer', () => setDefaultSecureMediaTimer(prev));
    },
    [savingField, defaultSecureMediaTimer, setDefaultSecureMediaTimer, persistField],
  );

  const onViewingModeChange = useCallback(
    (mode: SecureMediaViewingMode) => {
      if (savingField || mode === defaultSecureMediaViewingMode) return;
      const prev = defaultSecureMediaViewingMode;
      setDefaultSecureMediaViewingMode(mode);
      void persistField('defaultSecureMediaViewingMode', () => setDefaultSecureMediaViewingMode(prev));
    },
    [savingField, defaultSecureMediaViewingMode, setDefaultSecureMediaViewingMode, persistField],
  );

  const renderSavingIndicator = (field: Exclude<SavingField, null>) =>
    savingField === field ? (
      <ActivityIndicator size="small" color={C.primary} style={styles.savingIndicator} />
    ) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Photo & Media Privacy</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Default Photo Visibility */}
        <View style={styles.settingSection}>
          <View style={styles.labelRow}>
            <Text style={styles.settingLabel}>Default Photo Visibility</Text>
            {renderSavingIndicator('defaultPhotoVisibility')}
          </View>
          <Text style={styles.settingDescription}>
            How your photos appear to others by default
          </Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segment, defaultPhotoVisibility === 'public' && styles.segmentActive]}
              onPress={() => onVisibilityChange('public')}
              disabled={savingField !== null}
            >
              <Text style={[styles.segmentText, defaultPhotoVisibility === 'public' && styles.segmentTextActive]}>
                Public
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultPhotoVisibility === 'blurred' && styles.segmentActive]}
              onPress={() => onVisibilityChange('blurred')}
              disabled={savingField !== null}
            >
              <Text style={[styles.segmentText, defaultPhotoVisibility === 'blurred' && styles.segmentTextActive]}>
                Blurred
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultPhotoVisibility === 'private' && styles.segmentActive]}
              onPress={() => onVisibilityChange('private')}
              disabled={savingField !== null}
            >
              <Text style={[styles.segmentText, defaultPhotoVisibility === 'private' && styles.segmentTextActive]}>
                Private
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Allow Unblur Requests */}
        <View style={styles.settingSection}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.settingLabel}>Allow Unblur Requests</Text>
              <Text style={styles.settingDescription}>
                Let others request to see blurred photos
              </Text>
            </View>
            {savingField === 'allowUnblurRequests' ? (
              <ActivityIndicator size="small" color={C.primary} />
            ) : (
              <Switch
                value={allowUnblurRequests}
                onValueChange={onAllowUnblurChange}
                trackColor={{ false: C.border, true: C.primary }}
                thumbColor="#FFF"
                disabled={savingField !== null}
              />
            )}
          </View>
        </View>

        {/* Default Secure Media Timer */}
        <View style={styles.settingSection}>
          <View style={styles.labelRow}>
            <Text style={styles.settingLabel}>Default Secure Media Timer</Text>
            {renderSavingIndicator('defaultSecureMediaTimer')}
          </View>
          <Text style={styles.settingDescription}>
            Auto-delete secure photos/videos after viewing
          </Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segment, defaultSecureMediaTimer === 0 && styles.segmentActive]}
              onPress={() => onSecureMediaTimerChange(0)}
              disabled={savingField !== null}
            >
              <Text style={[styles.segmentText, defaultSecureMediaTimer === 0 && styles.segmentTextActive]}>
                Off
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultSecureMediaTimer === 10 && styles.segmentActive]}
              onPress={() => onSecureMediaTimerChange(10)}
              disabled={savingField !== null}
            >
              <Text style={[styles.segmentText, defaultSecureMediaTimer === 10 && styles.segmentTextActive]}>
                10s
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultSecureMediaTimer === 30 && styles.segmentActive]}
              onPress={() => onSecureMediaTimerChange(30)}
              disabled={savingField !== null}
            >
              <Text style={[styles.segmentText, defaultSecureMediaTimer === 30 && styles.segmentTextActive]}>
                30s
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Default Secure Media Viewing Mode */}
        <View style={styles.settingSection}>
          <View style={styles.labelRow}>
            <Text style={styles.settingLabel}>Secure Media Viewing</Text>
            {renderSavingIndicator('defaultSecureMediaViewingMode')}
          </View>
          <Text style={styles.settingDescription}>
            How secure photos/videos are revealed when you open them
          </Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segment, defaultSecureMediaViewingMode === 'tap' && styles.segmentActive]}
              onPress={() => onViewingModeChange('tap')}
              disabled={savingField !== null}
            >
              <Text style={[styles.segmentText, defaultSecureMediaViewingMode === 'tap' && styles.segmentTextActive]}>
                Tap to reveal
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultSecureMediaViewingMode === 'hold' && styles.segmentActive]}
              onPress={() => onViewingModeChange('hold')}
              disabled={savingField !== null}
            >
              <Text style={[styles.segmentText, defaultSecureMediaViewingMode === 'hold' && styles.segmentTextActive]}>
                Hold to reveal
              </Text>
            </TouchableOpacity>
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
    borderBottomColor: C.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    gap: 24,
  },
  settingSection: {
    gap: 12,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  settingDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: C.primary,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    textAlign: 'center',
  },
  segmentTextActive: {
    color: '#FFF',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  toggleInfo: {
    flex: 1,
    gap: 4,
  },
  savingIndicator: {
    marginLeft: 4,
  },
});
