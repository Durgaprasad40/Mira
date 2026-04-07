/**
 * Phase-2 My Reports Screen
 *
 * Shows reports submitted by the user with:
 * - Reported person info (if available)
 * - Reason/category
 * - Submitted date
 * - Status (Submitted / Under Review / Action Taken / Closed)
 *
 * Uses Phase-2 dark premium styling (INCOGNITO_COLORS).
 */
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import type { Id } from '@/convex/_generated/dataModel';

const C = INCOGNITO_COLORS;

// Report reason labels
const REASON_LABELS: Record<string, string> = {
  harassment: 'Harassment',
  fake_profile: 'Fake Profile',
  spam: 'Spam',
  inappropriate_content: 'Inappropriate Content',
  safety_concern: 'Safety Concern',
  impersonation: 'Impersonation',
  underage: 'Underage Concern',
  other: 'Other',
};

// Status configuration
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  submitted: {
    label: 'Submitted',
    color: '#6B7280',
    icon: 'time-outline',
  },
  under_review: {
    label: 'Under Review',
    color: '#F59E0B',
    icon: 'search-outline',
  },
  action_taken: {
    label: 'Action Taken',
    color: '#10B981',
    icon: 'checkmark-circle-outline',
  },
  closed: {
    label: 'Closed',
    color: '#6B7280',
    icon: 'close-circle-outline',
  },
};

interface Report {
  _id: string;
  reason: string;
  description?: string;
  status: string;
  createdAt: number;
  reportedUserName?: string;
  adminResponse?: string;
  hasAttachments?: boolean;
}

