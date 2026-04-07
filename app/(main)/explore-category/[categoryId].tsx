import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useExploreCategoryProfiles } from '@/hooks/useExploreCategoryProfiles';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';
import { useExplorePrefsStore } from '@/stores/explorePrefsStore';
import { DiscoverCardStack } from '@/components/screens/DiscoverCardStack';
import { COLORS } from '@/lib/constants';

const HEADER_H = 48;

export default function ExploreCategoryScreen() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshKey, setRefreshKey] = useState(0);
  // Track when user has swiped through all profiles
  const [stackExhausted, setStackExhausted] = useState(false);
  const hadProfilesRef = useRef(false);

  const { profiles, isLoading, isUsingBackend, totalCount, isError, error } = useExploreCategoryProfiles({
    categoryId: categoryId ?? '',
    limit: 50,
    refreshKey,
  });

  const cat = useMemo(
    () => EXPLORE_CATEGORIES.find((c) => c.id === categoryId),
    [categoryId],
  );

  // Engagement triggers
  const trackCategoryVisit = useExplorePrefsStore((s) => s.trackCategoryVisit);
  const isRevisitInSession = useExplorePrefsStore((s) => s.isRevisitInSession);
  const hasTriggerBeenShown = useExplorePrefsStore((s) => s.hasTriggerBeenShown);
  const markTriggerShown = useExplorePrefsStore((s) => s.markTriggerShown);

  // Track category visit on mount
  useEffect(() => {
    if (categoryId) {
      trackCategoryVisit(categoryId);
    }
  }, [categoryId, trackCategoryVisit]);

  // Scarcity trigger: show when profiles <= 3 (Task 1)
  const showScarcityHint = useMemo(() => {
    if (!categoryId || profiles.length === 0 || profiles.length > 3) return false;
    const triggerId = `scarcity-${categoryId}`;
    return !hasTriggerBeenShown(triggerId);
  }, [categoryId, profiles.length, hasTriggerBeenShown]);

  // Time-based nudge: show when revisiting category in session (Task 2)
  const showRevisitNudge = useMemo(() => {
    if (!categoryId) return false;
    const triggerId = `revisit-nudge-${categoryId}`;
    if (hasTriggerBeenShown(triggerId)) return false;
    return isRevisitInSession(categoryId);
  }, [categoryId, isRevisitInSession, hasTriggerBeenShown]);

  // Mark scarcity trigger as shown when displayed
  useEffect(() => {
    if (showScarcityHint && categoryId) {
      markTriggerShown(`scarcity-${categoryId}`);
    }
  }, [showScarcityHint, categoryId, markTriggerShown]);

  // Mark revisit nudge as shown when displayed
  useEffect(() => {
    if (showRevisitNudge && categoryId) {
      markTriggerShown(`revisit-nudge-${categoryId}`);
    }
  }, [showRevisitNudge, categoryId, markTriggerShown]);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    // Reset exhausted state on refresh
    setStackExhausted(false);
  }, []);

  // Use the profiles directly from the hook (already filtered by category)
  const items = profiles;

  // Track if we ever had profiles
  useEffect(() => {
    if (items.length > 0) {
      hadProfilesRef.current = true;
    }
  }, [items.length]);

  // Mark stack as exhausted when all profiles have been swiped
  const handleStackEmpty = useCallback(() => {
    if (hadProfilesRef.current) {
      setStackExhausted(true);
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Custom header with subtitle (Task 6) */}
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title} numberOfLines={1}>
            {cat?.title ?? 'Explore'}
          </Text>
          <Text style={styles.headerSubtitle}>People matching this vibe</Text>
        </View>
        <TouchableOpacity onPress={handleRefresh} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="refresh" size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Engagement triggers - subtle hints */}
      {!isLoading && !isError && items.length > 0 && (showScarcityHint || showRevisitNudge) && (
        <View style={styles.engagementHint}>
          <Text style={styles.engagementHintText}>
            {showScarcityHint
              ? 'Only a few people in this vibe right now'
              : 'New people might be joining soon'}
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Finding the best people for you...</Text>
        </View>
      ) : isError ? (
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={64} color={COLORS.textLight} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>This vibe is unavailable</Text>
          <Text style={styles.emptySubtitle}>{error ?? 'Unable to load this vibe right now.'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : items.length > 0 && !stackExhausted ? (
        <DiscoverCardStack
          externalProfiles={items}
          hideHeader
          exploreCategoryId={categoryId}
          onStackEmpty={handleStackEmpty}
        />
      ) : (
        /* Same empty state for both "0 profiles" and "all profiles swiped" */
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-circle-outline" size={64} color={COLORS.textLight} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptySubtitle}>
            You've seen everyone in this vibe.{'\n'}Check again later or explore other vibes.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: COLORS.background,
    zIndex: 10,
  },
  headerBtn: { width: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
  },
  // Engagement hint - subtle psychological trigger
  engagementHint: {
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  engagementHintText: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
