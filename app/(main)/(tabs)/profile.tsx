import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Avatar, Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

export default function ProfileScreen() {
  const router = useRouter();
  const { userId, logout } = useAuthStore();

  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId: userId as any } : 'skip'
  );

  const subscriptionStatus = useQuery(
    api.subscriptions.getSubscriptionStatus,
    userId ? { userId: userId as any } : 'skip'
  );

  const deactivateAccount = useMutation(api.users.deactivateAccount);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  };

  const handleDeactivate = () => {
    if (!userId) return;
    Alert.alert(
      'Deactivate Account',
      'Are you sure you want to deactivate your account? You can reactivate it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            try {
              await deactivateAccount({ userId: userId as any });
              logout();
              router.replace('/(auth)/welcome');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to deactivate account');
            }
          },
        },
      ]
    );
  };

  if (!currentUser) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  const age = new Date().getFullYear() - new Date(currentUser.dateOfBirth).getFullYear();
  const primaryPhoto = currentUser.photos?.find((p) => p.isPrimary) || currentUser.photos?.[0];

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity onPress={() => router.push('/(main)/edit-profile')}>
          <Ionicons name="create-outline" size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.profileSection}>
        {primaryPhoto ? (
          <Image source={{ uri: primaryPhoto.url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <Avatar size={100} />
        )}
        {currentUser.isVerified && (
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        )}
        <Text style={styles.name}>
          {currentUser.name}, {age}
        </Text>
        {currentUser.bio && <Text style={styles.bio}>{currentUser.bio}</Text>}
      </View>

      {subscriptionStatus && currentUser.gender === 'male' && (
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>Subscription</Text>
          <View style={styles.statsRow}>
            <Text style={styles.statsLabel}>Tier:</Text>
            <Text style={styles.statsValue}>
              {subscriptionStatus.tier.charAt(0).toUpperCase() + subscriptionStatus.tier.slice(1)}
            </Text>
          </View>
          {subscriptionStatus.isSubscribed && subscriptionStatus.expiresAt && (
            <View style={styles.statsRow}>
              <Text style={styles.statsLabel}>Expires:</Text>
              <Text style={styles.statsValue}>
                {new Date(subscriptionStatus.expiresAt).toLocaleDateString()}
              </Text>
            </View>
          )}
          <Button
            title="Manage Subscription"
            variant="outline"
            onPress={() => router.push('/(main)/subscription')}
            style={styles.subscriptionButton}
          />
        </View>
      )}

      <View style={styles.menuSection}>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(main)/settings')}
        >
          <Ionicons name="settings-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Settings</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(main)/subscription')}
        >
          <Ionicons name="diamond-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Subscription</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(main)/edit-profile')}
        >
          <Ionicons name="create-outline" size={24} color={COLORS.text} />
          <Text style={styles.menuText}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Button title="Logout" variant="outline" onPress={handleLogout} />
        <TouchableOpacity onPress={handleDeactivate} style={styles.deactivateButton}>
          <Text style={styles.deactivateText}>Deactivate Account</Text>
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
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  profileSection: {
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 12,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 12,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    marginLeft: 4,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  bio: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
  statsCard: {
    backgroundColor: COLORS.backgroundDark,
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statsLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  statsValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  subscriptionButton: {
    marginTop: 12,
  },
  menuSection: {
    marginTop: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    marginLeft: 16,
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
  },
  deactivateButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  deactivateText: {
    fontSize: 14,
    color: COLORS.error,
    fontWeight: '500',
  },
});
