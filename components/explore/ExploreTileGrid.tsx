import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExploreCategory } from './exploreCategories';

const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE_GAP = 10;
const TILE_W = (SCREEN_WIDTH - 32 - TILE_GAP) / 2;

/** Hand-picked IDs that appear in the tile grid, in display order. */
const CURATED_IDS = [
  // Availability — highest engagement
  "near_me",
  "online_now",
  "active_today",
  // Intent — most popular
  "long_term_partner",
  "short_term_fun",
  "new_friends",
  // Interest
  "coffee_date",
  "travel",
];

const TILE_OVERRIDES: Record<string, { color: string; bg: string; icon: string }> = {
  near_me:            { color: '#00BCD4', bg: '#E0F7FA', icon: 'location' },
  online_now:         { color: '#4CAF50', bg: '#E8F5E9', icon: 'radio-button-on' },
  active_today:       { color: '#FF9800', bg: '#FFF3E0', icon: 'time' },
  long_term_partner:  { color: '#E91E63', bg: '#FCE4EC', icon: 'heart' },
  short_term_fun:     { color: '#FF5722', bg: '#FBE9E7', icon: 'flash' },
  new_friends:        { color: '#9C27B0', bg: '#F3E5F5', icon: 'people' },
  coffee_date:        { color: '#795548', bg: '#EFEBE9', icon: 'cafe' },
  travel:             { color: '#2196F3', bg: '#E3F2FD', icon: 'airplane' },
};

const KIND_FALLBACK: Record<string, { color: string; bg: string; icon: string }> = {
  intent:       { color: '#E91E63', bg: '#FCE4EC', icon: 'heart' },
  availability: { color: '#FF9800', bg: '#FFF3E0', icon: 'time' },
  distance:     { color: '#00BCD4', bg: '#E0F7FA', icon: 'location' },
  interest:     { color: '#4CAF50', bg: '#E8F5E9', icon: 'sparkles' },
};

interface ExploreTileGridProps {
  categories: ExploreCategory[];
  onPressTile?: (category: ExploreCategory) => void;
}

export function ExploreTileGrid({ categories, onPressTile }: ExploreTileGridProps) {
  // Curated IDs first, then the rest — unique by construction.
  const tiles = useMemo(() => {
    const curated = CURATED_IDS
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean) as ExploreCategory[];
    const rest = categories.filter((c) => !CURATED_IDS.includes(c.id));
    return [...curated, ...rest];
  }, [categories]);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Browse Categories</Text>
      <View style={styles.grid}>
        {tiles.map((cat) => {
          const s = TILE_OVERRIDES[cat.id] ?? KIND_FALLBACK[cat.kind] ?? KIND_FALLBACK.interest;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[styles.tile, { backgroundColor: s.bg }]}
              activeOpacity={0.75}
              onPress={() => onPressTile?.(cat)}
            >
              <View style={[styles.iconCircle, { backgroundColor: s.color + '20' }]}>
                <Ionicons name={s.icon as any} size={22} color={s.color} />
              </View>
              <Text style={[styles.label, { color: s.color }]} numberOfLines={1}>
                {cat.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: TILE_GAP,
    rowGap: TILE_GAP,
  },
  tile: {
    width: TILE_W,
    height: 90,
    borderRadius: 16,
    padding: 14,
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
});
