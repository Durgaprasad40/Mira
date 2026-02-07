import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { Id } from '@/convex/_generated/dataModel';
import * as Clipboard from 'expo-clipboard';

// Max metadata display size (2KB)
const MAX_METADATA_LENGTH = 2048;

// Action filter options
const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'verify_approve', label: 'Verify Approve' },
  { value: 'verify_reject', label: 'Verify Reject' },
  { value: 'set_admin', label: 'Set Admin' },
  { value: 'deactivate', label: 'Deactivate' },
  { value: 'reactivate', label: 'Reactivate' },
];

const LIMIT_OPTIONS = [25, 50, 100];

interface AdminLog {
  id: Id<'adminLogs'>;
  createdAt: number;
  action: string;
  adminUserId: Id<'users'>;
  targetUserId?: Id<'users'>;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// Demo data for testing
const DEMO_LOGS: AdminLog[] = [
  {
    id: 'demo_log_1' as Id<'adminLogs'>,
    createdAt: Date.now() - 3600000,
    action: 'verify_approve',
    adminUserId: 'demo_admin' as Id<'users'>,
    targetUserId: 'demo_user_1' as Id<'users'>,
    metadata: { oldStatus: 'pending_manual', newStatus: 'verified' },
  },
  {
    id: 'demo_log_2' as Id<'adminLogs'>,
    createdAt: Date.now() - 7200000,
    action: 'verify_reject',
    adminUserId: 'demo_admin' as Id<'users'>,
    targetUserId: 'demo_user_2' as Id<'users'>,
    reason: 'blurry',
    metadata: { oldStatus: 'pending_manual', newStatus: 'rejected' },
  },
  {
    id: 'demo_log_3' as Id<'adminLogs'>,
    createdAt: Date.now() - 86400000,
    action: 'set_admin',
    adminUserId: 'demo_admin' as Id<'users'>,
    targetUserId: 'demo_user_3' as Id<'users'>,
    metadata: { oldIsAdmin: false, newIsAdmin: true },
  },
];

export default function AdminLogsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  // Filter state
  const [actionFilter, setActionFilter] = useState('');
  const [adminIdFilter, setAdminIdFilter] = useState('');
  const [targetIdFilter, setTargetIdFilter] = useState('');
  const [limit, setLimit] = useState(50);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [showActionPicker, setShowActionPicker] = useState(false);

  // Admin check
  const adminCheck = useQuery(
    api.users.checkIsAdmin,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );

  // Build query args
  const queryArgs = !isDemoMode && token && adminCheck?.isAdmin
    ? {
        token,
        limit,
        ...(actionFilter && { action: actionFilter }),
        ...(adminIdFilter && { adminUserId: adminIdFilter as Id<'users'> }),
        ...(targetIdFilter && { targetUserId: targetIdFilter as Id<'users'> }),
      }
    : 'skip';

  // Get logs using session token for auth
  const logsData = useQuery(api.adminLog.getAdminLogs, queryArgs);

  const isAdmin = isDemoMode || adminCheck?.isAdmin === true;
  const isLoading = !isDemoMode && (adminCheck === undefined || (isAdmin && logsData === undefined));
  const logs: AdminLog[] = isDemoMode ? DEMO_LOGS : (logsData || []);

