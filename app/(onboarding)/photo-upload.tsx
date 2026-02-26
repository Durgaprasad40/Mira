import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { isDemoMode, convex } from '@/hooks/useConvex';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';

// Persistent photos directory - files here survive app restarts
const PHOTOS_DIR = FileSystem.documentDirectory + 'mira/photos/';

// Ensure photos directory exists
async function ensurePhotosDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(PHOTOS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  }
}

// Generate unique filename
function generatePhotoFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `photo_${timestamp}_${random}.jpg`;
}

// Copy cache URI to persistent storage
// Returns the persistent URI, or falls back to original if copy fails
async function persistPhoto(cacheUri: string): Promise<string> {
  try {
    await ensurePhotosDir();
    const filename = generatePhotoFilename();
    const persistentUri = PHOTOS_DIR + filename;

    await FileSystem.copyAsync({
      from: cacheUri,
      to: persistentUri,
    });

    if (__DEV__) {
      console.log('[PHOTO] persisted:', { from: cacheUri.slice(-40), to: persistentUri });
    }

    return persistentUri;
  } catch (error) {
    console.error('[PHOTO] Failed to persist photo, using cache URI:', error);
    return cacheUri;
  }
}

export default function PhotoUploadScreen() {
  const { photos, setPhotoAtIndex, setStep, setVerificationPhoto, clearAllPhotos } = useOnboardingStore();
  const { userId, faceVerificationPassed } = useAuthStore();
  const demoProfile = useDemoStore((s) => isDemoMode && userId ? s.demoProfiles[userId] : null);
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);

  // CRITICAL: Check if user is already verified (persisted in demoProfile for demo mode)
  const isAlreadyVerified = isDemoMode
    ? !!(demoProfile?.faceVerificationPassed || faceVerificationPassed)
    : faceVerificationPassed;

  // Convex mutations
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const uploadVerificationReferencePhoto = useMutation(api.photos.uploadVerificationReferencePhoto);

  // Local state for immediate preview update
  // SAFETY: Don't initialize from photos[0] - it may be stale from previous user
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  // CRITICAL: Skip this screen if user is already verified - redirect immediately
  const didSkipRef = React.useRef(false);
  React.useEffect(() => {
    if (isAlreadyVerified && !didSkipRef.current) {
      didSkipRef.current = true;
      console.log('[PHOTO_GATE] facePassed=true -> skip photo-upload -> additional-photos');
      setStep('additional_photos');
      router.replace('/(onboarding)/additional-photos' as any);
    }
  }, [isAlreadyVerified, setStep, router]);

  // SAFETY GUARD: Only clear photos if user is NEW (never verified) AND photos exist
  // Do NOT clear if user is already verified - they should keep their photos
  React.useEffect(() => {
    // Skip if already verified - never clear photos for verified users
    if (isAlreadyVerified) return;

    // Check if demoProfile has photos for this user - if so, don't clear
    if (isDemoMode && demoProfile?.photos && demoProfile.photos.length > 0) {
      console.log('[PHOTO_GATE] demoProfile has photos, not clearing');
      return;
    }

    // Only clear if truly stale (different user scenario, which shouldn't happen normally)
    // This guard is now very conservative - only clears if no verification and no demoProfile photos
  }, [isAlreadyVerified, demoProfile]); // Run only on mount

  // Debug: Log photo gate status on mount
  React.useEffect(() => {
    const referenceSet = !!(previewUri || photos[0]);
    console.log(`[PHOTO_GATE] referenceSet=${referenceSet} previewUri=${!!previewUri} photos[0]=${!!photos[0]} userId=${userId}`);
  }, [previewUri, photos, userId]);

  const requestPermissions = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photos to upload your profile picture.');
      return false;
    }
    return true;
  };

  const processAndSetPhoto = async (asset: ImagePicker.ImagePickerAsset, source: 'gallery' | 'camera') => {
    // Check minimum size
    if (asset.width < VALIDATION.MIN_PHOTO_SIZE || asset.height < VALIDATION.MIN_PHOTO_SIZE) {
      Alert.alert(
        'Image Too Small',
        `Please upload an image that is at least ${VALIDATION.MIN_PHOTO_SIZE}x${VALIDATION.MIN_PHOTO_SIZE} pixels.`
      );
      return;
    }

    // Resize if needed (creates cache URI via ImageManipulator)
    let cacheUri = asset.uri;
    if (asset.width > 2000 || asset.height > 2000) {
      const manipResult = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 2000 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      cacheUri = manipResult.uri;
    }

    // CRITICAL: Copy to persistent storage so photo survives app relaunch
    // ImageManipulator cache URIs are cleared on app restart
    const persistentUri = await persistPhoto(cacheUri);

    // Update local preview immediately for instant feedback
    setPreviewUri(persistentUri);

    // Set first photo slot only (preserves existing photos at other slots)
    setPhotoAtIndex(0, persistentUri);

    // DEBUG: Log final stored URI - must start with documentDirectory, NOT /cache/
    if (__DEV__) {
      const isValidPersistent = persistentUri.includes('/Documents/') || persistentUri.includes('/files/');
      const isStaleCache = persistentUri.includes('/cache/ImageManipulator/') || persistentUri.includes('/Cache/');
      console.log(`[PHOTO] STORED URI CHECK:`, {
        source,
        uri: persistentUri,
        isValidPersistent,
        isStaleCache: isStaleCache ? 'WARNING: STILL CACHE!' : 'OK',
      });
    }
  };

  const pickImage = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images' as const],
      allowsEditing: true,
      aspect: [2, 3], // Portrait 4x6 aspect ratio
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await processAndSetPhoto(result.assets[0], 'gallery');
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow camera access to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [2, 3], // Portrait 4x6 aspect ratio
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await processAndSetPhoto(result.assets[0], 'camera');
    }
  };

  const handleNext = async () => {
    const currentPhoto = previewUri || photos[0];
    if (!currentPhoto) {
      console.log('[PHOTO_GATE] BLOCKED: No photo uploaded');
      Alert.alert(
        'Photo Required',
        'Please upload a clear photo of yourself with your face visible. This is required for verification.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (!userId) {
      console.log('[PHOTO_GATE] BLOCKED: No userId');
      Alert.alert('Error', 'Please log in first.');
      return;
    }

    // Demo mode: skip Convex upload, use local storage only
    // Face verification in demo mode uses mockVerify which doesn't check reference photo
    if (isDemoMode) {
      console.log('[PHOTO_GATE] DEMO MODE: Skipping Convex upload, using local storage');
      setVerificationPhoto(currentPhoto);

      // SAVE-AS-YOU-GO: Persist verification photo to demoProfile
      // This ensures the photo persists across force close/relaunch
      const demoStore = useDemoStore.getState();
      const existingPhotos = demoStore.demoProfiles[userId]?.photos || [];
      // Merge: set index 0 to current photo, keep other photos if they exist
      const newPhotos = [...existingPhotos];
      newPhotos[0] = { url: currentPhoto };
      demoStore.saveDemoProfile(userId, { photos: newPhotos });
      console.log(`[PHOTO_GATE] saved verification photo to demoProfile photos[0]`);

      setStep('face_verification');
      router.push('/(onboarding)/face-verification' as any);
      return;
    }

    // Live mode: upload to Convex
    setIsUploading(true);
    console.log(`[PHOTO_GATE] Starting upload for userId=${userId}`);

    try {
      // Step 1: Upload photo to Convex storage
      console.log('[PHOTO_GATE] Getting upload URL...');
      const uploadUrl = await generateUploadUrl();

      console.log('[PHOTO_GATE] Fetching image blob...');
      const response = await fetch(currentPhoto);
      const blob = await response.blob();

      console.log(`[PHOTO_GATE] Uploading to storage... size=${blob.size} type=${blob.type}`);
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': blob.type || 'image/jpeg',
        },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json();
      const storageId = uploadResult.storageId as Id<'_storage'>;
      console.log(`[PHOTO_GATE] Uploaded to storage, storageId=${storageId}`);

      // Step 2: Call the mutation to set verification reference photo
      console.log('[PHOTO_GATE] Calling uploadVerificationReferencePhoto mutation...');
      const result = await uploadVerificationReferencePhoto({
        userId: userId as Id<'users'>,
        storageId,
        hasFace: true, // Face validation happens server-side in face verification
        faceCount: 1,
      });

      console.log('[PHOTO_GATE] Mutation result:', JSON.stringify(result));

      if (!result.success) {
        Alert.alert('Photo Upload Failed', result.message || 'Please try again with a different photo.');
        setIsUploading(false);
        return;
      }

      // Step 3: Query photo gate status for debugging
      console.log('[PHOTO_GATE] Querying gate status...');
      const gateStatus = await convex.query(api.photos.getPhotoGateStatus, {
        userId: userId as Id<'users'>,
      });
      console.log('[PHOTO_GATE] status:', JSON.stringify(gateStatus));

      // Step 4: Store locally and navigate
      setVerificationPhoto(currentPhoto);
      console.log('[PHOTO_GATE] PASS: Photo uploaded to server, proceeding to face verification');
      console.log(`[PHOTO_GATE] verificationReferencePhotoId=${gateStatus.verificationReferencePhotoId}`);

      setStep('face_verification');
      router.push('/(onboarding)/face-verification' as any);

    } catch (error: any) {
      console.error('[PHOTO_GATE] Upload error:', error);
      Alert.alert('Upload Failed', error.message || 'Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  // Use local previewUri for immediate updates, fallback to store
  const displayUri = previewUri || photos[0];

  // DEV: Reset all photos (for testing stale cache migration)
  const handleResetPhotos = () => {
    Alert.alert(
      'Reset Photos',
      'This will clear ALL photos from onboardingStore and demoProfile. You will need to re-select photos.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            // Clear onboardingStore photos
            clearAllPhotos();
            // Clear local preview
            setPreviewUri(null);
            // Clear demoProfile photos if in demo mode
            if (isDemoMode && userId) {
              useDemoStore.getState().saveDemoProfile(userId, { photos: [] });
            }
            console.log('[PHOTO] DEV: All photos cleared');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <OnboardingProgressHeader />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Upload your verification photo</Text>
        <Text style={styles.subtitle}>
          This photo is used to verify your identity. After verification, you can choose to show a blurred or cartoon version instead.
        </Text>

        <View style={styles.photoContainer}>
          {displayUri ? (
            <View style={styles.photoPreview}>
              <Image
                source={{ uri: displayUri }}
                style={styles.photo}
                key={displayUri}
                contentFit="cover"
                cachePolicy="none"
              />
              <View style={styles.photoCheckmark}>
                <Ionicons name="checkmark-circle" size={28} color={COLORS.success} />
              </View>
            </View>
          ) : (
            <View style={styles.placeholder}>
              <Ionicons name="camera" size={64} color={COLORS.textLight} />
              <Text style={styles.placeholderText}>No photo yet</Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          <Button
            title="Take Photo"
            variant="outline"
            onPress={takePhoto}
            icon={<Ionicons name="camera" size={20} color={COLORS.primary} />}
            style={styles.actionButton}
          />
          <Button
            title="Choose from Gallery"
            variant="primary"
            onPress={pickImage}
            icon={<Ionicons name="images" size={20} color={COLORS.white} />}
            style={styles.actionButton}
          />
        </View>

        {/* DEV: Reset Photos button */}
        {__DEV__ && (
          <Button
            title="Reset Photos (DEV)"
            variant="outline"
            onPress={handleResetPhotos}
            icon={<Ionicons name="trash-outline" size={20} color={COLORS.error} />}
            style={{ ...styles.actionButton, borderColor: COLORS.error, marginBottom: 16 }}
          />
        )}

        {/* Photo Requirements */}
        <View style={styles.requirements}>
          <Text style={styles.requirementsTitle}>
            <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} /> Photo Requirements
          </Text>
          <View style={styles.requirementItem}>
            <MaterialCommunityIcons name="face-recognition" size={18} color={COLORS.text} />
            <Text style={styles.requirementText}>Clear, solo photo with your face visible</Text>
          </View>
          <View style={styles.requirementItem}>
            <Ionicons name="sunny" size={18} color={COLORS.text} />
            <Text style={styles.requirementText}>Good lighting, no blur or shadows</Text>
          </View>
          <View style={styles.requirementItem}>
            <Ionicons name="close-circle" size={18} color={COLORS.error} />
            <Text style={styles.requirementText}>No group photos or covered faces</Text>
          </View>
        </View>

        {/* Privacy Note */}
        <View style={styles.privacyNote}>
          <View style={styles.privacyHeader}>
            <Ionicons name="lock-closed" size={18} color={COLORS.primary} />
            <Text style={styles.privacyTitle}>Your Privacy After Verification</Text>
          </View>
          <Text style={styles.privacyText}>
            After face verification, you can choose to:
          </Text>
          <Text style={styles.privacyOption}>• Show your original photo</Text>
          <Text style={styles.privacyOption}>• Use a blurred version</Text>
          <Text style={styles.privacyOption}>• Use a cartoon avatar</Text>
          <Text style={styles.privacyFooter}>
            Your verification photo is kept private and only used to confirm your identity.
          </Text>
        </View>

        <View style={styles.footer}>
          <Button
            title={isUploading ? "Uploading..." : "Continue to Verification"}
            variant="primary"
            onPress={handleNext}
            disabled={!displayUri || isUploading}
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
    lineHeight: 20,
  },
  photoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  photoPreview: {
    width: 200,
    height: 200,
    borderRadius: 100,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: COLORS.primary,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoCheckmark: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: COLORS.white,
    borderRadius: 14,
  },
  placeholder: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  placeholderText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
  },
  actions: {
    gap: 10,
    marginBottom: 16,
  },
  actionButton: {
    marginBottom: 0,
  },
  requirements: {
    backgroundColor: COLORS.backgroundDark,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 10,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
  },
  privacyNote: {
    backgroundColor: COLORS.primaryLight,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    marginBottom: 16,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  privacyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  privacyText: {
    fontSize: 12,
    color: COLORS.text,
    marginBottom: 6,
  },
  privacyOption: {
    fontSize: 12,
    color: COLORS.text,
    marginLeft: 8,
    lineHeight: 18,
  },
  privacyFooter: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 8,
    fontStyle: 'italic',
  },
  footer: {
    marginTop: 8,
    paddingTop: 12,
  },
});
