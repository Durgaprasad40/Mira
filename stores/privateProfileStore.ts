/**
 * STORAGE POLICY: NO local persistence. Convex is ONLY source of truth.
 * Store is in-memory only. Any required rehydration must come from Convex queries/mutations.
 */
import { create } from 'zustand';
import type { PrivateIntentKey, PrivateDesireTag, PrivateBoundary, DesireCategory, PhotoSlots9 } from '@/types';
import { createEmptyPhotoSlots } from '@/types';
import type { Phase2PromptAnswer, PreferenceStrength, PreferenceStrengthValue, IntentMatchValue } from '@/lib/privateConstants';

/** Parse "YYYY-MM-DD" to local Date (noon to avoid DST issues) */
function parseDOBString(dobString: string): Date {
  if (!dobString || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) {
    return new Date(2000, 0, 1, 12, 0, 0);
  }
  const [y, m, d] = dobString.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

// Version constant - bump this to force re-setup
export const CURRENT_PHASE2_SETUP_VERSION = 1;

// Maximum Phase-1 photos that can be imported to Phase-2
export const MAX_PHASE1_PHOTO_IMPORTS = 3;

// Type for Phase-1 profile data imported during Phase-2 onboarding
export interface Phase1ProfileData {
  name: string;
  handle?: string; // Phase-1 nickname (used as Phase-2 displayName)
  photoSlots?: PhotoSlots9; // NEW: Slot-preserving photo array (9 slots)
  photos: { url: string }[]; // Legacy: list of photo URLs (for backward compat)
  bio?: string;
  gender?: string;
  dateOfBirth?: string;
  city?: string;
  activities?: string[]; // Hobbies/activities from Phase-1
  maxDistance?: number;
  isVerified?: boolean;
  // Extended fields for Phase-2 onboarding info preview
  height?: number | null;
  weight?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  kids?: string | null;
  education?: string | null;
  religion?: string | null;
}

interface PrivateProfile {
  username: string;
  bio: string;
  desireCategories: DesireCategory[];
  blurPhoto: boolean;
}

interface PrivateProfileState {
  // Legacy profile (used by PrivateProfileSection in incognito.tsx)
  profile: PrivateProfile;
  isSetup: boolean;
  setProfile: (updates: Partial<PrivateProfile>) => void;
  markSetup: () => void;

  // Wizard state
  currentStep: number;
  selectedPhotoIds: string[];
  selectedPhotoUrls: string[];
  blurredPhotoLocalUris: string[];
  blurredStorageIds: string[];
  blurredPhotoUrls: string[];

  // Category state
  intentKeys: PrivateIntentKey[];
  desireTags: PrivateDesireTag[];
  boundaries: PrivateBoundary[];
  privateBio: string;
  consentAgreed: boolean;

  // Auto-imported from main profile (Phase-1 → Phase-2)
  displayName: string;
  age: number;
  city: string;
  gender: string;
  hobbies: string[];      // Imported from Phase-1 activities
  isVerified: boolean;    // Imported from Phase-1 verification status
  // Extended imported fields (read-only, editable later in settings)
  height: number | null;
  weight: number | null;
  smoking: string | null;
  drinking: string | null;
  kids: string | null;
  education: string | null;
  religion: string | null;
  maxDistanceKm: number;  // Distance in km

  // Flags
  isSetupComplete: boolean;
  // Permanent flag - once true, onboarding NEVER shows again
  phase2OnboardingCompleted: boolean;
  convexProfileId: string | null;
  _hasHydrated: boolean;

  // Profile visibility (Pause Profile feature)
  isPrivateEnabled: boolean; // true = visible in Desire Land, false = paused/hidden

  // Phase-2 setup tracking
  acceptedTermsAt: number | null;
  phase2SetupVersion: number | null;
  blurMyPhoto: boolean;
  photoBlurSlots: boolean[];  // Per-slot blur state (9 slots, true=blurred)
  phase1PhotoSlots: PhotoSlots9;  // Slot-preserving photos from Phase-1 (9 slots)
  phase2PhotosConfirmed: boolean; // True after initial photo selection in Step-2

  // Phase-2 Onboarding Step 3: Prompt answers
  promptAnswers: Phase2PromptAnswer[]; // Answered prompts from Step 3

  // Phase-2 Preference Strength (ranking signal)
  preferenceStrength: PreferenceStrength;

  // Navigation lock: prevents duplicate router.replace calls in PrivateEntryGuard
  privateEntryNavLock: boolean;

  // PHASE 1 Settings — Photo & Media Privacy
  defaultPhotoVisibility: 'public' | 'blurred' | 'private';
  allowUnblurRequests: boolean;
  defaultSecureMediaTimer: 0 | 10 | 30;
  defaultSecureMediaViewingMode: 'tap' | 'hold';

  // PHASE 1 Settings — Communication Style (renamed from Connection Vibe)
  communicationStyle: 'text-first' | 'voice-friendly' | 'meet-oriented' | null;

  // PHASE 1 Settings — Discoverability
  desirelandVisibility: 'active' | 'paused' | 'hidden';
  ageVisibility: 'exact' | 'range' | 'hide';

  // PHASE 1 Settings — Safety
  whoCanMessageMe: 'everyone' | 'matches' | 'verified';
  safeMode: boolean;

  // Deletion State (30-day soft delete)
  deletionStatus: 'active' | 'pending_deletion' | 'deleted';
  deletedAt: number | null; // Timestamp when deletion was initiated
  recoverUntil: number | null; // Timestamp = deletedAt + 30 days

  // Phase-2 Privacy Settings (Deep Connect specific)
  hideFromDeepConnect: boolean;
  hideAge: boolean;
  hideDistance: boolean;
  disableReadReceipts: boolean;

  // Phase-2 Notifications Settings
  notificationsEnabled: boolean;
  notificationCategories: Record<string, boolean>;

  // Actions — wizard navigation
  setCurrentStep: (step: number) => void;

  // Actions — photo selection
  setSelectedPhotos: (ids: string[], urls: string[]) => void;

  // Actions — blurred photos
  setBlurredPhotoLocalUris: (uris: string[]) => void;
  setBlurredStorageIds: (ids: string[]) => void;
  setBlurredPhotoUrls: (urls: string[]) => void;

  // Actions — categories
  setIntentKeys: (keys: PrivateIntentKey[]) => void;
  setDesireTags: (tags: PrivateDesireTag[]) => void;
  setBoundaries: (boundaries: PrivateBoundary[]) => void;
  setPrivateBio: (bio: string) => void;
  setConsentAgreed: (agreed: boolean) => void;

  // Actions — profile info
  setProfileInfo: (info: { displayName: string; age: number; city: string; gender: string }) => void;
  // Actions — individual profile field setters (for Phase-2 editing)
  setGender: (gender: string) => void;
  setHeight: (height: number | null) => void;
  setWeight: (weight: number | null) => void;
  setSmoking: (smoking: string | null) => void;
  setDrinking: (drinking: string | null) => void;
  setEducation: (education: string | null) => void;
  setReligion: (religion: string | null) => void;
  setHobbies: (hobbies: string[]) => void;

  // Actions — completion
  setIsSetupComplete: (complete: boolean) => void;
  setConvexProfileId: (id: string | null) => void;

  // Actions — reset
  resetWizard: () => void;
  resetPhase2: () => void; // Full Phase-2 profile reset (clears everything)
  resetPhase2ForTesting: () => void; // DEV ONLY: Full reset including completion flag

  // Hydration
  setHasHydrated: (hydrated: boolean) => void;

  // Phase-2 setup actions
  setAcceptedTermsAt: (timestamp: number) => void;
  setBlurMyPhoto: (blur: boolean) => void;
  setPhotoBlurSlots: (slots: boolean[]) => void;
  togglePhotoBlurSlot: (slotIndex: number) => void;
  importPhase1Data: (data: Phase1ProfileData) => void;
  completeSetup: () => void;
  setPhase2PhotosConfirmed: (confirmed: boolean) => void;
  setPrivateEntryNavLock: (locked: boolean) => void;

  // Phase-2 Onboarding Step 3: Prompt answer actions
  setPromptAnswer: (promptId: string, question: string, answer: string) => void;
  setPromptAnswers: (answers: Phase2PromptAnswer[]) => void;
  removePromptAnswer: (promptId: string) => void;

  // Phase-2 Preference Strength action
  setPreferenceStrength: (field: keyof PreferenceStrength, value: PreferenceStrengthValue | IntentMatchValue) => void;

  // PHASE 1 Settings Actions
  setDefaultPhotoVisibility: (visibility: 'public' | 'blurred' | 'private') => void;
  setAllowUnblurRequests: (allow: boolean) => void;
  setDefaultSecureMediaTimer: (timer: 0 | 10 | 30) => void;
  setDefaultSecureMediaViewingMode: (mode: 'tap' | 'hold') => void;
  setCommunicationStyle: (style: 'text-first' | 'voice-friendly' | 'meet-oriented' | null) => void;
  setDesirelandVisibility: (visibility: 'active' | 'paused' | 'hidden') => void;
  setAgeVisibility: (visibility: 'exact' | 'range' | 'hide') => void;
  setWhoCanMessageMe: (who: 'everyone' | 'matches' | 'verified') => void;
  setSafeMode: (enabled: boolean) => void;

  // Profile Visibility Actions (Pause Profile)
  setIsPrivateEnabled: (enabled: boolean) => void;

  // Deletion Actions
  initiatePrivateDataDeletion: () => void;
  recoverPrivateData: () => void;

  // Phase-2 Privacy Actions
  setHideFromDeepConnect: (value: boolean) => void;
  setHideAge: (value: boolean) => void;
  setHideDistance: (value: boolean) => void;
  setDisableReadReceipts: (value: boolean) => void;

  // Phase-2 Notifications Actions
  setNotificationsEnabled: (value: boolean) => void;
  setNotificationCategory: (key: string, value: boolean) => void;

  // ST-001 FIX: Hydrate store from Convex on app restart
  hydrateFromConvex: (convexProfile: {
    _id: string;
    displayName: string;
    age: number;
    gender: string;
    city?: string;
    privateBio?: string;
    privateIntentKeys: string[];
    privateDesireTagKeys?: string[];
    privateBoundaries?: string[];
    privatePhotoUrls: string[];
    isSetupComplete: boolean;
    hobbies?: string[];
    isVerified?: boolean;
    // Profile details fields
    height?: number | null;
    weight?: number | null;
    smoking?: string | null;
    drinking?: string | null;
    education?: string | null;
    religion?: string | null;
    // Profile visibility
    isPrivateEnabled?: boolean;
    // Phase-2 Onboarding Step 3 prompt answers
    promptAnswers?: Phase2PromptAnswer[];
    // Phase-2 Preference Strength
    preferenceStrength?: PreferenceStrength;
    // Per-photo blur slots (9 slots, true = blurred)
    photoBlurSlots?: boolean[];
    // P0-1 FIX: Privacy settings
    hideFromDeepConnect?: boolean;
    hideAge?: boolean;
    hideDistance?: boolean;
    disableReadReceipts?: boolean;
    // P0-2 FIX: Safe Mode setting
    safeMode?: boolean;
    // P0-1 FIX: Notification settings
    notificationsEnabled?: boolean;
    notificationCategories?: {
      deepConnect?: boolean;
      privateMessages?: boolean;
      chatRooms?: boolean;
      truthOrDare?: boolean;
    };
  } | null) => void;
}

const initialWizardState = {
  currentStep: 1,
  selectedPhotoIds: [] as string[],
  selectedPhotoUrls: [] as string[],
  blurredPhotoLocalUris: [] as string[],
  blurredStorageIds: [] as string[],
  blurredPhotoUrls: [] as string[],
  intentKeys: [] as PrivateIntentKey[],
  desireTags: [] as PrivateDesireTag[],
  boundaries: [] as PrivateBoundary[],
  privateBio: '',
  consentAgreed: false,
  displayName: '',
  age: 0,
  city: '',
  gender: '',
  hobbies: [] as string[],
  isVerified: false,
  // Extended imported fields
  height: null as number | null,
  weight: null as number | null,
  smoking: null as string | null,
  drinking: null as string | null,
  kids: null as string | null,
  education: null as string | null,
  religion: null as string | null,
  maxDistanceKm: 50,
  isSetupComplete: false,
  phase2OnboardingCompleted: false, // Permanent - never reset
  convexProfileId: null as string | null,
  isPrivateEnabled: true, // Default: visible in Desire Land
  // Phase-2 setup tracking
  acceptedTermsAt: null as number | null,
  phase2SetupVersion: null as number | null,
  blurMyPhoto: true, // Default blur ON
  photoBlurSlots: [true, true, true, true, true, true, true, true, true] as boolean[], // Per-slot blur (default all blurred)
  phase1PhotoSlots: createEmptyPhotoSlots(),
  phase2PhotosConfirmed: false, // True after Step-2 photo selection
  promptAnswers: [] as Phase2PromptAnswer[], // Phase-2 Step 3 prompt answers
  preferenceStrength: { smoking: null, drinking: null, intent: null } as PreferenceStrength,
  privateEntryNavLock: false, // Navigation lock for PrivateEntryGuard
  // PHASE 1 Settings — Defaults
  defaultPhotoVisibility: 'blurred' as const,
  allowUnblurRequests: true,
  defaultSecureMediaTimer: 30 as const,
  defaultSecureMediaViewingMode: 'tap' as const,
  communicationStyle: null as 'text-first' | 'voice-friendly' | 'meet-oriented' | null,
  desirelandVisibility: 'active' as const,
  ageVisibility: 'exact' as const,
  whoCanMessageMe: 'everyone' as const,
  safeMode: false,
  // Deletion state defaults
  deletionStatus: 'active' as const,
  deletedAt: null,
  recoverUntil: null,
  // Phase-2 Privacy defaults
  hideFromDeepConnect: false,
  hideAge: false,
  hideDistance: false,
  disableReadReceipts: false,
  // Phase-2 Notifications defaults
  notificationsEnabled: true,
  notificationCategories: {} as Record<string, boolean>,
};

export const usePrivateProfileStore = create<PrivateProfileState>()((set) => ({
  // Legacy profile fields
  profile: {
    username: 'Anonymous_User',
    bio: '',
    desireCategories: [],
    blurPhoto: true,
  },
  isSetup: false,
  setProfile: (updates) =>
    set((state) => ({ profile: { ...state.profile, ...updates } })),
  markSetup: () => set({ isSetup: true }),

  // Wizard state
  ...initialWizardState,
  _hasHydrated: true,

  // Actions
  setCurrentStep: (step) => set({ currentStep: step }),
  setSelectedPhotos: (ids, urls) => set({ selectedPhotoIds: ids, selectedPhotoUrls: urls }),
  setBlurredPhotoLocalUris: (uris) => set({ blurredPhotoLocalUris: uris }),
  setBlurredStorageIds: (ids) => set({ blurredStorageIds: ids }),
  setBlurredPhotoUrls: (urls) => set({ blurredPhotoUrls: urls }),
  setIntentKeys: (keys) => set({ intentKeys: keys }),
  setDesireTags: (tags) => set({ desireTags: tags }),
  setBoundaries: (boundaries) => set({ boundaries }),
  setPrivateBio: (bio) => set({ privateBio: bio }),
  setConsentAgreed: (agreed) => set({ consentAgreed: agreed }),
  setProfileInfo: (info) => set(info),
  // Individual profile field setters
  setGender: (gender) => set({ gender }),
  setHeight: (height) => set({ height }),
  setWeight: (weight) => set({ weight }),
  setSmoking: (smoking) => set({ smoking }),
  setDrinking: (drinking) => set({ drinking }),
  setEducation: (education) => set({ education }),
  setReligion: (religion) => set({ religion }),
  setHobbies: (hobbies) => set({ hobbies }),
  setIsSetupComplete: (complete) => set({ isSetupComplete: complete }),
  setConvexProfileId: (id) => set({ convexProfileId: id }),
  resetWizard: () => set(initialWizardState),
  resetPhase2: () => set((state) => ({
    // Reset all wizard state EXCEPT permanent onboarding flag
    ...initialWizardState,
    // PRESERVE permanent flag - onboarding never shows again once completed
    phase2OnboardingCompleted: state.phase2OnboardingCompleted,
    // Reset photos confirmed flag
    phase2PhotosConfirmed: false,
    // Also reset legacy profile fields
    profile: {
      username: 'Anonymous_User',
      bio: '',
      desireCategories: [],
      blurPhoto: true,
    },
    isSetup: false,
  })),
  // DEV ONLY: Full reset including completion flag (for testing onboarding)
  resetPhase2ForTesting: () => set(() => ({
    // Reset ALL wizard state INCLUDING completion flag
    ...initialWizardState,
    // ALSO reset completion flag so onboarding shows again
    phase2OnboardingCompleted: false,
    isSetupComplete: false,
    phase2PhotosConfirmed: false,
    convexProfileId: null,
    acceptedTermsAt: null,
    phase2SetupVersion: null,
    promptAnswers: [],
    // Also reset legacy profile fields
    profile: {
      username: 'Anonymous_User',
      bio: '',
      desireCategories: [],
      blurPhoto: true,
    },
    isSetup: false,
  })),
  setHasHydrated: (hydrated) => set({ _hasHydrated: true }), // No-op

  // Phase-2 setup actions
  setAcceptedTermsAt: (timestamp) => set({ acceptedTermsAt: timestamp }),
  setBlurMyPhoto: (blur) => set({ blurMyPhoto: blur }),
  setPhotoBlurSlots: (slots) => set({ photoBlurSlots: slots }),
  togglePhotoBlurSlot: (slotIndex) => set((state) => {
    const next = [...state.photoBlurSlots];
    next[slotIndex] = !next[slotIndex];
    return { photoBlurSlots: next };
  }),
  importPhase1Data: (data) => {
    const startTime = __DEV__ ? Date.now() : 0;
    if (__DEV__) console.log('[P2 IMPORT] start');

    // GUARD: Check if we have any photos to process
    const hasPhotoSlots = data.photoSlots && data.photoSlots.some((s) => s !== null);
    const hasLegacyPhotos = data.photos && data.photos.length > 0;

    // If no photos at all, do minimal import (just basic profile info)
    if (!hasPhotoSlots && !hasLegacyPhotos) {
      if (__DEV__) {
        console.log('[P2 IMPORT] skip heavy work: no photos');
      }
      // Minimal state update - no photo processing
      // PHASE-2 IDENTITY FIX: Use Phase-1 handle (nickname) as displayName
      // NEVER use Phase-1 real name (data.name) for displayName
      set({
        displayName: data.handle || '',
        gender: data.gender || '',
        phase1PhotoSlots: createEmptyPhotoSlots(),
      });
      if (__DEV__) {
        console.log(`[P2 IMPORT] end (duration=${Date.now() - startTime}ms, minimal)`);
      }
      return;
    }

    // Calculate age from DOB using local parsing (not UTC)
    let age = 0;
    if (data.dateOfBirth) {
      const dob = parseDOBString(data.dateOfBirth);
      const today = new Date();
      age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
    }

    // Convert maxDistance from miles to km (Phase-1 stores in miles)
    const maxDistanceKm = data.maxDistance ? Math.round(data.maxDistance * 1.60934) : 50;

    // SLOT-PRESERVING: Use photoSlots if available, otherwise convert from legacy photos array
    let photoSlots: PhotoSlots9;
    if (data.photoSlots) {
      // Use the slot-based array directly
      photoSlots = data.photoSlots;
    } else {
      // Legacy: convert photos array to slots (loses slot info, places in order)
      photoSlots = createEmptyPhotoSlots();
      data.photos.forEach((p, idx) => {
        if (idx < 9 && p.url) {
          photoSlots[idx] = p.url;
        }
      });
    }

    // DEBUG: Log what we're storing
    if (__DEV__) {
      const nonNullIndices = photoSlots
        .map((uri, idx) => (uri ? idx : -1))
        .filter((idx) => idx >= 0);
      console.log('[privateProfileStore] importPhase1Data:', {
        photoSlotsProvided: !!data.photoSlots,
        nonNullSlots: nonNullIndices,
        firstUri: photoSlots.find(Boolean)?.slice(-40) || 'none',
      });
    }

    set({
      // Store Phase-1 photo slots (9 slots, preserving positions)
      phase1PhotoSlots: photoSlots,
      // PHASE-2 IDENTITY FIX: Use Phase-1 handle (nickname) as displayName
      // NEVER use Phase-1 real name (data.name) for displayName
      displayName: data.handle || '',
      age,
      city: data.city || '',
      gender: data.gender || '',
      // Import hobbies from activities
      hobbies: data.activities || [],
      // Import verification status
      isVerified: data.isVerified || false,
      // Extended fields for info preview
      height: data.height ?? null,
      weight: data.weight ?? null,
      smoking: data.smoking ?? null,
      drinking: data.drinking ?? null,
      kids: data.kids ?? null,
      education: data.education ?? null,
      religion: data.religion ?? null,
      maxDistanceKm,
    });

    if (__DEV__) {
      console.log(`[P2 IMPORT] end (duration=${Date.now() - startTime}ms)`);
    }
  },
  completeSetup: () => set({
    isSetupComplete: true,
    phase2OnboardingCompleted: true, // Permanent flag - never shows onboarding again
    phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
  }),
  setPhase2PhotosConfirmed: (confirmed) => set({ phase2PhotosConfirmed: confirmed }),
  setPrivateEntryNavLock: (locked) => set({ privateEntryNavLock: locked }),

  // Phase-2 Onboarding Step 3: Prompt answer actions
  setPromptAnswer: (promptId, question, answer) => set((state) => {
    // Replace existing answer for this promptId, or add new
    const existing = state.promptAnswers.findIndex((a) => a.promptId === promptId);
    if (existing >= 0) {
      const updated = [...state.promptAnswers];
      updated[existing] = { promptId, question, answer };
      return { promptAnswers: updated };
    }
    return { promptAnswers: [...state.promptAnswers, { promptId, question, answer }] };
  }),
  setPromptAnswers: (answers) => set({ promptAnswers: answers }),
  removePromptAnswer: (promptId) => set((state) => ({
    promptAnswers: state.promptAnswers.filter((a) => a.promptId !== promptId),
  })),

  // Phase-2 Preference Strength action
  setPreferenceStrength: (field, value) => set((state) => ({
    preferenceStrength: { ...state.preferenceStrength, [field]: value },
  })),

  // PHASE 1 Settings Actions — Implementations
  setDefaultPhotoVisibility: (visibility) => set({ defaultPhotoVisibility: visibility }),
  setAllowUnblurRequests: (allow) => set({ allowUnblurRequests: allow }),
  setDefaultSecureMediaTimer: (timer) => set({ defaultSecureMediaTimer: timer }),
  setDefaultSecureMediaViewingMode: (mode) => set({ defaultSecureMediaViewingMode: mode }),
  setCommunicationStyle: (style) => set({ communicationStyle: style }),
  setDesirelandVisibility: (visibility) => set({ desirelandVisibility: visibility }),
  setAgeVisibility: (visibility) => set({ ageVisibility: visibility }),
  setWhoCanMessageMe: (who) => set({ whoCanMessageMe: who }),
  setSafeMode: (enabled) => set({ safeMode: enabled }),

  // Profile Visibility (Pause Profile)
  setIsPrivateEnabled: (enabled) => set({ isPrivateEnabled: enabled }),

  // Deletion actions
  initiatePrivateDataDeletion: () => {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    set({
      deletionStatus: 'pending_deletion',
      deletedAt: now,
      recoverUntil: now + thirtyDaysMs,
    });
  },
  recoverPrivateData: () => set({
    deletionStatus: 'active',
    deletedAt: null,
    recoverUntil: null,
  }),

  // Phase-2 Privacy Actions
  setHideFromDeepConnect: (value) => set({ hideFromDeepConnect: value }),
  setHideAge: (value) => set({ hideAge: value }),
  setHideDistance: (value) => set({ hideDistance: value }),
  setDisableReadReceipts: (value) => set({ disableReadReceipts: value }),

  // Phase-2 Notifications Actions
  setNotificationsEnabled: (value) => set({ notificationsEnabled: value }),
  setNotificationCategory: (key, value) => set((state) => ({
    notificationCategories: { ...state.notificationCategories, [key]: value },
  })),

  // ST-001 FIX: Hydrate store from Convex profile on app restart
  // This ensures Phase-2 profile state survives app restarts
  hydrateFromConvex: (convexProfile) => {
    if (!convexProfile) {
      // No profile exists - keep default state, onboarding will show
      return;
    }

    if (__DEV__) {
      console.log('[privateProfileStore] hydrateFromConvex:', {
        profileId: convexProfile._id,
        displayName: convexProfile.displayName,
        isSetupComplete: convexProfile.isSetupComplete,
        convexPhotoCount: convexProfile.privatePhotoUrls?.length || 0,
        height: convexProfile.height,
        weight: convexProfile.weight,
      });
    }

    // Hydrate store with Convex profile data
    // ALWAYS hydrate from Convex - this is the source of truth after restart
    set({
      // Profile info
      displayName: convexProfile.displayName || '',
      age: convexProfile.age || 0,
      gender: convexProfile.gender || '',
      city: convexProfile.city || '',
      privateBio: convexProfile.privateBio || '',

      // Categories (cast to expected types - Convex stores as string[])
      intentKeys: (convexProfile.privateIntentKeys || []) as any,
      desireTags: (convexProfile.privateDesireTagKeys || []) as any,
      boundaries: (convexProfile.privateBoundaries || []) as any,

      // HYDRATION FIX: Always set photos from Convex after restart
      // This is the source of truth - don't preserve stale local state
      selectedPhotoUrls: convexProfile.privatePhotoUrls || [],

      // Profile details - hydrate from Convex
      height: convexProfile.height ?? null,
      weight: convexProfile.weight ?? null,
      smoking: convexProfile.smoking ?? null,
      drinking: convexProfile.drinking ?? null,
      education: convexProfile.education ?? null,
      religion: convexProfile.religion ?? null,

      // Imported fields
      hobbies: convexProfile.hobbies || [],
      isVerified: convexProfile.isVerified || false,

      // Completion flags
      isSetupComplete: convexProfile.isSetupComplete,
      phase2OnboardingCompleted: convexProfile.isSetupComplete, // If profile exists & setup complete, onboarding is done
      convexProfileId: convexProfile._id,

      // Profile visibility (Pause Profile)
      isPrivateEnabled: convexProfile.isPrivateEnabled ?? true, // Default to visible if undefined

      // Phase-2 Onboarding Step 3 prompt answers
      promptAnswers: convexProfile.promptAnswers || [],

      // Phase-2 Preference Strength
      preferenceStrength: convexProfile.preferenceStrength || { smoking: null, drinking: null, intent: null },

      // Per-photo blur slots (9 slots, true = blurred)
      // Hydrate from backend or keep default (all blurred for privacy)
      photoBlurSlots: convexProfile.photoBlurSlots || [true, true, true, true, true, true, true, true, true],

      // P0-1 FIX: Privacy settings (hydrate from backend)
      hideFromDeepConnect: convexProfile.hideFromDeepConnect ?? false,
      hideAge: convexProfile.hideAge ?? false,
      hideDistance: convexProfile.hideDistance ?? false,
      disableReadReceipts: convexProfile.disableReadReceipts ?? false,

      // P0-2 FIX: Safe Mode setting (hydrate from backend)
      safeMode: convexProfile.safeMode ?? false,

      // P0-1 FIX: Notification settings (hydrate from backend)
      notificationsEnabled: convexProfile.notificationsEnabled ?? true,
      notificationCategories: convexProfile.notificationCategories
        ? {
            deepConnect: convexProfile.notificationCategories.deepConnect ?? true,
            privateMessages: convexProfile.notificationCategories.privateMessages ?? true,
            chatRooms: convexProfile.notificationCategories.chatRooms ?? true,
            truthOrDare: convexProfile.notificationCategories.truthOrDare ?? true,
          }
        : {},

      // Mark as hydrated
      _hasHydrated: true,
    });

    if (__DEV__) {
      console.log('[privateProfileStore] hydrateFromConvex complete:', {
        photoCount: convexProfile.privatePhotoUrls?.length || 0,
        promptAnswerCount: convexProfile.promptAnswers?.length || 0,
        hasPreferenceStrength: !!convexProfile.preferenceStrength,
        // P0-1/P0-2: Log settings hydration
        hideFromDeepConnect: convexProfile.hideFromDeepConnect,
        safeMode: convexProfile.safeMode,
        notificationsEnabled: convexProfile.notificationsEnabled,
      });
    }
  },
}));

// Helper to validate photo URLs
function isValidPhotoUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.length > 0 &&
    url !== 'undefined' &&
    url !== 'null' &&
    (url.startsWith('http') || url.startsWith('file://'))
  );
}

