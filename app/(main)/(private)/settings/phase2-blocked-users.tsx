/**
 * Phase-2 Blocked Users Settings Screen
 *
 * Displays list of users the current user has blocked.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useBlockStore } from '@/stores/blockStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Toast } from '@/components/ui/Toast';

const C = INCOGNITO_COLORS;

export default function BlockedUsersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();
  const blockedUsersInfo = useBlockStore((s) => s.blockedUsersInfo);
  const unblockUserMutation = useMutation(api.users.unblockUser);
  const [pendingUnblockId, setPendingUnblockId] = useState<string | null>(null);

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

  const blockedUsers = isDemoMode
    ? blockedUsersInfo.map((user) => ({
        blockId: user.id,
        blockedUserId: user.id,
        displayName: 'Blocked user',
        blockedAt: user.blockedAt,
      }))
    : blockedData?.blockedUsers || [];
  const isLoading = !isDemoMode && userId ? blockedData === undefined : false;

  const handleUnblock = (blockedUserId: string, displayName: string) => {
    if (pendingUnblockId) return;

    Alert.alert(
      'Unblock user?',
      `${displayName} will be able to interact with you again if you reconnect or cross paths in Deep Connect.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setPendingUnblockId(blockedUserId);
            try {
              if (isDemoMode) {
                useBlockStore.getState().unblockUser(blockedUserId);
                useBlockStore.getState().setJustUnblockedUserId(blockedUserId);
                Toast.show('User unblocked');
                return;
              }

              if (!userId) {
                Toast.show('Please log in to manage blocked users');
                return;
              }

              const result = await unblockUserMutation({
                authUserId: userId,
                blockedUserId: blockedUserId as Id<'users'>,
              });

              if (!result.success) {
                Toast.show('Failed to unblock user. Please try again.');
                return;
              }

              useBlockStore.getState().unblockUser(blockedUserId);
              useBlockStore.getState().setJustUnblockedUserId(blockedUserId);
              Toast.show(`${displayName} unblocked`);
            } catch (error) {
              console.error('[Phase2BlockedUsers] Unblock failed:', error);
              Toast.show('Failed to unblock user. Please try again.');
            } finally {
              setPendingUnblockId((current) => (current === blockedUserId ? null : current));
            }
          },
        },
      ]
    );
  };

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
            Blocked users cannot find you in Deep Connect or send you messages. You can unblock someone at any time.
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
                <TouchableOpacity
                  style={[styles.unblockButton, pendingUnblockId !== null && styles.unblockButtonDisabled]}
                  onPress={() => handleUnblock(String(user.blockedUserId), user.displayName || 'this user')}
                  disabled={pendingUnblockId !== null}
                  activeOpacity={0.75}
                >
                  {pendingUnblockId === String(user.blockedUserId) ? (
                    <ActivityIndicator size="small" color={C.primary} />
                  ) : (
                    <Text style={styles.unblockText}>Unblock</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.helpFooter}>
          <Text style={styles.helpFooterText}>
            Need to report something serious? Contact support with screenshots or details.
          </Text>
          <TouchableOpacity
            style={styles.helpFooterLink}
            onPress={() => router.push('/(main)/(private)/settings/private-support' as any)}
            activeOpacity={0.75}
            accessibilityLabel="Get help"
          >
            <Text style={styles.helpFooterLinkText}>Get help</Text>
            <Ionicons name="chevron-forward" size={16} color={C.primary} />
          </TouchableOpacity>
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
  unblockButton: {
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  unblockButtonDisabled: {
    opacity: 0.45,
  },
  unblockText: {
    fontSize: 13,
    fontWeight: '700',
    color: C.primary,
  },
  helpFooter: {
    margin: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  helpFooterText: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
    marginBottom: 10,
  },
  helpFooterLink: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  helpFooterLinkText: {
    fontSize: 14,
    fontWeight: '700',
    color: C.primary,
  },
});
