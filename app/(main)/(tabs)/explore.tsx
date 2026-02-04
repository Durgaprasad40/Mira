import React, { memo, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';
import { ExploreTileGrid } from '@/components/explore/ExploreTileGrid';

function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  useEffect(() => {
    if (__DEV__) console.log("[Explore] categoryIds", EXPLORE_CATEGORIES.map(c => c.id).join(","));
  }, []);

  const openCategory = useCallback(
    (categoryId: string) => {
      router.push(`/explore-category/${categoryId}` as any);
    },
    [router],
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>Explore</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <ExploreTileGrid
          categories={EXPLORE_CATEGORIES}
          onPressTile={(cat) => openCategory(cat.id)}
        />
      </ScrollView>
    </View>
  );
}

export default memo(ExploreScreen);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  scroll: { paddingBottom: 40 },
});
