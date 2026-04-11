import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { INCOGNITO_COLORS } from "@/lib/constants";
import {
  PHASE2_MIN_PHOTOS,
  usePrivateProfileStore,
} from "@/stores/privateProfileStore";
import type { PhotoSlots9 } from "@/types";
import { useScreenTrace } from "@/lib/devTrace";

const C = INCOGNITO_COLORS;
const GRID_SLOTS = 9;
const GRID_COLUMNS = 3;
const SCREEN_PADDING = 20;
const GRID_GAP = 10;

const GENDER_LABELS: Record<string, string> = {
  male: "Man",
  female: "Woman",
  non_binary: "Non-binary",
};

type GridTile = {
  slotIndex: number;
  uri: string | null;
};

function isSelectablePhotoUri(uri: string | null | undefined): uri is string {
  return (
    typeof uri === "string" &&
    uri.length > 0 &&
    uri !== "null" &&
    uri !== "undefined" &&
    (uri.startsWith("http") ||
      uri.startsWith("file://") ||
      uri.startsWith("content://") ||
      uri.startsWith("ph://"))
  );
}

function buildInitialSelectedSlots(phase1PhotoSlots: PhotoSlots9, selectedPhotoUrls: string[]) {
  const selectedSlots: number[] = [];
  const usedSlotIndices = new Set<number>();

  selectedPhotoUrls.forEach((selectedUrl) => {
    const matchedSlot = phase1PhotoSlots.findIndex(
      (slotUrl, slotIndex) =>
        !usedSlotIndices.has(slotIndex) && slotUrl === selectedUrl
    );

    if (matchedSlot >= 0) {
      usedSlotIndices.add(matchedSlot);
      selectedSlots.push(matchedSlot);
    }
  });

  return selectedSlots;
}

