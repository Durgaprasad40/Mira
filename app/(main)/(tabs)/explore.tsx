import { useCallback, useMemo, useState, useRef } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";

import ExploreTileGrid from "@/components/explore/ExploreTileGrid";
import { useExploreProfiles } from "@/components/explore/useExploreProfiles";
import {
  ExploreCategory,
  EXPLORE_CATEGORIES,
} from "@/components/explore/exploreCategories";

export default function ExploreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // profiles source (demo or real) — refreshKey forces re-evaluation
  const profiles = useExploreProfiles();

  // Track profiles ref to detect stale state
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  // restore selected category from route params
  const selectedCategoryId = typeof params.categoryId === "string"
    ? params.categoryId
    : null;

  const selectedCategory: ExploreCategory | null = useMemo(() => {
    if (!selectedCategoryId) return null;
    return (
      EXPLORE_CATEGORIES.find(c => c.id === selectedCategoryId) ?? null
    );
  }, [selectedCategoryId]);

  // when user taps a category
  const handleCategoryPress = useCallback(
    (category: ExploreCategory) => {
      router.push({
        pathname: "/explore-category/[categoryId]",
        params: { categoryId: category.id },
      });
    },
    [router]
  );

  // Refresh on focus — forces profile list to re-evaluate
  useFocusEffect(
    useCallback(() => {
      // Trigger a refresh key update to force re-render with latest profiles
      setRefreshKey((k) => k + 1);
      return () => {};
    }, [])
  );

  // Pull-to-refresh handler
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    // Bump refresh key to force profiles re-evaluation
    setRefreshKey((k) => k + 1);
    // Short delay to show refresh indicator
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ExploreTileGrid
        profiles={profiles}
        selectedCategory={selectedCategory}
        onCategoryPress={handleCategoryPress}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
});
