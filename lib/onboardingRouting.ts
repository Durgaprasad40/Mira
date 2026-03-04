/**
 * Onboarding Routing Logic
 * Centralized routing decisions based on onboarding status.
 * Used by: OnboardingDraftHydrator, photo-upload.tsx, review screen
 */

export interface OnboardingStatus {
  basicInfo: {
    name: string | null;
    nickname: string | null;
    dateOfBirth: string | null;
    gender: string | null;
  };
  basicInfoComplete: boolean;
  referencePhotoExists: boolean;
  verificationReferencePhotoId: string | null;
  faceVerificationStatus: 'unverified' | 'pending' | 'verified' | 'failed';
  faceVerificationPassed: boolean;
  faceVerificationPending: boolean;
  normalPhotoCount: number;
  hasMinPhotos: boolean;
  onboardingCompleted: boolean;
  onboardingDraft: any | null;
}

/**
 * Decides the next onboarding route based on current status.
 * This is the single source of truth for routing decisions.
 *
 * @param status - Current onboarding status from backend
 * @returns The route path to navigate to
 */
export function decideNextOnboardingRoute(status: OnboardingStatus): string {
  if (__DEV__) {
    console.log('[ONB_ROUTE] decideNextOnboardingRoute called', {
      basicInfoComplete: status.basicInfoComplete,
      referencePhotoExists: status.referencePhotoExists,
      faceStatus: status.faceVerificationStatus,
      normalPhotoCount: status.normalPhotoCount,
      hasMinPhotos: status.hasMinPhotos,
      onboardingCompleted: status.onboardingCompleted,
    });
  }

  // Step 1: Basic Info (required first)
  if (!status.basicInfoComplete) {
    console.log('[ONB_ROUTE] status=incomplete_basic_info -> route=/(onboarding)/basic-info');
    return '/(onboarding)/basic-info';
  }

  // Step 2: Reference Photo Upload (required for face verification)
  if (!status.referencePhotoExists) {
    console.log('[ONB_ROUTE] status=no_reference_photo -> route=/(onboarding)/photo-upload');
    return '/(onboarding)/photo-upload';
  }

  // Step 3: Face Verification (if not verified or pending)
  if (status.faceVerificationStatus === 'unverified' || status.faceVerificationStatus === 'failed') {
    console.log('[ONB_ROUTE] status=face_verification_needed -> route=/(onboarding)/face-verification');
    return '/(onboarding)/face-verification';
  }

  // Step 4: Additional Photos (if face verification passed or pending)
  if (!status.hasMinPhotos) {
    console.log('[ONB_ROUTE] status=need_more_photos -> route=/(onboarding)/additional-photos');
    return '/(onboarding)/additional-photos';
  }

  // Step 5: Permissions (next logical step)
  if (!status.onboardingCompleted) {
    console.log('[ONB_ROUTE] status=need_permissions -> route=/(onboarding)/permissions');
    return '/(onboarding)/permissions';
  }

  // Onboarding completed - go to review or main app
  console.log('[ONB_ROUTE] status=completed -> route=/(onboarding)/review');
  return '/(onboarding)/review';
}

/**
 * Logs onboarding status for debugging
 */
export function logOnboardingStatus(status: OnboardingStatus, context: string) {
  if (!__DEV__) return;

  console.log(`[ONB_STATUS:${context}]`, {
    basicInfoComplete: status.basicInfoComplete,
    referencePhotoExists: status.referencePhotoExists,
    faceStatus: status.faceVerificationStatus,
    normalPhotoCount: status.normalPhotoCount,
    hasMinPhotos: status.hasMinPhotos,
    onboardingCompleted: status.onboardingCompleted,
  });
}
