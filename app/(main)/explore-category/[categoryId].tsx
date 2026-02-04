import React, { useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useExploreProfiles } from '@/hooks/useExploreProfiles';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';
import { DiscoverCardStack } from '@/components/screens/DiscoverCardStack';
import { COLORS } from '@/lib/constants';

const HEADER_H = 48;

export default function ExploreCategoryScreen() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profiles = useExploreProfiles();

  const cat = useMemo(
    () => EXPLORE_CATEGORIES.find((c) => c.id === categoryId),
    [categoryId],
  );

  const items = useMemo(
    () => profiles.filter(cat?.predicate ?? (() => false)),
    [profiles, cat],
  );

  useEffect(() => {
    if (__DEV__) console.log("[ExploreCategory]", categoryId, "matches", items.length);
  }, [categoryId, items.length]);

  return (
    <View style={styles.container}>
      {/* Custom header over the card stack */}
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + HEADER_H }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {cat?.title ?? 'Explore'}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      {items.length > 0 ? (
        <DiscoverCardStack externalProfiles={items} hideHeader />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>✨</Text>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptySubtitle}>
            Check back soon — we'll bring you more people as they join.
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
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyEmoji: {
    fontSize: 56,
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
});
