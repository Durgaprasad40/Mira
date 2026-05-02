/*
 * LOCKED (EXPLORE TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * Redesigned UI - Modern, visually rich explore experience
 */

import React, { useCallback, useState, useMemo, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  ActivityIndicator,
  useWindowDimensions,
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
} from "@/components/explore/exploreCategories";
import { useExplorePrefsStore } from "@/stores/explorePrefsStore";
import { COLORS, FONT_SIZE, SPACING, SIZES, lineHeight, moderateScale } from "@/lib/constants";

const GRID_PADDING = SPACING.base;
const GRID_GAP = SPACING.md;
const TILE_BORDER_RADIUS = SIZES.radius.lg;
const TILE_MAX_WIDTH = moderateScale(280, 0.25);
const TEXT_MAX_SCALE = 1.2;
const TEXT_PROPS = { maxFontSizeMultiplier: TEXT_MAX_SCALE } as const;
const HEADER_ACTION_SIZE = moderateScale(36, 0.25);
const EMPTY_STATE_ICON_SIZE = moderateScale(48, 0.3);
const TILE_BADGE_HORIZONTAL_PADDING = moderateScale(10, 0.25);
const TILE_BADGE_VERTICAL_PADDING = moderateScale(5, 0.25);
const TILE_BADGE_MIN_WIDTH = moderateScale(28, 0.25);
const TILE_STATUS_BADGE_MAX_WIDTH = moderateScale(110, 0.25);
const TILE_TITLE_SIZE = moderateScale(15, 0.4);
const RETURN_HOOK_CATEGORY_SIZE = moderateScale(15, 0.4);
const RETRY_BUTTON_TEXT_SIZE = moderateScale(15, 0.4);
const SKELETON_TITLE_HEIGHT = moderateScale(18, 0.25);
const SKELETON_BADGE_WIDTH = moderateScale(36, 0.25);
const SKELETON_BADGE_HEIGHT = moderateScale(24, 0.25);

