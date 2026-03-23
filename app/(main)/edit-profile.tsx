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
import { useRouter } from 'expo-router';
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
import { usePhotoBlurStore } from '@/stores/photoBlurStore';
import { PhotoSlots9, createEmptyPhotoSlots } from '@/types';
import { uploadPhotoToBackend } from '@/services/photoSync';
import { Id } from '@/convex/_generated/dataModel';

// Extracted components
import {
  PhotoGridEditor,
  BasicInfoSection,
  AboutSection,
  PhotoVisibilitySection,
  PromptsSection,
  DetailsSection,
  LifestyleSection,
  LifeRhythmSection,
  EducationReligionSection,
} from '@/components/profile/edit';

const GRID_SIZE = 9;

// Stable empty object reference to avoid re-renders when no blur settings exist
const EMPTY_BLURRED_PHOTOS: Record<number, boolean> = {};

function isValidPhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && url !== 'undefined' && url !== 'null';
}

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  // FIX 1: Track initialization to prevent infinite loop
  const hasInitializedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  // MIGRATION: Track if sectionPrompts → profilePrompts migration has been attempted
  const hasMigratedPromptsRef = useRef(false);

  // PERF: Track photo grid load time
  const gridRenderTimeRef = useRef(0);
  const loadedPhotosRef = useRef<Set<number>>(new Set());
  const hasLoggedGridLoad = useRef(false);

  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;

  // Query backend photos to get photo IDs for replacement logic (live mode only)
  const backendPhotos = useQuery(
    api.photos.getUserPhotos,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isDemoMode) return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const updateProfile = useMutation(api.users.updateProfile);
  const updateProfilePrompts = useMutation(api.users.updateProfilePrompts);
  const upsertOnboardingDraft = useMutation(api.users.upsertOnboardingDraft);
  const togglePhotoBlur = isDemoMode ? null : useMutation(api.users.togglePhotoBlur);
  const reorderPhotos = useMutation(api.photos.reorderPhotosWithToken);
  const deletePhotoMutation = useMutation(api.photos.deletePhoto);

  // Subscribe to currentDemoUserId to prevent stale closures on account switch
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);

  // Get effective userId for blur settings (works for both demo and prod)
  const effectiveUserId = isDemoMode
    ? currentDemoUserId || 'demo_user'
    : userId || '';

  // Per-photo blur from persisted store - use direct selectors for stable references
  const userBlurSettings = usePhotoBlurStore((s) => s.userSettings[effectiveUserId]);
  const blurEnabled = userBlurSettings?.blurEnabled ?? false;
  const blurredPhotos = userBlurSettings?.blurredPhotos ?? EMPTY_BLURRED_PHOTOS;

  const setBlurEnabled = useCallback(
    (enabled: boolean) => usePhotoBlurStore.getState().setBlurEnabled(effectiveUserId, enabled),
    [effectiveUserId]
  );
  const setBlurredPhotos = useCallback(
    (photos: Record<number, boolean>) => usePhotoBlurStore.getState().setBlurredPhotos(effectiveUserId, photos),
    [effectiveUserId]
  );

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

  // Basic Info fields (firstName/lastName editable, others read-only)
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [smoking, setSmoking] = useState<string | null>(null);
  const [drinking, setDrinking] = useState<string | null>(null);
  const [kids, setKids] = useState<string | null>(null);
  const [education, setEducation] = useState<string | null>(null);
  const [educationOther, setEducationOther] = useState('');
  const [religion, setReligion] = useState<string | null>(null);
  const [religionOther, setReligionOther] = useState('');
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
  type ExpandableSection = 'prompts' | 'basicInfo' | 'lifestyle' | 'lifeRhythm' | 'educationReligion' | null;
  const [expandedSection, setExpandedSection] = useState<ExpandableSection>(null);

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
      const newSectionAnswers: Record<SectionKey, SectionPromptEntry | null> = {
        builder: null,
        performer: null,
        seeker: null,
        grounded: null,
      };

      // Reconstruct section answers from existing prompts by matching question text
      existingPrompts.forEach((prompt: { question: string; answer: string; section?: SectionKey }) => {
        // If prompt has section field, use it directly
        if (prompt.section && PROMPT_SECTIONS.find(s => s.key === prompt.section)) {
          newSectionAnswers[prompt.section] = {
            section: prompt.section,
            question: prompt.question,
            answer: prompt.answer,
          };
          return;
        }

        // Otherwise, find the section by matching question text
        for (const section of PROMPT_SECTIONS) {
          const matchingQuestion = section.questions.find(q => q.text === prompt.question);
          if (matchingQuestion && !newSectionAnswers[section.key]) {
            newSectionAnswers[section.key] = {
              section: section.key,
              question: prompt.question,
              answer: prompt.answer,
            };
            break;
          }
        }
      });

      setSectionAnswers(newSectionAnswers);

      if (__DEV__) {
        const filledCount = Object.values(newSectionAnswers).filter(Boolean).length;
        console.log('[EditProfile] Loaded section prompts:', filledCount);
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

      // Initialize firstName/lastName from profile
      // Priority: demoProfile firstName/lastName > parse from name
      const canonicalForNames = isDemoMode
        ? useDemoStore.getState().getCurrentProfile()
        : null;
      if (canonicalForNames?.firstName || canonicalForNames?.lastName) {
        setFirstName(canonicalForNames.firstName || '');
        setLastName(canonicalForNames.lastName || '');
      } else if (currentUser.name) {
        // Parse name into firstName/lastName
        const parts = currentUser.name.trim().split(/\s+/);
        if (parts.length === 1) {
          setFirstName(parts[0]);
          setLastName('');
        } else {
          setFirstName(parts[0]);
          setLastName(parts.slice(1).join(' '));
        }
      }
      // Note: blurEnabled is now persisted in photoBlurStore, not initialized from server

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

      // BLUR SYNC: Initialize local blur state from backend photoBlurred field
      // This ensures Edit Profile shows correct blur toggle state on load
      const backendBlurEnabled = (currentUser as any)?.photoBlurred ?? false;
      if (backendBlurEnabled !== blurEnabled) {
        setBlurEnabled(backendBlurEnabled);
        if (__DEV__) {
          console.log('[EditProfile] 🔒 Synced blur state from backend:', {
            photoBlurred: backendBlurEnabled,
            previousLocalState: blurEnabled,
          });
        }
      }
    }
  }, [currentUser?._id, currentUser?.id, currentDemoUserId]);

  // LIVE MODE: Sync photo slots from currentUser.photos (source of truth)
  // BUG FIX (2026-03-23): Use currentUser.photos instead of backendPhotos (getUserPhotos)
  // getUserPhotos EXCLUDES verification_reference photos, causing the primary selfie to be hidden
  // currentUser.photos from getCurrentUser includes ALL photos (same fix as Phase-2 onboarding)
  useEffect(() => {
    if (isDemoMode || !currentUser?.photos) return;

    // Map photos to slots by array index (photos are already sorted by order from getCurrentUser)
    const slotsFromBackend: PhotoSlots9 = createEmptyPhotoSlots();
    currentUser.photos.forEach((photo: any, index: number) => {
      if (index >= 0 && index < 9 && photo.url) {
        slotsFromBackend[index] = photo.url;
      }
    });

    // Only update if there's actual data (avoid clearing slots during loading)
    const hasPhotos = slotsFromBackend.some((s) => s !== null);
    if (hasPhotos) {
      if (__DEV__) {
        const filledSlots = slotsFromBackend.map((s, i) => s ? i : -1).filter(i => i >= 0);
        // Show raw photo records with order/isPrimary/photoType
        const photoDetails = currentUser.photos.map((p: any) => ({
          id: p._id?.slice(-6),
          order: p.order,
          isPrimary: p.isPrimary,
          photoType: p.photoType || 'regular',
        }));
        console.log('[EditProfile] 📸 Photos loaded (includes all types):', {
          count: currentUser.photos.length,
          filledSlots,
          photos: photoDetails,
          primaryPhoto: currentUser.photos.find((p: any) => p.isPrimary)?._id?.slice(-6),
        });
      }
      setPhotoSlots(slotsFromBackend);
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

  // Cleanup blur state when photos are removed
  useEffect(() => {
    if (effectiveUserId && validPhotoCount > 0) {
      usePhotoBlurStore.getState().cleanupBlurredPhotos(effectiveUserId, validPhotoCount);
    }
  }, [validPhotoCount, effectiveUserId]);

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
  const handleRemovePhoto = (slotIndex: number) => {
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
  const handleSetMainPhoto = async (fromSlot: number) => {
    if (fromSlot === 0) return; // Already main

    // Get current slots before swap for revert on failure
    const previousSlots = [...photoSlots] as PhotoSlots9;

    // Optimistic UI update - swap locally
    const newSlots = [...photoSlots] as PhotoSlots9;
    const temp = newSlots[0];
    newSlots[0] = newSlots[fromSlot];
    newSlots[fromSlot] = temp;
    setPhotoSlots(newSlots);

    if (__DEV__) {
      console.log('[EditProfile] 🔄 setMainPhoto swap slot', fromSlot, '<-> 0');
    }

    // BACKEND PERSISTENCE: Call reorderPhotosWithToken immediately
    if (!isDemoMode && backendPhotos && backendPhotos.length > 0) {
      const token = useAuthStore.getState().token;
      if (!token) {
        Alert.alert('Error', 'Session expired. Please log in again.');
        setPhotoSlots(previousSlots); // Revert
        return;
      }

      try {
        // Build URL -> photoId map
        const urlToPhotoId = new Map<string, string>();
        for (const photo of backendPhotos) {
          if (photo.url) {
            urlToPhotoId.set(photo.url, photo._id);
          }
        }

        // Build ordered photo IDs based on NEW slot order
        const orderedPhotoIds: string[] = [];
        for (const slotUrl of newSlots) {
          if (slotUrl && urlToPhotoId.has(slotUrl)) {
            orderedPhotoIds.push(urlToPhotoId.get(slotUrl)!);
          }
        }

        if (orderedPhotoIds.length > 0) {
          if (__DEV__) {
            console.log('[EditProfile] 📸 Persisting main photo change:', {
              newMainPhotoId: orderedPhotoIds[0],
              totalPhotos: orderedPhotoIds.length,
            });
          }
          await reorderPhotos({
            photoIds: orderedPhotoIds as any,
            token,
          });
          if (__DEV__) {
            console.log('[EditProfile] ✅ Main photo persisted to backend');
          }
        }
      } catch (error: any) {
        console.error('[EditProfile] ❌ Failed to persist main photo:', error);
        Alert.alert('Error', error.message || 'Failed to set main photo. Please try again.');
        setPhotoSlots(previousSlots); // Revert on failure
      }
    }
  };

  // Toggle blur for a specific photo (persisted to store)
  const handleTogglePhotoBlur = useCallback((index: number) => {
    usePhotoBlurStore.getState().togglePhotoBlur(effectiveUserId, index);
    if (__DEV__) {
      console.log('[EditProfile] togglePhotoBlur', { index, userId: effectiveUserId });
    }
  }, [effectiveUserId]);

  // Section-based prompts: computed values
  const filledPrompts = Object.values(sectionAnswers)
    .filter((entry): entry is SectionPromptEntry => entry !== null && entry.answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH)
    .map((entry) => ({ question: entry.question, answer: entry.answer }));

  const allSectionsFilled = filledPrompts.length === TOTAL_SECTIONS;

  // Section-based handlers
  const handleSelectQuestion = useCallback((sectionKey: SectionKey, questionText: string) => {
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

  const handleBlurToggle = (newValue: boolean) => {
    if (__DEV__) {
      console.log('[EditProfile] 🔒 handleBlurToggle called:', {
        newValue,
        currentBlurEnabled: blurEnabled,
        isDemoMode,
      });
    }

    if (newValue) {
      setShowBlurNotice(true);
    } else {
      // Turning blur OFF - Demo mode: just update local state (no persist)
      if (isDemoMode) {
        setBlurEnabled(false);
        setBlurredPhotos({}); // P1-007 FIX: Clear blurredPhotos when disabling blur
        if (__DEV__) console.log('[DEMO] Set blurEnabled=false (local state only)');
        return;
      }
      const convexUserId = currentUser?._id;
      if (!convexUserId || !togglePhotoBlur || !userId) return;
      // EXTRA GUARD: Block demo IDs (only startsWith to avoid false positives)
      if (typeof convexUserId === 'string' && convexUserId.startsWith('demo_')) {
        if (__DEV__) console.log('[DEMO GUARD] Blocked togglePhotoBlur (off)', { file: 'edit-profile.tsx' });
        setBlurEnabled(false);
        return;
      }
      if (__DEV__) {
        console.log('[EditProfile] 🔒 Calling togglePhotoBlur mutation:', {
          authUserId: userId,
          blurred: false,
        });
      }
      togglePhotoBlur({ authUserId: userId, blurred: false })
        .then(() => {
          setBlurEnabled(false);
          setBlurredPhotos({}); // P1-007 FIX: Clear blurredPhotos when disabling blur
          if (__DEV__) console.log('[EditProfile] ✅ Blur disabled, backend updated');
        })
        .catch((err: any) => Alert.alert('Error', err.message));
    }
  };

  const handleBlurConfirm = async () => {
    setShowBlurNotice(false);
    // Turning blur ON - Demo mode: just update local state (no persist)
    if (isDemoMode) {
      setBlurEnabled(true);
      if (__DEV__) console.log('[DEMO] Set blurEnabled=true (local state only)');
      return;
    }
    const convexUserId = currentUser?._id;
    if (!convexUserId || !togglePhotoBlur || !userId) return;
    // EXTRA GUARD: Block demo IDs (only startsWith to avoid false positives)
    if (typeof convexUserId === 'string' && convexUserId.startsWith('demo_')) {
      if (__DEV__) console.log('[DEMO GUARD] Blocked togglePhotoBlur (on)', { file: 'edit-profile.tsx' });
      setBlurEnabled(true);
      return;
    }
    try {
      if (__DEV__) {
        console.log('[EditProfile] 🔒 Calling togglePhotoBlur mutation:', {
          authUserId: userId,
          blurred: true,
        });
      }
      await togglePhotoBlur({ authUserId: userId, blurred: true });
      setBlurEnabled(true);
      if (__DEV__) console.log('[EditProfile] ✅ Blur enabled, backend updated');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleSave = async () => {
    if (!allSectionsFilled) {
      Alert.alert('Prompts Required', `Complete all ${TOTAL_SECTIONS} prompt sections to continue.`);
      return;
    }
    if (validPhotoCount === 0) {
      Alert.alert('Photos Required', 'Add at least one photo to your profile.');
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

      // Build WIPE-SAFE patch: only include fields that have actual values
      // This prevents undefined/null from overwriting stored data
      const patch: Record<string, any> = {};

      // SLOT-BASED: Save canonical photoSlots (demoStore will derive photos array)
      patch.photoSlots = photoSlots;
      // Also include photos for backward compat (demoStore.saveDemoProfile will sync)
      patch.photos = slotsToPhotos(photoSlots);

      // Prompts - always include (empty array is valid)
      patch.profilePrompts = filledPrompts;

      // Basic Info - firstName/lastName (editable)
      if (firstName && firstName.trim()) patch.firstName = firstName.trim();
      if (lastName && lastName.trim()) patch.lastName = lastName.trim();
      // Construct full name for backend compatibility
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      if (fullName.length > 0) patch.name = fullName;

      // Bio/About - only include if non-empty
      if (bio && bio.trim()) patch.bio = bio.trim();

      // Basic info - only include if set
      if (height && height.trim()) patch.height = parseInt(height);
      if (weight && weight.trim()) patch.weight = parseInt(weight);
      if (education) patch.education = education;
      if (religion) patch.religion = religion;
      if (jobTitle && jobTitle.trim()) patch.jobTitle = jobTitle.trim();
      if (company && company.trim()) patch.company = company.trim();
      if (school && school.trim()) patch.school = school.trim();

      // Lifestyle - only include if set
      if (smoking) patch.smoking = smoking;
      if (drinking) patch.drinking = drinking;
      if (kids) patch.kids = kids;
      if (exercise) patch.exercise = exercise;
      if (pets.length > 0) patch.pets = pets;
      if (insect) patch.insect = insect;

      // Life Rhythm - save to onboardingDraft structure
      const lifeRhythmPatch: Record<string, any> = {};
      if (lifeRhythmCity) lifeRhythmPatch.city = lifeRhythmCity;
      if (socialRhythm) lifeRhythmPatch.socialRhythm = socialRhythm;
      if (sleepSchedule) lifeRhythmPatch.sleepSchedule = sleepSchedule;
      if (travelStyle) lifeRhythmPatch.travelStyle = travelStyle;
      if (workStyle) lifeRhythmPatch.workStyle = workStyle;
      if (coreValues.length > 0) lifeRhythmPatch.coreValues = coreValues;
      if (Object.keys(lifeRhythmPatch).length > 0) {
        patch.onboardingDraft = { ...(patch.onboardingDraft || {}), lifeRhythm: lifeRhythmPatch };
      }

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

    try {
      // Construct full name from firstName/lastName
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

      await updateProfile({
        authUserId: userId as string,
        name: fullName || undefined,
        bio: bio || undefined,
        height: height ? parseInt(height) : undefined,
        weight: weight ? parseInt(weight) : undefined,
        smoking: (smoking || undefined) as any,
        drinking: (drinking || undefined) as any,
        kids: (kids || undefined) as any,
        education: (education || undefined) as any,
        religion: (religion || undefined) as any,
        jobTitle: jobTitle || undefined,
        company: company || undefined,
        school: school || undefined,
        exercise: (exercise || undefined) as any,
        pets: pets.length > 0 ? (pets as any) : undefined,
        insect: (insect || undefined) as any,
      });
      // Get session token from authStore for secure server-side validation
      const sessionToken = useAuthStore.getState().token;
      if (!sessionToken) {
        throw new Error('No session token available');
      }
      await updateProfilePrompts({ token: sessionToken, prompts: filledPrompts });

      // Save Life Rhythm to onboardingDraft
      const lifeRhythmPatch: Record<string, any> = {};
      if (lifeRhythmCity) lifeRhythmPatch.city = lifeRhythmCity;
      if (socialRhythm) lifeRhythmPatch.socialRhythm = socialRhythm;
      if (sleepSchedule) lifeRhythmPatch.sleepSchedule = sleepSchedule;
      if (travelStyle) lifeRhythmPatch.travelStyle = travelStyle;
      if (workStyle) lifeRhythmPatch.workStyle = workStyle;
      if (coreValues.length > 0) lifeRhythmPatch.coreValues = coreValues;

      if (Object.keys(lifeRhythmPatch).length > 0) {
        await upsertOnboardingDraft({
          userId: userId as string,
          patch: { lifeRhythm: lifeRhythmPatch },
        });
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
          if (__DEV__) {
            console.log('[EditProfile] 📸 Persisting photo order:', {
              slotCount: photoSlots.filter(Boolean).length,
              photoIdsCount: orderedPhotoIds.length,
              firstPhotoId: orderedPhotoIds[0],
            });
          }
          await reorderPhotos({
            photoIds: orderedPhotoIds as any, // Cast to Id<'photos'>[]
            token: sessionToken,
          });
        }
      }

      Alert.alert('Success', 'Profile updated!');
      router.back();
    } catch (error: any) {
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
      <BasicInfoSection
        firstName={firstName}
        lastName={lastName}
        onChangeFirstName={setFirstName}
        onChangeLastName={setLastName}
        currentUser={currentUser}
      />

      {/* Photo Grid Section */}
      <PhotoGridEditor
        photoSlots={photoSlots}
        failedSlots={failedSlots}
        blurEnabled={blurEnabled}
        blurredPhotos={blurredPhotos}
        validPhotoCount={validPhotoCount}
        onUploadPhoto={handleUploadPhoto}
        onRemovePhoto={handleRemovePhoto}
        onSetMainPhoto={handleSetMainPhoto}
        onTogglePhotoBlur={handleTogglePhotoBlur}
        onPreviewPhoto={setPreviewPhoto}
        onImageError={handleImageError}
        onPhotoLoad={handlePhotoLoad}
      />

      {/* Photo Visibility Section */}
      <PhotoVisibilitySection
        blurEnabled={blurEnabled}
        onToggleBlur={handleBlurToggle}
      />

      {/* About Section */}
      <AboutSection
        bio={bio}
        onChangeBio={setBio}
      />

      {/* Prompts Section */}
      <PromptsSection
        expanded={expandedSection === 'prompts'}
        onToggleExpand={() => toggleSection('prompts')}
        sectionAnswers={sectionAnswers}
        activePromptSection={activePromptSection}
        onTogglePromptSection={togglePromptSection}
        onSelectQuestion={handleSelectQuestion}
        onUpdateSectionAnswer={handleUpdateSectionAnswer}
      />

      {/* Details Section */}
      <DetailsSection
        expanded={expandedSection === 'basicInfo'}
        onToggleExpand={() => toggleSection('basicInfo')}
        height={height}
        weight={weight}
        jobTitle={jobTitle}
        company={company}
        school={school}
        onChangeHeight={setHeight}
        onChangeWeight={setWeight}
        onChangeJobTitle={setJobTitle}
        onChangeCompany={setCompany}
        onChangeSchool={setSchool}
      />

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

      {/* Education & Religion Section */}
      <EducationReligionSection
        expanded={expandedSection === 'educationReligion'}
        onToggleExpand={() => toggleSection('educationReligion')}
        education={education}
        educationOther={educationOther}
        religion={religion}
        religionOther={religionOther}
        onChangeEducation={setEducation}
        onChangeEducationOther={setEducationOther}
        onChangeReligion={setReligion}
        onChangeReligionOther={setReligionOther}
        getOptionLabel={getOptionLabel}
      />

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
