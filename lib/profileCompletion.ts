/**
 * Profile Completion System
 *
 * PHASE-1: Lightweight, non-blocking system to encourage profile completion.
 *
 * SCORING MODEL (100 points total):
 *
 * BASE PROFILE (50 points - from onboarding):
 * - name: 8 points
 * - dateOfBirth: 5 points
 * - gender: 5 points
 * - faceVerification: 10 points
 * - photos (min 2): 12 points
 * - lookingFor: 5 points
 * - relationshipIntent: 5 points
 *
 * PROFILE COMPLETION (50 points - optional):
 * - bio: 10 points
 * - prompt 1: 8 points
 * - prompt 2: 8 points
 * - prompt 3: 8 points
 * - 3rd photo: 5 points
 * - 4th photo: 5 points
 * - education: 3 points
 * - job/company: 3 points
 */

export type ProfileFieldKey =
  | 'name'
  | 'dateOfBirth'
  | 'gender'
  | 'faceVerification'
  | 'photos_base'
  | 'lookingFor'
  | 'relationshipIntent'
  | 'bio'
  | 'prompt_1'
  | 'prompt_2'
  | 'prompt_3'
  | 'photo_3'
  | 'photo_4'
  | 'education'
  | 'job';

export interface ProfileField {
  key: ProfileFieldKey;
  label: string;
  points: number;
  category: 'base' | 'optional';
  editRoute: string;
  editSection?: string;
  priority: number; // Lower = higher priority for next actions
}

// Field definitions with scoring weights
export const PROFILE_FIELDS: ProfileField[] = [
  // BASE PROFILE (50 points)
  { key: 'name', label: 'Name', points: 8, category: 'base', editRoute: 'edit-profile', editSection: 'basic', priority: 1 },
  { key: 'dateOfBirth', label: 'Date of Birth', points: 5, category: 'base', editRoute: 'edit-profile', editSection: 'basic', priority: 2 },
  { key: 'gender', label: 'Gender', points: 5, category: 'base', editRoute: 'edit-profile', editSection: 'basic', priority: 3 },
  { key: 'faceVerification', label: 'Face Verification', points: 10, category: 'base', editRoute: 'face-verification', priority: 4 },
  { key: 'photos_base', label: 'Profile Photos', points: 12, category: 'base', editRoute: 'edit-profile', editSection: 'photos', priority: 5 },
  { key: 'lookingFor', label: 'Looking For', points: 5, category: 'base', editRoute: 'edit-profile', editSection: 'preferences', priority: 6 },
  { key: 'relationshipIntent', label: 'Relationship Goals', points: 5, category: 'base', editRoute: 'edit-profile', editSection: 'preferences', priority: 7 },

  // OPTIONAL PROFILE (50 points)
  { key: 'bio', label: 'Bio', points: 10, category: 'optional', editRoute: 'edit-profile', editSection: 'about', priority: 1 },
  { key: 'prompt_1', label: 'First Prompt', points: 8, category: 'optional', editRoute: 'edit-profile', editSection: 'prompts', priority: 2 },
  { key: 'prompt_2', label: 'Second Prompt', points: 8, category: 'optional', editRoute: 'edit-profile', editSection: 'prompts', priority: 3 },
  { key: 'prompt_3', label: 'Third Prompt', points: 8, category: 'optional', editRoute: 'edit-profile', editSection: 'prompts', priority: 4 },
  { key: 'photo_3', label: 'Add 3rd Photo', points: 5, category: 'optional', editRoute: 'edit-profile', editSection: 'photos', priority: 5 },
  { key: 'photo_4', label: 'Add 4th Photo', points: 5, category: 'optional', editRoute: 'edit-profile', editSection: 'photos', priority: 6 },
  { key: 'education', label: 'Education', points: 3, category: 'optional', editRoute: 'edit-profile', editSection: 'education', priority: 7 },
  { key: 'job', label: 'Job/Company', points: 3, category: 'optional', editRoute: 'edit-profile', editSection: 'details', priority: 8 },
];

// Action descriptions for nudges
export const ACTION_DESCRIPTIONS: Record<ProfileFieldKey, string> = {
  name: 'Add your name',
  dateOfBirth: 'Add your date of birth',
  gender: 'Select your gender',
  faceVerification: 'Verify your face',
  photos_base: 'Add at least 2 photos',
  lookingFor: 'Select who you\'re looking for',
  relationshipIntent: 'Add your relationship goals',
  bio: 'Write a bio to get 3x more matches',
  prompt_1: 'Answer your first prompt',
  prompt_2: 'Answer a second prompt',
  prompt_3: 'Answer a third prompt',
  photo_3: 'Add a 3rd photo',
  photo_4: 'Add a 4th photo',
  education: 'Add your education',
  job: 'Add your job/company',
};

export interface UserProfileData {
  name?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  isVerified?: boolean;
  faceVerificationPassed?: boolean;
  photos?: any[] | null;
  photoUrls?: any[] | null;
  lookingFor?: string[] | null;
  relationshipIntent?: string[] | null;
  bio?: string | null;
  profilePrompts?: { question: string; answer: string }[] | null;
  education?: string | null;
  jobTitle?: string | null;
  company?: string | null;
}

export interface ProfileCompletionResult {
  percentage: number;
  score: number;
  maxScore: number;
  completedFields: ProfileFieldKey[];
  missingFields: ProfileFieldKey[];
  nextBestActions: ProfileField[];
  baseComplete: boolean;
  optionalComplete: boolean;
}

