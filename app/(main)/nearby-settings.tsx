/**
 * Nearby Settings Screen
 *
 * User-facing settings for Nearby visibility, privacy, and crossed paths.
 * Nearby is foreground-only.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Linking,
  Alert,
  Platform,
  I18nManager,
} from 'react-native';
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
import {
  BG_COPY,
  BG_CROSSED_PATHS_FEATURE_READY,
  formatDiscoveryCountdown,
  resolveBgConsentStatus,
  type BgConsentStatus,
} from '@/lib/backgroundCrossedPaths';
import {
  getBackgroundLocationStatus,
  useBackgroundLocation,
  type BgStatus,
} from '@/hooks/useBackgroundLocation';
import { captureException as sentryCaptureException } from '@/lib/sentry';

// Phase-1 cleanup: the `always / app_open / recent` visibility-mode UI was
// removed because the backend no longer enforces these modes (Nearby became a
// persistent coarse-discovery map). The setting would have been a dead promise.
// Use the Pause and master "Nearby visibility & crossings" toggles instead.
const NEARBY_CONSENT_VERSION = 'nearby_crossed_paths_v1';

function hasAcceptedNearbyConsent(user: any): boolean {
  return (
    typeof user?.nearbyConsentAt === 'number' &&
    user.nearbyConsentAt > 0 &&
    user.nearbyConsentVersion === NEARBY_CONSENT_VERSION
  );
}

function getEffectiveNearbyEnabled(user: any): boolean {
  if (!user) return false;
  return user.nearbyEnabled !== false && (isDemoMode || hasAcceptedNearbyConsent(user));
}

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
  const acceptNearbyConsentMut = useMutation(api.users.acceptNearbyConsent);
  // Phase-3 background detection: both ON and OFF paths run through the
  // `useBackgroundLocation` hook directly from this screen so the user
  // never leaves Nearby Settings. The hook stops/starts the OS task,
  // manages the local buffer, and syncs server-side consent.
  const { disableBackgroundCrossedPaths, enableBackgroundCrossedPaths } =
    useBackgroundLocation();

  // Local state (initialized from server)
  const [nearbyEnabled, setNearbyEnabled] = useState(true);
  const [hideDistance, setHideDistance] = useState(false);
  const [incognitoMode, setIncognitoMode] = useState(false);
  // Legacy mirror; Crossed Paths now follows Nearby visibility.
  const [recordCrossedPaths, setRecordCrossedPaths] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  // Phase-2: pause duration picker visibility
  const [showPauseOptions, setShowPauseOptions] = useState(false);
  const [bgStatus, setBgStatus] = useState<BgStatus | null>(null);
  // Phase-3: in-place loading state for the Background detection action so
  // the row can show "Requesting…" instead of navigating away.
  const [isBgWorking, setIsBgWorking] = useState(false);

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
      const effectiveNearbyEnabled = getEffectiveNearbyEnabled(currentUser);
      setNearbyEnabled(effectiveNearbyEnabled);
      setHideDistance(currentUser.hideDistance === true);
      setIncognitoMode(currentUser.incognitoMode === true);
      // Crossed Paths now follows the Nearby master switch. Keep this local
      // mirror only so older explicit opt-outs can be repaired on the next
      // master ON flow.
      setRecordCrossedPaths(effectiveNearbyEnabled);

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

  const refreshBackgroundStatus = useCallback(async () => {
    try {
      setBgStatus(await getBackgroundLocationStatus());
    } catch {
      setBgStatus(null);
    }
  }, []);

  useEffect(() => {
    refreshBackgroundStatus();
  }, [refreshBackgroundStatus, currentUser?.backgroundLocationEnabled, currentUser?.backgroundLocationConsentAt, currentUser?.discoveryModeEnabled]);

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
          if (field === 'nearbyEnabled') setNearbyEnabled(getEffectiveNearbyEnabled(currentUser));
          if (field === 'hideDistance') setHideDistance(currentUser.hideDistance === true);
          if (field === 'incognitoMode') setIncognitoMode(currentUser.incognitoMode === true);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [userId, currentUser, updateNearbySettingsMut]
  );

  const hasNearbyConsent = isDemoMode || hasAcceptedNearbyConsent(currentUser);

  const confirmNearbyConsent = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        Alert.alert(
          'Turn on Nearby?',
          'People can discover you when your paths cross. Your exact location is never shown.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'I agree', onPress: () => resolve(true) },
          ],
        );
      }),
    [],
  );

  const ensureNearbyConsent = useCallback(async (): Promise<boolean> => {
    if (isDemoMode) return true;
    if (!userId) return false;
    if (hasNearbyConsent) return true;

    const accepted = await confirmNearbyConsent();
    if (!accepted) return false;

    await acceptNearbyConsentMut({
      authUserId: userId,
      consentVersion: NEARBY_CONSENT_VERSION,
    });
    return true;
  }, [acceptNearbyConsentMut, confirmNearbyConsent, hasNearbyConsent, userId]);

  // Toggle handlers
  const handleNearbyEnabledToggle = useCallback(
    async (value: boolean) => {
      if (isSaving) return;
      if (value) {
        try {
          const consentOk = await ensureNearbyConsent();
          if (!consentOk) return;

          setNearbyEnabled(true);
          setRecordCrossedPaths(true);
          setIsPaused(false);
          setPausedUntil(null);

          if (!isDemoMode && userId) {
            setIsSaving(true);
            await updateNearbySettingsMut({
              authUserId: userId,
              nearbyEnabled: true,
              recordCrossedPaths: true,
            });
            await pauseNearbyMut({ authUserId: userId, paused: false });
          }
          Toast.show('Nearby is on');
        } catch (error: any) {
          Toast.show(error.message || 'Failed to turn on Nearby');
          if (currentUser) {
            const effectiveNearbyEnabled = getEffectiveNearbyEnabled(currentUser);
            setNearbyEnabled(effectiveNearbyEnabled);
            setRecordCrossedPaths(effectiveNearbyEnabled);
          }
        } finally {
          setIsSaving(false);
        }
        return;
      }

      setNearbyEnabled(false);
      setRecordCrossedPaths(false);
      try {
        await disableBackgroundCrossedPaths();
        await refreshBackgroundStatus();

        if (!isDemoMode && userId) {
          setIsSaving(true);
          await updateNearbySettingsMut({
            authUserId: userId,
            nearbyEnabled: false,
            recordCrossedPaths: false,
          });
        }
        Toast.show('You are hidden from Nearby');
      } catch (error: any) {
        Toast.show(error.message || 'Failed to hide from Nearby');
        if (currentUser) {
          const effectiveNearbyEnabled = getEffectiveNearbyEnabled(currentUser);
          setNearbyEnabled(effectiveNearbyEnabled);
          setRecordCrossedPaths(effectiveNearbyEnabled);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [
      currentUser,
      disableBackgroundCrossedPaths,
      ensureNearbyConsent,
      isSaving,
      pauseNearbyMut,
      refreshBackgroundStatus,
      updateNearbySettingsMut,
      userId,
    ],
  );

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
  };

  // ────────────────────────────────────────────────────────────────────────
  // Background detection — status row only. Foreground Nearby and crossed
  // paths are controlled by the master Nearby visibility action above.
  // ────────────────────────────────────────────────────────────────────────
  const bgConsentAt: number | undefined = currentUser?.backgroundLocationConsentAt;
  const bgConsentVersion: string | undefined =
    currentUser?.backgroundLocationConsentVersion;
  const bgEnabledServer: boolean = currentUser?.backgroundLocationEnabled === true;
  const discoveryEnabled: boolean = currentUser?.discoveryModeEnabled === true;
  const discoveryExpiresAt: number | undefined =
    currentUser?.discoveryModeExpiresAt;

  const bgConsentStatus: BgConsentStatus = resolveBgConsentStatus({
    featureReady: BG_CROSSED_PATHS_FEATURE_READY,
    consentAt: bgConsentAt,
    consentVersion: bgConsentVersion,
  });

  const bgServerActive =
    BG_CROSSED_PATHS_FEATURE_READY &&
    bgConsentStatus === 'granted' &&
    (bgEnabledServer || discoveryEnabled);

  const bgPermissionBlocked =
    bgStatus?.backgroundPermissionGranted === false &&
    bgStatus.backgroundPermissionCanAskAgain === false;

  const nearbyActiveForCrossedPaths =
    nearbyEnabled && !isPaused && !incognitoMode;

  const bgIsOn =
    bgServerActive &&
    bgStatus?.backgroundPermissionGranted === true &&
    bgStatus.taskActive === true;

  const bgPausedByOs =
    bgServerActive &&
    (!bgStatus?.backgroundPermissionGranted || bgStatus.taskActive === false);

  const discoveryCountdown = discoveryEnabled
    ? formatDiscoveryCountdown(discoveryExpiresAt)
    : null;

  const handleOpenAndroidAppSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      Toast.show('Open your phone settings and choose Mira.');
    }
  }, []);

  const bgDisplay = (() => {
    if (!nearbyActiveForCrossedPaths) {
      return {
        title: 'Feature paused/off',
        subtitle: 'Background detection follows Nearby. Turn on Nearby to detect crossed paths.',
        action: !nearbyEnabled ? 'Turn on Nearby first' : isPaused ? 'Resume Nearby' : null,
      };
    }
    if (!BG_CROSSED_PATHS_FEATURE_READY) {
      return {
        title: 'Feature paused/off',
        subtitle: 'Background detection is temporarily unavailable.',
        action: null,
      };
    }
    if (bgIsOn) {
      return {
        title: 'Background ON',
        subtitle: 'Mira can detect crossed paths even when the app is not open.',
        action: 'Turn off background detection',
      };
    }
    if (bgPausedByOs) {
      return {
        title: 'Paused by OS',
        subtitle: 'Background detection is paused by your phone settings.',
        action: bgPermissionBlocked ? 'Open Settings' : 'Allow background',
      };
    }
    if (bgPermissionBlocked) {
      return {
        title: 'Needs permission',
        subtitle: 'Allow background location to detect crossed paths when Mira is not open.',
        action: 'Open Settings',
      };
    }
    return {
      title: 'Foreground only',
      subtitle: 'Crossed paths work while Mira is open. Allow background location to detect more.',
      action: 'Allow background',
    };
  })();

  const showAndroidBatteryGuidance =
    Platform.OS === 'android' &&
    BG_CROSSED_PATHS_FEATURE_READY &&
    bgConsentStatus === 'granted' &&
    (bgEnabledServer || discoveryEnabled);

  // Phase-2: pause-duration options. null = indefinite ("Until turned back on").
  const PAUSE_OPTIONS: Array<{ label: string; durationMs: number | null; shortLabel: string }> = [
    { label: 'Pause for 1 hour',            shortLabel: '1h',        durationMs: 60 * 60 * 1000 },
    { label: 'Pause for 8 hours',           shortLabel: '8h',        durationMs: 8 * 60 * 60 * 1000 },
    { label: 'Pause for 24 hours',          shortLabel: '24h',       durationMs: 24 * 60 * 60 * 1000 },
    { label: 'Pause until I turn it back on', shortLabel: 'Until off', durationMs: null },
  ];

  // Resume (clear pause)
  const handleResumeNearby = useCallback(async () => {
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
  }, [pauseNearbyMut, userId]);

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
      await disableBackgroundCrossedPaths();
      await refreshBackgroundStatus();
      setIsPaused(true);
      setPausedUntil(Date.now() + effectiveMs);
      Toast.show(
        durationMs === null
          ? 'Nearby paused until you turn it back on'
          : `Nearby paused for ${shortLabel}`,
      );
    } catch {
      Toast.show('Failed to update pause status');
    }
  };

  // Map structured failure reasons from `enableBackgroundCrossedPaths` to a
  // short, in-place message. Kept here (not in the hook) so this UI surface
  // owns its own copy and doesn't depend on the explainer page. Never
  // includes raw native error text, function names, stack traces, manifest
  // identifiers, or Convex/backend details.
  const describeEnableFailure = useCallback(
    (reason: string | undefined): string => {
      switch (reason) {
        case 'feature_not_ready':
          return 'Background detection is temporarily unavailable.';
        case 'demo_mode':
          return 'Background detection is disabled in demo mode.';
        case 'not_authenticated':
          return 'Please sign in to enable background detection.';
        case 'foreground_permission_denied':
          return 'Allow location access to enable background detection.';
        case 'background_permission_denied':
          return 'Background location permission was denied.';
        case 'native_misconfigured':
          return 'Background detection needs an app update. Please update or reinstall the latest build and try again.';
        case 'consent_failed':
          return 'Could not save your preference. Try again.';
        case 'platform_setup_failed':
          return 'Could not enable background detection. Try again.';
        case 'task_start_failed':
          return 'Background service could not start. Try again.';
        default:
          return 'Failed to enable background detection.';
      }
    },
    [],
  );

  // Centralized Sentry capture for unexpected failures from this surface.
  // We only forward the structured reason + truncated error message — never
  // user state — and we tag the area/feature/action for dashboard filtering.
  const reportBgFailure = useCallback(
    (err: unknown, action: 'allow_background' | 'disable_background', reason?: string) => {
      try {
        sentryCaptureException(err ?? new Error(`bg_${action}_failed`), {
          tags: {
            area: 'nearby_settings',
            feature: 'background_detection',
            action,
            platform: Platform.OS,
            reason: reason || 'unknown',
          },
          extra: {
            message: (err as Error)?.message?.slice(0, 500),
          },
          level: 'error',
        });
      } catch {
        // Capture itself must never break the UI.
      }
    },
    [],
  );

  const handleBackgroundAction = useCallback(async () => {
    if (isBgWorking) return;
    if (!nearbyEnabled) {
      await handleNearbyEnabledToggle(true);
      return;
    }
    if (isPaused) {
      await handleResumeNearby();
      return;
    }
    if (!nearbyActiveForCrossedPaths) {
      return;
    }

    // Disable path: tap when currently ON should turn OFF locally + server.
    if (bgServerActive) {
      setIsBgWorking(true);
      try {
        const result = await disableBackgroundCrossedPaths();
        await refreshBackgroundStatus();
        if (result.ok) {
          Toast.show('Background detection turned off');
        } else {
          reportBgFailure(
            new Error('disable_background_failed'),
            'disable_background',
            result.reason,
          );
          Toast.show('Failed to turn off background detection');
        }
      } catch (err: unknown) {
        // Hook is fail-closed; this branch is purely defensive. Never
        // surface raw native text — always show friendly copy and let
        // Sentry receive the technical detail.
        reportBgFailure(err, 'disable_background', 'unexpected');
        Toast.show('Failed to turn off background detection');
      } finally {
        setIsBgWorking(false);
      }
      return;
    }

    // OS says we can no longer prompt for background location — must go to
    // system settings. Open them in-place; do NOT route to the in-app
    // explainer page.
    if (bgPermissionBlocked) {
      await handleOpenAndroidAppSettings();
      return;
    }

    // Enable path: request OS permission and start the background task
    // directly from this row. No navigation to /background-crossed-paths-explainer.
    const consentOk = await ensureNearbyConsent();
    if (!consentOk) return;

    setIsBgWorking(true);
    try {
      const result = await enableBackgroundCrossedPaths();
      await refreshBackgroundStatus();
      if (result.ok) {
        Toast.show('Background detection turned on');
      } else {
        // Native/manifest misconfiguration: the installed binary is missing
        // permissions and must be rebuilt+reinstalled. Show a friendly
        // message that does NOT contain native function names, manifest
        // identifiers, or stack traces.
        if (result.reason === 'native_misconfigured') {
          reportBgFailure(
            new Error('native_misconfigured'),
            'allow_background',
            result.reason,
          );
          Toast.show(describeEnableFailure(result.reason));
        } else if (result.reason === 'background_permission_denied') {
          // If the OS refuses to prompt again (e.g. user picked "Don't ask
          // again"), surface the open-settings affordance via Toast — the
          // row's action button will also flip to "Open Settings" once
          // `refreshBackgroundStatus` resolves.
          const status = await getBackgroundLocationStatus().catch(() => null);
          if (status && status.backgroundPermissionCanAskAgain === false) {
            Toast.show('Open system settings to allow background location.');
          } else {
            Toast.show(describeEnableFailure(result.reason));
          }
        } else {
          // Other structured failures (consent/platform/task). Send the
          // reason to Sentry and show user-friendly copy.
          reportBgFailure(
            new Error(`bg_enable_${result.reason}`),
            'allow_background',
            result.reason,
          );
          Toast.show(describeEnableFailure(result.reason));
        }
      }
    } catch (err: unknown) {
      // Defensive: the hook is already fail-closed and should never throw,
      // but we still wrap to guarantee no unhandled promise rejection
      // escapes the UI tap handler. NEVER show raw error.message to the
      // user — only friendly copy. Technical detail goes to Sentry.
      reportBgFailure(err, 'allow_background', 'unexpected');
      Toast.show(describeEnableFailure(undefined));
    } finally {
      setIsBgWorking(false);
    }
  }, [
    bgPermissionBlocked,
    bgServerActive,
    describeEnableFailure,
    disableBackgroundCrossedPaths,
    enableBackgroundCrossedPaths,
    ensureNearbyConsent,
    handleNearbyEnabledToggle,
    handleOpenAndroidAppSettings,
    handleResumeNearby,
    isBgWorking,
    isPaused,
    nearbyActiveForCrossedPaths,
    nearbyEnabled,
    refreshBackgroundStatus,
    reportBgFailure,
  ]);

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
          <View style={styles.actionRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>
                {nearbyEnabled ? 'You’re visible in Nearby' : 'You’re hidden from Nearby'}
              </Text>
              <Text style={styles.toggleDescription}>
                {nearbyEnabled
                  ? 'People can discover you when your paths cross. Your exact location is never shown.'
                  : 'Turn this on to appear in Nearby and save crossed-path history.'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.actionButton, nearbyEnabled && styles.actionButtonActive]}
              onPress={() => handleNearbyEnabledToggle(!nearbyEnabled)}
              disabled={isSaving}
            >
              <Text style={[styles.actionButtonText, nearbyEnabled && styles.actionButtonTextActive]}>
                {nearbyEnabled ? 'Hide me in Nearby' : 'Show me in Nearby'}
              </Text>
            </TouchableOpacity>
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

        {/* How Nearby works */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How Nearby works</Text>
          <View style={styles.infoCard}>
            <Ionicons name="navigate-circle-outline" size={18} color={COLORS.primary} />
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Crossed paths only</Text>
              <Text style={styles.toggleDescription}>
                Mira uses crossed paths, not live tracking. We only show approximate areas, never your exact location. Crossed paths work when two people are near the same area around the same time.
              </Text>
            </View>
          </View>
        </View>

        {/* Crossed Paths Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Crossed Paths</Text>
          <View style={styles.infoCard}>
            <Ionicons name="git-compare-outline" size={18} color={COLORS.primary} />
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Follows Nearby visibility</Text>
              <Text style={styles.toggleDescription}>
                {nearbyActiveForCrossedPaths && recordCrossedPaths
                  ? 'Mira saves crossed-path history while Nearby is on. Your exact location is never shown.'
                  : 'Crossed-path history pauses when Nearby is hidden, paused, or blocked by privacy settings.'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Background</Text>
          <Text style={styles.bgTagline}>
            Background detection is optional and helps Mira notice crossed paths when the app is not open.
          </Text>
          <View style={styles.actionRow}>
            <View style={styles.toggleInfo}>
              <View style={styles.titleRow}>
                <Text style={styles.toggleTitle}>Background detection</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>{bgDisplay.title}</Text>
                </View>
              </View>
              <Text style={styles.toggleDescription}>{bgDisplay.subtitle}</Text>
              {discoveryEnabled && discoveryCountdown ? (
                <Text style={styles.bgStatusLine}>
                  {BG_COPY.discoveryActiveLabel} — {discoveryCountdown}
                </Text>
              ) : null}
            </View>
            {bgDisplay.action && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleBackgroundAction}
                disabled={isSaving || isBgWorking}
                accessibilityState={{ busy: isBgWorking, disabled: isSaving || isBgWorking }}
              >
                <Text style={styles.actionButtonText}>
                  {isBgWorking ? 'Working…' : bgDisplay.action}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={styles.bgLearnMore}
            onPress={() => router.push('/(main)/background-crossed-paths-explainer' as any)}
            accessibilityLabel="Learn more about background detection"
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={COLORS.primary}
            />
            <Text style={styles.bgLearnMoreText}>Learn more</Text>
          </TouchableOpacity>

          {bgServerActive && (
            <Text style={styles.bgRevokeNote}>{BG_COPY.revokeNote}</Text>
          )}

          {showAndroidBatteryGuidance && (
            <View style={styles.androidBatteryCard}>
              <View style={styles.androidBatteryHeader}>
                <Ionicons name="battery-charging-outline" size={17} color={COLORS.primary} />
                <Text style={styles.androidBatteryTitle}>{BG_COPY.androidBatteryTitle}</Text>
              </View>
              <Text style={styles.androidBatteryText}>
                {BG_COPY.androidBatteryDescription}
              </Text>
              <TouchableOpacity
                style={styles.androidBatteryAction}
                onPress={handleOpenAndroidAppSettings}
                accessibilityLabel="Open Android app settings"
              >
                <Text style={styles.androidBatteryActionText}>
                  {BG_COPY.androidBatteryAction}
                </Text>
                <Ionicons name="open-outline" size={15} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Privacy Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>

          {/* Privacy Zones — opens dedicated settings screen */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => router.push('/(main)/settings/privacy-zones' as any)}
            accessibilityLabel="Open Privacy Zones"
          >
            <View style={styles.actionInfo}>
              <Text style={styles.toggleTitle}>Privacy Zones</Text>
              <Text style={styles.toggleDescription}>
                Add Privacy Zones for places like home, hostel, hospital, or work so crossings are not recorded there.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

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
    maxWidth: 150,
  },
  actionButtonActive: {
    backgroundColor: COLORS.primary,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
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
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: COLORS.primarySubtle,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.4,
  },
  // Phase-2 Background Crossed Paths styles
  bgTagline: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 18,
    marginBottom: 8,
  },
  bgStatusLine: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
  },
  bgInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  bgInfoText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  bgLearnMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  bgLearnMoreText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  bgRevokeNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
    lineHeight: 16,
  },
  androidBatteryCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundDark,
  },
  androidBatteryHeader: {
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  androidBatteryTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  androidBatteryText: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textMuted,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  androidBatteryAction: {
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
    alignSelf: I18nManager.isRTL ? 'flex-end' : 'flex-start',
    gap: 6,
    marginTop: 10,
    paddingVertical: 4,
  },
  androidBatteryActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  comingSoonBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: COLORS.warning,
  },
  comingSoonBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: 0.5,
  },
});
