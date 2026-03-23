/*
 * LOCKED (EXPLORE TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */

/**
 * Explore Tab - Tile Grid Only
 *
 * This screen ONLY shows the ExploreTileGrid.
 * Card swiping happens in the category detail screen.
 */
import { useCallback, useState, useMemo } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { safePush } from "@/lib/safeRouter";
import { useScreenTrace } from "@/lib/devTrace";

import ExploreTileGrid from "@/components/explore/ExploreTileGrid";
import { useExploreCategoryCounts } from "@/hooks/useExploreCategoryCounts";
import { ExploreCategory, EXPLORE_CATEGORIES } from "@/components/explore/exploreCategories";
import { useExplorePrefsStore } from "@/stores/explorePrefsStore";
import { COLORS } from "@/lib/constants";

export default function ExploreScreen() {
  useScreenTrace("EXPLORE");
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Backend counts for tile badges
  const backendCounts = useExploreCategoryCounts();

  // Explore preferences for intelligent sorting
  const trackCategoryClick = useExplorePrefsStore((s) => s.trackCategoryClick);
  const categoryClickCounts = useExplorePrefsStore((s) => s.categoryClickCounts);

  // Engagement triggers - return hook
  const trackExploreExit = useExplorePrefsStore((s) => s.trackExploreExit);
  const shouldShowReturnHook = useExplorePrefsStore((s) => s.shouldShowReturnHook);
  const getReturnCategory = useExplorePrefsStore((s) => s.getReturnCategory);
  const markTriggerShown = useExplorePrefsStore((s) => s.markTriggerShown);

  // Return hook state
  const [showReturnHook, setShowReturnHook] = useState(false);
  const returnCategoryId = getReturnCategory();
  const returnCategory = useMemo(
    () => returnCategoryId ? EXPLORE_CATEGORIES.find((c) => c.id === returnCategoryId) : null,
    [returnCategoryId]
  );

  // Navigate to category detail screen on tile press
  const handleCategoryPress = useCallback(
    (category: ExploreCategory) => {
      // Track click for intelligent sorting
      trackCategoryClick(category.id);

      safePush(router, {
        pathname: "/explore-category/[categoryId]",
        params: { categoryId: category.id },
      }, 'explore->category');
    },
    [router, trackCategoryClick]
  );

  // Refresh on focus and handle return hook
  useFocusEffect(
    useCallback(() => {
      setRefreshKey((k) => k + 1);

      // Check for return hook on focus
      if (shouldShowReturnHook() && returnCategory) {
        setShowReturnHook(true);
        // Mark as shown after displaying
        markTriggerShown(`return-hook-${Date.now()}`);
      }

      // Track exit when leaving Explore tab
      return () => {
        trackExploreExit();
        setShowReturnHook(false);
      };
    }, [shouldShowReturnHook, returnCategory, markTriggerShown, trackExploreExit])
  );

  // Handle return hook press - navigate to last category
  const handleReturnHookPress = useCallback(() => {
    if (returnCategoryId) {
      setShowReturnHook(false);
      safePush(router, {
        pathname: "/explore-category/[categoryId]",
        params: { categoryId: returnCategoryId },
      }, 'explore->return-category');
    }
  }, [returnCategoryId, router]);

  // Pull-to-refresh handler
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Explore</Text>
        <Text style={styles.headerSubtitle}>What are you in the mood for?</Text>
      </View>

      {/* Return hook - subtle engagement trigger (Task 4) */}
      {showReturnHook && returnCategory && (
        <TouchableOpacity style={styles.returnHook} onPress={handleReturnHookPress}>
          <Text style={styles.returnHookIcon}>{returnCategory.icon}</Text>
          <View style={styles.returnHookTextContainer}>
            <Text style={styles.returnHookLabel}>Pick up where you left off</Text>
            <Text style={styles.returnHookCategory}>{returnCategory.title ?? returnCategory.label}</Text>
          </View>
          <Text style={styles.returnHookArrow}>→</Text>
        </TouchableOpacity>
      )}

      {/* Tile Grid - NO card stack here */}
      <ExploreTileGrid
        onCategoryPress={handleCategoryPress}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        backendCounts={backendCounts}
        categoryClickCounts={categoryClickCounts}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    marginTop: 4,
  },
  // Return hook - subtle engagement trigger
  returnHook: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
  },
  returnHookIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  returnHookTextContainer: {
    flex: 1,
  },
  returnHookLabel: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  returnHookCategory: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 2,
  },
  returnHookArrow: {
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '600',
  },
});
