import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { Toast } from '@/components/ui/Toast';

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  // Query current user notification settings (live mode only)
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  // Mutation to update notification settings
  const updateNotificationSettings = useMutation(api.users.updateNotificationSettings);

  // Local state for toggles (synced with backend on load)
  const [pushEnabled, setPushEnabled] = useState(true);
  const [newMatches, setNewMatches] = useState(true);
  const [newMessages, setNewMessages] = useState(true);
  const [likesAndSuperLikes, setLikesAndSuperLikes] = useState(true);
  const [profileViews, setProfileViews] = useState(true);

  // Hydrate state from backend when currentUser loads
  useEffect(() => {
    if (currentUser) {
      // notificationsEnabled is the master toggle
      setPushEnabled(currentUser.notificationsEnabled !== false);
      // Child notification type preferences (default to true if undefined)
      setNewMatches(currentUser.notifyNewMatches !== false);
      setNewMessages(currentUser.notifyNewMessages !== false);
      setLikesAndSuperLikes(currentUser.notifyLikesAndSuperLikes !== false);
      setProfileViews(currentUser.notifyProfileViews !== false);
    }
  }, [currentUser]);

  // Handler for master push toggle
  const handlePushToggle = async (enabled: boolean) => {
    if (isDemoMode) {
      setPushEnabled(enabled);
      return;
    }
    if (!userId) return;

    try {
      await updateNotificationSettings({ userId: userId as any, notificationsEnabled: enabled });
      setPushEnabled(enabled);
    } catch {
      Toast.show('Couldn\u2019t update notification settings. Please try again.');
      setPushEnabled(!enabled);
    }
  };

  // Handlers for child notification toggles
  const handleNewMatchesToggle = async (enabled: boolean) => {
    if (isDemoMode) { setNewMatches(enabled); return; }
    if (!userId) return;
    try {
      await updateNotificationSettings({ userId: userId as any, notifyNewMatches: enabled });
      setNewMatches(enabled);
    } catch {
      Toast.show('Couldn\u2019t update setting. Please try again.');
      setNewMatches(!enabled);
    }
  };

  const handleNewMessagesToggle = async (enabled: boolean) => {
    if (isDemoMode) { setNewMessages(enabled); return; }
    if (!userId) return;
    try {
      await updateNotificationSettings({ userId: userId as any, notifyNewMessages: enabled });
      setNewMessages(enabled);
    } catch {
      Toast.show('Couldn\u2019t update setting. Please try again.');
      setNewMessages(!enabled);
    }
  };

  const handleLikesToggle = async (enabled: boolean) => {
    if (isDemoMode) { setLikesAndSuperLikes(enabled); return; }
    if (!userId) return;
    try {
      await updateNotificationSettings({ userId: userId as any, notifyLikesAndSuperLikes: enabled });
      setLikesAndSuperLikes(enabled);
    } catch {
      Toast.show('Couldn\u2019t update setting. Please try again.');
      setLikesAndSuperLikes(!enabled);
    }
  };

  const handleProfileViewsToggle = async (enabled: boolean) => {
    if (isDemoMode) { setProfileViews(enabled); return; }
    if (!userId) return;
    try {
      await updateNotificationSettings({ userId: userId as any, notifyProfileViews: enabled });
      setProfileViews(enabled);
    } catch {
      Toast.show('Couldn\u2019t update setting. Please try again.');
      setProfileViews(!enabled);
    }
  };

  // Child toggles disabled when master push is off
  const childDisabled = !pushEnabled;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Master Push Toggle */}
        <View style={styles.section}>
          <View style={styles.masterToggleRow}>
            <View style={styles.masterToggleLeft}>
              <View style={styles.masterIconContainer}>
                <Ionicons name="notifications" size={22} color={COLORS.white} />
              </View>
              <View style={styles.toggleInfo}>
                <Text style={styles.masterToggleTitle}>Push Notifications</Text>
                <Text style={styles.toggleDescription}>
                  {pushEnabled ? 'Enabled' : 'All notifications are paused'}
                </Text>
              </View>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={handlePushToggle}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>
          <Text style={styles.pushExplanation}>
            Push notifications are alerts sent to your phone even when the app is closed. Turn this off to stop all notifications.
          </Text>
        </View>

        {/* Notification Types */}
        <View style={[styles.section, childDisabled && styles.sectionDisabled]}>
          <Text style={styles.sectionTitle}>Notification Types</Text>

          <View style={[styles.toggleRow, childDisabled && styles.rowDisabled]}>
            <View style={styles.toggleRowLeft}>
              <Ionicons name="heart-outline" size={20} color={childDisabled ? COLORS.textMuted : COLORS.text} />
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleTitle, childDisabled && styles.textDisabled]}>New matches</Text>
                <Text style={styles.toggleDescription}>When you match with someone</Text>
              </View>
            </View>
            <Switch
              value={newMatches}
              onValueChange={handleNewMatchesToggle}
              disabled={childDisabled}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>

          <View style={[styles.toggleRow, childDisabled && styles.rowDisabled]}>
            <View style={styles.toggleRowLeft}>
              <Ionicons name="chatbubble-outline" size={20} color={childDisabled ? COLORS.textMuted : COLORS.text} />
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleTitle, childDisabled && styles.textDisabled]}>New messages</Text>
                <Text style={styles.toggleDescription}>When you receive a message</Text>
              </View>
            </View>
            <Switch
              value={newMessages}
              onValueChange={handleNewMessagesToggle}
              disabled={childDisabled}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>

          <View style={[styles.toggleRow, childDisabled && styles.rowDisabled]}>
            <View style={styles.toggleRowLeft}>
              <Ionicons name="star-outline" size={20} color={childDisabled ? COLORS.textMuted : COLORS.text} />
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleTitle, childDisabled && styles.textDisabled]}>Likes & Super likes</Text>
                <Text style={styles.toggleDescription}>When someone likes your profile</Text>
              </View>
            </View>
            <Switch
              value={likesAndSuperLikes}
              onValueChange={handleLikesToggle}
              disabled={childDisabled}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>

          <View style={[styles.toggleRow, childDisabled && styles.rowDisabled]}>
            <View style={styles.toggleRowLeft}>
              <Ionicons name="eye-outline" size={20} color={childDisabled ? COLORS.textMuted : COLORS.text} />
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleTitle, childDisabled && styles.textDisabled]}>Profile views</Text>
                <Text style={styles.toggleDescription}>When someone views your profile</Text>
              </View>
            </View>
            <Switch
              value={profileViews}
              onValueChange={handleProfileViewsToggle}
              disabled={childDisabled}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>
        </View>

        {/* Quiet Hours */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule</Text>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7}>
            <View style={styles.menuRowLeft}>
              <Ionicons name="moon-outline" size={22} color={COLORS.text} />
              <View style={styles.menuRowInfo}>
                <Text style={styles.menuRowTitle}>Quiet hours</Text>
                <Text style={styles.menuRowSubtitle}>Coming soon</Text>
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
  sectionDisabled: {
    opacity: 0.5,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  // Master toggle row
  masterToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  masterToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  masterIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masterToggleTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  pushExplanation: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginTop: 12,
  },
  // Child toggle rows
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowDisabled: {
    opacity: 0.6,
  },
  toggleRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  textDisabled: {
    color: COLORS.textMuted,
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
