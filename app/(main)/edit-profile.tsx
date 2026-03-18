import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  Alert,
  TextInput,
  Switch,
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
  PROMPT_ANSWER_MAX_LENGTH,
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
import { Button, Input } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { BlurProfileNotice } from '@/components/profile/BlurProfileNotice';
import { isDemoMode } from '@/hooks/useConvex';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useDemoStore, slotsToPhotos } from '@/stores/demoStore';
import { usePhotoBlurStore } from '@/stores/photoBlurStore';
import { PhotoSlots9, createEmptyPhotoSlots } from '@/types';

const GRID_SIZE = 9;
const COLUMNS = 3;
const GRID_GAP = 8;
const SCREEN_PADDING = 16;
const screenWidth = Dimensions.get('window').width;
const slotSize = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

// Stable empty object reference to avoid re-renders when no blur settings exist
const EMPTY_BLURRED_PHOTOS: Record<number, boolean> = {};

function isValidPhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && url !== 'undefined' && url !== 'null';
}

// Detect if a photo URL is a cartoon/avatar (should never be blurred)
function isCartoonPhoto(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes('cartoon') ||
    lowerUrl.includes('avatar') ||
    lowerUrl.includes('illustrated') ||
    lowerUrl.includes('anime') ||
    lowerUrl.includes('robohash') ||
    lowerUrl.includes('dicebear') ||
    lowerUrl.includes('ui-avatars')
  );
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

  // Ref for bio TextInput to enable tap-anywhere-to-focus
  const bioInputRef = useRef<TextInput>(null);

  // PERF: Track photo grid load time
  const gridRenderTimeRef = useRef(0);
  const loadedPhotosRef = useRef<Set<number>>(new Set());
  const hasLoggedGridLoad = useRef(false);

  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;

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
  useEffect(() => {
    const currentUserId = currentUser?._id || currentUser?.id || null;
    if (currentUser && (!hasInitializedRef.current || lastUserIdRef.current !== currentUserId)) {
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
      console.log('[EditProfile ARTBOARD]', {
        profileId: canonicalProfile?.userId ?? currentUserId,
        userId: userId,
        nonNullSlots,
        isDemoMode,
        source: isDemoMode ? 'demoStore' : 'convex',
      });

      // CRITICAL: Warn if in demo mode
      if (isDemoMode) {
        console.warn('[EditProfile] ⚠️ DEMO MODE ACTIVE - Using demoStore (local), NOT Convex backend!');
        console.warn('[EditProfile] ⚠️ Photos uploaded to Convex will NOT be saved to demoStore.');
        console.warn('[EditProfile] ⚠️ Set EXPO_PUBLIC_DEMO_MODE=false in .env.local to use Convex.');
      }

      setPhotoSlots(initSlots);
    }
  }, [currentUser?._id, currentUser?.id, currentDemoUserId]);

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
          // SLOT-BASED: Update specific slot directly (no shifting)
          setPhotoSlots((prev) => {
            const updated = [...prev] as PhotoSlots9;
            updated[slotIndex] = uri;
            if (__DEV__) {
              console.log('[EditProfile] handleUploadPhoto', {
                action: isReplacing ? 'replace' : 'add',
                slotIndex,
                newUri: uri.slice(-40),
              });
            }
            return updated;
          });
          // Clear failed state for this slot
          setFailedSlots((prev) => {
            const next = new Set(prev);
            next.delete(slotIndex);
            return next;
          });
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to upload photo. Please try again.');
    }
  };

  // SLOT-BASED: Remove photo by setting slot to null (no shifting)
  const handleRemovePhoto = (slotIndex: number) => {
    Alert.alert('Remove Photo', 'Are you sure you want to remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setPhotoSlots((prev) => {
            const updated = [...prev] as PhotoSlots9;
            updated[slotIndex] = null;
            if (__DEV__) {
              console.log('[EditProfile] handleRemovePhoto slot', slotIndex);
            }
            return updated;
          });
        },
      },
    ]);
  };

  // SLOT-BASED: Swap photo to slot 0 (main position)
  const handleSetMainPhoto = (fromSlot: number) => {
    if (fromSlot === 0) return; // Already main
    setPhotoSlots((prev) => {
      const updated = [...prev] as PhotoSlots9;
      // Swap positions
      const temp = updated[0];
      updated[0] = updated[fromSlot];
      updated[fromSlot] = temp;
      if (__DEV__) {
        console.log('[EditProfile] setMainPhoto swap slot', fromSlot, '<-> 0');
      }
      return updated;
    });
  };

  // Toggle blur for a specific photo (persisted to store)
  const handleTogglePhotoBlur = useCallback((index: number) => {
    usePhotoBlurStore.getState().togglePhotoBlur(effectiveUserId, index);
    if (__DEV__) {
      console.log('[EditProfile] togglePhotoBlur', { index, userId: effectiveUserId });
    }
  }, [effectiveUserId]);

  // SLOT-BASED: Render slot at specific index
  const renderPhotoSlot = (slotIndex: number) => {
    const url = photoSlots[slotIndex];
    const hasValidPhoto = isValidPhotoUrl(url) && !failedSlots.has(slotIndex);

    if (hasValidPhoto) {
      const isMain = slotIndex === 0;
      const isCartoon = isCartoonPhoto(url!);
      const isPhotoBlurred = blurEnabled && !isCartoon && blurredPhotos[slotIndex];

      return (
        <View key={slotIndex} style={styles.photoSlot}>
          {/* Tap photo to preview */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewPhoto({ url: url!, index: slotIndex })}>
            <Image
              source={{ uri: url }}
              style={styles.photoImage}
              contentFit="cover"
              blurRadius={isPhotoBlurred ? 10 : 0}
              transition={200}
              onError={() => handleImageError(slotIndex)}
              onLoadEnd={() => handlePhotoLoad(slotIndex)}
            />
          </Pressable>
          {/* Per-photo blur toggle - only show when blur mode enabled and not a cartoon */}
          {blurEnabled && !isCartoon && (
            <TouchableOpacity
              style={[styles.photoBlurButton, blurredPhotos[slotIndex] && styles.photoBlurButtonActive]}
              onPress={() => handleTogglePhotoBlur(slotIndex)}
            >
              <Ionicons
                name={blurredPhotos[slotIndex] ? 'eye-off' : 'eye'}
                size={14}
                color={COLORS.white}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.photoRemoveButton} onPress={() => handleRemovePhoto(slotIndex)}>
            <Ionicons name="close" size={14} color={COLORS.white} />
          </TouchableOpacity>
          {/* Main badge or Set as Main button */}
          {isMain ? (
            <View style={styles.mainBadge}><Text style={styles.mainBadgeText}>Main</Text></View>
          ) : (
            <TouchableOpacity style={styles.setMainButton} onPress={() => handleSetMainPhoto(slotIndex)}>
              <Ionicons name="star" size={10} color={COLORS.white} />
            </TouchableOpacity>
          )}
        </View>
      );
    }
    // Empty slot
    return (
      <TouchableOpacity key={slotIndex} style={[styles.photoSlot, styles.photoSlotEmpty]} onPress={() => handleUploadPhoto(slotIndex)} activeOpacity={0.7}>
        <Ionicons name="add" size={28} color={COLORS.primary} />
        <Text style={styles.uploadText}>Add</Text>
      </TouchableOpacity>
    );
  };

  // Section-based prompts: computed values
  const filledPrompts = Object.values(sectionAnswers)
    .filter((entry): entry is SectionPromptEntry => entry !== null && entry.answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH)
    .map((entry) => ({ question: entry.question, answer: entry.answer }));

  const filledSectionCount = filledPrompts.length;
  const allSectionsFilled = filledSectionCount === TOTAL_SECTIONS;

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
    if (newValue) {
      setShowBlurNotice(true);
    } else {
      // Turning blur OFF - Demo mode: just update local state (no persist)
      if (isDemoMode) {
        setBlurEnabled(false);
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
      togglePhotoBlur({ authUserId: userId, blurred: false })
        .then(() => setBlurEnabled(false))
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
      await togglePhotoBlur({ authUserId: userId, blurred: true });
      setBlurEnabled(true);
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

      {/* Basic Info Section - Identity fields (compact layout) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Basic Info</Text>
        {/* Row 1: First Name + Last Name side by side */}
        <View style={styles.nameRow}>
          <View style={styles.nameField}>
            <Text style={styles.label}>First Name</Text>
            <Input
              placeholder="First"
              value={firstName}
              onChangeText={setFirstName}
              maxLength={20}
              autoCapitalize="words"
            />
          </View>
          <View style={styles.nameField}>
            <Text style={styles.label}>Last Name</Text>
            <Input
              placeholder="Last"
              value={lastName}
              onChangeText={setLastName}
              maxLength={20}
              autoCapitalize="words"
            />
          </View>
        </View>
        {/* Row 2: Nickname full width */}
        <View style={styles.inputRow}>
          <Text style={styles.label}>Nickname / User ID</Text>
          <View style={styles.readOnlyField}>
            <Text style={styles.readOnlyText}>@{currentUser?.handle || currentUser?.nickname || '—'}</Text>
            <Ionicons name="lock-closed" size={14} color={COLORS.textMuted} />
          </View>
        </View>
        {/* Row 3: Age + Gender compact side by side */}
        <View style={styles.compactRow}>
          <View style={styles.compactField}>
            <Text style={styles.compactLabel}>Age</Text>
            <View style={styles.compactValue}>
              <Text style={styles.compactValueText}>
                {currentUser?.dateOfBirth
                  ? Math.floor((Date.now() - new Date(currentUser.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                  : '—'}
              </Text>
              <Ionicons name="lock-closed" size={12} color={COLORS.textMuted} />
            </View>
          </View>
          <View style={styles.compactField}>
            <Text style={styles.compactLabel}>Gender</Text>
            <View style={styles.compactValue}>
              <Text style={styles.compactValueText}>
                {currentUser?.gender === 'male' ? 'M' :
                 currentUser?.gender === 'female' ? 'F' :
                 currentUser?.gender === 'non_binary' ? 'NB' :
                 currentUser?.gender ? currentUser.gender.charAt(0).toUpperCase() : '—'}
              </Text>
              <Ionicons name="lock-closed" size={12} color={COLORS.textMuted} />
            </View>
          </View>
        </View>
        <Text style={styles.readOnlyHint}>Nickname, Age, and Gender cannot be changed.</Text>
      </View>

      {/* Photo Grid - 9 slots */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photos</Text>
        <Text style={styles.sectionHint}>Add up to 9 photos. Your first photo will be your main profile picture.</Text>
        <View style={styles.photoGrid}>{Array.from({ length: GRID_SIZE }).map((_, i) => renderPhotoSlot(i))}</View>
        <Text style={styles.photoCount}>{validPhotoCount} of {GRID_SIZE} photos</Text>
      </View>

      {/* Photo Visibility */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photo Visibility</Text>
        <View style={styles.blurRow}>
          <View style={styles.blurInfo}>
            <View style={styles.blurLabelRow}>
              <Ionicons name="eye-off-outline" size={18} color={COLORS.primary} />
              <Text style={styles.blurLabel}>Enable Photo Blur</Text>
            </View>
            <Text style={styles.blurDescription}>
              {blurEnabled
                ? 'Tap the eye icon on each photo to blur/unblur it individually.'
                : 'Turn on to choose which photos to blur for privacy.'}
            </Text>
          </View>
          <Switch value={blurEnabled} onValueChange={handleBlurToggle} trackColor={{ false: COLORS.border, true: COLORS.primary }} thumbColor={COLORS.white} />
        </View>
      </View>

      {/* FIX 2: About/Bio with tap-anywhere-to-focus */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Pressable style={styles.bioContainer} onPress={() => bioInputRef.current?.focus()}>
          <TextInput
            ref={bioInputRef}
            style={styles.bioInput}
            placeholder="Tell us about yourself..."
            placeholderTextColor={COLORS.textMuted}
            value={bio}
            onChangeText={setBio}
            multiline
            numberOfLines={4}
            maxLength={500}
            textAlignVertical="top"
          />
        </Pressable>
        <Text style={styles.charCount}>{bio.length}/500</Text>
      </View>

      {/* PROMPTS SECTION - Section-Based */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.reviewHeader} onPress={() => toggleSection('prompts')} activeOpacity={0.7}>
          <View style={styles.reviewHeaderLeft}>
            <Text style={styles.reviewSectionTitle}>Prompts</Text>
            <Text style={styles.reviewSummary}>
              {filledSectionCount > 0
                ? `${filledSectionCount} of ${TOTAL_SECTIONS} sections`
                : 'Add prompts'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {allSectionsFilled && <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />}
            <Ionicons
              name={expandedSection === 'prompts' ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={COLORS.textMuted}
            />
          </View>
        </TouchableOpacity>

        {/* Collapsed: Show prompt previews */}
        {expandedSection !== 'prompts' && filledPrompts.length > 0 && (
          <View style={styles.reviewPreviewList}>
            {filledPrompts.slice(0, 2).map((prompt, idx) => (
              <View key={idx} style={styles.reviewPreviewItem}>
                <Text style={styles.reviewPreviewQuestion} numberOfLines={1}>{prompt.question}</Text>
                <Text style={styles.reviewPreviewAnswer} numberOfLines={1}>{prompt.answer}</Text>
              </View>
            ))}
            {filledPrompts.length > 2 && (
              <Text style={styles.reviewMoreText}>+{filledPrompts.length - 2} more</Text>
            )}
          </View>
        )}

        {/* Expanded: Section-based edit UI (Section 1-4 accordion style) */}
        {expandedSection === 'prompts' && (
          <View style={styles.expandedContent}>
            <Text style={styles.promptSectionHint}>Choose 1 question from each section:</Text>
            {PROMPT_SECTIONS.map((section) => {
              const currentAnswer = sectionAnswers[section.key];
              const isExpanded = activePromptSection === section.key;
              const hasValidAnswer = currentAnswer && currentAnswer.answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH;

              return (
                <View key={section.key} style={styles.promptSectionContainer}>
                  {/* Section Header - simple accordion style */}
                  <TouchableOpacity
                    style={[styles.promptSectionHeader, hasValidAnswer && styles.promptSectionHeaderComplete]}
                    onPress={() => togglePromptSection(section.key)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.promptSectionHeaderLeft}>
                      <Text style={styles.promptSectionTitle}>{section.label}</Text>
                      {hasValidAnswer && <Ionicons name="checkmark-circle" size={16} color={COLORS.success} style={{ marginLeft: 8 }} />}
                    </View>
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>

                  {/* Section Content (expanded) */}
                  {isExpanded && (
                    <View style={styles.promptSectionContent}>
                      {section.questions.map((question) => {
                        const isSelected = currentAnswer?.question === question.text;
                        return (
                          <View key={question.id}>
                            <TouchableOpacity
                              style={[styles.promptQuestionOption, isSelected && styles.promptQuestionSelected]}
                              onPress={() => handleSelectQuestion(section.key, question.text)}
                              activeOpacity={0.7}
                            >
                              <Ionicons
                                name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                                size={18}
                                color={isSelected ? COLORS.primary : COLORS.textMuted}
                              />
                              <Text style={[styles.promptQuestionText, isSelected && styles.promptQuestionTextSelected]}>
                                {question.text}
                              </Text>
                            </TouchableOpacity>
                            {isSelected && (
                              <View style={styles.promptAnswerBox}>
                                <TextInput
                                  style={styles.promptAnswerInput}
                                  value={currentAnswer?.answer || ''}
                                  onChangeText={(t) => handleUpdateSectionAnswer(section.key, t)}
                                  placeholder="Type your answer..."
                                  placeholderTextColor={COLORS.textMuted}
                                  multiline
                                  maxLength={PROMPT_ANSWER_MAX_LENGTH}
                                  textAlignVertical="top"
                                />
                                <View style={styles.promptAnswerFooter}>
                                  {currentAnswer?.answer && currentAnswer.answer.trim().length > 0 &&
                                    currentAnswer.answer.trim().length < PROMPT_ANSWER_MIN_LENGTH && (
                                    <Text style={styles.promptMinCharWarn}>
                                      {PROMPT_ANSWER_MIN_LENGTH - currentAnswer.answer.trim().length} more chars
                                    </Text>
                                  )}
                                  <Text style={styles.promptCharCount}>
                                    {currentAnswer?.answer?.length || 0}/{PROMPT_ANSWER_MAX_LENGTH}
                                  </Text>
                                </View>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Collapsed preview */}
                  {!isExpanded && currentAnswer && (
                    <View style={styles.promptCollapsedPreview}>
                      <Text style={styles.promptCollapsedQuestion} numberOfLines={1}>{currentAnswer.question}</Text>
                      {currentAnswer.answer && (
                        <Text style={styles.promptCollapsedAnswer} numberOfLines={1}>{currentAnswer.answer}</Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
            {!allSectionsFilled && (
              <View style={styles.promptValidationHint}>
                <Ionicons name="information-circle" size={16} color={COLORS.warning} />
                <Text style={styles.promptValidationText}>
                  Complete all {TOTAL_SECTIONS} sections ({PROMPT_ANSWER_MIN_LENGTH}+ chars each)
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* BASIC INFO (lower) SECTION - Review Style */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.reviewHeader} onPress={() => toggleSection('basicInfo')} activeOpacity={0.7}>
          <View style={styles.reviewHeaderLeft}>
            <Text style={styles.reviewSectionTitle}>Details</Text>
            <Text style={styles.reviewSummary}>
              {[height && `${height}cm`, weight && `${weight}kg`, jobTitle].filter(Boolean).join(' · ') || 'Add details'}
            </Text>
          </View>
          <Ionicons
            name={expandedSection === 'basicInfo' ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={COLORS.textMuted}
          />
        </TouchableOpacity>

        {/* Collapsed: Show key values */}
        {expandedSection !== 'basicInfo' && (
          <View style={styles.reviewRowList}>
            {height ? (
              <View style={styles.reviewRow}>
                <Text style={styles.reviewRowLabel}>Height</Text>
                <Text style={styles.reviewRowValue}>{height} cm</Text>
              </View>
            ) : null}
            {weight ? (
              <View style={styles.reviewRow}>
                <Text style={styles.reviewRowLabel}>Weight</Text>
                <Text style={styles.reviewRowValue}>{weight} kg</Text>
              </View>
            ) : null}
            {jobTitle ? (
              <View style={styles.reviewRow}>
                <Text style={styles.reviewRowLabel}>Job</Text>
                <Text style={styles.reviewRowValue} numberOfLines={1}>{jobTitle}{company ? ` at ${company}` : ''}</Text>
              </View>
            ) : null}
            {school ? (
              <View style={styles.reviewRow}>
                <Text style={styles.reviewRowLabel}>School</Text>
                <Text style={styles.reviewRowValue} numberOfLines={1}>{school}</Text>
              </View>
            ) : null}
            {!height && !weight && !jobTitle && !school && (
              <Text style={styles.reviewEmptyHint}>Tap to add your details</Text>
            )}
          </View>
        )}

        {/* Expanded: Full edit UI */}
        {expandedSection === 'basicInfo' && (
          <View style={styles.expandedContent}>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Height (cm)</Text>
              <Input placeholder="e.g. 170" value={height} onChangeText={setHeight} keyboardType="numeric" style={styles.numberInput} />
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Weight (kg)</Text>
              <Input placeholder="e.g. 65" value={weight} onChangeText={setWeight} keyboardType="numeric" style={styles.numberInput} />
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Job Title</Text>
              <Input placeholder="e.g. Software Engineer" value={jobTitle} onChangeText={setJobTitle} />
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Company</Text>
              <Input placeholder="e.g. Google" value={company} onChangeText={setCompany} />
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>School</Text>
              <Input placeholder="e.g. Stanford University" value={school} onChangeText={setSchool} />
            </View>
          </View>
        )}
      </View>

      {/* LIFESTYLE SECTION - Review Style */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.reviewHeader} onPress={() => toggleSection('lifestyle')} activeOpacity={0.7}>
          <View style={styles.reviewHeaderLeft}>
            <Text style={styles.reviewSectionTitle}>Lifestyle</Text>
            <Text style={styles.reviewSummary}>
              {[
                smoking && getOptionLabel(SMOKING_OPTIONS, smoking),
                drinking && getOptionLabel(DRINKING_OPTIONS, drinking),
              ].filter(Boolean).join(' · ') || 'Add lifestyle info'}
            </Text>
          </View>
          <Ionicons
            name={expandedSection === 'lifestyle' ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={COLORS.textMuted}
          />
        </TouchableOpacity>

        {/* Collapsed: Show key values */}
        {expandedSection !== 'lifestyle' && (
          <View style={styles.reviewRowList}>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Smoking</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(SMOKING_OPTIONS, smoking)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Drinking</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(DRINKING_OPTIONS, drinking)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Kids</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(KIDS_OPTIONS, kids)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Exercise</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(EXERCISE_OPTIONS, exercise)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Pets</Text>
              <Text style={styles.reviewRowValue}>
                {pets.length > 0
                  ? pets.map((p) => PETS_OPTIONS.find((o) => o.value === p)?.label || p).join(', ')
                  : '—'}
              </Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Insects</Text>
              <Text style={styles.reviewRowValue}>
                {insect ? INSECT_OPTIONS.find((o) => o.value === insect)?.label || insect : '—'}
              </Text>
            </View>
          </View>
        )}

        {/* Expanded: Full edit UI */}
        {expandedSection === 'lifestyle' && (
          <View style={styles.expandedContent}>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Smoking</Text>
              <View style={styles.optionsRow}>
                {SMOKING_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, smoking === o.value && styles.optionChipSelected]}
                    onPress={() => setSmoking(smoking === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, smoking === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Drinking</Text>
              <View style={styles.optionsRow}>
                {DRINKING_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, drinking === o.value && styles.optionChipSelected]}
                    onPress={() => setDrinking(drinking === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, drinking === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Kids</Text>
              <View style={styles.optionsRow}>
                {KIDS_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, kids === o.value && styles.optionChipSelected]}
                    onPress={() => setKids(kids === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, kids === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Exercise</Text>
              <View style={styles.optionsRow}>
                {EXERCISE_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, exercise === o.value && styles.optionChipSelected]}
                    onPress={() => setExercise(exercise === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, exercise === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Pets (select up to 3)</Text>
              <View style={styles.optionsRow}>
                {PETS_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, pets.includes(o.value) && styles.optionChipSelected]}
                    onPress={() => togglePet(o.value)}
                  >
                    <Text style={[styles.optionChipText, pets.includes(o.value) && styles.optionChipTextSelected]}>
                      {o.emoji} {o.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Insects (optional)</Text>
              <View style={styles.optionsRow}>
                {INSECT_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, insect === o.value && styles.optionChipSelected]}
                    onPress={() => setInsect(insect === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, insect === o.value && styles.optionChipTextSelected]}>
                      {o.emoji} {o.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}
      </View>

      {/* LIFE RHYTHM SECTION - Review Style */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.reviewHeader} onPress={() => toggleSection('lifeRhythm')} activeOpacity={0.7}>
          <View style={styles.reviewHeaderLeft}>
            <Text style={styles.reviewSectionTitle}>Life Rhythm</Text>
            <Text style={styles.reviewSummary}>
              {[
                socialRhythm && getOptionLabel(SOCIAL_RHYTHM_OPTIONS, socialRhythm),
                sleepSchedule && getOptionLabel(SLEEP_SCHEDULE_OPTIONS, sleepSchedule),
              ].filter(Boolean).join(' · ') || 'Add life rhythm info'}
            </Text>
          </View>
          <Ionicons
            name={expandedSection === 'lifeRhythm' ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={COLORS.textMuted}
          />
        </TouchableOpacity>

        {/* Collapsed: Show key values */}
        {expandedSection !== 'lifeRhythm' && (
          <View style={styles.reviewRowList}>
            {lifeRhythmCity ? (
              <View style={styles.reviewRow}>
                <Text style={styles.reviewRowLabel}>City</Text>
                <Text style={styles.reviewRowValue}>{lifeRhythmCity}</Text>
              </View>
            ) : null}
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Social Style</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(SOCIAL_RHYTHM_OPTIONS, socialRhythm)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Sleep Schedule</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(SLEEP_SCHEDULE_OPTIONS, sleepSchedule)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Travel Style</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(TRAVEL_STYLE_OPTIONS, travelStyle)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Work Style</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(WORK_STYLE_OPTIONS, workStyle)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Core Values</Text>
              <Text style={styles.reviewRowValue}>
                {coreValues.length > 0
                  ? coreValues.map((v) => CORE_VALUES_OPTIONS.find((o) => o.value === v)?.label || v).join(', ')
                  : '—'}
              </Text>
            </View>
          </View>
        )}

        {/* Expanded: Full edit UI */}
        {expandedSection === 'lifeRhythm' && (
          <View style={styles.expandedContent}>
            <View style={styles.inputRow}>
              <Text style={styles.label}>City</Text>
              <Input
                placeholder="e.g. San Francisco"
                value={lifeRhythmCity}
                onChangeText={setLifeRhythmCity}
              />
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Social Style</Text>
              <View style={styles.optionsRow}>
                {SOCIAL_RHYTHM_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, socialRhythm === o.value && styles.optionChipSelected]}
                    onPress={() => setSocialRhythm(socialRhythm === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, socialRhythm === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Sleep Schedule</Text>
              <View style={styles.optionsRow}>
                {SLEEP_SCHEDULE_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, sleepSchedule === o.value && styles.optionChipSelected]}
                    onPress={() => setSleepSchedule(sleepSchedule === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, sleepSchedule === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Travel Style (optional)</Text>
              <View style={styles.optionsRow}>
                {TRAVEL_STYLE_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, travelStyle === o.value && styles.optionChipSelected]}
                    onPress={() => setTravelStyle(travelStyle === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, travelStyle === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Work Style (optional)</Text>
              <View style={styles.optionsRow}>
                {WORK_STYLE_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, workStyle === o.value && styles.optionChipSelected]}
                    onPress={() => setWorkStyle(workStyle === o.value ? null : o.value)}
                  >
                    <Text style={[styles.optionChipText, workStyle === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Core Values (select up to 3)</Text>
              <View style={styles.optionsRow}>
                {CORE_VALUES_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.optionChip, coreValues.includes(o.value) && styles.optionChipSelected]}
                    onPress={() => toggleCoreValue(o.value)}
                  >
                    <Text style={[styles.optionChipText, coreValues.includes(o.value) && styles.optionChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}
      </View>

      {/* EDUCATION & RELIGION SECTION - Review Style */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.reviewHeader} onPress={() => toggleSection('educationReligion')} activeOpacity={0.7}>
          <View style={styles.reviewHeaderLeft}>
            <Text style={styles.reviewSectionTitle}>Education & Religion</Text>
            <Text style={styles.reviewSummary}>
              {[
                education && getOptionLabel(EDUCATION_OPTIONS, education),
                religion && getOptionLabel(RELIGION_OPTIONS, religion),
              ].filter(Boolean).join(' · ') || 'Add info'}
            </Text>
          </View>
          <Ionicons
            name={expandedSection === 'educationReligion' ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={COLORS.textMuted}
          />
        </TouchableOpacity>

        {/* Collapsed: Show key values */}
        {expandedSection !== 'educationReligion' && (
          <View style={styles.reviewRowList}>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Education</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(EDUCATION_OPTIONS, education)}</Text>
            </View>
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Religion</Text>
              <Text style={styles.reviewRowValue}>{getOptionLabel(RELIGION_OPTIONS, religion)}</Text>
            </View>
          </View>
        )}

        {/* Expanded: Full edit UI */}
        {expandedSection === 'educationReligion' && (
          <View style={styles.expandedContent}>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Education</Text>
              <View style={styles.chipGrid}>
                {EDUCATION_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.compactChip, education === o.value && styles.compactChipSelected]}
                    onPress={() => {
                      setEducation(education === o.value ? null : o.value);
                      if (o.value !== 'other') setEducationOther('');
                    }}
                  >
                    <Text style={[styles.compactChipText, education === o.value && styles.compactChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {education === 'other' && (
                <TextInput
                  style={styles.otherInput}
                  placeholder="Please specify..."
                  placeholderTextColor={COLORS.textMuted}
                  value={educationOther}
                  onChangeText={setEducationOther}
                  maxLength={50}
                />
              )}
            </View>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Religion</Text>
              <View style={styles.chipGrid}>
                {RELIGION_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[styles.compactChip, religion === o.value && styles.compactChipSelected]}
                    onPress={() => {
                      setReligion(religion === o.value ? null : o.value);
                      if (o.value !== 'other') setReligionOther('');
                    }}
                  >
                    <Text style={[styles.compactChipText, religion === o.value && styles.compactChipTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {religion === 'other' && (
                <TextInput
                  style={styles.otherInput}
                  placeholder="Please specify..."
                  placeholderTextColor={COLORS.textMuted}
                  value={religionOther}
                  onChangeText={setReligionOther}
                  maxLength={50}
                />
              )}
            </View>
          </View>
        )}
      </View>

      {/* FIX 1: Footer with proper safe area spacing */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}>
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
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  sectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12 },
  // Review-style UI for expandable sections
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  reviewHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  reviewSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 0,
  },
  reviewSummary: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  reviewRowList: {
    marginTop: 12,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  reviewRowLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  reviewRowValue: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    maxWidth: '60%',
    textAlign: 'right',
  },
  reviewEmptyHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  reviewPreviewList: {
    marginTop: 12,
  },
  reviewPreviewItem: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.primary,
  },
  reviewPreviewQuestion: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  reviewPreviewAnswer: {
    fontSize: 14,
    color: COLORS.text,
  },
  reviewMoreText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
    paddingTop: 4,
  },
  expandedContent: {
    marginTop: 16,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  photoSlot: { width: slotSize, height: slotSize * 1.25, borderRadius: 10, overflow: 'hidden', backgroundColor: COLORS.backgroundDark },
  photoSlotEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.border, borderStyle: 'dashed' },
  photoImage: { width: '100%', height: '100%' },
  photoBlurButton: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBlurButtonActive: {
    backgroundColor: COLORS.primary,
  },
  photoRemoveButton: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  slotBadge: { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  slotBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.white },
  uploadText: { fontSize: 11, color: COLORS.primary, marginTop: 4, fontWeight: '500' },
  photoCount: { fontSize: 12, color: COLORS.textLight, textAlign: 'center', marginTop: 12 },
  // FIX 2: Bio container for tap-to-focus
  bioContainer: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    minHeight: 120,
  },
  bioInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 100,
    textAlignVertical: 'top',
    padding: 0,
  },
  charCount: { fontSize: 12, color: COLORS.textLight, textAlign: 'right', marginTop: 4 },
  inputRow: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '500', color: COLORS.text, marginBottom: 8 },
  numberInput: { width: 120 },
  // Compact Basic Info layout styles
  nameRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  nameField: {
    flex: 1,
  },
  compactRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  compactField: {
    flex: 1,
  },
  compactLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  compactValue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  compactValueText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  // Read-only field styles for locked Basic Info fields
  readOnlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  readOnlyText: {
    fontSize: 15,
    color: COLORS.textMuted,
  },
  readOnlyHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: COLORS.border },
  optionChipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optionChipText: { fontSize: 14, color: COLORS.text },
  optionChipTextSelected: { color: COLORS.white, fontWeight: '600' },
  selectContainer: { gap: 8 },
  selectOption: { padding: 12, borderRadius: 8, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: COLORS.border },
  selectOptionSelected: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  selectOptionText: { fontSize: 14, color: COLORS.text },
  selectOptionTextSelected: { color: COLORS.primary, fontWeight: '600' },
  // Section-based prompt styles
  promptSectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12, fontWeight: '500' },
  promptSectionContainer: { marginBottom: 12, borderRadius: 10, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  promptSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14 },
  promptSectionHeaderComplete: { borderLeftWidth: 3, borderLeftColor: COLORS.success },
  promptSectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  promptSectionTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  promptSectionContent: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  promptQuestionOption: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, paddingHorizontal: 6, borderRadius: 6, marginTop: 8, gap: 8 },
  promptQuestionSelected: { backgroundColor: COLORS.primary + '15' },
  promptQuestionText: { fontSize: 13, color: COLORS.text, flex: 1, lineHeight: 18 },
  promptQuestionTextSelected: { fontWeight: '500', color: COLORS.primary },
  promptAnswerBox: { marginLeft: 26, marginTop: 6, marginBottom: 6, backgroundColor: COLORS.background, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: COLORS.primary },
  promptAnswerInput: { fontSize: 14, color: COLORS.text, minHeight: 50, maxHeight: 100, lineHeight: 18, padding: 0 },
  promptAnswerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  promptMinCharWarn: { fontSize: 11, color: COLORS.warning, fontWeight: '500' },
  promptCharCount: { fontSize: 10, color: COLORS.textMuted },
  promptCollapsedPreview: { paddingHorizontal: 12, paddingBottom: 10, marginLeft: 42 },
  promptCollapsedQuestion: { fontSize: 12, color: COLORS.textLight, fontWeight: '500' },
  promptCollapsedAnswer: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  promptValidationHint: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.warning + '15', padding: 10, borderRadius: 8, marginTop: 4, gap: 6 },
  promptValidationText: { fontSize: 12, color: COLORS.warning, flex: 1 },
  // FIX 1: Footer with better spacing
  footer: { padding: 16, paddingTop: 24, marginTop: 8 },
  blurRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  blurInfo: { flex: 1, marginRight: 16 },
  blurLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  blurLabel: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  blurDescription: { fontSize: 12, color: COLORS.textLight, lineHeight: 16 },
  // Photo badges
  mainBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  mainBadgeText: { fontSize: 10, fontWeight: '700', color: COLORS.white },
  setMainButton: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Compact chip grid for Education & Religion
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  compactChipSelected: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  chipIcon: { fontSize: 14 },
  compactChipText: { fontSize: 13, color: COLORS.text },
  compactChipTextSelected: { color: COLORS.primary, fontWeight: '600' },
  // Other text input for Education/Religion
  otherInput: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontSize: 14,
    color: COLORS.text,
  },
  // Photo preview modal - Full Screen with Floating Buttons
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
    // Shadow for each button
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
