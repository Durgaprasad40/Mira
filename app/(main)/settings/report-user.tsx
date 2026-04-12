import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useBlockStore } from '@/stores/blockStore';
import { useAuthStore } from '@/stores/authStore';
import { Id } from '@/convex/_generated/dataModel';
import { isDemoMode } from '@/hooks/useConvex';

// Report reasons
const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or abuse', icon: 'alert-circle-outline' as const },
  { id: 'spam', label: 'Spam or scam', icon: 'mail-outline' as const },
  { id: 'inappropriate', label: 'Inappropriate content', icon: 'eye-off-outline' as const },
  { id: 'fake', label: 'Fake profile', icon: 'person-remove-outline' as const },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' as const },
];

// P0-001 FIX: Map frontend reason IDs to backend expected values
const REASON_MAP: Record<string, 'harassment' | 'spam' | 'inappropriate_photos' | 'fake_profile' | 'other'> = {
  'harassment': 'harassment',
  'spam': 'spam',
  'inappropriate': 'inappropriate_photos',
  'fake': 'fake_profile',
  'other': 'other',
};

type ReportCandidate = {
  userId: string;
  displayName: string;
  blockedAt: number | null;
  lastInteractionAt: number | null;
  contexts: string[];
  isVerified: boolean;
  unavailable: boolean;
};

