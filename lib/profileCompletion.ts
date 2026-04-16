/**
 * Profile Completion System
 *
 * PHASE-1: Lightweight, non-blocking system to encourage profile completion.
 *
 * SCORING MODEL (100 points total - balanced full profile):
 *
 * 1. Identity & Trust = 15
 * - name: 5
 * - dateOfBirth: 3
 * - gender: 2
 * - verification: 5
 *
 * 2. Photos = 20
 * - 2+ photos: 10
 * - 3+ photos: 4
 * - 4+ photos: 3
 * - 6+ photos: 3
 *
 * 3. Bio & Prompts = 25
 * - bio (>= 80 chars): 10
 * - prompts (>= 20 chars each): 1=5, 2=10, 3=15
 *
 * 4. Core Details = 15
 * - college (stored as school): 5
 * - job/company: 5
 * - education: 5
 *
 * 5. Lifestyle Basics = 10
 * - height: 2
 * - smoking: 2
 * - drinking: 2
 * - kids: 2
 * - exercise: 2
 *
 * 6. Interests & Depth = 5
 * - activities (>= 3): 3
 * - pets (>= 1): 2
 *
 * 7. Life Rhythm = 10
 * - complete if >= 3 of 6 are present: city, socialRhythm, sleepSchedule, travelStyle, workStyle, coreValues>=3
 */

export type ProfileFieldKey =
  | 'name'
  | 'dateOfBirth'
  | 'gender'
  | 'verification'
  | 'photos_2'
  | 'photos_3'
  | 'photos_4'
  | 'photos_6'
  | 'bio'
  | 'prompt_1'
  | 'prompt_2'
  | 'prompt_3'
  | 'college'
  | 'job'
  | 'education'
  | 'height'
  | 'smoking'
  | 'drinking'
  | 'kids'
  | 'exercise'
  | 'activities'
  | 'pets'
  | 'lifeRhythm';

export interface ProfileField {
  key: ProfileFieldKey;
  label: string;
  points: number;
  category:
    | 'identity'
    | 'photos'
    | 'bio_prompts'
    | 'core_details'
    | 'lifestyle'
    | 'interests_depth'
    | 'life_rhythm';
  editRoute: string;
  editSection?: string;
  priority: number; // Lower = higher priority for next actions
}

// Field definitions with scoring weights
export const PROFILE_FIELDS: ProfileField[] = [
  // Identity & Trust (15)
  { key: 'name', label: 'Name', points: 5, category: 'identity', editRoute: 'edit-profile', editSection: 'basic', priority: 1 },
  { key: 'dateOfBirth', label: 'Date of Birth', points: 3, category: 'identity', editRoute: 'edit-profile', editSection: 'basic', priority: 2 },
  { key: 'gender', label: 'Gender', points: 2, category: 'identity', editRoute: 'edit-profile', editSection: 'basic', priority: 3 },
  { key: 'verification', label: 'Verification', points: 5, category: 'identity', editRoute: 'face-verification', priority: 4 },

  // Photos (20)
  { key: 'photos_2', label: 'Add 2 photos', points: 10, category: 'photos', editRoute: 'edit-profile', editSection: 'photos', priority: 1 },
  { key: 'photos_3', label: 'Add a 3rd photo', points: 4, category: 'photos', editRoute: 'edit-profile', editSection: 'photos', priority: 2 },
  { key: 'photos_4', label: 'Add a 4th photo', points: 3, category: 'photos', editRoute: 'edit-profile', editSection: 'photos', priority: 3 },
  { key: 'photos_6', label: 'Add more photos', points: 3, category: 'photos', editRoute: 'edit-profile', editSection: 'photos', priority: 4 },

  // Bio & Prompts (25)
  { key: 'bio', label: 'Bio', points: 10, category: 'bio_prompts', editRoute: 'edit-profile', editSection: 'about', priority: 1 },
  { key: 'prompt_1', label: 'First prompt', points: 5, category: 'bio_prompts', editRoute: 'edit-profile', editSection: 'prompts', priority: 2 },
  { key: 'prompt_2', label: 'Second prompt', points: 5, category: 'bio_prompts', editRoute: 'edit-profile', editSection: 'prompts', priority: 3 },
  { key: 'prompt_3', label: 'Third prompt', points: 5, category: 'bio_prompts', editRoute: 'edit-profile', editSection: 'prompts', priority: 4 },

  // Core Details (15)
  { key: 'college', label: 'College', points: 5, category: 'core_details', editRoute: 'edit-profile', editSection: 'education', priority: 1 },
  { key: 'job', label: 'Job / Company', points: 5, category: 'core_details', editRoute: 'edit-profile', editSection: 'details', priority: 2 },
  { key: 'education', label: 'Education', points: 5, category: 'core_details', editRoute: 'edit-profile', editSection: 'education', priority: 3 },

  // Lifestyle Basics (10)
  { key: 'height', label: 'Height', points: 2, category: 'lifestyle', editRoute: 'edit-profile', editSection: 'details', priority: 1 },
  { key: 'smoking', label: 'Smoking', points: 2, category: 'lifestyle', editRoute: 'edit-profile', editSection: 'lifestyle', priority: 2 },
  { key: 'drinking', label: 'Drinking', points: 2, category: 'lifestyle', editRoute: 'edit-profile', editSection: 'lifestyle', priority: 3 },
  { key: 'kids', label: 'Kids', points: 2, category: 'lifestyle', editRoute: 'edit-profile', editSection: 'lifestyle', priority: 4 },
  { key: 'exercise', label: 'Exercise', points: 2, category: 'lifestyle', editRoute: 'edit-profile', editSection: 'lifestyle', priority: 5 },

  // Interests & Depth (5)
  { key: 'activities', label: 'Interests', points: 3, category: 'interests_depth', editRoute: 'edit-profile', editSection: 'interests', priority: 1 },
  { key: 'pets', label: 'Pets', points: 2, category: 'interests_depth', editRoute: 'edit-profile', editSection: 'lifestyle', priority: 2 },

  // Life Rhythm (10)
  { key: 'lifeRhythm', label: 'Life Rhythm', points: 10, category: 'life_rhythm', editRoute: 'edit-profile', editSection: 'lifeRhythm', priority: 1 },
];

