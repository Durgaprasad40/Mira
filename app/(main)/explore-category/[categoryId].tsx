import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useExploreCategoryProfiles } from '@/hooks/useExploreCategoryProfiles';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';
import { useExplorePrefsStore } from '@/stores/explorePrefsStore';
import { DiscoverCardStack } from '@/components/screens/DiscoverCardStack';
import { safeReplace } from '@/lib/safeRouter';
import { COLORS } from '@/lib/constants';

const HEADER_H = 48;
const PAGE_SIZE = 50;

export default function ExploreCategoryScreen() {
  const { categoryId } = useLocalSearchParams<{ categoryId?: string | string[] }>();
  const normalizedCategoryId = Array.isArray(categoryId) ? categoryId[0] : categoryId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshKey, setRefreshKey] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  // Track when user has swiped through all profiles
  const [stackExhausted, setStackExhausted] = useState(false);
  const [showLoadMorePrompt, setShowLoadMorePrompt] = useState(false);
  const [isLoadingNextBatch, setIsLoadingNextBatch] = useState(false);
  const hadProfilesRef = useRef(false);

  const {
    profiles,
    totalCount,
    hasMore,
    status,
    partialBatchExhausted,
    isLoading,
    isStale,
    isError,
    error,
  } = useExploreCategoryProfiles({
    categoryId: normalizedCategoryId ?? '',
    limit: PAGE_SIZE,
    offset: pageOffset,
    refreshKey,
  });

  const cat = useMemo(
    () => EXPLORE_CATEGORIES.find((c) => c.id === normalizedCategoryId),
    [normalizedCategoryId],
  );

  // Engagement triggers
  const trackCategoryVisit = useExplorePrefsStore((s) => s.trackCategoryVisit);
  const isRevisitInSession = useExplorePrefsStore((s) => s.isRevisitInSession);
  const hasTriggerBeenShown = useExplorePrefsStore((s) => s.hasTriggerBeenShown);
  const markTriggerShown = useExplorePrefsStore((s) => s.markTriggerShown);

  // Track category visit on mount
  useEffect(() => {
    if (normalizedCategoryId && cat) {
      trackCategoryVisit(normalizedCategoryId);
    }
  }, [cat, normalizedCategoryId, trackCategoryVisit]);

  // Scarcity trigger: show when profiles <= 3 (Task 1)
  const showScarcityHint = useMemo(() => {
    if (!normalizedCategoryId || profiles.length === 0 || profiles.length > 3) return false;
    const triggerId = `scarcity-${normalizedCategoryId}`;
    return !hasTriggerBeenShown(triggerId);
  }, [normalizedCategoryId, profiles.length, hasTriggerBeenShown]);

  // Time-based nudge: show when revisiting category in session (Task 2)
  const showRevisitNudge = useMemo(() => {
    if (!normalizedCategoryId) return false;
    const triggerId = `revisit-nudge-${normalizedCategoryId}`;
    if (hasTriggerBeenShown(triggerId)) return false;
    return isRevisitInSession(normalizedCategoryId);
  }, [normalizedCategoryId, isRevisitInSession, hasTriggerBeenShown]);

  // Mark scarcity trigger as shown when displayed
  useEffect(() => {
    if (showScarcityHint && normalizedCategoryId) {
      markTriggerShown(`scarcity-${normalizedCategoryId}`);
    }
  }, [showScarcityHint, normalizedCategoryId, markTriggerShown]);

  // Mark revisit nudge as shown when displayed
  useEffect(() => {
    if (showRevisitNudge && normalizedCategoryId) {
      markTriggerShown(`revisit-nudge-${normalizedCategoryId}`);
    }
  }, [showRevisitNudge, normalizedCategoryId, markTriggerShown]);

  useEffect(() => {
    setPageOffset(0);
    setStackExhausted(false);
    setShowLoadMorePrompt(false);
    setIsLoadingNextBatch(false);
    hadProfilesRef.current = false;
  }, [normalizedCategoryId]);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setPageOffset(0);
    // Reset exhausted state on refresh
    setStackExhausted(false);
    setShowLoadMorePrompt(false);
    setIsLoadingNextBatch(false);
    hadProfilesRef.current = false;
  }, []);

  const handleLoadMore = useCallback(() => {
    setShowLoadMorePrompt(false);
    setStackExhausted(false);
    setIsLoadingNextBatch(true);
    hadProfilesRef.current = false;
    setPageOffset((currentOffset) => currentOffset + PAGE_SIZE);
  }, []);

  const handleReturnToExplore = useCallback(() => {
    safeReplace(router, '/(main)/(tabs)/explore' as any, 'explore-category->explore');
  }, [router]);

  // Use the profiles directly from the hook (already filtered by category)
  const items = profiles;
  const isInitialLoading = isLoading && items.length === 0;
  const isRefreshingLoadedPage = isLoading && items.length > 0;
  const profileActionScope = `${normalizedCategoryId ?? 'invalid'}:${refreshKey}:${pageOffset}`;
  const isUnavailableCategory = status === 'invalid_category' || !cat;

  useEffect(() => {
    if (!isLoading) {
      setIsLoadingNextBatch(false);
    }
  }, [isLoading]);

  // Track if we ever had profiles
  useEffect(() => {
    if (items.length > 0) {
      hadProfilesRef.current = true;
    }
  }, [items.length]);

  // Mark stack as exhausted when all profiles have been swiped
  const handleStackEmpty = useCallback(() => {
    if (!hadProfilesRef.current || isLoading) {
      return;
    }

    if (hasMore) {
      setShowLoadMorePrompt(true);
      setStackExhausted(true);
      return;
    }

    setShowLoadMorePrompt(false);
    setStackExhausted(true);
  }, [hasMore, isLoading]);

  const unavailableTitle = useMemo(() => {
    if (status === 'location_required') {
      return 'Nearby needs location';
    }
    if (status === 'verification_required') {
      return 'Verify to use Nearby';
    }
    if (status === 'invalid_category' || !cat) {
      return 'Category unavailable';
    }
    if (status === 'viewer_missing') {
      return 'Explore is unavailable';
    }
    if (status === 'discovery_paused') {
      return 'Discover is paused';
    }
    if (status === 'empty_category') {
      return 'No one here yet';
    }
    if (showLoadMorePrompt && hasMore) {
      return 'Load more people';
    }
    if (stackExhausted && partialBatchExhausted) {
      return "You've finished this loaded set";
    }
    return "You're all caught up";
  }, [cat, hasMore, partialBatchExhausted, showLoadMorePrompt, stackExhausted, status]);

  const unavailableSubtitle = useMemo(() => {
    if (status === 'location_required') {
      return 'Enable location access for Mira, then come back to see people close to you.';
    }
    if (status === 'verification_required') {
      return 'Finish profile verification to browse people nearby.';
    }
    if (status === 'invalid_category' || !cat) {
      return 'This Explore category is no longer available.';
    }
    if (status === 'viewer_missing') {
      return "We couldn't load your Explore profile right now.";
    }
    if (status === 'discovery_paused') {
      return 'Unpause discovery to browse people in this vibe again.';
    }
    if (status === 'empty_category') {
      return "There isn't anyone in this vibe right now.\nCheck again later or explore other vibes.";
    }
    if (showLoadMorePrompt && hasMore) {
      return 'You finished the people we already loaded for this vibe. Load the next batch to keep going.';
    }
    if (stackExhausted && partialBatchExhausted) {
      return "You've seen everyone we loaded for this vibe. Refresh later to check for more people.";
    }
    if (stackExhausted && pageOffset > 0) {
      return "You've seen everyone in this loaded set. Check back later for more people in this vibe.";
    }
    return "You've seen everyone in this vibe.\nCheck again later or explore other vibes.";
  }, [cat, hasMore, pageOffset, partialBatchExhausted, showLoadMorePrompt, stackExhausted, status]);

  const emptyIconName = useMemo(() => {
    if (status === 'location_required') return 'location-outline';
    if (status === 'verification_required') return 'shield-checkmark-outline';
    if (status === 'discovery_paused') return 'pause-circle-outline';
    if (status === 'viewer_missing' || status === 'invalid_category') return 'alert-circle-outline';
    if (status === 'empty_category') return 'people-outline';
    if (showLoadMorePrompt && hasMore) return 'chevron-down-circle-outline';
    return 'checkmark-circle-outline';
  }, [hasMore, showLoadMorePrompt, status]);

  return (
    <View style={styles.container}>
      {/* Custom header with subtitle (Task 6) */}
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title} numberOfLines={1}>
            {cat?.title ?? 'Category unavailable'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {cat ? 'People matching this vibe' : 'This Explore category is no longer available'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleRefresh} hitSlop={8} style={styles.headerBtn}>
          {isRefreshingLoadedPage ? (
            <ActivityIndicator size="small" color={COLORS.text} />
          ) : (
            <Ionicons name="refresh" size={22} color={COLORS.text} />
          )}
        </TouchableOpacity>
      </View>

      {/* Engagement triggers - subtle hints */}
      {!isLoading && !isError && !isStale && items.length > 0 && (showScarcityHint || showRevisitNudge) && (
        <View style={styles.engagementHint}>
          <Text style={styles.engagementHintText}>
            {showScarcityHint
              ? 'Only a few people in this vibe right now'
              : 'New people might be joining soon'}
          </Text>
        </View>
      )}

      {!isLoading && isStale && (
        <View style={styles.staleState}>
          <Ionicons name="cloud-offline-outline" size={16} color={COLORS.textLight} />
          <Text style={styles.staleStateText}>
            {error ?? 'Showing saved results while we reconnect.'}
          </Text>
        </View>
      )}

      {isInitialLoading || isLoadingNextBatch ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>
            {isLoadingNextBatch ? 'Loading more people...' : 'Finding the best people for you...'}
          </Text>
        </View>
      ) : isError && items.length === 0 ? (
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
          key={`${normalizedCategoryId ?? 'explore'}-${pageOffset}-${refreshKey}`}
          externalProfiles={items}
          hideHeader
          exploreCategoryId={normalizedCategoryId}
          profileActionScope={profileActionScope}
          onStackEmpty={handleStackEmpty}
        />
      ) : (
        <View style={styles.emptyState}>
          <Ionicons
            name={emptyIconName}
            size={64}
            color={COLORS.textLight}
            style={styles.emptyIcon}
          />
          <Text style={styles.emptyTitle}>{unavailableTitle}</Text>
          <Text style={styles.emptySubtitle}>{unavailableSubtitle}</Text>
          {isUnavailableCategory ? (
            <TouchableOpacity style={styles.retryButton} onPress={handleReturnToExplore}>
              <Text style={styles.retryButtonText}>Back to Explore</Text>
            </TouchableOpacity>
          ) : showLoadMorePrompt && hasMore ? (
            <TouchableOpacity style={styles.retryButton} onPress={handleLoadMore}>
              <Text style={styles.retryButtonText}>Load more people</Text>
            </TouchableOpacity>
          ) : null}
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
  staleState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(20, 24, 35, 0.04)',
  },
  staleStateText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textLight,
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
