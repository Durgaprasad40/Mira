import type { Phase1ProfileData } from '@/stores/privateProfileStore';

export type Phase2OnboardingStep =
  | 'index'
  | 'nickname'
  | 'select-photos'
  | 'profile-edit'
  | 'prompts'
  | 'profile-setup'
  | 'complete';

export const PHASE2_ONBOARDING_ROUTE_MAP: Record<Exclude<Phase2OnboardingStep, 'complete'>, string> = {
  index: '/(main)/phase2-onboarding',
  nickname: '/(main)/phase2-onboarding/nickname',
  'select-photos': '/(main)/phase2-onboarding/select-photos',
  'profile-edit': '/(main)/phase2-onboarding/profile-edit',
  prompts: '/(main)/phase2-onboarding/prompts',
  'profile-setup': '/(main)/phase2-onboarding/profile-setup',
};

export const PHASE2_ONBOARDING_STEP_ORDER: Record<Exclude<Phase2OnboardingStep, 'complete'>, number> = {
  index: 1,
  nickname: 2,
  'select-photos': 3,
  'profile-edit': 4,
  prompts: 5,
  'profile-setup': 6,
};

type Phase1Photo = {
  order?: number | null;
  url?: string | null;
};

export type Phase1UserForImport = {
  name?: string | null;
  handle?: string | null;
  photos?: Phase1Photo[] | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  city?: string | null;
  activities?: string[] | null;
  isVerified?: boolean | null;
  height?: number | null;
  weight?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  education?: string | null;
  religion?: string | null;
};

export function buildPhase1ImportData(currentUser: Phase1UserForImport): Phase1ProfileData {
  const sortedPhotos = Array.isArray(currentUser.photos)
    ? [...currentUser.photos]
        .filter((photo): photo is { order?: number | null; url: string } => typeof photo?.url === 'string' && photo.url.length > 0)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  return {
    name: currentUser.name || '',
    handle: currentUser.handle || '',
    photos: sortedPhotos.map((photo) => ({ url: photo.url })),
    dateOfBirth: currentUser.dateOfBirth || '',
    gender: currentUser.gender || '',
    city: currentUser.city || '',
    activities: currentUser.activities || [],
    isVerified: currentUser.isVerified || false,
    height: currentUser.height ?? null,
    weight: currentUser.weight ?? null,
    smoking: currentUser.smoking ?? null,
    drinking: currentUser.drinking ?? null,
    education: currentUser.education ?? null,
    religion: currentUser.religion ?? null,
  };
}
