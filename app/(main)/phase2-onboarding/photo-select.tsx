/**
 * Phase 2 Onboarding - Step 2: Photo Import/Selection (ONE-TIME)
 *
 * This screen is ONLY for initial photo selection from Phase-1.
 * After confirmation, user is redirected to profile-edit (Step 2.5).
 *
 * Shows:
 * - Phase-1 photos grid for selection
 * - Basic info summary
 *
 * Does NOT show:
 * - Intent categories
 * - Desire input
 * - Photo editing tools (replace/delete/main/blur)
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  usePrivateProfileStore,
  PHASE2_MIN_PHOTOS,
} from '@/stores/privateProfileStore';
import { useDemoStore } from '@/stores/demoStore';

const C = INCOGNITO_COLORS;
const GRID_SLOTS = 9;
const COLUMNS = 3;
const GRID_GAP = 8;
const SCREEN_PADDING = 16;
const screenWidth = Dimensions.get('window').width;
const slotSize = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

const GENDER_LABELS: Record<string, string> = {
  male: 'Man', female: 'Woman', non_binary: 'Non-binary',
};

function calculateAgeFromDob(dob: string | undefined | null): number {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 0;
  const [y, m, d] = dob.split('-').map(Number);
  const birthDate = new Date(y, m - 1, d, 12, 0, 0);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// Create empty 9-slot array
function createEmptySlots(): (string | null)[] {
  return [null, null, null, null, null, null, null, null, null];
}

export default function Phase2PhotoSelect() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Check if already confirmed - redirect to profile-edit
  const phase2PhotosConfirmed = usePrivateProfileStore((s) => s.phase2PhotosConfirmed);
  const _hasHydrated = usePrivateProfileStore((s) => s._hasHydrated);

  // Single-fire redirect guard
  const didRedirectRef = useRef(false);

  // P2-004 FIX: Ref guard to prevent double-tap navigation
  const isConfirmingRef = useRef(false);

  useEffect(() => {
    if (didRedirectRef.current) return;
    if (_hasHydrated && phase2PhotosConfirmed) {
      didRedirectRef.current = true;
      // Already confirmed, redirect to profile-edit
      router.replace('/(main)/phase2-onboarding/profile-edit' as any);
    }
  }, [_hasHydrated, phase2PhotosConfirmed, router]);

  // Source: Phase-1 photos
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const getCurrentProfile = useDemoStore((s) => s.getCurrentProfile);

  const phase1PhotoSlots = useMemo(() => {
    const profile = getCurrentProfile();
    const slots = profile?.photoSlots || createEmptySlots();
    return slots;
  }, [getCurrentProfile, demoProfiles, currentDemoUserId]);

  // Profile info from Phase-1
  const phase1Profile = useMemo(() => getCurrentProfile(), [getCurrentProfile, demoProfiles, currentDemoUserId]);
  const displayName = phase1Profile?.name || 'Anonymous';
  const age = phase1Profile?.dateOfBirth ? calculateAgeFromDob(phase1Profile.dateOfBirth) : 0;
  const gender = phase1Profile?.gender || '';

  // Store actions
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setPhase2PhotosConfirmed = usePrivateProfileStore((s) => s.setPhase2PhotosConfirmed);

  // Local state
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [failedSlots, setFailedSlots] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Computed values
  const validPhotoCount = phase1PhotoSlots.filter((uri, idx) => uri && !failedSlots.includes(idx)).length;
  const selectedCount = selectedSlots.length;
  const canConfirm = selectedCount >= PHASE2_MIN_PHOTOS;

  // Handlers
  const toggleSelection = useCallback((slotIndex: number) => {
    setSelectedSlots((prev) => {
      if (prev.includes(slotIndex)) {
        return prev.filter((s) => s !== slotIndex);
      }
      return [...prev, slotIndex];
    });
  }, []);

  const onSlotError = useCallback((slotIndex: number) => {
    setFailedSlots((prev) => prev.includes(slotIndex) ? prev : [...prev, slotIndex]);
    setSelectedSlots((prev) => prev.filter((s) => s !== slotIndex));
  }, []);

  const handleConfirmPhotos = useCallback(() => {
    if (selectedSlots.length < PHASE2_MIN_PHOTOS || isProcessing) return;
    // P2-004 FIX: Ref guard prevents double-tap in same render cycle
    if (isConfirmingRef.current) return;
    isConfirmingRef.current = true;

    setIsProcessing(true);

    // Collect selected photo URLs
    const photoUrls: string[] = [];
    for (const slotIndex of selectedSlots) {
      const uri = phase1PhotoSlots[slotIndex];
      if (uri) photoUrls.push(uri);
    }

    // Save to store
    setSelectedPhotos([], photoUrls);
    setPhase2PhotosConfirmed(true);

    // Navigate to profile-edit (Step 2.5)
    router.push('/(main)/phase2-onboarding/profile-edit' as any);
    // NOTE: Don't reset isProcessing/ref - component will unmount after navigation
  }, [selectedSlots, phase1PhotoSlots, isProcessing, setSelectedPhotos, setPhase2PhotosConfirmed, router]);

  // Show loading while checking hydration
  if (!_hasHydrated) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Photos</Text>
        <Text style={styles.stepLabel}>Step 2 of 3</Text>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Section: Photo Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Choose Your Photos</Text>
          <Text style={styles.sectionSubtitle}>
            Select at least {PHASE2_MIN_PHOTOS} photos from your Phase-1 profile for Private Mode.
          </Text>

          {/* Empty state */}
          {validPhotoCount === 0 && (
            <View style={styles.emptyStateContainer}>
              <Ionicons name="images-outline" size={48} color={C.textLight} />
              <Text style={styles.emptyStateTitle}>No Photos Found</Text>
              <Text style={styles.emptyStateText}>
                Your Phase-1 photos could not be loaded. Please go back and add photos first.
              </Text>
            </View>
          )}

          {/* Photo Grid */}
          <View style={styles.grid}>
            {phase1PhotoSlots.map((uri, slotIndex) => {
              const hasFailed = failedSlots.includes(slotIndex);
              const isSelected = selectedSlots.includes(slotIndex);
              const selectionOrder = isSelected ? selectedSlots.indexOf(slotIndex) + 1 : 0;

              if (uri && !hasFailed) {
                return (
                  <Pressable
                    key={`slot-${slotIndex}`}
                    style={styles.slot}
                    onPress={() => toggleSelection(slotIndex)}
                  >
                    <Image
                      source={{ uri }}
                      style={styles.slotImage}
                      resizeMode="cover"
                      onError={() => onSlotError(slotIndex)}
                    />
                    {isSelected && (
                      <View pointerEvents="none" style={styles.orderBadge}>
                        <Text style={styles.orderBadgeText}>{selectionOrder}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              }

              return (
                <View key={`empty-${slotIndex}`} style={[styles.slot, styles.emptySlot]}>
                  <Ionicons name="image-outline" size={24} color={C.textLight} />
                </View>
              );
            })}
          </View>

          {/* Selection count */}
          <Text style={[styles.countText, !canConfirm && styles.countWarning]}>
            {selectedCount < PHASE2_MIN_PHOTOS
              ? `Select ${PHASE2_MIN_PHOTOS - selectedCount} more photo${PHASE2_MIN_PHOTOS - selectedCount === 1 ? '' : 's'}`
              : `${selectedCount}/${GRID_SLOTS} selected`}
          </Text>
        </View>

        {/* Section: Basic Info Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Info</Text>
          <Text style={styles.sectionSubtitle}>Imported from your main profile.</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Name</Text>
              <Text style={styles.infoValue}>{displayName}</Text>
            </View>
            {age > 0 && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Age</Text>
                <Text style={styles.infoValue}>{age}</Text>
              </View>
            )}
            {gender && (
              <View style={[styles.infoRow, styles.infoRowLast]}>
                <Text style={styles.infoLabel}>Gender</Text>
                <Text style={styles.infoValue}>{GENDER_LABELS[gender] || gender}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom Bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <TouchableOpacity
          style={[styles.confirmBtn, (!canConfirm || isProcessing) && styles.confirmBtnDisabled]}
          onPress={handleConfirmPhotos}
          disabled={!canConfirm || isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={canConfirm ? '#FFF' : C.textLight} />
              <Text style={[styles.confirmBtnText, !canConfirm && styles.confirmBtnTextDisabled]}>
                {canConfirm ? 'Continue' : `Select at least ${PHASE2_MIN_PHOTOS} photos`}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scrollView: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  stepLabel: { fontSize: 12, color: C.textLight },
  section: { paddingHorizontal: SCREEN_PADDING, paddingTop: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: C.textLight, marginBottom: 12 },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  slot: {
    width: slotSize, height: slotSize * 1.25, borderRadius: 10,
    overflow: 'hidden', backgroundColor: C.surface, position: 'relative',
  },
  emptySlot: { alignItems: 'center', justifyContent: 'center', opacity: 0.5 },
  slotImage: { width: '100%', height: '100%' },

  // Badges
  orderBadge: {
    position: 'absolute', top: 6, right: 6, width: 26, height: 26,
    borderRadius: 13, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  orderBadgeText: { fontSize: 13, fontWeight: '700', color: '#FFF' },

  countText: { fontSize: 13, color: C.textLight, textAlign: 'center', marginTop: 12 },
  countWarning: { color: C.primary, fontWeight: '500' },

  // Empty state
  emptyStateContainer: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 32,
    backgroundColor: C.surface, borderRadius: 12, marginBottom: 16,
  },
  emptyStateTitle: { fontSize: 16, fontWeight: '600', color: C.text, marginTop: 12, marginBottom: 8 },
  emptyStateText: { fontSize: 13, color: C.textLight, textAlign: 'center', paddingHorizontal: 24 },

  // Info card
  infoCard: { backgroundColor: C.surface, borderRadius: 12, padding: 16 },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.background,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoLabel: { fontSize: 14, color: C.textLight },
  infoValue: { fontSize: 14, fontWeight: '600', color: C.text },

  // Bottom
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1,
    borderTopColor: C.surface, backgroundColor: C.background,
  },
  confirmBtn: {
    flexDirection: 'row', backgroundColor: C.primary, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  confirmBtnDisabled: { backgroundColor: C.surface },
  confirmBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  confirmBtnTextDisabled: { color: C.textLight },
});
