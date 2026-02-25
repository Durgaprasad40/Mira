import React, { useMemo, memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import {
  RELATIONSHIP_CATEGORIES,
  RIGHT_NOW_CATEGORIES,
  INTEREST_CATEGORIES,
  countProfilesPerCategory,
  ExploreCategory,
} from "./exploreCategories";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const TILE_GAP = 12;
const HORIZONTAL_PADDING = 16;
const TILE_WIDTH = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - TILE_GAP) / 2;

type Props = {
  profiles: any[];
  selectedCategory?: ExploreCategory | null;
  onCategoryPress?: (category: ExploreCategory) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
};

// Memoized tile component for performance
const ExploreTile = memo(function ExploreTile({
  category,
  count,
  isSelected,
  onPress,
}: {
  category: ExploreCategory;
  count: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  const isDisabled = count === 0;

  // Generate gradient colors from the category color
  const baseColor = category.color;
  const darkerColor = adjustColorBrightness(baseColor, -30);
  const lighterColor = adjustColorBrightness(baseColor, 20);

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tileWrapper,
        isSelected && styles.tileSelected,
        pressed && !isDisabled && styles.tilePressed,
      ]}
    >
      <LinearGradient
        colors={isDisabled ? ["#2a2a2a", "#1a1a1a"] : [lighterColor, baseColor, darkerColor]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.tile,
          isDisabled && styles.tileDisabled,
        ]}
      >
        <View style={styles.tileContent}>
          <Text style={styles.tileIcon}>{category.icon}</Text>
          <Text
            style={[styles.tileLabel, isDisabled && styles.tileLabelDisabled]}
            numberOfLines={2}
          >
            {category.label}
          </Text>
          <View style={[styles.countBadge, isDisabled && styles.countBadgeDisabled]}>
            <Text style={[styles.countText, isDisabled && styles.countTextDisabled]}>
              {count}
            </Text>
          </View>
        </View>
      </LinearGradient>
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

export default function ExploreTileGrid({
  profiles,
  selectedCategory,
  onCategoryPress,
  refreshing = false,
  onRefresh,
}: Props) {
  // Compute counts for all categories
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of [...RELATIONSHIP_CATEGORIES, ...RIGHT_NOW_CATEGORIES, ...INTEREST_CATEGORIES]) {
      counts[cat.id] = countProfilesPerCategory(cat, profiles);
    }
    return counts;
  }, [profiles]);

  const renderTile = (category: ExploreCategory) => {
    const count = categoryCounts[category.id] ?? 0;
    const isSelected = selectedCategory?.id === category.id;

    return (
      <ExploreTile
        key={category.id}
        category={category}
        count={count}
        isSelected={isSelected}
        onPress={() => {
          if (count > 0 && onCategoryPress) {
            onCategoryPress(category);
          }
        }}
      />
    );
  };

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
        {RELATIONSHIP_CATEGORIES.map(renderTile)}
      </View>

      {/* RIGHT NOW Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEmoji}>⚡</Text>
        <Text style={styles.sectionTitle}>Right Now</Text>
      </View>
      <View style={styles.grid}>
        {RIGHT_NOW_CATEGORIES.map(renderTile)}
      </View>

      {/* INTERESTS Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEmoji}>✨</Text>
        <Text style={styles.sectionTitle}>Interests</Text>
      </View>
      <View style={styles.grid}>
        {INTEREST_CATEGORIES.map(renderTile)}
      </View>

      {/* Bottom spacing */}
      <View style={styles.bottomSpacer} />
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
  tileSelected: {
    borderWidth: 3,
    borderColor: "#fff",
  },
  tilePressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.9,
  },
  tile: {
    height: 110,
    borderRadius: 20,
    padding: 14,
  },
  tileDisabled: {
    opacity: 0.5,
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
  tileLabelDisabled: {
    color: "#666",
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
  countBadgeDisabled: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  countText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  countTextDisabled: {
    color: "#555",
  },
  bottomSpacer: {
    height: 100,
  },
});
