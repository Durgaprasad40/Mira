import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { useFilterStore } from '@/stores/filterStore';
import { COLORS } from '@/lib/constants';
import { FilterChips } from '@/components/filters/FilterChips';
import { FilterPresets } from '@/components/filters/FilterPresets';
import { SmartSuggestions } from '@/components/explore/SmartSuggestions';
import { AdvancedSearchModal } from '@/components/filters/AdvancedSearchModal';
import { ProfileCard } from '@/components/cards';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui';

export default function ExploreScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  const {
    relationshipIntent,
    activities,
    minAge,
    maxAge,
    maxDistance,
    toggleRelationshipIntent,
    toggleActivity,
    clearIntentFilters,
    clearActivityFilters,
  } = useFilterStore();

  const filterCounts = useQuery(
    api.discover.getFilterCounts,
    userId ? { userId: userId as any } : 'skip'
  );

  const smartSuggestions = useQuery(
    api.smartSuggestions.getSmartSuggestions,
    userId ? { userId: userId as any } : 'skip'
  );

  const exploreProfiles = useQuery(
    api.discover.getExploreProfiles,
    userId
      ? {
          userId: userId as any,
          relationshipIntent: relationshipIntent.length > 0 ? relationshipIntent : undefined,
          activities: activities.length > 0 ? activities : undefined,
          minAge,
          maxAge,
          maxDistance,
        }
      : 'skip'
  );

  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const hasActiveFilters = relationshipIntent.length > 0 || activities.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Explore</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowPresets(true)}
          >
            <Ionicons name="bookmark-outline" size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowAdvancedSearch(true)}
          >
            <Ionicons name="search" size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowFilters(!showFilters)}
          >
            <Ionicons
              name={showFilters ? 'close' : 'options'}
              size={24}
              color={showFilters ? COLORS.text : COLORS.primary}
            />
            {hasActiveFilters && !showFilters && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>
                  {relationshipIntent.length + activities.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Smart Suggestions */}
      {!hasActiveFilters && smartSuggestions && smartSuggestions.length > 0 && (
        <SmartSuggestions
          suggestions={smartSuggestions}
          onSelect={(suggestion) => {
            // Apply suggestion filters
            if (suggestion.filters.relationshipIntents) {
              suggestion.filters.relationshipIntents.forEach((intent) => {
                toggleRelationshipIntent(intent as any);
              });
            }
            if (suggestion.filters.activities) {
              suggestion.filters.activities.forEach((activity) => {
                toggleActivity(activity as any);
              });
            }
          }}
        />
      )}

      {showFilters && (
        <View style={styles.filtersPanel}>
          <FilterChips
            relationshipIntents={relationshipIntent}
            activities={activities}
            onToggleIntent={toggleRelationshipIntent}
            onToggleActivity={toggleActivity}
            intentCounts={filterCounts?.intentCounts}
            activityCounts={filterCounts?.activityCounts}
          />
          <View style={styles.filterActions}>
            <Button
              title="Clear Filters"
              variant="outline"
              onPress={() => {
                clearIntentFilters();
                clearActivityFilters();
              }}
              style={styles.clearButton}
            />
          </View>
        </View>
      )}

      {exploreProfiles && (
        <View style={styles.resultsHeader}>
          <Text style={styles.resultsText}>
            {exploreProfiles.totalCount} {exploreProfiles.totalCount === 1 ? 'profile' : 'profiles'} found
          </Text>
        </View>
      )}

      <FlatList
        data={exploreProfiles?.profiles || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ProfileCard
            user={item}
            photos={item.photos}
            distance={item.distance}
            onPress={() => router.push(`/(main)/profile/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No profiles found</Text>
            <Text style={styles.emptySubtitle}>
              Try adjusting your filters to see more profiles
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={
          (!exploreProfiles?.profiles || exploreProfiles.profiles.length === 0) &&
          styles.emptyListContainer
        }
        numColumns={2}
        columnWrapperStyle={styles.row}
      />

      <AdvancedSearchModal
        visible={showAdvancedSearch}
        onClose={() => setShowAdvancedSearch(false)}
        onApply={(filters) => {
          // Apply advanced filters
          console.log('Applied filters:', filters);
          setShowAdvancedSearch(false);
        }}
      />

      <FilterPresets
        visible={showPresets}
        onClose={() => setShowPresets(false)}
        onLoadPreset={(filters) => {
          // Load preset filters
          console.log('Loading preset:', filters);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  filterButton: {
    position: 'relative',
    padding: 8,
  },
  filterBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  filterBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  filtersPanel: {
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    maxHeight: 400,
  },
  filterActions: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  clearButton: {
    minWidth: 120,
  },
  resultsHeader: {
    padding: 16,
    paddingBottom: 8,
  },
  resultsText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  row: {
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyListContainer: {
    flexGrow: 1,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
});
