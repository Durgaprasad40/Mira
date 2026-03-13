/**
 * Crossed Paths Screen - Phase 2 Implementation
 *
 * Features:
 * - Lists users who have crossed paths with the current user
 * - Shows distance ranges (e.g., "4-5 km") instead of exact distances
 * - Shows relative time (e.g., "today", "yesterday") instead of exact timestamps
 * - Shows crossing count for repeated crossings
 * - "Why am I seeing this?" explanation
 * - Navigation to profile on tap
 * - Hide/delete crossed path entries
 * - Demo mode with sample data
 */
import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { asUserId } from '@/convex/id';
import { safePush } from '@/lib/safeRouter';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_PROFILES } from '@/lib/demoData';
import { Id } from '@/convex/_generated/dataModel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossedPathItem {
  id: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAge: number;
  areaName: string;
  crossingCount: number;
  distanceRange: string | null;
  relativeTime: string;
  reasonTags: string[];
  reasonText: string | null;
  whyExplanation: string;
  photoUrl: string | null | undefined;
  initial: string;
  isVerified: boolean;
}

// ---------------------------------------------------------------------------
// Demo Data
// ---------------------------------------------------------------------------

const DEMO_CROSSED_PATHS: CrossedPathItem[] = [
  {
    id: 'demo_cp_1',
    otherUserId: 'demo_profile_1',
    otherUserName: DEMO_PROFILES[0]?.name ?? 'Priya',
    otherUserAge: DEMO_PROFILES[0]?.age ?? 25,
    areaName: 'Near Bandra West',
    crossingCount: 3,
    distanceRange: '2-3 km',
    relativeTime: 'today',
    reasonTags: ['interest:coffee', 'lookingFor:long_term'],
    reasonText: 'You both enjoy coffee',
    whyExplanation: "You've crossed paths 3 times in similar areas. You both enjoy coffee.",
    photoUrl: DEMO_PROFILES[0]?.photos?.[0]?.url ?? null,
    initial: 'P',
    isVerified: true,
  },
  {
    id: 'demo_cp_2',
    otherUserId: 'demo_profile_2',
    otherUserName: DEMO_PROFILES[1]?.name ?? 'Ananya',
    otherUserAge: DEMO_PROFILES[1]?.age ?? 23,
    areaName: 'Nearby area',
    crossingCount: 1,
    distanceRange: '1-2 km',
    relativeTime: 'yesterday',
    reasonTags: ['interest:movies'],
    reasonText: 'You both enjoy movies',
    whyExplanation: 'You were in the same area within the last 24 hours. You both enjoy movies.',
    photoUrl: DEMO_PROFILES[1]?.photos?.[0]?.url ?? null,
    initial: 'A',
    isVerified: true,
  },
  {
    id: 'demo_cp_3',
    otherUserId: 'demo_profile_3',
    otherUserName: DEMO_PROFILES[2]?.name ?? 'Meera',
    otherUserAge: DEMO_PROFILES[2]?.age ?? 27,
    areaName: 'Near Koramangala',
    crossingCount: 5,
    distanceRange: '3-5 km',
    relativeTime: '2 days ago',
    reasonTags: ['lookingFor:long_term'],
    reasonText: "You're both looking for something long-term",
    whyExplanation: "You've crossed paths 5 times in similar areas. You're both looking for something long-term.",
    photoUrl: DEMO_PROFILES[2]?.photos?.[0]?.url ?? null,
    initial: 'M',
    isVerified: true,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CrossedPathsScreen() {
  const router = useRouter();
  const isDemo = isDemoMode;

  // Auth store
  const userId = useAuthStore((s) => s.userId);
  const convexUserId = userId ? asUserId(userId) : undefined;

  // Local state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hiddenDemoIds, setHiddenDemoIds] = useState<Set<string>>(new Set());

  // Query crossed paths history (live mode only)
  const crossedPathsQuery = useQuery(
    api.crossedPaths.getCrossPathHistory,
    !isDemo && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Mutations for hide/delete (live mode only)
  const hideCrossedPathMutation = useMutation(api.crossedPaths.hideCrossedPath);
  const deleteCrossedPathMutation = useMutation(api.crossedPaths.deleteCrossedPath);

  // Loading state
  const isLoading = !isDemo && crossedPathsQuery === undefined;

  // Combine demo and live data
  const crossedPaths: CrossedPathItem[] = useMemo(() => {
    if (isDemo) {
      // Filter out hidden demo items
      return DEMO_CROSSED_PATHS.filter((item) => !hiddenDemoIds.has(item.id));
    }
    return crossedPathsQuery ?? [];
  }, [isDemo, crossedPathsQuery, hiddenDemoIds]);

  // ---------------------------------------------------------------------------
  // Refresh handler
  // ---------------------------------------------------------------------------
  const handleRefresh = useCallback(async () => {
    if (isDemo) {
      // Demo mode: simulate refresh
      setIsRefreshing(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      setIsRefreshing(false);
      return;
    }

    // Live mode: Convex queries auto-refresh, but we show the indicator briefly
    setIsRefreshing(true);
    // Give time for the query to potentially re-fetch
    await new Promise((resolve) => setTimeout(resolve, 800));
    setIsRefreshing(false);
  }, [isDemo]);

  // ---------------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------------
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleProfilePress = useCallback((profileId: string) => {
    safePush(router, `/(main)/profile/${profileId}` as any, 'crossed-paths->profile');
  }, [router]);

  // ---------------------------------------------------------------------------
  // Hide/Delete handlers
  // ---------------------------------------------------------------------------
  const handleHidePress = useCallback((item: CrossedPathItem) => {
    Alert.alert(
      'Hide this person?',
      `${item.otherUserName} will be hidden from your crossed paths list. You can still see them if you cross paths again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: async () => {
            if (isDemo) {
              // Demo mode: hide locally
              setHiddenDemoIds((prev) => new Set([...prev, item.id]));
              return;
            }

            // Live mode: call mutation
            if (!convexUserId) return;
            try {
              await hideCrossedPathMutation({
                userId: convexUserId,
                historyId: item.id as Id<'crossPathHistory'>,
              });
            } catch (error) {
              if (__DEV__) console.error('[CROSSED_PATHS] Hide failed:', error);
              Alert.alert('Error', 'Failed to hide. Please try again.');
            }
          },
        },
      ]
    );
  }, [isDemo, convexUserId, hideCrossedPathMutation]);

  const handleDeletePress = useCallback((item: CrossedPathItem) => {
    Alert.alert(
      'Remove permanently?',
      `This will permanently remove ${item.otherUserName} from your crossed paths history. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (isDemo) {
              // Demo mode: hide locally (same effect)
              setHiddenDemoIds((prev) => new Set([...prev, item.id]));
              return;
            }

            // Live mode: call mutation
            if (!convexUserId) return;
            try {
              await deleteCrossedPathMutation({
                userId: convexUserId,
                historyId: item.id as Id<'crossPathHistory'>,
              });
            } catch (error) {
              if (__DEV__) console.error('[CROSSED_PATHS] Delete failed:', error);
              Alert.alert('Error', 'Failed to remove. Please try again.');
            }
          },
        },
      ]
    );
  }, [isDemo, convexUserId, deleteCrossedPathMutation]);

  const handleOptionsPress = useCallback((item: CrossedPathItem) => {
    Alert.alert(
      item.otherUserName,
      'What would you like to do?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide from list',
          onPress: () => handleHidePress(item),
        },
        {
          text: 'Remove permanently',
          style: 'destructive',
          onPress: () => handleDeletePress(item),
        },
      ]
    );
  }, [handleHidePress, handleDeletePress]);

  // ---------------------------------------------------------------------------
  // Render item
  // ---------------------------------------------------------------------------
  const renderItem = useCallback(({ item }: { item: CrossedPathItem }) => {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleProfilePress(item.otherUserId as string)}
        onLongPress={() => handleOptionsPress(item)}
        activeOpacity={0.7}
        delayLongPress={400}
      >
        <View style={styles.cardContent}>
          {/* Profile photo */}
          <View style={styles.photoContainer}>
            {item.photoUrl ? (
              <Image source={{ uri: item.photoUrl }} style={styles.photo} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoInitial}>{item.initial}</Text>
              </View>
            )}
            {item.isVerified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
              </View>
            )}
          </View>

          {/* Info section */}
          <View style={styles.infoSection}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {item.otherUserName}, {item.otherUserAge}
              </Text>
              {item.crossingCount > 1 && (
                <View style={styles.crossingBadge}>
                  <Ionicons name="footsteps" size={12} color={COLORS.primary} />
                  <Text style={styles.crossingCount}>{item.crossingCount}x</Text>
                </View>
              )}
            </View>

            <View style={styles.detailsRow}>
              <View style={styles.detailItem}>
                <Ionicons name="location-outline" size={14} color={COLORS.textLight} />
                <Text style={styles.detailText}>{item.areaName}</Text>
              </View>
              {item.distanceRange && (
                <View style={styles.detailItem}>
                  <Ionicons name="navigate-outline" size={14} color={COLORS.textLight} />
                  <Text style={styles.detailText}>{item.distanceRange}</Text>
                </View>
              )}
            </View>

            <View style={styles.timeRow}>
              <Ionicons name="time-outline" size={14} color={COLORS.textLight} />
              <Text style={styles.timeText}>{item.relativeTime}</Text>
            </View>

            {/* Why am I seeing this? */}
            {item.reasonText && (
              <View style={styles.reasonRow}>
                <Ionicons name="heart-outline" size={14} color={COLORS.primary} />
                <Text style={styles.reasonText} numberOfLines={1}>
                  {item.reasonText}
                </Text>
              </View>
            )}
          </View>

          {/* Options button */}
          <TouchableOpacity
            style={styles.optionsButton}
            onPress={() => handleOptionsPress(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="ellipsis-vertical" size={18} color={COLORS.textLight} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }, [handleProfilePress, handleOptionsPress]);

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  const renderEmpty = useCallback(() => {
    if (isLoading) return null;

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="footsteps-outline" size={64} color={COLORS.textLight} />
        <Text style={styles.emptyTitle}>No crossed paths yet</Text>
        <Text style={styles.emptySubtitle}>
          When you cross paths with someone nearby, they'll appear here.
        </Text>
      </View>
    );
  }, [isLoading]);

  // ---------------------------------------------------------------------------
  // Header info
  // ---------------------------------------------------------------------------
  const renderHeader = useCallback(() => {
    if (crossedPaths.length === 0) return null;

    return (
      <View style={styles.headerInfo}>
        <View style={styles.headerInfoContent}>
          <Ionicons name="information-circle-outline" size={18} color={COLORS.primary} />
          <Text style={styles.headerInfoText}>
            People you've crossed paths with in the last 4 weeks. Long-press or tap the menu to hide.
          </Text>
        </View>
      </View>
    );
  }, [crossedPaths.length]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Crossed Paths</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Loading state */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}

      {/* Demo mode notice */}
      {isDemo && (
        <View style={styles.demoNotice}>
          <Ionicons name="flask-outline" size={16} color={COLORS.warning} />
          <Text style={styles.demoNoticeText}>Demo mode - showing sample data</Text>
        </View>
      )}

      {/* List */}
      {!isLoading && (
        <FlatList
          data={crossedPaths}
          renderItem={renderItem}
          keyExtractor={(item) => item.id as string}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
        />
      )}
    </SafeAreaView>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerSpacer: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.textLight,
  },
  demoNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${COLORS.warning}15`,
    paddingVertical: 8,
    gap: 6,
  },
  demoNoticeText: {
    fontSize: 13,
    color: COLORS.warning,
  },
  headerInfo: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: `${COLORS.primary}08`,
  },
  headerInfoContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerInfoText: {
    fontSize: 13,
    color: COLORS.textLight,
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  photoContainer: {
    position: 'relative',
  },
  photo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.border,
  },
  photoPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  infoSection: {
    flex: 1,
    marginLeft: 14,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  crossingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${COLORS.primary}15`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  crossingCount: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  timeText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  reasonText: {
    fontSize: 12,
    color: COLORS.primary,
    flex: 1,
  },
  optionsButton: {
    padding: 4,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
});