/**
 * Count valid photos from user data.
 * Handles multiple photo formats: string[], { url: string }[], etc.
 */
function countValidPhotos(userData: UserProfileData): number {
  const photos = userData.photos || userData.photoUrls || [];
  if (!Array.isArray(photos)) return 0;

  return photos.filter((p: any) => {
    if (typeof p === 'string' && p.length > 0) return true;
    if (p && typeof p === 'object' && p.url && p.url.length > 0) return true;
    return false;
  }).length;
}

/**
 * Count valid prompts from user data.
 */
function countValidPrompts(userData: UserProfileData): number {
  const prompts = userData.profilePrompts || [];
  if (!Array.isArray(prompts)) return 0;

  return prompts.filter((p: any) => {
    if (p && p.answer && p.answer.trim().length > 0) return true;
    return false;
  }).length;
}

/**
 * Check if a field is completed.
 */
function isFieldComplete(key: ProfileFieldKey, userData: UserProfileData): boolean {
  switch (key) {
    case 'name':
      return !!(userData.name && userData.name.trim().length > 0);

    case 'dateOfBirth':
      return !!(userData.dateOfBirth && userData.dateOfBirth.length > 0);

    case 'gender':
      return !!(userData.gender && userData.gender.length > 0);

    case 'faceVerification':
      return !!(userData.isVerified || userData.faceVerificationPassed);

    case 'photos_base':
      return countValidPhotos(userData) >= 2;

    case 'lookingFor':
      return !!(userData.lookingFor && userData.lookingFor.length > 0);

    case 'relationshipIntent':
      return !!(userData.relationshipIntent && userData.relationshipIntent.length > 0);

    case 'bio':
      return !!(userData.bio && userData.bio.trim().length >= 10);

    case 'prompt_1':
      return countValidPrompts(userData) >= 1;

    case 'prompt_2':
      return countValidPrompts(userData) >= 2;

    case 'prompt_3':
      return countValidPrompts(userData) >= 3;

    case 'photo_3':
      return countValidPhotos(userData) >= 3;

    case 'photo_4':
      return countValidPhotos(userData) >= 4;

    case 'education':
      return !!(userData.education && userData.education.length > 0);

    case 'job':
      return !!((userData.jobTitle && userData.jobTitle.trim().length > 0) ||
                (userData.company && userData.company.trim().length > 0));

    default:
      return false;
  }
}

/**
 * Calculate profile completion score and metadata.
 *
 * @param userData - User profile data from Convex or demo store
 * @returns ProfileCompletionResult with score, completed fields, missing fields, and next actions
 */
export function getProfileCompletion(userData: UserProfileData | null | undefined): ProfileCompletionResult {
  // Handle null/undefined userData gracefully
  if (!userData) {
    return {
      percentage: 0,
      score: 0,
      maxScore: 100,
      completedFields: [],
      missingFields: PROFILE_FIELDS.map(f => f.key),
      nextBestActions: PROFILE_FIELDS.filter(f => f.category === 'optional').slice(0, 3),
      baseComplete: false,
      optionalComplete: false,
    };
  }

  const completedFields: ProfileFieldKey[] = [];
  const missingFields: ProfileFieldKey[] = [];
  let score = 0;
  let baseScore = 0;
  let optionalScore = 0;
  const baseMaxScore = 50;
  const optionalMaxScore = 50;

  // Calculate scores for each field
  for (const field of PROFILE_FIELDS) {
    if (isFieldComplete(field.key, userData)) {
      completedFields.push(field.key);
      score += field.points;
      if (field.category === 'base') {
        baseScore += field.points;
      } else {
        optionalScore += field.points;
      }
    } else {
      missingFields.push(field.key);
    }
  }

  // Get next best actions (top 3 missing optional fields, sorted by priority)
  const missingOptionalFields = PROFILE_FIELDS
    .filter(f => f.category === 'optional' && missingFields.includes(f.key))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);

  // If all optional fields are complete but base is missing, show base fields
  const nextBestActions = missingOptionalFields.length > 0
    ? missingOptionalFields
    : PROFILE_FIELDS
        .filter(f => f.category === 'base' && missingFields.includes(f.key))
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 3);

  const percentage = Math.round(score);
  const baseComplete = baseScore >= baseMaxScore;
  const optionalComplete = optionalScore >= optionalMaxScore;

  return {
    percentage,
    score,
    maxScore: 100,
    completedFields,
    missingFields,
    nextBestActions,
    baseComplete,
    optionalComplete,
  };
}

/**
 * Get a friendly completion status message.
 */
export function getCompletionStatusMessage(percentage: number): string {
  if (percentage >= 100) return "Profile complete! You're ready to get more matches.";
  if (percentage >= 80) return "Almost there! A few more details will boost your visibility.";
  if (percentage >= 60) return "Good progress! Complete your profile to get 3x more matches.";
  if (percentage >= 40) return "Keep going! Add more details to stand out.";
  return "Complete your profile to start getting matches.";
}

/**
 * Get completion tier for styling/badges.
 */
export function getCompletionTier(percentage: number): 'incomplete' | 'basic' | 'good' | 'great' | 'complete' {
  if (percentage >= 100) return 'complete';
  if (percentage >= 80) return 'great';
  if (percentage >= 60) return 'good';
  if (percentage >= 40) return 'basic';
  return 'incomplete';
}
