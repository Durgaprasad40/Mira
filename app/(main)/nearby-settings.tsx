/**
 * Nearby Settings Screen
 *
 * User-facing settings for Nearby visibility, privacy, and crossed paths.
 * Part of Phase-1 Profile settings.
 *
 * Nearby updates in the foreground and, when explicitly enabled, can use
 * approximate background samples for crossed-path history.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Platform,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { Toast } from '@/components/ui/Toast';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useBackgroundLocation } from '@/hooks/useBackgroundLocation';
import { getQueuedNearbyBackgroundSampleCount } from '@/lib/nearbyBackgroundQueue';

// Phase-1 cleanup: the `always / app_open / recent` visibility-mode UI was
// removed because the backend no longer enforces these modes (Nearby became a
// persistent coarse-discovery map). The setting would have been a dead promise.
// Use the Pause and master "Nearby visibility & crossings" toggles instead.

export default function NearbySettingsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);

  // FIX: Use getCurrentUser with userId instead of getCurrentUserFromToken
  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;

  // Mutations
  const updateNearbySettingsMut = useMutation(api.users.updateNearbySettings);
  const pauseNearbyMut = useMutation(api.users.pauseNearby);
  const {
    enable: enableBackgroundLocation,
    disable: disableBackgroundLocation,
    enableDiscoveryMode,
    disableDiscoveryMode,
    isWorking: isBackgroundLocationWorking,
    isRunning: isBackgroundLocationRunning,
  } = useBackgroundLocation(!isDemoMode ? userId : null);

  // Local state (initialized from server)
  const [nearbyEnabled, setNearbyEnabled] = useState(true);
  const [hideDistance, setHideDistance] = useState(false);
  const [incognitoMode, setIncognitoMode] = useState(false);
  // Phase-2: separate crossed-paths opt-in. Default true (undefined → on).
  const [recordCrossedPaths, setRecordCrossedPaths] = useState(true);
  const [backgroundCrossedPathsEnabled, setBackgroundCrossedPathsEnabled] = useState(false);
  const [androidDiscoveryExpiresAt, setAndroidDiscoveryExpiresAt] = useState<number | null>(null);
  const [backgroundTaskRunning, setBackgroundTaskRunning] = useState<boolean | null>(null);
  const [foregroundPermissionStatus, setForegroundPermissionStatus] = useState<string | null>(null);
  const [backgroundPermissionStatus, setBackgroundPermissionStatus] = useState<string | null>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  // Phase-2: pause duration picker visibility
  const [showPauseOptions, setShowPauseOptions] = useState(false);

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
      setHideDistance(currentUser.hideDistance === true);
      setIncognitoMode(currentUser.incognitoMode === true);
      // Phase-2: undefined treated as opted-in (default true).
      setRecordCrossedPaths(currentUser.recordCrossedPaths !== false);
      const discoveryActive =
        currentUser.discoveryModeEnabled === true &&
        typeof currentUser.discoveryModeExpiresAt === 'number' &&
        currentUser.discoveryModeExpiresAt > Date.now();
      setAndroidDiscoveryExpiresAt(discoveryActive ? currentUser.discoveryModeExpiresAt : null);
      setBackgroundCrossedPathsEnabled(
        Platform.OS === 'ios'
          ? currentUser.backgroundLocationEnabled === true
          : Platform.OS === 'android'
            ? discoveryActive
            : false,
      );

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

  // Premium check for incognito (premium-only, no gender-based access)
  const canUseIncognito = currentUser?.subscriptionTier === 'premium';

  // Save handler
  const handleSave = useCallback(
    async (field: string, value: boolean | string) => {
      if (isDemoMode) {
        // Demo mode: just update local state (already done)
        return;
      }

      if (!userId) return;
      setIsSaving(true);

      try {
        // FIX: Backend expects { authUserId }, not { token }
        await updateNearbySettingsMut({
          authUserId: userId,
          [field]: value,
        });
      } catch (error: any) {
        Toast.show(error.message || 'Failed to update setting');
        // Revert local state on error
        if (currentUser) {
          if (field === 'nearbyEnabled') setNearbyEnabled(currentUser.nearbyEnabled !== false);
          if (field === 'hideDistance') setHideDistance(currentUser.hideDistance === true);
          if (field === 'incognitoMode') setIncognitoMode(currentUser.incognitoMode === true);
          if (field === 'recordCrossedPaths') setRecordCrossedPaths(currentUser.recordCrossedPaths !== false);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [userId, currentUser, updateNearbySettingsMut]
  );

  const disableBackgroundCrossedPaths = useCallback(
    async (showToast = false) => {
      try {
        if (Platform.OS === 'ios') {
          await disableBackgroundLocation();
        } else if (Platform.OS === 'android') {
          await disableDiscoveryMode();
        }
      } finally {
        setBackgroundCrossedPathsEnabled(false);
        setAndroidDiscoveryExpiresAt(null);
      }
      if (showToast) {
        Toast.show('Background Crossed Paths turned off');
      }
    },
    [disableBackgroundLocation, disableDiscoveryMode],
  );

  const backgroundUnavailableReason = useCallback((): string | null => {
    if (!nearbyEnabled) return 'Turn on Nearby first.';
    if (!recordCrossedPaths) return 'Turn on Save crossed paths first.';
    if (incognitoMode) return 'Turn off Incognito Nearby first.';
    if (isPaused) return 'Resume Nearby first.';
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return 'Background Crossed Paths is not supported on this device.';
    }
    return null;
  }, [incognitoMode, isPaused, nearbyEnabled, recordCrossedPaths]);

  useEffect(() => {
    if (isDemoMode || !backgroundCrossedPathsEnabled) return;
    let cancelled = false;
    const verifyBackgroundTask = async () => {
      const running = await isBackgroundLocationRunning();
      if (cancelled || running) return;
      await disableBackgroundCrossedPaths();
      if (!cancelled) {
        Toast.show('Background Crossed Paths stopped. Check location permission.');
      }
    };
    void verifyBackgroundTask();
    return () => {
      cancelled = true;
    };
  }, [backgroundCrossedPathsEnabled, disableBackgroundCrossedPaths, isBackgroundLocationRunning]);

  useEffect(() => {
    if (isDemoMode) {
      setBackgroundTaskRunning(backgroundCrossedPathsEnabled);
      setForegroundPermissionStatus('granted');
      setBackgroundPermissionStatus('granted');
      return;
    }

    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const [running, foregroundPermission, backgroundPermission] = await Promise.all([
          isBackgroundLocationRunning(),
          Location.getForegroundPermissionsAsync(),
          Location.getBackgroundPermissionsAsync(),
        ]);
        if (cancelled) return;
        setBackgroundTaskRunning(running);
        setForegroundPermissionStatus(foregroundPermission.status);
        setBackgroundPermissionStatus(backgroundPermission.status);
      } catch {
        if (cancelled) return;
        setBackgroundTaskRunning(null);
      }
    };

    void refreshStatus();
    return () => {
      cancelled = true;
    };
  }, [backgroundCrossedPathsEnabled, isBackgroundLocationRunning, isSaving]);

  useEffect(() => {
    if (!__DEV__) return;
    let cancelled = false;
    const refreshQueueCount = async () => {
      const count = await getQueuedNearbyBackgroundSampleCount();
      if (!cancelled) {
        setPendingQueueCount(count);
      }
    };
    void refreshQueueCount();
    return () => {
      cancelled = true;
    };
  }, [backgroundCrossedPathsEnabled, isSaving]);

  // Toggle handlers
  const handleNearbyEnabledToggle = (value: boolean) => {
    setNearbyEnabled(value);
    handleSave('nearbyEnabled', value);
    if (!value) {
      void disableBackgroundCrossedPaths();
    }
  };

  const handleHideDistanceToggle = (value: boolean) => {
    setHideDistance(value);
    handleSave('hideDistance', value);
  };

  const handleIncognitoToggle = (value: boolean) => {
    if (!canUseIncognito && value) {
      // P1-4: Non-premium users must be routed to the paywall instead of
      // hitting a dead-end alert. Entry point is tagged so the subscription
      // screen can show the relevant Incognito Nearby context.
      router.push('/(main)/subscription?from=nearby_incognito' as any);
      return;
    }
    setIncognitoMode(value);
    handleSave('incognitoMode', value);
    if (value) {
      void disableBackgroundCrossedPaths();
    }
  };

  // Phase-2: record-crossed-paths toggle (independent from map visibility)
  const handleRecordCrossedPathsToggle = (value: boolean) => {
    setRecordCrossedPaths(value);
    handleSave('recordCrossedPaths', value);
    if (!value) {
      void disableBackgroundCrossedPaths();
    }
  };

  const handleBackgroundCrossedPathsToggle = async (value: boolean) => {
    if (!value) {
      await disableBackgroundCrossedPaths(true);
      return;
    }

    const unavailable = backgroundUnavailableReason();
    if (unavailable) {
      setBackgroundCrossedPathsEnabled(false);
      Toast.show(unavailable);
      return;
    }

    if (isDemoMode) {
      setBackgroundCrossedPathsEnabled(true);
      Toast.show('Background Crossed Paths enabled for demo mode');
      return;
    }

    setIsSaving(true);
    try {
      if (Platform.OS === 'ios') {
        const result = await enableBackgroundLocation();
        if (!result.ok) {
          setBackgroundCrossedPathsEnabled(false);
          Toast.show(
            result.reason === 'foreground_denied' || result.reason === 'background_denied'
              ? 'Location permission was not granted.'
              : 'Could not start Background Crossed Paths.',
          );
          return;
        }
        setBackgroundCrossedPathsEnabled(true);
        Toast.show('Background Crossed Paths enabled');
        return;
      }

      if (Platform.OS === 'android') {
        const result = await enableDiscoveryMode();
        if (!result.ok) {
          setBackgroundCrossedPathsEnabled(false);
          setAndroidDiscoveryExpiresAt(null);
          Toast.show(
            result.reason === 'foreground_denied' || result.reason === 'background_denied'
              ? 'Location permission was not granted.'
              : 'Could not start Discovery Mode.',
          );
          return;
        }
        setBackgroundCrossedPathsEnabled(true);
        setAndroidDiscoveryExpiresAt(result.expiresAt);
        Toast.show('Discovery Mode enabled for Crossed Paths');
        return;
      }

      setBackgroundCrossedPathsEnabled(false);
      Toast.show('Background Crossed Paths is not supported on this device.');
    } finally {
      setIsSaving(false);
    }
  };

  // Phase-2: pause-duration options. null = indefinite ("Until turned back on").
  const PAUSE_OPTIONS: Array<{ label: string; durationMs: number | null; shortLabel: string }> = [
    { label: 'Pause for 1 hour',            shortLabel: '1h',        durationMs: 60 * 60 * 1000 },
    { label: 'Pause for 8 hours',           shortLabel: '8h',        durationMs: 8 * 60 * 60 * 1000 },
    { label: 'Pause for 24 hours',          shortLabel: '24h',       durationMs: 24 * 60 * 60 * 1000 },
    { label: 'Pause until I turn it back on', shortLabel: 'Until off', durationMs: null },
  ];

  // Resume (clear pause)
  const handleResumeNearby = async () => {
    setShowPauseOptions(false);
    if (isDemoMode) {
      setIsPaused(false);
      setPausedUntil(null);
      return;
    }
    if (!userId) return;
    try {
      await pauseNearbyMut({ authUserId: userId, paused: false });
      setIsPaused(false);
      setPausedUntil(null);
      Toast.show('Nearby visibility resumed');
    } catch {
      Toast.show('Failed to update pause status');
    }
  };

  // Pause with chosen duration (Phase-2)
  const handlePauseWithDuration = async (durationMs: number | null, shortLabel: string) => {
    setShowPauseOptions(false);
    const INDEFINITE_DISPLAY_MS = 100 * 365 * 24 * 60 * 60 * 1000;
    const effectiveMs = durationMs === null ? INDEFINITE_DISPLAY_MS : durationMs;

    if (isDemoMode) {
      setIsPaused(true);
      setPausedUntil(Date.now() + effectiveMs);
      return;
    }
    if (!userId) return;
    try {
      await pauseNearbyMut({ authUserId: userId, paused: true, durationMs });
      setIsPaused(true);
      setPausedUntil(Date.now() + effectiveMs);
      await disableBackgroundCrossedPaths();
      Toast.show(
        durationMs === null
          ? 'Nearby paused until you turn it back on'
          : `Nearby paused for ${shortLabel}`,
      );
    } catch {
      Toast.show('Failed to update pause status');
    }
  };

  // Format "paused until ..." status line. Indefinite pauses render as a
  // text sentinel rather than the literal year-2125 timestamp.
  const INDEFINITE_THRESHOLD_MS = 50 * 365 * 24 * 60 * 60 * 1000; // 50y
  const pauseStatusText = (() => {
    if (!isPaused || !pausedUntil) return null;
    if (pausedUntil - Date.now() > INDEFINITE_THRESHOLD_MS) {
      return 'Paused until you turn it back on — you are hidden from the map and crossings are not recorded.';
    }
    return `Paused until ${new Date(pausedUntil).toLocaleString()} — you are hidden from the map and crossings are not recorded.`;
  })();

  const backgroundCrossedPathsDescription =
    Platform.OS === 'android'
      ? androidDiscoveryExpiresAt && androidDiscoveryExpiresAt > Date.now()
        ? `Approximate background detection is active until ${new Date(androidDiscoveryExpiresAt).toLocaleTimeString()}. Android may stop it based on battery settings.`
        : 'Starts a time-limited Discovery Mode with an Android notification. Mira uses approximate location only.'
      : 'Mira uses approximate background location to remember people you crossed paths with. Your live location is never shown.';

  const foregroundPermissionNeedsAttention =
    !isDemoMode && foregroundPermissionStatus != null && foregroundPermissionStatus !== 'granted';
  const backgroundPermissionNeedsAttention =
    !isDemoMode && backgroundPermissionStatus != null && backgroundPermissionStatus !== 'granted';
  const locationPermissionStatusLabel =
    foregroundPermissionNeedsAttention || backgroundPermissionNeedsAttention
      ? 'Permission needed'
      : foregroundPermissionStatus === 'granted' || backgroundPermissionStatus === 'granted' || isDemoMode
        ? 'Granted'
        : 'Checking...';

  const backgroundStatus = useMemo(() => {
    if (!nearbyEnabled || !recordCrossedPaths || incognitoMode || isPaused) {
      return 'Off';
    }
    if (!backgroundCrossedPathsEnabled) {
      return 'Off';
    }
    if (foregroundPermissionNeedsAttention || backgroundPermissionNeedsAttention) {
      return 'Permission needed';
    }
    if (backgroundTaskRunning === false) {
      return 'Limited by OS';
    }
    if (backgroundTaskRunning === true || isDemoMode) {
      return 'On';
    }
    return 'Checking...';
  }, [
    backgroundCrossedPathsEnabled,
    backgroundPermissionNeedsAttention,
    backgroundTaskRunning,
    foregroundPermissionNeedsAttention,
    incognitoMode,
    isDemoMode,
    isPaused,
    nearbyEnabled,
    recordCrossedPaths,
  ]);

  const platformBackgroundCopy =
    Platform.OS === 'android'
      ? 'Android may pause background updates to save battery. Discovery Mode uses a visible notification while active.'
      : Platform.OS === 'ios'
        ? 'iPhone may deliver background location updates less often. Crossed Paths works best when location permission is set to Always.'
        : 'Background updates depend on phone permissions and battery settings.';

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      Toast.show('Open location settings from your phone settings.');
    });
  }, []);

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
        {/* Visibility Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visibility</Text>

          {/* Nearby visibility */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Show me in Nearby</Text>
              <Text style={styles.toggleDescription}>
                Allow nearby people to discover you through Nearby and crossed paths.
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

          {/* Phase-2: Pause with duration picker */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => {
              if (isPaused) {
                handleResumeNearby();
              } else {
                setShowPauseOptions((v) => !v);
              }
            }}
          >
            <View style={styles.actionInfo}>
              <Text style={styles.toggleTitle}>Pause Nearby</Text>
              <Text style={styles.toggleDescription}>
                {pauseStatusText
                  ?? 'Temporarily stop showing you in Nearby.'}
              </Text>
            </View>
            <View style={[styles.actionButton, isPaused && styles.actionButtonActive]}>
              <Text style={[styles.actionButtonText, isPaused && styles.actionButtonTextActive]}>
                {isPaused ? 'Resume' : 'Pause'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Phase-2: inline pause duration options (shown only when picking a duration) */}
          {!isPaused && showPauseOptions && (
            <View style={styles.pauseOptions}>
              {PAUSE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.shortLabel}
                  style={styles.pauseOption}
                  onPress={() => handlePauseWithDuration(opt.durationMs, opt.shortLabel)}
                >
                  <Text style={styles.pauseOptionLabel}>{opt.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

        </View>

        {/* Crossed Paths Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Crossed Paths</Text>

          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Crossed Paths</Text>
              <Text style={[styles.statusValue, recordCrossedPaths && nearbyEnabled && !incognitoMode && !isPaused ? styles.statusValueOn : styles.statusValueMuted]}>
                {recordCrossedPaths && nearbyEnabled && !incognitoMode && !isPaused ? 'On' : 'Off'}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Background</Text>
              <Text style={[
                styles.statusValue,
                backgroundStatus === 'On' ? styles.statusValueOn : styles.statusValueMuted,
                backgroundStatus === 'Permission needed' ? styles.statusValueWarning : null,
              ]}>
                {backgroundStatus}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Phone permission</Text>
              <Text style={[
                styles.statusValue,
                locationPermissionStatusLabel === 'Granted' ? styles.statusValueOn : styles.statusValueMuted,
                locationPermissionStatusLabel === 'Permission needed' ? styles.statusValueWarning : null,
              ]}>
                {locationPermissionStatusLabel}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Save history</Text>
              <Text style={[styles.statusValue, recordCrossedPaths ? styles.statusValueOn : styles.statusValueMuted]}>
                {recordCrossedPaths ? 'On' : 'Off'}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Incognito</Text>
              <Text style={[styles.statusValue, incognitoMode ? styles.statusValueWarning : styles.statusValueMuted]}>
                {incognitoMode ? 'On' : 'Off'}
              </Text>
            </View>
            {__DEV__ && (
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Pending samples</Text>
                <Text style={[styles.statusValue, pendingQueueCount > 0 ? styles.statusValueWarning : styles.statusValueMuted]}>
                  {pendingQueueCount}
                </Text>
              </View>
            )}
            <Text style={styles.statusHint}>
              Approximate location only. Your live location is never shown.
            </Text>
            <Text style={styles.statusHint}>{platformBackgroundCopy}</Text>
            {(foregroundPermissionNeedsAttention || backgroundPermissionNeedsAttention) && (
              <View style={styles.permissionHintRow}>
                <Text style={styles.permissionHintText}>
                  Allow background location to remember crossed paths when Mira is not open.
                </Text>
                <TouchableOpacity style={styles.permissionHintButton} onPress={openSettings}>
                  <Text style={styles.permissionHintButtonText}>Open settings</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Background Crossed Paths</Text>
              <Text style={styles.toggleDescription}>
                {backgroundCrossedPathsDescription}
              </Text>
            </View>
            <Switch
              value={backgroundCrossedPathsEnabled}
              onValueChange={(value) => {
                void handleBackgroundCrossedPathsToggle(value);
              }}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
              disabled={isSaving || isBackgroundLocationWorking}
            />
          </View>

          {/* Crossed-path history opt-in */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Save crossed paths</Text>
              <Text style={styles.toggleDescription}>
                Mira uses approximate location to remember people you crossed paths with. Your live
                location is never shown. You can pause this anytime.
              </Text>
            </View>
            <Switch
              value={recordCrossedPaths}
              onValueChange={handleRecordCrossedPathsToggle}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
              disabled={isSaving}
            />
          </View>
        </View>

        {/* Privacy Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>

          {/* Hide Distance (don't show distance info to others) */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Hide my distance</Text>
              <Text style={styles.toggleDescription}>
                Do not show your distance to other people.
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
                Browse Nearby without appearing to others.
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
  // Phase-2: pause-duration picker
  pauseOptions: {
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    overflow: 'hidden',
  },
  pauseOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  pauseOptionLabel: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  statusCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  statusLabel: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textLight,
  },
  statusValue: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '700',
  },
  statusValueOn: {
    color: COLORS.secondaryDark,
  },
  statusValueMuted: {
    color: COLORS.textMuted,
  },
  statusValueWarning: {
    color: '#A66A00',
  },
  statusHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textMuted,
  },
  permissionHintRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  permissionHintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textLight,
  },
  permissionHintButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  permissionHintButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
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
});
