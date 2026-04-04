/**
 * Phase-2 Notifications Settings Screen
 *
 * Deep Connect specific notification controls:
 * - All Notifications (master toggle)
 * - Deep Connect notifications
 * - Private Messages
 * - Chat Rooms
 * - Truth or Dare
 *
 * Uses Phase-2 dark premium styling (INCOGNITO_COLORS).
 * No Phase-1 categories.
 */
import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';

const C = INCOGNITO_COLORS;

interface NotificationCategory {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    key: 'deepConnect',
    icon: 'link-outline',
    title: 'Deep Connect',
    description: 'New connections and profile views',
  },
  {
    key: 'privateMessages',
    icon: 'chatbubble-outline',
    title: 'Private Messages',
    description: 'Messages from your connections',
  },
  {
    key: 'chatRooms',
    icon: 'people-outline',
    title: 'Chat Rooms',
    description: 'Activity in rooms you\'ve joined',
  },
  {
    key: 'truthOrDare',
    icon: 'game-controller-outline',
    title: 'Truth or Dare',
    description: 'Game invites and responses',
  },
];

export default function PrivateNotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Master toggle from store (local-only until backend supports them)
  const notificationsEnabled = usePrivateProfileStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = usePrivateProfileStore((s) => s.setNotificationsEnabled);

  // Category toggles from store
  const notificationCategories = usePrivateProfileStore((s) => s.notificationCategories);
  const setNotificationCategory = usePrivateProfileStore((s) => s.setNotificationCategory);

  // Handle master toggle (local store only)
  const handleMasterToggle = useCallback((enabled: boolean) => {
    setNotificationsEnabled(enabled);
  }, [setNotificationsEnabled]);

  // Handle category toggle (local store only)
  const handleCategoryToggle = useCallback((categoryKey: string, enabled: boolean) => {
    setNotificationCategory(categoryKey, enabled);
  }, [setNotificationCategory]);

  // Check if category is enabled
  const isCategoryEnabled = (key: string): boolean => {
    return notificationCategories[key] !== false; // Default to true if not set
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Master Toggle Section */}
          <View style={styles.section}>
            <View style={styles.masterToggleCard}>
              <TouchableOpacity
                style={styles.masterToggleRow}
                onPress={() => handleMasterToggle(!notificationsEnabled)}
                activeOpacity={0.7}
              >
                <View style={styles.masterToggleInfo}>
                  <View style={[styles.masterIconBox, notificationsEnabled && styles.masterIconBoxActive]}>
                    <Ionicons
                      name="notifications"
                      size={24}
                      color={notificationsEnabled ? '#FFF' : C.textLight}
                    />
                  </View>
                  <View style={styles.masterToggleText}>
                    <Text style={styles.masterToggleTitle}>Enable Notifications</Text>
                    <Text style={styles.masterToggleDescription}>
                      {notificationsEnabled
                        ? 'You\'ll receive updates from Deep Connect'
                        : 'All notifications are currently disabled'}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={handleMasterToggle}
                  trackColor={{ false: C.border, true: C.primary }}
                  thumbColor="#FFF"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Category Toggles Section */}
          {notificationsEnabled && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notification Categories</Text>
              <Text style={styles.sectionSubtitle}>Choose which notifications you want to receive</Text>

              {NOTIFICATION_CATEGORIES.map((category, index) => (
                <View
                  key={category.key}
                  style={[
                    styles.categoryCard,
                    index === NOTIFICATION_CATEGORIES.length - 1 && styles.categoryCardLast,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.categoryRow}
                    onPress={() => handleCategoryToggle(category.key, !isCategoryEnabled(category.key))}
                    activeOpacity={0.7}
                  >
                    <View style={styles.categoryInfo}>
                      <View style={[
                        styles.categoryIconBox,
                        isCategoryEnabled(category.key) && styles.categoryIconBoxActive,
                      ]}>
                        <Ionicons
                          name={category.icon}
                          size={20}
                          color={isCategoryEnabled(category.key) ? '#FFF' : C.text}
                        />
                      </View>
                      <View style={styles.categoryTextContainer}>
                        <Text style={styles.categoryTitle}>{category.title}</Text>
                        <Text style={styles.categoryDescription}>{category.description}</Text>
                      </View>
                    </View>
                    <Switch
                      value={isCategoryEnabled(category.key)}
                      onValueChange={(value) => handleCategoryToggle(category.key, value)}
                      trackColor={{ false: C.border, true: C.primary }}
                      thumbColor="#FFF"
                    />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Info Section */}
          <View style={styles.infoSection}>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={22} color={C.primary} />
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>About Notifications</Text>
                <Text style={styles.infoText}>
                  These settings control notifications for your Deep Connect profile. Phase-1 notifications are managed separately in the main settings.
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
  // Master toggle
  masterToggleCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  masterToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  masterToggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  masterIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  masterIconBoxActive: {
    backgroundColor: C.primary,
  },
  masterToggleText: {
    flex: 1,
  },
  masterToggleTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  masterToggleDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 17,
  },
  // Category cards
  categoryCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  categoryCardLast: {
    marginBottom: 0,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  categoryInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  categoryIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  categoryIconBoxActive: {
    backgroundColor: C.primary,
  },
  categoryTextContainer: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  categoryDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 17,
  },
  // Info section
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
