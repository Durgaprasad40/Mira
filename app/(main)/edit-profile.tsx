/**
 * Edit Profile Screen
 *
 * REFACTORED: UI sections extracted to components/profile/edit/
 * State management, handlers, and API calls remain here.
 *
 * NO LOGIC CHANGES - Structure refactor only.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import {
  COLORS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  KIDS_OPTIONS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
  EXERCISE_OPTIONS,
  PETS_OPTIONS,
  INSECT_OPTIONS,
  BUILDER_PROMPTS,
  PERFORMER_PROMPTS,
  SEEKER_PROMPTS,
  GROUNDED_PROMPTS,
  PROMPT_ANSWER_MIN_LENGTH,
  TOTAL_SECTIONS,
  SOCIAL_RHYTHM_OPTIONS,
  SLEEP_SCHEDULE_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  WORK_STYLE_OPTIONS,
  CORE_VALUES_OPTIONS,
  SocialRhythmValue,
  SleepScheduleValue,
  TravelStyleValue,
  WorkStyleValue,
  CoreValueValue,
} from '@/lib/constants';
import type { ActivityFilter } from '@/types';

// Section-based prompt types
type SectionKey = 'builder' | 'performer' | 'seeker' | 'grounded';
type SectionPromptEntry = { section: SectionKey; question: string; answer: string };

// Section configuration for prompts with display labels (Section 1-4)
const PROMPT_SECTIONS: { key: SectionKey; label: string; questions: { id: string; text: string }[] }[] = [
  { key: 'builder', label: 'Section 1', questions: BUILDER_PROMPTS },
  { key: 'performer', label: 'Section 2', questions: PERFORMER_PROMPTS },
  { key: 'seeker', label: 'Section 3', questions: SEEKER_PROMPTS },
  { key: 'grounded', label: 'Section 4', questions: GROUNDED_PROMPTS },
];

import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { BlurProfileNotice } from '@/components/profile/BlurProfileNotice';
import { isDemoMode } from '@/hooks/useConvex';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useDemoStore, slotsToPhotos } from '@/stores/demoStore';
import { PhotoSlots9, createEmptyPhotoSlots } from '@/types';
import { uploadPhotoToBackend } from '@/services/photoSync';
import { Id } from '@/convex/_generated/dataModel';

// Extracted components
import {
  PhotoGridEditor,
  BasicInfoSection,
  AboutSection,
  PromptsSection,
  DetailsSection,
  DETAILS_VALIDATION,
  LifestyleSection,
  LifeRhythmSection,
  EducationReligionSection,
  InterestsSection,
} from '@/components/profile/edit';

const GRID_SIZE = 9;
const MIN_PROFILE_PHOTOS = 2;

function isValidPhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && url !== 'undefined' && url !== 'null';
}

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId, token } = useAuthStore();
  const params = useLocalSearchParams<{ scrollTo?: string }>();

  // PROFILE COMPLETION: Scroll to section support
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionRefs = useRef<Record<string, number>>({});

  // FIX 1: Track initialization to prevent infinite loop
  const hasInitializedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  // MIGRATION: Track if sectionPrompts → profilePrompts migration has been attempted
  const hasMigratedPromptsRef = useRef(false);

  // SURGICAL FIX: Hydration + dirty guards to prevent accidental data wipe
  // These refs track whether data has been loaded from backend and whether user edited it
  const interestsHydratedRef = useRef(false);  // true once interests loaded from Convex
  const interestsDirtyRef = useRef(false);      // true if user explicitly changed interests
  const promptsHydratedRef = useRef(false);     // true once prompts loaded from Convex
  const promptsDirtyRef = useRef(false);        // true if user explicitly changed prompts

  // PERF: Track photo grid load time
  const gridRenderTimeRef = useRef(0);
  const loadedPhotosRef = useRef<Set<number>>(new Set());
  const hasLoggedGridLoad = useRef(false);

  // FIX: Use getCurrentUser with userId instead of getCurrentUserFromToken with token
  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;

  // Query backend photos to get photo IDs for replacement logic (live mode only)
  // FIX: Use getUserPhotos with userId instead of getCurrentUserPhotos with token
  const backendPhotos = useQuery(
    api.photos.getUserPhotos,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isDemoMode) return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  // PROFILE COMPLETION: Scroll to section when navigating from completion card
  useEffect(() => {
    if (params.scrollTo && sectionRefs.current[params.scrollTo] !== undefined) {
      // Delay to ensure layout is complete
      const timer = setTimeout(() => {
        const yOffset = sectionRefs.current[params.scrollTo!] || 0;
        scrollViewRef.current?.scrollTo({ y: yOffset - 20, animated: true });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [params.scrollTo]);

  // PROFILE COMPLETION: Helper to register section positions
  const registerSectionPosition = useCallback((section: string, y: number) => {
    sectionRefs.current[section] = y;
  }, []);

  const updateProfile = useMutation(api.users.updateProfile);
  const updateProfilePrompts = useMutation(api.users.updateProfilePrompts);
  // FIX: Use upsertOnboardingDraft instead of upsertCurrentUserOnboardingDraft
  const upsertOnboardingDraft = useMutation(api.users.upsertOnboardingDraft);
  // FIX: Use reorderPhotos instead of reorderPhotosWithToken
  const reorderPhotosMutation = useMutation(api.photos.reorderPhotos);
  const deletePhotoMutation = useMutation(api.photos.deletePhoto);
  // FIX: Use togglePhotoBlur from users instead of setPhotosBlur from photos
  const togglePhotoBlurMutation = isDemoMode ? null : useMutation(api.users.togglePhotoBlur);

  // Subscribe to currentDemoUserId to prevent stale closures on account switch
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);

  // LOCAL blur state - temporary UI state during editing
  // Backend photos.isBlurred is source of truth, persisted on Save
  const [blurEnabled, setBlurEnabled] = useState(false);
  const [blurredPhotos, setBlurredPhotos] = useState<Record<number, boolean>>({});
  // Track if blur state has been initialized from backend
  const blurInitializedRef = useRef(false);

  const [showBlurNotice, setShowBlurNotice] = useState(false);
  const [bio, setBio] = useState('');

  // Track upload state per slot: 'idle' | 'uploading' | 'uploaded' | 'error'
  const [uploadingSlots, setUploadingSlots] = useState<Set<number>>(new Set());

  // Section-based prompts: one answer per section
  const [sectionAnswers, setSectionAnswers] = useState<Record<SectionKey, SectionPromptEntry | null>>({
    builder: null,
    performer: null,
    seeker: null,
    grounded: null,
  });
  const [activePromptSection, setActivePromptSection] = useState<SectionKey | null>(null);

  // Basic Info fields (name editable, others read-only)
  // IDENTITY SIMPLIFICATION: Single name field
  const [displayNameField, setDisplayNameField] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  // P2 VALIDATION: Height/weight error states
  const [heightError, setHeightError] = useState<string | undefined>(undefined);
  const [weightError, setWeightError] = useState<string | undefined>(undefined);
  const [smoking, setSmoking] = useState<string | null>(null);
  const [drinking, setDrinking] = useState<string | null>(null);
  const [kids, setKids] = useState<string | null>(null);
  const [education, setEducation] = useState<string | null>(null);
  const [religion, setReligion] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [school, setSchool] = useState('');
  const [exercise, setExercise] = useState<string | null>(null);
  const [pets, setPets] = useState<string[]>([]);
  const [insect, setInsect] = useState<string | null>(null);

  // Life Rhythm state (from onboardingDraft)
  const [lifeRhythmCity, setLifeRhythmCity] = useState<string>('');
  const [socialRhythm, setSocialRhythm] = useState<SocialRhythmValue | null>(null);
  const [sleepSchedule, setSleepSchedule] = useState<SleepScheduleValue | null>(null);
  const [travelStyle, setTravelStyle] = useState<TravelStyleValue | null>(null);
  const [workStyle, setWorkStyle] = useState<WorkStyleValue | null>(null);
  const [coreValues, setCoreValues] = useState<CoreValueValue[]>([]);

  // Review-style UI: Track which section is expanded for inline editing
  type ExpandableSection = 'prompts' | 'basicInfo' | 'lifestyle' | 'lifeRhythm' | 'educationReligion' | 'interests' | null;
  const [expandedSection, setExpandedSection] = useState<ExpandableSection>(null);

  // Interests/Activities state (max 5)
  const [activities, setActivities] = useState<ActivityFilter[]>([]);

  // Helper: Get label from options array by value
  const getOptionLabel = useCallback((
    options: { value: string; label: string }[],
    value: string | null
  ): string => {
    if (!value) return '—';
    const option = options.find((o) => o.value === value);
    return option?.label || value;
  }, []);

  // Helper: Toggle section expansion
  const toggleSection = useCallback((section: ExpandableSection) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  }, []);

  // Helper: Toggle pet selection (max 3)
  const togglePet = useCallback((pet: string) => {
    setPets((prev) => {
      if (prev.includes(pet)) {
        return prev.filter((p) => p !== pet);
      }
      if (prev.length >= 3) {
        Alert.alert('Limit Reached', 'You can select up to 3 pets only.');
        return prev;
      }
      return [...prev, pet];
    });
  }, []);

  // Helper: Toggle core value selection (max 3)
  const toggleCoreValue = useCallback((value: CoreValueValue) => {
    setCoreValues((prev) => {
      if (prev.includes(value)) {
        return prev.filter((v) => v !== value);
      }
      if (prev.length >= 3) {
        Alert.alert('Limit Reached', 'You can select up to 3 core values.');
        return prev;
      }
      return [...prev, value];
    });
  }, []);

  // Helper: Toggle activity/interest selection (max 5)
  const toggleActivity = useCallback((activity: ActivityFilter) => {
    // SURGICAL FIX: Mark interests as dirty when user explicitly changes them
    interestsDirtyRef.current = true;
    setActivities((prev) => {
      if (prev.includes(activity)) {
        return prev.filter((a) => a !== activity);
      }
      if (prev.length >= 5) {
        Alert.alert('Limit Reached', 'You can select up to 5 interests.');
        return prev;
      }
      return [...prev, activity];
    });
  }, []);

  // Photo state for 9-slot grid (SLOT-BASED: index = slot number)
  const [photoSlots, setPhotoSlots] = useState<PhotoSlots9>(createEmptyPhotoSlots());
  const [failedSlots, setFailedSlots] = useState<Set<number>>(new Set());
  // Photo preview modal state - stores both url and index for actions
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; index: number } | null>(null);

  // Profile error state - blocks rendering if profile identity is broken
  const [profileError, setProfileError] = useState<string | null>(null);

  // FIX 1: Initialize state ONCE per user using refs to prevent infinite loop
  // P1-004 FIX: Require currentUserId to be truthy to prevent race when ID is briefly null
  useEffect(() => {
    const currentUserId = currentUser?._id || currentUser?.id || null;
    if (currentUser && currentUserId && (!hasInitializedRef.current || lastUserIdRef.current !== currentUserId)) {
      hasInitializedRef.current = true;
      lastUserIdRef.current = currentUserId;
      setTimedOut(false);

      setBio(currentUser.bio || '');

      // Load prompts into section-based format
      const existingPrompts = (currentUser as any)?.profilePrompts ?? [];

      if (__DEV__) {
        console.log('[PROFILE_PROMPTS_HYDRATE] Raw existingPrompts from backend:', existingPrompts.length);
        existingPrompts.forEach((p: any, i: number) => {
          console.log(`[PROFILE_PROMPTS_HYDRATE] Raw[${i}]:`, {
            section: p.section ?? 'NONE',
            question: p.question?.substring(0, 40) + '...',
            answerLen: p.answer?.length ?? 0,
          });
        });
      }

      const newSectionAnswers: Record<SectionKey, SectionPromptEntry | null> = {
        builder: null,
        performer: null,
        seeker: null,
        grounded: null,
      };

      // Reconstruct section answers from existing prompts by matching question text
      existingPrompts.forEach((prompt: { question: string; answer: string; section?: SectionKey }, idx: number) => {
        // If prompt has section field, use it directly
        if (prompt.section && PROMPT_SECTIONS.find(s => s.key === prompt.section)) {
          if (__DEV__) console.log(`[PROFILE_PROMPTS_HYDRATE] Prompt[${idx}] matched by SECTION field:`, prompt.section);
          newSectionAnswers[prompt.section] = {
            section: prompt.section,
            question: prompt.question,
            answer: prompt.answer,
          };
          return;
        }

        // Otherwise, find the section by matching question text
        let matched = false;
        for (const section of PROMPT_SECTIONS) {
          const matchingQuestion = section.questions.find(q => q.text === prompt.question);
          if (matchingQuestion && !newSectionAnswers[section.key]) {
            if (__DEV__) console.log(`[PROFILE_PROMPTS_HYDRATE] Prompt[${idx}] matched by QUESTION TEXT to section:`, section.key);
            newSectionAnswers[section.key] = {
              section: section.key,
              question: prompt.question,
              answer: prompt.answer,
            };
            matched = true;
            break;
          }
        }
        if (!matched && __DEV__) {
          console.log(`[PROFILE_PROMPTS_HYDRATE] Prompt[${idx}] UNMATCHED! Question:`, prompt.question);
        }
      });

      setSectionAnswers(newSectionAnswers);
      // SURGICAL FIX: Mark prompts as hydrated from backend
      promptsHydratedRef.current = true;
      promptsDirtyRef.current = false; // Reset dirty flag on hydration

      if (__DEV__) {
        const filledCount = Object.values(newSectionAnswers).filter(Boolean).length;
        console.log('[PROFILE_PROMPTS_HYDRATE] Result: filledSections =', filledCount, '/', TOTAL_SECTIONS);
        Object.entries(newSectionAnswers).forEach(([key, val]) => {
          console.log(`[PROFILE_PROMPTS_HYDRATE] Section[${key}]:`, val ? 'FILLED' : 'EMPTY');
        });
      }

      setHeight(currentUser.height?.toString() || '');
      setWeight(currentUser.weight?.toString() || '');
      setSmoking(currentUser.smoking || null);
      setDrinking(currentUser.drinking || null);
      setKids(currentUser.kids || null);
      setEducation(currentUser.education || null);
      setReligion(currentUser.religion || null);
      setJobTitle(currentUser.jobTitle || '');
      setCompany(currentUser.company || '');
      setSchool(currentUser.school || '');
      setExercise(currentUser.exercise || null);
      setPets(currentUser.pets || []);
      setInsect(currentUser.insect || null);

      // Load activities/interests from Convex backend
      const loadedActivities = currentUser.activities || [];
      setActivities(loadedActivities as ActivityFilter[]);
      // SURGICAL FIX: Mark interests as hydrated from backend
      interestsHydratedRef.current = true;
      interestsDirtyRef.current = false; // Reset dirty flag on hydration
      if (__DEV__) {
        console.log('[PROFILE_INTERESTS_LOAD] Loaded from Convex:', {
          source: 'currentUser.activities',
          count: loadedActivities.length,
          values: loadedActivities,
          query: 'api.users.getCurrentUser',
          hydrated: true,
        });
      }

      // Load Life Rhythm from onboardingDraft
      const lifeRhythm = currentUser?.onboardingDraft?.lifeRhythm;
      if (lifeRhythm) {
        setLifeRhythmCity(lifeRhythm.city || '');
        setSocialRhythm(lifeRhythm.socialRhythm || null);
        setSleepSchedule(lifeRhythm.sleepSchedule || null);
        setTravelStyle(lifeRhythm.travelStyle || null);
        setWorkStyle(lifeRhythm.workStyle || null);
        setCoreValues(lifeRhythm.coreValues || []);
        if (__DEV__) {
          console.log('[EditProfile] Loaded lifeRhythm:', lifeRhythm);
        }
      }

      // IDENTITY SIMPLIFICATION: Initialize single name field from profile
      const canonicalForNames = isDemoMode
        ? useDemoStore.getState().getCurrentProfile()
        : null;
      if (canonicalForNames?.name) {
        setDisplayNameField(canonicalForNames.name);
      } else if (currentUser.name) {
        setDisplayNameField(currentUser.name);
      }

      // SLOT-BASED: Initialize from getCurrentProfile() (SINGLE SOURCE OF TRUTH)
      let initSlots: PhotoSlots9 = createEmptyPhotoSlots();
      const canonicalProfile = isDemoMode
        ? useDemoStore.getState().getCurrentProfile()
        : null;

      // HARD ASSERTION: In demo mode, canonicalProfile MUST exist
      if (isDemoMode && !canonicalProfile) {
        console.error('[EditProfile ARTBOARD] FATAL: getCurrentProfile returned null', {
          currentDemoUserId,
          userId,
        });
        setProfileError('No profile found. Please sign in again.');
        return;
      }
      // Clear any previous error
      setProfileError(null);

      if (canonicalProfile?.photoSlots && canonicalProfile.photoSlots.some((s) => s !== null)) {
        // Use canonical slot storage from getCurrentProfile()
        initSlots = [...canonicalProfile.photoSlots] as PhotoSlots9;
      } else if (canonicalProfile?.photos && canonicalProfile.photos.length > 0) {
        // Fallback: Convert flat photos array to slots
        canonicalProfile.photos.forEach((p, idx) => {
          if (idx < 9 && p.url) initSlots[idx] = p.url;
        });
      } else if (!isDemoMode) {
        // Non-demo mode: Use currentUser photos
        const existingPhotos = currentUser.photos?.map((p: any) => p?.url || p).filter(isValidPhotoUrl) || [];
        existingPhotos.forEach((url: string, idx: number) => {
          if (idx < 9) initSlots[idx] = url;
        });
      }

      const nonNullSlots = initSlots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);

      // ARTBOARD RENDER LOG: Critical for debugging identity alignment
      if (__DEV__) {
        console.log('[EditProfile ARTBOARD]', {
          profileId: canonicalProfile?.userId ?? currentUserId,
          userId: userId,
          nonNullSlots,
          isDemoMode,
          source: isDemoMode ? 'demoStore' : 'convex',
        });

        // Warn if in demo mode
        if (isDemoMode) {
          console.warn('[EditProfile] ⚠️ DEMO MODE ACTIVE - Using demoStore (local), NOT Convex backend!');
          console.warn('[EditProfile] ⚠️ Photos uploaded to Convex will NOT be saved to demoStore.');
          console.warn('[EditProfile] ⚠️ Set EXPO_PUBLIC_DEMO_MODE=false in .env.local to use Convex.');
        }
      }

      setPhotoSlots(initSlots);
    }
  }, [currentUser?._id, currentUser?.id, currentDemoUserId]);

  // LIVE MODE: Sync photo slots AND blur state from currentUser.photos (source of truth)
  // Backend handles photo ordering based on verification status:
  // - NOT verified: reference photo is first (locked)
  // - Verified: user's chosen primary photo is first
  useEffect(() => {
    if (isDemoMode || !currentUser?.photos) return;

    // Map photos to slots in the order provided by backend
    // Backend already handles verification-aware ordering
    const slotsFromBackend: PhotoSlots9 = createEmptyPhotoSlots();
    // Initialize blur state from backend photos.isBlurred field
    const blurFromBackend: Record<number, boolean> = {};

    currentUser.photos.forEach((photo: any, index: number) => {
      if (index >= 0 && index < 9 && photo.url) {
        slotsFromBackend[index] = photo.url;
        // Read isBlurred from backend photo record
        if (photo.isBlurred === true) {
          blurFromBackend[index] = true;
        }
      }
    });

    // Only update if there's actual data (avoid clearing slots during loading)
    const hasPhotos = slotsFromBackend.some((s) => s !== null);
    if (hasPhotos) {
      if (__DEV__) {
        const filledSlots = slotsFromBackend.map((s, i) => s ? i : -1).filter(i => i >= 0);
        const firstPhoto = currentUser.photos[0];
        // PHOTO_SOURCE_AUDIT: Log photo source for debugging consistency
        console.log('[PHOTO_SOURCE_AUDIT] [EDIT_PROFILE_PHOTOS] Grid loaded:', {
          source: 'api.users.getCurrentUser',
          totalPhotos: currentUser.photos.length,
          isVerified: currentUser.isVerified,
          filledSlots,
          firstPhotoType: firstPhoto?.photoType || 'regular',
          firstPhotoId: firstPhoto?._id?.slice(-6) || null,
        });
      }
      setPhotoSlots(slotsFromBackend);

      // Initialize blur state from backend (only once to avoid overwriting user edits)
      if (!blurInitializedRef.current) {
        blurInitializedRef.current = true;
        setBlurredPhotos(blurFromBackend);
        // Set blurEnabled if any photo is blurred
        const anyBlurred = Object.values(blurFromBackend).some(v => v);
        setBlurEnabled(anyBlurred || (currentUser as any)?.photoBlurred === true);
        if (__DEV__) {
          console.log('[EditProfile] 🔒 Initialized blur state from backend:', {
            blurredPhotos: blurFromBackend,
            blurEnabled: anyBlurred,
          });
        }
      }
    }
  }, [currentUser?.photos]);

  // SLOT-BASED: Get valid photos with their slot indices
  const validPhotoEntries = useMemo(() => {
    const entries: { slotIndex: number; url: string }[] = [];
    photoSlots.forEach((url, slotIndex) => {
      if (isValidPhotoUrl(url) && !failedSlots.has(slotIndex)) {
        entries.push({ slotIndex, url });
      }
    });
    return entries;
  }, [photoSlots, failedSlots]);

  const validPhotoCount = validPhotoEntries.length;

  // PERF: Prefetch top photos after slots change
  useEffect(() => {
    if (validPhotoEntries.length > 0) {
      const topPhotos = validPhotoEntries.slice(0, Math.min(6, validPhotoEntries.length));
      topPhotos.forEach((entry) => {
        Image.prefetch(entry.url).catch(() => {
          // Silently ignore prefetch errors
        });
      });
      if (__DEV__) {
        console.log('[PERF EditProfile] Prefetching', topPhotos.length, 'photos');
      }
    }
  }, [validPhotoEntries]);

  // PERF: Track grid render start time
  useEffect(() => {
    if (__DEV__ && validPhotoCount > 0) {
      gridRenderTimeRef.current = Date.now();
      loadedPhotosRef.current = new Set();
      hasLoggedGridLoad.current = false;
    }
  }, [validPhotoCount]);

  const handleImageError = useCallback((slotIndex: number) => {
    setFailedSlots((prev) => new Set(prev).add(slotIndex));
  }, []);

  // PERF: Log when all visible photos have loaded
  const handlePhotoLoad = useCallback((slotIndex: number) => {
    if (__DEV__ && gridRenderTimeRef.current > 0) {
      loadedPhotosRef.current.add(slotIndex);

      // Log once all photos are loaded
      if (!hasLoggedGridLoad.current && loadedPhotosRef.current.size === validPhotoCount) {
        const loadTime = Date.now() - gridRenderTimeRef.current;
        console.log('[PERF EditProfile] Photo grid loaded:', {
          photoCount: validPhotoCount,
          loadTimeMs: loadTime,
        });
        hasLoggedGridLoad.current = true;
      }
    }
  }, [validPhotoCount]);

  const handleUploadPhoto = async (slotIndex: number) => {
    // SLOT-BASED: Check if slot already has a photo (replacing) or is empty (adding)
    const existingUrl = photoSlots[slotIndex];
    const isReplacing = isValidPhotoUrl(existingUrl) && !failedSlots.has(slotIndex);

    // Block adding new photo if already at max 9
    if (!isReplacing && validPhotoCount >= GRID_SIZE) {
      Alert.alert('Maximum Photos', 'You can only have up to 9 photos.');
      return;
    }

    // Block if already uploading to this slot
    if (uploadingSlots.has(slotIndex)) {
      if (__DEV__) console.log('[EditProfile] Slot', slotIndex, 'already uploading, ignoring');
      return;
    }

    let coreProfileSaved = false;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library access to upload photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        if (isValidPhotoUrl(uri)) {
          // SLOT-BASED: Update specific slot directly (no shifting) for immediate preview
          setPhotoSlots((prev) => {
            const updated = [...prev] as PhotoSlots9;
            updated[slotIndex] = uri;
            return updated;
          });
          // Clear failed state for this slot
          setFailedSlots((prev) => {
            const next = new Set(prev);
            next.delete(slotIndex);
            return next;
          });

          // LIVE MODE: Upload to Convex backend
          if (!isDemoMode && userId) {
            // Mark slot as uploading
            setUploadingSlots((prev) => new Set(prev).add(slotIndex));

            if (__DEV__) {
              console.log('[EditProfile] 🚀 Starting backend upload', {
                slotIndex,
                isReplacing,
                localUri: uri.slice(-40),
              });
            }

            // Get session token for auth
            const token = useAuthStore.getState().token;
            if (!token) {
              Alert.alert('Error', 'Session expired. Please log in again.');
              setUploadingSlots((prev) => {
                const next = new Set(prev);
                next.delete(slotIndex);
                return next;
              });
              return;
            }

            // Find existing photo ID if replacing (for in-place replacement)
            let existingPhotoId: string | undefined;
            if (isReplacing && backendPhotos) {
              const existingPhoto = backendPhotos.find((p) => p.order === slotIndex);
              if (existingPhoto) {
                existingPhotoId = existingPhoto._id;
                if (__DEV__) {
                  console.log('[EditProfile] Found existing photo to replace:', existingPhotoId);
                }
              }
            }

            // Upload to backend
            const uploadResult = await uploadPhotoToBackend(
              userId,
              uri,
              slotIndex === 0, // isPrimary
              slotIndex,
              token,
              existingPhotoId
            );

            // Clear uploading state
            setUploadingSlots((prev) => {
              const next = new Set(prev);
              next.delete(slotIndex);
              return next;
            });

            if (__DEV__) {
              console.log('[EditProfile] ✅ Backend upload result:', {
                slotIndex,
                success: uploadResult.success,
                storageId: uploadResult.storageId,
                message: uploadResult.message,
              });
            }

            if (!uploadResult.success) {
              Alert.alert('Upload Failed', uploadResult.message || 'Failed to save photo. Please try again.');
              // Revert the local preview on failure
              setPhotoSlots((prev) => {
                const updated = [...prev] as PhotoSlots9;
                updated[slotIndex] = isReplacing ? existingUrl : null;
                return updated;
              });
            }
          } else if (__DEV__) {
            console.log('[EditProfile] handleUploadPhoto (demo/local only)', {
              action: isReplacing ? 'replace' : 'add',
              slotIndex,
              newUri: uri.slice(-40),
            });
          }
        }
      }
    } catch (error: any) {
      // Clear uploading state on error
      setUploadingSlots((prev) => {
        const next = new Set(prev);
        next.delete(slotIndex);
        return next;
      });
      Alert.alert('Error', error.message || 'Failed to upload photo. Please try again.');
    }
  };

  // SLOT-BASED: Remove photo by setting slot to null AND deleting from backend
  // Reference/verification photo is protected and cannot be deleted (keeps it in the system)
  const handleRemovePhoto = (slotIndex: number) => {
    // Check if this photo is the reference/verification photo
    const photoUrl = photoSlots[slotIndex];
    const photoToCheck = currentUser?.photos?.find((p: any) => p.url === photoUrl);
    const isReferencePhoto = photoToCheck?.photoType === 'verification_reference';

    // Reference photo cannot be deleted - it must stay in the system
    if (isReferencePhoto) {
      Alert.alert(
        'Cannot Remove',
        'Your verification photo must stay in your profile. You can choose another photo as your main profile photo.',
      );
      return;
    }

    if (validPhotoCount <= MIN_PROFILE_PHOTOS) {
      Alert.alert('Photos Required', `Keep at least ${MIN_PROFILE_PHOTOS} photos on your profile.`);
      return;
    }

    Alert.alert('Remove Photo', 'Are you sure you want to remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          // Optimistic UI update
          const previousUrl = photoSlots[slotIndex];
          setPhotoSlots((prev) => {
            const updated = [...prev] as PhotoSlots9;
            updated[slotIndex] = null;
            return updated;
          });

          // BACKEND PERSISTENCE: Delete from Convex
          if (!isDemoMode && backendPhotos) {
            const token = useAuthStore.getState().token;
            if (!token) {
              Alert.alert('Error', 'Session expired. Please log in again.');
              // Revert optimistic update
              setPhotoSlots((prev) => {
                const updated = [...prev] as PhotoSlots9;
                updated[slotIndex] = previousUrl;
                return updated;
              });
              return;
            }

            // Find the photo ID to delete
            const photoToDelete = backendPhotos.find((p) => p.url === previousUrl);
            if (photoToDelete) {
              try {
                if (__DEV__) {
                  console.log('[EditProfile] 🗑️ Deleting photo from backend:', {
                    slotIndex,
                    photoId: photoToDelete._id,
                  });
                }
                await deletePhotoMutation({
                  photoId: photoToDelete._id as any,
                  token,
                });
                if (__DEV__) {
                  console.log('[EditProfile] ✅ Photo deleted from backend');
                }
              } catch (error: any) {
                console.error('[EditProfile] ❌ Failed to delete photo:', error);
                Alert.alert('Error', error.message || 'Failed to delete photo. Please try again.');
                // Revert optimistic update on failure
                setPhotoSlots((prev) => {
                  const updated = [...prev] as PhotoSlots9;
                  updated[slotIndex] = previousUrl;
                  return updated;
                });
              }
            } else if (__DEV__) {
              console.log('[EditProfile] handleRemovePhoto: No backend photo found for slot', slotIndex);
            }
          } else if (__DEV__) {
            console.log('[EditProfile] handleRemovePhoto (demo/local only) slot', slotIndex);
          }
        },
      },
    ]);
  };

  // SLOT-BASED: Swap photo to slot 0 (main position) AND persist to backend immediately
  // SAFE REORDER: Uses order-only for primary, validates no photo loss, never deletes photos
  // Verification-aware: locked before verification, unlocked after
  const handleSetMainPhoto = async (fromSlot: number) => {
    if (fromSlot === 0) return; // Already main

    // Check verification status
    const isVerified = currentUser?.isVerified === true;

    // If NOT verified: block the swap with explanation
    if (!isVerified) {
      Alert.alert(
        'Almost There',
        'Your profile photo can be changed after verification is complete.\n\nComplete verification to unlock full control.',
      );
      return;
    }

    // Verified user: proceed with setting new primary photo
    // Get current slots before swap for revert on failure
    const previousSlots = [...photoSlots] as PhotoSlots9;

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP A: Build filtered working array of regular display photos only
    // ═══════════════════════════════════════════════════════════════════════════
    const originalPhotoIds = currentUser?.photos?.map((p: any) => p._id) || [];
    const originalPhotoCount = originalPhotoIds.length;

    if (__DEV__) {
      console.log('[PHOTO_REORDER_START]', {
        fromSlot,
        originalPhotoCount,
        originalPhotoIds: originalPhotoIds.map((id: string) => id?.slice(-6)).join(','),
      });
    }

    // Optimistic UI update - swap locally
    const newSlots = [...photoSlots] as PhotoSlots9;
    const temp = newSlots[0];
    newSlots[0] = newSlots[fromSlot];
    newSlots[fromSlot] = temp;
    setPhotoSlots(newSlots);

    if (__DEV__) {
      console.log('[PHOTO_REORDER_BEFORE]', {
        action: 'swap',
        slot0Before: previousSlots[0]?.slice(-30) || 'empty',
        slotNBefore: previousSlots[fromSlot]?.slice(-30) || 'empty',
        slot0After: newSlots[0]?.slice(-30) || 'empty',
        slotNAfter: newSlots[fromSlot]?.slice(-30) || 'empty',
      });
    }

    // BACKEND PERSISTENCE: Call reorderPhotosWithToken immediately
    if (!isDemoMode && currentUser?.photos && currentUser.photos.length > 0) {
      const token = useAuthStore.getState().token;
      if (!token) {
        Alert.alert('Error', 'Session expired. Please log in again.');
        setPhotoSlots(previousSlots); // Revert
        if (__DEV__) {
          console.log('[PHOTO_REORDER_ABORT] No session token');
        }
        return;
      }

      try {
        // ═══════════════════════════════════════════════════════════════════════════
        // STEP B: Build URL -> photoId map from currentUser.photos
        // ═══════════════════════════════════════════════════════════════════════════
        const urlToPhotoId = new Map<string, string>();
        for (const photo of currentUser.photos) {
          if (photo.url) {
            urlToPhotoId.set(photo.url, photo._id);
          }
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // STEP C: Build ordered photo IDs based on NEW slot order
        // ═══════════════════════════════════════════════════════════════════════════
        const orderedPhotoIds: string[] = [];
        for (const slotUrl of newSlots) {
          if (slotUrl && urlToPhotoId.has(slotUrl)) {
            orderedPhotoIds.push(urlToPhotoId.get(slotUrl)!);
          }
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // STEP D: VALIDATION - Ensure no photo loss before saving
        // CRITICAL: Same number of photos before and after, same set of IDs, no duplicates
        // ═══════════════════════════════════════════════════════════════════════════
        const reorderedCount = orderedPhotoIds.length;
        const reorderedSet = new Set(orderedPhotoIds);
        const originalSet = new Set(originalPhotoIds);

        // Check for duplicates
        const hasDuplicates = reorderedSet.size !== reorderedCount;

        // Check for same count
        const sameCount = reorderedCount === originalPhotoCount;

        // Check for same IDs (both ways)
        const allOriginalPresent = originalPhotoIds.every((id: string) => reorderedSet.has(id));
        const noExtraIds = orderedPhotoIds.every((id: string) => originalSet.has(id));

        const validationPassed = !hasDuplicates && sameCount && allOriginalPresent && noExtraIds;

        if (__DEV__) {
          console.log('[PHOTO_REORDER_VALIDATE]', {
            originalCount: originalPhotoCount,
            reorderedCount,
            hasDuplicates,
            sameCount,
            allOriginalPresent,
            noExtraIds,
            validationPassed,
            originalIds: originalPhotoIds.map((id: string) => id?.slice(-6)).join(','),
            reorderedIds: orderedPhotoIds.map((id: string) => id?.slice(-6)).join(','),
          });
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // STEP E: Only save if validation passes
        // ═══════════════════════════════════════════════════════════════════════════
        if (!validationPassed) {
          console.error('[PHOTO_REORDER_ABORT] Validation failed - aborting to prevent photo loss', {
            originalCount: originalPhotoCount,
            reorderedCount,
            hasDuplicates,
            sameCount,
            allOriginalPresent,
            noExtraIds,
          });
          Alert.alert('Error', 'Could not reorder photos safely. Please refresh and try again.');
          setPhotoSlots(previousSlots); // Revert
          return;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // STEP F: Persist - validation passed, safe to save
        // ═══════════════════════════════════════════════════════════════════════════
        if (orderedPhotoIds.length > 0) {
          const backendOrderedPhotoIds = currentUser.photos
            .map((p: any) => p?._id)
            .filter(Boolean);
          const orderUnchanged =
            backendOrderedPhotoIds.length === orderedPhotoIds.length &&
            backendOrderedPhotoIds.every((id: string, idx: number) => id === orderedPhotoIds[idx]);

          if (__DEV__) {
            console.log('[PHOTO_REORDER_SAVE]', {
              action: 'setMainPhoto',
              newMainPhotoId: orderedPhotoIds[0]?.slice(-6),
              totalPhotos: orderedPhotoIds.length,
              allPhotoIds: orderedPhotoIds.map((id: string) => id?.slice(-6)).join(','),
              orderUnchanged,
            });
          }
          if (!orderUnchanged) {
            await reorderPhotosMutation({
              token,
              photoIds: orderedPhotoIds as any,
            });
          }
          if (__DEV__) {
            console.log('[PHOTO_REORDER_AFTER] ✅ Reorder persisted successfully');
          }
        }
      } catch (error: any) {
        console.error('[PHOTO_REORDER_ABORT] Backend error:', error);
        Alert.alert('Error', error.message || 'Failed to set main photo. Please try again.');
        setPhotoSlots(previousSlots); // Revert on failure
      }
    }
  };

  // Toggle blur for a specific photo (local state only, persisted on Save)
  const handleTogglePhotoBlur = useCallback((index: number) => {
    setBlurredPhotos((prev) => {
      const newState = { ...prev };
      newState[index] = !prev[index];
      if (__DEV__) {
        console.log('[EditProfile] togglePhotoBlur (local)', { index, newValue: newState[index] });
      }
      return newState;
    });
  }, []);

  // Section-based prompts: computed values
  // BUGFIX: Include section field for reliable hydration
  const filledPrompts = Object.values(sectionAnswers)
    .filter((entry): entry is SectionPromptEntry => entry !== null && entry.answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH)
    .map((entry) => ({ section: entry.section, question: entry.question, answer: entry.answer }));

  // Section-based handlers
  const handleSelectQuestion = useCallback((sectionKey: SectionKey, questionText: string) => {
    // SURGICAL FIX: Mark prompts as dirty when user explicitly changes them
    promptsDirtyRef.current = true;
    setSectionAnswers((prev) => ({
      ...prev,
      [sectionKey]: {
        section: sectionKey,
        question: questionText,
        answer: prev[sectionKey]?.question === questionText ? (prev[sectionKey]?.answer || '') : '',
      },
    }));
    setActivePromptSection(sectionKey);
  }, []);

  const handleUpdateSectionAnswer = useCallback((sectionKey: SectionKey, answer: string) => {
    // SURGICAL FIX: Mark prompts as dirty when user explicitly changes them
    promptsDirtyRef.current = true;
    setSectionAnswers((prev) => ({
      ...prev,
      [sectionKey]: prev[sectionKey]
        ? { ...prev[sectionKey]!, answer }
        : null,
    }));
  }, []);

  const togglePromptSection = useCallback((sectionKey: SectionKey) => {
    setActivePromptSection((prev) => (prev === sectionKey ? null : sectionKey));
  }, []);

  // Handle blur feature toggle (local state only, persisted on Save)
  const handleBlurToggle = (newValue: boolean) => {
    if (__DEV__) {
      console.log('[EditProfile] 🔒 handleBlurToggle (local):', { newValue, currentBlurEnabled: blurEnabled });
    }

    if (newValue) {
      // Show notice before enabling blur feature
      setShowBlurNotice(true);
    } else {
      // Turning blur OFF - clear all per-photo blur settings
      setBlurEnabled(false);
      setBlurredPhotos({});
      if (__DEV__) console.log('[EditProfile] 🔒 Blur disabled (local), will persist on Save');
    }
  };

  // Confirm enabling blur feature (local state only, persisted on Save)
  const handleBlurConfirm = () => {
    setShowBlurNotice(false);
    setBlurEnabled(true);
    if (__DEV__) console.log('[EditProfile] 🔒 Blur enabled (local), will persist on Save');
  };

  const handleSave = async () => {
    if (validPhotoCount < MIN_PROFILE_PHOTOS) {
      Alert.alert('Photos Required', `Add at least ${MIN_PROFILE_PHOTOS} photos to your profile.`);
      return;
    }

    // P2 VALIDATION: Validate height/weight ranges
    let hasValidationError = false;
    if (height && height.trim()) {
      const heightNum = parseInt(height);
      if (heightNum < DETAILS_VALIDATION.HEIGHT_MIN || heightNum > DETAILS_VALIDATION.HEIGHT_MAX) {
        setHeightError(`Height must be ${DETAILS_VALIDATION.HEIGHT_MIN}–${DETAILS_VALIDATION.HEIGHT_MAX} cm`);
        hasValidationError = true;
      } else {
        setHeightError(undefined);
      }
    } else {
      setHeightError(undefined);
    }

    if (weight && weight.trim()) {
      const weightNum = parseInt(weight);
      if (weightNum < DETAILS_VALIDATION.WEIGHT_MIN || weightNum > DETAILS_VALIDATION.WEIGHT_MAX) {
        setWeightError(`Weight must be ${DETAILS_VALIDATION.WEIGHT_MIN}–${DETAILS_VALIDATION.WEIGHT_MAX} kg`);
        hasValidationError = true;
      } else {
        setWeightError(undefined);
      }
    } else {
      setWeightError(undefined);
    }

    if (hasValidationError) {
      Alert.alert('Invalid Values', 'Please fix the highlighted fields.');
      return;
    }

    // Demo mode: persist to local demo store, skip Convex
    if (isDemoMode) {
      // SINGLE SOURCE OF TRUTH: Get canonical profile
      const canonicalProfile = useDemoStore.getState().getCurrentProfile();
      if (!canonicalProfile) {
        console.error('[EditProfile SAVE] FAILED: No current profile');
        Alert.alert('Error', 'No profile found. Please sign in again.');
        return;
      }

      const profileId = canonicalProfile.userId;

      // Build patch with explicit-clearing support for the fields editable in Phase-1 Profile.
      const patch: Record<string, any> = {};

      // SLOT-BASED: Save canonical photoSlots (demoStore will derive photos array)
      patch.photoSlots = photoSlots;
      // Also include photos for backward compat (demoStore.saveDemoProfile will sync)
      patch.photos = slotsToPhotos(photoSlots);

      // Prompts - always include (empty array is valid)
      patch.profilePrompts = filledPrompts;

      // Basic Info - name (editable)
      // IDENTITY SIMPLIFICATION: Single name field
      if (displayNameField && displayNameField.trim()) patch.name = displayNameField.trim();

      // Bio/About - explicit undefined clears previous saved value in demo store
      patch.bio = bio.trim() || undefined;

      // Basic info - only include if set
      if (height && height.trim()) patch.height = parseInt(height);
      if (weight && weight.trim()) patch.weight = parseInt(weight);
      if (education) patch.education = education;
      if (religion) patch.religion = religion;
      patch.jobTitle = jobTitle.trim() || undefined;
      patch.company = company.trim() || undefined;
      patch.school = school.trim() || undefined;

      // Lifestyle - only include if set
      if (smoking) patch.smoking = smoking;
      if (drinking) patch.drinking = drinking;
      if (kids) patch.kids = kids;
      if (exercise) patch.exercise = exercise;
      patch.pets = pets.length > 0 ? pets : undefined;
      if (insect) patch.insect = insect;

      // Activities/Interests - always save (empty array is valid)
      patch.activities = activities;
      if (__DEV__) {
        console.log('[PROFILE_INTERESTS] Saving to demo store:', {
          count: activities.length,
          values: activities,
        });
      }

      // Life Rhythm - save to onboardingDraft structure
      const lifeRhythmPatch: Record<string, any> = {};
      if (lifeRhythmCity) lifeRhythmPatch.city = lifeRhythmCity;
      if (socialRhythm) lifeRhythmPatch.socialRhythm = socialRhythm;
      if (sleepSchedule) lifeRhythmPatch.sleepSchedule = sleepSchedule;
      if (travelStyle) lifeRhythmPatch.travelStyle = travelStyle;
      if (workStyle) lifeRhythmPatch.workStyle = workStyle;
      if (coreValues.length > 0) lifeRhythmPatch.coreValues = coreValues;
      patch.onboardingDraft = {
        ...(((canonicalProfile as any)?.onboardingDraft as Record<string, any> | undefined) || {}),
        lifeRhythm: lifeRhythmPatch,
      };

      // Compute non-null slots for logging
      const nonNullSlots = photoSlots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);

      if (__DEV__) {
        console.log('[EditProfile SAVE]', {
          profileId,
          name: canonicalProfile.name,
          nonNullSlots,
        });
      }

      // Update demo profile with PATCH (merge, not overwrite)
      useDemoStore.getState().saveDemoProfile(profileId, patch);

      Alert.alert('Success', 'Profile updated!');
      router.back();
      return;
    }

    // Prod mode: use Convex document ID from query result
    const convexUserId = currentUser?._id;
    if (!convexUserId) {
      Alert.alert('Error', 'User not found. Please try again.');
      return;
    }

    // EXTRA GUARD: Block demo IDs (only startsWith to avoid false positives)
    if (typeof convexUserId === 'string' && convexUserId.startsWith('demo_')) {
      if (__DEV__) {
        console.log('[DEMO GUARD] Blocked updateProfile with demo userId', { file: 'edit-profile.tsx', convexUserId });
      }
      Alert.alert('Demo Mode', 'Changes saved locally in demo mode.');
      router.back();
      return;
    }

    if (__DEV__) {
      console.log('[EditProfile] saving mode=prod userIdType=convexId', { convexUserId });
    }

    let coreProfileSaved = false;
    let photoOrderSaveFailed = false;
    try {
      // Get session token from authStore for secure server-side validation
      // (needed for prompts, photo reorder, and blur mutations)
      const sessionToken = useAuthStore.getState().token;
      if (!sessionToken) {
        throw new Error('No session token available');
      }

      // IDENTITY SIMPLIFICATION: Single name field
      const fullName = (displayNameField || '').trim();

      // SURGICAL FIX: Determine if interests should be included in save
      // Only save interests if:
      // 1. Interests were hydrated from backend (we know the real state), OR
      // 2. User explicitly changed interests this session (dirty flag)
      // This prevents accidental wipe when hydration is incomplete
      const shouldSaveInterests = interestsHydratedRef.current || interestsDirtyRef.current;

      // If saving interests: include them (even if empty = user intentionally cleared)
      // If not saving: omit field entirely to preserve backend state
      const activitiesPayload = shouldSaveInterests
        ? (activities as any) // Send current state (could be empty if user cleared)
        : undefined; // Omit field - don't touch backend

      if (__DEV__) {
        console.log('[EDIT_PROFILE_SAVE_GUARD] Interests save decision:', {
          hydrated: interestsHydratedRef.current,
          dirty: interestsDirtyRef.current,
          shouldSave: shouldSaveInterests,
          count: activities.length,
          action: shouldSaveInterests ? (activities.length > 0 ? 'SAVE_VALUES' : 'SAVE_EMPTY') : 'SKIP_PRESERVE_BACKEND',
        });
      }

      const normalizeString = (v: any) => (typeof v === 'string' ? v.trim() : '');
      const normalizeInt = (v: any) => {
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string' && v.trim().length > 0) {
          const n = parseInt(v, 10);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      };
      const sameString = (a: any, b: any) => normalizeString(a) === normalizeString(b);
      const sameNumberOrNull = (a: any, b: any) => {
        const na = typeof a === 'number' && Number.isFinite(a) ? a : a == null ? null : a;
        const nb = typeof b === 'number' && Number.isFinite(b) ? b : b == null ? null : b;
        return na === nb;
      };
      const sameStringArray = (a: any, b: any) => {
        const aa = Array.isArray(a) ? a : [];
        const bb = Array.isArray(b) ? b : [];
        if (aa.length !== bb.length) return false;
        for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
        return true;
      };

      const nextBio = normalizeString(bio) || undefined;
      const nextJobTitle = normalizeString(jobTitle) || undefined;
      const nextCompany = normalizeString(company) || undefined;
      const nextSchool = normalizeString(school) || undefined;
      const nextName = fullName || undefined;
      const nextHeight = height ? parseInt(height, 10) : undefined;
      const nextWeight = weight ? parseInt(weight, 10) : undefined;
      const nextPets = pets.length > 0 ? (pets as any) : undefined;
      const nextInsect = (insect || undefined) as any;

      const shouldWriteCoreProfile =
        !sameString(currentUser?.name, nextName ?? '') ||
        !sameString(currentUser?.bio, nextBio ?? '') ||
        !sameNumberOrNull((currentUser as any)?.height ?? null, nextHeight ?? null) ||
        !sameNumberOrNull((currentUser as any)?.weight ?? null, nextWeight ?? null) ||
        ((currentUser as any)?.smoking ?? null) !== ((smoking || undefined) as any) ||
        ((currentUser as any)?.drinking ?? null) !== ((drinking || undefined) as any) ||
        ((currentUser as any)?.kids ?? null) !== ((kids || undefined) as any) ||
        ((currentUser as any)?.exercise ?? null) !== ((exercise || undefined) as any) ||
        ((currentUser as any)?.education ?? null) !== ((education || undefined) as any) ||
        ((currentUser as any)?.religion ?? null) !== ((religion || undefined) as any) ||
        !sameString((currentUser as any)?.jobTitle, nextJobTitle ?? '') ||
        !sameString((currentUser as any)?.company, nextCompany ?? '') ||
        !sameString((currentUser as any)?.school, nextSchool ?? '') ||
        !sameStringArray((currentUser as any)?.pets ?? [], nextPets ?? []) ||
        ((currentUser as any)?.insect ?? null) !== (nextInsect ?? null) ||
        // Only consider activities when we intend to save them (otherwise preserve backend state).
        (shouldSaveInterests ? !sameStringArray((currentUser as any)?.activities ?? [], activities as any) : false);

      if (!userId) {
        console.warn('[EDIT_PROFILE] Cannot update profile - no userId');
      } else if (shouldWriteCoreProfile) {
        await updateProfile({
          authUserId: userId,
          name: nextName,
          bio: nextBio,
          height: typeof nextHeight === 'number' && Number.isFinite(nextHeight) ? nextHeight : undefined,
          weight: typeof nextWeight === 'number' && Number.isFinite(nextWeight) ? nextWeight : undefined,
          smoking: (smoking || undefined) as any,
          drinking: (drinking || undefined) as any,
          kids: (kids || undefined) as any,
          education: (education || undefined) as any,
          religion: (religion || undefined) as any,
          jobTitle: nextJobTitle,
          company: nextCompany,
          school: nextSchool,
          exercise: (exercise || undefined) as any,
          pets: nextPets,
          insect: nextInsect,
          activities: activitiesPayload,
        });
      } else {
        if (__DEV__) {
          console.log('[EDIT_PROFILE_SAVE_GUARD] SKIPPED updateProfile - no core changes detected');
        }
      }

      // Whether or not updateProfile ran, subsequent ops can still run (prompts / onboardingDraft / photos / blur).
      coreProfileSaved = true;

      // SURGICAL FIX: Only save prompts if hydrated or edited
      // This prevents accidental wipe when prompts haven't loaded yet
      const shouldSavePrompts = promptsHydratedRef.current || promptsDirtyRef.current;

      if (__DEV__) {
        console.log('[EDIT_PROFILE_SAVE_GUARD] Prompts save decision:', {
          hydrated: promptsHydratedRef.current,
          dirty: promptsDirtyRef.current,
          shouldSave: shouldSavePrompts,
          count: filledPrompts.length,
          action: shouldSavePrompts ? 'SAVE_PROMPTS' : 'SKIP_PRESERVE_BACKEND',
        });
      }

      const postSaveOps: Promise<any>[] = [];

      if (shouldSavePrompts) {
        if (__DEV__) {
          console.log('[PROFILE_PROMPTS_SAVE] Saving to Convex:', {
            count: filledPrompts.length,
            prompts: filledPrompts.map(p => ({ q: p.question.slice(0, 30), a: p.answer.slice(0, 30) })),
            mutation: 'api.users.updateProfilePrompts',
          });
        }
        postSaveOps.push(updateProfilePrompts({ token: sessionToken, prompts: filledPrompts }));
      } else {
        if (__DEV__) {
          console.log('[PROFILE_PROMPTS_SAVE] SKIPPED - not hydrated and not edited, preserving backend state');
        }
      }

      // Save Life Rhythm to onboardingDraft (skip if unchanged)
      const existingLifeRhythm = (currentUser as any)?.onboardingDraft?.lifeRhythm ?? (currentUser as any)?.lifeRhythm ?? null;
      const nextLifeRhythm = {
        city: lifeRhythmCity || undefined,
        socialRhythm: socialRhythm || undefined,
        sleepSchedule: sleepSchedule || undefined,
        travelStyle: travelStyle || undefined,
        workStyle: workStyle || undefined,
        coreValues: coreValues.length > 0 ? coreValues : undefined,
      };
      const lifeRhythmUnchanged =
        sameString(existingLifeRhythm?.city, nextLifeRhythm.city ?? '') &&
        sameString(existingLifeRhythm?.socialRhythm, nextLifeRhythm.socialRhythm ?? '') &&
        sameString(existingLifeRhythm?.sleepSchedule, nextLifeRhythm.sleepSchedule ?? '') &&
        sameString(existingLifeRhythm?.travelStyle, nextLifeRhythm.travelStyle ?? '') &&
        sameString(existingLifeRhythm?.workStyle, nextLifeRhythm.workStyle ?? '') &&
        sameStringArray(existingLifeRhythm?.coreValues ?? [], nextLifeRhythm.coreValues ?? []);

      if (!userId) {
        console.warn('[EDIT_PROFILE] Cannot save Life Rhythm - no userId');
      } else if (!lifeRhythmUnchanged) {
        postSaveOps.push(
          upsertOnboardingDraft({
            userId,
            patch: { lifeRhythm: nextLifeRhythm },
          }),
        );
      } else {
        if (__DEV__) {
          console.log('[EDIT_PROFILE_SAVE_GUARD] SKIPPED upsertOnboardingDraft - lifeRhythm unchanged');
        }
      }

      // CRITICAL FIX: Persist photo ordering to backend
      // Map current photoSlots (URLs) to photo IDs using backendPhotos
      if (backendPhotos && backendPhotos.length > 0) {
        // Build a URL -> photoId map from backend photos
        const urlToPhotoId = new Map<string, string>();
        for (const photo of backendPhotos) {
          if (photo.url) {
            urlToPhotoId.set(photo.url, photo._id);
          }
        }

        // Build ordered photo IDs based on current UI slot order
        const orderedPhotoIds: string[] = [];
        for (const slotUrl of photoSlots) {
          if (slotUrl && urlToPhotoId.has(slotUrl)) {
            orderedPhotoIds.push(urlToPhotoId.get(slotUrl)!);
          }
        }

        // Only reorder if we have photos to reorder
        if (orderedPhotoIds.length > 0) {
          const backendOrderedPhotoIds = [...backendPhotos]
            .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
            .map((p: any) => p._id);
          const orderUnchanged =
            backendOrderedPhotoIds.length === orderedPhotoIds.length &&
            backendOrderedPhotoIds.every((id: string, idx: number) => id === orderedPhotoIds[idx]);

          if (__DEV__) {
            console.log('[EditProfile] 📸 Persisting photo order:', {
              slotCount: photoSlots.filter(Boolean).length,
              photoIdsCount: orderedPhotoIds.length,
              firstPhotoId: orderedPhotoIds[0],
              orderUnchanged,
            });
          }
          if (!orderUnchanged) {
            // Run in parallel with other post-save ops; swallow error and surface a specific message.
            postSaveOps.push(
              reorderPhotosMutation({
                token: sessionToken,
                photoIds: orderedPhotoIds as any, // Cast to Id<'photos'>[]
              }).catch((e: any) => {
                photoOrderSaveFailed = true;
                if (__DEV__) {
                  console.warn('[EditProfile] reorderPhotos failed', e);
                }
              }),
            );
          }
        }
      }

      // PERSIST BLUR: Save global blur state to backend
      // FIX: Backend only supports user-level blur via togglePhotoBlur, not per-photo blur
      if (togglePhotoBlurMutation && userId) {
        const shouldBlur = Object.values(blurredPhotos).some(b => b === true) || blurEnabled;
        const existingBlur = (currentUser as any)?.photoBlurred;
        const blurUnchanged = typeof existingBlur === 'boolean' ? existingBlur === shouldBlur : false;
        if (__DEV__) {
          console.log('[EditProfile] 🔒 Persisting blur state:', { shouldBlur, blurEnabled, blurUnchanged });
        }
        if (!blurUnchanged) {
          postSaveOps.push(
            togglePhotoBlurMutation({
              authUserId: userId,
              blurred: shouldBlur,
            }),
          );
        } else if (__DEV__) {
          console.log('[EDIT_PROFILE_SAVE_GUARD] SKIPPED togglePhotoBlur - blur unchanged');
        }
      }

      // Parallelize independent post-save writes for better perceived latency.
      if (postSaveOps.length > 0) {
        await Promise.all(postSaveOps);
      }

      if (photoOrderSaveFailed) {
        Alert.alert('Profile saved', "Photo order couldn't be saved.");
      } else {
        Alert.alert('Success', 'Profile updated!');
      }
      router.back();
    } catch (error: any) {
      if (coreProfileSaved) {
        Alert.alert(
          'Profile saved',
          'Your main profile changes were saved, but some details may need another try.'
        );
        return;
      }
      Alert.alert('Error', error.message || 'Failed to update profile');
    }
  };

  if (!currentUser) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>{timedOut ? 'Failed to load profile' : 'Loading...'}</Text>
        <TouchableOpacity style={styles.loadingBackButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={COLORS.white} />
          <Text style={styles.loadingBackText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // BLOCKING ERROR: Profile identity broken - don't render empty photo grid
  if (profileError) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle" size={48} color={COLORS.error} style={{ marginBottom: 12 }} />
        <Text style={[styles.loadingText, { color: COLORS.error }]}>{profileError}</Text>
        <TouchableOpacity style={styles.loadingBackButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={COLORS.white} />
          <Text style={styles.loadingBackText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <BlurProfileNotice visible={showBlurNotice} onConfirm={handleBlurConfirm} onCancel={() => setShowBlurNotice(false)} />

      {/* Photo Preview Modal - Full Screen with Floating Action Tray */}
      <Modal
        visible={!!previewPhoto}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreviewPhoto(null)}
      >
        <View style={styles.previewFullScreen}>
          {/* Photo Container */}
          <View style={styles.previewImageContainer}>
            {previewPhoto && (
              <Image
                source={{ uri: previewPhoto.url }}
                style={styles.previewImage}
                contentFit="contain"
                transition={200}
              />
            )}
          </View>
          {/* Floating Action Buttons - No Container Background */}
          <View style={[styles.previewButtonsRow, { paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
            {/* Delete Button */}
            <TouchableOpacity
              style={styles.previewFloatingButton}
              onPress={() => {
                if (previewPhoto) {
                  const indexToDelete = previewPhoto.index;
                  setPreviewPhoto(null);
                  handleRemovePhoto(indexToDelete);
                }
              }}
              activeOpacity={0.8}
            >
              <View style={[styles.previewButtonCircle, styles.previewButtonDanger]}>
                <Ionicons name="trash-outline" size={26} color={COLORS.white} />
              </View>
              <Text style={[styles.previewButtonLabel, styles.previewButtonLabelDanger]}>Delete</Text>
            </TouchableOpacity>
            {/* Replace Button */}
            <TouchableOpacity
              style={styles.previewFloatingButton}
              onPress={() => {
                if (previewPhoto) {
                  const indexToReplace = previewPhoto.index;
                  setPreviewPhoto(null);
                  handleUploadPhoto(indexToReplace);
                }
              }}
              activeOpacity={0.8}
            >
              <View style={styles.previewButtonCircle}>
                <Ionicons name="refresh-outline" size={26} color={COLORS.white} />
              </View>
              <Text style={styles.previewButtonLabel}>Replace</Text>
            </TouchableOpacity>
            {/* Cancel Button */}
            <TouchableOpacity
              style={styles.previewFloatingButton}
              onPress={() => setPreviewPhoto(null)}
              activeOpacity={0.8}
            >
              <View style={styles.previewButtonCircle}>
                <Ionicons name="close" size={26} color={COLORS.white} />
              </View>
              <Text style={styles.previewButtonLabel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave}><Text style={styles.saveButton}>Save</Text></TouchableOpacity>
      </View>

      {/* Basic Info Section */}
      {/* IDENTITY SIMPLIFICATION: Single name field */}
      <BasicInfoSection
        name={displayNameField}
        onChangeName={setDisplayNameField}
        currentUser={currentUser}
      />

      {/* Photo Grid Section - PROFILE COMPLETION: photos */}
      <View onLayout={(e) => registerSectionPosition('photos', e.nativeEvent.layout.y)}>
        <PhotoGridEditor
          photoSlots={photoSlots}
          failedSlots={failedSlots}
          validPhotoCount={validPhotoCount}
          onUploadPhoto={handleUploadPhoto}
          onRemovePhoto={handleRemovePhoto}
          onSetMainPhoto={handleSetMainPhoto}
          onPreviewPhoto={setPreviewPhoto}
          onImageError={handleImageError}
          onPhotoLoad={handlePhotoLoad}
        />
      </View>

      {/* Bio Section - PROFILE COMPLETION: about */}
      <View onLayout={(e) => registerSectionPosition('about', e.nativeEvent.layout.y)}>
        <AboutSection
          bio={bio}
          onChangeBio={setBio}
        />
      </View>

      {/* Prompts Section - PROFILE COMPLETION: prompts */}
      <View onLayout={(e) => registerSectionPosition('prompts', e.nativeEvent.layout.y)}>
        <PromptsSection
          expanded={expandedSection === 'prompts'}
          onToggleExpand={() => toggleSection('prompts')}
          sectionAnswers={sectionAnswers}
          activePromptSection={activePromptSection}
          onTogglePromptSection={togglePromptSection}
          onSelectQuestion={handleSelectQuestion}
          onUpdateSectionAnswer={handleUpdateSectionAnswer}
        />
      </View>

      {/* Details Section - PROFILE COMPLETION: details */}
      <View onLayout={(e) => registerSectionPosition('details', e.nativeEvent.layout.y)}>
        <DetailsSection
          expanded={expandedSection === 'basicInfo'}
          onToggleExpand={() => toggleSection('basicInfo')}
          height={height}
          weight={weight}
          jobTitle={jobTitle}
          company={company}
          school={school}
          onChangeHeight={(v) => { setHeight(v); setHeightError(undefined); }}
          onChangeWeight={(v) => { setWeight(v); setWeightError(undefined); }}
          onChangeJobTitle={setJobTitle}
          onChangeCompany={setCompany}
          onChangeSchool={setSchool}
          heightError={heightError}
          weightError={weightError}
        />
      </View>

      {/* Lifestyle Section */}
      <LifestyleSection
        expanded={expandedSection === 'lifestyle'}
        onToggleExpand={() => toggleSection('lifestyle')}
        smoking={smoking}
        drinking={drinking}
        kids={kids}
        exercise={exercise}
        pets={pets}
        insect={insect}
        onChangeSmoking={setSmoking}
        onChangeDrinking={setDrinking}
        onChangeKids={setKids}
        onChangeExercise={setExercise}
        onTogglePet={togglePet}
        onChangeInsect={setInsect}
        getOptionLabel={getOptionLabel}
      />

      {/* Interests Section */}
      <InterestsSection
        expanded={expandedSection === 'interests'}
        onToggleExpand={() => toggleSection('interests')}
        activities={activities}
        onToggleActivity={toggleActivity}
      />

      {/* Life Rhythm Section */}
      <LifeRhythmSection
        expanded={expandedSection === 'lifeRhythm'}
        onToggleExpand={() => toggleSection('lifeRhythm')}
        lifeRhythmCity={lifeRhythmCity}
        socialRhythm={socialRhythm}
        sleepSchedule={sleepSchedule}
        travelStyle={travelStyle}
        workStyle={workStyle}
        coreValues={coreValues}
        onChangeCity={setLifeRhythmCity}
        onChangeSocialRhythm={setSocialRhythm}
        onChangeSleepSchedule={setSleepSchedule}
        onChangeTravelStyle={setTravelStyle}
        onChangeWorkStyle={setWorkStyle}
        onToggleCoreValue={toggleCoreValue}
        getOptionLabel={getOptionLabel}
      />

      {/* Education & Religion Section - PROFILE COMPLETION: education */}
      <View onLayout={(e) => registerSectionPosition('education', e.nativeEvent.layout.y)}>
        <EducationReligionSection
          expanded={expandedSection === 'educationReligion'}
          onToggleExpand={() => toggleSection('educationReligion')}
          education={education}
          educationOther=""
          religion={religion}
          religionOther=""
          onChangeEducation={setEducation}
          onChangeEducationOther={() => {}}
          onChangeReligion={setReligion}
          onChangeReligionOther={() => {}}
          getOptionLabel={getOptionLabel}
        />
      </View>

      {/* Footer with Save button - proper safe area spacing */}
      <View style={styles.footer}>
        <Button title="Save Changes" variant="primary" onPress={handleSave} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  loadingText: { fontSize: 16, color: COLORS.textLight },
  loadingBackButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: COLORS.primary },
  loadingBackText: { fontSize: 14, fontWeight: '600', color: COLORS.white },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: COLORS.background, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 20, fontWeight: '600', color: COLORS.text },
  saveButton: { fontSize: 16, fontWeight: '600', color: COLORS.primary },
  footer: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16, marginTop: 8 },
  // Photo preview modal styles
  previewFullScreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewImageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewButtonsRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 32,
  },
  previewFloatingButton: {
    alignItems: 'center',
  },
  previewButtonCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(50, 50, 50, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  previewButtonDanger: {
    backgroundColor: COLORS.error,
  },
  previewButtonLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 8,
    textAlign: 'center',
  },
  previewButtonLabelDanger: {
    color: COLORS.error,
  },
});
