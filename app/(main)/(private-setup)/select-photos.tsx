import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { isDemoMode } from '@/hooks/useConvex';
import { PhotoSelectionGrid } from '@/components/private/PhotoSelectionGrid';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useScreenTrace } from '@/lib/devTrace';

const C = INCOGNITO_COLORS;

// Maximum photos supported in Phase-2 (same as Phase-1)
const MAX_PHASE2_PHOTOS = 9;

// Demo photos for when not connected to Convex
const DEMO_PHOTOS = [
  { id: 'demo_0', url: 'https://picsum.photos/seed/p0/400/520' },
  { id: 'demo_1', url: 'https://picsum.photos/seed/p1/400/520' },
  { id: 'demo_2', url: 'https://picsum.photos/seed/p2/400/520' },
  { id: 'demo_3', url: 'https://picsum.photos/seed/p3/400/520' },
];

export default function SelectPhotosScreen() {
  useScreenTrace("P2_SETUP_SELECT_PHOTOS");
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const selectedPhotoIds = usePrivateProfileStore((s) => s.selectedPhotoIds);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setCurrentStep = usePrivateProfileStore((s) => s.setCurrentStep);

  // FIX: Use phase1PhotoSlots from store (already populated by importPhase1Data in Step 1)
  // This includes ALL Phase-1 photos including the primary/verification photo
  const phase1PhotoSlots = usePrivateProfileStore((s) => s.phase1PhotoSlots);

  // Convert phase1PhotoSlots to PhotoItem[] format for the grid
  // Each photo gets a unique ID based on its slot index to preserve ordering
  const photos = useMemo(() => {
    if (isDemoMode) return DEMO_PHOTOS;

    const items: { id: string; url: string }[] = [];
    phase1PhotoSlots.forEach((url, index) => {
      if (url && typeof url === 'string' && url.length > 0 && url !== 'null' && url !== 'undefined') {
        items.push({
          id: `p1_slot_${index}`,
          url,
        });
      }
    });
    return items;
  }, [phase1PhotoSlots]);

  useEffect(() => {
    setCurrentStep(1);
  }, []);

  const handleToggle = (id: string, url: string) => {
    if (selectedPhotoIds.includes(id)) {
      // Deselect: remove from selection
      const idx = selectedPhotoIds.indexOf(id);
      const newIds = [...selectedPhotoIds];
      const newUrls = [...selectedPhotoUrls];
      newIds.splice(idx, 1);
      newUrls.splice(idx, 1);
      setSelectedPhotos(newIds, newUrls);
    } else if (selectedPhotoIds.length < MAX_PHASE2_PHOTOS) {
      // Select: add to selection (only if under max)
      setSelectedPhotos([...selectedPhotoIds, id], [...selectedPhotoUrls, url]);
    }
  };

  // P2-PHOTO-001 FIX: Minimum 2 photos required (matches profile-edit requirement)
  const canProceed = selectedPhotoIds.length >= 2;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Photos</Text>
        {/* P2-PHOTO-001: Updated step number for phase2-onboarding flow */}
        <Text style={styles.stepLabel}>Step 2 of 5</Text>
      </View>

      <Text style={styles.subtitle}>
        Choose which photos from your main profile to use in Private Mode. Select at least 2 photos to continue.
      </Text>

      {photos.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={64} color={C.textLight} />
          <Text style={styles.emptyText}>No photos found in your main profile</Text>
          <Text style={styles.emptyHint}>Upload photos to your main profile first</Text>
        </View>
      ) : (
        <PhotoSelectionGrid
          photos={photos}
          selectedIds={selectedPhotoIds}
          onToggle={handleToggle}
          maxSelection={MAX_PHASE2_PHOTOS}
        />
      )}

      {/* Bottom action */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, !canProceed && styles.nextBtnDisabled]}
          onPress={() => canProceed && router.push('/(main)/phase2-onboarding/profile-edit' as any)}
          disabled={!canProceed}
        >
          {/* P2-PHOTO-001 FIX: Navigate to profile-edit instead of blur-preview */}
          <Text style={styles.nextBtnText}>Continue to Edit Profile</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  stepLabel: { fontSize: 12, color: C.textLight },
  subtitle: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: C.text },
  emptyHint: { fontSize: 13, color: C.textLight },
  bottomBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  nextBtn: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextBtnDisabled: { backgroundColor: C.surface },
  nextBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
