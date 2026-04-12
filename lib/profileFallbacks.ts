/**
 * Profile Display Fallback Utility
 *
 * Provides consistent fallback values for empty/minimal profile data.
 * Used by Discover cards and full profile views.
 *
 * CRITICAL RULES:
 * - Does NOT change stored data
 * - Only affects DISPLAY
 * - Minimal profiles should look intentional, not broken
 * - Empty sections should hide cleanly, not show empty placeholders
 */

// Neutral fallback line - used only when a caller explicitly opts in.
// This is a system cue, not synthetic personality copy.
export const FALLBACK_BIO = "Profile still getting started";

// Alternative neutral fallback lines (for variation if needed)
export const FALLBACK_BIO_OPTIONS = [
  "Profile still getting started",
  "No bio added yet",
];

/**
 * Get display bio with optional neutral fallback for empty values.
 *
 * @param bio - Raw bio from profile
 * @param useFallback - Whether to show fallback text (default: false)
 * @returns Bio text to display, or fallback if empty
 */
export function getDisplayBio(
  bio: string | null | undefined,
  useFallback: boolean = false
): string | null {
  // Check for meaningful bio
  if (bio && bio.trim().length > 0) {
    return bio.trim();
  }

  // Return fallback or null based on preference
  return useFallback ? FALLBACK_BIO : null;
}

/**
 * Check if a bio should be displayed (has meaningful content).
 */
export function hasMeaningfulBio(bio: string | null | undefined): boolean {
  return !!bio && bio.trim().length > 0;
}

/**
 * Check if prompts section should be displayed.
 * Empty prompts array = hide section entirely.
 */
export function hasDisplayablePrompts(
  prompts: { question: string; answer: string }[] | null | undefined
): boolean {
  if (!prompts || prompts.length === 0) return false;
  // Check that at least one prompt has a non-empty answer
  return prompts.some(p => p.answer && p.answer.trim().length > 0);
}

/**
 * Check if interests/activities section should be displayed.
 */
export function hasDisplayableInterests(
  activities: string[] | null | undefined
): boolean {
  return !!activities && activities.length > 0;
}

/**
 * Check if lifestyle section should be displayed.
 * At least one lifestyle field must have a value.
 */
export function hasDisplayableLifestyle(profile: {
  height?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  exercise?: string | null;
  pets?: string[] | null;
  kids?: string | null;
}): boolean {
  const hasHeight = !!profile.height && profile.height > 0;
  const hasSmoking = !!profile.smoking && profile.smoking !== 'prefer_not_to_say';
  const hasDrinking = !!profile.drinking && profile.drinking !== 'prefer_not_to_say';
  const hasExercise = !!profile.exercise;
  const hasPets = !!profile.pets && profile.pets.length > 0;
  const hasKids = !!profile.kids;

  return hasHeight || hasSmoking || hasDrinking || hasExercise || hasPets || hasKids;
}

/**
 * Check if essentials section should be displayed.
 * At least one essentials field must have a value.
 */
export function hasDisplayableEssentials(profile: {
  height?: number | null;
  jobTitle?: string | null;
  school?: string | null;
  education?: string | null;
}): boolean {
  const hasHeight = !!profile.height && profile.height > 0;
  const hasJob = !!profile.jobTitle && profile.jobTitle.trim().length > 0;
  const hasSchool = !!profile.school && profile.school.trim().length > 0;
  const hasEducation = !!profile.education;

  return hasHeight || hasJob || hasSchool || hasEducation;
}

/**
 * Profile completeness summary for minimal profiles.
 * Returns a message indicating how complete the profile is.
 */
export function getProfileCompletenessLabel(profile: {
  bio?: string | null;
  profilePrompts?: { question: string; answer: string }[] | null;
  activities?: string[] | null;
  height?: number | null;
}): 'complete' | 'partial' | 'minimal' {
  let score = 0;

  if (hasMeaningfulBio(profile.bio)) score++;
  if (hasDisplayablePrompts(profile.profilePrompts)) score++;
  if (hasDisplayableInterests(profile.activities)) score++;
  if (profile.height && profile.height > 0) score++;

  if (score >= 3) return 'complete';
  if (score >= 1) return 'partial';
  return 'minimal';
}

// Export config for consistency
export const PROFILE_FALLBACK_CONFIG = {
  fallbackBio: FALLBACK_BIO,
  minBioLength: 10, // Minimum bio length to be considered "meaningful"
  minPromptAnswerLength: 5, // Minimum prompt answer length
};
