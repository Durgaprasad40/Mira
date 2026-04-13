/**
 * STORAGE POLICY: Convex is the only source of truth for active Phase-2
 * profile and onboarding state. AsyncStorage is retained only to clear
 * legacy saved onboarding progress from older builds.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PrivateIntentKey, PrivateDesireTag, PrivateBoundary, DesireCategory, PhotoSlots9 } from '@/types';
import { createEmptyPhotoSlots } from '@/types';
import type { Phase2PromptAnswer, PreferenceStrength, PreferenceStrengthValue, IntentMatchValue } from '@/lib/privateConstants';

// P0-002 FIX: AsyncStorage key for onboarding wizard progress
const ONBOARDING_PROGRESS_KEY = 'phase2_onboarding_progress';

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

  // Phase-2 Onboarding Step 4: Prompt answers
  promptAnswers: Phase2PromptAnswer[]; // Answered prompts from Step 4

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
  setPrivateEntryNavLock: (locked: boolean) => void;

  // Phase-2 Onboarding Step 4: Prompt answer actions
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

  clearOnboardingProgress: () => Promise<void>;

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
    // Phase-2 Onboarding Step 4 prompt answers
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
  selectedPhotoIds: [] as string[],
  selectedPhotoUrls: [] as string[],
  blurredPhotoLocalUris: [] as string[],
  blurredStorageIds: [] as string[],
  blurredPhotoUrls: [] as string[],
  intentKeys: [] as PrivateIntentKey[],
  desireTags: [] as PrivateDesireTag[],
  boundaries: [] as PrivateBoundary[],
  privateBio: '',
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
  promptAnswers: [] as Phase2PromptAnswer[], // Phase-2 Step 4 prompt answers
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
  _hasHydrated: false,

  // Actions
  setSelectedPhotos: (ids, urls) => set({ selectedPhotoIds: ids, selectedPhotoUrls: urls }),
  setBlurredPhotoLocalUris: (uris) => set({ blurredPhotoLocalUris: uris }),
  setBlurredStorageIds: (ids) => set({ blurredStorageIds: ids }),
  setBlurredPhotoUrls: (urls) => set({ blurredPhotoUrls: urls }),
  setIntentKeys: (keys) => set({ intentKeys: keys }),
  setDesireTags: (tags) => set({ desireTags: tags }),
  setBoundaries: (boundaries) => set({ boundaries }),
  setPrivateBio: (bio) => set({ privateBio: bio }),
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
  resetPhase2: () => set((state) => ({
    // Reset all wizard state EXCEPT permanent onboarding flag
    ...initialWizardState,
    // PRESERVE permanent flag - onboarding never shows again once completed
    phase2OnboardingCompleted: state.phase2OnboardingCompleted,
    // Also reset legacy profile fields
    profile: {
      username: 'Anonymous_User',
      bio: '',
      desireCategories: [],
      blurPhoto: true,
    },
    isSetup: false,
    _hasHydrated: false,
  })),
  // DEV ONLY: Full reset including completion flag (for testing onboarding)
  resetPhase2ForTesting: () => set(() => ({
    // Reset ALL wizard state INCLUDING completion flag
    ...initialWizardState,
    // ALSO reset completion flag so onboarding shows again
    phase2OnboardingCompleted: false,
    isSetupComplete: false,
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
    _hasHydrated: false,
  })),
  setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

  // Phase-2 setup actions
  setAcceptedTermsAt: (timestamp) => set({ acceptedTermsAt: timestamp }),
  setBlurMyPhoto: (blur) => set((state) => {
    if (!blur) {
      return {
        blurMyPhoto: false,
        photoBlurSlots: Array.from({ length: 9 }, () => false),
      };
    }

    const nextSlots = state.photoBlurSlots.some(Boolean)
      ? state.photoBlurSlots
      : Array.from({ length: 9 }, () => true);

    return {
      blurMyPhoto: nextSlots.some(Boolean),
      photoBlurSlots: nextSlots,
    };
  }),
  setPhotoBlurSlots: (slots) => {
    const normalizedSlots = Array.from({ length: 9 }, (_, index) => slots[index] ?? false);
    set({
      photoBlurSlots: normalizedSlots,
      blurMyPhoto: normalizedSlots.some(Boolean),
    });
  },
  togglePhotoBlurSlot: (slotIndex) => set((state) => {
    const next = [...state.photoBlurSlots];
    next[slotIndex] = !next[slotIndex];
    return {
      photoBlurSlots: next,
      blurMyPhoto: next.some(Boolean),
    };
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
        _hasHydrated: true,
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
      _hasHydrated: true,
    });

    if (__DEV__) {
      console.log(`[P2 IMPORT] end (duration=${Date.now() - startTime}ms)`);
    }
  },
  completeSetup: () => {
    if (__DEV__) {
      console.log('[P2_STEP5] completeSetup() called - setting phase2OnboardingCompleted=true');
    }
    set({
      isSetupComplete: true,
      phase2OnboardingCompleted: true, // Permanent flag - never shows onboarding again
      phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
      _hasHydrated: true,
    });
    if (__DEV__) {
      // Verify the store actually updated
      const newState = usePrivateProfileStore.getState();
      console.log('[P2_STEP5] completeSetup() done - verifying store', {
        phase2OnboardingCompleted: newState.phase2OnboardingCompleted,
        isSetupComplete: newState.isSetupComplete,
      });
    }
    // P0-002 FIX: Clear saved onboarding progress when setup completes
    usePrivateProfileStore.getState().clearOnboardingProgress();
  },
  setPrivateEntryNavLock: (locked) => set({ privateEntryNavLock: locked }),

  // Phase-2 Onboarding Step 4: Prompt answer actions
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

  // P0-002 FIX: Clear saved onboarding progress (called when setup completes)
  clearOnboardingProgress: async () => {
    try {
      await AsyncStorage.removeItem(ONBOARDING_PROGRESS_KEY);
      if (__DEV__) {
        console.log('[P2 ONBOARDING] Progress cleared');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[P2 ONBOARDING] Failed to clear progress:', error);
      }
    }
  },

  // ST-001 FIX: Hydrate store from Convex profile on app restart
  // This ensures Phase-2 profile state survives app restarts
  hydrateFromConvex: (convexProfile) => {
    // CRITICAL: phase2OnboardingCompleted is a PERMANENT flag - once true, NEVER reset it
    // This prevents the bug where navigating to private area after finalize
    // would reset the flag and bounce users back to onboarding
    const currentState = usePrivateProfileStore.getState();
    const preserveOnboardingComplete = currentState.phase2OnboardingCompleted === true;

    if (__DEV__ && preserveOnboardingComplete) {
      console.log('[P2_HYDRATE] preserving phase2OnboardingCompleted=true (permanent flag)');
    }

    if (!convexProfile) {
      set({
        displayName: '',
        age: 0,
        city: '',
        gender: '',
        selectedPhotoIds: [],
        selectedPhotoUrls: [],
        blurredPhotoLocalUris: [],
        blurredStorageIds: [],
        blurredPhotoUrls: [],
        intentKeys: [],
        desireTags: [],
        boundaries: [],
        privateBio: '',
        hobbies: [],
        isVerified: false,
        height: null,
        weight: null,
        smoking: null,
        drinking: null,
        education: null,
        religion: null,
        acceptedTermsAt: null,
        // CRITICAL FIX: Preserve these flags if already true
        isSetupComplete: preserveOnboardingComplete ? true : false,
        phase2OnboardingCompleted: preserveOnboardingComplete ? true : false,
        phase2SetupVersion: preserveOnboardingComplete ? currentState.phase2SetupVersion : null,
        convexProfileId: null,
        isPrivateEnabled: true,
        blurMyPhoto: true,
        promptAnswers: [],
        preferenceStrength: { smoking: null, drinking: null, intent: null },
        photoBlurSlots: [true, true, true, true, true, true, true, true, true],
        phase1PhotoSlots: createEmptyPhotoSlots(),
        hideFromDeepConnect: false,
        hideAge: false,
        hideDistance: false,
        disableReadReceipts: false,
        safeMode: false,
        notificationsEnabled: true,
        notificationCategories: {},
        _hasHydrated: true,
      });
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

    const notificationCategories: Record<string, boolean> = {
      deepConnect: convexProfile.notificationCategories?.deepConnect ?? true,
      privateMessages: convexProfile.notificationCategories?.privateMessages ?? true,
      chatRooms: convexProfile.notificationCategories?.chatRooms ?? true,
      truthOrDare: convexProfile.notificationCategories?.truthOrDare ?? true,
    };

    // Hydrate store with Convex profile data
    // ALWAYS hydrate from Convex - this is the source of truth after restart
    set((state) => ({
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

      // Completion flags - CRITICAL: preserve if already true (permanent flag)
      isSetupComplete: preserveOnboardingComplete ? true : convexProfile.isSetupComplete,
      phase2OnboardingCompleted: preserveOnboardingComplete ? true : (convexProfile.isSetupComplete === true),
      convexProfileId: convexProfile._id,

      // Profile visibility (Pause Profile)
      isPrivateEnabled: convexProfile.isPrivateEnabled ?? true, // Default to visible if undefined

      // Phase-2 Onboarding Step 4 prompt answers
      promptAnswers: convexProfile.promptAnswers || [],

      // Phase-2 Preference Strength
      preferenceStrength: convexProfile.preferenceStrength || { smoking: null, drinking: null, intent: null },

      // Per-photo blur slots (9 slots, true = blurred)
      // Hydrate from backend or keep default (all blurred for privacy)
      blurMyPhoto: convexProfile.photoBlurSlots
        ? convexProfile.photoBlurSlots.some(Boolean)
        : true,
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
      notificationCategories,

      // Mark as hydrated
      _hasHydrated: true,
    }));

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

// Phase-2 onboarding validation constants
export const PHASE2_MIN_PHOTOS = 2;
export const PHASE2_MIN_INTENTS = 1;
export const PHASE2_MAX_INTENTS = 3;
export const PHASE2_DESIRE_MIN_LENGTH = 20;
export const PHASE2_DESIRE_MAX_LENGTH = 300;
