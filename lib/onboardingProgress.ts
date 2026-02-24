/**
 * Onboarding Progress Mapping
 * Maps onboarding steps/routes to progress indices for the progress header.
 */

import type { OnboardingStep } from '@/types';

/**
 * Ordered list of onboarding steps for progress calculation.
 * This represents the main user-facing flow (excludes welcome which is pre-progress).
 */
export const ONBOARDING_PROGRESS_STEPS: OnboardingStep[] = [
  'email_phone',
  'otp',
  'password',
  'basic_info',
  'consent',
  'photo_upload',
  'face_verification',
  'display_privacy',
  'additional_photos',
  'bio',
  'prompts',
  'profile_details',
  'preferences',
  'permissions',
  'review',
  'tutorial',
];

/**
 * Total number of steps for progress calculation.
 */
export const ONBOARDING_TOTAL_STEPS = ONBOARDING_PROGRESS_STEPS.length;

/**
 * Get the 1-based step number for a given onboarding step.
 * Returns null if step is not in the progress flow (e.g., welcome).
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
 * Map route path to OnboardingStep.
 * Useful when step state is not available but route is.
 */
export function routeToStep(routePath: string): OnboardingStep | null {
  // Remove leading slash and (onboarding) prefix
  const cleanPath = routePath
    .replace(/^\/?\(onboarding\)\/?/, '')
    .replace(/^\//, '');

  // Handle profile-details sub-routes
  if (cleanPath.startsWith('profile-details')) {
    return 'profile_details';
  }

  // Convert kebab-case to snake_case
  const stepName = cleanPath.replace(/-/g, '_');

  // Check if it's a valid step
  if (ONBOARDING_PROGRESS_STEPS.includes(stepName as OnboardingStep)) {
    return stepName as OnboardingStep;
  }

  // Handle index route
  if (cleanPath === '' || cleanPath === 'index') {
    return 'welcome';
  }

  return null;
}
