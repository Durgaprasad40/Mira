/**
 * Phase-2 Edit Profile Screen (FULL CONTROL CENTER)
 *
 * Comprehensive edit screen with ALL profile data:
 * 1. Basic Info (nickname, age, gender)
 * 2. Photos (grid with add/remove)
 * 3. Photo Visibility (blur controls)
 * 4. Bio
 * 5. Prompts (2 visible, +X more expandable)
 * 6. Details (all onboarding fields)
 * 7. Settings
 *
 * IMPORTANT:
 * - NO onboarding routing - all edits are inline
 * - Nickname-only (no full name)
 * - Premium UI with proper spacing and hierarchy
 */
import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Dimensions,
  Alert,
  ActivityIndicator,
  TextInput,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Paths, File as ExpoFile, Directory } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { uploadPhotoToConvex } from '@/lib/uploadUtils';
import { INCOGNITO_COLORS, ACTIVITY_FILTERS } from '@/lib/constants';
import {
  PHASE2_SECTION1_PROMPTS,
  PHASE2_SECTION2_PROMPTS,
  PHASE2_SECTION3_PROMPTS,
  type Phase2PromptAnswer,
} from '@/lib/privateConstants';
import { cmToFeetInches } from '@/lib/utils';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;
const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_GAP = 8;
const PHOTO_PADDING = 16;
const PHOTO_SIZE = (SCREEN_WIDTH - PHOTO_PADDING * 2 - PHOTO_GAP * 2) / 3;
const MAX_PHOTOS = 9;
const PRIVATE_PHOTOS_DIR_NAME = 'private_photos';

type PhotoSlotItemProps = {
  slotIndex: number;
  uri: string;
  isMain: boolean;
  isThisSlotLoading: boolean;
  photoBlurEnabled: boolean;
  isSlotBlurred: boolean;
  shouldRenderImage: boolean;
  didFirstPaint: boolean;
  onOpenPreview: (slotIndex: number) => void;
  onSetMain: (slotIndex: number) => void;
  onToggleBlur: (slotIndex: number) => void;
};

const PhotoSlotItem = React.memo(function PhotoSlotItem({
  slotIndex,
  uri,
  isMain,
  isThisSlotLoading,
  photoBlurEnabled,
  isSlotBlurred,
  shouldRenderImage,
  didFirstPaint,
  onOpenPreview,
  onSetMain,
  onToggleBlur,
}: PhotoSlotItemProps) {
  const handleOpen = useCallback(() => onOpenPreview(slotIndex), [onOpenPreview, slotIndex]);
  const handleSetMain = useCallback(() => onSetMain(slotIndex), [onSetMain, slotIndex]);
  const handleToggle = useCallback(() => onToggleBlur(slotIndex), [onToggleBlur, slotIndex]);

  // Avoid blur cost on initial paint; apply only after first paint.
  const blurRadius = didFirstPaint && photoBlurEnabled && isSlotBlurred ? 8 : 0;

  return (
    <View style={styles.photoSlot}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        onPress={handleOpen}
        activeOpacity={0.9}
        disabled={isThisSlotLoading}
      >
        {shouldRenderImage ? (
          <Image
            source={{ uri }}
            style={styles.photoImage}
            contentFit="cover"
            blurRadius={blurRadius}
            transition={200}
          />
        ) : (
          <View style={[styles.photoImage, styles.photoImageDeferred]}>
            <Ionicons name="image-outline" size={22} color="rgba(255,255,255,0.55)" />
          </View>
        )}
      </TouchableOpacity>

      {/* Star indicator: filled = current main, outline = tap to make main */}
      {isMain ? (
        <View style={styles.mainBadge} pointerEvents="none">
          <Ionicons name="star" size={12} color="#FFD700" />
        </View>
      ) : (
        <TouchableOpacity
          style={styles.setMainBtn}
          onPress={handleSetMain}
          activeOpacity={0.7}
          disabled={isThisSlotLoading}
        >
          <Ionicons name="star-outline" size={12} color="#FFFFFF" />
        </TouchableOpacity>
      )}

      {photoBlurEnabled && (
        <TouchableOpacity
          style={[styles.blurBtn, isSlotBlurred && styles.blurBtnActive]}
          onPress={handleToggle}
          activeOpacity={0.7}
          disabled={isThisSlotLoading}
        >
          <Ionicons
            name={isSlotBlurred ? 'eye-off' : 'eye'}
            size={14}
            color="#FFFFFF"
          />
        </TouchableOpacity>
      )}
    </View>
  );
});

type PersistedProfileUpdates = {
  privatePhotoUrls?: string[];
  photoBlurSlots?: boolean[];
  photoBlurEnabled?: boolean;
  privateBio?: string;
  height?: number | null;
  weight?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  education?: string | null;
  religion?: string | null;
  hobbies?: string[];
};

type Phase1FallbackUser = {
  height?: number;
  weight?: number;
  smoking?: string;
  drinking?: string;
  education?: string;
  religion?: string;
  activities?: string[];
};

function getPrivatePhotosDir(): Directory {
  return new Directory(Paths.document, PRIVATE_PHOTOS_DIR_NAME);
}

async function copyToPermamentStorage(sourceUri: string, index: number): Promise<string | null> {
  if (sourceUri.includes(PRIVATE_PHOTOS_DIR_NAME) || sourceUri.startsWith('http')) {
    return sourceUri;
  }

  try {
    const privateDir = getPrivatePhotosDir();
    if (!privateDir.exists) {
      privateDir.create();
    }

    const timestamp = Date.now();
    const extension = sourceUri.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `photo_${timestamp}_${index}.${extension}`;
    const destFile = new ExpoFile(privateDir, filename);

    if (destFile.exists) {
      return destFile.uri;
    }

    const sourceFile = new ExpoFile(sourceUri);
    sourceFile.copy(destFile);

    return destFile.uri;
  } catch (error) {
    if (__DEV__) {
      console.error('[EditProfile] Copy failed:', error);
    }
    return null;
  }
}

function isValidPhotoUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url === 'undefined' || url === 'null') return false;
  if (url.includes('/cache/ImagePicker/') || url.includes('/Cache/ImagePicker/')) {
    return false;
  }
  return url.startsWith('http') || url.startsWith('file://');
}

/** Same-length URL list equality (order-sensitive), for Convex vs optimistic lists */
function photoUrlListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((u, i) => u === b[i]);
}

// Gender options
const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

// Smoking options
const SMOKING_OPTIONS = [
  { value: 'never', label: 'Non-smoker' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'regularly', label: 'Regularly' },
  { value: 'trying_to_quit', label: 'Trying to quit' },
];

// Drinking options
const DRINKING_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'socially', label: 'Socially' },
  { value: 'regularly', label: 'Regularly' },
  { value: 'sober', label: 'Sober' },
];

// Education options
const EDUCATION_OPTIONS = [
  { value: 'high_school', label: 'High School' },
  { value: 'some_college', label: 'Some College' },
  { value: 'trade_school', label: 'Trade School' },
  { value: 'bachelors', label: "Bachelor's" },
  { value: 'masters', label: "Master's" },
  { value: 'doctorate', label: 'Doctorate' },
  { value: 'other', label: 'Other' },
];

