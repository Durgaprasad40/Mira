import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

type ReportListItem = {
  reportId: string;
  reportedUser: { name: string };
  repeatedReportFlag?: { severity: 'low' | 'medium' | 'high' } | null;
  reason: string;
  description?: string;
  status: string;
  createdAt: number;
};

function formatTimeAgo(timestamp: number) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

function formatReason(reason: string) {
  return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRiskBadge(flag: ReportListItem['repeatedReportFlag']) {
  if (!flag) return null;
  if (flag.severity === 'high') {
    return { label: 'High risk', bg: (COLORS.error || '#EF4444') + '15', border: (COLORS.error || '#EF4444') + '40', fg: COLORS.error || '#EF4444' };
  }
  if (flag.severity === 'medium') {
    return { label: 'Medium risk', bg: '#F59E0B15', border: '#F59E0B40', fg: '#F59E0B' };
  }
  return { label: 'Flagged', bg: COLORS.background, border: COLORS.border, fg: COLORS.textLight };
}

export default function AdminReportsScreen() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);

  const reports = useQuery(
    api.moderationReports.listRecentReports,
    !isDemoMode && token ? { token, limit: 100 } : 'skip'
  ) as ReportListItem[] | undefined;

  const isLoading = !isDemoMode && token ? reports === undefined : false;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{Array.isArray(reports) ? reports.length : 0}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading reports...</Text>
        </View>
      ) : !reports || reports.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="flag-outline" size={64} color={COLORS.textLight} />
          <Text style={styles.emptyText}>No reports yet</Text>
          <Text style={styles.emptySubtext}>Submitted reports will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => item.reportId}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: '/(main)/admin/report/[reportId]',
                  params: { reportId: item.reportId },
                } as any)
              }
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.reportedName} numberOfLines={1}>
                  {item.reportedUser?.name || 'Unknown'}
                </Text>
                <View style={styles.badgesRow}>
                  {(() => {
                    const risk = getRiskBadge(item.repeatedReportFlag ?? null);
                    if (!risk) return null;
                    return (
                      <View style={[styles.riskBadge, { backgroundColor: risk.bg, borderColor: risk.border }]}>
                        <Text style={[styles.riskText, { color: risk.fg }]}>{risk.label}</Text>
                      </View>
                    );
                  })()}
                  <View style={[styles.statusBadge, item.status === 'pending' && styles.statusPending]}>
                    <Text style={styles.statusText}>{item.status}</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.reasonText}>{formatReason(item.reason)}</Text>

              {!!item.description?.trim() && (
                <Text style={styles.descText} numberOfLines={2}>
                  {item.description.trim()}
                </Text>
              )}

              <View style={styles.cardFooter}>
                <Text style={styles.timeText}>{formatTimeAgo(item.createdAt)}</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text },
  countBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 40,
    alignItems: 'center',
  },
  countText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { marginTop: 12, fontSize: 16, color: COLORS.textLight },
  emptyText: { marginTop: 16, fontSize: 18, fontWeight: '600', color: COLORS.text },
  emptySubtext: { marginTop: 8, fontSize: 14, color: COLORS.textLight, textAlign: 'center' },
  listContent: { padding: 12 },
  card: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportedName: { flex: 1, fontSize: 16, fontWeight: '700', color: COLORS.text, marginRight: 10 },
  badgesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  riskBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  riskText: { fontSize: 12, fontWeight: '700' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusPending: {
    backgroundColor: (COLORS.error || '#EF4444') + '10',
    borderColor: (COLORS.error || '#EF4444') + '40',
  },
  statusText: { fontSize: 12, fontWeight: '600', color: COLORS.textLight, textTransform: 'capitalize' },
  reasonText: { marginTop: 8, fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  descText: { marginTop: 6, fontSize: 13, color: COLORS.text, lineHeight: 18 },
  cardFooter: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeText: { fontSize: 12, color: COLORS.textLight },
});