  // Format relative time
  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  // Format exact timestamp
  const formatExactTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  // Format action for display
  const formatAction = (action: string) => {
    return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Get action color
  const getActionColor = (action: string) => {
    switch (action) {
      case 'verify_approve':
        return COLORS.success || '#22C55E';
      case 'verify_reject':
        return COLORS.error;
      case 'set_admin':
        return COLORS.primary;
      case 'deactivate':
        return '#F59E0B';
      case 'reactivate':
        return '#10B981';
      default:
        return COLORS.textLight;
    }
  };

  // Truncate ID for display
  const truncateId = (id: string) => {
    return id.length > 12 ? `...${id.slice(-8)}` : id;
  };

  // Copy ID to clipboard
  const copyToClipboard = async (id: string, label: string) => {
    await Clipboard.setStringAsync(id);
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  // Truncate and format metadata for safe display
  const formatMetadata = (metadata: Record<string, unknown> | undefined): { text: string; truncated: boolean } => {
    if (!metadata) return { text: '', truncated: false };
    const jsonStr = JSON.stringify(metadata, null, 2);
    if (jsonStr.length <= MAX_METADATA_LENGTH) {
      return { text: jsonStr, truncated: false };
    }
    return {
      text: jsonStr.substring(0, MAX_METADATA_LENGTH) + '\n... (truncated)',
      truncated: true,
    };
  };

  // Unauthorized screen
  if (!isLoading && !isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Audit Logs</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerContainer}>
          <Ionicons name="lock-closed" size={64} color={COLORS.textLight} />
          <Text style={styles.unauthorizedText}>Not authorized</Text>
          <Text style={styles.unauthorizedSubtext}>
            You need admin access to view audit logs.
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
          <Text style={styles.headerTitle}>Audit Logs</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading logs...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderLogItem = ({ item }: { item: AdminLog }) => {
    const isExpanded = expandedLogId === item.id;
    const metadataFormatted = formatMetadata(item.metadata);

    return (
      <TouchableOpacity
        style={styles.logCard}
        onPress={() => setExpandedLogId(isExpanded ? null : item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.logHeader}>
          <View style={[styles.actionBadge, { backgroundColor: getActionColor(item.action) + '20' }]}>
            <Text style={[styles.actionText, { color: getActionColor(item.action) }]}>
              {formatAction(item.action)}
            </Text>
          </View>
          <Text style={styles.timeText}>{formatRelativeTime(item.createdAt)}</Text>
        </View>

        <View style={styles.logDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Admin:</Text>
            <TouchableOpacity
              style={styles.copyableId}
              onPress={() => copyToClipboard(String(item.adminUserId), 'Admin ID')}
            >
              <Text style={styles.detailValue}>{truncateId(String(item.adminUserId))}</Text>
              <Ionicons name="copy-outline" size={12} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>
          {item.targetUserId && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Target:</Text>
              <TouchableOpacity
                style={styles.copyableId}
                onPress={() => copyToClipboard(String(item.targetUserId), 'Target ID')}
              >
                <Text style={styles.detailValue}>{truncateId(String(item.targetUserId))}</Text>
                <Ionicons name="copy-outline" size={12} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
          )}
          {item.reason && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Reason:</Text>
              <Text style={styles.detailValue}>{item.reason}</Text>
            </View>
          )}
        </View>

        {isExpanded && (
          <View style={styles.expandedContent}>
            <Text style={styles.exactTime}>{formatExactTime(item.createdAt)}</Text>
            <Text style={styles.logId}>ID: {item.id}</Text>
            {metadataFormatted.text && (
              <View style={styles.metadataContainer}>
                <Text style={styles.metadataLabel}>
                  Metadata{metadataFormatted.truncated ? ' (truncated)' : ''}:
                </Text>
                <Text style={styles.metadataText}>
                  {metadataFormatted.text}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.expandIndicator}>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={COLORS.textLight}
          />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Audit Logs</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{logs.length}</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {/* Action Filter */}
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowActionPicker(!showActionPicker)}
          >
            <Text style={styles.filterLabel}>
              {actionFilter ? formatAction(actionFilter) : 'All Actions'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={COLORS.textLight} />
          </TouchableOpacity>

          {/* Limit Selector */}
          {LIMIT_OPTIONS.map((l) => (
            <TouchableOpacity
              key={l}
              style={[styles.limitButton, limit === l && styles.limitButtonActive]}
              onPress={() => setLimit(l)}
            >
              <Text style={[styles.limitText, limit === l && styles.limitTextActive]}>
                {l}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Action Picker Dropdown */}
        {showActionPicker && (
          <View style={styles.actionPicker}>
            {ACTION_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={styles.actionOption}
                onPress={() => {
                  setActionFilter(opt.value);
                  setShowActionPicker(false);
                }}
              >
                <Text
                  style={[
                    styles.actionOptionText,
                    actionFilter === opt.value && styles.actionOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
                {actionFilter === opt.value && (
                  <Ionicons name="checkmark" size={18} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ID Filters */}
        <View style={styles.idFilters}>
          <TextInput
            style={styles.idInput}
            placeholder="Admin ID filter..."
            placeholderTextColor={COLORS.textLight}
            value={adminIdFilter}
            onChangeText={setAdminIdFilter}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.idInput}
            placeholder="Target ID filter..."
            placeholderTextColor={COLORS.textLight}
            value={targetIdFilter}
            onChangeText={setTargetIdFilter}
            autoCapitalize="none"
          />
        </View>
      </View>

      {/* Logs List */}
      {logs.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="document-text-outline" size={64} color={COLORS.textLight} />
          <Text style={styles.emptyText}>No logs yet</Text>
          <Text style={styles.emptySubtext}>Admin actions will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          renderItem={renderLogItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
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
  emptyText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textLight,
  },
  filtersContainer: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    gap: 4,
  },
  filterLabel: {
    fontSize: 14,
    color: COLORS.text,
  },
  limitButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 4,
    backgroundColor: COLORS.backgroundDark,
  },
  limitButtonActive: {
    backgroundColor: COLORS.primary,
  },
  limitText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  limitTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  actionPicker: {
    position: 'absolute',
    top: 50,
    left: 12,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  actionOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    minWidth: 180,
  },
  actionOptionText: {
    fontSize: 14,
    color: COLORS.text,
  },
  actionOptionTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  idFilters: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 8,
  },
  idInput: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: COLORS.text,
  },
  listContent: {
    padding: 12,
  },
  logCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timeText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  logDetails: {
    gap: 4,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 8,
  },
  detailLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    width: 60,
  },
  detailValue: {
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
  },
  copyableId: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  expandedContent: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  exactTime: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 4,
  },
  logId: {
    fontSize: 11,
    color: COLORS.textLight,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  metadataContainer: {
    marginTop: 8,
  },
  metadataLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 4,
  },
  metadataText: {
    fontSize: 11,
    color: COLORS.text,
    fontFamily: 'monospace',
    backgroundColor: COLORS.background,
    padding: 8,
    borderRadius: 4,
  },
  expandIndicator: {
    alignItems: 'center',
    marginTop: 8,
  },
});
