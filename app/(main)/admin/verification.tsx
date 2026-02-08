import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { isDemoMode } from '@/hooks/useConvex';
import { Id } from '@/convex/_generated/dataModel';

// Note: Admin endpoints use session token for auth, NOT userId

type RejectionReason =
  | 'no_face_detected'
  | 'multiple_faces'
  | 'blurry'
  | 'suspected_fake'
  | 'nsfw_content'
  | 'low_quality';

const REJECTION_REASONS: { value: RejectionReason; label: string }[] = [
  { value: 'no_face_detected', label: 'No face detected' },
  { value: 'multiple_faces', label: 'Multiple faces' },
  { value: 'blurry', label: 'Blurry photo' },
  { value: 'suspected_fake', label: 'Suspected fake' },
  { value: 'nsfw_content', label: 'NSFW content' },
  { value: 'low_quality', label: 'Low quality' },
];

interface PendingReview {
  sessionId: Id<'verificationSessions'>;
  userId: Id<'users'>;
  userName: string;
  userEmail?: string;
  verificationPhotoUrl: string | null;
  verificationReason?: string;
  photos: { id: Id<'photos'>; url: string; isPrimary: boolean; hasFace: boolean }[];
  createdAt: number;
  userCreatedAt: number;
}

// Demo data for testing in demo mode
const DEMO_PENDING_REVIEWS: PendingReview[] = [
  {
    sessionId: 'demo_session_1' as Id<'verificationSessions'>,
    userId: 'demo_user_1' as Id<'users'>,
    userName: 'Demo User 1',
    userEmail: 'demo1@example.com',
    verificationPhotoUrl: 'https://randomuser.me/api/portraits/women/1.jpg',
    verificationReason: 'manual_review_required',
    photos: [{ id: 'photo1' as Id<'photos'>, url: 'https://randomuser.me/api/portraits/women/1.jpg', isPrimary: true, hasFace: true }],
    createdAt: Date.now() - 3600000,
    userCreatedAt: Date.now() - 86400000,
  },
  {
    sessionId: 'demo_session_2' as Id<'verificationSessions'>,
    userId: 'demo_user_2' as Id<'users'>,
    userName: 'Demo User 2',
    userEmail: 'demo2@example.com',
    verificationPhotoUrl: 'https://randomuser.me/api/portraits/men/2.jpg',
    verificationReason: 'blurry',
    photos: [{ id: 'photo2' as Id<'photos'>, url: 'https://randomuser.me/api/portraits/men/2.jpg', isPrimary: true, hasFace: true }],
    createdAt: Date.now() - 7200000,
    userCreatedAt: Date.now() - 172800000,
  },
];

