import React, { useCallback, useMemo, useState } from 'react';
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
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { uploadPhotoToConvex } from '@/lib/uploadUtils';
import { usePrivateProfileStore, PHASE2_MIN_PHOTOS } from '@/stores/privateProfileStore';
import { INCOGNITO_COLORS } from '@/lib/constants';
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
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);

  // FIX: Fetch Phase-1 photos DIRECTLY from Convex instead of relying on store hydration
  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId } : 'skip'
  );

  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const displayName = usePrivateProfileStore((s) => s.displayName);

  // Phase-1 imported fields (persist into Phase-2 skeleton on initial creation)
  // NOTE: age is NOT passed - backend derives it from users.dateOfBirth
  const height = usePrivateProfileStore((s) => s.height);
  const weight = usePrivateProfileStore((s) => s.weight);
  const smoking = usePrivateProfileStore((s) => s.smoking);
  const drinking = usePrivateProfileStore((s) => s.drinking);
  const education = usePrivateProfileStore((s) => s.education);
  const religion = usePrivateProfileStore((s) => s.religion);

  // FIX: Use dedicated saveOnboardingPhotos mutation that handles upsert
  const saveOnboardingPhotos = useMutation(api.privateProfiles.saveOnboardingPhotos);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const getStorageUrl = useMutation(api.photos.getStorageUrl);
  const trackPendingUpload = useMutation(api.photos.trackPendingUpload);
  const cleanupPendingUpload = useMutation(api.photos.cleanupPendingUpload);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [sessionUploads, setSessionUploads] = useState<Record<string, Id<'_storage'>>>({});

  // FIX: Build Phase-1 photos from the direct Convex query
  const phase1Photos = useMemo(() => {
    if (!currentUser?.photos || !Array.isArray(currentUser.photos)) {
      return [];
    }

    return currentUser.photos
      .filter((photo: any) => typeof photo?.url === 'string' && isPersistedPhotoUrl(photo.url))
      .map((photo: any, index: number) => ({
        id: photo._id || `p1_photo_${index}`,
        url: photo.url as string,
        order: photo.order ?? index,
      }))
      .sort((a, b) => a.order - b.order);
  }, [currentUser?.photos]);

  // Track which Phase-1 photo URLs are selected
  const selectedPhase1Urls = useMemo(
    () => selectedPhotoUrls.filter((url) => phase1Photos.some((p) => p.url === url)),
    [phase1Photos, selectedPhotoUrls]
  );

  // Track extra uploaded photos (not from Phase-1)
  const extraUploadedUrls = useMemo(
    () => selectedPhotoUrls.filter((url) => !phase1Photos.some((p) => p.url === url) && isPersistedPhotoUrl(url)),
    [phase1Photos, selectedPhotoUrls]
  );

  const validSelectedCount = selectedPhotoUrls.filter(isPersistedPhotoUrl).length;
  const photosNeeded = Math.max(0, PHASE2_MIN_PHOTOS - validSelectedCount);

  const canContinue = !!userId && !!token && validSelectedCount >= PHASE2_MIN_PHOTOS && !isSaving && !isUploading;

  const isLoading = currentUser === undefined;

  // Toggle selection of a Phase-1 photo
  const handleTogglePhoto = useCallback((photoUrl: string) => {
    if (isSaving || isUploading) return;

    const isSelected = selectedPhotoUrls.includes(photoUrl);

    if (isSelected) {
      // Deselect
      const nextUrls = selectedPhotoUrls.filter((url) => url !== photoUrl);
      setSelectedPhotos([], nextUrls);
    } else {
      // Select (if under max)
      if (selectedPhotoUrls.length >= MAX_PHASE2_PHOTOS) {
        Alert.alert('Maximum reached', `You can select up to ${MAX_PHASE2_PHOTOS} photos.`);
        return;
      }
      const nextUrls = [...selectedPhotoUrls, photoUrl];
      setSelectedPhotos([], nextUrls);
    }
  }, [isSaving, isUploading, selectedPhotoUrls, setSelectedPhotos]);

  // Add photo from phone (secondary option)
  const handleAddFromPhone = async () => {
    if (!userId || !token || isSaving || isUploading) return;

    if (selectedPhotoUrls.length >= MAX_PHASE2_PHOTOS) {
      Alert.alert('Maximum reached', `You can select up to ${MAX_PHASE2_PHOTOS} photos.`);
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
        setSelectedPhotos([], nextUrls);
        setSessionUploads((current) => ({
          ...current,
          [permanentUrl]: storageId,
        }));
      }
    } catch (error) {
      Alert.alert('Upload failed', 'We could not add that photo. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  // Remove an extra uploaded photo
  const handleRemoveExtraPhoto = useCallback(async (url: string) => {
    if (isSaving || isUploading) return;

    const nextUrls = selectedPhotoUrls.filter((u) => u !== url);
    setSelectedPhotos([], nextUrls);

    // Cleanup storage if this was a session upload
    const uploadedStorageId = sessionUploads[url];
    if (uploadedStorageId && userId) {
      try {
        await cleanupPendingUpload({ userId, storageId: uploadedStorageId });
        setSessionUploads((current) => {
          const next = { ...current };
          delete next[url];
          return next;
        });
      } catch {
        // Best-effort cleanup
      }
    }
  }, [cleanupPendingUpload, isSaving, isUploading, selectedPhotoUrls, sessionUploads, setSelectedPhotos, userId]);

  // Continue to next step - save ONLY selected photos
  const handleContinue = async () => {
    if (!userId || !canContinue) return;

    setIsSaving(true);
    try {
      const persistedUrls = selectedPhotoUrls.filter(isPersistedPhotoUrl);

      // DEBUG: Log save payload (remove after verification)
      if (__DEV__) {
        console.log('[P2_PHOTOS] Saving photos:', {
          authUserId: userId,
          photoCount: persistedUrls.length,
          urls: persistedUrls.map((u) => u.slice(-40)),
        });
      }

      const result = await saveOnboardingPhotos({
        token,
        authUserId: userId,
        privatePhotoUrls: persistedUrls,
        displayName: displayName || undefined,
        height,
        weight,
        smoking,
        drinking,
        education,
        religion,
      });

      // DEBUG: Log result (remove after verification)
      if (__DEV__) {
        console.log('[P2_PHOTOS] Save result:', result);
      }

      if (!result?.success) {
        const errorMsg = (result as any)?.error || 'unknown';
        console.warn('[P2_PHOTOS] Save failed:', errorMsg);
        throw new Error(`Photo save did not succeed: ${errorMsg}`);
      }

      router.push(PHASE2_ONBOARDING_ROUTE_MAP['profile-edit'] as any);
    } catch (error) {
      console.error('[P2_PHOTOS] Save error:', error);
      Alert.alert(
        'Unable to continue',
        'Your Private Mode photos could not be saved. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Loading your photos...</Text>
        </View>
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
        <Text style={styles.stepLabel}>Step 3 of 6</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Instructions */}
        <View style={styles.instructionCard}>
          <Text style={styles.instructionTitle}>Choose photos for Private Mode</Text>
          <Text style={styles.instructionText}>
            Select at least {PHASE2_MIN_PHOTOS} photos from your main profile. Only selected photos will be used in Private Mode.
          </Text>
        </View>

        {/* Phase-1 Photos Grid */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Profile Photos</Text>
            <Text style={styles.selectionCount}>
              {validSelectedCount} selected
            </Text>
          </View>

          {phase1Photos.length > 0 ? (
            <View style={styles.photoGrid}>
              {phase1Photos.map((photo) => {
                const isSelected = selectedPhotoUrls.includes(photo.url);
                return (
                  <TouchableOpacity
                    key={photo.id}
                    style={[styles.photoCard, isSelected && styles.photoCardSelected]}
                    onPress={() => handleTogglePhoto(photo.url)}
                    activeOpacity={0.8}
                  >
                    <Image source={{ uri: photo.url }} style={styles.photoImage} contentFit="cover" />
                    {isSelected && (
                      <View style={styles.selectedOverlay}>
                        <View style={styles.checkBadge}>
                          <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.noPhotosCard}>
              <Ionicons name="images-outline" size={48} color={C.textLight} />
              <Text style={styles.noPhotosTitle}>No profile photos found</Text>
              <Text style={styles.noPhotosText}>
                You can add new photos from your phone below.
              </Text>
            </View>
          )}
        </View>

        {/* Extra Uploaded Photos */}
        {extraUploadedUrls.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Added Photos</Text>
            <View style={styles.photoGrid}>
              {extraUploadedUrls.map((url, index) => (
                <View key={`extra_${index}`} style={[styles.photoCard, styles.photoCardSelected]}>
                  <Image source={{ uri: url }} style={styles.photoImage} contentFit="cover" />
                  <TouchableOpacity
                    style={styles.removeBadge}
                    onPress={() => handleRemoveExtraPhoto(url)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Add from Phone - Secondary Option */}
        <TouchableOpacity
          style={styles.addFromPhoneButton}
          onPress={handleAddFromPhone}
          disabled={isUploading}
          activeOpacity={0.7}
        >
          {isUploading ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={22} color={C.primary} />
              <Text style={styles.addFromPhoneText}>Add photo from phone</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom Bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <Text style={styles.bottomHint}>
          {photosNeeded > 0
            ? `Select ${photosNeeded} more photo${photosNeeded > 1 ? 's' : ''} to continue`
            : 'Your selected photos will be used in Private Mode'}
        </Text>
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
              <Text style={styles.continueButtonText}>Continue</Text>
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
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: C.textLight,
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
    paddingBottom: 24,
  },
  instructionCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  instructionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 6,
  },
  instructionText: {
    fontSize: 14,
    color: C.textLight,
    lineHeight: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  selectionCount: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '600',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoCard: {
    width: '31%',
    aspectRatio: 0.8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  photoCardSelected: {
    borderColor: C.primary,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: 6,
  },
  checkBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noPhotosCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  noPhotosTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginTop: 4,
  },
  noPhotosText: {
    fontSize: 13,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 18,
  },
  addFromPhoneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.primary,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addFromPhoneText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  bottomHint: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 10,
    textAlign: 'center',
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
