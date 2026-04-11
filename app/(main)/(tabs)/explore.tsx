import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { safePush } from "@/lib/safeRouter";
import { useScreenTrace } from "@/lib/devTrace";

import ExploreTileGrid from "@/components/explore/ExploreTileGrid";
import { ExploreCategory } from "@/components/explore/exploreCategories";
import { LoadingGuard } from "@/components/safety/LoadingGuard";
import { useExploreCategoryCounts } from "@/hooks/useExploreCategoryCounts";
import { COLORS } from "@/lib/constants";

export default function ExploreScreen() {
  useScreenTrace("EXPLORE");
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const {
    counts,
    totalEligibleCount,
    isLoading,
    isEmpty,
  } = useExploreCategoryCounts(refreshKey);

  // when user taps a category
  const handleCategoryPress = useCallback(
    (category: ExploreCategory) => {
      safePush(router, {
        pathname: "/explore-category/[categoryId]",
        params: { categoryId: category.id },
      }, 'explore->category');
    },
    [router]
  );

  useEffect(() => {
    if (refreshing && !isLoading) {
      setRefreshing(false);
    }
  }, [refreshing, isLoading]);

  // Refresh on focus so category counts stay in sync with swipes/blocks.
  useFocusEffect(
    useCallback(() => {
      setRefreshKey((k) => k + 1);
      return () => {};
    }, [])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <LoadingGuard
        isLoading={isLoading}
        onRetry={handleRefresh}
        title="Explore is still loading"
        subtitle="We’re still fetching your Explore categories. Retry to reload the feed."
      >
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <ExploreTileGrid
            categoryCounts={counts}
            totalEligibleCount={totalEligibleCount}
            isEmpty={isEmpty}
            onCategoryPress={handleCategoryPress}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        )}
      </LoadingGuard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
