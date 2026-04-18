import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';

const C = INCOGNITO_COLORS;

export default function PhotoMediaPrivacyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const updateFieldsByAuthId = useMutation(api.privateProfiles.updateFieldsByAuthId);

  const defaultPhotoVisibility = usePrivateProfileStore((s) => s.defaultPhotoVisibility);
  const allowUnblurRequests = usePrivateProfileStore((s) => s.allowUnblurRequests);
  const defaultSecureMediaTimer = usePrivateProfileStore((s) => s.defaultSecureMediaTimer);

  const setDefaultPhotoVisibility = usePrivateProfileStore((s) => s.setDefaultPhotoVisibility);
  const setAllowUnblurRequests = usePrivateProfileStore((s) => s.setAllowUnblurRequests);
  const setDefaultSecureMediaTimer = usePrivateProfileStore((s) => s.setDefaultSecureMediaTimer);

  const persistPhotoMediaPrivacy = useCallback(() => {
    if (!authUserId || !token) return;
    const {
      defaultPhotoVisibility,
      allowUnblurRequests,
      defaultSecureMediaTimer,
      defaultSecureMediaViewingMode,
    } = usePrivateProfileStore.getState();
    void updateFieldsByAuthId({
      token,
      authUserId,
      defaultPhotoVisibility,
      allowUnblurRequests,
      defaultSecureMediaTimer,
      defaultSecureMediaViewingMode,
    })
      .then((res) => {
        if (res && !res.success && __DEV__) {
          console.warn('[PhotoMediaPrivacy] updateFieldsByAuthId:', res.error);
        }
      })
      .catch((err) => {
        if (__DEV__) {
          console.warn('[PhotoMediaPrivacy] updateFieldsByAuthId failed', err);
        }
      });
  }, [authUserId, token, updateFieldsByAuthId]);

  const onVisibilityChange = useCallback(
    (visibility: 'public' | 'blurred' | 'private') => {
      setDefaultPhotoVisibility(visibility);
      persistPhotoMediaPrivacy();
    },
    [setDefaultPhotoVisibility, persistPhotoMediaPrivacy]
  );

  const onAllowUnblurChange = useCallback(
    (allow: boolean) => {
      setAllowUnblurRequests(allow);
      persistPhotoMediaPrivacy();
    },
    [setAllowUnblurRequests, persistPhotoMediaPrivacy]
  );

  const onSecureMediaTimerChange = useCallback(
    (timer: 0 | 10 | 30) => {
      setDefaultSecureMediaTimer(timer);
      persistPhotoMediaPrivacy();
    },
    [setDefaultSecureMediaTimer, persistPhotoMediaPrivacy]
  );

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
          <Text style={styles.settingLabel}>Default Photo Visibility</Text>
          <Text style={styles.settingDescription}>
            How your photos appear to others by default
          </Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segment, defaultPhotoVisibility === 'public' && styles.segmentActive]}
              onPress={() => onVisibilityChange('public')}
            >
              <Text style={[styles.segmentText, defaultPhotoVisibility === 'public' && styles.segmentTextActive]}>
                Public
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultPhotoVisibility === 'blurred' && styles.segmentActive]}
              onPress={() => onVisibilityChange('blurred')}
            >
              <Text style={[styles.segmentText, defaultPhotoVisibility === 'blurred' && styles.segmentTextActive]}>
                Blurred
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultPhotoVisibility === 'private' && styles.segmentActive]}
              onPress={() => onVisibilityChange('private')}
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
            <Switch
              value={allowUnblurRequests}
              onValueChange={onAllowUnblurChange}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#FFF"
            />
          </View>
        </View>

        {/* Default Secure Media Timer */}
        <View style={styles.settingSection}>
          <Text style={styles.settingLabel}>Default Secure Media Timer</Text>
          <Text style={styles.settingDescription}>
            Auto-delete secure photos/videos after viewing
          </Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segment, defaultSecureMediaTimer === 0 && styles.segmentActive]}
              onPress={() => onSecureMediaTimerChange(0)}
            >
              <Text style={[styles.segmentText, defaultSecureMediaTimer === 0 && styles.segmentTextActive]}>
                Off
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultSecureMediaTimer === 10 && styles.segmentActive]}
              onPress={() => onSecureMediaTimerChange(10)}
            >
              <Text style={[styles.segmentText, defaultSecureMediaTimer === 10 && styles.segmentTextActive]}>
                10s
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, defaultSecureMediaTimer === 30 && styles.segmentActive]}
              onPress={() => onSecureMediaTimerChange(30)}
            >
              <Text style={[styles.segmentText, defaultSecureMediaTimer === 30 && styles.segmentTextActive]}>
                30s
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
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: C.primary,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textLight,
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
});
