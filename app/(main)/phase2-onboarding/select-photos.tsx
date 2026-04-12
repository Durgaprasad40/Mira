import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { uploadPhotoToConvex } from '@/lib/uploadUtils';
import { usePrivateProfileStore, PHASE2_MIN_PHOTOS } from '@/stores/privateProfileStore';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PhotoSelectionGrid } from '@/components/private/PhotoSelectionGrid';
import { useAuthStore } from '@/stores/authStore';
import { useScreenTrace } from '@/lib/devTrace';
import { PHASE2_ONBOARDING_ROUTE_MAP } from '@/lib/phase2Onboarding';

const C = INCOGNITO_COLORS;
const MAX_PHASE2_PHOTOS = 9;

function isPersistedPhotoUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export default function Phase2SelectPhotosScreen() {
  useScreenTrace('P2_ONB_SELECT_PHOTOS');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.userId);

  const selectedPhotoIds = usePrivateProfileStore((s) => s.selectedPhotoIds);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const phase1PhotoSlots = usePrivateProfileStore((s) => s.phase1PhotoSlots);

  const saveOnboardingPhotos = useMutation(api.privateProfiles.saveOnboardingPhotos);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const getStorageUrl = useMutation(api.photos.getStorageUrl);
  const trackPendingUpload = useMutation(api.photos.trackPendingUpload);
  const cleanupPendingUpload = useMutation(api.photos.cleanupPendingUpload);

  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingDraft, setIsSyncingDraft] = useState(false);
  const [sessionUploads, setSessionUploads] = useState<Record<string, Id<'_storage'>>>({});

  const phase1Photos = useMemo(() => {
    const photos: { id: string; url: string }[] = [];
    phase1PhotoSlots.forEach((url, index) => {
      if (typeof url === 'string' && isPersistedPhotoUrl(url)) {
        photos.push({ id: `p1_slot_${index}`, url });
      }
    });
    return photos;
  }, [phase1PhotoSlots]);

  useEffect(() => {
    if (selectedPhotoUrls.length === 0 || phase1Photos.length === 0) return;

    const expectedIds = selectedPhotoUrls
      .map((url) => phase1Photos.find((photo) => photo.url === url)?.id)
      .filter((id): id is string => !!id);

    if (
      expectedIds.length === selectedPhotoIds.length &&
      expectedIds.every((id, index) => id === selectedPhotoIds[index])
    ) {
      return;
    }

    setSelectedPhotos(expectedIds, selectedPhotoUrls);
  }, [phase1Photos, selectedPhotoIds, selectedPhotoUrls, setSelectedPhotos]);

  const extraPhotoUrls = useMemo(
    () => selectedPhotoUrls.filter((url) => !phase1Photos.some((photo) => photo.url === url)),
    [phase1Photos, selectedPhotoUrls]
  );

  const validSelectedPhotoUrls = useMemo(
    () => selectedPhotoUrls.filter(isPersistedPhotoUrl),
    [selectedPhotoUrls]
  );

  const canContinue =
    !!token &&
    validSelectedPhotoUrls.length >= PHASE2_MIN_PHOTOS &&
    !isUploading &&
    !isSyncingDraft &&
    !isSaving;

  const persistDraftPhotos = useCallback(async (nextUrls: string[]) => {
    if (!token) {
      return nextUrls;
    }

    const persistedUrls = Array.from(new Set(nextUrls.filter(isPersistedPhotoUrl))).slice(0, MAX_PHASE2_PHOTOS);
    setIsSyncingDraft(true);

    try {
      const result = await saveOnboardingPhotos({
        token,
        privatePhotoUrls: persistedUrls,
      });

      if (!result?.success) {
        throw new Error('Photo draft save did not succeed');
      }

      return persistedUrls;
    } finally {
      setIsSyncingDraft(false);
    }
  }, [saveOnboardingPhotos, token]);

  const handleTogglePhase1Photo = (id: string, url: string) => {
    if (isUploading || isSaving || isSyncingDraft) {
      return;
    }

    const isSelected = selectedPhotoUrls.includes(url);
    const previousIds = selectedPhotoIds;
    const previousUrls = selectedPhotoUrls;

    if (isSelected) {
      const nextIds = selectedPhotoIds.filter((existingId) => existingId !== id);
      const nextUrls = selectedPhotoUrls.filter((existingUrl) => existingUrl !== url);
      setSelectedPhotos(nextIds, nextUrls);
      persistDraftPhotos(nextUrls).catch(() => {
        setSelectedPhotos(previousIds, previousUrls);
        Alert.alert('Unable to update photos', 'We could not save your photo selection. Please try again.');
      });
      return;
    }

    if (selectedPhotoUrls.length >= MAX_PHASE2_PHOTOS) {
      return;
    }

    const nextIds = [...selectedPhotoIds, id];
    const nextUrls = [...selectedPhotoUrls, url];
    setSelectedPhotos(nextIds, nextUrls);
    persistDraftPhotos(nextUrls).catch(() => {
      setSelectedPhotos(previousIds, previousUrls);
      Alert.alert('Unable to update photos', 'We could not save your photo selection. Please try again.');
    });
  };

  const handleAddFromPhone = async () => {
    if (!token || !userId) return;
    if (isSyncingDraft || isSaving) return;
    if (selectedPhotoUrls.length >= MAX_PHASE2_PHOTOS) {
      Alert.alert('Photo limit reached', `You can use up to ${MAX_PHASE2_PHOTOS} photos in Private Mode.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access to add photos.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      setIsUploading(true);
      const storageId = await uploadPhotoToConvex(result.assets[0].uri, generateUploadUrl);
      await trackPendingUpload({ userId, storageId });
      const permanentUrl = await getStorageUrl({ storageId });

      if (!permanentUrl || !isPersistedPhotoUrl(permanentUrl)) {
        throw new Error('Upload completed without a permanent URL');
      }

      if (!selectedPhotoUrls.includes(permanentUrl)) {
        const nextUrls = [...selectedPhotoUrls, permanentUrl];
        const previousUrls = selectedPhotoUrls;
        setSelectedPhotos(selectedPhotoIds, nextUrls);

        try {
          const persistedUrls = await persistDraftPhotos(nextUrls);
          setSelectedPhotos(selectedPhotoIds, persistedUrls);
          setSessionUploads((current) => ({
            ...current,
            [permanentUrl]: storageId,
          }));
        } catch (error) {
          setSelectedPhotos(selectedPhotoIds, previousUrls);
          try {
            await cleanupPendingUpload({ userId, storageId });
          } catch {
            // Best-effort cleanup only.
          }
          throw error;
        }
      }
    } catch (error) {
      Alert.alert('Upload failed', 'We could not add that photo. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveExtraPhoto = (url: string) => {
    if (isUploading || isSaving || isSyncingDraft) {
      return;
    }

    const previousUrls = selectedPhotoUrls;
    const nextUrls = selectedPhotoUrls.filter((existingUrl) => existingUrl !== url);
    const uploadedStorageId = sessionUploads[url];
    setSelectedPhotos(selectedPhotoIds, nextUrls);
    persistDraftPhotos(nextUrls)
      .then(async (persistedUrls) => {
        setSelectedPhotos(selectedPhotoIds, persistedUrls);
        if (uploadedStorageId && userId) {
          try {
            await cleanupPendingUpload({ userId, storageId: uploadedStorageId });
          } catch {
            // Best-effort cleanup only.
          }
          setSessionUploads((current) => {
            const next = { ...current };
            delete next[url];
            return next;
          });
        }
      })
      .catch(() => {
        setSelectedPhotos(selectedPhotoIds, previousUrls);
        Alert.alert('Unable to update photos', 'We could not save your photo selection. Please try again.');
      });
  };

  const handleContinue = async () => {
    if (!token || !canContinue) return;

    setIsSaving(true);
    try {
      const persistedUrls = await persistDraftPhotos(validSelectedPhotoUrls);

      setSelectedPhotos(selectedPhotoIds, persistedUrls);
      router.push(PHASE2_ONBOARDING_ROUTE_MAP['profile-edit'] as any);
    } catch (error) {
      Alert.alert(
        'Unable to continue',
        'Your Private Mode photos could not be saved. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose photos</Text>
        <Text style={styles.stepLabel}>Step 2 of 5</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Selected for Private Mode</Text>
          <Text style={styles.sectionSubtitle}>
            You need at least {PHASE2_MIN_PHOTOS} persisted photos before you can continue.
          </Text>

          {validSelectedPhotoUrls.length > 0 ? (
            <View style={styles.selectedGrid}>
              {validSelectedPhotoUrls.map((url, index) => {
                const isExtra = extraPhotoUrls.includes(url);
                return (
                  <View key={`${url}-${index}`} style={styles.selectedCard}>
                    <Image source={{ uri: url }} style={styles.selectedImage} contentFit="cover" />
                    <View style={styles.orderBadge}>
                      <Text style={styles.orderBadgeText}>{index + 1}</Text>
                    </View>
                    {isExtra ? (
                      <TouchableOpacity
                        style={styles.removeBadge}
                        onPress={() => handleRemoveExtraPhoto(url)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close" size={14} color="#FFFFFF" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="images-outline" size={42} color={C.textLight} />
              <Text style={styles.emptyTitle}>No photos selected yet</Text>
              <Text style={styles.emptyText}>Choose existing photos or add new ones from your phone.</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>From your main profile</Text>
            <TouchableOpacity style={styles.addPhoneButton} onPress={handleAddFromPhone} disabled={isUploading}>
              {isUploading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                  <Text style={styles.addPhoneButtonText}>Add from phone</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.sectionSubtitle}>
            Existing main-profile photos can be used directly. New photos upload and save to your Private Mode draft before you continue.
          </Text>

          {phase1Photos.length > 0 ? (
            <PhotoSelectionGrid
              photos={phase1Photos}
              selectedIds={selectedPhotoIds}
              onToggle={handleTogglePhase1Photo}
              maxSelection={MAX_PHASE2_PHOTOS}
              minSelection={PHASE2_MIN_PHOTOS}
            />
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="person-circle-outline" size={42} color={C.textLight} />
              <Text style={styles.emptyTitle}>No main-profile photos found</Text>
              <Text style={styles.emptyText}>Add new photos from your phone to continue.</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {!canContinue ? (
          <Text style={styles.bottomHint}>
            {validSelectedPhotoUrls.length < PHASE2_MIN_PHOTOS
              ? `Select ${PHASE2_MIN_PHOTOS - validSelectedPhotoUrls.length} more photo${PHASE2_MIN_PHOTOS - validSelectedPhotoUrls.length > 1 ? 's' : ''}`
              : isSyncingDraft
                ? 'Saving your photo draft...'
                : 'Finish any pending photo upload'}
          </Text>
        ) : (
          <Text style={styles.bottomHint}>
            {isSyncingDraft ? 'Saving your photo draft...' : 'Your selection order will be your Private Mode photo order.'}
          </Text>
        )}
        <TouchableOpacity
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.continueButtonText}>Continue to looking for</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  stepLabel: {
    fontSize: 12,
    color: C.textLight,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 20,
    marginBottom: 12,
  },
  selectedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  selectedCard: {
    width: '31%',
    aspectRatio: 0.78,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: C.surface,
    position: 'relative',
  },
  selectedImage: {
    width: '100%',
    height: '100%',
  },
  orderBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  removeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhoneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minWidth: 120,
  },
  addPhoneButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyState: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  emptyText: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
    textAlign: 'center',
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  bottomHint: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 10,
  },
  continueButton: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  continueButtonDisabled: {
    backgroundColor: C.surface,
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
