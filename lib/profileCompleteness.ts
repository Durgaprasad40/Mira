/**
 * Profile completeness checker — pure derivation from profile fields.
 *
 * Returns a status indicating what the user still needs to complete.
 * Used by nudge UI to show soft, dismissible guidance.
 */

export type CompletenessStatus =
  | 'complete'
  | 'needs_photos'
  | 'needs_bio'
  | 'needs_both';

export interface CompletenessInput {
  photoCount: number;
  bioLength: number;
}

const MIN_PHOTOS = 2;
const MIN_BIO_LENGTH = 20;

/**
 * Determine what the user's profile is missing.
 * Returns 'complete' when both thresholds are met.
 */
export function getProfileCompleteness(input: CompletenessInput): CompletenessStatus {
  const needsPhotos = input.photoCount < MIN_PHOTOS;
  const needsBio = input.bioLength < MIN_BIO_LENGTH;

  if (needsPhotos && needsBio) return 'needs_both';
  if (needsPhotos) return 'needs_photos';
  if (needsBio) return 'needs_bio';
  return 'complete';
}

/** Human-friendly nudge messages per status and screen context. */
export const NUDGE_MESSAGES: Record<Exclude<CompletenessStatus, 'complete'>, {
  discover: string;
  settings: string;
  messages: string;
}> = {
  needs_photos: {
    discover: 'Add 1 more photo to get more matches',
    settings: 'Profiles with 2+ photos get significantly more matches',
    messages: 'Complete your profile to start more conversations',
  },
  needs_bio: {
    discover: 'Write a short bio to stand out',
    settings: 'A bio helps others learn about you — aim for 20+ characters',
    messages: 'Complete your profile to start more conversations',
  },
  needs_both: {
    discover: 'Add a photo and bio to get more matches',
    settings: 'Add photos and a bio to complete your profile',
    messages: 'Complete your profile to start more conversations',
  },
};
