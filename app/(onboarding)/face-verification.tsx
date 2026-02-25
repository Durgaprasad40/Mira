import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import Animated, { useAnimatedStyle, withTiming, useSharedValue } from 'react-native-reanimated';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { Ionicons } from '@expo/vector-icons';
import { verifyFace, type CapturedFrame, type FaceMatchStatus, type FaceMatchReasonCode } from '@/services/faceVerification';
import { isDemoMode } from '@/hooks/useConvex';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';

// =============================================================================
// Constants
// =============================================================================

const FRAME_COUNT = 3;
const CAPTURE_INTERVAL_MS = 800; // ~2.4s total for 3 frames

// =============================================================================
// Types
// =============================================================================

type VerificationState =
  | 'waiting'   // Waiting for face to be positioned
  | 'capturing' // Capturing 3 frames
  | 'verifying' // Sending to backend for face comparison
  | 'success'   // Verification passed (face matches profile photo)
  | 'pending'   // Pending manual review (uncertain match)
  | 'failed';   // Verification failed (face mismatch or error)

// =============================================================================
// Component
// =============================================================================

export default function FaceVerificationScreen() {
  const { photos, setStep } = useOnboardingStore();
  const { userId, faceVerificationPassed, setFaceVerificationPassed, setFaceVerificationPending } = useAuthStore();
  const demoProfile = useDemoStore((s) => isDemoMode && userId ? s.demoProfiles[userId] : null);
  const router = useRouter();

  // CRITICAL: Check demoProfile.faceVerificationPassed for demo mode (persisted across logout)
  const isAlreadyVerified = isDemoMode
    ? !!(demoProfile?.faceVerificationPassed || faceVerificationPassed)
    : faceVerificationPassed;

  // Camera
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);

  // State - initialize to 'success' if already verified (prevents re-verification on back)
  const [verificationState, setVerificationState] = useState<VerificationState>(
    isAlreadyVerified ? 'success' : 'waiting'
  );

  // CRITICAL: Skip verification entirely if already verified - redirect immediately
  const didSkipRef = useRef(false);
  useEffect(() => {
    if (isAlreadyVerified && !didSkipRef.current) {
      didSkipRef.current = true;
      console.log('[FaceDebug] facePassed=true -> skip capture -> additional-photos');
      setStep('additional_photos');
      router.replace('/(onboarding)/additional-photos' as any);
    }
  }, [isAlreadyVerified, setStep, router]);
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([]);
  const [framesCaptured, setFramesCaptured] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [isPermissionBlocked, setIsPermissionBlocked] = useState(false);
  const [failReasonCode, setFailReasonCode] = useState<FaceMatchReasonCode | null>(null);

  // Manual capture mode - user taps button to start
  const isCapturing = useSharedValue(false);

  // Animated circle color (stays primary in manual mode, green when capturing)
  const circleColor = useAnimatedStyle(() => ({
    borderColor: withTiming(isCapturing.value ? '#4CAF50' : COLORS.primary, { duration: 200 }),
  }));

  // =============================================================================
  // Debug logging and gate check - waits for hydration before blocking
  // =============================================================================

  // Track if we've already shown the "no photo" alert to prevent spam
  const didShowNoPhotoAlertRef = useRef(false);

  // Get hydration state to avoid checking before store is ready
  const storeHydrated = useOnboardingStore((s) => s._hasHydrated);

  useEffect(() => {
    const referencePhotoPresent = !!(photos && photos.length > 0 && photos[0]);
    console.log('[FaceDebug] ========================================');
    console.log('[FaceDebug] Face Verification screen check');
    console.log('[FaceDebug] userId:', userId);
    console.log('[FaceDebug] storeHydrated:', storeHydrated);
    console.log('[FaceDebug] profilePhotos:', photos.length);
    console.log(`[FaceDebug] referencePhotoPresent=${referencePhotoPresent}`);
    console.log('[FaceDebug] ========================================');

    // GATE CHECK: Wait for store hydration before blocking user
    // This prevents false positives when photos haven't loaded yet
    if (!storeHydrated) {
      console.log('[FaceDebug] Store not hydrated yet, waiting...');
      return;
    }

    // If photos are present, clear the alert flag (in case user returns after uploading)
    if (referencePhotoPresent) {
      didShowNoPhotoAlertRef.current = false;
      return;
    }

    // No reference photo AND store is hydrated - show alert (but only once)
    if (!didShowNoPhotoAlertRef.current) {
      didShowNoPhotoAlertRef.current = true;
      console.log('[ONB] route_decision: NO_REFERENCE_PHOTO - redirecting to photo-upload');
      Alert.alert(
        'Photo Required',
        'Please upload a clear photo showing your face before verification.',
        [{
          text: 'Upload Photo',
          onPress: () => {
            setStep('photo_upload');
            router.replace('/(onboarding)/photo-upload' as any);
          }
        }]
      );
    }
  }, [storeHydrated, photos, setStep, router]);

  // Log mount/unmount separately (no deps needed)
  useEffect(() => {
    console.log('[FaceDebug] Face Verification screen MOUNTED');
    return () => {
      console.log('[FaceDebug] Face Verification screen UNMOUNTED');
    };
  }, []);

  // =============================================================================
  // Permission handling
  // =============================================================================

  useEffect(() => {
    if (hasPermission === false) {
      console.log('[FaceDebug] permission=DENIED, requesting...');
      requestPermission().then((granted) => {
        if (!granted) {
          setIsPermissionBlocked(true);
        }
      });
    }
  }, [hasPermission, requestPermission]);

  const handleOpenSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      Alert.alert('Error', 'Unable to open settings.');
    }
  }, []);

  // =============================================================================
  // Capture Logic
  // =============================================================================

  const startCapture = useCallback(async () => {
    if (!cameraRef.current || verificationState !== 'waiting') return;

    console.log('[FaceMatch] Starting 3-frame capture for face verification...');
    isCapturing.value = true;
    setVerificationState('capturing');
    setCapturedFrames([]);
    setFramesCaptured(0);
    setErrorMessage(null);
    setMatchScore(null);

    const frames: CapturedFrame[] = [];

    for (let i = 0; i < FRAME_COUNT; i++) {
      try {
        console.log(`[FaceMatch] Capture frame ${i + 1}/${FRAME_COUNT}...`);

        // Take photo
        const photo = await cameraRef.current.takePhoto({});

        frames.push({
          base64: photo.path, // File path - will be converted to base64 in service
          hasFace: true, // Assume face present in manual mode
          timestamp: Date.now(),
        });

        setFramesCaptured(i + 1);
        console.log(`[FaceMatch] Frame ${i + 1}/${FRAME_COUNT} captured: ${photo.path}`);

        // Wait before next capture (except for last frame)
        if (i < FRAME_COUNT - 1) {
          await new Promise(resolve => setTimeout(resolve, CAPTURE_INTERVAL_MS));
        }
      } catch (error) {
        console.error(`[FaceMatch] Frame ${i + 1} capture error:`, error);
        frames.push({
          base64: '',
          hasFace: false,
          timestamp: Date.now(),
        });
        setFramesCaptured(i + 1);
      }
    }

    isCapturing.value = false;
    setCapturedFrames(frames);
    console.log('[FaceMatch] All frames captured, sending to server for face comparison...');

    // Start server-side verification
    setVerificationState('verifying');

    try {
      // SECURITY: Face comparison happens on the server, not the client
      // The server compares the selfie against the user's uploaded profile photo
      const result = await verifyFace({
        userId: userId || 'unknown',
        profilePhotoUri: photos[0] || '',
        frames,
      });

      console.log(`[FaceMatch] Server result: status=${result.status}, score=${result.score}, reasonCode=${result.reasonCode}`);
      console.log(`[FaceMatch] Reason: ${result.reason || result.message}`);

      setMatchScore(result.score);
      setFailReasonCode(result.reasonCode || null);

      // Handle verification result based on server response
      switch (result.status) {
        case 'PASS':
          // Face matches profile photo - verification successful
          console.log('[FaceMatch] PASS - Face matches profile photo');
          setVerificationState('success');
          // Set flag immediately, user clicks Continue to proceed
          setFaceVerificationPassed(true);
          setFaceVerificationPending(false);
          // DEMO MODE: Also persist to demoProfile so it survives logout/relaunch
          if (isDemoMode && userId) {
            useDemoStore.getState().saveDemoProfile(userId, { faceVerificationPassed: true });
            console.log('[FaceMatch] saved faceVerificationPassed=true to demoProfile');
          }
          break;

        case 'PENDING':
          // Uncertain match - requires manual review
          console.log('[FaceMatch] PENDING - Manual review required');
          setVerificationState('pending');
          setErrorMessage(result.message);
          break;

        case 'FAIL':
          // Check if failure is due to missing/invalid reference photo
          if (result.reasonCode === 'NO_REFERENCE_PHOTO' || result.reasonCode === 'REFERENCE_NO_FACE') {
            console.log(`[FaceMatch] FAIL reason=${result.reasonCode} - Redirecting to photo upload`);
            Alert.alert(
              'Photo Required',
              'Please upload a clear photo showing your face. Your current photo could not be used for verification.',
              [{
                text: 'Upload Photo',
                onPress: () => {
                  setStep('photo_upload');
                  router.replace('/(onboarding)/photo-upload' as any);
                }
              }]
            );
            return;
          }

          // Face doesn't match or selfie error - stay on this screen for retry
          console.log(`[FaceMatch] FAIL reason=${result.reasonCode} - Stay for retry`);
          setVerificationState('failed');
          setErrorMessage(result.message);
          break;

        default:
          // Unexpected status - treat as failure
          console.error('[FaceMatch] Unexpected status:', result.status);
          setVerificationState('failed');
          setErrorMessage('Unexpected verification result. Please try again.');
      }
    } catch (error: any) {
      console.error('[FaceMatch] Verification error:', error);
      setVerificationState('failed');
      setErrorMessage('Failed to capture selfie. Please try again.');
      setFailReasonCode('SELFIE_NO_FACE');
    }
  }, [verificationState, userId, photos, isCapturing]);

  // =============================================================================
  // Success Handler - ONLY called when server returns PASS
  // =============================================================================

  const handleVerificationSuccess = useCallback(() => {
    // Navigate to additional photos (flags already set on PASS)
    console.log('[FaceMatch] Continuing to additional photos');
    setStep('additional_photos');
    router.push('/(onboarding)/additional-photos' as any);
  }, [setStep, router]);

  // =============================================================================
  // Retry Handler
  // =============================================================================

  const handleRetry = useCallback(() => {
    console.log('[FaceMatch] User retrying verification');
    setVerificationState('waiting');
    setCapturedFrames([]);
    setFramesCaptured(0);
    setErrorMessage(null);
    setMatchScore(null);
  }, []);

  // =============================================================================
  // Pending: Continue to waiting state (profile under review)
  // =============================================================================

  const handlePendingContinue = useCallback(() => {
    // Navigate to next step with pending verification status
    // User can continue onboarding but profile shows "pending" badge
    console.log('[FaceMatch] User continuing with pending verification (manual review mode)');

    // Mark as pending so user can resume onboarding after app restart
    setFaceVerificationPending(true);

    // Continue to next step - faceVerificationPassed stays false until admin approves
    // But we allow user to proceed with onboarding
    setStep('additional_photos');
    router.push('/(onboarding)/additional-photos' as any);
  }, [setFaceVerificationPending, setStep, router]);

  // =============================================================================
  // Render: Permission not determined
  // =============================================================================

  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Checking camera permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // =============================================================================
  // Render: Permission denied
  // =============================================================================

  if (!hasPermission || isPermissionBlocked) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centered}>
          <Ionicons name="camera-outline" size={64} color={COLORS.textLight} />
          <Text style={styles.title}>Camera Permission Required</Text>
          <Text style={styles.subtitle}>
            We need camera access to verify your identity with a selfie.
          </Text>
          <Button
            title={isPermissionBlocked ? "Open Settings" : "Grant Permission"}
            variant="primary"
            onPress={isPermissionBlocked ? handleOpenSettings : requestPermission}
            style={styles.permissionButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  // =============================================================================
  // Render: No camera device
  // =============================================================================

  if (!device) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={64} color={COLORS.error} />
          <Text style={styles.title}>No Camera Found</Text>
          <Text style={styles.subtitle}>
            Unable to find a front camera on this device.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // =============================================================================
  // Get subtitle text based on state
  // =============================================================================

  const getSubtitle = () => {
    switch (verificationState) {
      case 'waiting':
        return 'Position your face in the circle and tap Start';
      case 'capturing':
        return `Capturing selfie... ${framesCaptured}/${FRAME_COUNT}`;
      case 'verifying':
        return isDemoMode ? 'Verifying your selfie...' : 'Submitting your selfie for review...';
      case 'success':
        return isDemoMode ? 'Verified (Demo Mode)' : 'Your identity has been verified!';
      case 'pending':
        return 'Profile submitted for manual review';
      case 'failed':
        return 'Selfie capture failed';
      default:
        return '';
    }
  };

  // =============================================================================
  // Render: Main UI
  // =============================================================================

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <OnboardingProgressHeader />
      <View style={styles.content}>
        <Text style={styles.title}>Face Verification</Text>
        <Text style={styles.subtitle}>{getSubtitle()}</Text>

        {/* Camera View */}
        <View style={styles.cameraContainer}>
          {verificationState !== 'success' && verificationState !== 'failed' && verificationState !== 'pending' ? (
            <>
              <Camera
                ref={cameraRef}
                style={styles.camera}
                device={device}
                isActive={verificationState === 'waiting' || verificationState === 'capturing'}
                photo={true}
              />
              {/* Overlay with circular guide */}
              <View style={styles.overlay} pointerEvents="none">
                <Animated.View style={[styles.faceGuide, circleColor]} />
                {verificationState === 'capturing' && (
                  <View style={styles.captureIndicator}>
                    <ActivityIndicator size="small" color={COLORS.white} />
                    <Text style={styles.captureText}>
                      {framesCaptured}/{FRAME_COUNT}
                    </Text>
                  </View>
                )}
              </View>
            </>
          ) : (
            <View style={styles.resultContainer}>
              {verificationState === 'success' && (
                <>
                  <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
                  <Text style={styles.resultText}>
                    {isDemoMode ? 'Verified (Demo)' : 'Identity Verified!'}
                  </Text>
                  {matchScore !== null && !isDemoMode && (
                    <Text style={styles.scoreText}>Match confidence: {matchScore.toFixed(0)}%</Text>
                  )}
                  {isDemoMode && (
                    <Text style={styles.scoreText}>Demo mode - auto-approved</Text>
                  )}
                </>
              )}
              {verificationState === 'pending' && (
                <>
                  <Ionicons name="time-outline" size={80} color={COLORS.warning || '#FFA500'} />
                  <Text style={styles.resultText}>Profile Under Review</Text>
                  <Text style={styles.errorText}>
                    Your selfie has been submitted.{'\n'}Our team will verify your identity shortly.
                  </Text>
                </>
              )}
              {verificationState === 'failed' && (
                <>
                  <Ionicons name="close-circle" size={80} color={COLORS.error} />
                  <Text style={styles.resultText}>Verification Failed</Text>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                  {matchScore !== null && matchScore > 0 && (
                    <Text style={styles.scoreText}>Match score: {matchScore.toFixed(0)}%</Text>
                  )}
                </>
              )}
            </View>
          )}

          {verificationState === 'verifying' && (
            <View style={styles.verifyingOverlay}>
              <ActivityIndicator size="large" color={COLORS.white} />
              <Text style={styles.verifyingText}>Submitting selfie...</Text>
              <Text style={styles.verifyingSubtext}>This may take a few seconds</Text>
            </View>
          )}
        </View>

        {/* Instructions / Actions */}
        <View style={styles.footer}>
          {verificationState === 'waiting' && (
            <>
              <View style={styles.instructions}>
                <Text style={styles.instructionTitle}>Tips for best results:</Text>
                <Text style={styles.instructionText}>
                  <Ionicons name="sunny" size={14} color={COLORS.textLight} /> Good lighting - face the light source
                </Text>
                <Text style={styles.instructionText}>
                  <Ionicons name="person" size={14} color={COLORS.textLight} /> Face the camera directly
                </Text>
                <Text style={styles.instructionText}>
                  <Ionicons name="glasses-outline" size={14} color={COLORS.textLight} /> Remove sunglasses/hats
                </Text>
                <Text style={styles.instructionText}>
                  <Ionicons name="ellipse-outline" size={14} color={COLORS.textLight} /> Keep your face in the circle
                </Text>
              </View>
              <Button
                title="Start Verification"
                variant="primary"
                onPress={startCapture}
                fullWidth
                style={{ marginTop: 16 }}
              />
            </>
          )}

          {verificationState === 'failed' && (
            <>
              <View style={styles.failedHint}>
                <Text style={styles.failedHintText}>
                  Make sure your selfie matches your profile photo. Try better lighting or a different angle.
                </Text>
              </View>
              <Button
                title="Try Again"
                variant="primary"
                onPress={handleRetry}
                fullWidth
              />
            </>
          )}

          {verificationState === 'pending' && (
            <>
              <View style={styles.pendingInfo}>
                <Text style={styles.pendingInfoText}>
                  Your profile will show a "Pending" badge until verification is complete. You can continue setting up your profile now.
                </Text>
              </View>
              <Button
                title="Continue to Profile Setup"
                variant="primary"
                onPress={handlePendingContinue}
                fullWidth
              />
              <Button
                title="Retake Selfie"
                variant="outline"
                onPress={handleRetry}
                fullWidth
                style={{ marginTop: 8 }}
              />
            </>
          )}

          {verificationState === 'success' && (
            <Button
              title="Continue"
              variant="primary"
              onPress={handleVerificationSuccess}
              fullWidth
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    padding: 20,
    paddingTop: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 16,
  },
  cameraContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceGuide: {
    width: 250,
    height: 320,
    borderRadius: 125,
    borderWidth: 4,
    borderColor: COLORS.primary,
    backgroundColor: 'transparent',
  },
  captureIndicator: {
    position: 'absolute',
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  captureText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  verifyingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  verifyingText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  verifyingSubtext: {
    color: COLORS.white,
    fontSize: 12,
    opacity: 0.8,
    marginTop: 4,
  },
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  scoreText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  footer: {
    paddingTop: 16,
  },
  instructions: {
    backgroundColor: COLORS.backgroundDark,
    padding: 12,
    borderRadius: 10,
    gap: 6,
  },
  instructionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  instructionText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  failedHint: {
    backgroundColor: COLORS.error + '15',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  failedHintText: {
    fontSize: 13,
    color: COLORS.error,
    textAlign: 'center',
  },
  pendingInfo: {
    backgroundColor: '#FFA50015',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  pendingInfoText: {
    fontSize: 13,
    color: '#B8860B',
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: 24,
    minWidth: 200,
  },
});
