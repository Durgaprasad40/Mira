import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Switch,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { BlurProfileNotice } from '@/components/profile/BlurProfileNotice';
import { Toast } from '@/components/ui/Toast';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { useDemoNotifStore } from '@/hooks/useNotifications';
import { getProfileCompleteness, NUDGE_MESSAGES } from '@/lib/profileCompleteness';
import { ProfileNudge } from '@/components/ui/ProfileNudge';

export default function SettingsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;

  // Profile completeness nudge
  const dismissedNudges = useDemoStore((s) => s.dismissedNudges);
  const dismissNudge = useDemoStore((s) => s.dismissNudge);
  const settingsNudgeStatus = currentUser
    ? getProfileCompleteness({
        photoCount: Array.isArray(currentUser.photos) ? currentUser.photos.length : 0,
        bioLength: currentUser.bio?.length ?? 0,
      })
    : 'complete';
  const showSettingsNudge =
    settingsNudgeStatus !== 'complete' && !dismissedNudges.includes('settings');

  // Hard timeout for loading state
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isDemoMode) return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const toggleIncognito = useMutation(api.users.toggleIncognito);
  const toggleDiscoveryPause = useMutation(api.users.toggleDiscoveryPause);
  const togglePhotoBlurMut = isDemoMode ? null : useMutation(api.users.togglePhotoBlur);

  const [incognitoEnabled, setIncognitoEnabled] = useState(currentUser?.incognitoMode || false);
  const [pauseEnabled, setPauseEnabled] = useState(false);
  const [showLastSeenEnabled, setShowLastSeenEnabled] = useState(currentUser?.showLastSeen !== false);
  const [blurEnabled, setBlurEnabled] = useState(currentUser?.photoBlurred === true);
  const [showBlurNotice, setShowBlurNotice] = useState(false);

  // ── Hidden Dev Panel (7 taps on title) ──
  const [showDevPanel, setShowDevPanel] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTitleTap = useCallback(() => {
    // Only works in demo/dev mode
    if (!isDemoMode && !__DEV__) return;

    tapCountRef.current += 1;

    // Reset tap count after 2 seconds of no taps
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    tapTimeoutRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 2000);

    // 7 taps triggers dev panel
    if (tapCountRef.current >= 7) {
      tapCountRef.current = 0;
      setShowDevPanel(true);
    }
  }, []);

  const handleDevAction = useCallback((action: 'debug-log' | 'qa-checklist' | 'demo-panel' | 'reset') => {
    setShowDevPanel(false);
    switch (action) {
      case 'debug-log':
        router.push('/(main)/qa-debug-log' as any);
        break;
      case 'qa-checklist':
        router.push('/(main)/qa-checklist' as any);
        break;
      case 'demo-panel':
        router.push('/(main)/demo-panel' as any);
        break;
      case 'reset':
        Alert.alert(
          'Reset demo?',
          'This will clear matches, chats, likes, blocks, and notifications.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Reset',
              style: 'destructive',
              onPress: () => {
                useDemoStore.getState().reset();
                useDemoDmStore.getState().reset();
                useDemoNotifStore.getState().reset();
                router.replace('/(main)/(tabs)/home' as any);
              },
            },
          ],
        );
        break;
    }
  }, [router]);

  React.useEffect(() => {
    if (currentUser) {
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


  const handleTogglePause = async (paused: boolean) => {
    if (isDemoMode) {
      setPauseEnabled(paused);
      return;
    }
    if (!userId) return;

    try {
      await toggleDiscoveryPause({ userId: userId as any, paused });
      setPauseEnabled(paused);
    } catch {
      Toast.show('Couldn\u2019t update this setting. Please try again.');
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
        .catch(() => Toast.show('Couldn\u2019t update blur setting. Please try again.'));
    }
  };

  const handleBlurConfirm = async () => {
    setShowBlurNotice(false);
    if (isDemoMode) { setBlurEnabled(true); return; }
    if (!userId || !togglePhotoBlurMut) return;
    try {
      await togglePhotoBlurMut({ userId: userId as any, blurred: true });
      setBlurEnabled(true);
    } catch {
      Toast.show('Couldn\u2019t update blur setting. Please try again.');
    }
  };

  const handleToggleIncognito = async (enabled: boolean) => {
    if (!userId) return;

    try {
      await toggleIncognito({ userId: userId as any, enabled });
      setIncognitoEnabled(enabled);
    } catch {
      Toast.show('Couldn\u2019t update this setting. Please try again.');
      setIncognitoEnabled(!enabled);
    }
  };

  if (!currentUser) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{timedOut ? 'Failed to load settings' : 'Loading...'}</Text>
          <TouchableOpacity style={styles.loadingBackButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color={COLORS.white} />
            <Text style={styles.loadingBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canUseIncognito =
    currentUser.gender === 'female' || currentUser.subscriptionTier === 'premium';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
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
        <TouchableOpacity onPress={handleTitleTap} activeOpacity={1}>
          <Text style={styles.headerTitle}>Settings</Text>
        </TouchableOpacity>
        <View style={{ width: 24 }} />
      </View>

      {showSettingsNudge && (
        <ProfileNudge
          message={NUDGE_MESSAGES[settingsNudgeStatus as Exclude<typeof settingsNudgeStatus, 'complete'>].settings}
          variant="inline"
          onDismiss={() => dismissNudge('settings')}
        />
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Discovery</Text>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(main)/discovery-preferences' as any)}
        >
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Discovery Preferences</Text>
            <Text style={styles.settingDescription}>Age, distance, and who you see</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
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

      {/* Hidden Dev Panel Modal — triggered by 7 taps on "Settings" title */}
      <Modal
        visible={showDevPanel}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDevPanel(false)}
      >
        <TouchableOpacity
          style={styles.devPanelOverlay}
          activeOpacity={1}
          onPress={() => setShowDevPanel(false)}
        >
          <View style={styles.devPanelContainer}>
            <Text style={styles.devPanelTitle}>Dev Tools</Text>
            <TouchableOpacity
              style={styles.devPanelItem}
              onPress={() => handleDevAction('debug-log')}
            >
              <Ionicons name="list-outline" size={20} color="#3B82F6" />
              <Text style={styles.devPanelItemText}>Debug Event Log</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPanelItem}
              onPress={() => handleDevAction('qa-checklist')}
            >
              <Ionicons name="checkbox-outline" size={20} color="#10B981" />
              <Text style={styles.devPanelItemText}>QA Checklist</Text>
            </TouchableOpacity>
            {isDemoMode && (
              <>
                <TouchableOpacity
                  style={styles.devPanelItem}
                  onPress={() => handleDevAction('demo-panel')}
                >
                  <Ionicons name="flask-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.devPanelItemText}>Demo Test Panel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.devPanelItem}
                  onPress={() => handleDevAction('reset')}
                >
                  <Ionicons name="refresh-circle-outline" size={20} color={COLORS.error} />
                  <Text style={styles.devPanelItemText}>Reset Demo Data</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={styles.devPanelClose}
              onPress={() => setShowDevPanel(false)}
            >
              <Text style={styles.devPanelCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
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
  // Dev Panel styles
  devPanelOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  devPanelContainer: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 20,
    width: '80%',
    maxWidth: 300,
  },
  devPanelTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  devPanelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  devPanelItemText: {
    fontSize: 15,
    color: COLORS.text,
  },
  devPanelClose: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
  },
  devPanelCloseText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
  },
});