// Religion options
const RELIGION_OPTIONS = [
  { value: 'christian', label: 'Christian' },
  { value: 'muslim', label: 'Muslim' },
  { value: 'jewish', label: 'Jewish' },
  { value: 'hindu', label: 'Hindu' },
  { value: 'buddhist', label: 'Buddhist' },
  { value: 'sikh', label: 'Sikh' },
  { value: 'spiritual', label: 'Spiritual' },
  { value: 'agnostic', label: 'Agnostic' },
  { value: 'atheist', label: 'Atheist' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

function canonicalizeSmoking(value: string | null | undefined): string | null {
  if (!value) return null;
  // Legacy mappings
  if (value === 'socially') return 'sometimes';
  return value;
}

function canonicalizeDrinking(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

function canonicalizeEducation(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

function canonicalizeReligion(value: string | null | undefined): string | null {
  if (!value) return null;
  // Legacy mappings
  if (value === 'catholic') return 'christian';
  return value;
}

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Auth
  const { userId, token } = useAuthStore();

  // Backend profile query
  const backendProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    !isDemoMode && userId && token ? { token, authUserId: userId } : 'skip'
  );
  // Phase-1 fallback source for old Phase-2 profiles (read-only)
  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && token ? { token } : 'skip'
  );
  const phase1User = currentUser as unknown as Phase1FallbackUser | undefined;
  const isSignedOut = !isDemoMode && !userId;
  const isBackendLoading = !isDemoMode && !!userId && backendProfile === undefined;
  const isMissingBackendProfile = !isDemoMode && !!userId && backendProfile === null;

  // Backend mutations
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const getStorageUrl = useMutation(api.photos.getStorageUrl);
  const trackPendingUpload = useMutation(api.photos.trackPendingUpload);
  const cleanupPendingUpload = useMutation(api.photos.cleanupPendingUpload);
  const updatePrivateProfile = useMutation(api.privateProfiles.updateFieldsByAuthId);
  const updatePhotoBlurSlots = useMutation(api.privateProfiles.updatePhotoBlurSlots);
  const updateDisplayName = useMutation(api.privateProfiles.updateDisplayNameByAuthId);
  const syncFromMainProfile = useMutation(api.privateProfiles.syncFromMainProfile);

  // Store data
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const storeDisplayName = usePrivateProfileStore((s) => s.displayName);
  const storeAge = usePrivateProfileStore((s) => s.age);
  const storeGender = usePrivateProfileStore((s) => s.gender);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const photoBlurEnabled = usePrivateProfileStore((s) => s.photoBlurEnabled);
  const photoBlurSlots = usePrivateProfileStore((s) => s.photoBlurSlots);
  const promptAnswers = usePrivateProfileStore((s) => s.promptAnswers);

  // Profile details from store
  const storeHeight = usePrivateProfileStore((s) => s.height);
  const storeWeight = usePrivateProfileStore((s) => s.weight);
  const storeSmoking = usePrivateProfileStore((s) => s.smoking);
  const storeDrinking = usePrivateProfileStore((s) => s.drinking);
  const storeEducation = usePrivateProfileStore((s) => s.education);
  const storeReligion = usePrivateProfileStore((s) => s.religion);
  const storeHobbies = usePrivateProfileStore((s) => s.hobbies);

  // Optimistic overlay: after a successful photo mutation, Convex may lag one tick behind the row we just wrote.
  const [pendingPhotoUrls, setPendingPhotoUrls] = useState<string[] | null>(null);

  const resolvedPrivateBio = useMemo(() => {
    if (!isDemoMode && backendProfile !== undefined) {
      return backendProfile?.privateBio || '';
    }
    return privateBio;
  }, [backendProfile, privateBio]);
  const resolvedPromptAnswers = useMemo(() => {
    if (!isDemoMode && backendProfile !== undefined) {
      return backendProfile?.promptAnswers || [];
    }
    return promptAnswers;
  }, [backendProfile, promptAnswers]);

  // Bucket prompt answers by section using the canonical prompt-id catalog.
  // Off-catalog / legacy promptIds are dropped from the on-screen sections so
  // we don't accidentally render them in the wrong bucket; they remain in the
  // underlying store and can still be edited via the dedicated screen.
  const SECTION1_IDS = useMemo(
    () => new Set<string>(PHASE2_SECTION1_PROMPTS.map((p) => p.id)),
    [],
  );
  const SECTION2_IDS = useMemo(
    () => new Set<string>(PHASE2_SECTION2_PROMPTS.map((p) => p.id)),
    [],
  );
  const SECTION3_IDS = useMemo(
    () => new Set<string>(PHASE2_SECTION3_PROMPTS.map((p) => p.id)),
    [],
  );

  const quickAnswers = useMemo(
    () =>
      (resolvedPromptAnswers as Phase2PromptAnswer[]).filter((a) =>
        SECTION1_IDS.has(a.promptId),
      ),
    [resolvedPromptAnswers, SECTION1_IDS],
  );
  const valueAnswers = useMemo(
    () =>
      (resolvedPromptAnswers as Phase2PromptAnswer[]).filter((a) =>
        SECTION2_IDS.has(a.promptId),
      ),
    [resolvedPromptAnswers, SECTION2_IDS],
  );
  const personalityAnswers = useMemo(
    () =>
      (resolvedPromptAnswers as Phase2PromptAnswer[]).filter((a) =>
        SECTION3_IDS.has(a.promptId),
      ),
    [resolvedPromptAnswers, SECTION3_IDS],
  );

  const handleEditPromptsSection = useCallback(
    (section: 'quick' | 'values' | 'personality') => {
      router.push({
        pathname: '/(main)/(private)/edit-prompts',
        params: { section },
      } as any);
    },
    [router],
  );

  // Photo URLs: Convex `privatePhotoUrls` is authoritative (same as Profile tab). While query is loading, fall back
  // to the store (often hydrated by Private layout). During a brief post-save window, prefer `pendingPhotoUrls`.
  const mergedPhotoUrls = useMemo(() => {
    if (isDemoMode) {
      return selectedPhotoUrls;
    }
    if (backendProfile === undefined) {
      return selectedPhotoUrls;
    }
    if (pendingPhotoUrls !== null) {
      return pendingPhotoUrls;
    }
    return (backendProfile?.privatePhotoUrls ?? []) as string[];
  }, [isDemoMode, backendProfile, selectedPhotoUrls, pendingPhotoUrls]);

  useEffect(() => {
    if (pendingPhotoUrls === null) return;
    if (backendProfile === undefined || backendProfile === null) return;
    const server = backendProfile.privatePhotoUrls ?? [];
    if (photoUrlListsEqual(server, pendingPhotoUrls)) {
      setPendingPhotoUrls(null);
    }
  }, [backendProfile, pendingPhotoUrls]);

  // Resolve display values from backend or store (backend takes priority)
  const displayName = useMemo(() => {
    if (!isDemoMode && backendProfile?.displayName) {
      return backendProfile.displayName;
    }
    return storeDisplayName || 'Anonymous';
  }, [backendProfile?.displayName, storeDisplayName]);

  const displayNameEditCount = useMemo(() => {
    if (isDemoMode) return 0;
    // Backward compatible: treat missing as 0
    const count = (backendProfile as any)?.displayNameEditCount;
    return typeof count === 'number' && Number.isFinite(count) ? count : 0;
  }, [backendProfile, isDemoMode]);
  const remainingDisplayNameChanges = Math.max(0, 3 - displayNameEditCount);
  const isDisplayNameLocked = remainingDisplayNameChanges <= 0;

  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [draftNickname, setDraftNickname] = useState('');
  const [nicknameError, setNicknameError] = useState<string | null>(null);

  const sanitizeNickname = useCallback((value: string) => value.replace(/[^a-zA-Z0-9]/g, ''), []);
  const isValidNickname = useCallback((value: string) => {
    const trimmed = value.trim();
    return trimmed.length >= 3 && trimmed.length <= 20 && /^[A-Za-z0-9]+$/.test(trimmed);
  }, []);

  useEffect(() => {
    // Keep draft in sync when not actively editing.
    if (!isEditingNickname) {
      setDraftNickname(displayName || '');
      setNicknameError(null);
    }
  }, [displayName, isEditingNickname]);

  // Backend is the only source of truth for age
  // Self-healing mutations will fix invalid ages (age=0)
  const age = useMemo(() => {
    if (isDemoMode) {
      return storeAge || 0;
    }
    return backendProfile?.age || 0;
  }, [isDemoMode, backendProfile?.age, storeAge]);

  const gender = useMemo(() => {
    if (!isDemoMode && backendProfile?.gender) {
      return backendProfile.gender;
    }
    return storeGender || '';
  }, [backendProfile?.gender, storeGender]);

  // Resolve details from backend or store (backend takes priority for prefill)
  const height = useMemo(() => {
    if (!isDemoMode && backendProfile?.height !== undefined) {
      return backendProfile.height;
    }
    if (storeHeight !== null) return storeHeight;
    const fallback = phase1User?.height;
    return fallback ?? null;
  }, [backendProfile?.height, storeHeight, phase1User?.height]);

  const weight = useMemo(() => {
    if (!isDemoMode && backendProfile?.weight !== undefined) {
      return backendProfile.weight;
    }
    if (storeWeight !== null) return storeWeight;
    const fallback = phase1User?.weight;
    return fallback ?? null;
  }, [backendProfile?.weight, storeWeight, phase1User?.weight]);

  const smoking = useMemo(() => {
    if (!isDemoMode && backendProfile?.smoking !== undefined) {
      return canonicalizeSmoking(backendProfile.smoking ?? null);
    }
    if (storeSmoking !== null) return storeSmoking;
    const fallback = phase1User?.smoking;
    return canonicalizeSmoking(fallback ?? null);
  }, [backendProfile?.smoking, storeSmoking, phase1User?.smoking]);

  const drinking = useMemo(() => {
    if (!isDemoMode && backendProfile?.drinking !== undefined) {
      return canonicalizeDrinking(backendProfile.drinking ?? null);
    }
    if (storeDrinking !== null) return storeDrinking;
    const fallback = phase1User?.drinking;
    return canonicalizeDrinking(fallback ?? null);
  }, [backendProfile?.drinking, storeDrinking, phase1User?.drinking]);

  const education = useMemo(() => {
    if (!isDemoMode && backendProfile?.education !== undefined) {
      return canonicalizeEducation(backendProfile.education ?? null);
    }
    if (storeEducation !== null) return storeEducation;
    const fallback = phase1User?.education;
    return canonicalizeEducation(fallback ?? null);
  }, [backendProfile?.education, storeEducation, phase1User?.education]);

  const religion = useMemo(() => {
    if (!isDemoMode && backendProfile?.religion !== undefined) {
      return canonicalizeReligion(backendProfile.religion ?? null);
    }
    if (storeReligion !== null) return storeReligion;
    const fallback = phase1User?.religion;
    return canonicalizeReligion(fallback ?? null);
  }, [backendProfile?.religion, storeReligion, phase1User?.religion]);

  const hobbies = useMemo(() => {
    if (!isDemoMode && backendProfile?.hobbies) {
      return backendProfile.hobbies;
    }
    return storeHobbies || [];
  }, [backendProfile?.hobbies, storeHobbies]);

  /** Same bar as Profile tab: at least one Phase-2 intent required for completion */
  const needsPhase2LookingForLink = useMemo(() => {
    if (isDemoMode) return false;
    if (backendProfile === undefined || backendProfile === null) return false;
    return (backendProfile.privateIntentKeys?.length ?? 0) < 1;
  }, [isDemoMode, backendProfile]);

  const handleOpenPhase2DiscoveryPreferences = useCallback(() => {
    router.push({
      pathname: '/(main)/discovery-preferences',
      params: { mode: 'phase2' },
    } as any);
  }, [router]);

  // Store actions
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setPhotoBlurSlots = usePrivateProfileStore((s) => s.setPhotoBlurSlots);
  const setPhotoBlurEnabled = usePrivateProfileStore((s) => s.setPhotoBlurEnabled);
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);
  const setHeight = usePrivateProfileStore((s) => s.setHeight);
  const setWeight = usePrivateProfileStore((s) => s.setWeight);
  const setSmoking = usePrivateProfileStore((s) => s.setSmoking);
  const setDrinking = usePrivateProfileStore((s) => s.setDrinking);
  const setEducation = usePrivateProfileStore((s) => s.setEducation);
  const setReligion = usePrivateProfileStore((s) => s.setReligion);
  const setHobbies = usePrivateProfileStore((s) => s.setHobbies);

  // Local state for editable details (synced from resolved values)
  const [localHeight, setLocalHeight] = useState<number | null>(null);
  const [localWeight, setLocalWeight] = useState<number | null>(null);
  const [localSmoking, setLocalSmoking] = useState<string | null>(null);
  const [localDrinking, setLocalDrinking] = useState<string | null>(null);
  const [localEducation, setLocalEducation] = useState<string | null>(null);
  const [localReligion, setLocalReligion] = useState<string | null>(null);
  const [localHobbies, setLocalHobbies] = useState<string[]>([]);
  const [detailsInitialized, setDetailsInitialized] = useState(false);

  // Sync local details state from resolved values (once on load)
  useEffect(() => {
    if (!detailsInitialized && (backendProfile !== undefined || isDemoMode)) {
      setLocalHeight(height ?? null);
      setLocalWeight(weight ?? null);
      setLocalSmoking(smoking);
      setLocalDrinking(drinking);
      setLocalEducation(education);
      setLocalReligion(religion);
      setLocalHobbies(hobbies || []);
      setDetailsInitialized(true);
    }
  }, [backendProfile, height, weight, smoking, drinking, education, religion, hobbies, detailsInitialized]);

  // Local state
  const [addingSlotIndex, setAddingSlotIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingDetails, setIsSyncingDetails] = useState(false);
  // NOTE: saveSuccess state removed - we now navigate back on success instead
  const [editingBio, setEditingBio] = useState(false);
  const [draftBio, setDraftBio] = useState(resolvedPrivateBio);
  const [missingPhotos, setMissingPhotos] = useState<Set<string>>(new Set());
  const [photoPreviewIndex, setPhotoPreviewIndex] = useState<number | null>(null);

  const handleSyncDetails = useCallback(() => {
    if (isDemoMode) return;
    if (!userId) return;
    if (isSyncingDetails) return;

    // Block sync while Phase-1 query is still loading; otherwise we'd be acting
    // on incomplete data and the post-sync feedback would be misleading.
    if (!isDemoMode && !!userId && currentUser === undefined) {
      Alert.alert(
        'Loading your main profile',
        'Please wait a moment for your main profile to load, then try syncing again.',
      );
      return;
    }

    Alert.alert(
      'Sync details from main profile?',
      "This will update your private profile details from your main profile. Your photos, nickname, bio, prompts, relationship intent, age, and gender will not change.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync',
          style: 'default',
          onPress: async () => {
            try {
              setIsSyncingDetails(true);
              if (!token) {
                throw new Error('Missing session token');
              }
              const res = await syncFromMainProfile({ token, authUserId: userId });
              if (!res?.success) {
                const err = (res as any)?.error;
                if (err === 'user_not_found') {
                  Alert.alert('Could not sync details', 'We could not find your main profile. Please try again.');
                } else if (err === 'profile_not_found') {
                  Alert.alert('Could not sync details', 'We could not find your private profile. Please try again.');
                } else {
                  Alert.alert('Could not sync details', 'Please try again.');
                }
                return;
              }

              const applied = (res as any).appliedFields ?? {};
              const snapshot = (res as any).phase1Snapshot ?? {};
              const availableInPhase1 = Boolean((res as any).availableInPhase1);

              if (!availableInPhase1) {
                Alert.alert(
                  'Nothing to sync yet',
                  'No details found in your main profile yet. Add details in your main profile first, then sync again.',
                );
                return;
              }

              // Only touch fields the backend confirms it applied; leave everything
              // else untouched so we don't visually clear locally-edited values that
              // Phase-1 doesn't know about.
              let appliedCount = 0;
              if (applied.height) {
                const next = (snapshot.height as number | undefined) ?? null;
                setLocalHeight(next);
                setHeight(next);
                appliedCount++;
              }
              if (applied.weight) {
                const next = (snapshot.weight as number | undefined) ?? null;
                setLocalWeight(next);
                setWeight(next);
                appliedCount++;
              }
              if (applied.smoking) {
                const next = canonicalizeSmoking((snapshot.smoking as string | undefined) ?? null);
                setLocalSmoking(next);
                setSmoking(next);
                appliedCount++;
              }
              if (applied.drinking) {
                const next = canonicalizeDrinking((snapshot.drinking as string | undefined) ?? null);
                setLocalDrinking(next);
                setDrinking(next);
                appliedCount++;
              }
              if (applied.education) {
                const next = canonicalizeEducation((snapshot.education as string | undefined) ?? null);
                setLocalEducation(next);
                setEducation(next);
                appliedCount++;
              }
              if (applied.religion) {
                const next = canonicalizeReligion((snapshot.religion as string | undefined) ?? null);
                setLocalReligion(next);
                setReligion(next);
                appliedCount++;
              }
              if (applied.hobbies) {
                const next = (snapshot.hobbies as string[] | undefined) ?? [];
                setLocalHobbies(next);
                setHobbies(next);
                appliedCount++;
              }

              setDetailsInitialized(true);
              const fieldWord = appliedCount === 1 ? 'field' : 'fields';
              Alert.alert('Synced', `Synced ${appliedCount} ${fieldWord} from your main profile.`);
            } catch {
              Alert.alert('Could not sync details', 'Please try again.');
            } finally {
              setIsSyncingDetails(false);
            }
          },
        },
      ]
    );
  }, [
    isDemoMode,
    userId,
    token,
    isSyncingDetails,
    currentUser,
    syncFromMainProfile,
    setHeight,
    setWeight,
    setSmoking,
    setDrinking,
    setEducation,
    setReligion,
    setHobbies,
  ]);

  // Track mount state
  const mountedRef = useRef(true);
  const lastCheckedRef = useRef<string>('');
  const [didFirstPaint, setDidFirstPaint] = useState(false);
  const [renderAllPhotos, setRenderAllPhotos] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mark after-first-paint to avoid heavy visual work on initial render (e.g., blur).
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (mountedRef.current) setDidFirstPaint(true);
      });
    });
  }, []);

  // PERF: Defer non-critical work (like extra images) until after interactions settle.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (mountedRef.current) {
        setRenderAllPhotos(true);
      }
    });
    return () => task.cancel();
  }, []);

  // Sync draft bio with store
  useEffect(() => {
    if (!editingBio) {
      setDraftBio(resolvedPrivateBio);
    }
  }, [resolvedPrivateBio, editingBio]);

  // Check for missing photos
  const checkPhotosExist = useCallback(async () => {
    const photos = Array.isArray(mergedPhotoUrls) ? mergedPhotoUrls : [];
    const photosKey = photos.join('|');
    if (photosKey === lastCheckedRef.current) return;
    lastCheckedRef.current = photosKey;

    const fileUris = photos.filter(
      (uri) => uri.startsWith('file://') && !uri.includes('/cache/')
    );

    if (fileUris.length === 0) {
      if (mountedRef.current) setMissingPhotos(new Set());
      return;
    }

    const missing = new Set<string>();
    for (const uri of fileUris) {
      try {
        const file = new ExpoFile(uri);
        if (!file.exists) missing.add(uri);
      } catch {
        missing.add(uri);
      }
    }

    if (mountedRef.current) setMissingPhotos(missing);
  }, [mergedPhotoUrls]);

  useEffect(() => {
    // Defer filesystem existence checks to avoid blocking first paint.
    const task = InteractionManager.runAfterInteractions(() => {
      void checkPhotosExist();
    });
    return () => task.cancel();
  }, [checkPhotosExist]);

  const persistProfileUpdate = useCallback(
    async (
      updates: PersistedProfileUpdates,
      {
        onSuccess,
        onFailure,
        failureMessage,
      }: {
        onSuccess?: () => void;
        onFailure?: () => void;
        failureMessage: string;
      }
    ) => {
      try {
        if (!isDemoMode) {
          if (!userId || !token) {
            throw new Error('Please sign in to save changes.');
          }

          // Strip null / undefined values from the update payload.
          // The Convex schema for userPrivateProfiles defines these
          // optional fields as v.optional(v.<type>) — null is NOT an
          // accepted value. Sending `height: null` (or any other
          // explicit null) triggers a validator error and clobbers
          // the field on the server. By skipping nulls here we both
          // satisfy the schema and preserve any previously stored
          // value for the user.
          const sanitizedUpdates: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === undefined) continue;
            sanitizedUpdates[key] = value;
          }

          await updatePrivateProfile({
            token,
            authUserId: userId,
            ...sanitizedUpdates,
          });
        }

        onSuccess?.();
        return true;
      } catch (error) {
        if (__DEV__) {
          console.error('[EditProfile] Save failed:', error);
        }
        onFailure?.();
        Alert.alert('Error', failureMessage);
        return false;
      }
    },
    [isDemoMode, token, updatePrivateProfile, userId]
  );

  const persistPhotoBlurSettings = useCallback(
    async (
      updates: { photoBlurSlots?: boolean[]; photoBlurEnabled?: boolean },
      {
        onSuccess,
        onFailure,
        failureMessage,
      }: {
        onSuccess?: () => void;
        onFailure?: () => void;
        failureMessage: string;
      }
    ) => {
      try {
        if (updates.photoBlurSlots === undefined && updates.photoBlurEnabled === undefined) {
          return false;
        }
        if (!isDemoMode) {
          if (!userId || !token) {
            throw new Error('Please sign in to save changes.');
          }

          await updatePhotoBlurSlots({
            authUserId: userId,
            ...updates,
          });
        }

        onSuccess?.();
        return true;
      } catch (error) {
        if (__DEV__) {
          console.error('[EditProfile] Photo blur save failed:', error);
        }
        onFailure?.();
        Alert.alert('Error', failureMessage);
        return false;
      }
    },
    [isDemoMode, updatePhotoBlurSlots, userId]
  );

  // Valid photos
  const validPhotos = useMemo(() => {
    const photos = Array.isArray(mergedPhotoUrls) ? mergedPhotoUrls : [];
    return photos.filter((url) => isValidPhotoUrl(url) && !missingPhotos.has(url));
  }, [mergedPhotoUrls, missingPhotos]);

  // Create 9-slot array
  const photoSlots = useMemo(() => {
    const slots: (string | null)[] = Array(9).fill(null);
    validPhotos.forEach((url, idx) => {
      if (idx < 9) slots[idx] = url;
    });
    return slots;
  }, [validPhotos]);

  // Add photo
  const handleAddPhoto = async (slotIndex: number) => {
    if (addingSlotIndex !== null) return;
    setAddingSlotIndex(slotIndex);

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library access.');
        if (mountedRef.current) setAddingSlotIndex(null);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.length) {
        if (mountedRef.current) setAddingSlotIndex(null);
        return;
      }

      const asset = result.assets[0];
      let backendUrl: string | null = null;
      let uploadedStorageId: Id<'_storage'> | null = null;

      if (!isDemoMode && userId && token) {
        try {
          const storageId = await uploadPhotoToConvex(asset.uri, () => generateUploadUrl({ token }));
          uploadedStorageId = storageId;
          await trackPendingUpload({ userId, storageId });
          const permanentUrl = await getStorageUrl({ storageId });
          if (!permanentUrl) throw new Error('Failed to get URL');
          backendUrl = permanentUrl;
        } catch (error) {
          if (__DEV__) {
            console.error('[EditProfile] Photo upload failed:', error);
          }
          throw new Error('Failed to upload photo.');
        }
      } else {
        backendUrl = await copyToPermamentStorage(asset.uri, Date.now());
      }

      if (!mountedRef.current) return;

      if (backendUrl) {
        const currentPhotos = mergedPhotoUrls.filter(isValidPhotoUrl);
        const newPhotos = [...currentPhotos];

        if (slotIndex >= newPhotos.length) {
          newPhotos.push(backendUrl);
        } else {
          newPhotos[slotIndex] = backendUrl;
        }

        const finalPhotos = newPhotos.slice(0, MAX_PHOTOS);
        const saved = await persistProfileUpdate(
          { privatePhotoUrls: finalPhotos },
          {
            onSuccess: () => {
              setPendingPhotoUrls(finalPhotos);
              setSelectedPhotos([], finalPhotos);
            },
            failureMessage: 'Failed to add photo. Please try again.',
          }
        );

        if (!saved) {
          if (uploadedStorageId && userId) {
            try {
              await cleanupPendingUpload({ userId, storageId: uploadedStorageId });
            } catch {
              // Best-effort cleanup only.
            }
          }
          return;
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to add photo.');
    } finally {
      if (mountedRef.current) setAddingSlotIndex(null);
    }
  };

  const handleOpenPhotoPreview = useCallback(
    (slotIndex: number) => {
      const uri = photoSlots[slotIndex];
      if (!uri) return;
      setPhotoPreviewIndex(slotIndex);
    },
    [photoSlots]
  );

  const handleClosePhotoPreview = useCallback(() => {
    setPhotoPreviewIndex(null);
  }, []);

  // Remove photo
  const handleRemovePhoto = async (index: number) => {
    const currentPhotos = mergedPhotoUrls.filter(isValidPhotoUrl);
    if (index < 0 || index >= currentPhotos.length) return;

    const removedUrl = currentPhotos[index];
    const newPhotos = currentPhotos.filter((_, i) => i !== index);
    const nextBlurSlots = [...photoBlurSlots.filter((_, i) => i !== index), false].slice(0, 9);
    const saved = await persistProfileUpdate(
      {
        privatePhotoUrls: newPhotos,
        photoBlurSlots: nextBlurSlots,
      },
      {
        onSuccess: () => {
          setPendingPhotoUrls(newPhotos);
          setSelectedPhotos([], newPhotos);
          setPhotoBlurSlots(nextBlurSlots);

          if (removedUrl.includes(PRIVATE_PHOTOS_DIR_NAME) && !removedUrl.startsWith('http')) {
            try {
              const file = new ExpoFile(removedUrl);
              if (file.exists) file.delete();
            } catch (error) {
              if (__DEV__) {
                console.error('[EditProfile] Local photo cleanup failed:', error);
              }
            }
          }
        },
        failureMessage: 'Failed to remove photo. Please try again.',
      }
    );

    if (!saved) {
      return;
    }
  };

  // Set main photo (move selected photo to index 0)
  const handleSetMainPhoto = async (fromIndex: number) => {
    if (fromIndex === 0) return; // Already main

    const currentPhotos = mergedPhotoUrls.filter(isValidPhotoUrl);
    if (fromIndex < 0 || fromIndex >= currentPhotos.length) return;

    // Swap: move selected photo to index 0, shift others down
    const newPhotos = [...currentPhotos];
    const selectedPhoto = newPhotos[fromIndex];
    newPhotos.splice(fromIndex, 1); // Remove from current position
    newPhotos.unshift(selectedPhoto); // Add to beginning
    const nextBlurSlots = [...photoBlurSlots];
    const selectedBlur = nextBlurSlots[fromIndex] ?? false;
    nextBlurSlots.splice(fromIndex, 1);
    nextBlurSlots.unshift(selectedBlur);

    const saved = await persistProfileUpdate(
      {
        privatePhotoUrls: newPhotos,
        photoBlurSlots: nextBlurSlots,
      },
      {
        onSuccess: () => {
          setPendingPhotoUrls(newPhotos);
          setSelectedPhotos([], newPhotos);
          setPhotoBlurSlots(nextBlurSlots);
          if (__DEV__) {
            console.log('[P2_EditProfile] ✅ Main photo persisted');
          }
        },
        failureMessage: 'Failed to set main photo. Please try again.',
      }
    );

    if (!saved && __DEV__) {
      console.error('[P2_EditProfile] ❌ Failed to persist main photo');
    }
  };

  // Toggle photo blur
  const handleTogglePhotoBlur = async (slotIndex: number) => {
    const prevSlots = [...photoBlurSlots];
    const newSlots = [...photoBlurSlots];
    newSlots[slotIndex] = !newSlots[slotIndex];

    // Optimistic UI: update immediately, backend sync in background.
    setPhotoBlurSlots(newSlots);

    void persistPhotoBlurSettings(
      { photoBlurSlots: newSlots },
      {
        onFailure: () => {
          // Roll back optimistic update on failure
          setPhotoBlurSlots(prevSlots);
        },
        failureMessage: 'Failed to update photo blur. Please try again.',
      }
    );
  };

  // Save bio
  const saveBio = async () => {
    const trimmedBio = draftBio.trim();
    const saved = await persistProfileUpdate(
      { privateBio: trimmedBio },
      {
        onSuccess: () => {
          setPrivateBio(trimmedBio);
          setEditingBio(false);
          Keyboard.dismiss();
        },
        failureMessage: 'Failed to save your bio. Please try again.',
      }
    );

    if (!saved) {
      return;
    }
  };

  // Save field to backend
  const saveField = useCallback(
    async (
      updates: PersistedProfileUpdates,
      {
        onSuccess,
        onFailure,
        failureMessage,
      }: {
        onSuccess?: () => void;
        onFailure?: () => void;
        failureMessage: string;
      }
    ) => {
      return await persistProfileUpdate(updates, { onSuccess, onFailure, failureMessage });
    },
    [persistProfileUpdate]
  );

  // Save ALL changes at once
  const handleSaveAll = async () => {
    if (isSaving) return;

    setIsSaving(true);
    Keyboard.dismiss();

    void (async () => {
      const nextBio = editingBio ? draftBio.trim() : resolvedPrivateBio;

      try {
        if (!isDemoMode) {
          if (!userId || !token) {
            throw new Error('Please sign in to save changes.');
          }

          // Single backend write: merge profile fields + blur settings.
          // Null-valued local state (e.g. user never entered a height) is
          // stripped centrally in persistProfileUpdate; this call site
          // intentionally passes raw locals so that updating one field to
          // a real value doesn't accidentally clear the others.
          const mergedUpdates: Record<string, unknown> = {
            privateBio: nextBio,
            photoBlurSlots,
            photoBlurEnabled,
          };
          if (typeof localHeight === 'number' && localHeight > 0) mergedUpdates.height = localHeight;
          if (typeof localWeight === 'number' && localWeight > 0) mergedUpdates.weight = localWeight;
          if (localSmoking) mergedUpdates.smoking = localSmoking;
          if (localDrinking) mergedUpdates.drinking = localDrinking;
          if (localEducation) mergedUpdates.education = localEducation;
          if (localReligion) mergedUpdates.religion = localReligion;

          await updatePrivateProfile({
            token,
            authUserId: userId,
            ...mergedUpdates,
          });
        }

        setHeight(localHeight);
        setWeight(localWeight);
        setSmoking(localSmoking);
        setDrinking(localDrinking);
        setEducation(localEducation);
        setReligion(localReligion);
        if (editingBio || nextBio !== resolvedPrivateBio) {
          setPrivateBio(nextBio);
          setEditingBio(false);
        }

        router.back();
      } catch (error) {
        if (__DEV__) {
          console.error('[EditProfile] Save failed:', error);
        }
        Alert.alert('Error', 'Failed to save changes. Please try again.');
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    })();
  };

  // Go back
  const handleBack = () => {
    router.back();
  };

  if (isSignedOut) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingState}>
          <Ionicons name="person-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.loadingStateTitle}>Sign in required</Text>
          <Text style={styles.loadingStateText}>Please sign in again to edit your private profile.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isBackendLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingStateText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isMissingBackendProfile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingState}>
          <Ionicons name="person-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.loadingStateTitle}>Private profile unavailable</Text>
          <Text style={styles.loadingStateText}>
            We couldn&apos;t load your saved private profile. Return to your profile tab and try again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Modal
        visible={photoPreviewIndex !== null}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleClosePhotoPreview}
      >
        <View style={styles.previewFullScreen}>
          {/* Photo Container */}
          <View style={styles.previewImageContainer}>
            <Image
              source={{ uri: photoPreviewIndex !== null ? (photoSlots[photoPreviewIndex] as string) : '' }}
              style={styles.previewImage}
              contentFit="contain"
              transition={200}
            />
          </View>

          {/* Floating Action Buttons - Phase-1 style */}
          <View style={[styles.previewButtonsRow, { paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
            {/* Delete */}
            <TouchableOpacity
              style={styles.previewFloatingButton}
              onPress={async () => {
                if (photoPreviewIndex === null) return;
                const idx = photoPreviewIndex;
                handleClosePhotoPreview();
                await handleRemovePhoto(idx);
              }}
              activeOpacity={0.8}
            >
              <View style={[styles.previewButtonCircle, styles.previewButtonDanger]}>
                <Ionicons name="trash-outline" size={26} color="#FFFFFF" />
              </View>
              <Text style={[styles.previewButtonLabel, styles.previewButtonLabelDanger]}>Delete</Text>
            </TouchableOpacity>

            {/* Replace */}
            <TouchableOpacity
              style={styles.previewFloatingButton}
              onPress={async () => {
                if (photoPreviewIndex === null) return;
                const idx = photoPreviewIndex;
                handleClosePhotoPreview();
                await handleAddPhoto(idx);
              }}
              activeOpacity={0.8}
            >
              <View style={styles.previewButtonCircle}>
                <Ionicons name="refresh-outline" size={26} color="#FFFFFF" />
              </View>
              <Text style={styles.previewButtonLabel}>Replace</Text>
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity
              style={styles.previewFloatingButton}
              onPress={handleClosePhotoPreview}
              activeOpacity={0.8}
            >
              <View style={styles.previewButtonCircle}>
                <Ionicons name="close" size={26} color="#FFFFFF" />
              </View>
              <Text style={styles.previewButtonLabel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 1: BASIC INFO */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Basic Info</Text>
              <View style={styles.lockedBadge}>
                <Ionicons name="lock-closed" size={12} color={C.textLight} />
                <Text style={styles.lockedText}>Locked</Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Nickname</Text>
                <View style={styles.lockedValueRow}>
                  {isEditingNickname ? (
                    <TextInput
                      style={[styles.nicknameInput, isDisplayNameLocked && styles.nicknameInputDisabled]}
                      value={draftNickname}
                      onChangeText={(t) => {
                        setDraftNickname(sanitizeNickname(t));
                        if (nicknameError) setNicknameError(null);
                      }}
                      editable={!isDisplayNameLocked}
                      placeholder="e.g. Mira123"
                      placeholderTextColor={C.textLight}
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={20}
                      returnKeyType="done"
                      onSubmitEditing={async () => {
                        // Trigger save via the same handler as the Save button
                        // (no auto-save on keystroke)
                        if (!userId || isDemoMode || isDisplayNameLocked) return;
                        const next = draftNickname.trim();
                        if (!isValidNickname(next)) {
                          setNicknameError('Nickname must be 3–20 characters and use letters and numbers only.');
                          return;
                        }
                        if (next === (displayName || '').trim()) {
                          setIsEditingNickname(false);
                          return;
                        }
                        try {
                          if (!token) {
                            throw new Error('Missing session token');
                          }
                          const res = await updateDisplayName({ token, authUserId: userId, displayName: next });
                          if (!res?.success) {
                            if ((res as any)?.error === 'Nickname change limit reached') {
                              setNicknameError('Nickname is now locked.');
                            } else if ((res as any)?.error === 'INVALID_DISPLAY_NAME') {
                              setNicknameError('Nickname must use letters and numbers only.');
                            } else {
                              setNicknameError('Could not update nickname. Please try again.');
                            }
                            return;
                          }
                          // Close editor; backendProfile will refresh via query.
                          setIsEditingNickname(false);
                        } catch {
                          setNicknameError('Could not update nickname. Please try again.');
                        }
                      }}
                    />
                  ) : (
                    <Text style={styles.infoValue}>{displayName || 'Anonymous'}</Text>
                  )}
                </View>
              </View>
              <View style={styles.nicknameMetaRow}>
                <Text style={styles.nicknameMetaText}>
                  {isDisplayNameLocked
                    ? 'Nickname is now locked'
                    : `${remainingDisplayNameChanges} ${remainingDisplayNameChanges === 1 ? 'change' : 'changes'} remaining`}
                </Text>
                {!isEditingNickname ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (isDisplayNameLocked) return;
                      setIsEditingNickname(true);
                    }}
                    disabled={isDisplayNameLocked}
                    activeOpacity={0.7}
                    style={[styles.nicknameEditBtn, isDisplayNameLocked && styles.nicknameEditBtnDisabled]}
                  >
                    <Text style={styles.nicknameEditBtnText}>Edit</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.nicknameEditActions}>
                    <TouchableOpacity
                      onPress={() => {
                        setIsEditingNickname(false);
                        setDraftNickname(displayName || '');
                        setNicknameError(null);
                      }}
                      activeOpacity={0.7}
                      style={styles.nicknameActionBtn}
                    >
                      <Text style={styles.nicknameActionText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={async () => {
                        if (!userId || isDemoMode || isDisplayNameLocked) return;
                        const next = draftNickname.trim();
                        if (!isValidNickname(next)) {
                          setNicknameError('Nickname must be 3–20 characters and use letters and numbers only.');
                          return;
                        }
                        if (next === (displayName || '').trim()) {
                          setIsEditingNickname(false);
                          return;
                        }
                        try {
                          if (!token) {
                            throw new Error('Missing session token');
                          }
                          const res = await updateDisplayName({ token, authUserId: userId, displayName: next });
                          if (!res?.success) {
                            if ((res as any)?.error === 'Nickname change limit reached') {
                              setNicknameError('Nickname is now locked.');
                            } else if ((res as any)?.error === 'INVALID_DISPLAY_NAME') {
                              setNicknameError('Nickname must use letters and numbers only.');
                            } else {
                              setNicknameError('Could not update nickname. Please try again.');
                            }
                            return;
                          }
                          setIsEditingNickname(false);
                        } catch {
                          setNicknameError('Could not update nickname. Please try again.');
                        }
                      }}
                      activeOpacity={0.7}
                      style={styles.nicknameActionBtnPrimary}
                    >
                      <Text style={styles.nicknameActionTextPrimary}>Save</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              {nicknameError ? (
                <Text style={styles.nicknameErrorText}>{nicknameError}</Text>
              ) : null}

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Age</Text>
                <View style={styles.lockedValueRow}>
                  <Text style={styles.infoValue}>{age > 0 ? age : '—'}</Text>
                </View>
              </View>

              <View style={[styles.infoRow, { marginBottom: 0 }]}>
                <Text style={styles.infoLabel}>Gender</Text>
                <View style={styles.lockedValueRow}>
                  <Text style={styles.infoValue}>
                    {GENDER_OPTIONS.find((opt) => opt.value === gender)?.label || '—'}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.lockedHint}>
              These details are set during profile creation and cannot be changed here.
            </Text>
          </View>

          {/* Deep Connect intents: edited on discovery-preferences (Phase-2), not here */}
          {needsPhase2LookingForLink ? (
            <TouchableOpacity
              style={styles.lookingForLink}
              onPress={handleOpenPhase2DiscoveryPreferences}
              activeOpacity={0.7}
            >
              <Ionicons name="compass-outline" size={22} color={C.text} />
              <View style={styles.lookingForLinkText}>
                <Text style={styles.lookingForLinkTitle}>Looking for (Deep Connect)</Text>
                <Text style={styles.lookingForLinkSubtitle}>
                  Tap to choose what you&apos;re looking for
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={C.textLight} />
            </TouchableOpacity>
          ) : null}

          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 2: PHOTOS */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Photos</Text>
              <Text style={styles.sectionCount}>{validPhotos.length}/9</Text>
            </View>

            <View style={styles.photoGrid}>
              {photoSlots.map((uri, slotIndex) => {
                const hasPhoto = !!uri;
                const isMain = slotIndex === 0 && hasPhoto;
                const isThisSlotLoading = addingSlotIndex === slotIndex;

                if (hasPhoto) {
                  const shouldRenderImage = renderAllPhotos || slotIndex < 2;
                  const isSlotBlurred = Boolean(photoBlurSlots[slotIndex]);
                  return (
                    <PhotoSlotItem
                      key={`slot-${slotIndex}`}
                      slotIndex={slotIndex}
                      uri={uri}
                      isMain={isMain}
                      isThisSlotLoading={isThisSlotLoading}
                      photoBlurEnabled={photoBlurEnabled}
                      isSlotBlurred={isSlotBlurred}
                      shouldRenderImage={shouldRenderImage}
                      didFirstPaint={didFirstPaint}
                      onOpenPreview={handleOpenPhotoPreview}
                      onSetMain={handleSetMainPhoto}
                      onToggleBlur={handleTogglePhotoBlur}
                    />
                  );
                }

                return (
                  <TouchableOpacity
                    key={`slot-${slotIndex}`}
                    style={[styles.addSlot, isThisSlotLoading && styles.addSlotDisabled]}
                    onPress={() => handleAddPhoto(slotIndex)}
                    disabled={addingSlotIndex !== null}
                  >
                    {isThisSlotLoading ? (
                      <ActivityIndicator size="small" color={C.primary} />
                    ) : (
                      <>
                        <Ionicons name="add" size={28} color={C.primary} />
                        <Text style={styles.addSlotText}>Add</Text>
                      </>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.photoHint}>First photo is your main photo</Text>
          </View>

          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 3: PHOTO BLUR SETTINGS */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photo Blur</Text>

            <View style={styles.visibilityCard}>
              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => {
                  const nextEnabled = !photoBlurEnabled;

                  // Optimistic UI first
                  if (nextEnabled) {
                    setPhotoBlurEnabled(true);
                    void persistPhotoBlurSettings(
                      { photoBlurEnabled: true },
                      {
                        onFailure: () => setPhotoBlurEnabled(false),
                        failureMessage: 'Failed to update photo blur. Please try again.',
                      }
                    );
                    return;
                  }

                  const prevSlots = [...photoBlurSlots];
                  const cleared = Array.from({ length: 9 }, () => false);
                  setPhotoBlurEnabled(false);
                  setPhotoBlurSlots(cleared);
                  void persistPhotoBlurSettings(
                    { photoBlurEnabled: false, photoBlurSlots: cleared },
                    {
                      onFailure: () => {
                        setPhotoBlurEnabled(true);
                        setPhotoBlurSlots(prevSlots);
                      },
                      failureMessage: 'Failed to update photo blur. Please try again.',
                    }
                  );
                }}
                activeOpacity={0.7}
              >
                <View style={styles.toggleInfo}>
                  <Ionicons
                    name="eye-off-outline"
                    size={22}
                    color={photoBlurEnabled ? C.primary : C.textLight}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Enable photo blur</Text>
                    <Text style={styles.toggleHint}>
                      {photoBlurEnabled
                        ? 'Tap the eye on each photo to blur or show it in Deep Connect.'
                        : 'Turn on to choose which photos are blurred for others.'}
                    </Text>
                  </View>
                </View>
                <View style={[styles.toggle, photoBlurEnabled && styles.toggleActive]}>
                  <View style={[styles.toggleKnob, photoBlurEnabled && styles.toggleKnobActive]} />
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.blurExplainer}>
              <View style={styles.blurExplainerRow}>
                <View style={[styles.blurExplainerIcon, styles.blurExplainerIconBlurred]}>
                  <Ionicons name="eye-off" size={12} color="#FFFFFF" />
                </View>
                <Text style={styles.blurExplainerText}>Blurred photos appear hidden in Deep Connect</Text>
              </View>
              <View style={styles.blurExplainerRow}>
                <View style={styles.blurExplainerIcon}>
                  <Ionicons name="eye" size={12} color="#FFFFFF" />
                </View>
                <Text style={styles.blurExplainerText}>Visible photos appear normally</Text>
              </View>
            </View>
          </View>

          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 4: BIO */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Bio</Text>
              {!editingBio && (
                <TouchableOpacity onPress={() => setEditingBio(true)}>
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            {editingBio ? (
              <View style={styles.bioEditCard}>
                <TextInput
                  style={styles.bioInput}
                  value={draftBio}
                  onChangeText={setDraftBio}
                  placeholder="Share what you're looking for..."
                  placeholderTextColor={C.textLight}
                  multiline
                  maxLength={300}
                  autoFocus
                />
                <Text style={styles.charCount}>{draftBio.length}/300</Text>
                <View style={styles.bioActions}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => {
                      setEditingBio(false);
                      setDraftBio(resolvedPrivateBio);
                    }}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={saveBio}>
                    <Text style={styles.saveBtnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.bioCard}>
                {resolvedPrivateBio && resolvedPrivateBio.trim().length > 0 ? (
                  <Text style={styles.bioText}>{resolvedPrivateBio}</Text>
                ) : (
                  <Text style={styles.bioEmpty}>Share what you're looking for...</Text>
                )}
              </View>
            )}
          </View>

          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 5a: QUICK ANSWERS (Section 1 — option only, no Q text) */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Quick Answers</Text>
              <TouchableOpacity
                onPress={() => handleEditPromptsSection('quick')}
                accessibilityRole="button"
                accessibilityLabel="Edit quick answers"
                style={styles.promptEditPill}
                activeOpacity={0.7}
              >
                <Ionicons name="pencil" size={12} color={C.primary} />
                <Text style={styles.promptEditPillText}>
                  {quickAnswers.length > 0 ? 'Edit' : 'Add'}
                </Text>
              </TouchableOpacity>
            </View>

            {quickAnswers.length > 0 ? (
              <View style={styles.quickChipRow}>
                {quickAnswers.map((prompt, idx) => (
                  <View key={prompt.promptId || idx} style={styles.quickChip}>
                    <Text style={styles.quickChipText} numberOfLines={2}>
                      {prompt.answer}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.bioCard}>
                <Text style={styles.bioEmpty}>
                  Pick a few quick answers so matches see your vibe at a glance.
                </Text>
              </View>
            )}
          </View>

          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 5b: YOUR VALUES (Section 2 — Q + A) */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your Values</Text>
              <TouchableOpacity
                onPress={() => handleEditPromptsSection('values')}
                accessibilityRole="button"
                accessibilityLabel="Edit your values"
                style={styles.promptEditPill}
                activeOpacity={0.7}
              >
                <Ionicons name="pencil" size={12} color={C.primary} />
                <Text style={styles.promptEditPillText}>
                  {valueAnswers.length > 0 ? 'Edit' : 'Add'}
                </Text>
              </TouchableOpacity>
            </View>

            {valueAnswers.length > 0 ? (
              <View style={styles.promptsContainer}>
                {valueAnswers.map((prompt, idx) => (
                  <View key={prompt.promptId || idx} style={styles.promptCard}>
                    <Text style={styles.promptQuestion} numberOfLines={2}>
                      {prompt.question}
                    </Text>
                    <Text style={styles.promptAnswer} numberOfLines={4}>
                      {prompt.answer}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.bioCard}>
                <Text style={styles.bioEmpty}>
                  Share what you value most so people can find common ground.
                </Text>
              </View>
            )}
          </View>

          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 5c: YOUR PERSONALITY (Section 3 — Q + A) */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your Personality</Text>
              <TouchableOpacity
                onPress={() => handleEditPromptsSection('personality')}
                accessibilityRole="button"
                accessibilityLabel="Edit your personality"
                style={styles.promptEditPill}
                activeOpacity={0.7}
              >
                <Ionicons name="pencil" size={12} color={C.primary} />
                <Text style={styles.promptEditPillText}>
                  {personalityAnswers.length > 0 ? 'Edit' : 'Add'}
                </Text>
              </TouchableOpacity>
            </View>

            {personalityAnswers.length > 0 ? (
              <View style={styles.promptsContainer}>
                {personalityAnswers.map((prompt, idx) => (
                  <View key={prompt.promptId || idx} style={styles.promptCard}>
                    <Text style={styles.promptQuestion} numberOfLines={2}>
                      {prompt.question}
                    </Text>
                    <Text style={styles.promptAnswer} numberOfLines={4}>
                      {prompt.answer}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.bioCard}>
                <Text style={styles.bioEmpty}>
                  Tell people what makes you, you — a few lines is plenty.
                </Text>
              </View>
            )}
          </View>

          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 6: DETAILS */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Details</Text>
                <Text style={styles.detailsHelperText}>From your main profile</Text>
              </View>
              <TouchableOpacity
                onPress={handleSyncDetails}
                disabled={isDemoMode || isSyncingDetails}
                activeOpacity={0.7}
                style={[styles.syncDetailsBtn, (isDemoMode || isSyncingDetails) && styles.syncDetailsBtnDisabled]}
              >
                {isSyncingDetails ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <Text style={styles.syncDetailsBtnText}>Sync details from main profile</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Height */}
            <View style={styles.detailRow}>
              <View style={styles.detailLabelRow}>
                <Text style={styles.detailLabel}>Height (cm)</Text>
                {localHeight && (
                  <Text style={styles.heightPreview}>{cmToFeetInches(localHeight)}</Text>
                )}
              </View>
              <View style={styles.detailInputRow}>
                <TextInput
                  style={styles.detailInput}
                  value={localHeight ? String(localHeight) : ''}
                  onChangeText={(val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num) && num > 0 && num < 300) {
                      setLocalHeight(num);
                    } else if (val === '') {
                      setLocalHeight(null);
                    }
                  }}
                  onBlur={() => {
                    const previousHeight = height ?? null;
                    void saveField(
                      { height: localHeight },
                      {
                        onSuccess: () => setHeight(localHeight),
                        onFailure: () => setLocalHeight(previousHeight),
                        failureMessage: 'Failed to save height. Please try again.',
                      }
                    );
                  }}
                  keyboardType="number-pad"
                  placeholder="cm"
                  placeholderTextColor={C.textLight}
                  maxLength={3}
                />
              </View>
            </View>

            {/* Weight */}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Weight (kg)</Text>
              <View style={styles.detailInputRow}>
                <TextInput
                  style={styles.detailInput}
                  value={localWeight ? String(localWeight) : ''}
                  onChangeText={(val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num) && num > 0 && num < 500) {
                      setLocalWeight(num);
                    } else if (val === '') {
                      setLocalWeight(null);
                    }
                  }}
                  onBlur={() => {
                    const previousWeight = weight ?? null;
                    void saveField(
                      { weight: localWeight },
                      {
                        onSuccess: () => setWeight(localWeight),
                        onFailure: () => setLocalWeight(previousWeight),
                        failureMessage: 'Failed to save weight. Please try again.',
                      }
                    );
                  }}
                  keyboardType="number-pad"
                  placeholder="kg"
                  placeholderTextColor={C.textLight}
                  maxLength={3}
                />
              </View>
            </View>

            {/* Smoking */}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Smoking</Text>
              <View style={styles.chipRow}>
                {SMOKING_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, localSmoking === opt.value && styles.chipSelected]}
                    onPress={async () => {
                      const previousSmoking = localSmoking;
                      setLocalSmoking(opt.value);
                      await saveField(
                        { smoking: opt.value },
                        {
                          onSuccess: () => setSmoking(opt.value),
                          onFailure: () => setLocalSmoking(previousSmoking),
                          failureMessage: 'Failed to save smoking preference. Please try again.',
                        }
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, localSmoking === opt.value && styles.chipTextSelected]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Drinking */}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Drinking</Text>
              <View style={styles.chipRow}>
                {DRINKING_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, localDrinking === opt.value && styles.chipSelected]}
                    onPress={async () => {
                      const previousDrinking = localDrinking;
                      setLocalDrinking(opt.value);
                      await saveField(
                        { drinking: opt.value },
                        {
                          onSuccess: () => setDrinking(opt.value),
                          onFailure: () => setLocalDrinking(previousDrinking),
                          failureMessage: 'Failed to save drinking preference. Please try again.',
                        }
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, localDrinking === opt.value && styles.chipTextSelected]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Education */}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Education</Text>
              <View style={styles.chipRow}>
                {EDUCATION_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, localEducation === opt.value && styles.chipSelected]}
                    onPress={async () => {
                      const previousEducation = localEducation;
                      setLocalEducation(opt.value);
                      await saveField(
                        { education: opt.value },
                        {
                          onSuccess: () => setEducation(opt.value),
                          onFailure: () => setLocalEducation(previousEducation),
                          failureMessage: 'Failed to save education. Please try again.',
                        }
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, localEducation === opt.value && styles.chipTextSelected]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Religion */}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Religion</Text>
              <View style={styles.chipRow}>
                {RELIGION_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, localReligion === opt.value && styles.chipSelected]}
                    onPress={async () => {
                      const previousReligion = localReligion;
                      setLocalReligion(opt.value);
                      await saveField(
                        { religion: opt.value },
                        {
                          onSuccess: () => setReligion(opt.value),
                          onFailure: () => setLocalReligion(previousReligion),
                          failureMessage: 'Failed to save religion. Please try again.',
                        }
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, localReligion === opt.value && styles.chipTextSelected]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* ────────────────────────────────────────────────────────────── */}
          {/* SECTION 7: INTERESTS (wrapped chip layout like Smoking/Drinking) */}
          {/* ────────────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Interests</Text>
              <Text style={styles.sectionCount}>{localHobbies.length}/6</Text>
            </View>

            <View style={styles.chipRow}>
              {ACTIVITY_FILTERS.map((activity) => {
                const isSelected = localHobbies.includes(activity.value);
                return (
                  <TouchableOpacity
                    key={activity.value}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={async () => {
                      let newHobbies: string[];
                      if (isSelected) {
                        newHobbies = localHobbies.filter((h) => h !== activity.value);
                      } else if (localHobbies.length < 6) {
                        newHobbies = [...localHobbies, activity.value];
                      } else {
                        return; // Max 6 reached
                      }
                      const previousHobbies = localHobbies;
                      setLocalHobbies(newHobbies);
                      await saveField(
                        { hobbies: newHobbies },
                        {
                          onSuccess: () => setHobbies(newHobbies),
                          onFailure: () => setLocalHobbies(previousHobbies),
                          failureMessage: 'Failed to save interests. Please try again.',
                        }
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {activity.emoji} {activity.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.detailHint}>Select up to 6 interests to show on your profile</Text>
          </View>

          {/* Bottom spacing for save button */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Fixed Bottom Save Button */}
        <View style={[styles.saveButtonContainer, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity
            style={[
              styles.saveButton,
              isSaving && styles.saveButtonDisabled,
            ]}
            onPress={handleSaveAll}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  loadingStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  loadingStateText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  scrollContent: {
    paddingHorizontal: PHOTO_PADDING,
    paddingTop: 20,
  },

  // Section
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.3,
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textLight,
  },
  editLink: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
  },

  // Locked badge
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.accent,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  lockedText: {
    fontSize: 11,
    fontWeight: '600',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  lockedValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockedHint: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 10,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  lookingForLink: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 28,
    gap: 12,
  },
  lookingForLinkText: {
    flex: 1,
  },
  lookingForLinkTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  lookingForLinkSubtitle: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 2,
  },

  // Info Card
  infoCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
  },
  infoRow: {
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  nicknameInput: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.background,
    minWidth: 180,
  },
  nicknameInputDisabled: {
    opacity: 0.5,
  },
  nicknameMetaRow: {
    marginTop: -8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  nicknameMetaText: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '600',
  },
  nicknameEditBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: C.accent,
    borderWidth: 1,
    borderColor: C.border,
  },
  nicknameEditBtnDisabled: {
    opacity: 0.5,
  },
  nicknameEditBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.text,
  },
  nicknameEditActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nicknameActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: C.accent,
    borderWidth: 1,
    borderColor: C.border,
  },
  nicknameActionBtnPrimary: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: C.primary,
    borderWidth: 1,
    borderColor: C.primary,
  },
  nicknameActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.text,
  },
  nicknameActionTextPrimary: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  nicknameErrorText: {
    marginTop: 8,
    fontSize: 12,
    color: '#E25555',
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: C.accent,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipSelected: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: C.text,
  },
  chipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // Photo Grid
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: PHOTO_GAP,
  },
  photoSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE * 1.25,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoImageDeferred: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  mainBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setMainBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurBtn: {
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
  blurBtnActive: {
    backgroundColor: C.primary,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  previewCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: C.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  // Phase-1 style photo preview (full screen + floating circular actions)
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
    backgroundColor: '#FF6B6B',
  },
  previewButtonLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 8,
    textAlign: 'center',
  },
  previewButtonLabelDanger: {
    color: '#FF6B6B',
  },
  addSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE * 1.25,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.primary + '40',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSlotDisabled: {
    opacity: 0.6,
  },
  addSlotText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.primary,
    marginTop: 4,
  },
  photoHint: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 12,
  },
  // Blur Explainer
  blurExplainer: {
    marginTop: 12,
    gap: 8,
  },
  blurExplainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  blurExplainerIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurExplainerIconBlurred: {
    backgroundColor: C.primary,
  },
  blurExplainerText: {
    fontSize: 13,
    color: C.textLight,
    flex: 1,
  },

  // Visibility Card
  visibilityCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  toggleHint: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.accent,
    padding: 2,
    justifyContent: 'center',
  },
  toggleActive: {
    backgroundColor: C.primary,
  },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  toggleKnobActive: {
    alignSelf: 'flex-end',
  },

  // Bio
  bioCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
  },
  bioText: {
    fontSize: 15,
    color: C.text,
    lineHeight: 24,
  },
  bioEmpty: {
    fontSize: 14,
    color: C.textLight,
    fontStyle: 'italic',
  },
  bioEditCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 14,
  },
  bioInput: {
    fontSize: 15,
    color: C.text,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  bioActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    fontSize: 14,
    color: C.textLight,
    fontWeight: '500',
  },
  saveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: C.primary,
    borderRadius: 16,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Prompts
  promptsContainer: {
    gap: 10,
  },
  promptCard: {
    backgroundColor: C.surface,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
  },
  promptQuestion: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 6,
  },
  promptAnswer: {
    fontSize: 15,
    color: C.text,
    lineHeight: 22,
  },
  promptEditPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.primary + '14',
  },
  promptEditPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.primary,
  },
  quickChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
    maxWidth: '100%',
  },
  quickChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    lineHeight: 20,
  },

  // Details
  detailRow: {
    marginBottom: 18,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
  },
  detailLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  heightPreview: {
    fontSize: 13,
    fontWeight: '600',
    color: C.primary,
  },
  detailInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailInput: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: C.text,
    fontWeight: '600',
  },
  detailHint: {
    marginTop: 10,
    fontSize: 12,
    color: C.textLight,
  },
  detailsHelperText: {
    marginTop: 2,
    fontSize: 12,
    color: C.textLight,
    fontWeight: '500',
  },
  syncDetailsBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: C.accent,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    maxWidth: 210,
  },
  syncDetailsBtnDisabled: {
    opacity: 0.6,
  },
  syncDetailsBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
  },

  // Save Button
  saveButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: C.background,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  saveButton: {
    backgroundColor: C.primary,
    borderRadius: 14,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  // NOTE: saveButtonSuccess style removed - we now navigate back on success
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
