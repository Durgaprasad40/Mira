/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/photo-upload.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import React, { useState, useRef } from 'react';
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
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { isDemoMode, convex } from '@/hooks/useConvex';
import { isDemoAuthMode } from '@/config/demo';
import { ensureDemoUserConsent } from '@/lib/demoAuth';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { checkPhotoExists, getPhotoFileState, type PhotoFileState } from '@/lib/photoFileGuard';
import { decideNextOnboardingRoute, logOnboardingStatus } from '@/lib/onboardingRouting';
import { useScreenTrace } from '@/lib/devTrace';

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

/**
 * Check if a URI is a valid persistent photo URI (not a cache URI).
 * Returns true only if:
 * - Starts with file://
 * - Does NOT contain /cache/ or /Cache/
 * - Contains /Documents/ or the known PHOTOS_DIR path
 */
function isValidPersistentUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') return false;
  if (!uri.startsWith('file://')) return false;
  // Reject cache URIs (case-insensitive check)
  if (uri.toLowerCase().includes('/cache/')) return false;
  // Must be in Documents or our known photos dir
  const isInDocuments = uri.includes('/Documents/') || uri.includes('/files/');
  const isInPhotosDir = uri.includes('mira/photos/');
  return isInDocuments || isInPhotosDir;
}

// Copy cache URI to persistent storage
// Returns the persistent URI on success, or null on failure (NEVER returns cache URI)
async function persistPhoto(cacheUri: string): Promise<string | null> {
  try {
    await ensurePhotosDir();
    const filename = generatePhotoFilename();
    const persistentUri = PHOTOS_DIR + filename;

    await FileSystem.copyAsync({
      from: cacheUri,
      to: persistentUri,
    });

    // Validate the result before returning
    if (!isValidPersistentUri(persistentUri)) {
      console.error('[PHOTO] persistPhoto: result URI failed validation:', persistentUri);
      return null;
    }

    if (__DEV__) {
      console.log('[PHOTO] persisted:', { from: cacheUri.slice(-40), to: persistentUri });
    }

    return persistentUri;
  } catch (error) {
    // CRITICAL: Return null on failure, NOT the cache URI
    // Returning cache URI would cause the photo to be wiped on next app start
    console.error('[PHOTO] Failed to persist photo:', error);
    return null;
  }
}

