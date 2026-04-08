/**
 * Nearby Settings Screen
 *
 * User-facing settings for Nearby visibility, privacy, and crossed paths.
 * Part of Phase-1 Profile settings.
 *
 * HARDENING (v2):
 * - Added Location Mode selector (foreground vs background)
 * - Added effective status display
 * - Graceful fallback when background permission denied
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { Toast } from '@/components/ui/Toast';
import { getDemoCurrentUser } from '@/lib/demoData';
import {
  startBackgroundLocation,
  stopBackgroundLocation,
  getLocationModeStatus,
  setPreferredLocationMode,
  type NearbyLocationMode,
} from '@/utils/backgroundLocation';

type VisibilityMode = 'always' | 'app_open' | 'recent';

// Location mode options for user selection
const LOCATION_MODE_OPTIONS: {
  value: NearbyLocationMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'foreground',
    label: 'While Using the App',
    description: 'Location tracked only when app is open',
  },
  {
    value: 'background',
    label: 'Background Nearby',
    description: 'Location updates even when app is closed',
  },
];

const VISIBILITY_OPTIONS: { value: VisibilityMode; label: string; description: string }[] = [
  { value: 'always', label: 'Always visible', description: 'Show me in Nearby all the time' },
  { value: 'app_open', label: 'Only while using app', description: 'Hide when app is closed' },
  { value: 'recent', label: '30 min after use', description: 'Visible for 30 min after I close the app' },
];

export default function NearbySettingsScreen() {
  const router = useRouter();
  const { token } = useAuthStore();

  // Fetch current user
  const currentUserQuery = useQuery(
    api.users.getCurrentUserFromToken,
    !isDemoMode && token ? { token } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;

  // Mutations
  const updateNearbySettingsMut = useMutation(api.users.updateNearbySettings);
  const pauseNearbyMut = useMutation(api.users.pauseNearby);

  // Local state (initialized from server)
  const [nearbyEnabled, setNearbyEnabled] = useState(true);
  const [crossedPathsEnabled, setCrossedPathsEnabled] = useState(true);
  const [strongPrivacyMode, setStrongPrivacyMode] = useState(false);
  const [hideDistance, setHideDistance] = useState(false);
  const [incognitoMode, setIncognitoMode] = useState(false);
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>('always');
  const [isPaused, setIsPaused] = useState(false);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);

  // Location mode state (device-level, persisted locally)
  const [locationMode, setLocationMode] = useState<NearbyLocationMode>('foreground');
  const [locationStatusText, setLocationStatusText] = useState<string>('');
  const [backgroundDenied, setBackgroundDenied] = useState(false);
  const [isChangingMode, setIsChangingMode] = useState(false);

  // Loading states
  const [timedOut, setTimedOut] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Loading timeout
  useEffect(() => {
    if (isDemoMode) return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  // Initialize state from server data
  useEffect(() => {
    if (currentUser) {
      setTimedOut(false);
      setNearbyEnabled(currentUser.nearbyEnabled !== false);
      setCrossedPathsEnabled(currentUser.crossedPathsEnabled !== false);
      setStrongPrivacyMode(currentUser.strongPrivacyMode === true);
      setHideDistance(currentUser.hideDistance === true);
      setIncognitoMode(currentUser.incognitoMode === true);
      setVisibilityMode(currentUser.nearbyVisibilityMode || 'always');

      // Check pause status
      const pauseUntil = currentUser.nearbyPausedUntil;
      if (pauseUntil && pauseUntil > Date.now()) {
        setIsPaused(true);
        setPausedUntil(pauseUntil);
      } else {
        setIsPaused(false);
        setPausedUntil(null);
      }
    }
  }, [currentUser]);

  // Load location mode status on mount and when screen focuses
  const loadLocationModeStatus = useCallback(async () => {
    try {
      const status = await getLocationModeStatus();
      setLocationMode(status.preferredMode);
      setLocationStatusText(status.statusText);
      setBackgroundDenied(
        status.preferredMode === 'background' && !status.backgroundPermissionGranted
      );
    } catch {
      // Fallback to foreground mode
      setLocationMode('foreground');
      setLocationStatusText('Using location while app is open');
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadLocationModeStatus();
  }, [loadLocationModeStatus]);

  // Reload when screen focuses (in case permissions changed in Settings)
  useFocusEffect(
    useCallback(() => {
      loadLocationModeStatus();
    }, [loadLocationModeStatus])
  );

  // Handle location mode change
  const handleLocationModeChange = useCallback(async (newMode: NearbyLocationMode) => {
    if (isChangingMode) return;
    setIsChangingMode(true);

    try {
      // Save preferred mode
      await setPreferredLocationMode(newMode);
      setLocationMode(newMode);

      // Apply the change (request permissions, start/stop background task)
      const result = await startBackgroundLocation();

      if (result.backgroundDenied) {
        // Background was denied - show fallback message
        setBackgroundDenied(true);
        setLocationStatusText('Background access not enabled. Nearby works while app is open.');

        // Show alert with option to open settings
        Alert.alert(
          'Background Location',
          Platform.OS === 'ios'
            ? 'To enable Background Nearby, go to Settings > Mira > Location and select "Always".'
            : 'To enable Background Nearby, grant "Allow all the time" location permission in Settings.',
          [
            { text: 'Not Now', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ]
        );
      } else if (result.effectiveMode === 'background') {
        setBackgroundDenied(false);
        setLocationStatusText('Background Nearby is active');
        Toast.show('Background Nearby enabled');
      } else {
        setBackgroundDenied(false);
        setLocationStatusText('Using location while app is open');
        if (newMode === 'foreground') {
          Toast.show('Location mode updated');
        }
      }
    } catch (error) {
      Toast.show('Failed to update location mode');
      // Reload status to reflect actual state
      await loadLocationModeStatus();
    } finally {
      setIsChangingMode(false);
    }
  }, [isChangingMode, loadLocationModeStatus]);

  // Premium check for incognito (premium-only, no gender-based access)
  const canUseIncognito = currentUser?.subscriptionTier === 'premium';

  // Save handler
  const handleSave = useCallback(
    async (field: string, value: boolean | string) => {
      if (isDemoMode) {
        // Demo mode: just update local state (already done)
        return;
      }

      if (!token) return;
      setIsSaving(true);

      try {
        await updateNearbySettingsMut({
          token,
          [field]: value,
        });
      } catch (error: any) {
        Toast.show(error.message || 'Failed to update setting');
        // Revert local state on error
        if (currentUser) {
          if (field === 'nearbyEnabled') setNearbyEnabled(currentUser.nearbyEnabled !== false);
          if (field === 'crossedPathsEnabled') setCrossedPathsEnabled(currentUser.crossedPathsEnabled !== false);
          if (field === 'strongPrivacyMode') setStrongPrivacyMode(currentUser.strongPrivacyMode === true);
          if (field === 'hideDistance') setHideDistance(currentUser.hideDistance === true);
          if (field === 'incognitoMode') setIncognitoMode(currentUser.incognitoMode === true);
          if (field === 'nearbyVisibilityMode') setVisibilityMode(currentUser.nearbyVisibilityMode || 'always');
        }
      } finally {
        setIsSaving(false);
      }
    },
    [token, currentUser, updateNearbySettingsMut]
  );

  // Toggle handlers
  const handleNearbyEnabledToggle = (value: boolean) => {
    setNearbyEnabled(value);
    handleSave('nearbyEnabled', value);
  };

  const handleCrossedPathsToggle = (value: boolean) => {
    setCrossedPathsEnabled(value);
    handleSave('crossedPathsEnabled', value);
  };

  const handleStrongPrivacyModeToggle = (value: boolean) => {
    setStrongPrivacyMode(value);
    handleSave('strongPrivacyMode', value);
  };

  const handleHideDistanceToggle = (value: boolean) => {
    setHideDistance(value);
    handleSave('hideDistance', value);
  };

  const handleIncognitoToggle = (value: boolean) => {
    if (!canUseIncognito && value) {
      Alert.alert(
        'Premium Feature',
        'Incognito Nearby is available with Premium. Upgrade to browse invisibly.',
        [{ text: 'OK' }]
      );
      return;
    }
    setIncognitoMode(value);
    handleSave('incognitoMode', value);
  };

  const handleVisibilityChange = (mode: VisibilityMode) => {
    setVisibilityMode(mode);
    handleSave('nearbyVisibilityMode', mode);
  };

  // Pause handler
  const handlePauseNearby = async () => {
    if (isDemoMode) {
      if (isPaused) {
        setIsPaused(false);
        setPausedUntil(null);
      } else {
        setIsPaused(true);
        setPausedUntil(Date.now() + 24 * 60 * 60 * 1000);
      }
      return;
    }

    if (!token) return;

    try {
      await pauseNearbyMut({
        token,
        paused: !isPaused,
      });
      if (isPaused) {
        setIsPaused(false);
        setPausedUntil(null);
        Toast.show('Nearby visibility resumed');
      } else {
        setIsPaused(true);
        setPausedUntil(Date.now() + 24 * 60 * 60 * 1000);
        Toast.show('Nearby paused for 24 hours');
      }
    } catch (error) {
      Toast.show('Failed to update pause status');
    }
  };

  // Loading state
  if (!currentUser) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            {timedOut ? 'Failed to load settings' : 'Loading...'}
          </Text>
          <TouchableOpacity style={styles.loadingBackButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color={COLORS.white} />
            <Text style={styles.loadingBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nearby Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Location Mode Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location Tracking</Text>

          {/* Status Display */}
          <View style={styles.statusRow}>
            <Ionicons
              name={locationMode === 'background' && !backgroundDenied ? 'location' : 'location-outline'}
              size={20}
              color={backgroundDenied ? COLORS.warning : COLORS.primary}
            />
            <Text style={[styles.statusText, backgroundDenied && styles.statusTextWarning]}>
              {locationStatusText}
            </Text>
          </View>

          {/* Location Mode Options */}
          <View style={styles.locationModeOptions}>
            {LOCATION_MODE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.locationModeOption,
                  locationMode === option.value && styles.locationModeOptionActive,
                ]}
                onPress={() => handleLocationModeChange(option.value)}
                disabled={isChangingMode}
              >
                <View style={styles.locationModeRadio}>
                  {locationMode === option.value && (
                    <View style={styles.locationModeRadioInner} />
                  )}
                </View>
                <View style={styles.locationModeTextContainer}>
                  <Text style={styles.locationModeLabel}>{option.label}</Text>
                  <Text style={styles.locationModeDesc}>{option.description}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Background denied warning */}
          {backgroundDenied && (
            <TouchableOpacity
              style={styles.permissionWarning}
              onPress={() => Linking.openSettings()}
            >
              <Ionicons name="settings-outline" size={16} color={COLORS.primary} />
              <Text style={styles.permissionWarningText}>
                Tap to open Settings and enable background location
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Visibility Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visibility</Text>

          {/* Show me in Nearby */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Show me in Nearby</Text>
              <Text style={styles.toggleDescription}>
                Allow others to see you on the Nearby map
              </Text>
            </View>
            <Switch
              value={nearbyEnabled}
              onValueChange={handleNearbyEnabledToggle}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
              disabled={isSaving}
            />
          </View>

          {/* Pause Nearby */}
          <TouchableOpacity style={styles.actionRow} onPress={handlePauseNearby}>
            <View style={styles.actionInfo}>
              <Text style={styles.toggleTitle}>Pause Nearby</Text>
              <Text style={styles.toggleDescription}>
                {isPaused && pausedUntil
                  ? `Paused until ${new Date(pausedUntil).toLocaleString()}`
                  : 'Temporarily hide from Nearby for 24 hours'}
              </Text>
            </View>
            <View style={[styles.actionButton, isPaused && styles.actionButtonActive]}>
              <Text style={[styles.actionButtonText, isPaused && styles.actionButtonTextActive]}>
                {isPaused ? 'Resume' : 'Pause'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Time-based Visibility */}
          <View style={styles.visibilitySection}>
            <Text style={styles.toggleTitle}>Time-based Visibility</Text>
            <Text style={styles.toggleDescription}>
              Control when you appear in Nearby
            </Text>
            <View style={styles.visibilityOptions}>
              {VISIBILITY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.visibilityOption,
                    visibilityMode === option.value && styles.visibilityOptionActive,
                  ]}
                  onPress={() => handleVisibilityChange(option.value)}
                >
                  <View style={styles.visibilityRadio}>
                    {visibilityMode === option.value && <View style={styles.visibilityRadioInner} />}
                  </View>
                  <View style={styles.visibilityTextContainer}>
                    <Text style={styles.visibilityLabel}>{option.label}</Text>
                    <Text style={styles.visibilityDesc}>{option.description}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Privacy Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>

          {/* Strong Privacy Mode (larger location fuzz) */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Strong Privacy Mode</Text>
              <Text style={styles.toggleDescription}>
                Your location will be fuzzed more heavily on the map (200-400m instead of 50-150m)
              </Text>
            </View>
            <Switch
              value={strongPrivacyMode}
              onValueChange={handleStrongPrivacyModeToggle}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
              disabled={isSaving}
            />
          </View>

          {/* Hide Distance (don't show distance info to others) */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Hide Distance</Text>
              <Text style={styles.toggleDescription}>
                Others won't see how far away you are
              </Text>
            </View>
            <Switch
              value={hideDistance}
              onValueChange={handleHideDistanceToggle}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
              disabled={isSaving}
            />
          </View>

          {/* Incognito Nearby */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <View style={styles.titleRow}>
                <Text style={styles.toggleTitle}>Incognito Nearby</Text>
                {!canUseIncognito && (
                  <View style={styles.premiumBadge}>
                    <Text style={styles.premiumBadgeText}>PREMIUM</Text>
                  </View>
                )}
              </View>
              <Text style={styles.toggleDescription}>
                Browse Nearby without appearing to others
                {!canUseIncognito && '\nUpgrade to Premium to use this feature'}
              </Text>
            </View>
            <Switch
              value={incognitoMode}
              onValueChange={handleIncognitoToggle}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
              disabled={isSaving || !canUseIncognito}
            />
          </View>
        </View>

        {/* Crossed Paths Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Crossed Paths</Text>

          {/* Participate in Crossed Paths */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Participate in Crossed Paths</Text>
              <Text style={styles.toggleDescription}>
                Get notified when someone crosses your path and matches your interests
              </Text>
            </View>
            <Switch
              value={crossedPathsEnabled}
              onValueChange={handleCrossedPathsToggle}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
              disabled={isSaving}
            />
          </View>
        </View>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  actionInfo: {
    flex: 1,
    marginRight: 16,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
  },
  actionButtonActive: {
    backgroundColor: COLORS.primary,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  actionButtonTextActive: {
    color: COLORS.white,
  },
  visibilitySection: {
    paddingVertical: 12,
  },
  visibilityOptions: {
    marginTop: 12,
    gap: 8,
  },
  visibilityOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
  },
  visibilityOptionActive: {
    backgroundColor: COLORS.primaryLight || '#FFE4E9',
  },
  visibilityRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  visibilityRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  visibilityTextContainer: {
    flex: 1,
  },
  visibilityLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  visibilityDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  premiumBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  premiumBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: 0.5,
  },
  // Location Mode styles
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  statusTextWarning: {
    color: COLORS.warning || '#FF9800',
  },
  locationModeOptions: {
    gap: 8,
  },
  locationModeOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
  },
  locationModeOptionActive: {
    backgroundColor: COLORS.primaryLight || '#FFE4E9',
  },
  locationModeRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  locationModeRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  locationModeTextContainer: {
    flex: 1,
  },
  locationModeLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  locationModeDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  permissionWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.primaryLight || '#FFE4E9',
    borderRadius: 8,
  },
  permissionWarningText: {
    fontSize: 13,
    color: COLORS.primary,
    flex: 1,
  },
});