// Action descriptions for nudges
export const ACTION_DESCRIPTIONS: Record<ProfileFieldKey, string> = {
  name: 'Add your name',
  dateOfBirth: 'Add your date of birth',
  gender: 'Select your gender',
  verification: 'Verify your profile',
  photos_2: 'Add at least 2 photos',
  photos_3: 'Add a 3rd photo',
  photos_4: 'Add a 4th photo',
  photos_6: 'Add more photos',
  bio: 'Add a bio',
  prompt_1: 'Answer your first prompt',
  prompt_2: 'Answer a second prompt',
  prompt_3: 'Answer a third prompt',
  college: 'Add your college',
  job: 'Add your job/company',
  education: 'Add your education',
  height: 'Add your height',
  smoking: 'Add your smoking preference',
  drinking: 'Add your drinking preference',
  kids: 'Add your kids preference',
  exercise: 'Add your exercise preference',
  activities: 'Pick at least 3 interests',
  pets: 'Add your pets preference',
  lifeRhythm: 'Add your life rhythm',
};

export interface UserProfileData {
  name?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  isVerified?: boolean;
  faceVerificationPassed?: boolean;
  photos?: any[] | null;
  photoUrls?: any[] | null;
  bio?: string | null;
  profilePrompts?: { question: string; answer: string }[] | null;
  education?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  school?: string | null;
  height?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  kids?: string | null;
  exercise?: string | null;
  pets?: string[] | null;
  activities?: string[] | null;
  lifeRhythm?: {
    city?: string | null;
    socialRhythm?: string | null;
    sleepSchedule?: string | null;
    travelStyle?: string | null;
    workStyle?: string | null;
    coreValues?: string[] | null;
  } | null;
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
    if (p && p.answer && p.answer.trim().length >= 20) return true;
    return false;
  }).length;
}