export default function PhotoUploadScreen() {
  useScreenTrace("ONB_PHOTO_UPLOAD");
  const { photos, setPhotoAtIndex, setStep, setVerificationPhoto, clearAllPhotos, verificationPhotoUri } = useOnboardingStore();
  const { userId, token, faceVerificationPassed } = useAuthStore();
  const demoProfile = useDemoStore((s) => isDemoMode && userId ? s.demoProfiles[userId] : null);
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  // STABILITY FIX (2026-03-04): Single-flight guard to prevent concurrent uploads
  const uploadInProgressRef = useRef(false);

  // CRITICAL: Check if user is already verified (persisted in demoProfile for demo mode)
  const isAlreadyVerified = isDemoMode
    ? !!(demoProfile?.faceVerificationPassed || faceVerificationPassed)
    : faceVerificationPassed;

  // Convex mutations
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const uploadVerificationReferencePhoto = useMutation(api.photos.uploadVerificationReferencePhoto);
  const acceptConsent = useMutation(api.auth.acceptConsent);

  // C4 FIX: queryEnabled allows retry by toggling the query subscription
  const [queryEnabled, setQueryEnabled] = useState(true);

  // BUG FIX: Query onboarding status to check if reference photo already exists
  // C4 FIX: Include queryEnabled in skip condition to allow forced re-subscription
  const onboardingStatus = useQuery(
    api.users.getOnboardingStatus,
    !isDemoMode && userId && token && queryEnabled ? { token, userId } : 'skip'
  );

  // Local state for immediate preview update
  // SAFETY: Don't initialize from photos[0] - it may be stale from previous user
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  // C4 FIX: Track loading timeout to prevent infinite loading state
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  // C4 FIX: Ref to track re-enable timer for cleanup on unmount
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // C4 FIX: Cleanup re-enable timer on unmount
  React.useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  // C4 FIX: Retry handler - toggles queryEnabled to force fresh Convex subscription
  const handleLoadingRetry = React.useCallback(() => {
    // Clear any existing retry timer
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
    }
    setLoadingTimedOut(false);
    setQueryEnabled(false);
    // Re-enable after brief delay to force Convex to create new subscription
    retryTimerRef.current = setTimeout(() => {
      setQueryEnabled(true);
      retryTimerRef.current = null;
    }, 50);
  }, []);

  // C4 FIX: Set timeout after 8s of loading to show retry UI
  // Only start timer when queryEnabled is true and query is still loading
  React.useEffect(() => {
    if (!isDemoMode && queryEnabled && onboardingStatus === undefined) {
      const timer = setTimeout(() => {
        setLoadingTimedOut(true);
        console.warn('[PHOTO_UPLOAD] C4: Loading timeout after 8s');
      }, 8000);
      return () => clearTimeout(timer);
    }
    // Reset timeout flag if query resolves OR during retry (queryEnabled=false)
    if (onboardingStatus !== undefined || !queryEnabled) {
      setLoadingTimedOut(false);
    }
  }, [isDemoMode, queryEnabled, onboardingStatus]);

  // TASK 2: File existence guard - track if displayed photo file exists
  const [photoFileState, setPhotoFileState] = useState<PhotoFileState>('empty');

  // BUG FIX: Skip this screen if reference photo already exists OR user is already verified
  const didSkipRef = React.useRef(false);
  React.useEffect(() => {
    // Demo mode: skip if verified
    if (isDemoMode && isAlreadyVerified && !didSkipRef.current) {
      didSkipRef.current = true;
      console.log('[REF_PHOTO] Demo mode: verified -> skip to face-verification');
      setStep('face_verification');
      router.replace('/(onboarding)/face-verification' as any);
      return;
    }

    // Live mode: skip if reference photo already exists
    // CRITICAL: Wait for onboardingStatus to load (not undefined)
    if (!isDemoMode && onboardingStatus !== undefined) {
      if (onboardingStatus && onboardingStatus.referencePhotoExists && !didSkipRef.current) {
        didSkipRef.current = true;
        console.log('[REF_PHOTO] skip_upload_already_exists=true');

        // Log current status for debugging
        logOnboardingStatus(onboardingStatus, 'photo-upload-skip');

        // Use centralized routing helper
        const nextRoute = decideNextOnboardingRoute(onboardingStatus);
        console.log(`[ONB_ROUTE] Skipping to: ${nextRoute}`);

        // Update store step based on route
        if (nextRoute.includes('face-verification')) {
          setStep('face_verification');
        } else if (nextRoute.includes('additional-photos')) {
          setStep('additional_photos');
        }

        router.replace(nextRoute as any);
      }
    }
  }, [isDemoMode, isAlreadyVerified, onboardingStatus, setStep, router]);

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
    const referenceSet = !!(previewUri || verificationPhotoUri);
    console.log(`[PHOTO_GATE] referenceSet=${referenceSet} previewUri=${!!previewUri} verificationPhotoUri=${!!verificationPhotoUri} userId=${userId}`);
  }, [previewUri, verificationPhotoUri, userId]);

  // TASK 2: Check file existence when displayUri changes
  // This runs proactively BEFORE rendering to detect missing files
  // CRITICAL: We only FLAG missing files - we NEVER delete the URI from AsyncStorage
  React.useEffect(() => {
    const currentUri = previewUri || verificationPhotoUri;

    async function checkFileState() {
      const state = await getPhotoFileState(currentUri);
      setPhotoFileState(state);

      if (state === 'missing' && __DEV__) {
        console.warn('[PHOTO_GUARD] Verification photo file missing - user needs to re-upload');
      } else if (state === 'invalid' && __DEV__) {
        console.warn('[PHOTO_GUARD] Verification photo has invalid URI (cache/remote) - user should re-upload');
      }
    }

    checkFileState();
  }, [previewUri, verificationPhotoUri]);

  const requestPermissions = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photos to upload your profile picture.');
      return false;
    }
    return true;
  };

  // ════════════════════════════════════════════════════════════════════════
  // PHASE-1 PROFILE PHOTOS ARE BACKEND-OWNED. LOCAL FILES ARE CACHE ONLY.
  // ════════════════════════════════════════════════════════════════════════
  // HARD LOCK: Verification photo MUST be uploaded to Convex immediately
  // ════════════════════════════════════════════════════════════════════════

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

    // HARD LOCK: Copy to local cache for immediate preview ONLY
    // This is NOT permanent storage - Convex backend is source of truth
    const persistentUri = await persistPhoto(cacheUri);

    if (!persistentUri) {
      Alert.alert(
        'Photo Save Failed',
        'We couldn\'t save this photo permanently. Please try again.',
        [{ text: 'OK' }]
      );
      console.error('[PHOTO] processAndSetPhoto: persistPhoto returned null, not saving');
      return;
    }

    if (!isValidPersistentUri(persistentUri)) {
      Alert.alert(
        'Photo Save Failed',
        'The saved photo path is invalid. Please try again.',
        [{ text: 'OK' }]
      );
      console.error('[PHOTO] processAndSetPhoto: URI failed validation:', persistentUri);
      return;
    }

    // BUG FIX: Upload moved to handleNext() to use correct mutation
    // Photo will be uploaded to Convex when user clicks Continue
    // This ensures we use uploadVerificationReferencePhoto (NOT addPhoto)
    if (__DEV__) {
      console.log('[PHOTO_GATE] Photo cached locally. Will upload to Convex on Continue.');
    }

    // Store local URI as cache ONLY (NOT source of truth)
    // FIX: Use setVerificationPhoto instead of setPhotoAtIndex(0, ...) to avoid
    // polluting the photos[] array which causes "still syncing" false positive
    // in additional-photos.tsx when backendNormalCount < localFilledCount
    setPreviewUri(persistentUri);
    setVerificationPhoto(persistentUri);
    console.log('[PHOTO_GATE] DEBUG: Photo cached locally, verificationPhotoUri set');
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
    // STABILITY FIX (2026-03-04): Prevent concurrent uploads with single-flight guard
    if (uploadInProgressRef.current) {
      console.log('[PHOTO_GATE] BLOCKED: Upload already in progress');
      return;
    }
    uploadInProgressRef.current = true;

    // STABILITY FIX (2026-03-04): Validate userId BEFORE checking photo to fail fast
    if (!userId) {
      console.log('[PHOTO_GATE] BLOCKED: No userId');
      Alert.alert('Error', 'Please log in first.');
      uploadInProgressRef.current = false;
      return;
    }

    const currentPhoto = previewUri || verificationPhotoUri;
    if (!currentPhoto) {
      console.log('[PHOTO_GATE] BLOCKED: No photo uploaded');
      Alert.alert(
        'Photo Required',
        'Please upload a clear photo of yourself with your face visible. This is required for verification.',
        [{ text: 'OK' }]
      );
      uploadInProgressRef.current = false;
      return;
    }

    // =========================================================================
    // DEMO AUTH MODE: Upload to Convex (same as live mode) for proper backend state
    // This ensures referencePhotoExists is properly set in Convex
    // =========================================================================
    if (isDemoAuthMode) {
      console.log('[DEMO_AUTH] PHOTO: Uploading to Convex in demo auth mode');
      setIsUploading(true);

      try {
        // Step 0: CRITICAL - Ensure consent is set before upload
        // ROOT CAUSE FIX: On app resume, consent may not be set (user from before fix)
        if (token) {
          console.log('[DEMO_AUTH] PHOTO: Ensuring consent is set...');
          const consentOk = await ensureDemoUserConsent(token);
          if (!consentOk) {
            console.error('[DEMO_AUTH] PHOTO: Consent verification FAILED - aborting upload');
            throw new Error('Could not verify user consent. Please restart the app and try again.');
          }
          console.log('[DEMO_AUTH] PHOTO: Consent confirmed');
        }

        // Step 1: Upload photo to Convex storage (same as live mode)
        if (!token) {
          throw new Error('Session expired. Please sign in again.');
        }
        const uploadUrl = await generateUploadUrl({ token });
        const response = await fetch(currentPhoto);
        const blob = await response.blob();

        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'image/jpeg' },
          body: blob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const uploadResult = await uploadResponse.json();
        const storageId = uploadResult.storageId as Id<'_storage'>;
        console.log(`[DEMO_AUTH] PHOTO: Uploaded to storage, storageId=${storageId}`);

        // Step 2: Set verification reference photo in Convex
        // P1-PROFILE: uploadVerificationReferencePhoto now requires a session
        // token to prevent IDOR overwrite of another user's reference photo.
        if (!token) {
          throw new Error('Session expired. Please sign in again.');
        }
        const result = await uploadVerificationReferencePhoto({
          token,
          userId: userId as Id<'users'>,
          storageId,
          hasFace: true,
          faceCount: 1,
        });

        if (!result.success) {
          throw new Error(result.message || 'Failed to set reference photo');
        }

        console.log('[DEMO_AUTH] PHOTO: Reference photo set in Convex');
        setVerificationPhoto(currentPhoto);

        setStep('face_verification');
        router.push('/(onboarding)/face-verification' as any);
      } catch (error: any) {
        console.error('[DEMO_AUTH] PHOTO: Upload error:', error);
        Alert.alert('Upload Failed', error.message || 'Please try again.');
      } finally {
        setIsUploading(false);
        uploadInProgressRef.current = false;
      }
      return;
    }

    // =========================================================================
    // LEGACY DEMO MODE: skip Convex upload, use local storage only
    // Face verification in demo mode uses mockVerify which doesn't check reference photo
    // =========================================================================
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
      uploadInProgressRef.current = false; // STABILITY FIX (2026-03-04): Reset guard before return
      return;
    }

    // Live mode: upload to Convex
    setIsUploading(true);
    console.log(`[PHOTO_GATE] Starting upload for userId=${userId}`);

    try {
      // Step 0: Ensure consent is persisted before upload.
      // ROOT CAUSE FIX: welcome.tsx shows "By continuing, you agree to our
      // Terms of Service and Privacy Policy" (implicit consent), but the
      // consent.tsx screen is not in the active onboarding flow, so
      // consentAcceptedAt is never written. Backend PHOTO_GATE requires it.
      // acceptConsent is idempotent (returns alreadyAccepted if set).
      console.log('[PHOTO_GATE] Ensuring consent is persisted...');
      await acceptConsent({ userId: userId as Id<'users'> });
      console.log('[PHOTO_GATE] Consent confirmed');

      // Step 1: Upload photo to Convex storage
      console.log('[PHOTO_GATE] Getting upload URL...');
      if (!token) {
        throw new Error('Session expired. Please sign in again.');
      }
      const uploadUrl = await generateUploadUrl({ token });

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
      // BUG FIX: Use uploadVerificationReferencePhoto (NOT addPhoto)
      // This mutation does NOT count towards the 9-photo limit
      console.log('[PHOTO_GATE] uploading verification reference photo using uploadVerificationReferencePhoto (NOT addPhoto)');
      // P1-PROFILE: uploadVerificationReferencePhoto now requires a session
      // token to prevent IDOR overwrite of another user's reference photo.
      const result = await uploadVerificationReferencePhoto({
        token,
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
      // P1-PROFILE: getPhotoGateStatus now requires a session token to
      // prevent anonymous enumeration of any user's gate state.
      console.log('[PHOTO_GATE] Querying gate status...');
      const gateStatus = await convex.query(api.photos.getPhotoGateStatus, {
        token,
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
      uploadInProgressRef.current = false; // STABILITY FIX (2026-03-04): Reset guard in finally
    }
  };

  // Use local previewUri for immediate updates, fallback to verificationPhotoUri
  // FIX: Use verificationPhotoUri instead of photos[0] to avoid syncing bug
  const displayUri = previewUri || verificationPhotoUri;

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

  // LOADING STATE: Wait for onboardingStatus in live mode to prevent race conditions
  // C4 FIX: Show retry UI after timeout instead of infinite loading
  if (!isDemoMode && onboardingStatus === undefined) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <OnboardingProgressHeader />
        <View style={styles.content}>
          {loadingTimedOut ? (
            <View style={styles.loadingFallback}>
              <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textLight} />
              <Text style={styles.loadingText}>Unable to load profile data</Text>
              <Button
                title="Try Again"
                variant="outline"
                onPress={handleLoadingRetry}
                style={{ marginTop: 16 }}
              />
            </View>
          ) : (
            <Text style={styles.loadingText}>Loading...</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <OnboardingProgressHeader />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Reference Photo</Text>
        <Text style={styles.subtitle}>
          Upload a clear photo of your face so we can confirm you're a real person. This photo is only used for verification and will not appear on your profile.
        </Text>

        <View style={styles.photoContainer}>
          {displayUri && photoFileState === 'exists' ? (
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
          ) : displayUri && (photoFileState === 'missing' || photoFileState === 'invalid') ? (
            <View style={styles.placeholder}>
              <Ionicons name="alert-circle" size={64} color={COLORS.error} />
              <Text style={styles.placeholderText}>Photo file missing</Text>
              <Text style={styles.missingHint}>Please upload a new photo</Text>
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
            <Text style={styles.requirementText}>Use a clear front-facing photo</Text>
          </View>
          <View style={styles.requirementItem}>
            <Ionicons name="sunny" size={18} color={COLORS.text} />
            <Text style={styles.requirementText}>Use good, even lighting</Text>
          </View>
          <View style={styles.requirementItem}>
            <Ionicons name="glasses-outline" size={18} color={COLORS.text} />
            <Text style={styles.requirementText}>No sunglasses, masks, or heavy filters</Text>
          </View>
          <View style={styles.requirementItem}>
            <Ionicons name="people-outline" size={18} color={COLORS.text} />
            <Text style={styles.requirementText}>One person only — no group photos</Text>
          </View>
          <View style={styles.requirementItem}>
            <Ionicons name="phone-portrait-outline" size={18} color={COLORS.text} />
            <Text style={styles.requirementText}>No screenshots or photos-of-photos</Text>
          </View>
        </View>

        {/* Privacy Note */}
        <View style={styles.privacyNote}>
          <View style={styles.privacyHeader}>
            <Ionicons name="lock-closed" size={18} color={COLORS.primary} />
            <Text style={styles.privacyTitle}>Private Reference Photo</Text>
          </View>
          <Text style={styles.privacyText}>
            Your reference photo is stored privately and is not shown to other users. It is used only to confirm you're a real person.
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
    padding: 24,
    paddingTop: 10,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    marginBottom: 20,
    lineHeight: 22,
  },
  photoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  photoPreview: {
    width: 200,
    height: 200,
    borderRadius: 100,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: COLORS.primary,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoCheckmark: {
    position: 'absolute',
    bottom: 10,
    right: 10,
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
    color: COLORS.textMuted,
    marginTop: 10,
  },
  missingHint: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '500',
  },
  actions: {
    gap: 12,
    marginBottom: 20,
  },
  actionButton: {
    marginBottom: 0,
  },
  requirements: {
    backgroundColor: COLORS.backgroundDark,
    padding: 18,
    borderRadius: 16,
    marginBottom: 14,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  requirementText: {
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
    lineHeight: 18,
  },
  privacyNote: {
    backgroundColor: 'rgba(255, 107, 107, 0.08)',
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
    marginBottom: 20,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  privacyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    letterSpacing: -0.2,
  },
  privacyText: {
    fontSize: 13,
    color: COLORS.text,
    marginBottom: 8,
    lineHeight: 19,
  },
  privacyOption: {
    fontSize: 13,
    color: COLORS.text,
    marginLeft: 10,
    lineHeight: 20,
  },
  privacyFooter: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 10,
    fontStyle: 'italic',
  },
  footer: {
    marginTop: 12,
    paddingTop: 12,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 40,
  },
  // C4 FIX: Fallback UI container for timeout state
  loadingFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },
});
