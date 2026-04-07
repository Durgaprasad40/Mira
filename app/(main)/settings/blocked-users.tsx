import React, { useState } from 'react';
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
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { COLORS } from '@/lib/constants';
import { useBlockStore } from '@/stores/blockStore';
import { useAuthStore } from '@/stores/authStore';
import { Toast } from '@/components/ui/Toast';

// Report reason type matching backend
type ReportReason = 'harassment' | 'spam' | 'inappropriate_photos';

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  // Get blocked users from store
  const blockedUsersInfo = useBlockStore((s) => s.blockedUsersInfo);

  // Backend mutation
  const reportUserMutation = useMutation(api.users.reportUser);

  // Prevent spam clicks
  const [isReporting, setIsReporting] = useState(false);

  const submitReport = async (reportedUserId: string, reason: ReportReason) => {
    if (!userId) {
      Toast.show('Please log in to report users');
      return;
    }

    setIsReporting(true);
    try {
      const result = await reportUserMutation({
        authUserId: userId,
        reportedUserId: reportedUserId as Id<'users'>,
        reason,
      });

      if (result.success) {
        Toast.show('Report submitted. Our team will review it.');
      } else {
        // Handle specific errors
        if (result.error === 'cannot_report_self') {
          Toast.show('You cannot report yourself');
        } else {
          Toast.show('Failed to submit report. Please try again.');
        }
      }
    } catch (error: any) {
      console.error('[BlockedUsers] Report failed:', error);
      Toast.show('Failed to submit report. Please try again.');
    } finally {
      setIsReporting(false);
    }
  };

  const handleReport = (reportedUserId: string) => {
    if (isReporting) return; // Prevent spam clicks

    Alert.alert(
      'Report User',
      'What would you like to report?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Harassment',
          onPress: () => submitReport(reportedUserId, 'harassment'),
        },
        {
          text: 'Spam / Scam',
          onPress: () => submitReport(reportedUserId, 'spam'),
        },
        {
          text: 'Inappropriate Content',
          onPress: () => submitReport(reportedUserId, 'inappropriate_photos'),
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
                    style={[styles.actionButton, isReporting && styles.actionButtonDisabled]}
                    onPress={() => handleReport(user.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    disabled={isReporting}
                  >
                    <Ionicons name="flag-outline" size={20} color={COLORS.textMuted} />
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
            Blocked users cannot see your profile or send you messages. Blocks are permanent and private.
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
  actionButtonDisabled: {
    opacity: 0.4,
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
