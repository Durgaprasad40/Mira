import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { Id } from '@/convex/_generated/dataModel';
import { isDemoMode } from '@/hooks/useConvex';

// Category labels
const CATEGORY_LABELS: Record<string, string> = {
  payment: 'Payment',
  subscription: 'Subscription',
  account: 'Account',
  bug: 'Bug Report',
  safety: 'Safety',
  verification: 'Verification',
  other: 'Other',
};

// Status colors and labels
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: COLORS.primary, bg: COLORS.primary + '20' },
  in_review: { label: 'In Review', color: '#F59E0B', bg: '#F59E0B20' },
  replied: { label: 'Replied', color: '#10B981', bg: '#10B98120' },
  closed: { label: 'Closed', color: COLORS.textMuted, bg: COLORS.textMuted + '20' },
};

// Ticket type from query
type TicketWithPreview = {
  _id: Id<'supportTickets'>;
  category: string;
  status: string;
  message: string;
  createdAt: number;
  updatedAt: number;
  lastMessage: {
    message: string;
    senderType: 'user' | 'admin';
    createdAt: number;
  } | null;
  messageCount: number;
  hasAdminReply: boolean;
};

export default function SupportHistoryScreen() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [timedOut, setTimedOut] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const tickets = useQuery(
    api.supportTickets.getUserTicketsWithPreview,
    !isDemoMode && token ? { token } : 'skip'
  );
  const resolvedTickets = isDemoMode ? [] : tickets ?? [];

  const handleGoBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/settings/support' as any);
    }
  }, [router]);

  useEffect(() => {
    if (isDemoMode || tickets !== undefined || !token) {
      setTimedOut(false);
      return;
    }

    setTimedOut(false);
    const timeout = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  }, [tickets, token, retryNonce]);

  const isLoading = !isDemoMode && !!token && tickets === undefined && !timedOut;
  const isUnavailable = !isDemoMode && (!token || (tickets === undefined && timedOut));

  const handleRetry = useCallback(() => {
    setTimedOut(false);
    setRetryNonce((value) => value + 1);
  }, []);

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const getPreviewText = (ticket: TicketWithPreview): string => {
    if (ticket.lastMessage) {
      const prefix = ticket.lastMessage.senderType === 'admin' ? 'Support: ' : 'You: ';
      return prefix + ticket.lastMessage.message;
    }
    return ticket.message;
  };

  const renderTicket = ({ item }: { item: TicketWithPreview }) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.open;
    const previewText = getPreviewText(item);
    const displayDate = item.lastMessage?.createdAt || item.updatedAt;

    return (
      <TouchableOpacity
        style={styles.ticketCard}
        onPress={() => router.push(`/(main)/settings/support-ticket/${item._id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.ticketHeader}>
          <View style={styles.ticketHeaderLeft}>
            <Text style={styles.ticketCategory}>
              {CATEGORY_LABELS[item.category] || item.category}
            </Text>
            {item.hasAdminReply && (
              <View style={styles.replyIndicator}>
                <Ionicons name="chatbubble" size={10} color={COLORS.primary} />
              </View>
            )}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>

        <Text style={styles.ticketPreview} numberOfLines={2}>
          {previewText}
        </Text>

        <View style={styles.ticketFooter}>
          <Text style={styles.ticketDate}>{formatDate(displayDate)}</Text>
          {item.messageCount > 0 && (
            <Text style={styles.messageCount}>
              {item.messageCount} {item.messageCount === 1 ? 'reply' : 'replies'}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="chatbubbles-outline" size={48} color={COLORS.textMuted} />
      <Text style={styles.emptyTitle}>No support requests</Text>
      <Text style={styles.emptyText}>
        When you submit a support request, it will appear here.
      </Text>
      <TouchableOpacity
        style={styles.createButton}
        onPress={() => router.push('/(main)/settings/support')}
      >
        <Text style={styles.createButtonText}>Create Request</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleGoBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Support Requests</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading your support requests...</Text>
        </View>
      ) : isUnavailable ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>Support history unavailable</Text>
          <Text style={styles.emptyText}>
            We couldn&apos;t load your support requests right now.
          </Text>
          <TouchableOpacity
            style={styles.createButton}
            onPress={token ? handleRetry : handleGoBack}
          >
            <Text style={styles.createButtonText}>
              {token ? 'Try Again' : 'Back to Support'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={resolvedTickets}
          renderItem={renderTicket}
          keyExtractor={(item) => item._id}
          contentContainerStyle={[
            styles.listContent,
            resolvedTickets.length === 0 && styles.listContentEmpty,
          ]}
          ListEmptyComponent={renderEmpty}
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textMuted,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  listContentEmpty: {
    flex: 1,
  },
  // Ticket card
  ticketCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  ticketHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ticketCategory: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  replyIndicator: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  ticketPreview: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
    marginBottom: 8,
  },
  ticketFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ticketDate: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  messageCount: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  createButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  createButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
});