export default function ReportUserScreen() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const isDemo = isDemoMode;

  const blockedUsersInfo = useBlockStore((s) => s.blockedUsersInfo);
  const reportCandidatesQuery = useQuery(
    api.users.getCurrentUserReportCandidates,
    !isDemo && token ? { token } : 'skip'
  );

  const reportUserMutation = useMutation(api.users.reportUser);
  const reportCandidates: ReportCandidate[] = isDemo
    ? blockedUsersInfo.map((user) => ({
        userId: user.id,
        displayName: 'Blocked user',
        blockedAt: user.blockedAt,
        lastInteractionAt: user.blockedAt,
        contexts: ['blocked'],
        isVerified: false,
        unavailable: false,
      }))
    : (reportCandidatesQuery ?? []).map((candidate: any) => ({
        userId: String(candidate.userId),
        displayName: candidate.displayName,
        blockedAt: candidate.blockedAt ?? null,
        lastInteractionAt: candidate.lastInteractionAt ?? null,
        contexts: Array.isArray(candidate.contexts) ? candidate.contexts : [],
        isVerified: !!candidate.isVerified,
        unavailable: !!candidate.unavailable,
      }));
  const isLoading = !isDemo && token ? reportCandidatesQuery === undefined : false;

  // Modal state for reason selection
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showReasonModal, setShowReasonModal] = useState(false);
  // P0-001 FIX: Add loading state to prevent double submission
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatRelativeDate = (timestamp: number): string => {
    const now = Date.now();
    const diffTime = Math.abs(now - timestamp);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  const getCandidateSubtitle = (candidate: ReportCandidate): string => {
    if (candidate.unavailable) {
      return 'Account unavailable';
    }
    if (candidate.blockedAt) {
      return `Blocked ${formatRelativeDate(candidate.blockedAt)}`;
    }
    if (candidate.contexts.includes('messaged') && candidate.lastInteractionAt) {
      return `Messaged ${formatRelativeDate(candidate.lastInteractionAt)}`;
    }
    if (candidate.contexts.includes('matched') && candidate.lastInteractionAt) {
      return `Matched ${formatRelativeDate(candidate.lastInteractionAt)}`;
    }
    if (candidate.contexts.includes('liked_you') && candidate.lastInteractionAt) {
      return `Liked you ${formatRelativeDate(candidate.lastInteractionAt)}`;
    }
    if (candidate.contexts.includes('liked') && candidate.lastInteractionAt) {
      return `You liked them ${formatRelativeDate(candidate.lastInteractionAt)}`;
    }
    return 'Recent interaction';
  };

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setShowReasonModal(true);
  };

  // P0-001 FIX: Actually call backend mutation when submitting report
  const handleSelectReason = async (reasonId: string) => {
    if (!selectedUserId || isSubmitting) return;

    const backendReason = REASON_MAP[reasonId];
    if (!backendReason) {
      Alert.alert('Error', 'Invalid report reason');
      return;
    }

    setIsSubmitting(true);

    try {
      let result: { success?: boolean; error?: string } = { success: true };
      if (!isDemo) {
        if (!token) {
          Alert.alert('Error', 'Please log in to report users.');
          return;
        }
        result = await reportUserMutation({
          token,
          reportedUserId: selectedUserId as Id<'users'>,
          reason: backendReason,
        });
      }

      setShowReasonModal(false);
      setSelectedUserId(null);

      if (result.success === false) {
        Alert.alert('Error', result.error === 'cannot_report_self'
          ? 'You cannot report yourself'
          : 'Failed to submit report. Please try again.');
        return;
      }

      // Show success confirmation
      Alert.alert(
        'Report Submitted',
        'Thank you for your report. Our team will review it.',
        [
          {
            text: 'OK',
            onPress: () => {
              router.back();
            },
          },
        ]
      );
    } catch (error) {
      console.error('[ReportUser] Failed to submit report:', error);
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    setShowReasonModal(false);
    setSelectedUserId(null);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report a User</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Helper text */}
        <View style={styles.helperSection}>
          <Ionicons name="information-circle-outline" size={20} color={COLORS.textMuted} />
          <Text style={styles.helperText}>
            Report people you recently interacted with in Phase-1, including anyone you currently have blocked.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.emptyStateTitle}>Loading recent users</Text>
            <Text style={styles.emptyStateDescription}>
              Fetching recent Phase-1 people you can report.
            </Text>
          </View>
        ) : reportCandidates.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="flag-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyStateTitle}>No users to report</Text>
            <Text style={styles.emptyStateDescription}>
              No recent Phase-1 interactions are available to report right now.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={styles.listHeader}>
              Select a user to report
            </Text>

            {reportCandidates.map((user, index) => (
              <TouchableOpacity
                key={user.userId}
                style={[styles.userEntry, index === reportCandidates.length - 1 && styles.userEntryLast]}
                onPress={() => handleSelectUser(user.userId)}
                activeOpacity={0.7}
              >
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={24} color={COLORS.textMuted} />
                </View>

                <View style={styles.entryInfo}>
                  <Text style={styles.entryLabel}>
                    {user.displayName}
                    {user.isVerified ? ' • Verified' : ''}
                  </Text>
                  <Text style={styles.entryDate}>{getCandidateSubtitle(user)}</Text>
                </View>

                <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Reason Selection Modal */}
      <Modal
        visible={showReasonModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Report Reason</Text>
              <TouchableOpacity onPress={handleCloseModal} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Why are you reporting this user?
            </Text>

            {/* P0-001 FIX: Show loading indicator during submission */}
            {isSubmitting ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>Submitting report...</Text>
              </View>
            ) : (
              <View style={styles.reasonList}>
                {REPORT_REASONS.map((reason) => (
                  <TouchableOpacity
                    key={reason.id}
                    style={styles.reasonItem}
                    onPress={() => handleSelectReason(reason.id)}
                    activeOpacity={0.7}
                    disabled={isSubmitting}
                  >
                    <View style={styles.reasonIcon}>
                      <Ionicons name={reason.icon} size={22} color={COLORS.text} />
                    </View>
                    <Text style={styles.reasonLabel}>{reason.label}</Text>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  // Helper section
  helperSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: COLORS.backgroundDark,
  },
  helperText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 20,
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
  // User entry row
  userEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  userEntryLast: {
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  reasonList: {
    paddingHorizontal: 16,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  reasonIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  reasonLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  // P0-001 FIX: Loading styles for report submission
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textMuted,
  },
});
