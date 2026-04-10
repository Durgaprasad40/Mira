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
 * PHASE-1 RESTRUCTURE: New simplified 7-step flow:
 * 1. Basic Info (name, nickname, DOB, gender, LGBTQ self optional)
 * 2. Preferences (lookingFor, relationshipIntent, LGBTQ preference optional)
 * 3. Reference Photo Upload
 * 4. Face Verification (NON-BLOCKING - can continue unverified)
 * 5. Additional Photos + Bio (bio MANDATORY)
 * 6. Review (simplified)
 * 7. Tutorial → Phase-1/Discover
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

  // Step 3: Face Verification (if not verified AND not pending)
  // PHASE-1 RESTRUCTURE: Allow continuation when pending (non-blocking)
  if (status.faceVerificationStatus === 'unverified' || status.faceVerificationStatus === 'failed') {
    console.log('[ONB_ROUTE] status=face_verification_needed -> route=/(onboarding)/face-verification');
    return '/(onboarding)/face-verification';
  }

  // Step 4: Additional Photos + Bio (if face verification passed OR pending)
  if (!status.hasMinPhotos) {
    console.log('[ONB_ROUTE] status=need_more_photos -> route=/(onboarding)/additional-photos');
    return '/(onboarding)/additional-photos';
  }

  // Step 5: Review (if all above complete but onboarding not finalized)
  // PHASE-1 RESTRUCTURE: Removed permissions step - go directly to review
  if (!status.onboardingCompleted) {
    console.log('[ONB_ROUTE] status=ready_for_review -> route=/(onboarding)/review');
    return '/(onboarding)/review';
  }

  // Onboarding completed - go to main app
  console.log('[ONB_ROUTE] status=completed -> route=/(main)/(tabs)/home');
  return '/(main)/(tabs)/home';
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