// ══════════════════════════════════════════════════════════════════════════
// SKELETON LOADING CARD
// ══════════════════════════════════════════════════════════════════════════
const SkeletonTile = ({
  tileWidth,
  tileHeight,
  isLastInRow,
}: {
  tileWidth: number;
  tileHeight: number;
  isLastInRow: boolean;
}) => {
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
        {
          opacity: pulseAnim,
          width: tileWidth,
          height: tileHeight,
          marginRight: isLastInRow ? 0 : GRID_GAP,
        },
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
// Memoized to prevent unnecessary re-renders when parent state changes
// ══════════════════════════════════════════════════════════════════════════
const ExploreTile = React.memo(function ExploreTile({
  category,
  count,
  onPress,
  tileWidth,
  tileHeight,
  isLastInRow,
  disabled = false,
  statusLabel,
}: {
  category: ExploreCategory;
  count: number;
  onPress: () => void;
  tileWidth: number;
  tileHeight: number;
  isLastInRow: boolean;
  disabled?: boolean;
  statusLabel?: string;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (disabled) return;
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
    if (disabled) return;
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
      onPress={disabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[
        styles.tileContainer,
        {
          width: tileWidth,
          marginRight: isLastInRow ? 0 : GRID_GAP,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.tileWrapper,
          disabled && styles.tileWrapperDisabled,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        {/* Main gradient background */}
        <LinearGradient
          colors={[lighterColor, baseColor, darkerColor]}
          locations={[0, 0.4, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.tile, { height: tileHeight }]}
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
              <Text {...TEXT_PROPS} style={styles.tileIcon}>
                {category.icon}
              </Text>
            </View>

            {/* Count badge (top-right) */}
            {statusLabel ? (
              <View style={[styles.tileBadge, styles.tileStatusBadge]}>
                <Text
                  {...TEXT_PROPS}
                  style={[styles.tileBadgeText, styles.tileStatusBadgeText]}
                >
                  {statusLabel}
                </Text>
              </View>
            ) : typeof count === "number" && count > 0 ? (
              <View style={styles.tileBadge}>
                <Text {...TEXT_PROPS} style={styles.tileBadgeText}>
                  {count}
                </Text>
              </View>
            ) : null
            }

            {/* Title at bottom with proper spacing */}
            <View style={styles.tileTitleContainer}>
              <Text {...TEXT_PROPS} style={styles.tileTitle} numberOfLines={2}>
                {category.label}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>
    </TouchableOpacity>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if visual content changes
  // Ignore onPress reference changes (closure is stable via handleCategoryPress)
  // Category uses reference equality (objects from static arrays are stable)
  return (
    prev.category === next.category &&
    prev.count === next.count &&
    prev.disabled === next.disabled &&
    prev.tileWidth === next.tileWidth &&
    prev.tileHeight === next.tileHeight &&
    prev.isLastInRow === next.isLastInRow &&
    prev.statusLabel === next.statusLabel
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

export default function ExploreScreen() {
  useScreenTrace("EXPLORE");
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const [refreshKey, setRefreshKey] = useState(0);
  const hasFocusedOnceRef = useRef(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // INSTANT RENDER FIX: Track data state for shell UI pattern
  // ═══════════════════════════════════════════════════════════════════════════
  // Track if we've ever loaded data successfully (for showing shell vs skeleton)
  const hasLoadedDataOnceRef = useRef(false);
  // Track last fetch timestamp for staleness check (prevents unnecessary refetch)
  const lastFetchTimestampRef = useRef<number>(0);
  // Staleness threshold: only refetch if data is older than 30 seconds
  const STALE_THRESHOLD_MS = 30000;

  // ScrollView ref for scroll-to-top
  const scrollViewRef = useRef<ScrollView>(null);

  // Backend counts for tile badges
  const {
    data: backendCounts,
    status: countsStatus,
    nearbyStatus,
    isLoading,
    isError,
    error,
  } = useExploreCategoryCounts(refreshKey);
  const nearbyUnavailable = nearbyStatus !== "ok";
  const nearbyStatusLabel = nearbyStatus === "verification_required" ? "Verify first" : "Enable location";

  // ═══════════════════════════════════════════════════════════════════════════
  // INSTANT RENDER FIX: Mark data as loaded once we have it
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (backendCounts && countsStatus === "ok" && !isLoading && !isError) {
      hasLoadedDataOnceRef.current = true;
      lastFetchTimestampRef.current = Date.now();
    }
  }, [backendCounts, countsStatus, isLoading, isError]);

  // Determine if this is true first load (no data ever loaded)
  // After first successful load, we show content immediately (shell UI pattern)
  const isFirstLoad = !hasLoadedDataOnceRef.current && isLoading;

  // Explore preferences
  const trackCategoryClick = useExplorePrefsStore((s) => s.trackCategoryClick);
  const trackExploreExit = useExplorePrefsStore((s) => s.trackExploreExit);
  const shouldShowReturnHook = useExplorePrefsStore((s) => s.shouldShowReturnHook);
  const getReturnCategory = useExplorePrefsStore((s) => s.getReturnCategory);
  const markTriggerShown = useExplorePrefsStore((s) => s.markTriggerShown);
  const lastExploreExitTimestamp = useExplorePrefsStore((s) => s.lastExploreExitTimestamp);

  // Return hook state
  const [showReturnHook, setShowReturnHook] = useState(false);
  const returnCategoryId = getReturnCategory();
  const returnCategory = useMemo(
    () => (returnCategoryId ? EXPLORE_CATEGORIES.find((c) => c.id === returnCategoryId) : null),
    [returnCategoryId]
  );

  // Section data (static category arrays)
  const relationshipItems = RELATIONSHIP_CATEGORIES;
  const rightNowItems = RIGHT_NOW_CATEGORIES;
  const columnCount = windowWidth >= 1080 ? 4 : windowWidth >= 760 ? 3 : windowWidth >= 320 ? 2 : 1;
  const tileWidth = useMemo(() => {
    const availableWidth = Math.max(windowWidth - GRID_PADDING * 2 - GRID_GAP * (columnCount - 1), 0);
    const computedWidth = Math.floor(availableWidth / columnCount);
    if (windowWidth >= 760) {
      return Math.min(computedWidth, TILE_MAX_WIDTH);
    }
    return computedWidth;
  }, [columnCount, windowWidth]);
  const tileHeight = useMemo(
    () => Math.max(168, Math.round(tileWidth * (columnCount >= 3 ? 1.02 : 1.1))),
    [columnCount, tileWidth]
  );
  const sectionGridWidth = useMemo(
    () => tileWidth * columnCount + GRID_GAP * (columnCount - 1),
    [columnCount, tileWidth]
  );
  const sectionGridStyle = useMemo(
    () => ({ width: sectionGridWidth, alignSelf: "center" as const }),
    [sectionGridWidth]
  );

  // Check if any items exist (for empty state)
  const hasAnyItems = relationshipItems.length > 0 || rightNowItems.length > 0;

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of EXPLORE_CATEGORIES) {
      counts[cat.id] = 0;
    }

    if (!backendCounts) return counts;

    for (const [categoryId, count] of Object.entries(backendCounts)) {
      counts[categoryId] = count;
    }

    return counts;
  }, [backendCounts]);

  // Navigate to category detail
  const handleCategoryPress = useCallback(
    (category: ExploreCategory) => {
      if (category.id === "nearby" && nearbyUnavailable) {
        return;
      }
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
    [nearbyUnavailable, router, trackCategoryClick]
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

  const handleRefresh = useCallback(() => {
    try {
      Haptics.selectionAsync();
    } catch {}

    scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: true });
    lastFetchTimestampRef.current = 0;
    setRefreshKey((k) => k + 1);
  }, []);

  // Refresh on focus (with staleness check to prevent unnecessary refetch)
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const timeSinceLastFetch = now - lastFetchTimestampRef.current;
      const isStale = timeSinceLastFetch > STALE_THRESHOLD_MS;

      if (hasFocusedOnceRef.current) {
        // Only refresh if data is stale (>30 seconds old)
        // This prevents the delay on quick tab switches
        if (isStale) {
          setRefreshKey((k) => k + 1);
        }
      } else {
        hasFocusedOnceRef.current = true;
      }

      // Check for return hook
      if (shouldShowReturnHook() && returnCategory && lastExploreExitTimestamp) {
        setShowReturnHook(true);
        markTriggerShown(`return-hook-${lastExploreExitTimestamp}`);
      }

      return () => {
        trackExploreExit();
        setShowReturnHook(false);
      };
    }, [lastExploreExitTimestamp, shouldShowReturnHook, returnCategory, markTriggerShown, trackExploreExit])
  );

  // Render a single tile
  const renderTile = useCallback(
    (item: ExploreCategory, isLastInRow: boolean) => (
      <ExploreTile
        key={item.id}
        category={item}
        count={categoryCounts[item.id] ?? 0}
        onPress={() => handleCategoryPress(item)}
        tileWidth={tileWidth}
        tileHeight={tileHeight}
        isLastInRow={isLastInRow}
        disabled={item.id === "nearby" && nearbyUnavailable}
        statusLabel={item.id === "nearby" && nearbyUnavailable ? nearbyStatusLabel : undefined}
      />
    ),
    [categoryCounts, handleCategoryPress, nearbyStatusLabel, nearbyUnavailable, tileHeight, tileWidth]
  );

  // Render a 2-column grid for a section
  const renderSectionGrid = useCallback(
    (items: ExploreCategory[]) => {
      const rows: React.ReactNode[] = [];
      for (let i = 0; i < items.length; i += columnCount) {
        const rowItems = items.slice(i, i + columnCount);
        const row = (
          <View key={`row-${i}`} style={styles.gridRow}>
            {rowItems.map((item, rowIndex) => renderTile(item, rowIndex === rowItems.length - 1))}
          </View>
        );
        rows.push(row);
      }
      return rows;
    },
    [columnCount, renderTile]
  );

  // Empty state
  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="sparkles-outline" size={EMPTY_STATE_ICON_SIZE} color={COLORS.textLight} />
      <Text {...TEXT_PROPS} style={styles.emptyTitle}>
        Explore is getting ready
      </Text>
      <Text {...TEXT_PROPS} style={styles.emptySubtitle}>
        We&apos;re preparing the next set of Explore categories. Check back in a bit.
      </Text>
    </View>
  );

  const renderZeroProfilesState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="people-outline" size={EMPTY_STATE_ICON_SIZE} color={COLORS.textLight} />
      <Text {...TEXT_PROPS} style={styles.emptyTitle}>
        No new people right now
      </Text>
      <Text {...TEXT_PROPS} style={styles.emptySubtitle}>
        {nearbyUnavailable
          ? "Fresh Explore profiles are quiet right now. Enable location for Nearby and check back soon."
          : "Fresh Explore profiles are quiet right now. Check back soon for new people."}
      </Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
        <Text {...TEXT_PROPS} style={styles.retryButtonText}>
          Refresh Explore
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Loading skeletons
  const renderLoadingState = () => (
    <View style={styles.loadingContainer}>
      <View style={styles.loadingCopyContainer}>
        <Text {...TEXT_PROPS} style={styles.emptyTitle}>
          Refreshing Explore
        </Text>
        <Text {...TEXT_PROPS} style={styles.emptySubtitle}>
          Pulling in fresh people, nearby energy, and the latest category counts.
        </Text>
      </View>
      <View style={[styles.skeletonGrid, sectionGridStyle]}>
        {Array.from({ length: columnCount * 2 }).map((_, i) => (
          <SkeletonTile
            key={i}
            tileWidth={tileWidth}
            tileHeight={tileHeight}
            isLastInRow={(i + 1) % columnCount === 0}
          />
        ))}
      </View>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="alert-circle-outline" size={EMPTY_STATE_ICON_SIZE} color={COLORS.textLight} />
      <Text {...TEXT_PROPS} style={styles.emptyTitle}>
        Couldn&apos;t refresh Explore
      </Text>
      <Text {...TEXT_PROPS} style={styles.emptySubtitle}>
        {error ?? 'We hit a snag while refreshing Explore. Try again in a moment.'}
      </Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
        <Text {...TEXT_PROPS} style={styles.retryButtonText}>
          Refresh Explore
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderUnavailableState = (title: string, subtitle: string, iconName: React.ComponentProps<typeof Ionicons>["name"]) => (
    <View style={styles.emptyContainer}>
      <Ionicons name={iconName} size={EMPTY_STATE_ICON_SIZE} color={COLORS.textLight} />
      <Text {...TEXT_PROPS} style={styles.emptyTitle}>
        {title}
      </Text>
      <Text {...TEXT_PROPS} style={styles.emptySubtitle}>
        {subtitle}
      </Text>
      {countsStatus === "viewer_missing" && (
        <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
          <Text {...TEXT_PROPS} style={styles.retryButtonText}>
            Try again
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Header - Always renders immediately (shell UI pattern) */}
      <View style={styles.header}>
        <Text {...TEXT_PROPS} style={styles.headerTitle}>
          Explore
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Refresh Explore"
          onPress={handleRefresh}
          hitSlop={8}
          style={styles.headerActionButton}
        >
          {isLoading && hasLoadedDataOnceRef.current ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons name="refresh" size={SIZES.icon.md} color={COLORS.text} />
          )}
        </TouchableOpacity>
      </View>

      {/* Return Hook */}
      {showReturnHook && returnCategory && (
        <TouchableOpacity style={styles.returnHook} onPress={handleReturnHookPress}>
          <Text {...TEXT_PROPS} style={styles.returnHookIcon}>
            {returnCategory.icon}
          </Text>
          <View style={styles.returnHookTextContainer}>
            <Text {...TEXT_PROPS} style={styles.returnHookLabel}>
              Pick up where you left off
            </Text>
            <Text {...TEXT_PROPS} style={styles.returnHookCategory}>
              {returnCategory.title ?? returnCategory.label}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={SIZES.icon.md} color={COLORS.primary} />
        </TouchableOpacity>
      )}

      {/* Main Section-Based Content */}
      {/* INSTANT RENDER FIX: Only show skeleton on true first load (no data ever loaded)
          After first successful load, show content immediately during background refresh */}
      {isFirstLoad ? (
        renderLoadingState()
      ) : countsStatus === "viewer_missing" ? (
        renderUnavailableState(
          "Explore is unavailable",
          "We couldn't load your Explore profile right now.",
          "person-circle-outline"
        )
      ) : countsStatus === "discovery_paused" ? (
        renderUnavailableState(
          "Discover is paused",
          "Unpause discovery to browse Explore categories again.",
          "pause-circle-outline"
        )
      ) : isError && !hasLoadedDataOnceRef.current ? (
        // Only show error state if we've never loaded data
        // If we have stale data, keep showing it
        renderErrorState()
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
                <Text {...TEXT_PROPS} style={styles.sectionIcon}>
                  ❤️
                </Text>
                <Text {...TEXT_PROPS} style={styles.sectionTitle}>
                  Relationship
                </Text>
              </View>
              <View style={[styles.sectionGrid, sectionGridStyle]}>
                {renderSectionGrid(relationshipItems)}
              </View>
            </View>
          )}

          {/* ⚡ Right Now Section */}
          {rightNowItems.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text {...TEXT_PROPS} style={styles.sectionIcon}>
                  ⚡
                </Text>
                <Text {...TEXT_PROPS} style={styles.sectionTitle}>
                  Right Now
                </Text>
              </View>
              {nearbyUnavailable && (
                <Text {...TEXT_PROPS} style={styles.sectionHelperText}>
                  {nearbyStatus === "verification_required"
                    ? "Verify your profile to use Nearby."
                    : "Enable location access for Mira to use Nearby."}
                </Text>
              )}
              <View style={[styles.sectionGrid, sectionGridStyle]}>
                {renderSectionGrid(rightNowItems)}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: GRID_PADDING,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  headerTitle: {
    fontSize: FONT_SIZE.h2,
    fontWeight: "700",
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.h2, 1.2),
    letterSpacing: -0.5,
  },
  headerActionButton: {
    width: HEADER_ACTION_SIZE,
    height: HEADER_ACTION_SIZE,
    borderRadius: SIZES.radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.card,
  },

  // Return Hook
  returnHook: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 107, 107, 0.08)",
    marginHorizontal: GRID_PADDING,
    marginBottom: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: SIZES.radius.md,
    borderWidth: 1,
    borderColor: "rgba(255, 107, 107, 0.15)",
  },
  returnHookIcon: {
    fontSize: FONT_SIZE.title,
    marginRight: SPACING.md,
  },
  returnHookTextContainer: {
    flex: 1,
  },
  returnHookLabel: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
  },
  returnHookCategory: {
    fontSize: RETURN_HOOK_CATEGORY_SIZE,
    fontWeight: "600",
    color: COLORS.text,
    lineHeight: lineHeight(RETURN_HOOK_CATEGORY_SIZE, 1.2),
    marginTop: SPACING.xxs,
  },

  // ScrollView Layout
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: GRID_PADDING,
    paddingBottom: SPACING.xxxl * 2,
  },

  // Section Layout
  section: {
    marginTop: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  sectionIcon: {
    fontSize: FONT_SIZE.xxl,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: "700",
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.xxl, 1.2),
    letterSpacing: -0.3,
  },
  sectionHelperText: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textMuted,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    marginBottom: SPACING.sm,
  },
  sectionGrid: {
    alignSelf: "center",
  },

  // Grid Layout
  gridRow: {
    flexDirection: "row",
    marginBottom: GRID_GAP,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TILE STYLES - Premium grid item design
  // ══════════════════════════════════════════════════════════════════════════
  tileContainer: {
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
  tileWrapperDisabled: {
    opacity: 0.7,
  },
  tile: {
    borderRadius: TILE_BORDER_RADIUS,
  },
  tileOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: TILE_BORDER_RADIUS,
  },
  tileContent: {
    flex: 1,
    padding: SPACING.base,
    justifyContent: "space-between",
  },
  // Icon container with subtle frosted background
  tileIconContainer: {
    width: SIZES.button.md,
    height: SIZES.button.md,
    borderRadius: SIZES.radius.md,
    backgroundColor: COLORS.overlayLight,
    justifyContent: "center",
    alignItems: "center",
  },
  tileIcon: {
    fontSize: SIZES.icon.lg,
  },
  // Premium badge styling
  tileBadge: {
    position: "absolute",
    top: SPACING.base,
    right: SPACING.base,
    backgroundColor: COLORS.overlayMedium,
    paddingHorizontal: TILE_BADGE_HORIZONTAL_PADDING,
    paddingVertical: TILE_BADGE_VERTICAL_PADDING,
    borderRadius: SIZES.radius.md,
    minWidth: TILE_BADGE_MIN_WIDTH,
    alignItems: "center",
    // Subtle inner glow effect
    borderWidth: 1,
    borderColor: COLORS.overlaySubtle,
  },
  tileStatusBadge: {
    maxWidth: TILE_STATUS_BADGE_MAX_WIDTH,
    paddingHorizontal: SPACING.sm,
  },
  tileBadgeText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.caption,
    fontWeight: "700",
    lineHeight: lineHeight(FONT_SIZE.caption, 1.2),
    letterSpacing: 0.3,
  },
  tileStatusBadgeText: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
    letterSpacing: 0,
  },
  // Title container with proper bottom spacing
  tileTitleContainer: {
    marginTop: "auto",
    paddingTop: SPACING.sm,
  },
  tileTitle: {
    color: COLORS.white,
    fontSize: TILE_TITLE_SIZE,
    fontWeight: "700",
    lineHeight: lineHeight(TILE_TITLE_SIZE, 1.2),
    letterSpacing: 0.2,
    // Strong text shadow for readability
    textShadowColor: COLORS.overlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  loadingContainer: {
    flex: 1,
    paddingTop: SPACING.sm,
  },
  loadingCopyContainer: {
    paddingHorizontal: GRID_PADDING,
    paddingBottom: SPACING.lg,
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xxl,
    paddingTop: SPACING.xxxl,
  },
  emptyEmoji: {
    fontSize: FONT_SIZE.h1,
    marginBottom: SPACING.base,
  },
  emptyTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: "600",
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
    marginBottom: SPACING.sm,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textMuted,
    textAlign: "center",
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
  },
  retryButton: {
    marginTop: SPACING.base,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm + SPACING.xs,
    borderRadius: SIZES.radius.md,
    backgroundColor: COLORS.primary,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: RETRY_BUTTON_TEXT_SIZE,
    fontWeight: "600",
    lineHeight: lineHeight(RETRY_BUTTON_TEXT_SIZE, 1.2),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SKELETON LOADING - Polished placeholder tiles
  // ══════════════════════════════════════════════════════════════════════════
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignSelf: "center",
  },
  skeletonTile: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: TILE_BORDER_RADIUS,
    padding: SPACING.base,
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
    width: SIZES.button.md,
    height: SIZES.button.md,
    borderRadius: SIZES.radius.md,
    backgroundColor: COLORS.border,
  },
  skeletonTitle: {
    width: "65%",
    height: SKELETON_TITLE_HEIGHT,
    borderRadius: SIZES.radius.xs,
    backgroundColor: COLORS.border,
    marginTop: "auto",
  },
  skeletonBadge: {
    position: "absolute",
    top: SPACING.base,
    right: SPACING.base,
    width: SKELETON_BADGE_WIDTH,
    height: SKELETON_BADGE_HEIGHT,
    borderRadius: SIZES.radius.md,
    backgroundColor: COLORS.border,
  },
});