// Phase-2 onboarding validation constants
export const PHASE2_MIN_PHOTOS = 2;
export const PHASE2_MIN_INTENTS = 1;
export const PHASE2_MAX_INTENTS = 3;
export const PHASE2_DESIRE_MIN_LENGTH = 30;
export const PHASE2_DESIRE_MAX_LENGTH = 300;

// Selector: Check if Phase-2 setup is complete and valid
export const selectIsSetupValid = (state: PrivateProfileState): boolean => {
  // Must be hydrated first
  if (!state._hasHydrated) return false;

  // Must have completed setup
  if (!state.isSetupComplete) return false;

  // Version must match current
  if (state.phase2SetupVersion !== CURRENT_PHASE2_SETUP_VERSION) return false;

  // Must have accepted terms
  if (state.acceptedTermsAt === null) return false;

  // Must have at least 2 valid photos
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  if (validPhotos.length < PHASE2_MIN_PHOTOS) return false;

  // Must have 1-3 intent categories
  if (state.intentKeys.length < PHASE2_MIN_INTENTS || state.intentKeys.length > PHASE2_MAX_INTENTS) return false;

  // Desire (bio) must be at least 30 characters
  if (state.privateBio.trim().length < PHASE2_DESIRE_MIN_LENGTH) return false;

  return true;
};

