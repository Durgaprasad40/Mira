/**
 * Cluster Results Page
 *
 * Displayed when a user taps on a cluster marker in the Nearby map.
 * Shows profiles in a 2-column grid (3 rows visible, scrollable).
 *
 * Features:
 * - Grid layout: 2 columns, scrollable
 * - Profile cards with: photo, name, age, gender
 * - Photo blur based on subscription/visibility rules
 * - Crossed paths indicator if available
 * - Tap card → opens Discover-style profile view
 * - Sorted by: recency, crossed paths count, verified status
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { asUserId } from '@/convex/id';
import { safePush } from '@/lib/safeRouter';
import { COLORS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClusterUser {
  id: string;
  name: string;
  age: number;
  gender?: string;
  photoUrl: string | null;
  isVerified: boolean;
  publishedAt?: number;
  crossedPathsCount?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 12;
const CARD_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;
const CARD_HEIGHT = CARD_WIDTH * 1.4; // 1.4 aspect ratio for portrait cards

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClusterResultsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userIds: string; lat: string; lng: string }>();
  const userId = useAuthStore((s) => s.userId);
  const convexUserId = userId ? asUserId(userId) : undefined;

  // Parse user IDs from params
  const userIds = useMemo(() => {
    try {
      return params.userIds ? JSON.parse(params.userIds) : [];
    } catch {
      return [];
    }
  }, [params.userIds]);

  // Fetch crossed paths data for sorting
  const crossedPathsData = useQuery(
    api.crossedPaths.getCrossedPaths,
    convexUserId ? { userId: convexUserId, limit: 100 } : 'skip'
  );

  // Build crossed paths count map
  const crossedCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (crossedPathsData) {
      for (const cp of crossedPathsData) {
        map.set(cp.user.id as string, cp.count);
      }
    }
    return map;
  }, [crossedPathsData]);

  // Sort users: verified first, then by crossed paths count, then by recency
  const sortedUsers = useMemo(() => {
    // For now, we just have the IDs - we'll need to enhance this
    // when we have the full user data
    return userIds.map((id: string) => ({
      id,
      crossedPathsCount: crossedCountMap.get(id) || 0,
    }));
  }, [userIds, crossedCountMap]);

  // Handle profile card press
  const handleProfilePress = (profileUserId: string) => {
    safePush(router, `/(main)/profile/${profileUserId}` as any, 'cluster->profile');
  };

  // Handle back press
  const handleBack = () => {
    router.back();
  };

  // Render profile card
  const renderProfileCard = ({ item }: { item: { id: string; crossedPathsCount: number } }) => {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleProfilePress(item.id)}
        activeOpacity={0.85}
      >
        {/* Placeholder photo - will be replaced with actual data */}
        <View style={styles.cardPhoto}>
          <View style={styles.placeholderPhoto}>
            <Ionicons name="person" size={40} color={COLORS.textLight} />
          </View>
        </View>

        {/* Crossed paths badge */}
        {item.crossedPathsCount > 0 && (
          <View style={styles.crossedBadge}>
            <Ionicons name="shuffle" size={12} color="#fff" />
            <Text style={styles.crossedBadgeText}>{item.crossedPathsCount}x</Text>
          </View>
        )}

        {/* Profile info overlay */}
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>
            Loading...
          </Text>
          <Text style={styles.cardDetails}>Tap to view</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {userIds.length} {userIds.length === 1 ? 'Person' : 'People'} Nearby
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Subtitle */}
      <View style={styles.subtitleContainer}>
        <Text style={styles.subtitle}>
          Tap a profile to view details
        </Text>
      </View>

      {/* Profile Grid */}
      {userIds.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={48} color={COLORS.textLight} />
          <Text style={styles.emptyText}>No profiles in this area</Text>
        </View>
      ) : (
        <FlatList
          data={sortedUsers}
          renderItem={renderProfileCard}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
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
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerSpacer: {
    width: 32,
  },
  subtitleContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  gridContent: {
    padding: CARD_PADDING,
    paddingTop: 8,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  cardPhoto: {
    flex: 1,
    backgroundColor: '#e0e0e0',
  },
  placeholderPhoto: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actualPhoto: {
    width: '100%',
    height: '100%',
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  crossedBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  crossedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  verifiedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 2,
  },
  cardInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  cardDetails: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
    textAlign: 'center',
  },
});