function hasLifeRhythmDepth(userData: UserProfileData): boolean {
  const lr = userData.lifeRhythm;
  if (!lr) return false;

  const coreValuesCount = Array.isArray(lr.coreValues) ? lr.coreValues.length : 0;
  const signals = [
    typeof lr.city === 'string' && lr.city.trim().length > 0,
    typeof lr.socialRhythm === 'string' && lr.socialRhythm.length > 0,
    typeof lr.sleepSchedule === 'string' && lr.sleepSchedule.length > 0,
    typeof lr.travelStyle === 'string' && lr.travelStyle.length > 0,
    typeof lr.workStyle === 'string' && lr.workStyle.length > 0,
    coreValuesCount >= 3,
  ];

  return signals.filter(Boolean).length >= 3;
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

    case 'verification':
      return !!(userData.isVerified || userData.faceVerificationPassed);

    case 'photos_2':
      return countValidPhotos(userData) >= 2;

    case 'photos_3':
      return countValidPhotos(userData) >= 3;

    case 'photos_4':
      return countValidPhotos(userData) >= 4;

    case 'photos_6':
      return countValidPhotos(userData) >= 6;

    case 'bio':
      return !!(userData.bio && userData.bio.trim().length >= 80);

    case 'prompt_1':
      return countValidPrompts(userData) >= 1;

    case 'prompt_2':
      return countValidPrompts(userData) >= 2;

    case 'prompt_3':
      return countValidPrompts(userData) >= 3;

    case 'college':
      return !!(userData.school && userData.school.trim().length >= 2);

    case 'education':
      return !!(userData.education && userData.education.length > 0);

    case 'job':
      return !!(
        (userData.jobTitle && userData.jobTitle.trim().length >= 2) ||
        (userData.company && userData.company.trim().length >= 2)
      );

    case 'height':
      return typeof userData.height === 'number' && userData.height > 0;

    case 'smoking':
      return !!(userData.smoking && userData.smoking.length > 0);

    case 'drinking':
      return !!(userData.drinking && userData.drinking.length > 0);

    case 'kids':
      return !!(userData.kids && userData.kids.length > 0);

    case 'exercise':
      return !!(userData.exercise && userData.exercise.length > 0);

    case 'activities':
      return Array.isArray(userData.activities) && userData.activities.length >= 3;

    case 'pets':
      return Array.isArray(userData.pets) && userData.pets.length >= 1;

    case 'lifeRhythm':
      return hasLifeRhythmDepth(userData);

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
      nextBestActions: PROFILE_FIELDS.slice(0, 3),
      baseComplete: false,
      optionalComplete: false,
    };
  }

  const completedFields: ProfileFieldKey[] = [];
  const missingFields: ProfileFieldKey[] = [];
  let score = 0;
  let identityScore = 0;
  let photosScore = 0;
  let bioPromptsScore = 0;
  let coreDetailsScore = 0;
  let lifestyleScore = 0;
  let interestsDepthScore = 0;
  let lifeRhythmScore = 0;

  // Calculate scores for each field
  for (const field of PROFILE_FIELDS) {
    if (isFieldComplete(field.key, userData)) {
      completedFields.push(field.key);
      score += field.points;
      if (field.category === 'identity') identityScore += field.points;
      if (field.category === 'photos') photosScore += field.points;
      if (field.category === 'bio_prompts') bioPromptsScore += field.points;
      if (field.category === 'core_details') coreDetailsScore += field.points;
      if (field.category === 'lifestyle') lifestyleScore += field.points;
      if (field.category === 'interests_depth') interestsDepthScore += field.points;
      if (field.category === 'life_rhythm') lifeRhythmScore += field.points;
    } else {
      missingFields.push(field.key);
    }
  }

  const photoCount = countValidPhotos(userData);
  const promptCount = countValidPrompts(userData);
  const isBioComplete = isFieldComplete('bio', userData);
  const hasAnyBio = typeof userData.bio === 'string' && userData.bio.trim().length > 0;

  const missingByKey = new Set(missingFields);
  const missingFieldsByImpact = PROFILE_FIELDS
    .filter((f) => missingByKey.has(f.key))
    .sort((a, b) => b.points - a.points || a.priority - b.priority);

  const shouldAllowPhotoMilestones = photoCount < 4;
  const nextBestActions: ProfileField[] = [];

  // Required suggestion behavior:
  // 1) If fewer than 2 photos -> photos first
  if (photoCount < 2) {
    const photos2 = PROFILE_FIELDS.find((f) => f.key === 'photos_2');
    if (photos2) nextBestActions.push(photos2);
  } else if (!hasAnyBio) {
    const bio = PROFILE_FIELDS.find((f) => f.key === 'bio');
    if (bio) nextBestActions.push(bio);
  } else if (promptCount < 3) {
    const nextPromptKey: ProfileFieldKey =
      promptCount < 1 ? 'prompt_1' : promptCount < 2 ? 'prompt_2' : 'prompt_3';
    const nextPrompt = PROFILE_FIELDS.find((f) => f.key === nextPromptKey);
    if (nextPrompt) nextBestActions.push(nextPrompt);
  }

  // Fill remaining slots with highest-impact missing fields,
  // preferring different categories when possible.
  const pickedKeys = new Set(nextBestActions.map((a) => a.key));
  const pickedCategories = new Set(nextBestActions.map((a) => a.category));

  for (const candidate of missingFieldsByImpact) {
    if (nextBestActions.length >= 3) break;
    if (pickedKeys.has(candidate.key)) continue;

    // Do not spam photos once user has 4 photos (except the 2-photo minimum handled above).
    if (candidate.category === 'photos' && !shouldAllowPhotoMilestones) {
      continue;
    }
    // Also never suggest photos_6 after 4 photos under current product rule.
    if (candidate.key === 'photos_6' && !shouldAllowPhotoMilestones) {
      continue;
    }

    if (!pickedCategories.has(candidate.category)) {
      nextBestActions.push(candidate);
      pickedKeys.add(candidate.key);
      pickedCategories.add(candidate.category);
      continue;
    }
  }

  // If we still have room, allow same-category picks.
  if (nextBestActions.length < 3) {
    for (const candidate of missingFieldsByImpact) {
      if (nextBestActions.length >= 3) break;
      if (pickedKeys.has(candidate.key)) continue;
      if (candidate.category === 'photos' && !shouldAllowPhotoMilestones) continue;
      if (candidate.key === 'photos_6' && !shouldAllowPhotoMilestones) continue;
      nextBestActions.push(candidate);
      pickedKeys.add(candidate.key);
    }
  }

  const percentage = Math.round(score);
  const baseComplete = identityScore >= 15 && photosScore >= 10; // minimum viability: identity + 2 photos
  const optionalComplete =
    bioPromptsScore >= 25 &&
    coreDetailsScore >= 15 &&
    lifestyleScore >= 10 &&
    interestsDepthScore >= 5 &&
    lifeRhythmScore >= 10;

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
