/**
 * LOCKED (Onboarding Page Lock)
 * Page: app/(onboarding)/face-verification.tsx
 * Policy:
 * - NO feature changes
 * - ONLY stability/bug fixes allowed IF Durga Prasad explicitly requests
 * - Do not change UX/flows without explicit unlock
 * Date locked: 2026-03-04
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Linking,
  ActivityIndicator,
  AppState,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import Animated, { useAnimatedStyle, withTiming, useSharedValue } from 'react-native-reanimated';
import { COLORS, FONT_SIZE, SPACING, SIZES, lineHeight, moderateScale } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { Ionicons } from '@expo/vector-icons';
import { verifyFace, type CapturedFrame, type FaceMatchReasonCode } from '@/services/faceVerification';
import { isDemoMode, convex } from '@/hooks/useConvex';
import { isDemoAuthMode } from '@/config/demo';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useScreenTrace } from '@/lib/devTrace';

// =============================================================================
// Constants
// =============================================================================

const FRAME_COUNT = 3;
const CAPTURE_INTERVAL_MS = 800; // ~2.4s total for 3 frames
const FACE_GUIDE_ASPECT_RATIO = 1.28;
const FACE_GUIDE_WIDTH_RATIO = 0.65;
const FACE_GUIDE_MAX_WIDTH = moderateScale(280, 0.25);
const FACE_GUIDE_MAX_HEIGHT_RATIO = 0.46;
const TEXT_MAX_SCALE = 1.2;
const TEXT_PROPS = { maxFontSizeMultiplier: TEXT_MAX_SCALE } as const;
const LARGE_ICON_SIZE = moderateScale(64, 0.3);
const RESULT_ICON_SIZE = moderateScale(80, 0.3);

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
  useScreenTrace("ONB_FACE_VERIFICATION");
  const { photos, setStep } = useOnboardingStore();
  const { userId, token, faceVerificationPassed, faceVerificationPending, setFaceVerificationPassed, setFaceVerificationPending } = useAuthStore();
  const demoProfile = useDemoStore((s) => isDemoMode && userId ? s.demoProfiles[userId] : null);
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const faceGuideWidth = Math.min(
    windowWidth * FACE_GUIDE_WIDTH_RATIO,
    FACE_GUIDE_MAX_WIDTH,
    (windowHeight * FACE_GUIDE_MAX_HEIGHT_RATIO) / FACE_GUIDE_ASPECT_RATIO,
  );
  const faceGuideHeight = faceGuideWidth * FACE_GUIDE_ASPECT_RATIO;
  const faceGuideBorderRadius = faceGuideWidth / 2;

  // M6 FIX: queryEnabled allows retry by toggling the query subscription
  const [queryEnabled, setQueryEnabled] = useState(true);

  // Query backend onboarding status for reference photo check (source of truth)
  // M6 FIX: Include queryEnabled in skip condition to allow forced re-subscription
  const onboardingStatusLive = useQuery(
    api.users.getOnboardingStatus,
    !isDemoMode && !isDemoAuthMode && userId && token && queryEnabled ? { token, userId } : 'skip'
  );

  // Demo auth mode: Use demo onboarding status query
  const onboardingStatusDemo = useQuery(
    api.demoAuth.getDemoOnboardingStatus,
    isDemoAuthMode && token && queryEnabled ? { token } : 'skip'
  );

  // Use appropriate status based on mode
  const onboardingStatus = isDemoAuthMode ? onboardingStatusDemo : onboardingStatusLive;

  // M6 FIX: Track loading timeout to prevent infinite loading state
  const [backendLoadTimedOut, setBackendLoadTimedOut] = useState(false);

  // M6 FIX: Ref to track re-enable timer for cleanup on unmount
  const backendRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // M6 FIX: Cleanup re-enable timer on unmount
  useEffect(() => {
    return () => {
      if (backendRetryTimerRef.current) {
        clearTimeout(backendRetryTimerRef.current);
      }
    };
  }, []);

  // M6 FIX: Retry handler - toggles queryEnabled to force fresh Convex subscription
  const handleBackendRetry = useCallback(() => {
    if (backendRetryTimerRef.current) {
      clearTimeout(backendRetryTimerRef.current);
    }
    setBackendLoadTimedOut(false);
    setQueryEnabled(false);
    backendRetryTimerRef.current = setTimeout(() => {
      setQueryEnabled(true);
      backendRetryTimerRef.current = null;
    }, 50);
  }, []);

  // M6 FIX: Set timeout after 8s of loading to show retry UI
  useEffect(() => {
    if (!isDemoMode && queryEnabled && onboardingStatus === undefined) {
      const timer = setTimeout(() => {
        setBackendLoadTimedOut(true);
        console.warn('[FACE_VERIFY] M6: Backend load timeout after 8s');
      }, 8000);
      return () => clearTimeout(timer);
    }
    // Reset timeout flag if query resolves OR during retry (queryEnabled=false)
    if (onboardingStatus !== undefined || !queryEnabled) {
      setBackendLoadTimedOut(false);
    }
  }, [isDemoMode, queryEnabled, onboardingStatus]);

  // Screen focus and app state tracking
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);

  // Get backend verification status (source of truth)
  // Used to show appropriate UI state on mount/resume
  const backendFaceStatus = onboardingStatus?.faceVerificationStatus;
  const backendVerificationPassed = backendFaceStatus === 'verified';
  const backendVerificationPending = backendFaceStatus === 'pending';

  // Camera
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);

  // Camera active state - controlled by multiple conditions
  const [cameraActive, setCameraActive] = useState(false);

  // State - start as 'waiting', will update based on backend status when loaded
  const [verificationState, setVerificationState] = useState<VerificationState>('waiting');

  // ONB-012 FIX: Component-wide mounted ref to guard async setState calls
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // CRITICAL FIX: NO AUTO-SKIP - Show confirmation UI instead
  // When backend status is already verified/pending, show the appropriate result UI
  // User MUST press Continue button manually to proceed to next step
  const didSetInitialStateRef = useRef(false);
  useEffect(() => {
    // Wait for backend data to load
    const backendLoaded = onboardingStatus !== undefined;
    if (!backendLoaded || didSetInitialStateRef.current) {
      return;
    }

    // If already verified or pending, show the result UI (NOT auto-navigate)
    if (backendVerificationPassed) {
      didSetInitialStateRef.current = true;
      console.log('[FaceDebug] Backend status is VERIFIED -> showing success UI (user must press Continue)');
      setVerificationState('success');
      // Also update authStore flags for consistency
      setFaceVerificationPassed(true);
      setFaceVerificationPending(false);
    } else if (backendVerificationPending) {
      didSetInitialStateRef.current = true;
      console.log('[FaceDebug] Backend status is PENDING -> showing pending UI (user must press Continue)');
      setVerificationState('pending');
      // Also update authStore flags for consistency
      setFaceVerificationPending(true);
    }
    // If unverified/failed, stay in 'waiting' state to show camera UI
  }, [onboardingStatus, backendVerificationPassed, backendVerificationPending, setFaceVerificationPassed, setFaceVerificationPending]);
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([]);
  const [framesCaptured, setFramesCaptured] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [isPermissionBlocked, setIsPermissionBlocked] = useState(false);
  const [failReasonCode, setFailReasonCode] = useState<FaceMatchReasonCode | null>(null);

  // PHASE-1 RESTRUCTURE: Track verification attempts (max 3, then allow skip)
  const MAX_VERIFICATION_ATTEMPTS = 3;
  const [verificationAttempts, setVerificationAttempts] = useState(0);

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

  // STABILITY FIX (2026-03-04): Add cleanup to prevent setState on unmounted component
  useEffect(() => {
    let isMounted = true;

    // Use backend data as source of truth for reference photo check
    const referencePhotoExists = onboardingStatus?.referencePhotoExists ?? false;
    const backendDataLoaded = onboardingStatus !== undefined;

    console.log('[FaceDebug] ========================================');
    console.log('[FaceDebug] Face Verification screen check');
    console.log('[FaceDebug] userId:', userId);
    console.log('[FaceDebug] backendDataLoaded:', backendDataLoaded);
    console.log('[FaceDebug] referencePhotoExists (backend):', referencePhotoExists);
    console.log('[FaceDebug] ========================================');

    // GATE CHECK: Wait for backend data to load before blocking user
    // This prevents false positives when backend query hasn't loaded yet
    if (!backendDataLoaded) {
      console.log('[FaceDebug] Backend data not loaded yet, waiting...');
      return;
    }

    // If reference photo exists in backend, clear the alert flag (in case user returns after uploading)
    if (referencePhotoExists) {
      didShowNoPhotoAlertRef.current = false;
      return;
    }

    // No reference photo in backend AND data is loaded - show alert (but only once)
    if (!didShowNoPhotoAlertRef.current) {
      didShowNoPhotoAlertRef.current = true;
      console.log('[ONB] route_decision: NO_REFERENCE_PHOTO - redirecting to photo-upload');
      Alert.alert(
        'Reference Photo Required',
        "Please upload a clear photo of your face. It's only used for verification and will not appear on your profile.",
        [{
          text: 'Upload Reference Photo',
          onPress: () => {
            // Only navigate if component still mounted
            if (isMounted) {
              setStep('photo_upload');
              router.replace('/(onboarding)/photo-upload' as any);
            }
          }
        }]
      );
    }

    return () => {
      isMounted = false; // Cleanup: prevent state updates if unmounted
    };
  }, [onboardingStatus, setStep, router]);

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

  // =============================================================================
  // AppState listener - deactivate camera when app goes to background
  // =============================================================================

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      setAppState(nextAppState);
      if (__DEV__) {
        console.log('[FaceDebug] AppState changed:', nextAppState);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // =============================================================================
  // Camera activation control - only activate when ALL conditions are met
  // =============================================================================

  useEffect(() => {
    // Check if camera should be active
    const isAppActive = appState === 'active';
    const needsCamera = verificationState === 'waiting' || verificationState === 'capturing';
    const allConditionsMet = isFocused && isAppActive && !!device && hasPermission === true && needsCamera;

    if (__DEV__) {
      console.log('[FaceDebug] cameraActive conditions:', {
        isFocused,
        isAppActive,
        hasDevice: !!device,
        hasPermission,
        needsCamera,
        shouldActivate: allConditionsMet,
      });
    }

    // Debounce activation to prevent race conditions
    const activationTimer = setTimeout(() => {
      if (allConditionsMet && !cameraActive) {
        if (__DEV__) {
          console.log('[FaceDebug] cameraActive true (all conditions met)');
        }
        setCameraActive(true);
      } else if (!allConditionsMet && cameraActive) {
        if (__DEV__) {
          console.log('[FaceDebug] cameraActive false (condition failed)');
        }
        setCameraActive(false);
      }
    }, 150); // 150ms debounce

    return () => {
      clearTimeout(activationTimer);
    };
  }, [isFocused, appState, device, hasPermission, verificationState, cameraActive]);

  // M8 FIX: Simplified camera cleanup - removed setState that caused React warning
  // Camera resources are released automatically when Camera component unmounts
  useEffect(() => {
    return () => {
      if (__DEV__) {
        console.log('[FaceDebug] camera cleanup on unmount');
      }
    };
  }, []);

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

    // PHASE-1 RESTRUCTURE: Increment attempt counter
    const currentAttempt = verificationAttempts + 1;
    setVerificationAttempts(currentAttempt);

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

        // ONB-012 FIX: Guard setState after async
        if (mountedRef.current) setFramesCaptured(i + 1);
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
        // ONB-012 FIX: Guard setState in catch
        if (mountedRef.current) setFramesCaptured(i + 1);
      }
    }

    isCapturing.value = false;
    // ONB-012 FIX: Guard setState after capture loop
    if (!mountedRef.current) return;
    setCapturedFrames(frames);
    console.log('[FaceMatch] All frames captured, sending to server for face comparison...');

    // Start server-side verification
    setVerificationState('verifying');

    try {
      // SECURITY: Face comparison happens on the server, not the client
      // The server compares the selfie against the user's uploaded profile photo
      // ONB-003 FIX: Prefer local photos[0] first (immediately available on restart),
      // fallback to backend URL if local store is empty
      const referencePhotoUrl = photos[0] || onboardingStatus?.verificationReferencePhotoUrl || '';
      const result = await verifyFace({
        userId: userId || 'unknown',
        profilePhotoUri: referencePhotoUrl,
        frames,
      });

      console.log(`[FaceMatch] Server result: status=${result.status}, score=${result.score}, reasonCode=${result.reasonCode}`);
      console.log(`[FaceMatch] Reason: ${result.reason || result.message}`);

      // ONB-012 FIX: Guard setState after verifyFace async call
      if (!mountedRef.current) return;

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
          // CRITICAL: Set pending flag immediately so user can proceed through onboarding
          // Manual review is asynchronous - users must be allowed to continue while review is pending
          setFaceVerificationPending(true);
          console.log('[FaceMatch] Set faceVerificationPending=true (allows onboarding continuation)');
          // DEMO MODE: Also persist to demoProfile so it survives logout/relaunch
          if (isDemoMode && userId) {
            useDemoStore.getState().saveDemoProfile(userId, { faceVerificationPending: true });
            console.log('[FaceMatch] saved faceVerificationPending=true to demoProfile');
          }
          break;

        case 'FAIL':
          // Check if failure is due to missing/invalid reference photo
          if (result.reasonCode === 'NO_REFERENCE_PHOTO' || result.reasonCode === 'REFERENCE_NO_FACE') {
            console.log(`[FaceMatch] FAIL reason=${result.reasonCode} - Redirecting to photo upload`);
            Alert.alert(
              'Reference Photo Required',
              "Please upload a clearer photo of your face for verification. It's only used for verification and won't appear on your profile.",
              [{
                text: 'Upload Reference Photo',
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
      // ONB-012 FIX: Guard setState in catch
      if (!mountedRef.current) return;
      setVerificationState('failed');
      setErrorMessage('Failed to capture selfie. Please try again.');
      setFailReasonCode('SELFIE_NO_FACE');
    }
  }, [
    verificationState,
    verificationAttempts,
    userId,
    photos,
    onboardingStatus,
    isCapturing,
    router,
    setStep,
    setFaceVerificationPassed,
    setFaceVerificationPending,
  ]);

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
  // PHASE-1 RESTRUCTURE: Skip Handler - Allow users to skip after max attempts
  // =============================================================================

  const handleSkipVerification = useCallback(() => {
    // Navigate to next step without verification
    // User's profile will show "unverified" status
    console.log('[FaceMatch] User skipping verification after max attempts');

    // Don't set any verification flags - user proceeds as unverified
    // Continue to next step
    setStep('additional_photos');
    router.push('/(onboarding)/additional-photos' as any);
  }, [setStep, router]);

  // =============================================================================
  // DEMO AUTH MODE: Auto-approve verification without real face comparison
  // Shows the UI but approves immediately when user taps the demo button
  // =============================================================================

  const [isDemoApproving, setIsDemoApproving] = useState(false);

  const handleDemoApprove = useCallback(async () => {
    if (!isDemoAuthMode) return;

    console.log('[DEMO_AUTH] Demo approve face verification');
    setIsDemoApproving(true);

    try {
      // Call backend to set verification as passed
      if (token) {
        await convex.mutation(api.demoAuth.skipDemoFaceVerification, {
          token,
        });
        console.log('[DEMO_AUTH] Face verification approved in Convex');
      }

      // Update local state
      setFaceVerificationPassed(true);
      setFaceVerificationPending(false);
      setVerificationState('success');
      setMatchScore(100);

      console.log('[DEMO_AUTH] Face verification demo-approved successfully');
    } catch (error: any) {
      console.error('[DEMO_AUTH] Demo approve error:', error);
      Alert.alert('Demo Error', error.message || 'Failed to demo-approve verification');
    } finally {
      setIsDemoApproving(false);
    }
  }, [token, setFaceVerificationPassed, setFaceVerificationPending]);

  // =============================================================================
  // Render: M6 FIX - Backend loading with timeout fallback
  // =============================================================================

  // Wait for backend status in both demo auth mode and live mode
  const waitingForBackend = !isDemoMode && !isDemoAuthMode && onboardingStatus === undefined;
  const waitingForDemoBackend = isDemoAuthMode && onboardingStatus === undefined;

  if (waitingForBackend || waitingForDemoBackend) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <OnboardingProgressHeader />
        <View style={styles.centered}>
          {backendLoadTimedOut ? (
            <>
              <Ionicons name="cloud-offline-outline" size={SIZES.icon.xl + SPACING.base} color={COLORS.textLight} />
              <Text {...TEXT_PROPS} style={styles.loadingText}>Unable to load profile data</Text>
              <Button
                title="Try Again"
                variant="outline"
                onPress={handleBackendRetry}
                style={styles.buttonTopSpacing}
              />
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text {...TEXT_PROPS} style={styles.loadingText}>Loading...</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // =============================================================================
  // Render: Permission not determined
  // =============================================================================

  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text {...TEXT_PROPS} style={styles.loadingText}>Checking camera permission...</Text>
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
          <Ionicons name="camera-outline" size={LARGE_ICON_SIZE} color={COLORS.textLight} />
          <Text {...TEXT_PROPS} style={styles.title}>Camera Permission Required</Text>
          <Text {...TEXT_PROPS} style={styles.subtitle}>
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
          <Ionicons name="warning-outline" size={LARGE_ICON_SIZE} color={COLORS.error} />
          <Text {...TEXT_PROPS} style={styles.title}>No Camera Found</Text>
          <Text {...TEXT_PROPS} style={styles.subtitle}>
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
        return 'Your profile is under verification. You can continue while we review your selfie.';
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
        <Text {...TEXT_PROPS} style={styles.title}>Face Verification</Text>
        <Text {...TEXT_PROPS} style={styles.subtitle}>{getSubtitle()}</Text>

        {/* Camera View */}
        <View style={styles.cameraContainer}>
          {verificationState !== 'success' && verificationState !== 'failed' && verificationState !== 'pending' ? (
            <>
              {/* Only render Camera when all conditions are met and cameraActive is true */}
              {cameraActive && device && hasPermission ? (
                <Camera
                  ref={cameraRef}
                  style={styles.camera}
                  device={device}
                  isActive={cameraActive}
                  photo={true}
                />
              ) : (
                <View style={styles.cameraPlaceholder}>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text {...TEXT_PROPS} style={styles.placeholderText}>Preparing camera...</Text>
                </View>
              )}
              {/* Overlay with circular guide */}
              <View style={styles.overlay} pointerEvents="none">
                <Animated.View
                  style={[
                    styles.faceGuide,
                    {
                      width: faceGuideWidth,
                      height: faceGuideHeight,
                      borderRadius: faceGuideBorderRadius,
                    },
                    circleColor,
                  ]}
                />
                {verificationState === 'capturing' && (
                  <View style={styles.captureIndicator}>
                    <ActivityIndicator size="small" color={COLORS.white} />
                    <Text {...TEXT_PROPS} style={styles.captureText}>
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
                  <Ionicons name="checkmark-circle" size={RESULT_ICON_SIZE} color={COLORS.success} />
                  <Text {...TEXT_PROPS} style={styles.resultText}>
                    {isDemoMode ? 'Verified (Demo)' : 'Identity Verified!'}
                  </Text>
                  {matchScore !== null && !isDemoMode && (
                    <Text {...TEXT_PROPS} style={styles.scoreText}>Match confidence: {matchScore.toFixed(0)}%</Text>
                  )}
                  {isDemoMode && (
                    <Text {...TEXT_PROPS} style={styles.scoreText}>Demo mode - auto-approved</Text>
                  )}
                </>
              )}
              {verificationState === 'pending' && (
                <>
                  <Ionicons name="time-outline" size={RESULT_ICON_SIZE} color={COLORS.warning || '#FFA500'} />
                  <Text {...TEXT_PROPS} style={styles.resultText}>Verification Pending</Text>
                  <Text {...TEXT_PROPS} style={styles.errorText}>
                    Your profile is under verification.{'\n'}You can continue using the app while we review your selfie.
                  </Text>
                </>
              )}
              {verificationState === 'failed' && (
                <>
                  <Ionicons name="close-circle" size={RESULT_ICON_SIZE} color={COLORS.error} />
                  <Text {...TEXT_PROPS} style={styles.resultText}>Verification Failed</Text>
                  <Text {...TEXT_PROPS} style={styles.errorText}>{errorMessage}</Text>
                  {matchScore !== null && matchScore > 0 && (
                    <Text {...TEXT_PROPS} style={styles.scoreText}>Match score: {matchScore.toFixed(0)}%</Text>
                  )}
                </>
              )}
            </View>
          )}

          {verificationState === 'verifying' && (
            <View style={styles.verifyingOverlay}>
              <ActivityIndicator size="large" color={COLORS.white} />
              <Text {...TEXT_PROPS} style={styles.verifyingText}>Submitting selfie...</Text>
              <Text {...TEXT_PROPS} style={styles.verifyingSubtext}>This may take a few seconds</Text>
            </View>
          )}
        </View>

        {/* Instructions / Actions */}
        <View style={styles.footer}>
          {verificationState === 'waiting' && (
            <>
              <View style={styles.instructions}>
                <Text {...TEXT_PROPS} style={styles.instructionTitle}>Tips for best results:</Text>
                <Text {...TEXT_PROPS} style={styles.instructionText}>
                  <Ionicons name="sunny" size={SIZES.icon.xs + 2} color={COLORS.textLight} /> Good lighting - face the light source
                </Text>
                <Text {...TEXT_PROPS} style={styles.instructionText}>
                  <Ionicons name="person" size={SIZES.icon.xs + 2} color={COLORS.textLight} /> Face the camera directly
                </Text>
                <Text {...TEXT_PROPS} style={styles.instructionText}>
                  <Ionicons name="glasses-outline" size={SIZES.icon.xs + 2} color={COLORS.textLight} /> Remove sunglasses/hats
                </Text>
                <Text {...TEXT_PROPS} style={styles.instructionText}>
                  <Ionicons name="ellipse-outline" size={SIZES.icon.xs + 2} color={COLORS.textLight} /> Keep your face in the circle
                </Text>
              </View>
              <Button
                title="Start Verification"
                variant="primary"
                onPress={startCapture}
                fullWidth
                style={styles.buttonTopSpacing}
              />
              {/* DEMO AUTH MODE: Show demo approve button */}
              {isDemoAuthMode && (
                <View style={styles.secondaryButtonContainer}>
                  <Button
                    title={isDemoApproving ? "Approving..." : "Demo Approve (Dev Only)"}
                    variant="outline"
                    onPress={handleDemoApprove}
                    loading={isDemoApproving}
                    disabled={isDemoApproving}
                    fullWidth
                  />
                  <Text {...TEXT_PROPS} style={styles.demoHintText}>
                    Demo mode: Approve verification without selfie
                  </Text>
                </View>
              )}
            </>
          )}

          {verificationState === 'failed' && (
            <>
              <View style={styles.failedHint}>
                <Text {...TEXT_PROPS} style={styles.failedHintText}>
                  Make sure your selfie matches your reference photo. Try better lighting or a different angle.
                </Text>
                {/* PHASE-1 RESTRUCTURE: Show attempt count */}
                <Text {...TEXT_PROPS} style={styles.attemptCountText}>
                  Attempt {verificationAttempts} of {MAX_VERIFICATION_ATTEMPTS}
                </Text>
              </View>
              <Button
                title="Try Again"
                variant="primary"
                onPress={handleRetry}
                fullWidth
              />
              {/* PHASE-1 RESTRUCTURE: Allow skip after max attempts */}
              {verificationAttempts >= MAX_VERIFICATION_ATTEMPTS && (
                <View style={styles.secondaryButtonContainer}>
                  <Button
                    title="Skip for Now"
                    variant="outline"
                    onPress={handleSkipVerification}
                    fullWidth
                  />
                  <Text {...TEXT_PROPS} style={styles.skipHintText}>
                    You can verify later in your profile settings
                  </Text>
                </View>
              )}
            </>
          )}

          {verificationState === 'pending' && (
            <>
              {/* PHASE-1 RESTRUCTURE: Allow users to continue with pending verification */}
              <View style={styles.pendingInfo}>
                <Text {...TEXT_PROPS} style={styles.pendingInfoText}>
                  Your verification is being reviewed. Your reference photo is kept privately for review and is not shown on your profile. You can continue setting up your profile while we process your request.
                </Text>
              </View>
              <Button
                title="Continue"
                variant="primary"
                onPress={handlePendingContinue}
                fullWidth
              />
              <View style={styles.secondaryButtonContainer}>
                <Button
                  title="Retake Selfie"
                  variant="outline"
                  onPress={handleRetry}
                  fullWidth
                />
              </View>
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
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.sm + SPACING.xxs,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontSize: moderateScale(26, 0.4),
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: lineHeight(moderateScale(26, 0.4), 1.2),
    marginBottom: SPACING.sm - SPACING.xxs,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: moderateScale(15, 0.4),
    color: COLORS.textLight,
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    marginBottom: SPACING.base + SPACING.xxs,
    textAlign: 'center',
  },
  loadingText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    marginTop: SPACING.base,
  },
  cameraContainer: {
    flex: 1,
    borderRadius: SIZES.radius.xl,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  camera: {
    flex: 1,
  },
  cameraPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  placeholderText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    marginTop: SPACING.md + SPACING.xxs,
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
    borderWidth: 4,
    borderColor: COLORS.primary,
    backgroundColor: 'transparent',
  },
  captureIndicator: {
    position: 'absolute',
    bottom: SIZES.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + SPACING.xxs,
    borderRadius: SIZES.radius.xl,
    gap: SPACING.sm + SPACING.xxs,
  },
  captureText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.md, 1.2),
    letterSpacing: 0.2,
  },
  verifyingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  verifyingText: {
    color: COLORS.white,
    fontSize: moderateScale(17, 0.4),
    fontWeight: '600',
    lineHeight: lineHeight(moderateScale(17, 0.4), 1.2),
    marginTop: SPACING.md + SPACING.xxs,
    letterSpacing: -0.2,
  },
  verifyingSubtext: {
    color: COLORS.white,
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    opacity: 0.75,
    marginTop: SPACING.sm - SPACING.xxs,
  },
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  resultText: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.xxl, 1.2),
    marginTop: SPACING.base + SPACING.xxs,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  scoreText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    marginTop: SPACING.sm - SPACING.xxs,
    textAlign: 'center',
  },
  errorText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    marginTop: SPACING.sm + SPACING.xxs,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
  },
  footer: {
    paddingTop: SPACING.base + SPACING.xxs,
  },
  instructions: {
    backgroundColor: COLORS.backgroundDark,
    padding: SPACING.base,
    borderRadius: SIZES.radius.md + SPACING.xxs,
    gap: SPACING.sm,
  },
  instructionTitle: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.md, 1.2),
    marginBottom: SPACING.sm - SPACING.xxs,
    letterSpacing: -0.2,
  },
  instructionText: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.45),
  },
  failedHint: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: SPACING.base,
    borderRadius: SIZES.radius.md + SPACING.xxs,
    marginBottom: SPACING.md + SPACING.xxs,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  failedHintText: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.error,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.body2, 1.45),
    fontWeight: '500',
  },
  pendingInfo: {
    backgroundColor: 'rgba(255, 165, 0, 0.1)',
    padding: SPACING.base,
    borderRadius: SIZES.radius.md + SPACING.xxs,
    marginBottom: SPACING.md + SPACING.xxs,
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 0, 0.2)',
  },
  pendingInfoText: {
    fontSize: FONT_SIZE.body2,
    color: '#B8860B',
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.body2, 1.45),
  },
  // PHASE-1 RESTRUCTURE: New styles for non-blocking verification
  secondaryButtonContainer: {
    marginTop: SPACING.md,
  },
  attemptCountText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    marginTop: SPACING.sm,
  },
  skipHintText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    marginTop: SPACING.sm,
  },
  permissionButton: {
    marginTop: SPACING.xxl - SPACING.xs,
    minWidth: moderateScale(200, 0.35),
  },
  buttonTopSpacing: {
    marginTop: SPACING.base,
  },
  demoHintText: {
    textAlign: 'center',
    marginTop: SPACING.sm,
    fontSize: FONT_SIZE.caption,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: COLORS.textLight,
  },
});
