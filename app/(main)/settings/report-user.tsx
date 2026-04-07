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
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useBlockStore } from '@/stores/blockStore';
import { useAuthStore } from '@/stores/authStore';
import { Id } from '@/convex/_generated/dataModel';

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

export default function ReportUserScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);

  // Get blocked users from store
  const blockedUsersInfo = useBlockStore((s) => s.blockedUsersInfo);

  // P0-001 FIX: Add mutation for reporting users
  const reportUserMutation = useMutation(api.users.reportUser);

  // Modal state for reason selection
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showReasonModal, setShowReasonModal] = useState(false);
  // P0-001 FIX: Add loading state to prevent double submission
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setShowReasonModal(true);
  };

  // P0-001 FIX: Actually call backend mutation when submitting report
  const handleSelectReason = async (reasonId: string) => {
    if (!userId || !selectedUserId || isSubmitting) return;

    const backendReason = REASON_MAP[reasonId];
    if (!backendReason) {
      Alert.alert('Error', 'Invalid report reason');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await reportUserMutation({
        authUserId: userId,
        reportedUserId: selectedUserId as Id<'users'>,
        reason: backendReason,
      });

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
            You can report users you've blocked.
          </Text>
        </View>

        {blockedUsersInfo.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="flag-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyStateTitle}>No users to report</Text>
            <Text style={styles.emptyStateDescription}>
              You haven't blocked any users. You can only report users you've blocked.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={styles.listHeader}>
              Select a user to report
            </Text>

            {blockedUsersInfo.map((user, index) => (
              <TouchableOpacity
                key={user.id}
                style={[styles.userEntry, index === blockedUsersInfo.length - 1 && styles.userEntryLast]}
                onPress={() => handleSelectUser(user.id)}
                activeOpacity={0.7}
              >
                {/* Generic avatar placeholder - no photo */}
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={24} color={COLORS.textMuted} />
                </View>

                <View style={styles.entryInfo}>
                  <Text style={styles.entryLabel}>Blocked User</Text>
                  <Text style={styles.entryDate}>Blocked {formatBlockedDate(user.blockedAt)}</Text>
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