// Selector: Check if photos step is valid (min 2 selected)
export const selectCanContinuePhotos = (state: PrivateProfileState): boolean => {
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  return validPhotos.length >= PHASE2_MIN_PHOTOS;
};

// Selector: Check if intents are valid (1-3 selected)
export const selectCanContinueIntents = (state: PrivateProfileState): boolean => {
  return (
    state.intentKeys.length >= PHASE2_MIN_INTENTS &&
    state.intentKeys.length <= PHASE2_MAX_INTENTS
  );
};

// Selector: Check if desire (bio) is valid (30-300 chars)
export const selectCanContinueDesire = (state: PrivateProfileState): boolean => {
  const length = state.privateBio.trim().length;
  return length >= PHASE2_DESIRE_MIN_LENGTH && length <= PHASE2_DESIRE_MAX_LENGTH;
};

// Legacy selector: Check if categories step is valid (kept for backward compatibility)
export const selectCanContinueCategories = (state: PrivateProfileState): boolean => {
  return (
    state.intentKeys.length >= PHASE2_MIN_INTENTS &&
    state.intentKeys.length <= PHASE2_MAX_INTENTS &&
    state.privateBio.trim().length >= PHASE2_DESIRE_MIN_LENGTH
  );
};

// Selector: Check if profile details are complete (mandatory fields)
export const selectIsProfileDetailsComplete = (state: PrivateProfileState): boolean => {
  return (
    !!state.gender &&
    state.height !== null && state.height > 0 &&
    !!state.smoking &&
    !!state.drinking &&
    !!state.education &&
    !!state.religion
  );
};

