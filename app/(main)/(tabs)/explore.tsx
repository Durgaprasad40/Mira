/*
 * EXPLORE TAB - Redesigned UI
 * Modern, visually rich explore experience
 */

import React, { useCallback, useState, useMemo, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  Dimensions,
  Animated,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { safePush } from "@/lib/safeRouter";
import { useScreenTrace } from "@/lib/devTrace";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

import { useExploreCategoryCounts } from "@/hooks/useExploreCategoryCounts";
import {
  ExploreCategory,
  EXPLORE_CATEGORIES,
  RELATIONSHIP_CATEGORIES,
  RIGHT_NOW_CATEGORIES,
  INTEREST_CATEGORIES,
} from "@/components/explore/exploreCategories";
import { useExplorePrefsStore } from "@/stores/explorePrefsStore";
import { COLORS } from "@/lib/constants";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRID_PADDING = 16;
const GRID_GAP = 14; // Slightly more breathing room
const TILE_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;
const TILE_HEIGHT = Math.round(TILE_WIDTH * 1.1); // Responsive height based on width
const TILE_BORDER_RADIUS = 20; // Consistent rounded corners

// Category filter tabs
const CATEGORY_FILTERS = [
  { id: "all", label: "All", icon: "apps" },
  { id: "relationship", label: "Relationship", icon: "heart" },
  { id: "rightnow", label: "Right Now", icon: "flash" },
  { id: "interests", label: "Interests", icon: "sparkles" },
];

// ══════════════════════════════════════════════════════════════════════════
// ANIMATED FILTER PILL - Category selection with smooth animations
// ══════════════════════════════════════════════════════════════════════════
interface FilterPillProps {
  filter: { id: string; label: string; icon: string };
  isSelected: boolean;
  onPress: () => void;
}

const AnimatedFilterPill = ({ filter, isSelected, onPress }: FilterPillProps) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const selectionAnim = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

  // Animate selection state changes smoothly
  useEffect(() => {
    Animated.timing(selectionAnim, {
      toValue: isSelected ? 1 : 0,
      duration: 150,
      useNativeDriver: false, // backgroundColor interpolation needs JS
    }).start();

    // Pop animation on selection (1 → 1.05 → 1)
    if (isSelected) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.05,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 70,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isSelected, scaleAnim, selectionAnim]);

  const handlePressIn = useCallback(() => {
    // Instant press feedback
    Animated.timing(scaleAnim, {
      toValue: 0.97,
      duration: 60,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    onPress();
  }, [onPress]);

  // Interpolate background color for smooth transition
  const backgroundColor = selectionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [COLORS.backgroundDark, COLORS.primary],
  });

  // Interpolate shadow opacity for selected state
  const shadowOpacity = selectionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.15],
  });

  return (
    <Animated.View
      style={[
        styles.filterPillWrapper,
        {
          transform: [{ scale: scaleAnim }],
          shadowOpacity,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.filterPill,
          { backgroundColor },
          isSelected && styles.filterPillSelectedBorder,
        ]}
      >
        <TouchableOpacity
          style={styles.filterPillTouchable}
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={1}
        >
          <Ionicons
            name={filter.icon as any}
            size={16}
            color={isSelected ? COLORS.white : COLORS.textLight}
            style={styles.filterPillIcon}
          />
          <Text style={[styles.filterPillText, isSelected && styles.filterPillTextSelected]}>
            {filter.label}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
};

// ══════════════════════════════════════════════════════════════════════════
// SKELETON LOADING CARD
// ══════════════════════════════════════════════════════════════════════════
const SkeletonTile = ({ index }: { index: number }) => {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.skeletonTile,
        { opacity: pulseAnim },
        index % 2 === 0 ? { marginRight: GRID_GAP / 2 } : { marginLeft: GRID_GAP / 2 },
      ]}
    >
      <View style={styles.skeletonIcon} />
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonBadge} />
    </Animated.View>
  );
};

