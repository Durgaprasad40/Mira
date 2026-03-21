import React, { useMemo, memo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  Dimensions,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from 'expo-haptics';

import {
  RELATIONSHIP_CATEGORIES,
  RIGHT_NOW_CATEGORIES,
  INTEREST_CATEGORIES,
  ExploreCategory,
} from "./exploreCategories";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const TILE_GAP = 12;
const HORIZONTAL_PADDING = 16;
const TILE_WIDTH = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - TILE_GAP) / 2;

type Props = {
  onCategoryPress?: (category: ExploreCategory) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  // Backend counts from single-category system
  backendCounts?: Record<string, number> | null;
  // Phase 4: Intelligent sorting props
  categoryClickCounts?: Record<string, number>;
};

// Memoized tile component with smooth press animation
const ExploreTile = memo(function ExploreTile({
  category,
  count,
  onPress,
}: {
  category: ExploreCategory;
  count: number;
  onPress: () => void;
}) {
  // Animated scale for smooth press feedback (0.96 → 1)
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  // Generate gradient colors from the category color (always colorful)
  const baseColor = category.color;
  const darkerColor = adjustColorBrightness(baseColor, -30);
  const lighterColor = adjustColorBrightness(baseColor, 20);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          styles.tileWrapper,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        <LinearGradient
          colors={[lighterColor, baseColor, darkerColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.tile}
        >
          <View style={styles.tileContent}>
            <Text style={styles.tileIcon}>{category.icon}</Text>
            <Text
              style={styles.tileLabel}
              numberOfLines={2}
            >
              {category.label}
            </Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>
                {count}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
});

// Helper to adjust color brightness
function adjustColorBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
  return `#${((1 << 24) | (R << 16) | (G << 8) | B).toString(16).slice(1)}`;
}

// Base bottom padding + tab bar clearance
const BASE_BOTTOM_PADDING = 20;
const TAB_BAR_HEIGHT = 60;

export default function ExploreTileGrid({
  onCategoryPress,
  refreshing = false,
  onRefresh,
  backendCounts,
  categoryClickCounts = {},
}: Props) {
  const insets = useSafeAreaInsets();
  // Dynamic bottom spacing: safe area inset + tab bar + base padding
  const bottomSpacing = insets.bottom + TAB_BAR_HEIGHT + BASE_BOTTOM_PADDING;

  // Use backend counts or default to zeros (safer than misleading client-side counts)
  const categoryCounts = useMemo(() => {
    if (backendCounts) {
      return backendCounts;
    }
    // Return zeros when backend counts unavailable
    const counts: Record<string, number> = {};
    for (const cat of [...RELATIONSHIP_CATEGORIES, ...RIGHT_NOW_CATEGORIES, ...INTEREST_CATEGORIES]) {
      counts[cat.id] = 0;
    }
    return counts;
  }, [backendCounts]);


  // Phase 4: Intelligent sort - click frequency first, then by count
  const sortByIntelligence = (categories: ExploreCategory[]) => {
    return [...categories].sort((a, b) => {
      const countA = categoryCounts[a.id] ?? 0;
      const countB = categoryCounts[b.id] ?? 0;
      const clicksA = categoryClickCounts[a.id] ?? 0;
      const clicksB = categoryClickCounts[b.id] ?? 0;

      // Non-zero counts first
      if (countA > 0 && countB === 0) return -1;
      if (countA === 0 && countB > 0) return 1;

      // Then by click frequency (highest first)
      if (clicksA !== clicksB) return clicksB - clicksA;

      // Then by descending count
      return countB - countA;
    });
  };

  const renderTile = (category: ExploreCategory) => {
    const count = categoryCounts[category.id] ?? 0;

    return (
      <ExploreTile
        key={category.id}
        category={category}
        count={count}
        onPress={() => {
          // Always navigate - category detail handles empty state
          if (onCategoryPress) {
            onCategoryPress(category);
          }
        }}
      />
    );
  };

  // Pre-sort categories by intelligence (click frequency + count)
  const sortedRelationship = useMemo(() => sortByIntelligence(RELATIONSHIP_CATEGORIES), [categoryCounts, categoryClickCounts]);
  const sortedRightNow = useMemo(() => sortByIntelligence(RIGHT_NOW_CATEGORIES), [categoryCounts, categoryClickCounts]);
  const sortedInterests = useMemo(() => sortByIntelligence(INTEREST_CATEGORIES), [categoryCounts, categoryClickCounts]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FF6B6B"
            colors={["#FF6B6B"]}
          />
        ) : undefined
      }
    >
      {/* RELATIONSHIP Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEmoji}>💕</Text>
        <Text style={styles.sectionTitle}>Relationship</Text>
      </View>
      <View style={styles.grid}>
        {sortedRelationship.map(renderTile)}
      </View>

      {/* RIGHT NOW Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEmoji}>⚡</Text>
        <Text style={styles.sectionTitle}>Right Now</Text>
      </View>
      <View style={styles.grid}>
        {sortedRightNow.map(renderTile)}
      </View>

      {/* INTERESTS Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEmoji}>✨</Text>
        <Text style={styles.sectionTitle}>Interests</Text>
      </View>
      <View style={styles.grid}>
        {sortedInterests.map(renderTile)}
      </View>

      {/* Bottom spacing - dynamic based on safe area and tab bar */}
      <View style={{ height: bottomSpacing }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  content: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
    paddingLeft: 4,
  },
  sectionEmoji: {
    fontSize: 24,
    marginRight: 10,
  },
  sectionTitle: {
    color: "#1a1a1a",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: TILE_GAP,
  },
  tileWrapper: {
    width: TILE_WIDTH,
    borderRadius: 20,
    overflow: "hidden",
    // Shadow for iOS
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    // Elevation for Android
    elevation: 6,
  },
  tile: {
    height: 110,
    borderRadius: 20,
    padding: 14,
  },
  tileContent: {
    flex: 1,
    justifyContent: "space-between",
  },
  tileIcon: {
    fontSize: 28,
  },
  tileLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 18,
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  countBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  countText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
});