export default function PrivateMyReportsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Auth
  const { userId } = useAuthStore();

  const [refreshing, setRefreshing] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  // P0-3 FIX: Query real reports from backend (safety-category support tickets)
  const backendReports = useQuery(
    api.supportTickets.getUserSafetyReports,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );

  // Transform backend reports to UI format
  const reports = useMemo((): Report[] => {
    if (!backendReports) return [];
    return backendReports.map((r) => ({
      _id: r._id,
      reason: r.reason,
      status: mapBackendStatus(r.status),
      createdAt: r.createdAt,
      reportedUserName: r.reportedUserName,
      hasAttachments: false, // Could be enhanced later
    }));
  }, [backendReports]);

  // Map backend ticket status to UI status
  function mapBackendStatus(status: string): string {
    switch (status) {
      case 'open':
        return 'submitted';
      case 'in_review':
        return 'under_review';
      case 'replied':
        return 'action_taken';
      case 'closed':
        return 'closed';
      default:
        return 'submitted';
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    // Query will auto-refresh via Convex reactivity
    setTimeout(() => setRefreshing(false), 500);
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusConfig = (status: string) => {
    return STATUS_CONFIG[status] || STATUS_CONFIG.submitted;
  };

  const openReportDetails = (report: Report) => {
    setSelectedReport(report);
  };

  const closeReportDetails = () => {
    setSelectedReport(null);
  };

  const isLoading = !isDemoMode && userId && backendReports === undefined;
  const isEmpty = reports.length === 0;
  const displayReports = reports;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Reports</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 20 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.primary}
          />
        }
      >
        {/* Loading State */}
        {isLoading && (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={[styles.emptyStateText, { marginTop: 12 }]}>Loading reports...</Text>
          </View>
        )}

        {/* Empty State */}
        {!isLoading && isEmpty && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconBox}>
              <Ionicons name="document-text-outline" size={48} color={C.textLight} />
            </View>
            <Text style={styles.emptyStateTitle}>No Reports Yet</Text>
            <Text style={styles.emptyStateText}>
              Reports you submit will appear here so you can track their status.
            </Text>
          </View>
        )}

        {/* Reports List */}
        {displayReports.length > 0 && (
          <View style={styles.reportsList}>
            {displayReports.map((report) => {
              const statusConfig = getStatusConfig(report.status);
              return (
                <TouchableOpacity
                  key={report._id}
                  style={styles.reportCard}
                  onPress={() => openReportDetails(report)}
                  activeOpacity={0.7}
                >
                  <View style={styles.reportHeader}>
                    <View style={styles.reportReasonRow}>
                      <View style={[styles.statusDot, { backgroundColor: statusConfig.color }]} />
                      <Text style={styles.reportReason}>
                        {REASON_LABELS[report.reason] || 'Report'}
                      </Text>
                    </View>
                    <Text style={styles.reportDate}>{formatDate(report.createdAt)}</Text>
                  </View>

                  {report.reportedUserName && (
                    <Text style={styles.reportedUser}>
                      Reported: {report.reportedUserName}
                    </Text>
                  )}

                  <View style={styles.reportFooter}>
                    <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
                      <Ionicons name={statusConfig.icon} size={14} color={statusConfig.color} />
                      <Text style={[styles.statusText, { color: statusConfig.color }]}>
                        {statusConfig.label}
                      </Text>
                    </View>

                    {report.hasAttachments && (
                      <View style={styles.attachmentIndicator}>
                        <Ionicons name="attach" size={14} color={C.textLight} />
                      </View>
                    )}

                    <Ionicons name="chevron-forward" size={18} color={C.textLight} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={C.primary} />
          <Text style={styles.infoText}>
            Reports are typically reviewed within 24 hours. We'll take appropriate action based on our community guidelines.
          </Text>
        </View>
      </ScrollView>

      {/* Report Details Modal */}
      <Modal
        visible={selectedReport !== null}
        transparent
        animationType="slide"
        onRequestClose={closeReportDetails}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { paddingBottom: insets.bottom + 16 }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Report Details</Text>
              <TouchableOpacity onPress={closeReportDetails}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
            </View>

            {selectedReport && (
              <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                {/* Status */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={styles.detailRow}>
                    <View style={[
                      styles.statusBadgeLarge,
                      { backgroundColor: getStatusConfig(selectedReport.status).color + '20' },
                    ]}>
                      <Ionicons
                        name={getStatusConfig(selectedReport.status).icon}
                        size={18}
                        color={getStatusConfig(selectedReport.status).color}
                      />
                      <Text style={[
                        styles.statusTextLarge,
                        { color: getStatusConfig(selectedReport.status).color },
                      ]}>
                        {getStatusConfig(selectedReport.status).label}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Reason */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Reason</Text>
                  <Text style={styles.detailValue}>
                    {REASON_LABELS[selectedReport.reason] || selectedReport.reason}
                  </Text>
                </View>

                {/* Reported User */}
                {selectedReport.reportedUserName && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Reported User</Text>
                    <Text style={styles.detailValue}>{selectedReport.reportedUserName}</Text>
                  </View>
                )}

                {/* Date */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Submitted</Text>
                  <Text style={styles.detailValue}>{formatDate(selectedReport.createdAt)}</Text>
                </View>

                {/* Description */}
                {selectedReport.description && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Your Description</Text>
                    <Text style={styles.detailValueMultiline}>{selectedReport.description}</Text>
                  </View>
                )}

                {/* Attachments */}
                {selectedReport.hasAttachments && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Attachments</Text>
                    <View style={styles.attachmentBadge}>
                      <Ionicons name="attach" size={16} color={C.text} />
                      <Text style={styles.attachmentText}>Evidence attached</Text>
                    </View>
                  </View>
                )}

                {/* Admin Response */}
                {selectedReport.adminResponse && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Response from Team</Text>
                    <View style={styles.responseBox}>
                      <Text style={styles.responseText}>{selectedReport.adminResponse}</Text>
                    </View>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyIconBox: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Reports list
  reportsList: {
    gap: 12,
  },
  reportCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  reportReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  reportReason: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  reportDate: {
    fontSize: 13,
    color: C.textLight,
  },
  reportedUser: {
    fontSize: 14,
    color: C.textLight,
    marginBottom: 12,
  },
  reportFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  attachmentIndicator: {
    marginLeft: 'auto',
    marginRight: 4,
  },
  // Info card
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 20,
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: C.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  modalContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  // Detail sections
  detailSection: {
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
  },
  detailValue: {
    fontSize: 15,
    color: C.text,
  },
  detailValueMultiline: {
    fontSize: 15,
    color: C.text,
    lineHeight: 22,
  },
  statusBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  statusTextLarge: {
    fontSize: 14,
    fontWeight: '600',
  },
  attachmentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  attachmentText: {
    fontSize: 14,
    color: C.text,
  },
  responseBox: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
  },
  responseText: {
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },
});
