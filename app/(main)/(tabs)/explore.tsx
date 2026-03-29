/*
 * EXPLORE TAB - Redesigned UI
 * Modern, visually rich explore experience
 */

import { useCallback, useState, useMemo, useRef, useEffect } from "react";
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
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

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

  // Filter categories based on selected filter and search
  const filteredCategories = useMemo(() => {
    let categories: ExploreCategory[] = [];

    switch (selectedFilter) {
      case "relationship":
        categories = RELATIONSHIP_CATEGORIES;
        break;
      case "rightnow":
        categories = RIGHT_NOW_CATEGORIES;
        break;
      case "interests":
        categories = INTEREST_CATEGORIES;
        break;
      default:
        categories = EXPLORE_CATEGORIES;
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      categories = categories.filter(
        (c) =>
          c.label.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query)
      );
    }

    return categories;
  }, [selectedFilter, searchQuery]);

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

  // Render grid item
  const renderGridItem = useCallback(
    ({ item, index }: { item: ExploreCategory; index: number }) => (
      <ExploreTile
        category={item}
        count={categoryCounts[item.id] ?? 0}
        onPress={() => handleCategoryPress(item)}
        index={index}
      />
    ),
    [categoryCounts, handleCategoryPress]
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

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search interests, people, or topics"
            placeholderTextColor={COLORS.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category Filter Scroller */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScrollContent}
        style={styles.filterScroller}
      >
        {CATEGORY_FILTERS.map((filter) => {
          const isSelected = selectedFilter === filter.id;
          return (
            <TouchableOpacity
              key={filter.id}
              style={[styles.filterPill, isSelected && styles.filterPillSelected]}
              onPress={() => setSelectedFilter(filter.id)}
              activeOpacity={0.7}
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
          );
        })}
      </ScrollView>

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

      {/* Main Grid Content */}
      {isLoading ? (
        renderLoadingState()
      ) : filteredCategories.length === 0 ? (
        renderEmptyState()
      ) : (
        <FlatList
          data={filteredCategories}
          keyExtractor={(item) => item.id}
          renderItem={renderGridItem}
          numColumns={2}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          columnWrapperStyle={styles.gridRow}
          // Performance optimizations
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
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
    maxHeight: 44,
    marginBottom: 12,
  },
  filterScrollContent: {
    paddingHorizontal: GRID_PADDING,
    gap: 8,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.backgroundDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
  },
  filterPillSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
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

  // Grid Layout
  gridContent: {
    paddingHorizontal: GRID_PADDING,
    paddingBottom: 100,
  },
  gridRow: {
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
