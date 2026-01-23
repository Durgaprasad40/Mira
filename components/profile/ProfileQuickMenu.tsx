import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Badge } from '@/components/ui';
import { useAuthStore, useSubscriptionStore } from '@/stores';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

interface ProfileQuickMenuProps {
  visible: boolean;
  onClose: () => void;
}

export function ProfileQuickMenu({ visible, onClose }: ProfileQuickMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const { isPremium } = useSubscriptionStore();

  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId } : 'skip'
  );

  const messageQuota = useQuery(
    api.messages.getUnreadCount,
    userId ? { userId } : 'skip'
  );

  const menuItems = [
    {
      id: 'profile',
      label: 'View Profile',
      icon: 'person-outline',
      onPress: () => {
        onClose();
        router.push('/(main)/(tabs)/profile');
      },
    },
    {
      id: 'edit',
      label: 'Edit Profile',
      icon: 'create-outline',
      onPress: () => {
        onClose();
        router.push('/(main)/edit-profile');
      },
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'settings-outline',
      onPress: () => {
        onClose();
        router.push('/(main)/settings');
      },
    },
    {
      id: 'subscription',
      label: 'Subscription',
      icon: 'card-outline',
      badge: !isPremium ? 'Upgrade' : undefined,
      onPress: () => {
        onClose();
        router.push('/(main)/subscription');
      },
    },
    {
      id: 'help',
      label: 'Help & FAQ',
      icon: 'help-circle-outline',
      onPress: () => {
        onClose();
        // TODO: Navigate to help screen
      },
    },
    {
      id: 'logout',
      label: 'Log Out',
      icon: 'log-out-outline',
      color: COLORS.error,
      onPress: () => {
        onClose();
        // TODO: Handle logout
      },
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View
          style={[
            styles.menu,
            {
              top: insets.top + 60,
              right: 16,
            },
          ]}
        >
          {/* Profile Header */}
          {currentUser && (
            <View style={styles.profileHeader}>
              <Avatar
                source={{ uri: currentUser.photos?.[0]?.url }}
                size={48}
              />
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>{currentUser.name}</Text>
                {currentUser.isVerified && (
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
                    <Text style={styles.verifiedText}>Verified</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Stats */}
          <View style={styles.stats}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {currentUser?.messagesRemaining || 0}
              </Text>
              <Text style={styles.statLabel}>Messages</Text>
            </View>
            {currentUser?.trialEndsAt && (
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {Math.ceil((currentUser.trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24))}
                </Text>
                <Text style={styles.statLabel}>Trial days</Text>
              </View>
            )}
          </View>

          <View style={styles.divider} />

          {/* Menu Items */}
          <ScrollView style={styles.menuItems}>
            {menuItems.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.menuItem}
                onPress={item.onPress}
              >
                <Ionicons
                  name={item.icon as any}
                  size={24}
                  color={item.color || COLORS.text}
                />
                <Text style={[styles.menuItemText, item.color && { color: item.color }]}>
                  {item.label}
                </Text>
                {item.badge && (
                  <Badge
                    text={item.badge}
                    variant="primary"
                    style={styles.badge}
                  />
                )}
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={COLORS.textLight}
                  style={styles.chevron}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  menu: {
    position: 'absolute',
    width: 280,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    maxHeight: 600,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  stats: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 24,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  menuItems: {
    maxHeight: 400,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },
  badge: {
    marginLeft: 'auto',
  },
  chevron: {
    marginLeft: 8,
  },
});
