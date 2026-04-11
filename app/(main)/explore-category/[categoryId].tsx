import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useExploreProfiles } from '@/hooks/useExploreProfiles';
import { EXPLORE_CATEGORIES } from '@/components/explore/exploreCategories';
import { DiscoverCardStack } from '@/components/screens/DiscoverCardStack';
import { COLORS } from '@/lib/constants';
import { LoadingGuard } from '@/components/safety/LoadingGuard';

const HEADER_H = 48;

export default function ExploreCategoryScreen() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshKey, setRefreshKey] = useState(0);
  const {
    profiles,
    isLoading,
  } = useExploreProfiles({ categoryId, refreshKey });

  const cat = useMemo(
    () => EXPLORE_CATEGORIES.find((c) => c.id === categoryId),
    [categoryId],
  );

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

      <LoadingGuard
        isLoading={isLoading}
        onRetry={() => setRefreshKey((key) => key + 1)}
        title="Category is still loading"
        subtitle="We’re still fetching profiles for this Explore category. Retry to request a fresh feed."
      >
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : profiles.length > 0 ? (
          <DiscoverCardStack externalProfiles={profiles} hideHeader />
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyTitle}>
              {cat ? 'No profiles yet' : 'Category unavailable'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {cat
                ? 'No one matches this category right now. Check back later or explore other categories.'
                : 'This Explore category is no longer available.'}
            </Text>
            <TouchableOpacity
              style={styles.emptyBackButton}
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back" size={18} color={COLORS.white} />
              <Text style={styles.emptyBackText}>Back to Explore</Text>
            </TouchableOpacity>
          </View>
        )}
      </LoadingGuard>
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
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  emptyBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 24,
    gap: 8,
  },
  emptyBackText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