export default function Phase2PhotoSelect() {
  useScreenTrace("P2_ONB_PHOTO_SELECT");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const phase1PhotoSlots = usePrivateProfileStore((s) => s.phase1PhotoSlots);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const displayName = usePrivateProfileStore((s) => s.displayName);
  const ageFromStore = usePrivateProfileStore((s) => s.age);
  const gender = usePrivateProfileStore((s) => s.gender);
  const phase2PhotosConfirmed = usePrivateProfileStore((s) => s.phase2PhotosConfirmed);
  const setCurrentStep = usePrivateProfileStore((s) => s.setCurrentStep);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setPhase2PhotosConfirmed = usePrivateProfileStore((s) => s.setPhase2PhotosConfirmed);

  const [selectedSlots, setSelectedSlots] = useState<number[]>(() =>
    buildInitialSelectedSlots(phase1PhotoSlots, selectedPhotoUrls)
  );
  const [failedSlots, setFailedSlots] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const tileSize = useMemo(() => {
    const availableWidth = Math.max(width - SCREEN_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1), 0);
    return Math.floor(availableWidth / GRID_COLUMNS);
  }, [width]);

  useEffect(() => {
    setCurrentStep(2);
  }, [setCurrentStep]);

  const initialSelectedSlots = useMemo(
    () => buildInitialSelectedSlots(phase1PhotoSlots, selectedPhotoUrls),
    [phase1PhotoSlots, selectedPhotoUrls]
  );

  useEffect(() => {
    setSelectedSlots(initialSelectedSlots);
  }, [initialSelectedSlots]);

  useEffect(() => {
    setFailedSlots([]);
  }, [phase1PhotoSlots]);

  useFocusEffect(
    useCallback(() => {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }, [])
  );

  const gridTiles = useMemo<GridTile[]>(
    () => phase1PhotoSlots.map((uri, slotIndex) => ({ slotIndex, uri })),
    [phase1PhotoSlots]
  );

  const availablePhotoCount = useMemo(
    () =>
      gridTiles.filter(
        (tile) => isSelectablePhotoUri(tile.uri) && !failedSlots.includes(tile.slotIndex)
      ).length,
    [failedSlots, gridTiles]
  );

  const selectionMismatchCount = Math.max(0, selectedPhotoUrls.length - initialSelectedSlots.length);
  const canContinue = selectedSlots.length >= PHASE2_MIN_PHOTOS && !isSubmitting;
  const previewAge = ageFromStore > 0 ? ageFromStore : 0;

  const handleToggleSelection = useCallback((slotIndex: number, uri: string | null) => {
    if (!isSelectablePhotoUri(uri) || failedSlots.includes(slotIndex)) return;

    setSelectedSlots((current) => {
      if (current.includes(slotIndex)) {
        return current.filter((value) => value !== slotIndex);
      }
      return [...current, slotIndex];
    });
  }, [failedSlots]);

  const handleTileError = useCallback((slotIndex: number) => {
    setFailedSlots((current) => (current.includes(slotIndex) ? current : [...current, slotIndex]));
    setSelectedSlots((current) => current.filter((value) => value !== slotIndex));
  }, []);

  const handleContinue = useCallback(() => {
    if (!canContinue || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const nextIds: string[] = [];
      const nextUrls: string[] = [];

      selectedSlots.forEach((slotIndex) => {
        const uri = phase1PhotoSlots[slotIndex];
        if (!isSelectablePhotoUri(uri) || failedSlots.includes(slotIndex)) return;
        nextIds.push(`p1_slot_${slotIndex}`);
        nextUrls.push(uri);
      });

      if (nextUrls.length < PHASE2_MIN_PHOTOS) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        return;
      }

      setSelectedPhotos(nextIds, nextUrls);
      setPhase2PhotosConfirmed(true);
      router.push("/(main)/phase2-onboarding/profile-edit" as any);
    } catch (error) {
      if (__DEV__) {
        console.error("[phase2-onboarding/photo-select] continue failed", error);
      }
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    canContinue,
    failedSlots,
    phase1PhotoSlots,
    router,
    selectedSlots,
    setPhase2PhotosConfirmed,
    setSelectedPhotos,
  ]);

  const renderTile = useCallback(
    ({ item }: { item: GridTile }) => {
      const isSelected = selectedSlots.includes(item.slotIndex);
      const selectionOrder = isSelected ? selectedSlots.indexOf(item.slotIndex) + 1 : null;
      const hasImage = isSelectablePhotoUri(item.uri) && !failedSlots.includes(item.slotIndex);

      return (
        <Pressable
          style={[
            styles.tile,
            { width: tileSize, height: tileSize },
            isSelected && styles.tileSelected,
            !hasImage && styles.tileEmpty,
          ]}
          android_ripple={hasImage ? { color: "rgba(255,255,255,0.12)" } : undefined}
          onPress={() => handleToggleSelection(item.slotIndex, item.uri)}
        >
          {hasImage ? (
            <>
              <Image
                source={{ uri: item.uri! }}
                style={styles.tileImage}
                contentFit="cover"
                transition={120}
                onError={() => handleTileError(item.slotIndex)}
              />
              <View style={[styles.tileOverlay, isSelected && styles.tileOverlaySelected]} />
              {selectionOrder ? (
                <>
                  <View style={styles.orderBadge}>
                    <Text style={styles.orderBadgeText}>{selectionOrder}</Text>
                  </View>
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark" size={16} color="#07111A" />
                  </View>
                </>
              ) : (
                <View style={styles.unselectedBadge}>
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                </View>
              )}
            </>
          ) : (
            <View style={styles.emptyTileContent}>
              <Ionicons name="image-outline" size={24} color={C.textLight} />
              <Text style={styles.emptyTileText}>Empty</Text>
            </View>
          )}
        </Pressable>
      );
    },
    [failedSlots, handleTileError, handleToggleSelection, selectedSlots, tileSize]
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.headerIconButton}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Choose your photos</Text>
            <Text style={styles.headerSubtitle}>Step 2 of 5</Text>
          </View>
          <View style={styles.headerCountPill}>
            <Text style={styles.headerCountText}>{selectedSlots.length}/{GRID_SLOTS}</Text>
          </View>
        </View>

        <FlatList
          data={gridTiles}
          keyExtractor={(item) => `slot-${item.slotIndex}`}
          numColumns={GRID_COLUMNS}
          renderItem={renderTile}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 20) + 132 },
          ]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <View style={styles.heroCard}>
                <Text style={styles.heroTitle}>Import from your main profile</Text>
                <Text style={styles.heroText}>
                  Pick the photos you want to bring into Phase-2. You can blur, reorder, or replace them on the next screen.
                </Text>
                <View style={styles.statusRow}>
                  <View style={styles.statusChip}>
                    <Ionicons name="images-outline" size={15} color={C.primary} />
                    <Text style={styles.statusChipText}>{availablePhotoCount} available</Text>
                  </View>
                  <View style={[styles.statusChip, canContinue && styles.statusChipReady]}>
                    <Ionicons
                      name={canContinue ? "checkmark-circle" : "sparkles-outline"}
                      size={15}
                      color={canContinue ? "#0B1A14" : C.text}
                    />
                    <Text style={[styles.statusChipText, canContinue && styles.statusChipReadyText]}>
                      {canContinue
                        ? "Ready to continue"
                        : `Select ${PHASE2_MIN_PHOTOS - selectedSlots.length} more`}
                    </Text>
                  </View>
                </View>
              </View>

              {selectionMismatchCount > 0 && phase2PhotosConfirmed ? (
                <View style={styles.infoBanner}>
                  <Ionicons name="information-circle" size={18} color={C.primary} />
                  <Text style={styles.infoBannerText}>
                    Some current Phase-2 photos were added later and do not appear in this importer. You can manage them on the next screen.
                  </Text>
                </View>
              ) : null}

              <View style={styles.summaryCard}>
                <View>
                  <Text style={styles.summaryLabel}>Private profile owner</Text>
                  <Text style={styles.summaryValue}>{displayName || "Anonymous"}</Text>
                </View>
                <View style={styles.summaryMetaRow}>
                  {previewAge > 0 ? (
                    <View style={styles.summaryMetaChip}>
                      <Text style={styles.summaryMetaText}>{previewAge} yrs</Text>
                    </View>
                  ) : null}
                  {gender ? (
                    <View style={styles.summaryMetaChip}>
                      <Text style={styles.summaryMetaText}>{GENDER_LABELS[gender] || gender}</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Main profile photo grid</Text>
                <Text style={styles.sectionHint}>Tap to select. Selected photos move into Phase-2 in this exact order.</Text>
              </View>

              {availablePhotoCount === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="images-outline" size={34} color={C.textLight} />
                  <Text style={styles.emptyStateTitle}>No usable photos found</Text>
                  <Text style={styles.emptyStateText}>
                    Add photos to your main profile first, then come back to continue Phase-2 onboarding.
                  </Text>
                </View>
              ) : null}
            </View>
          }
          ListFooterComponent={
            availablePhotoCount > 0 ? (
              <Text style={[styles.footerHint, !canContinue && styles.footerHintWarning]}>
                {canContinue
                  ? `${selectedSlots.length} photos selected for Phase-2`
                  : `Select at least ${PHASE2_MIN_PHOTOS} photos to continue`}
              </Text>
            ) : null
          }
        />

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity
            style={[styles.primaryButton, !canContinue && styles.primaryButtonDisabled]}
            onPress={handleContinue}
            disabled={!canContinue}
            activeOpacity={0.9}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#07111A" />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Continue to edit profile</Text>
                <Ionicons name="arrow-forward" size={18} color="#07111A" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.background,
  },
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    gap: 12,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: C.text,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: C.textLight,
  },
  headerCountPill: {
    minWidth: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
  },
  headerCountText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },
  listContent: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 18,
  },
  heroCard: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: "#111B24",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  heroTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: C.text,
  },
  heroText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    color: C.textLight,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  statusChipReady: {
    backgroundColor: "#B9F5CC",
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },
  statusChipReadyText: {
    color: "#0B1A14",
  },
  infoBanner: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(235, 191, 95, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(235, 191, 95, 0.18)",
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: C.text,
  },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  summaryLabel: {
    fontSize: 12,
    color: C.textLight,
  },
  summaryValue: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
  },
  summaryMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8,
  },
  summaryMetaChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  summaryMetaText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.text,
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
  },
  sectionHint: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: C.textLight,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  emptyStateTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
  },
  emptyStateText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    color: C.textLight,
  },
  columnWrapper: {
    justifyContent: "space-between",
    marginBottom: GRID_GAP,
  },
  tile: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#101820",
  },
  tileSelected: {
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 4,
  },
  tileEmpty: {
    borderStyle: "dashed",
  },
  tileImage: {
    width: "100%",
    height: "100%",
  },
  tileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4, 9, 14, 0.18)",
  },
  tileOverlaySelected: {
    backgroundColor: "rgba(5, 10, 14, 0.34)",
  },
  orderBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
  },
  orderBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#07111A",
  },
  checkBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#D9FFE6",
    alignItems: "center",
    justifyContent: "center",
  },
  unselectedBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTileContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyTileText: {
    fontSize: 12,
    color: C.textLight,
  },
  footerHint: {
    marginTop: 6,
    fontSize: 13,
    textAlign: "center",
    color: C.textLight,
  },
  footerHintWarning: {
    color: C.primary,
    fontWeight: "600",
  },
  bottomBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    paddingTop: 14,
    backgroundColor: C.background,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.primary,
  },
  primaryButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#07111A",
  },
});