// Selector: Get list of missing mandatory fields
export const selectMissingProfileFields = (state: PrivateProfileState): string[] => {
  const missing: string[] = [];
  if (!state.gender) missing.push('Gender');
  if (state.height === null || state.height <= 0) missing.push('Height');
  if (!state.smoking) missing.push('Smoking');
  if (!state.drinking) missing.push('Drinking');
  if (!state.education) missing.push('Education');
  if (!state.religion) missing.push('Religion');
  return missing;
};

// Selector: Check if entire Phase-2 profile is complete (photos + intents + desire + profile details)
export const selectIsPhase2ProfileComplete = (state: PrivateProfileState): boolean => {
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  const hasEnoughPhotos = validPhotos.length >= PHASE2_MIN_PHOTOS;
  const hasValidIntents = state.intentKeys.length >= PHASE2_MIN_INTENTS && state.intentKeys.length <= PHASE2_MAX_INTENTS;
  const hasValidDesire = state.privateBio.trim().length >= PHASE2_DESIRE_MIN_LENGTH && state.privateBio.trim().length <= PHASE2_DESIRE_MAX_LENGTH;
  const hasProfileDetails = selectIsProfileDetailsComplete(state);

  return hasEnoughPhotos && hasValidIntents && hasValidDesire && hasProfileDetails;
};

// Selector: Get all missing items for Phase-2 completion
export const selectAllMissingItems = (state: PrivateProfileState): string[] => {
  const missing: string[] = [];

  // Photos
  const validPhotos = state.selectedPhotoUrls.filter(isValidPhotoUrl);
  if (validPhotos.length < PHASE2_MIN_PHOTOS) {
    missing.push(`${PHASE2_MIN_PHOTOS - validPhotos.length} more photo${PHASE2_MIN_PHOTOS - validPhotos.length > 1 ? 's' : ''}`);
  }

  // Intents
  if (state.intentKeys.length < PHASE2_MIN_INTENTS) {
    missing.push('Looking For selection');
  }

  // Desire
  if (state.privateBio.trim().length < PHASE2_DESIRE_MIN_LENGTH) {
    missing.push('Desire text');
  }

  // Profile details
  const missingFields = selectMissingProfileFields(state);
  missing.push(...missingFields);

  return missing;
};
