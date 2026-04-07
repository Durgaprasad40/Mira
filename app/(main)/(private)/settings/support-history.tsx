/**
 * Phase-2 Support History Screen
 *
 * Shows the user's support tickets/requests with:
 * - Clean empty state when no requests
 * - Ticket list with status badges
 * - Navigation to individual ticket threads
 *
 * Uses Phase-2 dark premium styling (INCOGNITO_COLORS).
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { Id } from '@/convex/_generated/dataModel';

const C = INCOGNITO_COLORS;

// Category labels
const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug Report',
  safety: 'Safety Concern',
  account: 'Account',
  other: 'Other',
};

// Status colors and labels
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: C.primary },
  in_review: { label: 'In Review', color: '#F59E0B' },
  replied: { label: 'Replied', color: '#10B981' },
  closed: { label: 'Closed', color: C.textLight },
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
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  const tickets = useQuery(
    api.supportTickets.getUserTicketsWithPreview,
    userId ? { userId: userId as Id<'users'> } : 'skip'
  );

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
        onPress={() => router.push(`/(main)/(private)/settings/support-case-thread?requestId=${item._id}` as any)}
        activeOpacity={0.7}
      >
        <View style={styles.ticketHeader}>
          <View style={styles.ticketHeaderLeft}>
            <Text style={styles.ticketCategory}>
              {CATEGORY_LABELS[item.category] || item.category}
            </Text>
            {item.hasAdminReply && (
              <View style={styles.replyIndicator}>
                <Ionicons name="chatbubble" size={10} color={C.primary} />
              </View>
            )}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
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
      <View style={styles.emptyIconBox}>
        <Ionicons name="chatbubbles-outline" size={40} color={C.textLight} />
      </View>
      <Text style={styles.emptyTitle}>No Support Requests Yet</Text>
      <Text style={styles.emptyText}>
        When you contact support, your requests will appear here so you can track their status.
      </Text>
      <TouchableOpacity
        style={styles.createButton}
        onPress={() => router.back()}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={18} color="#FFF" />
        <Text style={styles.createButtonText}>Create Request</Text>
      </TouchableOpacity>
    </View>
  );

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
        <Text style={styles.headerTitle}>Support Requests</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Content */}
      {tickets === undefined ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading requests...</Text>
        </View>
      ) : (
        <FlatList
          data={tickets}
          renderItem={renderTicket}
          keyExtractor={(item) => item._id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 20 },
            tickets.length === 0 && styles.listContentEmpty,
          ]}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
        />
      )}
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: C.textLight,
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
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
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
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  replyIndicator: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  ticketPreview: {
    fontSize: 14,
    color: C.textLight,
    lineHeight: 20,
    marginBottom: 10,
  },
  ticketFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ticketDate: {
    fontSize: 12,
    color: C.textLight,
  },
  messageCount: {
    fontSize: 12,
    color: C.textLight,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIconBox: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  createButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
});
