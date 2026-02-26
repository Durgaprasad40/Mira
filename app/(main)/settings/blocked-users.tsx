import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { useBlockStore } from '@/stores/blockStore';

export default function BlockedUsersScreen() {
  const router = useRouter();

  // Get blocked users from store
  const blockedUsersInfo = useBlockStore((s) => s.blockedUsersInfo);
  const unblockUser = useBlockStore((s) => s.unblockUser);
  const setJustUnblockedUserId = useBlockStore((s) => s.setJustUnblockedUserId);

  const handleUnblock = (userId: string) => {
    Alert.alert(
      'Unblock User',
      'This user will be able to see your profile and message you again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () => {
            // Unblock the user
            unblockUser(userId);

            // Set the one-time "just unblocked" flag
            setJustUnblockedUserId(userId);

            // Navigate to Messages tab, then to the chat with this user
            const conversationId = `demo_convo_${userId}`;
            router.replace({
              pathname: '/(main)/(tabs)/messages/chat/[conversationId]',
              params: { conversationId, source: 'unblock' },
            });
          },
        },
      ]
    );
  };

  const handleReport = (userId: string) => {
    Alert.alert(
      'Report User',
      'What would you like to report?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Harassment',
          onPress: () => {
            Alert.alert('Report Submitted', 'Thank you for your report. Our team will review it.');
          },
        },
        {
          text: 'Spam / Scam',
          onPress: () => {
            Alert.alert('Report Submitted', 'Thank you for your report. Our team will review it.');
          },
        },
        {
          text: 'Inappropriate Content',
          onPress: () => {
            Alert.alert('Report Submitted', 'Thank you for your report. Our team will review it.');
          },
        },
      ]
    );
  };

  const formatBlockedDate = (timestamp: number): string => {
    const now = Date.now();
    const diffTime = Math.abs(now - timestamp);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked Users</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {blockedUsersInfo.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="ban-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyStateTitle}>No blocked users</Text>
            <Text style={styles.emptyStateDescription}>
              Users you block will appear here. Blocking is instant and private.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={styles.listHeader}>
              {blockedUsersInfo.length} {blockedUsersInfo.length === 1 ? 'user' : 'users'} blocked
            </Text>

            {blockedUsersInfo.map((user, index) => (
              <View key={user.id} style={[styles.blockedEntry, index === blockedUsersInfo.length - 1 && styles.blockedEntryLast]}>
                {/* Generic avatar placeholder - no photo */}
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={24} color={COLORS.textMuted} />
                </View>

                <View style={styles.entryInfo}>
                  <Text style={styles.entryLabel}>Blocked User</Text>
                  <Text style={styles.entryDate}>Blocked {formatBlockedDate(user.blockedAt)}</Text>
                </View>

                <View style={styles.entryActions}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleReport(user.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="flag-outline" size={20} color={COLORS.textMuted} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.unblockButton}
                    onPress={() => handleUnblock(user.id)}
                  >
                    <Text style={styles.unblockButtonText}>Unblock</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Info footer */}
        <View style={styles.infoFooter}>
          <Ionicons name="information-circle-outline" size={18} color={COLORS.textMuted} />
          <Text style={styles.infoFooterText}>
            Blocked users cannot see your profile or send you messages. Blocking is private and instant.
          </Text>
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
  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateDescription: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  // List
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  listHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  // Blocked entry row
  blockedEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  blockedEntryLast: {
    borderBottomWidth: 0,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryInfo: {
    flex: 1,
    marginLeft: 12,
  },
  entryLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 2,
  },
  entryDate: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  entryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionButton: {
    padding: 8,
  },
  unblockButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  unblockButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  // Info footer
  infoFooter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 20,
    marginTop: 8,
  },
  infoFooterText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
});
