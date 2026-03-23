/*
 * LOCKED (PRIVATE PROFILE SCREEN)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */

/**
 * Phase-2 Private Profile Screen
 *
 * Complete profile view with:
 * - Main photo header with tap-to-view modal
 * - Preview as others toggle (blurred preview)
 * - Photo grid with add/remove/reorder/set main
 * - Connection Vibe and Looking For tags
 * - Settings shortcuts (Subscription, Privacy)
 *
 * IMPORTANT:
 * - Owner always sees photos CLEAR by default
 * - "Preview as others" shows how others see it (blurred if enabled)
 * - No "Anonymous_User" or "Private Username" - uses real name
 * - STABILITY FIX: Convex is source-of-truth for profile data after restart
 */
import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Modal,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Paths, File as ExpoFile, Directory } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { stringToUserId } from '@/convex/helpers';
import { uploadPhotoToConvex } from '@/lib/uploadUtils';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useScreenTrace } from '@/lib/devTrace';

/** Parse "YYYY-MM-DD" to local Date (noon to avoid DST issues) */
function parseDOBString(dobString: string): Date {
  if (!dobString || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) {
    return new Date(2000, 0, 1, 12, 0, 0);
  }
  const [y, m, d] = dobString.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** Calculate age from DOB string using local date parsing */
function calculateAgeFromDOB(dob: string): number {
  const birthDate = parseDOBString(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// Permanent storage directory for private profile photos
const PRIVATE_PHOTOS_DIR_NAME = 'private_photos';
const MAX_PHOTOS = 9;

/**
 * Get the permanent photos directory (expo-file-system v19 API)
 */
function getPrivatePhotosDir(): Directory {
  return new Directory(Paths.document, PRIVATE_PHOTOS_DIR_NAME);
}

/**
 * Copy a photo from cache/temporary location to permanent storage
 * Uses expo-file-system v19 class-based API (Paths, File, Directory)
 */
async function copyToPermamentStorage(sourceUri: string, index: number): Promise<string | null> {
  // Skip if already in permanent storage or is a remote URL
  if (sourceUri.includes(PRIVATE_PHOTOS_DIR_NAME) || sourceUri.startsWith('http')) {
    return sourceUri;
  }

  try {
    // Ensure directory exists
    const privateDir = getPrivatePhotosDir();
    if (!privateDir.exists) {
      privateDir.create();
    }

    const timestamp = Date.now();
    const extension = sourceUri.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `photo_${timestamp}_${index}.${extension}`;
    const destFile = new ExpoFile(privateDir, filename);

    // Check if destination already exists
    if (destFile.exists) {
      return destFile.uri;
    }

    // Copy the file
    const sourceFile = new ExpoFile(sourceUri);
    sourceFile.copy(destFile);

    return destFile.uri;
  } catch (error) {
    if (__DEV__) {
      console.error('[PrivateProfile] Copy failed:', error);
    }
    return null;
  }
}

const C = INCOGNITO_COLORS;
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const PHOTO_GAP = 8;
const PHOTO_PADDING = 16;
const PHOTO_SIZE = (SCREEN_WIDTH - PHOTO_PADDING * 2 - PHOTO_GAP * 2) / 3;
const MAIN_PHOTO_SIZE = 140; // Circular avatar size

/**
 * Validate a photo URL is usable
 * IMPORTANT: Reject cache/ImagePicker URIs - they don't persist across restarts
 */
function isValidPhotoUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url === 'undefined' || url === 'null') return false;

  // Reject temporary cache URIs (ImagePicker cache doesn't persist)
  if (url.includes('/cache/ImagePicker/') || url.includes('/Cache/ImagePicker/')) {
    return false;
  }

  return url.startsWith('http') || url.startsWith('file://');
}

export default function PrivateProfileScreen() {
  useScreenTrace("P2_PROFILE");
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Auth
  const { userId } = useAuthStore();

  // STABILITY FIX: Query Convex for backend profile data (source of truth after restart)
  const backendProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    !isDemoMode && userId ? { authUserId: userId } : 'skip'
  );
  const backendProfileLoaded = backendProfile !== undefined;

  // Mutations for photo upload to Convex backend
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const getStorageUrl = useMutation(api.photos.getStorageUrl);
  // Use auth-safe mutation (doesn't require ctx.auth.getUserIdentity)
  const updatePrivateProfile = useMutation(api.privateProfiles.updateFieldsByAuthId);

  // NOTE: Recovery gating now happens at Phase-1 "Private" entry point only.
  // This screen no longer auto-redirects to recovery - user must exit Phase-2
  // and re-enter via Phase-1 Private button to see recovery screen.

  // Phase-2 store data (local fallback while backend loads / demo mode)
  const localSelectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const localDisplayName = usePrivateProfileStore((s) => s.displayName);
  const localAge = usePrivateProfileStore((s) => s.age);
  const blurMyPhoto = usePrivateProfileStore((s) => s.blurMyPhoto);
  const localIntentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const localPrivateBio = usePrivateProfileStore((s) => s.privateBio);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setBlurMyPhoto = usePrivateProfileStore((s) => s.setBlurMyPhoto);
  const resetPhase2 = usePrivateProfileStore((s) => s.resetPhase2);

  // Profile details from store
  const storeHeight = usePrivateProfileStore((s) => s.height);
  const storeWeight = usePrivateProfileStore((s) => s.weight);
  const storeSmoking = usePrivateProfileStore((s) => s.smoking);
  const storeDrinking = usePrivateProfileStore((s) => s.drinking);
  const storeEducation = usePrivateProfileStore((s) => s.education);
  const storeReligion = usePrivateProfileStore((s) => s.religion);

  // STABILITY FIX: Resolve data from backend (primary) or local store (fallback)
  // After app restart, hydration populates localSelectedPhotoUrls from Convex.
  // Priority: local store (includes hydrated data) -> backend direct -> empty
  const selectedPhotoUrls = useMemo(() => {
    if (isDemoMode) return localSelectedPhotoUrls;

    // After hydration, local store has photos from Convex
    // If local store has valid photos, use them (immediate UI feedback)
    if (localSelectedPhotoUrls.length > 0) {
      if (__DEV__) {
        console.log('[P2_PROFILE] Using local store photos:', localSelectedPhotoUrls.length);
      }
      return localSelectedPhotoUrls;
    }

    // Fallback: use backend directly if store hasn't hydrated yet
    if (backendProfile?.privatePhotoUrls?.length) {
      if (__DEV__) {
        console.log('[P2_PROFILE] Using backend photos directly:', backendProfile.privatePhotoUrls.length);
      }
      return backendProfile.privatePhotoUrls;
    }

    return localSelectedPhotoUrls;
  }, [isDemoMode, backendProfile, localSelectedPhotoUrls]);

  const displayName = useMemo(() => {
    if (isDemoMode) return localDisplayName;
    if (backendProfile?.displayName) return backendProfile.displayName;
    return localDisplayName;
  }, [isDemoMode, backendProfile, localDisplayName]);

  const age = useMemo(() => {
    if (isDemoMode) return localAge;
    if (backendProfile?.age) return backendProfile.age;
    return localAge;
  }, [isDemoMode, backendProfile, localAge]);

  const intentKeys = useMemo(() => {
    if (isDemoMode) return localIntentKeys;
    if (backendProfile?.privateIntentKeys?.length) return backendProfile.privateIntentKeys;
    return localIntentKeys;
  }, [isDemoMode, backendProfile, localIntentKeys]);

  // STABILITY FIX: Prioritize local store for immediate feedback after edit
  // (matches photos pattern - local first, backend fallback)
  const privateBio = useMemo(() => {
    if (isDemoMode) return localPrivateBio;
    // Use local store if it has a value (includes data from recent edits)
    if (localPrivateBio && localPrivateBio.trim().length > 0) {
      return localPrivateBio;
    }
    // Fallback to backend if local is empty (e.g., first load before hydration)
    if (backendProfile?.privateBio) return backendProfile.privateBio;
    return localPrivateBio;
  }, [isDemoMode, backendProfile, localPrivateBio]);

  // DEV logs to prove fix
  useEffect(() => {
    if (__DEV__) {
      const source = isDemoMode ? 'demo_local' : (backendProfileLoaded && backendProfile ? 'backend' : 'fallback_local');
      const fieldsPresent = [
        displayName ? 'name' : null,
        age > 0 ? 'age' : null,
        selectedPhotoUrls.length > 0 ? 'photos' : null,
        intentKeys.length > 0 ? 'intents' : null,
        privateBio ? 'bio' : null,
      ].filter(Boolean).length;
      console.log('[P2_PROFILE] source=' + source + ', userId=' + (userId?.substring(0, 8) || 'none') + ', fieldsPresent=' + fieldsPresent);
      console.log('[P2_PROFILE] backendProfileLoaded=' + backendProfileLoaded);
      console.log('[P2_PROFILE] backendPhotos=' + (backendProfile?.privatePhotoUrls?.length || 0));
    }
  }, [isDemoMode, backendProfileLoaded, backendProfile, displayName, age, selectedPhotoUrls, intentKeys, privateBio, userId]);

  // PHASE 1 Settings
  const defaultPhotoVisibility = usePrivateProfileStore((s) => s.defaultPhotoVisibility);
  const allowUnblurRequests = usePrivateProfileStore((s) => s.allowUnblurRequests);
  const defaultSecureMediaTimer = usePrivateProfileStore((s) => s.defaultSecureMediaTimer);
  const defaultSecureMediaViewingMode = usePrivateProfileStore((s) => s.defaultSecureMediaViewingMode);
  const communicationStyle = usePrivateProfileStore((s) => s.communicationStyle);
  const desirelandVisibility = usePrivateProfileStore((s) => s.desirelandVisibility);
  const ageVisibility = usePrivateProfileStore((s) => s.ageVisibility);
  const whoCanMessageMe = usePrivateProfileStore((s) => s.whoCanMessageMe);
  const safeMode = usePrivateProfileStore((s) => s.safeMode);

  const setDefaultPhotoVisibility = usePrivateProfileStore((s) => s.setDefaultPhotoVisibility);
  const setAllowUnblurRequests = usePrivateProfileStore((s) => s.setAllowUnblurRequests);
  const setDefaultSecureMediaTimer = usePrivateProfileStore((s) => s.setDefaultSecureMediaTimer);
  const setDefaultSecureMediaViewingMode = usePrivateProfileStore((s) => s.setDefaultSecureMediaViewingMode);
  const setCommunicationStyle = usePrivateProfileStore((s) => s.setCommunicationStyle);
  const setDesirelandVisibility = usePrivateProfileStore((s) => s.setDesirelandVisibility);
  const setAgeVisibility = usePrivateProfileStore((s) => s.setAgeVisibility);
  const setWhoCanMessageMe = usePrivateProfileStore((s) => s.setWhoCanMessageMe);
  const setSafeMode = usePrivateProfileStore((s) => s.setSafeMode);
  const isPrivateEnabled = usePrivateProfileStore((s) => s.isPrivateEnabled);

  // Local UI state
  const [previewAsOthers, setPreviewAsOthers] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPhotoIndex, setViewerPhotoIndex] = useState(0);
  const [missingPhotos, setMissingPhotos] = useState<Set<string>>(new Set());
  // FIX: Track which specific slot is loading (null = none)
  const [addingSlotIndex, setAddingSlotIndex] = useState<number | null>(null);
  // PROFILE-P2-002 FIX: Track concurrent photo sync operations (reorder/remove)
  const syncingPhotoCountRef = useRef(0);
  const [isSyncingPhotos, setIsSyncingPhotos] = useState(false);

  // Track last checked photos to avoid redundant checks
  const lastCheckedRef = useRef<string>('');

  // STABILITY FIX: Track mount state to prevent setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Check for missing photo files (only file:// URIs that passed validation)
   * Runs on focus and when photos array changes
   */
  const checkPhotosExist = useCallback(async () => {
    const photos = Array.isArray(selectedPhotoUrls) ? selectedPhotoUrls : [];
    const photosKey = photos.join('|');

    // Skip if already checked this exact set
    if (photosKey === lastCheckedRef.current) return;
    lastCheckedRef.current = photosKey;

    // Only check permanent file:// URIs (cache URIs already filtered by isValidPhotoUrl)
    const fileUris = photos.filter(
      (uri) => uri.startsWith('file://') && !uri.includes('/cache/')
    );

    if (fileUris.length === 0) {
      // UNMOUNT-GUARD: Check mounted before setState
      if (mountedRef.current) {
        setMissingPhotos(new Set());
      }
      return;
    }

    // Check existence using class-based API
    const missing = new Set<string>();
    for (const uri of fileUris) {
      try {
        const file = new ExpoFile(uri);
        if (!file.exists) {
          missing.add(uri);
        }
      } catch {
        missing.add(uri);
      }
    }

    // UNMOUNT-GUARD: Check mounted before setState after async file checks
    if (mountedRef.current) {
      setMissingPhotos(missing);
    }

    // Single summary log in DEV only
    if (__DEV__ && (missing.size > 0 || fileUris.length > 0)) {
      console.log('[PrivateProfile] Photo check:', {
        total: photos.length,
        fileUris: fileUris.length,
        missing: missing.size,
      });
    }
  }, [selectedPhotoUrls]);

  // Check on mount and when photos change
  useEffect(() => {
    checkPhotosExist();
  }, [checkPhotosExist]);

  // Also check when screen gains focus (in case files were deleted externally)
  useFocusEffect(
    useCallback(() => {
      // Reset the check key to force a recheck on focus
      lastCheckedRef.current = '';
      checkPhotosExist();
    }, [checkPhotosExist])
  );

  // Get Phase-1 data as fallback
  const phase1Data = useMemo(() => {
    if (isDemoMode) {
      const demoUser = getDemoCurrentUser();
      return {
        name: demoUser?.name || 'User',
        age: demoUser?.dateOfBirth ? calculateAgeFromDOB(demoUser.dateOfBirth) : 0,
      };
    }
    return { name: 'User', age: 0 };
  }, []);

  // Resolve display name and age
  const resolvedName = useMemo(() => {
    if (displayName && displayName.trim().length > 0) {
      return displayName;
    }
    return phase1Data.name;
  }, [displayName, phase1Data.name]);

  const resolvedAge = useMemo(() => {
    if (age && age > 0) return age;
    return phase1Data.age;
  }, [age, phase1Data.age]);

  // Filter and validate photos (defensive: ensure array, exclude missing/cache files)
  const validPhotos = useMemo(() => {
    const photos = Array.isArray(selectedPhotoUrls) ? selectedPhotoUrls : [];
    // Filter out invalid URLs (including cache URIs) and missing files
    const filtered = photos.filter(
      (url) => isValidPhotoUrl(url) && !missingPhotos.has(url)
    );

    return filtered;
  }, [selectedPhotoUrls, missingPhotos]);

  // Count rejected cache URIs for the warning banner
  const cacheUriCount = useMemo(() => {
    const photos = Array.isArray(selectedPhotoUrls) ? selectedPhotoUrls : [];
    return photos.filter((url) => url.includes('/cache/ImagePicker/')).length;
  }, [selectedPhotoUrls]);

  const mainPhoto = validPhotos[0] || null;

  // Create 9-slot array for rendering full grid
  const photoSlots = useMemo(() => {
    const slots: (string | null)[] = [null, null, null, null, null, null, null, null, null];
    validPhotos.forEach((url, idx) => {
      if (idx < 9) slots[idx] = url;
    });
    return slots;
  }, [validPhotos]);

  // Get intent labels for display
  const intentLabels = useMemo(() => {
    const safeKeys = Array.isArray(intentKeys) ? intentKeys : [];
    return safeKeys
      .map((key) => {
        const cat = PRIVATE_INTENT_CATEGORIES.find((c) => c.key === key);
        return cat?.label || key;
      })
      .filter(Boolean);
  }, [intentKeys]);

  // Should show blur in current view
  const shouldShowBlur = previewAsOthers && blurMyPhoto;

  /**
   * Open photo viewer
   */
  const openViewer = (index: number) => {
    setViewerPhotoIndex(index);
    setViewerVisible(true);
  };

  /**
   * Set a photo as main (move to index 0) and sync to backend
   * PROFILE-P2-001 FIX: Read fresh store state to avoid stale memoized data
   */
  const handleSetAsMain = useCallback(
    async (index: number) => {
      // PROFILE-P2-001 FIX: Read current store state, not stale memoized validPhotos
      const currentPhotos = usePrivateProfileStore.getState().selectedPhotoUrls.filter(isValidPhotoUrl);
      if (index === 0 || index >= currentPhotos.length) return;

      const newOrder = [...currentPhotos];
      const [photo] = newOrder.splice(index, 1);
      newOrder.unshift(photo);

      setSelectedPhotos([], newOrder);

      // Sync reorder to backend (auth-safe mutation)
      if (!isDemoMode && userId) {
        // PROFILE-P2-002 FIX: Track sync in progress
        syncingPhotoCountRef.current++;
        if (mountedRef.current) setIsSyncingPhotos(true);
        try {
          const result = await updatePrivateProfile({
            authUserId: userId,
            privatePhotoUrls: newOrder,
          });
          if (__DEV__ && result.success) {
            console.log('[PrivateProfile] Backend photo sync success count:', newOrder.length);
          }
        } catch (syncError) {
          if (__DEV__) {
            console.error('[PrivateProfile] Backend sync failed:', syncError);
          }
        } finally {
          syncingPhotoCountRef.current--;
          if (mountedRef.current && syncingPhotoCountRef.current === 0) {
            setIsSyncingPhotos(false);
          }
        }
      }

      if (__DEV__) {
        console.log('[PrivateProfile] Set photo as main:', { index });
      }
    },
    [setSelectedPhotos, isDemoMode, userId, updatePrivateProfile]
  );

  /**
   * Remove a photo and sync to backend
   * PROFILE-P2-001 FIX: Read fresh store state to avoid stale memoized data
   * PROFILE-P3-001 FIX: Clean up local permanent file to prevent orphaned files
   */
  const handleRemovePhoto = useCallback(
    async (index: number) => {
      // PROFILE-P2-001 FIX: Read current store state, not stale memoized validPhotos
      const currentPhotos = usePrivateProfileStore.getState().selectedPhotoUrls.filter(isValidPhotoUrl);
      if (index < 0 || index >= currentPhotos.length) return;

      // PROFILE-P3-001 FIX: Capture removed photo URL before filtering
      const removedPhotoUrl = currentPhotos[index];
      const newPhotos = currentPhotos.filter((_, i) => i !== index);
      setSelectedPhotos([], newPhotos);

      // PROFILE-P3-001 FIX: Clean up local permanent file if applicable (best-effort)
      if (removedPhotoUrl.includes(PRIVATE_PHOTOS_DIR_NAME) && !removedPhotoUrl.startsWith('http')) {
        try {
          const fileToDelete = new ExpoFile(removedPhotoUrl);
          if (fileToDelete.exists) {
            fileToDelete.delete();
            if (__DEV__) {
              console.log('[PrivateProfile] Deleted local photo file:', removedPhotoUrl);
            }
          }
        } catch (deleteError) {
          // Silent fail - cleanup is best-effort, do not block UI
          if (__DEV__) {
            console.warn('[PrivateProfile] Failed to delete local photo:', deleteError);
          }
        }
      }

      // Sync removal to Convex backend (auth-safe mutation)
      if (!isDemoMode && userId) {
        // PROFILE-P2-002 FIX: Track sync in progress
        syncingPhotoCountRef.current++;
        if (mountedRef.current) setIsSyncingPhotos(true);
        try {
          const result = await updatePrivateProfile({
            authUserId: userId,
            privatePhotoUrls: newPhotos,
          });
          if (__DEV__ && result.success) {
            console.log('[PrivateProfile] Backend photo sync success count:', newPhotos.length);
          }
        } catch (syncError) {
          if (__DEV__) {
            console.error('[PrivateProfile] Backend sync failed:', syncError);
          }
        } finally {
          syncingPhotoCountRef.current--;
          if (mountedRef.current && syncingPhotoCountRef.current === 0) {
            setIsSyncingPhotos(false);
          }
        }
      }

      if (__DEV__) {
        console.log('[PrivateProfile] Removed photo:', { index, remaining: newPhotos.length });
      }
    },
    [setSelectedPhotos, isDemoMode, userId, updatePrivateProfile]
  );

  /**
   * Move photo up in order and sync to backend
   * PROFILE-P2-001 FIX: Read fresh store state to avoid stale memoized data
   */
  const handleMoveUp = useCallback(
    async (index: number) => {
      // PROFILE-P2-001 FIX: Read current store state, not stale memoized validPhotos
      const currentPhotos = usePrivateProfileStore.getState().selectedPhotoUrls.filter(isValidPhotoUrl);
      if (index <= 0 || index >= currentPhotos.length) return;

      const newOrder = [...currentPhotos];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      setSelectedPhotos([], newOrder);

      // Sync reorder to backend (auth-safe mutation)
      if (!isDemoMode && userId) {
        // PROFILE-P2-002 FIX: Track sync in progress
        syncingPhotoCountRef.current++;
        if (mountedRef.current) setIsSyncingPhotos(true);
        try {
          const result = await updatePrivateProfile({
            authUserId: userId,
            privatePhotoUrls: newOrder,
          });
          if (__DEV__ && result.success) {
            console.log('[PrivateProfile] Backend photo sync success count:', newOrder.length);
          }
        } catch (syncError) {
          if (__DEV__) {
            console.error('[PrivateProfile] Backend sync failed:', syncError);
          }
        } finally {
          syncingPhotoCountRef.current--;
          if (mountedRef.current && syncingPhotoCountRef.current === 0) {
            setIsSyncingPhotos(false);
          }
        }
      }
    },
    [setSelectedPhotos, isDemoMode, userId, updatePrivateProfile]
  );

  /**
   * Move photo down in order and sync to backend
   * PROFILE-P2-001 FIX: Read fresh store state to avoid stale memoized data
   */
  const handleMoveDown = useCallback(
    async (index: number) => {
      // PROFILE-P2-001 FIX: Read current store state, not stale memoized validPhotos
      const currentPhotos = usePrivateProfileStore.getState().selectedPhotoUrls.filter(isValidPhotoUrl);
      if (index < 0 || index >= currentPhotos.length - 1) return;

      const newOrder = [...currentPhotos];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      setSelectedPhotos([], newOrder);

      // Sync reorder to backend (auth-safe mutation)
      if (!isDemoMode && userId) {
        // PROFILE-P2-002 FIX: Track sync in progress
        syncingPhotoCountRef.current++;
        if (mountedRef.current) setIsSyncingPhotos(true);
        try {
          const result = await updatePrivateProfile({
            authUserId: userId,
            privatePhotoUrls: newOrder,
          });
          if (__DEV__ && result.success) {
            console.log('[PrivateProfile] Backend photo sync success count:', newOrder.length);
          }
        } catch (syncError) {
          if (__DEV__) {
            console.error('[PrivateProfile] Backend sync failed:', syncError);
          }
        } finally {
          syncingPhotoCountRef.current--;
          if (mountedRef.current && syncingPhotoCountRef.current === 0) {
            setIsSyncingPhotos(false);
          }
        }
      }
    },
    [setSelectedPhotos, isDemoMode, userId, updatePrivateProfile]
  );

  /**
   * Add photo to a specific slot index
   * Opens ImagePicker, uploads to Convex storage, updates store and backend
   */
  const handleAddPhotoToSlot = async (slotIndex: number) => {
    // FIX: Use slot-specific loading state
    if (addingSlotIndex !== null) return;
    setAddingSlotIndex(slotIndex);

    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library access to add photos.');
        // UNMOUNT-GUARD: Check mounted before setState after async
        if (mountedRef.current) {
          setAddingSlotIndex(null);
        }
        return;
      }

      // Launch gallery for single photo selection
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        // UNMOUNT-GUARD: Check mounted before setState after async
        if (mountedRef.current) {
          setAddingSlotIndex(null);
        }
        return;
      }

      const asset = result.assets[0];

      // PERSISTENCE FIX: Upload to Convex storage (not local file system)
      // This ensures photos persist across app restarts/force quit
      let backendUrl: string | null = null;

      if (!isDemoMode && userId) {
        try {
          if (__DEV__) {
            console.log('[PrivateProfile] Uploading photo to Convex storage...');
          }

          // Upload photo to Convex storage
          const storageId = await uploadPhotoToConvex(asset.uri, generateUploadUrl);

          // Get the permanent URL from storage ID using Convex API
          const permanentUrl = await getStorageUrl({ storageId });
          if (!permanentUrl) {
            throw new Error('Failed to get URL for uploaded photo');
          }
          backendUrl = permanentUrl;

          if (__DEV__) {
            console.log('[PrivateProfile] Photo uploaded to Convex, url:', backendUrl);
          }
        } catch (uploadError) {
          if (__DEV__) {
            console.error('[PrivateProfile] Convex upload failed:', uploadError);
          }
          // Fall back to local storage for demo/offline mode
          backendUrl = await copyToPermamentStorage(asset.uri, Date.now());
        }
      } else {
        // Demo mode or no user - use local storage
        backendUrl = await copyToPermamentStorage(asset.uri, Date.now());
      }

      // UNMOUNT-GUARD: Check mounted before setState after long async chain
      if (!mountedRef.current) return;

      if (backendUrl) {
        // FIX: Read current store state directly to ensure we have latest photos
        const currentPhotos = usePrivateProfileStore.getState().selectedPhotoUrls.filter(isValidPhotoUrl);
        const newPhotos = [...currentPhotos];

        // If slot index is beyond current length, add new photo at end
        if (slotIndex >= newPhotos.length) {
          newPhotos.push(backendUrl);
        } else {
          // Replace photo at slot index
          newPhotos[slotIndex] = backendUrl;
        }

        const finalPhotos = newPhotos.slice(0, MAX_PHOTOS);

        // Update local store - this triggers re-render
        setSelectedPhotos([], finalPhotos);

        // PERSISTENCE FIX: Also sync to Convex backend (auth-safe mutation)
        if (!isDemoMode && userId) {
          try {
            const result = await updatePrivateProfile({
              authUserId: userId,
              privatePhotoUrls: finalPhotos,
            });
            if (__DEV__ && result.success) {
              console.log('[PrivateProfile] Backend photo sync success count:', finalPhotos.length);
            }
          } catch (syncError) {
            if (__DEV__) {
              console.error('[PrivateProfile] Backend sync failed:', syncError);
            }
            // Local store is still updated, so user sees the photo
            // Backend sync can be retried later
          }
        }

        // Reset the check ref so existence check runs again
        lastCheckedRef.current = '';

        if (__DEV__) {
          console.log('[PrivateProfile] Added photo to slot', slotIndex, 'total:', finalPhotos.length);
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[PrivateProfile] Add photo error:', error);
      }
      Alert.alert('Error', 'Failed to add photo. Please try again.');
    } finally {
      // UNMOUNT-GUARD: Check mounted before setState in finally
      if (mountedRef.current) {
        setAddingSlotIndex(null);
      }
    }
  };

  /**
   * Navigate to desire edit screen (Phase-2 internal)
   */
  const handleEditDesire = () => {
    router.push('/(main)/(private)/edit-desire' as any);
  };

  /**
   * Navigate to profile details edit screen (Phase-2 internal)
   */
  const handleEditProfileDetails = () => {
    router.push('/(main)/(private)/edit-profile-details' as any);
  };

  /**
   * Reset Phase-2 profile and restart onboarding
   */
  const handleResetPhase2 = () => {
    Alert.alert(
      'Reset Private Profile?',
      'This will clear all your Private Mode photos, preferences, and settings. You will need to set up your Private profile again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            resetPhase2();
            router.replace('/(main)/phase2-onboarding' as any);
          },
        },
      ]
    );
  };

  /**
   * Render grid photo with optional blur (used for photo grid)
   */
  const renderGridPhoto = (uri: string, index: number, onPress?: () => void) => {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        disabled={!onPress}
        style={styles.gridPhotoContainer}
      >
        <Image
          source={{ uri }}
          style={styles.gridPhotoImage}
          blurRadius={shouldShowBlur ? 35 : 0}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="person-circle" size={24} color={C.primary} />
        <Text style={styles.headerTitle}>My Private Profile</Text>
        <TouchableOpacity onPress={handleEditProfileDetails} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="settings-outline" size={22} color={C.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Main Photo Section - Circular Avatar */}
        <View style={styles.mainPhotoSection}>
          {mainPhoto ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => openViewer(0)}
              style={styles.mainPhotoTouchable}
            >
              <View style={styles.mainPhotoContainer}>
                <Image
                  source={{ uri: mainPhoto }}
                  style={styles.mainPhotoImage}
                  blurRadius={shouldShowBlur ? 35 : 0}
                />
              </View>
              {/* Tap hint badge */}
              <View style={styles.tapHint}>
                <Ionicons name="expand-outline" size={12} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.mainPhotoEmpty} onPress={() => handleAddPhotoToSlot(0)}>
              <Ionicons name="camera-outline" size={40} color={C.textLight} />
            </TouchableOpacity>
          )}

          {/* Name and Age below avatar */}
          <View style={styles.nameSection}>
            <View style={styles.nameAgeRow}>
              <Text style={styles.nameText}>{resolvedName}</Text>
              {resolvedAge > 0 && <Text style={styles.ageText}>, {resolvedAge}</Text>}
            </View>
            <Text style={styles.profileSubtitle}>Private Profile</Text>
          </View>
        </View>

        {/* Blur Controls */}
        <View style={styles.blurControlsCard}>
          {/* Blur toggle */}
          <TouchableOpacity
            style={styles.blurToggleRow}
            onPress={() => setBlurMyPhoto(!blurMyPhoto)}
            activeOpacity={0.7}
          >
            <View style={styles.blurToggleLeft}>
              <Ionicons name="eye-off-outline" size={20} color={blurMyPhoto ? C.primary : C.textLight} />
              <View>
                <Text style={styles.blurToggleLabel}>Blur my photos to others</Text>
                <Text style={styles.blurToggleHint}>
                  {blurMyPhoto ? 'Others see your photos blurred' : 'Others see your photos clearly'}
                </Text>
              </View>
            </View>
            <View style={[styles.toggleSwitch, blurMyPhoto && styles.toggleSwitchActive]}>
              <View style={[styles.toggleKnob, blurMyPhoto && styles.toggleKnobActive]} />
            </View>
          </TouchableOpacity>

          {/* Preview toggle */}
          <TouchableOpacity
            style={[styles.previewToggleRow, previewAsOthers && styles.previewToggleActive]}
            onPress={() => setPreviewAsOthers(!previewAsOthers)}
            activeOpacity={0.7}
          >
            <Ionicons name="eye" size={18} color={previewAsOthers ? C.primary : C.textLight} />
            <Text style={[styles.previewToggleText, previewAsOthers && styles.previewToggleTextActive]}>
              {previewAsOthers ? 'Viewing as others see it' : 'Preview as others'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Missing Photos Warning (includes cache URIs that can't persist) */}
        {(missingPhotos.size > 0 || cacheUriCount > 0) && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning-outline" size={20} color="#FF9500" />
            <View style={styles.warningContent}>
              <Text style={styles.warningTitle}>
                {missingPhotos.size + cacheUriCount} photo{(missingPhotos.size + cacheUriCount) > 1 ? 's' : ''} need re-adding
              </Text>
              <Text style={styles.warningText}>Use the photo grid below to add photos</Text>
            </View>
          </View>
        )}

        {/* Photo Grid - Full 9 Slots */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.sectionTitle}>Photos ({validPhotos.length}/9)</Text>
              {isSyncingPhotos && <ActivityIndicator size="small" color={C.primary} />}
            </View>
          </View>

          <View style={styles.photoGrid}>
            {/* Render all 9 slots */}
            {photoSlots.map((uri, slotIndex) => {
              const hasPhoto = !!uri;
              const isMain = slotIndex === 0 && hasPhoto;

              if (hasPhoto) {
                // Filled slot - show photo with controls
                return (
                  <View key={`slot-${slotIndex}`} style={styles.gridSlot}>
                    {renderGridPhoto(uri, slotIndex, () => openViewer(slotIndex))}

                    {/* Main photo badge */}
                    {isMain && (
                      <View style={styles.mainBadge}>
                        <Ionicons name="star" size={10} color="#FFD700" />
                        <Text style={styles.mainBadgeText}>Main</Text>
                      </View>
                    )}

                    {/* Photo controls */}
                    <View style={styles.gridControls}>
                      {/* Set as main (only for non-main photos) */}
                      {!isMain && (
                        <TouchableOpacity
                          style={styles.gridControlBtn}
                          onPress={() => handleSetAsMain(slotIndex)}
                        >
                          <Ionicons name="star" size={12} color="#FFD700" />
                        </TouchableOpacity>
                      )}
                      {/* Move up (only if not first) */}
                      {slotIndex > 0 && (
                        <TouchableOpacity
                          style={styles.gridControlBtn}
                          onPress={() => handleMoveUp(slotIndex)}
                        >
                          <Ionicons name="chevron-up" size={12} color={C.text} />
                        </TouchableOpacity>
                      )}
                      {/* Move down (only if not last photo) */}
                      {slotIndex < validPhotos.length - 1 && (
                        <TouchableOpacity
                          style={styles.gridControlBtn}
                          onPress={() => handleMoveDown(slotIndex)}
                        >
                          <Ionicons name="chevron-down" size={12} color={C.text} />
                        </TouchableOpacity>
                      )}
                      {/* Remove */}
                      <TouchableOpacity
                        style={[styles.gridControlBtn, styles.gridControlBtnDanger]}
                        onPress={() => handleRemovePhoto(slotIndex)}
                      >
                        <Ionicons name="close" size={12} color="#FF6B6B" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }

              // Empty slot - show add button
              const isThisSlotLoading = addingSlotIndex === slotIndex;
              return (
                <TouchableOpacity
                  key={`slot-${slotIndex}`}
                  style={[
                    styles.addPhotoSlot,
                    isThisSlotLoading && styles.addPhotoSlotDisabled,
                  ]}
                  onPress={() => handleAddPhotoToSlot(slotIndex)}
                  disabled={addingSlotIndex !== null}
                >
                  {isThisSlotLoading ? (
                    <ActivityIndicator size="small" color={C.primary} />
                  ) : (
                    <>
                      <Ionicons name="add" size={28} color={C.primary} />
                      <Text style={styles.addPhotoText}>Add</Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.photoGridHint}>
            <Ionicons name="star" size={11} color="#FFD700" /> = Set as main • Arrows = Reorder • <Ionicons name="close" size={11} color="#FF6B6B" /> = Remove
          </Text>
        </View>

        {/* Desire Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Desire</Text>
            <TouchableOpacity onPress={handleEditDesire} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          {privateBio && privateBio.trim().length > 0 ? (
            <Text style={styles.bioText}>{privateBio}</Text>
          ) : (
            <Text style={styles.emptyText}>Tap Edit to add your desire...</Text>
          )}
        </View>

        {/* Profile Details Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Profile Details</Text>
            <TouchableOpacity onPress={handleEditProfileDetails} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.detailsCard}>
            {/* Body row */}
            <View style={styles.detailsRow}>
              {storeHeight && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Height</Text>
                  <Text style={styles.detailValue}>{storeHeight} cm</Text>
                </View>
              )}
              {storeWeight && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Weight</Text>
                  <Text style={styles.detailValue}>{storeWeight} kg</Text>
                </View>
              )}
            </View>
            {/* Lifestyle row */}
            <View style={styles.detailsRow}>
              {storeSmoking && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Smoking</Text>
                  <Text style={styles.detailValue}>{storeSmoking === 'never' ? 'Non-smoker' : storeSmoking}</Text>
                </View>
              )}
              {storeDrinking && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Drinking</Text>
                  <Text style={styles.detailValue}>{storeDrinking === 'socially' ? 'Social drinker' : storeDrinking}</Text>
                </View>
              )}
            </View>
            {/* Background row */}
            <View style={styles.detailsRow}>
              {storeEducation && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Education</Text>
                  <Text style={styles.detailValue}>
                    {storeEducation === 'bachelors' ? "Bachelor's" :
                     storeEducation === 'masters' ? "Master's" :
                     storeEducation === 'high_school' ? 'High School' :
                     storeEducation === 'some_college' ? 'Some College' :
                     storeEducation === 'trade_school' ? 'Trade School' :
                     storeEducation}
                  </Text>
                </View>
              )}
              {storeReligion && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Religion</Text>
                  <Text style={styles.detailValue}>{storeReligion.charAt(0).toUpperCase() + storeReligion.slice(1)}</Text>
                </View>
              )}
            </View>
            {/* Empty state */}
            {!storeHeight && !storeWeight && !storeSmoking && !storeDrinking && !storeEducation && !storeReligion && (
              <Text style={styles.detailsHint}>Tap Edit to add your details</Text>
            )}
          </View>
        </View>

        {/* Settings Menu */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(main)/(private)/settings/profile-visibility' as any)}
            activeOpacity={0.7}
          >
            <Ionicons name={isPrivateEnabled ? 'eye-outline' : 'eye-off-outline'} size={22} color={C.text} />
            <Text style={styles.menuText}>Profile Visibility</Text>
            <View style={styles.menuRowRight}>
              <Text style={[styles.menuBadge, !isPrivateEnabled && styles.menuBadgePaused]}>
                {isPrivateEnabled ? 'Active' : 'Paused'}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={C.textLight} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(main)/(private)/settings/photo-media-privacy' as any)}
            activeOpacity={0.7}
          >
            <Ionicons name="images-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Photo & Media Privacy</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(main)/(private)/settings/private-safety' as any)}
            activeOpacity={0.7}
          >
            <Ionicons name="shield-checkmark-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Safety</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => router.push('/(main)/(private)/settings/private-account' as any)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-outline" size={22} color={C.text} />
            <Text style={styles.menuText}>Account</Text>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>
        </View>

        {/* Privacy Note */}
        <View style={styles.privacyNote}>
          <Ionicons name="information-circle-outline" size={18} color={C.textLight} />
          <Text style={styles.privacyNoteText}>
            This profile is separate from your main profile and only visible inside Private Mode.
          </Text>
        </View>
      </ScrollView>

      {/* Full-screen Photo Viewer Modal */}
      <Modal
        visible={viewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerVisible(false)}
      >
        <StatusBar barStyle="light-content" />
        <View style={styles.viewerContainer}>
          {/* Close button */}
          <TouchableOpacity
            style={[styles.viewerClose, { top: insets.top + 10 }]}
            onPress={() => setViewerVisible(false)}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Photo */}
          {validPhotos[viewerPhotoIndex] && (
            <View style={styles.viewerPhotoWrap}>
              <Image
                source={{ uri: validPhotos[viewerPhotoIndex] }}
                style={styles.viewerPhoto}
                resizeMode="contain"
                blurRadius={shouldShowBlur ? 35 : 0}
              />
            </View>
          )}

          {/* Navigation arrows */}
          {viewerPhotoIndex > 0 && (
            <TouchableOpacity
              style={[styles.viewerNav, styles.viewerNavLeft]}
              onPress={() => setViewerPhotoIndex(viewerPhotoIndex - 1)}
            >
              <Ionicons name="chevron-back" size={32} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          {viewerPhotoIndex < validPhotos.length - 1 && (
            <TouchableOpacity
              style={[styles.viewerNav, styles.viewerNavRight]}
              onPress={() => setViewerPhotoIndex(viewerPhotoIndex + 1)}
            >
              <Ionicons name="chevron-forward" size={32} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          {/* Photo counter */}
          <View style={[styles.viewerCounter, { bottom: insets.bottom + 20 }]}>
            <Text style={styles.viewerCounterText}>
              {viewerPhotoIndex + 1} / {validPhotos.length}
            </Text>
            {viewerPhotoIndex === 0 && (
              <View style={styles.viewerMainBadge}>
                <Ionicons name="star" size={12} color="#FFD700" />
                <Text style={styles.viewerMainBadgeText}>Main Photo</Text>
              </View>
            )}
          </View>

          {/* Preview mode indicator */}
          {previewAsOthers && blurMyPhoto && (
            <View style={[styles.viewerPreviewBadge, { top: insets.top + 60 }]}>
              <Ionicons name="eye" size={14} color={C.primary} />
              <Text style={styles.viewerPreviewText}>Preview mode - This is how others see it</Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text, flex: 1, marginLeft: 10 },

  // Main Photo Section - Circular Avatar
  mainPhotoSection: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: PHOTO_PADDING,
    backgroundColor: C.surface,
  },
  mainPhotoTouchable: {
    position: 'relative',
  },
  mainPhotoContainer: {
    width: MAIN_PHOTO_SIZE,
    height: MAIN_PHOTO_SIZE,
    borderRadius: MAIN_PHOTO_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: C.accent,
    borderWidth: 3,
    borderColor: C.primary,
  },
  mainPhotoImage: {
    width: '100%',
    height: '100%',
  },
  mainPhotoBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  nameSection: {
    alignItems: 'center',
    marginTop: 16,
  },
  nameAgeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  nameText: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
  },
  ageText: {
    fontSize: 20,
    fontWeight: '400',
    color: C.text,
  },
  profileSubtitle: {
    fontSize: 14,
    color: C.primary,
    marginTop: 4,
    fontWeight: '500',
  },
  tapHint: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainPhotoEmpty: {
    width: MAIN_PHOTO_SIZE,
    height: MAIN_PHOTO_SIZE,
    borderRadius: MAIN_PHOTO_SIZE / 2,
    backgroundColor: C.accent,
    borderWidth: 3,
    borderColor: C.primary + '40',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Warning Banner
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: PHOTO_PADDING,
    marginBottom: 12,
    padding: 14,
    backgroundColor: '#FF950015',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF950040',
    gap: 12,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF9500',
  },
  warningText: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },

  // Blur Controls
  blurControlsCard: {
    margin: PHOTO_PADDING,
    backgroundColor: C.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  blurToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  blurToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  blurToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  blurToggleHint: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  toggleSwitch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.accent,
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchActive: {
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
  previewToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.background,
  },
  previewToggleActive: {
    backgroundColor: C.primary + '15',
  },
  previewToggleText: {
    fontSize: 13,
    color: C.textLight,
    fontWeight: '500',
  },
  previewToggleTextActive: {
    color: C.primary,
  },

  // Section
  section: {
    paddingHorizontal: PHOTO_PADDING,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  editLink: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primary,
  },

  // Photo Grid
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: PHOTO_GAP,
  },
  gridSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE * 1.25,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: C.accent,
  },
  gridPhotoContainer: {
    width: '100%',
    height: '100%',
  },
  gridPhotoImage: {
    width: '100%',
    height: '100%',
  },
  gridPhotoBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridControls: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    flexDirection: 'row',
    gap: 3,
  },
  gridControlBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridControlBtnDanger: {
    backgroundColor: 'rgba(255,107,107,0.3)',
  },
  mainBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  mainBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addPhotoSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE * 1.25,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.primary + '40',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoSlotDisabled: {
    opacity: 0.6,
  },
  addPhotoText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: '600',
    marginTop: 4,
  },
  photoGridHint: {
    fontSize: 11,
    color: C.textLight,
    marginTop: 10,
    textAlign: 'center',
  },

  // Bio
  bioText: {
    fontSize: 14,
    color: C.text,
    lineHeight: 22,
  },
  emptyText: {
    fontSize: 14,
    color: C.textLight,
    fontStyle: 'italic',
  },
  detailsHint: {
    fontSize: 13,
    color: C.textLight,
  },
  detailsCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 8,
  },
  detailItem: {
    minWidth: 100,
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '500',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    textTransform: 'capitalize',
  },

  // Tags
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: C.primary + '20',
  },
  tagText: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '500',
  },

  // Settings
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    padding: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  settingsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingsRowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  settingsRowValue: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  settingsRowDanger: {
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.2)',
  },
  settingsRowLabelDanger: {
    color: '#FF6B6B',
  },

  // PHASE 1 Inline Settings Styles
  settingCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 10,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingHint: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: C.accent,
    borderRadius: 8,
    padding: 2,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: C.primary,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },

  // Privacy Note
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: PHOTO_PADDING,
    padding: 14,
    backgroundColor: C.surface,
    borderRadius: 10,
    marginBottom: 16,
  },
  privacyNoteText: {
    flex: 1,
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
  },

  // Back to Main
  backToMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: PHOTO_PADDING,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: C.surface,
  },
  backToMainText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textLight,
  },

  // Photo Viewer Modal
  viewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerClose: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerPhotoWrap: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
  },
  viewerPhoto: {
    width: '100%',
    height: '100%',
  },
  viewerNav: {
    position: 'absolute',
    top: '50%',
    marginTop: -25,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNavLeft: {
    left: 16,
  },
  viewerNavRight: {
    right: 16,
  },
  viewerCounter: {
    position: 'absolute',
    alignItems: 'center',
  },
  viewerCounterText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  viewerMainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  viewerMainBadgeText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  viewerPreviewBadge: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.surface,
    paddingVertical: 10,
    borderRadius: 20,
  },
  viewerPreviewText: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '500',
  },

  // Menu Row Styles
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  menuText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginLeft: 12,
  },
  menuRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  menuBadgePaused: {
    color: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
});
