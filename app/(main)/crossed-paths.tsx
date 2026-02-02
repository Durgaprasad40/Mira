import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a timestamp to a relative time string like "2 days ago". */
function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} min ago`;
  return 'Just now';
}

// ---------------------------------------------------------------------------
// Demo data (used when in demo mode)
// ---------------------------------------------------------------------------

const DEMO_HISTORY = [
  { id: '1', initial: 'A', areaName: 'Near Powai', createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000 },
  { id: '2', initial: 'S', areaName: 'Near Vikhroli', createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000 },
  { id: '3', initial: 'H', areaName: 'Near Sion West', createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000 },
  { id: '4', initial: 'J', areaName: 'Near Matunga East', createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000 },
  { id: '5', initial: 'R', areaName: 'Near Andheri East', createdAt: Date.now() - 4 * 24 * 60 * 60 * 1000 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CrossedPathsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const convexHistory = useQuery(
    api.crossedPaths.getCrossPathHistory,
    !isDemoMode && userId ? { userId: userId as any } : 'skip',
  );

  const history = isDemoMode
    ? DEMO_HISTORY
    : (convexHistory ?? []).map((entry) => ({
        id: entry.id,
        initial: entry.initial,
        areaName: entry.areaName,
        createdAt: entry.createdAt,
      }));

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Crossed Paths</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Section label */}
      <Text style={styles.sectionLabel}>People you crossed paths with recently</Text>

      {/* History list */}
      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.historyCard}>
            {/* Blurred / anonymous avatar circle with initial */}
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{item.initial}</Text>
            </View>

            <View style={styles.historyInfo}>
              {/* Area name only — no coordinates, no exact distance */}
              <Text style={styles.areaName}>{item.areaName}</Text>
              {/* Relative time */}
              <Text style={styles.timeAgo}>{formatTimeAgo(item.createdAt)}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="location-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No crossed paths yet</Text>
            <Text style={styles.emptySubtitle}>
              When you and someone else use the app in the same area, it will appear here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  sectionLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  listContent: {
    paddingBottom: 40,
  },

  // History card — anonymous, area-only
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
  },
  historyInfo: {
    flex: 1,
  },
  areaName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  timeAgo: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 3,
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
});