export default function AdminVerificationScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [selectedSession, setSelectedSession] = useState<PendingReview | null>(null);
  const [localRemovedIds, setLocalRemovedIds] = useState<Set<string>>(new Set());

  // Admin check (uses userId for quick frontend check)
  const adminCheck = useQuery(
    api.users.checkIsAdmin,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );

  // Get pending reviews using session token for auth (NOT userId)
  const pendingReviewsData = useQuery(
    api.verification.getPendingManualReviews,
    !isDemoMode && token && adminCheck?.isAdmin
      ? { token }
      : 'skip'
  );

  const reviewMutation = useMutation(api.verification.adminReviewVerification);

  // Handle unauthorized access
  const isAdmin = isDemoMode || adminCheck?.isAdmin === true;
  const isLoading = !isDemoMode && (adminCheck === undefined || (isAdmin && pendingReviewsData === undefined));

  // Filter out locally removed items for optimistic updates
  const pendingReviews = isDemoMode
    ? DEMO_PENDING_REVIEWS.filter((r) => !localRemovedIds.has(r.sessionId))
    : (pendingReviewsData?.reviews || []).filter((r) => !localRemovedIds.has(r.sessionId));

  const handleApprove = useCallback(async (review: PendingReview) => {
    if (processingIds.has(review.sessionId)) return;

    setProcessingIds((prev) => new Set(prev).add(review.sessionId));

    // Optimistically remove from list
    setLocalRemovedIds((prev) => new Set(prev).add(review.sessionId));

    try {
      if (!isDemoMode && token) {
        await reviewMutation({
          token,
          sessionId: review.sessionId,
          action: 'approve',
        });
      }
      // Success - item already removed optimistically
    } catch (error: any) {
      // Rollback optimistic update
      setLocalRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(review.sessionId);
        return next;
      });
      Alert.alert('Error', error.message || 'Failed to approve verification');
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(review.sessionId);
        return next;
      });
    }
  }, [processingIds, token, reviewMutation]);

  const handleRejectPress = useCallback((review: PendingReview) => {
    setSelectedSession(review);
    setRejectModalVisible(true);
  }, []);

  const handleRejectConfirm = useCallback(async (reason: RejectionReason) => {
    if (!selectedSession || processingIds.has(selectedSession.sessionId)) return;

    setProcessingIds((prev) => new Set(prev).add(selectedSession.sessionId));
    setRejectModalVisible(false);

    // Optimistically remove from list
    setLocalRemovedIds((prev) => new Set(prev).add(selectedSession.sessionId));

    try {
      if (!isDemoMode && token) {
        await reviewMutation({
          token,
          sessionId: selectedSession.sessionId,
          action: 'reject',
          rejectionReason: reason,
        });
      }
      // Success - item already removed optimistically
    } catch (error: any) {
      // Rollback optimistic update
      setLocalRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedSession.sessionId);
        return next;
      });
      Alert.alert('Error', error.message || 'Failed to reject verification');
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedSession.sessionId);
        return next;
      });
      setSelectedSession(null);
    }
  }, [selectedSession, processingIds, token, reviewMutation]);

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return 'Just now';
  };

  const formatReason = (reason?: string) => {
    if (!reason) return 'Manual review';
    return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Unauthorized screen
  if (!isLoading && !isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Admin</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerContainer}>
          <Ionicons name="lock-closed" size={64} color={COLORS.textLight} />
          <Text style={styles.unauthorizedText}>Not authorized</Text>
          <Text style={styles.unauthorizedSubtext}>
            Admin access is required to view this page.
          </Text>
          <TouchableOpacity style={styles.goBackButton} onPress={() => router.back()}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Loading screen
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Verification Queue</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderItem = ({ item }: { item: PendingReview }) => {
    const isProcessing = processingIds.has(item.sessionId);

    return (
      <View style={styles.reviewCard}>
        <View style={styles.reviewHeader}>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{item.userName}</Text>
            <Text style={styles.userId}>ID: {String(item.userId).slice(-8)}</Text>
          </View>
          <View style={styles.timeBadge}>
            <Text style={styles.timeText}>{formatTimeAgo(item.createdAt)}</Text>
          </View>
        </View>

        <View style={styles.photoContainer}>
          {item.verificationPhotoUrl ? (
            <Image
              source={{ uri: item.verificationPhotoUrl }}
              style={styles.verificationPhoto}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.verificationPhoto, styles.photoPlaceholder]}>
              <Ionicons name="image-outline" size={40} color={COLORS.textLight} />
            </View>
          )}

          {item.photos.length > 0 && (
            <View style={styles.profilePhotos}>
              <Text style={styles.profilePhotosLabel}>Profile photos:</Text>
              <View style={styles.thumbnailRow}>
                {item.photos.slice(0, 3).map((photo) => (
                  <Image
                    key={photo.id}
                    source={{ uri: photo.url }}
                    style={styles.thumbnail}
                    contentFit="cover"
                  />
                ))}
                {item.photos.length > 3 && (
                  <View style={styles.moreThumbnails}>
                    <Text style={styles.moreText}>+{item.photos.length - 3}</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>

        <View style={styles.reasonContainer}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.textLight} />
          <Text style={styles.reasonText}>{formatReason(item.verificationReason)}</Text>
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.rejectButton, isProcessing && styles.disabledButton]}
            onPress={() => handleRejectPress(item)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={COLORS.error} />
            ) : (
              <>
                <Ionicons name="close-circle" size={20} color={COLORS.error} />
                <Text style={styles.rejectButtonText}>Reject</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.approveButton, isProcessing && styles.disabledButton]}
            onPress={() => handleApprove(item)}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.approveButtonText}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verification Queue</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{pendingReviews.length}</Text>
        </View>
      </View>

      {pendingReviews.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyEmoji}>🎉</Text>
          <Text style={styles.emptyText}>No pending verifications</Text>
          <Text style={styles.emptySubtext}>All caught up!</Text>
        </View>
      ) : (
        <FlatList
          data={pendingReviews}
          renderItem={renderItem}
          keyExtractor={(item) => item.sessionId}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Rejection Reason Modal */}
      <Modal
        visible={rejectModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setRejectModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Select Rejection Reason</Text>
            <Text style={styles.modalSubtitle}>
              For: {selectedSession?.userName}
            </Text>

            {REJECTION_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason.value}
                style={styles.reasonOption}
                onPress={() => handleRejectConfirm(reason.value)}
              >
                <Text style={styles.reasonOptionText}>{reason.label}</Text>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setRejectModalVisible(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
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
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  countBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 40,
    alignItems: 'center',
  },
  countText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textLight,
  },
  unauthorizedText: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  unauthorizedSubtext: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  goBackButton: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  goBackText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textLight,
  },
  listContent: {
    padding: 16,
    gap: 16,
  },
  reviewCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  userId: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  timeBadge: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  timeText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  photoContainer: {
    marginBottom: 12,
  },
  verificationPhoto: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePhotos: {
    marginTop: 12,
  },
  profilePhotosLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  thumbnailRow: {
    flexDirection: 'row',
    gap: 8,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: COLORS.background,
  },
  moreThumbnails: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '600',
  },
  reasonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    padding: 8,
    backgroundColor: COLORS.background,
    borderRadius: 6,
  },
  reasonText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.error,
    backgroundColor: COLORS.error + '10',
  },
  rejectButtonText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '600',
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: COLORS.success || '#22C55E',
  },
  approveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  reasonOptionText: {
    fontSize: 16,
    color: COLORS.text,
  },
  cancelButton: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    color: COLORS.textLight,
    fontWeight: '500',
  },
});
