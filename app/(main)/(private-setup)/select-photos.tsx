import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { isDemoMode } from '@/hooks/useConvex';
import { PhotoSelectionGrid } from '@/components/private/PhotoSelectionGrid';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

// Demo photos for when not connected to Convex
const DEMO_PHOTOS = [
  { id: 'demo_1', url: 'https://picsum.photos/seed/p1/400/520' },
  { id: 'demo_2', url: 'https://picsum.photos/seed/p2/400/520' },
  { id: 'demo_3', url: 'https://picsum.photos/seed/p3/400/520' },
  { id: 'demo_4', url: 'https://picsum.photos/seed/p4/400/520' },
];

export default function SelectPhotosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  const selectedPhotoIds = usePrivateProfileStore((s) => s.selectedPhotoIds);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setCurrentStep = usePrivateProfileStore((s) => s.setCurrentStep);

  // Fetch Face 1 photos
  const convexPhotos = useQuery(
    api.photos.getUserPhotos,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const photos = isDemoMode
    ? DEMO_PHOTOS
    : (convexPhotos ?? []).map((p) => ({ id: p._id, url: p.url }));

  const loading = !isDemoMode && convexPhotos === undefined;

  useEffect(() => {
    setCurrentStep(1);
  }, []);

  const handleToggle = (id: string, url: string) => {
    if (selectedPhotoIds.includes(id)) {
      const idx = selectedPhotoIds.indexOf(id);
      const newIds = [...selectedPhotoIds];
      const newUrls = [...selectedPhotoUrls];
      newIds.splice(idx, 1);
      newUrls.splice(idx, 1);
      setSelectedPhotos(newIds, newUrls);
    } else {
      setSelectedPhotos([...selectedPhotoIds, id], [...selectedPhotoUrls, url]);
    }
  };

  const canProceed = selectedPhotoIds.length >= 1;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Photos</Text>
        <Text style={styles.stepLabel}>Step 1 of 4</Text>
      </View>

      <Text style={styles.subtitle}>
        Choose photos from your main profile. They'll be blurred for your private profile — originals stay private.
      </Text>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading your photos...</Text>
        </View>
      ) : photos.length === 0 ? (
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
          maxSelection={6}
        />
      )}

      {/* Bottom action */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, !canProceed && styles.nextBtnDisabled]}
          onPress={() => canProceed && router.push('/(main)/(private-setup)/blur-preview' as any)}
          disabled={!canProceed}
        >
          <Text style={styles.nextBtnText}>Continue to Preview</Text>
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
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: C.textLight },
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
