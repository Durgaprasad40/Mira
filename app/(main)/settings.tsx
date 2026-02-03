import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Switch,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, SORT_OPTIONS, GENDER_OPTIONS } from '@/lib/constants';
import { Button, Input } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useFilterStore } from '@/stores/filterStore';
import { isDemoMode } from '@/hooks/useConvex';
import { BlurProfileNotice } from '@/components/profile/BlurProfileNotice';
import { DEMO_USER } from '@/lib/demoData';
import type { Gender } from '@/types';

export default function SettingsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );
  const currentUser = isDemoMode ? (DEMO_USER as any) : currentUserQuery;

  // Hard timeout for loading state
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isDemoMode) return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const updatePreferences = useMutation(api.users.updatePreferences);
  const toggleIncognito = useMutation(api.users.toggleIncognito);
  const toggleDiscoveryPause = useMutation(api.users.toggleDiscoveryPause);
  const togglePhotoBlurMut = isDemoMode ? null : useMutation(api.users.togglePhotoBlur);
  // toggleShowLastSeen is handled locally until a Convex mutation is added

  const {
    minAge,
    maxAge,
    maxDistance,
    gender: lookingFor,
    setMinAge,
    setMaxAge,
    setMaxDistance,
    toggleGender,
  } = useFilterStore();

  const [localMinAge, setLocalMinAge] = useState(minAge.toString());
  const [localMaxAge, setLocalMaxAge] = useState(maxAge.toString());
  const [localMaxDistance, setLocalMaxDistance] = useState(maxDistance.toString());
  const [incognitoEnabled, setIncognitoEnabled] = useState(currentUser?.incognitoMode || false);
  const [pauseEnabled, setPauseEnabled] = useState(false);
  const [showLastSeenEnabled, setShowLastSeenEnabled] = useState(currentUser?.showLastSeen !== false);
  const [blurEnabled, setBlurEnabled] = useState(currentUser?.photoBlurred === true);
  const [showBlurNotice, setShowBlurNotice] = useState(false);

  React.useEffect(() => {
    if (currentUser) {
      setLocalMinAge(currentUser.minAge.toString());
      setLocalMaxAge(currentUser.maxAge.toString());
      setLocalMaxDistance(currentUser.maxDistance.toString());
      setIncognitoEnabled(currentUser.incognitoMode || false);
      setShowLastSeenEnabled(currentUser.showLastSeen !== false);
      // Check if pause is active and not expired
      const isPaused =
        currentUser.isDiscoveryPaused === true &&
        typeof currentUser.discoveryPausedUntil === 'number' &&
        currentUser.discoveryPausedUntil > Date.now();
      setPauseEnabled(isPaused);
      setBlurEnabled(currentUser.photoBlurred === true);
    }
  }, [currentUser]);

  const handleSavePreferences = async () => {
    if (!userId) return;

    try {
      await updatePreferences({
        userId: userId as any,
        minAge: parseInt(localMinAge),
        maxAge: parseInt(localMaxAge),
        maxDistance: parseInt(localMaxDistance),
        lookingFor: lookingFor.length > 0 ? lookingFor : undefined,
      });
      setMinAge(parseInt(localMinAge));
      setMaxAge(parseInt(localMaxAge));
      setMaxDistance(parseInt(localMaxDistance));
      Alert.alert('Success', 'Preferences updated!');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update preferences');
    }
  };

  const handleTogglePause = async (paused: boolean) => {
    if (isDemoMode) {
      setPauseEnabled(paused);
      return;
    }
    if (!userId) return;

    try {
      await toggleDiscoveryPause({ userId: userId as any, paused });
      setPauseEnabled(paused);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to toggle pause');
      setPauseEnabled(!paused);
    }
  };

  const handleToggleLastSeen = async (show: boolean) => {
    setShowLastSeenEnabled(show);
  };

  const handleBlurToggle = (newValue: boolean) => {
    if (newValue) {
      setShowBlurNotice(true);
    } else {
      if (isDemoMode) { setBlurEnabled(false); return; }
      if (!userId || !togglePhotoBlurMut) return;
      togglePhotoBlurMut({ userId: userId as any, blurred: false })
        .then(() => setBlurEnabled(false))
        .catch((err: any) => Alert.alert('Error', err.message));
    }
  };

  const handleBlurConfirm = async () => {
    setShowBlurNotice(false);
    if (isDemoMode) { setBlurEnabled(true); return; }
    if (!userId || !togglePhotoBlurMut) return;
    try {
      await togglePhotoBlurMut({ userId: userId as any, blurred: true });
      setBlurEnabled(true);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleToggleIncognito = async (enabled: boolean) => {
    if (!userId) return;

    try {
      await toggleIncognito({ userId: userId as any, enabled });
      setIncognitoEnabled(enabled);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update discovery visibility');
      setIncognitoEnabled(!enabled);
    }
  };

  if (!currentUser) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{timedOut ? 'Failed to load settings' : 'Loading...'}</Text>
        <TouchableOpacity style={styles.loadingBackButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={COLORS.white} />
          <Text style={styles.loadingBackText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const canUseIncognito =
    currentUser.gender === 'female' || currentUser.subscriptionTier === 'premium';

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Blur Notice Modal */}
      <BlurProfileNotice
        visible={showBlurNotice}
        onConfirm={handleBlurConfirm}
        onCancel={() => setShowBlurNotice(false)}
      />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Discovery Preferences</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Looking for</Text>
          <View style={styles.chips}>
            {GENDER_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.chip,
                  lookingFor.includes(option.value as Gender) && styles.chipSelected,
                ]}
                onPress={() => toggleGender(option.value as Gender)}
              >
                <Text
                  style={[
                    styles.chipText,
                    lookingFor.includes(option.value as Gender) && styles.chipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Age Range</Text>
          <View style={styles.ageRow}>
            <Input
              placeholder="Min"
              value={localMinAge}
              onChangeText={setLocalMinAge}
              keyboardType="numeric"
              style={styles.ageInput}
            />
            <Text style={styles.ageSeparator}>to</Text>
            <Input
              placeholder="Max"
              value={localMaxAge}
              onChangeText={setLocalMaxAge}
              keyboardType="numeric"
              style={styles.ageInput}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Maximum Distance (miles)</Text>
          <Input
            placeholder="Distance"
            value={localMaxDistance}
            onChangeText={setLocalMaxDistance}
            keyboardType="numeric"
            style={styles.distanceInput}
          />
        </View>

        <Button
          title="Save Preferences"
          variant="primary"
          onPress={handleSavePreferences}
          style={styles.saveButton}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Blur My Photo</Text>
            <Text style={styles.settingDescription}>
              {blurEnabled
                ? 'Your photo is blurred across Discover and your profile'
                : 'Blur your photo to protect your privacy'}
            </Text>
          </View>
          <Switch
            value={blurEnabled}
            onValueChange={handleBlurToggle}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
            thumbColor={COLORS.white}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Hide from Discovery</Text>
            <Text style={styles.settingDescription}>
              Browse profiles without appearing in others' feeds
              {!canUseIncognito && ' (Premium required)'}
            </Text>
          </View>
          <Switch
            value={incognitoEnabled}
            onValueChange={handleToggleIncognito}
            disabled={!canUseIncognito}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
            thumbColor={COLORS.white}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Show Last Seen</Text>
            <Text style={styles.settingDescription}>
              Let others see when you were last active
            </Text>
          </View>
          <Switch
            value={showLastSeenEnabled}
            onValueChange={handleToggleLastSeen}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
            thumbColor={COLORS.white}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Pause Matching</Text>
            <Text style={styles.settingDescription}>
              {pauseEnabled && currentUser?.discoveryPausedUntil
                ? `Paused until ${new Date(currentUser.discoveryPausedUntil).toLocaleString()}`
                : 'Hide from discovery for 24 hours'}
            </Text>
          </View>
          <Switch
            value={pauseEnabled}
            onValueChange={handleTogglePause}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
            thumbColor={COLORS.white}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <Text style={styles.sectionSubtitle}>
          Manage your notification preferences
        </Text>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Push Notifications</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Email Notifications</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Safety</Text>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(main)/community-guidelines' as any)}
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.text} style={{ marginRight: 10 }} />
          <Text style={[styles.menuText, { flex: 1 }]}>Community Guidelines</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(main)/safety-reporting' as any)}
        >
          <Ionicons name="warning-outline" size={20} color={COLORS.text} style={{ marginRight: 10 }} />
          <Text style={[styles.menuText, { flex: 1 }]}>Safety & Reporting</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(main)/edit-profile')}
        >
          <Text style={styles.menuText}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Help & Support</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
      </View>
    </ScrollView>
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
  loadingBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
  },
  loadingBackText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
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
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  chipTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ageInput: {
    flex: 1,
  },
  ageSeparator: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  distanceInput: {
    width: 150,
  },
  saveButton: {
    marginTop: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuText: {
    fontSize: 16,
    color: COLORS.text,
  },
});
