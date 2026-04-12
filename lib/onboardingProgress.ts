/**
 * Onboarding Progress Mapping
 * Maps onboarding steps/routes to progress indices for the progress header.
 * Each screen gets its own progress step for smooth advancement.
 */

import type { OnboardingStep } from '@/types';

/**
 * Ordered list of onboarding steps for progress calculation.
 * CLEANED UP: Matches actual navigation flow (removed obsolete steps).
 * Flow: basic_info → preferences → photo_upload → face_verification → additional_photos → review
 * Excludes: welcome (pre-progress), tutorial (no progress bar shown).
 * Pre-auth screens (email_phone, otp, password) are separate from onboarding progress.
 */
export const ONBOARDING_PROGRESS_STEPS: OnboardingStep[] = [
  'basic_info',        // Step 1: Name, DOB, gender
  'preferences',       // Step 2: lookingFor, lgbtqPreference, relationshipIntent
  'photo_upload',      // Step 3: Primary photo upload
  'face_verification', // Step 4: Face verification
  'additional_photos', // Step 5: Additional photos + displayPhotoVariant
  'review',            // Step 6: Review and complete
  // 'tutorial' excluded - tutorial screen doesn't show progress bar
];

/**
 * Total number of steps for progress calculation.
 */
export const ONBOARDING_TOTAL_STEPS = ONBOARDING_PROGRESS_STEPS.length;

/**
 * Get the 1-based step number for a given onboarding step.
 * Returns null if step is not in the progress flow (e.g., welcome, tutorial).
 */
export function getStepNumber(step: OnboardingStep | undefined): number | null {
  if (!step) return null;
  const index = ONBOARDING_PROGRESS_STEPS.indexOf(step);
  return index >= 0 ? index + 1 : null;
}

/**
 * Get progress percentage (0-100) for a given onboarding step.
 * Returns null if step is not in the progress flow.
 */
export function getProgressPercentage(step: OnboardingStep | undefined): number | null {
  const stepNumber = getStepNumber(step);
  if (stepNumber === null) return null;
  return Math.round((stepNumber / ONBOARDING_TOTAL_STEPS) * 100);
}

/**
 * Route-to-step mapping for specific routes.
 * CLEANED UP: Only includes actual onboarding routes.
 * Most routes use kebab-to-snake conversion (e.g., basic-info → basic_info).
 */
const ROUTE_TO_STEP_MAP: Record<string, OnboardingStep> = {
  // All current routes use kebab-to-snake conversion automatically
  // This map is for any special cases that don't follow the pattern
};

/**
 * Map route path to OnboardingStep.
 * Handles per-screen mapping for accurate progress tracking.
 *
 * @param routePath - The current route path
 * @param editFromReview - If true, returns 'review' to keep progress at 100%
 */
export function routeToStep(routePath: string, editFromReview?: boolean): OnboardingStep | null {
  // EDIT FROM REVIEW: Keep progress at 100% when editing from review
  if (editFromReview) {
    return 'review';
  }

  // Remove leading slash and (onboarding) prefix
  const cleanPath = routePath
    .replace(/^\/?\(onboarding\)\/?/, '')
    .replace(/^\//, '')
    .replace(/\?.*$/, ''); // Remove query params

  // Handle index route (welcome screen)
  if (cleanPath === '' || cleanPath === 'index' || cleanPath === 'welcome') {
    return 'welcome';
  }

  // Check specific route mappings first
  for (const [route, step] of Object.entries(ROUTE_TO_STEP_MAP)) {
    if (cleanPath === route || cleanPath.startsWith(route + '/')) {
      return step;
    }
  }

  // Convert kebab-case to snake_case for standard routes
  const stepName = cleanPath.replace(/-/g, '_') as OnboardingStep;

  // Check if it's a valid step in our progress array
  if (ONBOARDING_PROGRESS_STEPS.includes(stepName)) {
    return stepName;
  }

  // Fallback: return null for unknown routes (progress header will handle gracefully)
  return null;
}

/**
 * Get progress step from route path string.
 * Convenience wrapper for OnboardingProgressHeader.
 * Returns step number, total steps, and percentage for both stepwise and bar display.
 */
export function getProgressFromRoute(
  routePath: string,
  editFromReview?: boolean
): {
  step: OnboardingStep | null;
  stepNumber: number | null;
  totalSteps: number;
  percentage: number | null;
} {
  const step = routeToStep(routePath, editFromReview);
  const stepNumber = step ? getStepNumber(step) : null;
  const percentage = step ? getProgressPercentage(step) : null;
  return { step, stepNumber, totalSteps: ONBOARDING_TOTAL_STEPS, percentage };
}
