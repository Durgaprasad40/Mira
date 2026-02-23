import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useAuthStore } from '@/stores/authStore';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { isDemoMode, convex } from '@/hooks/useConvex';

export default function PhotoUploadScreen() {
  const { photos, reorderPhotos, setStep, setVerificationPhoto } = useOnboardingStore();
  const { userId } = useAuthStore();
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);

  // Convex mutations
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const uploadVerificationReferencePhoto = useMutation(api.photos.uploadVerificationReferencePhoto);

  // Local state for immediate preview update
  // SAFETY: Don't initialize from photos[0] - it may be stale from previous user
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  // SAFETY GUARD: Clear stale photos on mount if user is new (no face verification passed)
  // This prevents photos from previous sessions/users from appearing
  React.useEffect(() => {
    const { faceVerificationPassed } = useAuthStore.getState();

    // If user has NOT passed face verification, they are new/incomplete
    // Clear any stale photos that might have persisted
    if (!faceVerificationPassed && photos.length > 0) {
      console.log('[PHOTO_GATE] SAFETY: Clearing stale photos for new user');
      reorderPhotos([]);
    }
  }, []); // Run only on mount

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

    // Resize if needed
    let finalUri = asset.uri;
    if (asset.width > 2000 || asset.height > 2000) {
      const manipResult = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 2000 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      finalUri = manipResult.uri;
    }

    if (__DEV__) console.log(`[PHOTO] selected source=${source} uri=${finalUri}`);

    // Update local preview immediately for instant feedback
    setPreviewUri(finalUri);

    // REPLACE the first photo (not append) by setting photos array to just this one
    reorderPhotos([finalUri]);
  };

  const pickImage = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images' as const],
      allowsEditing: true,
      aspect: [1, 1],
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
      aspect: [1, 1],
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
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