// ══════════════════════════════════════════════════════════════════════════
// EXPLORE TILE - Premium grid item with gradient overlay
// ══════════════════════════════════════════════════════════════════════════
const ExploreTile = ({
  category,
  count,
  onPress,
  index,
}: {
  category: ExploreCategory;
  count: number;
  onPress: () => void;
  index: number;
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    // Premium feel: subtle scale with quick timing (not bouncy)
    Animated.timing(scaleAnim, {
      toValue: 0.97,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  // Generate rich gradient colors (3-stop for depth)
  const baseColor = category.color;
  const lighterColor = adjustColorBrightness(baseColor, 15);
  const darkerColor = adjustColorBrightness(baseColor, -35);

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.tileContainer,
        index % 2 === 0 ? { marginRight: GRID_GAP / 2 } : { marginLeft: GRID_GAP / 2 },
      ]}
    >
      <Animated.View style={[styles.tileWrapper, { transform: [{ scale: scaleAnim }] }]}>
        {/* Main gradient background */}
        <LinearGradient
          colors={[lighterColor, baseColor, darkerColor]}
          locations={[0, 0.4, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.tile}
        >
          {/* Refined bottom overlay for text readability (not too dark) */}
          <LinearGradient
            colors={["transparent", "transparent", COLORS.overlayDark]}
            locations={[0, 0.4, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.tileOverlay}
          />

          {/* Content */}
          <View style={styles.tileContent}>
            {/* Icon with subtle background */}
            <View style={styles.tileIconContainer}>
              <Text style={styles.tileIcon}>{category.icon}</Text>
            </View>

            {/* Count badge (top-right) */}
            {count > 0 && (
              <View style={styles.tileBadge}>
                <Text style={styles.tileBadgeText}>{count}</Text>
              </View>
            )}

            {/* Title at bottom with proper spacing */}
            <View style={styles.tileTitleContainer}>
              <Text style={styles.tileTitle} numberOfLines={2}>
                {category.label}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>
    </TouchableOpacity>
  );
};

// Helper to adjust color brightness
function adjustColorBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
  return `#${((1 << 24) | (R << 16) | (G << 8) | B).toString(16).slice(1)}`;
}

export default function ExploreScreen() {
  useScreenTrace("EXPLORE");
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // ScrollView ref for scroll-to-top
  const scrollViewRef = useRef<ScrollView>(null);

  // Backend counts for tile badges
  const backendCounts = useExploreCategoryCounts();

  // Explore preferences
  const trackCategoryClick = useExplorePrefsStore((s) => s.trackCategoryClick);
  const trackExploreExit = useExplorePrefsStore((s) => s.trackExploreExit);
  const shouldShowReturnHook = useExplorePrefsStore((s) => s.shouldShowReturnHook);
  const getReturnCategory = useExplorePrefsStore((s) => s.getReturnCategory);
  const markTriggerShown = useExplorePrefsStore((s) => s.markTriggerShown);

  // Return hook state
  const [showReturnHook, setShowReturnHook] = useState(false);
  const returnCategoryId = getReturnCategory();
  const returnCategory = useMemo(
    () => (returnCategoryId ? EXPLORE_CATEGORIES.find((c) => c.id === returnCategoryId) : null),
    [returnCategoryId]
  );

  // Filter categories by search query for each section
  const filterBySearch = useCallback((categories: ExploreCategory[]) => {
    if (!searchQuery.trim()) return categories;
    const query = searchQuery.toLowerCase().trim();
    return categories.filter(
      (c) =>
        c.label.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // Filtered section data
  const relationshipItems = useMemo(
    () => filterBySearch(RELATIONSHIP_CATEGORIES),
    [filterBySearch]
  );
  const rightNowItems = useMemo(
    () => filterBySearch(RIGHT_NOW_CATEGORIES),
    [filterBySearch]
  );
  const interestItems = useMemo(
    () => filterBySearch(INTEREST_CATEGORIES),
    [filterBySearch]
  );

  // Check if any items exist (for empty state)
  const hasAnyItems = relationshipItems.length > 0 || rightNowItems.length > 0 || interestItems.length > 0;

  // Category counts
  const categoryCounts = useMemo(() => {
    if (backendCounts) return backendCounts;
    const counts: Record<string, number> = {};
    for (const cat of EXPLORE_CATEGORIES) {
      counts[cat.id] = 0;
    }
    return counts;
  }, [backendCounts]);

  // Navigate to category detail
  const handleCategoryPress = useCallback(
    (category: ExploreCategory) => {
      trackCategoryClick(category.id);
      safePush(
        router,
        {
          pathname: "/explore-category/[categoryId]",
          params: { categoryId: category.id },
        },
        "explore->category"
      );
    },
    [router, trackCategoryClick]
  );

  // Handle return hook press
  const handleReturnHookPress = useCallback(() => {
    if (returnCategoryId) {
      setShowReturnHook(false);
      safePush(
        router,
        {
          pathname: "/explore-category/[categoryId]",
          params: { categoryId: returnCategoryId },
        },
        "explore->return-category"
      );
    }
  }, [returnCategoryId, router]);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      setRefreshKey((k) => k + 1);
      setIsLoading(true);

      // Simulate loading
      const timer = setTimeout(() => setIsLoading(false), 500);

      // Check for return hook
      if (shouldShowReturnHook() && returnCategory) {
        setShowReturnHook(true);
        markTriggerShown(`return-hook-${Date.now()}`);
      }

      return () => {
        clearTimeout(timer);
        trackExploreExit();
        setShowReturnHook(false);
      };
    }, [shouldShowReturnHook, returnCategory, markTriggerShown, trackExploreExit])
  );

  // Render a single tile
  const renderTile = useCallback(
    (item: ExploreCategory, index: number) => (
      <ExploreTile
        key={item.id}
        category={item}
        count={categoryCounts[item.id] ?? 0}
        onPress={() => handleCategoryPress(item)}
        index={index}
      />
    ),
    [categoryCounts, handleCategoryPress]
  );

  // Render a 2-column grid for a section
  const renderSectionGrid = useCallback(
    (items: ExploreCategory[]) => {
      const rows: React.ReactNode[] = [];
      for (let i = 0; i < items.length; i += 2) {
        const row = (
          <View key={`row-${i}`} style={styles.gridRow}>
            {renderTile(items[i], i)}
            {items[i + 1] && renderTile(items[i + 1], i + 1)}
          </View>
        );
        rows.push(row);
      }
      return rows;
    },
    [renderTile]
  );

  // Empty state
  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyEmoji}>👀</Text>
      <Text style={styles.emptyTitle}>Nothing here yet...</Text>
      <Text style={styles.emptySubtitle}>Explore something new</Text>
    </View>
  );

  // Loading skeletons
  const renderLoadingState = () => (
    <View style={styles.skeletonGrid}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <SkeletonTile key={i} index={i} />
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Explore</Text>
      </View>

      {/* Return Hook */}
      {showReturnHook && returnCategory && (
        <TouchableOpacity style={styles.returnHook} onPress={handleReturnHookPress}>
          <Text style={styles.returnHookIcon}>{returnCategory.icon}</Text>
          <View style={styles.returnHookTextContainer}>
            <Text style={styles.returnHookLabel}>Pick up where you left off</Text>
            <Text style={styles.returnHookCategory}>
              {returnCategory.title ?? returnCategory.label}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      )}

      {/* Main Section-Based Content */}
      {isLoading ? (
        renderLoadingState()
      ) : !hasAnyItems ? (
        renderEmptyState()
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ❤️ Relationship Section */}
          {relationshipItems.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionIcon}>❤️</Text>
                <Text style={styles.sectionTitle}>Relationship</Text>
              </View>
              <View style={styles.sectionGrid}>
                {renderSectionGrid(relationshipItems)}
              </View>
            </View>
          )}

          {/* ⚡ Right Now Section */}
          {rightNowItems.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionIcon}>⚡</Text>
                <Text style={styles.sectionTitle}>Right Now</Text>
              </View>
              <View style={styles.sectionGrid}>
                {renderSectionGrid(rightNowItems)}
              </View>
            </View>
          )}

          {/* 🎯 Interests Section */}
          {interestItems.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionIcon}>🎯</Text>
                <Text style={styles.sectionTitle}>Interests</Text>
              </View>
              <View style={styles.sectionGrid}>
                {renderSectionGrid(interestItems)}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Header
  header: {
    paddingHorizontal: GRID_PADDING,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.text,
    letterSpacing: -0.5,
  },

  // Search Bar
  searchContainer: {
    paddingHorizontal: GRID_PADDING,
    paddingBottom: 12,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    padding: 0,
  },

  // Filter Scroller
  filterScroller: {
    maxHeight: 48,
    marginBottom: 12,
  },
  filterScrollContent: {
    paddingHorizontal: GRID_PADDING,
    gap: 8,
    alignItems: "center",
  },
  // Wrapper for shadow and scale animation
  filterPillWrapper: {
    // iOS shadow for selected state (animated via shadowOpacity)
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    // Android elevation handled separately
    elevation: 0,
  },
  filterPill: {
    borderRadius: 20,
    overflow: "hidden",
  },
  filterPillSelectedBorder: {
    // Slight elevation on Android for selected state
    elevation: 3,
  },
  filterPillTouchable: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
  },
  filterPillIcon: {
    marginRight: 6,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textLight,
  },
  filterPillTextSelected: {
    color: COLORS.white,
    fontWeight: "700",
  },

  // Return Hook
  returnHook: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 107, 107, 0.08)",
    marginHorizontal: GRID_PADDING,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 107, 107, 0.15)",
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
    color: COLORS.textMuted,
  },
  returnHookCategory: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.text,
    marginTop: 2,
  },

  // ScrollView Layout
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: GRID_PADDING,
    paddingBottom: 100,
  },

  // Section Layout
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 8,
  },
  sectionIcon: {
    fontSize: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  sectionGrid: {
    // Container for the grid rows
  },

  // Grid Layout
  gridContent: {
    paddingHorizontal: GRID_PADDING,
    paddingBottom: 100,
  },
  gridRow: {
    flexDirection: "row",
    marginBottom: GRID_GAP,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TILE STYLES - Premium grid item design
  // ══════════════════════════════════════════════════════════════════════════
  tileContainer: {
    width: TILE_WIDTH,
  },
  tileWrapper: {
    borderRadius: TILE_BORDER_RADIUS,
    overflow: "hidden",
    // iOS shadow (subtle, consistent)
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    // Android elevation
    elevation: 5,
    // Ensure clipping respects border radius
    backgroundColor: COLORS.backgroundDark,
  },
  tile: {
    height: TILE_HEIGHT,
    borderRadius: TILE_BORDER_RADIUS,
  },
  tileOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: TILE_BORDER_RADIUS,
  },
  tileContent: {
    flex: 1,
    padding: 16,
    justifyContent: "space-between",
  },
  // Icon container with subtle frosted background
  tileIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.overlayLight,
    justifyContent: "center",
    alignItems: "center",
  },
  tileIcon: {
    fontSize: 26,
  },
  // Premium badge styling
  tileBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: COLORS.overlayMedium,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    minWidth: 28,
    alignItems: "center",
    // Subtle inner glow effect
    borderWidth: 1,
    borderColor: COLORS.overlaySubtle,
  },
  tileBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  // Title container with proper bottom spacing
  tileTitleContainer: {
    marginTop: "auto",
    paddingTop: 8,
  },
  tileTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    letterSpacing: 0.2,
    // Strong text shadow for readability
    textShadowColor: COLORS.overlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: "center",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SKELETON LOADING - Polished placeholder tiles
  // ══════════════════════════════════════════════════════════════════════════
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: GRID_PADDING,
    paddingTop: 8,
  },
  skeletonTile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: TILE_BORDER_RADIUS,
    padding: 16,
    marginBottom: GRID_GAP,
    justifyContent: "space-between",
    // Match real tile shadow (lighter for skeleton)
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  skeletonIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.border,
  },
  skeletonTitle: {
    width: "65%",
    height: 18,
    borderRadius: 6,
    backgroundColor: COLORS.border,
    marginTop: "auto",
  },
  skeletonBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 36,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.border,
  },
});
