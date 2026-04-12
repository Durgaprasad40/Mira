/*
 * LOCKED (DISCOVER UNIFIED SURFACE)
 * Production-ready Cards/Browse host.
 * Cards and Browse MUST keep using the same ordered useDiscoverProfiles() source
 * unless Durga Prasad explicitly unlocks this system.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  ListRenderItemInfo,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { COLORS } from "@/lib/constants";
import { useScreenTrace } from "@/lib/devTrace";
import { useDiscoverProfiles } from "@/hooks/useDiscoverProfiles";
import { toProfileData } from "@/lib/profileData";
import { ProfileCard } from "@/components/cards/ProfileCard";
import { DiscoverCardStack } from "@/components/screens/DiscoverCardStack";

export type DiscoverSurfaceMode = "cards" | "browse";

export const DISCOVER_MODE_STORAGE_KEY = "mira:discover-surface-mode";

const MODE_OPTIONS: Array<{ key: DiscoverSurfaceMode; label: string }> = [
  { key: "cards", label: "Cards" },
  { key: "browse", label: "Browse" },
];

const FADE_DURATION_MS = 150;

type DiscoverUnifiedSurfaceProps = {
  initialMode?: DiscoverSurfaceMode;
};

export default function DiscoverUnifiedSurface({
  initialMode = "cards",
}: DiscoverUnifiedSurfaceProps) {
  useScreenTrace("DISCOVER_UNIFIED");

  const { profiles, isLoading: isProfilesLoading } = useDiscoverProfiles();
  const [mode, setMode] = useState<DiscoverSurfaceMode>(initialMode);
  const [modeHydrated, setModeHydrated] = useState(false);
  const [hiddenProfileIds, setHiddenProfileIds] = useState<string[]>([]);
  const cardsOpacity = useRef(new Animated.Value(initialMode === "cards" ? 1 : 0)).current;
  const browseOpacity = useRef(new Animated.Value(initialMode === "browse" ? 1 : 0)).current;
  const browseScrollOffsetRef = useRef(0);
  const browseListRef = useRef<FlatList<ReturnType<typeof toProfileData>>>(null);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(DISCOVER_MODE_STORAGE_KEY)
      .then((storedMode) => {
        if (cancelled) return;
        if (storedMode === "cards" || storedMode === "browse") {
          setMode(storedMode);
          cardsOpacity.setValue(storedMode === "cards" ? 1 : 0);
          browseOpacity.setValue(storedMode === "browse" ? 1 : 0);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setModeHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [browseOpacity, cardsOpacity]);

  const hiddenIdSet = useMemo(() => new Set(hiddenProfileIds), [hiddenProfileIds]);

  const visibleProfiles = useMemo(
    () =>
      profiles.filter((profile) => {
        const profileId = profile?._id ?? profile?.id;
        return typeof profileId === "string" && !hiddenIdSet.has(profileId);
      }),
    [hiddenIdSet, profiles]
  );

  const browseProfiles = useMemo(
    () =>
      visibleProfiles
        .map(toProfileData)
        .filter((profile) => profile.photos.length > 0 && !!profile.photos[0]?.url),
    [visibleProfiles]
  );

  const handleModeChange = useCallback(
    (nextMode: DiscoverSurfaceMode) => {
      if (nextMode === mode) return;

      setMode(nextMode);
      AsyncStorage.setItem(DISCOVER_MODE_STORAGE_KEY, nextMode).catch(() => {});

      Animated.parallel([
        Animated.timing(cardsOpacity, {
          toValue: nextMode === "cards" ? 1 : 0,
          duration: FADE_DURATION_MS,
          useNativeDriver: true,
        }),
        Animated.timing(browseOpacity, {
          toValue: nextMode === "browse" ? 1 : 0,
          duration: FADE_DURATION_MS,
          useNativeDriver: true,
        }),
      ]).start();

      if (nextMode === "browse") {
        requestAnimationFrame(() => {
          browseListRef.current?.scrollToOffset({
            animated: false,
            offset: browseScrollOffsetRef.current,
          });
        });
      }
    },
    [browseOpacity, browseScrollOffsetRef, cardsOpacity, mode]
  );

  const handleFilterPress = useCallback(() => {
    router.push({
      pathname: "/(main)/discovery-preferences",
      params: { mode: "phase1" },
    } as any);
  }, []);

  const handleProfileConsumed = useCallback((profileId: string) => {
    setHiddenProfileIds((current) =>
      current.includes(profileId) ? current : [...current, profileId]
    );
  }, []);

  const handleBrowseProfilePress = useCallback((profileId: string) => {
    router.push(`/(main)/profile/${profileId}` as any);
  }, []);

  const renderBrowseCard = useCallback(
    ({ item }: ListRenderItemInfo<ReturnType<typeof toProfileData>>) => (
      <View style={styles.gridItem}>
        <ProfileCard
          name={item.name}
          age={item.age}
          ageHidden={item.ageHidden}
          city={item.city}
          distance={item.distance}
          distanceHidden={item.distanceHidden}
          isVerified={item.isVerified}
          photos={item.photos}
          bio={item.bio}
          onPress={() => handleBrowseProfilePress(item.id)}
        />
      </View>
    ),
    [handleBrowseProfilePress]
  );

  const browseEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Ionicons name="search-outline" size={34} color={COLORS.textLight} />
        <Text style={styles.emptyTitle}>No profiles available</Text>
        <Text style={styles.emptyText}>
          Your current Discover stack is empty right now. Try again later or adjust your filters.
        </Text>
      </View>
    ),
    []
  );

  const showDiscoverLoading = !modeHydrated || isProfilesLoading;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Discover</Text>
          <Text style={styles.headerSubtitle}>
            Swipe cards or switch to Browse without leaving Discover.
          </Text>
        </View>

        <TouchableOpacity onPress={handleFilterPress} style={styles.filterButton}>
          <Ionicons name="options-outline" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.segmentedControl}>
        {MODE_OPTIONS.map((option) => {
          const selected = option.key === mode;
          return (
            <TouchableOpacity
              key={option.key}
              onPress={() => handleModeChange(option.key)}
              style={[styles.segmentButton, selected && styles.segmentButtonActive]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.contentArea}>
        {showDiscoverLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.loadingText}>Finding people for you...</Text>
          </View>
        ) : (
          <>
            <Animated.View
              pointerEvents={mode === "cards" ? "auto" : "none"}
              style={[styles.layer, { opacity: cardsOpacity, zIndex: mode === "cards" ? 2 : 1 }]}
            >
              <DiscoverCardStack
                externalProfiles={visibleProfiles}
                hideHeader
                onProfileAction={handleProfileConsumed}
              />
            </Animated.View>

            <Animated.View
              pointerEvents={mode === "browse" ? "auto" : "none"}
              style={[styles.layer, { opacity: browseOpacity, zIndex: mode === "browse" ? 2 : 1 }]}
            >
              <FlatList
                ref={browseListRef}
                data={browseProfiles}
                renderItem={renderBrowseCard}
                keyExtractor={(item) => item.id}
                numColumns={2}
                showsVerticalScrollIndicator={false}
                columnWrapperStyle={styles.gridRow}
                contentContainerStyle={styles.gridContent}
                ListHeaderComponent={
                  <Text style={styles.browseHint}>
                    Browse uses the same ordered Discover profiles. Tap a card to open the full profile and act from there.
                  </Text>
                }
                ListEmptyComponent={browseEmpty}
                onScroll={(event) => {
                  browseScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={16}
              />
            </Animated.View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.8,
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textLight,
  },
  filterButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.backgroundDark,
  },
  segmentedControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 6,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  segmentButtonActive: {
    backgroundColor: COLORS.primary,
  },
  segmentText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textLight,
  },
  segmentTextActive: {
    color: COLORS.white,
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  contentArea: {
    flex: 1,
    position: "relative",
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  gridContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 120,
  },
  gridRow: {
    justifyContent: "space-between",
    marginBottom: 14,
  },
  gridItem: {
    width: "48%",
  },
  browseHint: {
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textLight,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
  },
  emptyText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textLight,
    textAlign: "center",
  },
});
