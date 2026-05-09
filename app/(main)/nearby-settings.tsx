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
import { useBackgroundLocation } from '@/hooks/useBackgroundLocation';

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
  // Phase-3 background crossed paths: the OFF path is routed through the
  // `useBackgroundLocation` hook, which stops the OS task, clears the buffer,
  // and revokes server-side consent. ON path is reserved for the explainer
  // modal — and even there only when the client-side feature gate is ON.
  const { disableBackgroundCrossedPaths } = useBackgroundLocation();

  // Local state (initialized from server)
  const [nearbyEnabled, setNearbyEnabled] = useState(true);
  const [hideDistance, setHideDistance] = useState(false);
  const [incognitoMode, setIncognitoMode] = useState(false);
  // Phase-2: separate crossed-paths opt-in. Default true (undefined → on).
  const [recordCrossedPaths, setRecordCrossedPaths] = useState(true);
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

  // Toggle handlers
  const handleNearbyEnabledToggle = (value: boolean) => {
    setNearbyEnabled(value);
    handleSave('nearbyEnabled', value);
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
  };

  // Phase-2: record-crossed-paths toggle (independent from map visibility)
  const handleRecordCrossedPathsToggle = (value: boolean) => {
    setRecordCrossedPaths(value);
    handleSave('recordCrossedPaths', value);
  };

  // ────────────────────────────────────────────────────────────────────────
  // Phase-2: Background Crossed Paths — UI/consent foundation only.
  //
  // STRICT RULES enforced by this section:
  //   - The toggle does NOT request any OS background-location permission.
  //   - It does NOT call TaskManager / startLocationUpdatesAsync.
  //   - "Turn ON" is only reachable when BG_CROSSED_PATHS_FEATURE_READY is true
  //     AND, even then, only routes through the explainer modal — accept is
  //     called from there, not from this row.
  //   - "Turn OFF" always works (idempotent revoke), regardless of the gate,
  //     so any consent ever recorded can be cleared from this screen.
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

  // Toggle is "on" from the user's perspective when consent is granted AND
  // the server still has backgroundLocationEnabled=true. Stale-version
  // consent renders as off so the user can re-confirm via the explainer.
  const bgToggleOn =
    BG_CROSSED_PATHS_FEATURE_READY &&
    bgConsentStatus === 'granted' &&
    bgEnabledServer;

  const discoveryCountdown = discoveryEnabled
    ? formatDiscoveryCountdown(discoveryExpiresAt)
    : null;

  const handleBgToggle = useCallback(
    async (value: boolean) => {
      // OFF path — ALWAYS available. The hook stops the OS task, clears the
      // on-disk buffer, then revokes server-side consent (which also clears
      // backgroundLocationEnabled and Discovery Mode). The OFF path NEVER
      // requests any OS permission and never starts anything.
      if (!value) {
        // No consent on file and feature gate is off → nothing to do.
        if (
          bgConsentStatus === 'unavailable' ||
          (bgConsentStatus === 'none' && !bgEnabledServer)
        ) {
          return;
        }
        if (isDemoMode) {
          Toast.show('Background crossed paths turned off');
          return;
        }
        const result = await disableBackgroundCrossedPaths();
        if (result.ok) {
          Toast.show('Background crossed paths turned off');
        } else {
          Toast.show('Failed to update background crossed paths');
        }
        return;
      }

      // ON path — gated. When the feature is not ready we route to the
      // explainer in read-only mode (its accept CTA itself is gated and
      // currently dismisses without any side effects). When the feature
      // flips ON, the explainer's CTA hands off to
      // `enableBackgroundCrossedPaths()` which performs the full flow.
      router.push('/(main)/background-crossed-paths-explainer' as any);
    },
    [bgConsentStatus, bgEnabledServer, disableBackgroundCrossedPaths, router],
  );

  const handleOpenBgExplainer = useCallback(() => {
    router.push('/(main)/background-crossed-paths-explainer' as any);
  }, [router]);

  const bgStatusLine = (() => {
    if (bgConsentStatus === 'unavailable') return BG_COPY.statusComingSoon;
    if (bgConsentStatus === 'granted' && bgEnabledServer) {
      return BG_COPY.statusConsentGranted;
    }
    if (bgConsentStatus === 'stale') return BG_COPY.statusConsentNone;
    return BG_COPY.statusConsentNone;
  })();

  const bgDescription = BG_CROSSED_PATHS_FEATURE_READY
    ? BG_COPY.toggleDescriptionReady
    : BG_COPY.toggleDescriptionUnavailable;

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

          {/* Crossed-path history opt-in */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Save crossed paths</Text>
              <Text style={styles.toggleDescription}>
                Mira uses approximate location to remember people you crossed paths with while
                you are using the app. Your live location is never shown. You can pause this anytime.
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

        {/* ──────────────────────────────────────────────────────────────
            Phase-2: Background Crossed Paths section.
            UI/consent foundation only — no OS-permission requests, no
            background tracking. The "Turn ON" path goes through the
            explainer modal; the "Turn OFF" path is always reachable.
            ────────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{BG_COPY.sectionTitle}</Text>
          <Text style={styles.bgTagline}>{BG_COPY.sectionTagline}</Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <View style={styles.titleRow}>
                <Text style={styles.toggleTitle}>{BG_COPY.toggleTitle}</Text>
                {!BG_CROSSED_PATHS_FEATURE_READY && (
                  <View style={styles.comingSoonBadge}>
                    <Text style={styles.comingSoonBadgeText}>SOON</Text>
                  </View>
                )}
              </View>
              <Text style={styles.toggleDescription}>{bgDescription}</Text>
              <Text style={styles.bgStatusLine}>{bgStatusLine}</Text>
            </View>
            <Switch
              value={bgToggleOn}
              onValueChange={handleBgToggle}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
              // OFF must always be reachable so existing consent can be
              // cleared. ON is reachable only when the gate is ready, the
              // user is not paused, and we are not mid-save. The explainer
              // modal still gates the actual accept call.
              disabled={
                isSaving ||
                (!BG_CROSSED_PATHS_FEATURE_READY && !bgToggleOn && !bgEnabledServer)
              }
            />
          </View>

          {/* Discovery Mode read-out (visible when active). Phase-2 has no
              start/stop UI here — backend controls and Phase-3 native code
              own the lifecycle. We only surface the current state. */}
          {discoveryEnabled && (
            <View style={styles.bgInfoRow}>
              <Ionicons name="compass-outline" size={16} color={COLORS.primary} />
              <Text style={styles.bgInfoText}>
                {BG_COPY.discoveryActiveLabel}
                {discoveryCountdown ? ` — ${discoveryCountdown}` : ''}
              </Text>
            </View>
          )}

          {/* Always provide a way back into the explainer for users who want
              to read the policy without flipping the switch. */}
          <TouchableOpacity
            style={styles.bgLearnMore}
            onPress={handleOpenBgExplainer}
            accessibilityLabel="Learn more about background crossed paths"
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={COLORS.primary}
            />
            <Text style={styles.bgLearnMoreText}>Learn more</Text>
          </TouchableOpacity>

          {bgToggleOn && (
            <Text style={styles.bgRevokeNote}>{BG_COPY.revokeNote}</Text>
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
                Stop Nearby and crossed paths from recording private areas
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
