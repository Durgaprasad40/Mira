/**
 * Phase-2 My Reports Settings Screen
 *
 * Shows reports submitted by the current user (last 30 days).
 * Does NOT show who reported the user (privacy protection).
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

// Map reason codes to human-readable labels
const REASON_LABELS: Record<string, string> = {
  fake_profile: 'Fake Profile',
  inappropriate_photos: 'Inappropriate Photos',
  harassment: 'Harassment',
  spam: 'Spam',
  underage: 'Underage User',
  other: 'Other',
  hate_speech: 'Hate Speech',
  sexual_content: 'Sexual Content',
  nudity: 'Nudity',
  violent_threats: 'Violent Threats',
  impersonation: 'Impersonation',
  selling: 'Selling/Promoting',
};

// Map status to colors
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
  reviewed: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3B82F6' },
  resolved: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
};

export default function MyReportsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  // Fetch user's reports
  const reportsData = useQuery(
    api.users.getMyReports,
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

  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 14) return '1 week ago';
    return formatDate(timestamp);
  };

  const reports = reportsData?.reports || [];
  const isLoading = reportsData === undefined;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Reports</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="time-outline" size={20} color={C.textLight} />
          <Text style={styles.infoText}>
            Reports from the last 30 days are shown here. Your reports help keep the community safe.
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
        {!isLoading && reports.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={48} color={C.textLight} />
            <Text style={styles.emptyTitle}>No Recent Reports</Text>
            <Text style={styles.emptyText}>
              You haven't submitted any reports in the last 30 days.
            </Text>
          </View>
        )}

        {/* Reports List */}
        {!isLoading && reports.length > 0 && (
          <View style={styles.listContainer}>
            {reports.map((report: any) => {
              const statusStyle = STATUS_COLORS[report.status] || STATUS_COLORS.pending;
              return (
                <View key={report.reportId} style={styles.reportCard}>
                  <View style={styles.reportHeader}>
                    <View style={styles.reasonBadge}>
                      <Text style={styles.reasonText}>
                        {REASON_LABELS[report.reason] || report.reason}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                      <Text style={[styles.statusText, { color: statusStyle.text }]}>
                        {report.status.charAt(0).toUpperCase() + report.status.slice(1)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.reportMeta}>
                    <Ionicons name="calendar-outline" size={14} color={C.textLight} />
                    <Text style={styles.metaText}>{formatRelativeTime(report.createdAt)}</Text>
                    {report.hasDescription && (
                      <>
                        <Text style={styles.metaDot}>·</Text>
                        <Ionicons name="chatbox-outline" size={14} color={C.textLight} />
                        <Text style={styles.metaText}>Has details</Text>
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Footer Note */}
        {!isLoading && reports.length > 0 && (
          <View style={styles.footerNote}>
            <Text style={styles.footerText}>
              Our team reviews all reports. We may take action without notifying you to protect privacy.
            </Text>
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
    gap: 12,
  },
  reportCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reasonBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    flex: 1,
  },
  reasonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#EF4444',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  reportMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: C.textLight,
  },
  metaDot: {
    fontSize: 12,
    color: C.textLight,
    marginHorizontal: 2,
  },
  footerNote: {
    margin: 16,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  footerText: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 16,
  },
});
