/**
 * Phase-2 Blocked Users Settings Screen
 *
 * Displays list of users the current user has blocked.
 * Read-only view - blocks are permanent.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;

export default function BlockedUsersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  // Fetch blocked users
  const blockedData = useQuery(
    api.users.getMyBlockedUsers,
    !isDemoMode && userId ? { authUserId: userId } : 'skip'
  );

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const blockedUsers = blockedData?.blockedUsers || [];
  const isLoading = blockedData === undefined;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked Users</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={20} color={C.textLight} />
          <Text style={styles.infoText}>
            Blocked users cannot find you in Desire Land or send you messages. Blocks are permanent.
          </Text>
        </View>

        {/* Loading State */}
        {isLoading && (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.emptyText}>Loading...</Text>
          </View>
        )}

        {/* Empty State */}
        {!isLoading && blockedUsers.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="shield-checkmark-outline" size={48} color={C.textLight} />
            <Text style={styles.emptyTitle}>No Blocked Users</Text>
            <Text style={styles.emptyText}>
              You haven't blocked anyone yet. You can block users from their profile or chat.
            </Text>
          </View>
        )}

        {/* Blocked Users List */}
        {!isLoading && blockedUsers.length > 0 && (
          <View style={styles.listContainer}>
            {blockedUsers.map((user: any) => (
              <View key={user.blockId} style={styles.userRow}>
                <View style={styles.userInfo}>
                  <View style={styles.avatar}>
                    <Ionicons name="person" size={20} color={C.textLight} />
                  </View>
                  <View style={styles.userDetails}>
                    <Text style={styles.userName}>{user.displayName}</Text>
                    <Text style={styles.blockedDate}>
                      Blocked {formatDate(user.blockedAt)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
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
    borderBottomColor: C.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text,
  },
  content: {
    flex: 1,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    margin: 16,
    padding: 12,
    backgroundColor: C.surface,
    borderRadius: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  listContainer: {
    paddingHorizontal: 16,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: '500',
    color: C.text,
    marginBottom: 2,
  },
  blockedDate: {
    fontSize: 12,
    color: C.textLight,
  },
});
