import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  Dimensions,
  ScrollView,
  Platform,
  ActionSheetIOS,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore, DisplayPhotoVariant } from '@/stores/onboardingStore';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Ionicons } from '@expo/vector-icons';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { checkPhotoExists, getPhotoFileState, type PhotoFileState } from '@/lib/photoFileGuard';
import { uploadPhotoToBackend, syncPhotosFromBackend } from '@/services/photoSync';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Total 9 photos: 1 primary (circle) + 8 additional (grid)
// MUST match backend limit in convex/photos.ts (MAX 9 photos)
const TOTAL_SLOTS = 9;
const MAX_PHOTOS = 9; // Backend enforces maximum 9 photos
const GRID_SLOTS = 8; // Additional photos grid slots (indices 1-8)
const MIN_PHOTOS_REQUIRED = 2; // Must have at least 2 photos to continue

// Compute uniform tile size: 3 columns with gaps, portrait aspect ratio
const GRID_PADDING = 16;
const GRID_GAP = 8;
const TILE_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * 2) / 3;
const TILE_HEIGHT = TILE_WIDTH * 1.4; // Portrait aspect ratio

// Primary photo circle size
const PRIMARY_CIRCLE_SIZE = 160;

// Persistent photos directory - files here survive app restarts
const PHOTOS_DIR = FileSystem.documentDirectory + 'mira/photos/';

// Ensure photos directory exists
async function ensurePhotosDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(PHOTOS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  }
}

// Generate unique filename
function generatePhotoFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `photo_${timestamp}_${random}.jpg`;
}

// Copy cache URI to persistent storage
// Returns the persistent URI, or falls back to original if copy fails
async function persistPhoto(cacheUri: string): Promise<string> {
  try {
    await ensurePhotosDir();
    const filename = generatePhotoFilename();
    const persistentUri = PHOTOS_DIR + filename;

    await FileSystem.copyAsync({
      from: cacheUri,
      to: persistentUri,
    });

    if (__DEV__) {
      console.log('[PHOTO] persisted:', { from: cacheUri.slice(-40), to: persistentUri });
    }

    return persistentUri;
  } catch (error) {
    console.error('[PHOTO] Failed to persist photo, using cache URI:', error);
    return cacheUri;
  }
}

export default function AdditionalPhotosScreen() {
  const { photos, setPhotoAtIndex, removePhoto, setStep, displayPhotoVariant, setDisplayPhotoVariant, bio, setBio, clearAllPhotos, verificationReferencePrimary } = useOnboardingStore();
  const { userId } = useAuthStore();
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // BUG FIX: Query backend to get reference photo URL if we only have storageId
  const userQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );

  // Query onboarding status for reference photo existence check (source of truth)
  const onboardingStatus = useQuery(
    api.users.getOnboardingStatus,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );

  // Backend mutations
  const deletePhotoMutation = useMutation(api.photos.deletePhoto);

  // Query backend photos for deletion (get photoIds)
  const backendPhotos = useQuery(
    api.photos.getUserPhotos,
    !isDemoMode && userId ? { userId: userId as Id<'users'> } : 'skip'
  );

  // Sync backend photos to backendUrlByIndex when they load
  useEffect(() => {
    if (backendPhotos !== undefined) {
      setBackendLoadedOnce(true);

      // Map backend photos to slots by order
      const newBackendUrls = Array(TOTAL_SLOTS).fill(null);
      backendPhotos.forEach((photo) => {
        if (photo.order >= 0 && photo.order < TOTAL_SLOTS && photo.url) {
          newBackendUrls[photo.order] = photo.url;
        }
      });
      setBackendUrlByIndex(newBackendUrls);

      if (__DEV__) {
        console.log('[PHOTO_BACKEND] Synced backend photos:', {
          count: backendPhotos.length,
          slots: newBackendUrls.map((url, i) => url ? `[${i}]:✓` : `[${i}]:✗`).join(' '),
        });
      }
    }
  }, [backendPhotos]);

  // PERFORMANCE: Prefetch backend photos for Review screen (memory-only, non-blocking)
  // Deduplicate: Track prefetched URLs to avoid redundant work
  const prefetchedUrls = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isDemoMode && backendPhotos && backendPhotos.length > 0) {
      // Filter out already-prefetched URLs
      const urlsToPrefetch = backendPhotos
        .filter(photo => photo.url && !prefetchedUrls.current.has(photo.url))
        .map(photo => photo.url!);

      // DEV LOG: Show prefetch state for debugging
      if (__DEV__) {
        console.log('[PHOTO_PREFETCH] Prefetch check:', {
          backendPhotosTotal: backendPhotos.length,
          alreadyPrefetched: prefetchedUrls.current.size,
          newUrlsToPrefetch: urlsToPrefetch.length,
        });
      }

      if (urlsToPrefetch.length > 0) {
        if (__DEV__) {
          console.log('[PHOTO_PREFETCH] Starting prefetch for Review screen:', {
            count: urlsToPrefetch.length,
            urls: urlsToPrefetch.map(url => url.substring(0, 50) + '...'),
          });
        }

        // Mark as prefetched immediately to prevent duplicate work
        urlsToPrefetch.forEach(url => prefetchedUrls.current.add(url));

        // Prefetch with concurrency limit = 3 (non-blocking)
        const prefetchWithLimit = async () => {
          const limit = 3;
          for (let i = 0; i < urlsToPrefetch.length; i += limit) {
            const batch = urlsToPrefetch.slice(i, i + limit);
            await Promise.all(
              batch.map(url =>
                Image.prefetch(url).catch(err => {
                  if (__DEV__) console.warn('[PHOTO_PREFETCH] Failed to prefetch:', url, err);
                  // Remove from set so we can retry later
                  prefetchedUrls.current.delete(url);
                })
              )
            );
          }
        };

        prefetchWithLimit().then(() => {
          if (__DEV__) {
            console.log('[PHOTO_PREFETCH] ✓ Prefetch complete - Review photos will load instantly');
          }
        });
      } else if (__DEV__) {
        console.log('[PHOTO_PREFETCH] All backend photos already prefetched (cached in memory)');
      }
    }
  }, [backendPhotos]);

  // CENTRAL EDIT HUB: Detect if editing from Review screen
  const isEditFromReview = params.editFromReview === 'true';

  // Debug log: Photo limit
  React.useEffect(() => {
    if (__DEV__) {
      console.log('[PHOTO_LIMIT] MAX_PHOTOS', MAX_PHOTOS);
    }
  }, []);

  // Full-screen viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Warning state for minimum photos
  const [showPhotoWarning, setShowPhotoWarning] = useState(false);

  // Error state for bio validation
  const [bioError, setBioError] = useState<string | null>(null);

  // DIRTY FLAG: Track if user has manually edited bio to prevent auto-refill loops
  const [bioDirty, setBioDirty] = useState(false);
  // Track if initial prefill has already happened
  const didPrefillPhotos = React.useRef(false);
  const didPrefillBio = React.useRef(false);

  // Prefill photos from demoProfiles - run ONCE on mount when data is ready
  useEffect(() => {
    // Skip if already prefilled or not in demo mode or not hydrated
    if (didPrefillPhotos.current || !isDemoMode || !demoHydrated) return;
    if (!demoProfile?.photos || demoProfile.photos.length === 0) return;

    // Mark as prefilled BEFORE setting to prevent re-runs
    didPrefillPhotos.current = true;

    // Prefill ALL photos from demoProfile (not just when count is 0)
    const savedPhotos = demoProfile.photos.map((p) => p.url);
    let prefilledCount = 0;
    savedPhotos.forEach((uri, idx) => {
      if (uri && idx < TOTAL_SLOTS) {
        // Only prefill if slot is empty in onboardingStore
        const currentSlot = photos[idx];
        if (!(typeof currentSlot === 'string' && currentSlot.length > 0)) {
          setPhotoAtIndex(idx, uri);
          prefilledCount++;
        }
      }
    });
    if (prefilledCount > 0) {
      console.log(`[PHOTOS] prefilled ${prefilledCount} photos from demoProfile`);
    }
  }, [demoHydrated, demoProfile, photos, setPhotoAtIndex]);

  // Prefill bio from demoProfiles - run ONCE on mount if bio is empty and not dirty
  useEffect(() => {
    // Skip if already prefilled, dirty, or not in demo mode
    if (didPrefillBio.current || bioDirty || !isDemoMode || !demoHydrated) return;
    if (!demoProfile?.bio) return;
    // Only prefill if current bio is empty
    if (bio && bio.trim().length > 0) return;

    // Mark as prefilled BEFORE setting to prevent re-runs
    didPrefillBio.current = true;

    setBio(demoProfile.bio);
    console.log('[PHOTOS] prefilled bio from demoProfile');
  }, [demoHydrated, demoProfile, bio, bioDirty, setBio]);

  // LIVE MODE: Sync photos from backend on mount to ensure local store is up-to-date
  // This ensures photos uploaded in earlier screens are available here
  const didSyncPhotos = React.useRef(false);
  useEffect(() => {
    if (didSyncPhotos.current || isDemoMode || !userId) return;
    didSyncPhotos.current = true;

    if (__DEV__) {
      console.log('[PHOTOS] Syncing photos from backend on mount (skipDownload=true for onboarding)...');
    }

    syncPhotosFromBackend(userId, false, true) // skipDownload=true for onboarding
      .then((result) => {
        if (result.success) {
          if (__DEV__) {
            console.log(`[PHOTOS] Sync complete: ${result.photosCount} photos (backend URLs only)`);
          }
        } else {
          console.warn('[PHOTOS] Sync failed:', result.message);
        }
      })
      .catch((error) => {
        console.error('[PHOTOS] Sync error:', error);
      });
  }, [userId]);

  // Per-slot render nonce to force re-render on photo change
  const [slotNonce, setSlotNonce] = useState<number[]>(Array(TOTAL_SLOTS).fill(0));

  // Per-slot error state to fallback to Add Photo placeholder when image fails
  const [slotError, setSlotError] = useState<boolean[]>(Array(TOTAL_SLOTS).fill(false));

  // TASK 2: File existence state - track which photo files actually exist on filesystem
  const [slotFileState, setSlotFileState] = useState<PhotoFileState[]>(Array(TOTAL_SLOTS).fill('empty'));

  // Upload state tracking: 'idle' | 'uploading' | 'uploaded' | 'failed'
  type UploadState = 'idle' | 'uploading' | 'uploaded' | 'failed';
  const [uploadStateByIndex, setUploadStateByIndex] = useState<Record<number, UploadState>>({});

  // Preview URIs: Show selected photos instantly before upload completes (in-memory only)
  const [slotPreviewUriByIndex, setSlotPreviewUriByIndex] = useState<(string | null)[]>(Array(TOTAL_SLOTS).fill(null));

  // Backend URLs: Track just-uploaded photo URLs from Convex (in-memory, refreshed from backend query)
  const [backendUrlByIndex, setBackendUrlByIndex] = useState<(string | null)[]>(Array(TOTAL_SLOTS).fill(null));

  // Track if backend photos have loaded at least once (prevents flicker on empty result during uploads)
  const [backendLoadedOnce, setBackendLoadedOnce] = useState(false);

  const bumpSlot = (i: number) => {
    setSlotNonce((prev) => {
      const next = prev.slice();
      next[i] = (next[i] ?? 0) + 1;
      return next;
    });
  };

  const markSlotError = (i: number, v: boolean) => {
    setSlotError((prev) => {
      const next = prev.slice();
      next[i] = v;
      return next;
    });
  };

  const setUploadState = (index: number, state: UploadState) => {
    setUploadStateByIndex((prev) => ({ ...prev, [index]: state }));
    if (__DEV__) {
      console.log('[PHOTO_UPLOAD] slotStatus update', { index, state });
    }
  };

  // TASK 2: Proactively check file existence for all photo slots
  // This runs when photos array changes to detect missing files BEFORE rendering
  // CRITICAL: We only FLAG missing files - we NEVER delete URIs from AsyncStorage
  React.useEffect(() => {
    async function checkAllPhotos() {
      const states = await Promise.all(
        photos.map((uri) => getPhotoFileState(uri))
      );
      setSlotFileState(states);

      // DEV: Log missing photos for monitoring
      if (__DEV__) {
        const missingCount = states.filter((s) => s === 'missing').length;
        const invalidCount = states.filter((s) => s === 'invalid').length;
        if (missingCount > 0 || invalidCount > 0) {
          console.warn(
            `[PHOTO_GUARD] Found ${missingCount} missing + ${invalidCount} invalid photo files (URIs preserved in storage)`
          );
        }
      }
    }

    checkAllPhotos();
  }, [photos]);

  // Count valid photos from backend + any in-flight uploads/previews
  const backendPhotoCount = backendPhotos?.length ?? 0;
  const pendingPreviewCount = slotPreviewUriByIndex.filter(uri => uri !== null).length;
  const photoCount = backendPhotoCount + pendingPreviewCount;

  // Find first empty slot index (check backend URLs + previews)
  const firstEmptyIndex = Array.from({ length: TOTAL_SLOTS }, (_, i) => i).find(
    i => !backendUrlByIndex[i] && !slotPreviewUriByIndex[i]
  ) ?? TOTAL_SLOTS;

  // ════════════════════════════════════════════════════════════════════════
  // PHASE-1 PROFILE PHOTOS ARE BACKEND-OWNED. LOCAL FILES ARE CACHE ONLY.
  // ════════════════════════════════════════════════════════════════════════
  // HARD LOCK: All Phase-1 profile photos MUST be uploaded to Convex backend
  // immediately when user selects them. Convex storage is the ONLY source of
  // truth. Local file:// URIs are CACHE ONLY for offline preview.
  // ════════════════════════════════════════════════════════════════════════

  // Pick image for a specific slot index with optional crop (4:6 aspect)
  const pickImageForIndex = async (targetIndex: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photos.');
      return;
    }

    // GATE: Check if we've reached the maximum photo limit
    // Allow replacement of existing photos, but not adding beyond limit
    const hasPhotoAtIndex = typeof photos[targetIndex] === 'string' && photos[targetIndex]!.length > 0;
    if (!hasPhotoAtIndex && photoCount >= MAX_PHOTOS) {
      Alert.alert(
        'Maximum Photos Reached',
        `You can upload up to ${MAX_PHOTOS} photos. Remove a photo first to add a new one.`,
        [{ text: 'OK' }]
      );
      console.warn(`[PHOTO_GATE] Photo limit reached: ${photoCount}/${MAX_PHOTOS}`);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images' as const],
      allowsEditing: true, // Show crop screen
      aspect: [2, 3], // Portrait 4x6 aspect ratio
      quality: 0.9,
    });

    if (!result.canceled) {
      const uri = result.assets?.[0]?.uri;
      // Only store if we have a valid URI string
      if (typeof uri === 'string' && uri.length > 0) {
        // Convert content:// URI to stable file:// URI for Android compatibility
        try {
          const normalized = await ImageManipulator.manipulateAsync(
            uri,
            [],
            { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
          );
          const cacheUri = normalized?.uri ?? uri;

          // Set preview URI immediately for instant grid display (in-memory only, no local storage)
          setSlotPreviewUriByIndex((prev) => {
            const next = [...prev];
            next[targetIndex] = cacheUri;
            return next;
          });
          markSlotError(targetIndex, false);

          // Upload to Convex backend IMMEDIATELY (backend is ONLY source of truth)
          if (!isDemoMode && userId) {
            if (__DEV__) console.log(`[PHOTO_ONBOARDING] Uploading slot ${targetIndex} to Convex (no local storage)...`);

            setUploadState(targetIndex, 'uploading');

            const uploadResult = await uploadPhotoToBackend(
              userId,
              cacheUri, // Upload directly from cache, no local copy
              targetIndex === 0, // isPrimary
              targetIndex
            );

            if (!uploadResult.success) {
              setUploadState(targetIndex, 'failed');
              Alert.alert(
                'Upload Failed',
                'Failed to upload photo to server. Please try again.',
                [{ text: 'OK' }]
              );
              console.error('[PHOTO_ONBOARDING] Backend upload failed:', uploadResult.message);
              return;
            }

            setUploadState(targetIndex, 'uploaded');

            // Clear preview - backend will provide URL via query
            setSlotPreviewUriByIndex((prev) => {
              const next = [...prev];
              next[targetIndex] = null;
              return next;
            });

            if (__DEV__) {
              console.log(`[PHOTO_ONBOARDING] ✅ Photo uploaded to Convex: storageId=${uploadResult.storageId}, no local storage`);
            }
          }

          // Bump slot to refresh image component
          bumpSlot(targetIndex);
        } catch (e) {
          console.log('[AdditionalPhotos] normalize failed, using original uri', uri, e);

          // Set preview URI immediately (in-memory only)
          setSlotPreviewUriByIndex((prev) => {
            const next = [...prev];
            next[targetIndex] = uri;
            return next;
          });
          markSlotError(targetIndex, false);

          // Upload to Convex even on normalize failure (no local storage)
          if (!isDemoMode && userId) {
            setUploadState(targetIndex, 'uploading');
            const uploadResult = await uploadPhotoToBackend(
              userId,
              uri, // Upload directly, no local copy
              targetIndex === 0,
              targetIndex
            );
            if (!uploadResult.success) {
              setUploadState(targetIndex, 'failed');
              Alert.alert('Upload Failed', 'Please try again.');
              return;
            }
            setUploadState(targetIndex, 'uploaded');

            // Clear preview after upload
            setSlotPreviewUriByIndex((prev) => {
              const next = [...prev];
              next[targetIndex] = null;
              return next;
            });
          }

          bumpSlot(targetIndex);
        }

        // Close viewer if open
        if (viewerOpen) {
          setViewerOpen(false);
          setViewerIndex(null);
        }
      } else {
        console.log('[AdditionalPhotos] Invalid URI from picker:', uri);
      }
    }
  };

  // Take photo with camera for a specific slot
  // HARD LOCK: Camera photos MUST be uploaded to Convex immediately (same as gallery)
  const takePhotoForIndex = async (targetIndex: number) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow camera access to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [2, 3], // Portrait 4x6 aspect ratio
      quality: 0.9,
    });

    if (!result.canceled) {
      const uri = result.assets?.[0]?.uri;
      if (typeof uri === 'string' && uri.length > 0) {
        try {
          const normalized = await ImageManipulator.manipulateAsync(
            uri,
            [],
            { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
          );
          const cacheUri = normalized?.uri ?? uri;

          // Set preview URI immediately for instant grid display (in-memory only, no local storage)
          setSlotPreviewUriByIndex((prev) => {
            const next = [...prev];
            next[targetIndex] = cacheUri;
            return next;
          });
          markSlotError(targetIndex, false);

          // Upload to Convex backend IMMEDIATELY (backend is ONLY source of truth)
          if (!isDemoMode && userId) {
            if (__DEV__) console.log(`[PHOTO_ONBOARDING] Uploading camera photo slot ${targetIndex} to Convex (no local storage)...`);

            setUploadState(targetIndex, 'uploading');

            const uploadResult = await uploadPhotoToBackend(
              userId,
              cacheUri, // Upload directly from cache, no local copy
              targetIndex === 0,
              targetIndex
            );

            if (!uploadResult.success) {
              setUploadState(targetIndex, 'failed');
              Alert.alert('Upload Failed', 'Failed to upload photo to server. Please try again.');
              console.error('[PHOTO_ONBOARDING] Camera photo upload failed:', uploadResult.message);
              return;
            }

            setUploadState(targetIndex, 'uploaded');

            // Clear preview - backend will provide URL via query
            setSlotPreviewUriByIndex((prev) => {
              const next = [...prev];
              next[targetIndex] = null;
              return next;
            });

            if (__DEV__) {
              console.log(`[PHOTO_ONBOARDING] ✅ Camera photo uploaded: storageId=${uploadResult.storageId}, no local storage`);
            }
          }

          // Bump slot to refresh image component
          bumpSlot(targetIndex);
        } catch (e) {
          console.log('[AdditionalPhotos] normalize failed, using original uri', uri, e);

          // Set preview URI immediately (in-memory only)
          setSlotPreviewUriByIndex((prev) => {
            const next = [...prev];
            next[targetIndex] = uri;
            return next;
          });
          markSlotError(targetIndex, false);

          // Upload even on error (no local storage)
          if (!isDemoMode && userId) {
            setUploadState(targetIndex, 'uploading');
            const uploadResult = await uploadPhotoToBackend(userId, uri, targetIndex === 0, targetIndex);
            if (!uploadResult.success) {
              setUploadState(targetIndex, 'failed');
              Alert.alert('Upload Failed', 'Please try again.');
              return;
            }
            setUploadState(targetIndex, 'uploaded');

            // Clear preview after upload
            setSlotPreviewUriByIndex((prev) => {
              const next = [...prev];
              next[targetIndex] = null;
              return next;
            });
          }

          bumpSlot(targetIndex);
        }

        if (viewerOpen) {
          setViewerOpen(false);
          setViewerIndex(null);
        }
      }
    }
  };

  // Show action sheet for photo selection (primary photo)
  const showPhotoActionSheet = (targetIndex: number) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Gallery'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            takePhotoForIndex(targetIndex);
          } else if (buttonIndex === 2) {
            pickImageForIndex(targetIndex);
          }
        }
      );
    } else {
      Alert.alert(
        'Add Photo',
        'Choose source',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Take Photo', onPress: () => takePhotoForIndex(targetIndex) },
          { text: 'Choose from Gallery', onPress: () => pickImageForIndex(targetIndex) },
        ]
      );
    }
  };

  // Handle tap on primary photo circle
  const handlePrimaryPhotoPress = () => {
    const primaryPhoto = photos[0];
    if (typeof primaryPhoto === 'string' && primaryPhoto.length > 0) {
      // Photo exists - open full-screen viewer
      setViewerIndex(0);
      setViewerOpen(true);
    } else {
      // No photo - show action sheet
      showPhotoActionSheet(0);
    }
  };

  // Handle tap on a photo tile (for grid slots 1-8)
  const handlePhotoPress = (index: number) => {
    const photo = photos[index];
    if (typeof photo === 'string' && photo.length > 0) {
      // Photo exists - open full-screen viewer
      setViewerIndex(index);
      setViewerOpen(true);
    } else {
      // Empty slot - always fill the FIRST empty slot (not the tapped one)
      const targetIndex = firstEmptyIndex !== -1 ? firstEmptyIndex : index;
      pickImageForIndex(targetIndex);
    }
  };

  // Handle replace from viewer
  const handleReplace = () => {
    if (viewerIndex !== null) {
      pickImageForIndex(viewerIndex);
    }
  };

  // Handle remove from viewer
  const handleRemove = () => {
    if (viewerIndex !== null) {
      const indexToRemove = viewerIndex;

      if (__DEV__) {
        console.log('[PHOTOS_UI] removePressed', { index: indexToRemove });
      }

      Alert.alert(
        'Remove Photo?',
        'Are you sure you want to remove this photo?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                // Remove from backend if not in demo mode
                if (!isDemoMode && userId && backendPhotos) {
                  // Find the backend photo at this order/index
                  const photoToDelete = backendPhotos.find((p) => p.order === indexToRemove);

                  if (photoToDelete) {
                    if (__DEV__) {
                      console.log('[PHOTOS_UI] Deleting photo from backend:', {
                        photoId: photoToDelete._id,
                        order: indexToRemove,
                      });
                    }

                    await deletePhotoMutation({
                      userId: userId as Id<'users'>,
                      photoId: photoToDelete._id,
                    });

                    // Sync photos from backend to refresh UI
                    if (__DEV__) {
                      console.log('[PHOTOS_UI] Syncing photos after deletion (skipDownload=true for onboarding)...');
                    }
                    await syncPhotosFromBackend(userId, false, true); // skipDownload=true for onboarding

                    if (__DEV__) {
                      console.log('[PHOTOS_UI] removeSuccess', { index: indexToRemove });
                    }
                  } else {
                    console.warn('[PHOTOS_UI] Photo not found in backend at index:', indexToRemove);
                  }
                }

                // Remove from local store (demo mode or as fallback)
                removePhoto(indexToRemove);

                // Close viewer
                setViewerOpen(false);
                setViewerIndex(null);
              } catch (error) {
                console.error('[PHOTOS_UI] Remove failed:', error);
                Alert.alert('Error', 'Failed to remove photo. Please try again.');
              }
            },
          },
        ]
      );
    }
  };

  // Handle close viewer
  const handleCloseViewer = () => {
    setViewerOpen(false);
    setViewerIndex(null);
  };

  // DEV: Reset all photos (for testing stale cache migration)
  const handleResetPhotos = () => {
    Alert.alert(
      'Reset Photos',
      'This will clear ALL photos from onboardingStore and demoProfile. You will need to re-select photos.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            // Clear onboardingStore photos
            clearAllPhotos();
            // Clear demoProfile photos if in demo mode
            if (isDemoMode && userId) {
              useDemoStore.getState().saveDemoProfile(userId, { photos: [] });
            }
            console.log('[PHOTO] DEV: All photos cleared');
          },
        },
      ]
    );
  };

  const handleNext = () => {
    // Check upload state gates
    const uploadingCount = Object.values(uploadStateByIndex).filter(state => state === 'uploading').length;
    const failedCount = Object.values(uploadStateByIndex).filter(state => state === 'failed').length;

    if (__DEV__) {
      console.log('[PHOTO_UPLOAD] stateGate', { uploadingCount, failedCount });
    }

    // Gate 1: Uploading in progress
    if (!isDemoMode && uploadingCount > 0) {
      Alert.alert(
        'Uploading Photos',
        'Still uploading photos to server. Please wait...',
        [{ text: 'OK' }]
      );
      return;
    }

    // Gate 2: Failed uploads
    if (!isDemoMode && failedCount > 0) {
      Alert.alert(
        'Upload Failed',
        'Some photos failed to upload. Tap them to retry.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Gate 3: Backend truth check - ensure backend count matches local count
    if (!isDemoMode && backendPhotos !== undefined) {
      const localFilledCount = photos.filter(p => typeof p === 'string' && p.length > 0).length;
      const backendNormalCount = backendPhotos.length;

      if (__DEV__) {
        console.log('[PHOTO_UPLOAD] backendGate', { localFilledCount, backendNormalCount });
      }

      if (backendNormalCount < localFilledCount) {
        Alert.alert(
          'Syncing Photos',
          'Still syncing uploads. Please wait a moment.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    // DEBUG: Log state before validation
    if (__DEV__) {
      console.log('[PHOTO_GATE] Continue pressed', {
        photoCount,
        photos: photos.map((p, i) => `[${i}]: ${p ? 'exists' : 'null'}`),
        MIN_PHOTOS_REQUIRED,
      });
    }

    // Gate: minimum 2 photos required
    // BUG FIX: Account for reference photo in effective count (matches backend logic)
    // effectivePhotoCount = normal photos + reference photo (if exists)
    const effectivePhotoCount = photoCount + (hasReferencePhoto ? 1 : 0);

    if (effectivePhotoCount < MIN_PHOTOS_REQUIRED) {
      console.warn(`[PHOTO_GATE] Blocked: effectivePhotoCount=${effectivePhotoCount} < MIN_PHOTOS_REQUIRED=${MIN_PHOTOS_REQUIRED}`);
      console.warn('[PHOTO_GATE] Photo breakdown:', { normalPhotoCount: photoCount, hasReferencePhoto, effectivePhotoCount });
      setShowPhotoWarning(true);
      return;
    }

    // BUG FIX: Log when reference photo allows bypass of "Photo Required" warning
    if (hasReferencePhoto && photoCount < MIN_PHOTOS_REQUIRED) {
      if (__DEV__) {
        console.log('[PHOTO_REQUIRED_BLOCKED] referenceExists=true, bypassing normal photo requirement', {
          normalPhotoCount: photoCount,
          hasReferencePhoto,
          effectivePhotoCount,
          note: 'Reference photo counts toward MIN_PHOTOS_REQUIRED',
        });
      }
    }

    if (__DEV__) {
      console.log(`[PHOTO_GATE] Passed: effectivePhotoCount=${effectivePhotoCount} >= MIN_PHOTOS_REQUIRED=${MIN_PHOTOS_REQUIRED}`, {
        normalPhotos: photoCount,
        referencePhoto: hasReferencePhoto ? 1 : 0,
      });
    }

    // Gate: bio is mandatory
    const trimmedBio = bio.trim();
    if (!trimmedBio) {
      setBioError('Write your bio to continue.');
      return;
    }

    // Clear warnings/errors if we passed all checks
    setShowPhotoWarning(false);
    setBioError(null);

    // SAVE-AS-YOU-GO: Persist photos + bio to demoProfiles immediately
    if (isDemoMode && userId) {
      const validPhotos = photos.filter((p): p is string => typeof p === 'string' && p.length > 0);
      const demoStore = useDemoStore.getState();
      demoStore.saveDemoProfile(userId, {
        photos: validPhotos.map((uri) => ({ url: uri })),
        bio: trimmedBio,
      });
      console.log(`[PHOTOS] saved ${validPhotos.length} photos + bio to demoProfile`);
    }

    // CENTRAL EDIT HUB: Return to Review if editing from there
    if (isEditFromReview) {
      if (__DEV__) console.log('[ONB] additional-photos → review (editFromReview)');
      router.replace('/(onboarding)/review' as any);
      return;
    }

    // Skip bio screen - go directly to permissions
    // CRITICAL: Navigation MUST happen unconditionally after validation passes
    if (__DEV__) {
      console.log('[PHOTO_GATE] All validations passed. Navigating to permissions...');
      console.log('[ONB] additional-photos → permissions (continue)');
    }
    setStep('permissions');
    router.push('/(onboarding)/permissions');
  };

  // Render additional photos grid (indices 1-8 only, primary is shown separately)
  const renderPhotoGrid = () => {
    const grid = [];

    // Count filled additional slots (indices 1-8) from backend + previews
    const filledAdditionalSlots = Array.from({ length: GRID_SLOTS }, (_, i) => i + 1).filter(
      i => backendUrlByIndex[i] || slotPreviewUriByIndex[i]
    ).length;

    // Log max check
    if (__DEV__) {
      console.log('[PHOTOS_UI] maxCheck', {
        normalPhotoCount: photoCount,
        atMax: photoCount >= MAX_PHOTOS,
      });
      console.log('[PHOTOS_UI] render additional slots', {
        filled: filledAdditionalSlots,
        totalAdditionalSlots: GRID_SLOTS,
      });
    }

    // Start from index 1 (skip primary photo which is shown in circle)
    for (let i = 1; i <= GRID_SLOTS; i++) {
      const backendUrl = backendUrlByIndex[i]; // Backend URL from Convex (source of truth)
      const previewUri = slotPreviewUriByIndex[i]; // Temporary preview during upload
      const uriToShow = previewUri ?? backendUrl; // Prefer preview (instant), fallback to backend
      const hasUri = typeof uriToShow === 'string' && uriToShow.length > 0;
      // Show photo if we have preview OR backend URL
      const showPhoto = hasUri && !slotError[i];
      const isMissing = false; // No file state check needed - backend URLs are always valid

      // Upload state for this slot
      const uploadState = uploadStateByIndex[i] || 'idle';
      const isUploading = uploadState === 'uploading';
      const isFailed = uploadState === 'failed';

      // Determine press behavior - allow retry on failed
      const handlePress = isFailed
        ? () => pickImageForIndex(i) // Retry upload
        : showPhoto
        ? () => handlePhotoPress(i)
        : () => pickImageForIndex(i);

      grid.push(
        <TouchableOpacity
          key={`slot-${i}`}
          style={[styles.photoItem, styles.addPhotoButton]}
          onPress={handlePress}
          activeOpacity={showPhoto ? 0.8 : 0.7}
        >
          {/* BASE LAYER: Always render placeholder */}
          <View style={styles.placeholderContent}>
            <Ionicons name={isMissing ? "alert-circle" : "add"} size={22} color={isMissing ? COLORS.error : COLORS.textLight} />
            <Text style={[styles.addPhotoText, isMissing && { color: COLORS.error }]}>
              {isMissing ? "Re-upload" : "Add"}
            </Text>
          </View>

          {/* OVERLAY LAYER: Render image on top if we have a valid photo */}
          {showPhoto && (
            <>
              {(() => {
                const nonce = slotNonce[i] ?? 0;
                const renderKey = `${uriToShow}::${nonce}`;
                return (
                  <Image
                    key={renderKey}
                    recyclingKey={renderKey}
                    source={{ uri: uriToShow }}
                    cachePolicy="memory-disk"
                    style={[StyleSheet.absoluteFillObject, styles.photoImage]}
                    contentFit="cover"
                    onLoad={() => markSlotError(i, false)}
                    onError={() => {
                      console.log('[AdditionalPhotos] image load error slot=', i);
                      markSlotError(i, true);
                      bumpSlot(i);
                    }}
                  />
                );
              })()}

              {/* Upload State Overlay */}
              {(isUploading || isFailed) && (
                <View style={styles.uploadStateOverlay}>
                  <View style={styles.uploadStateContent}>
                    {isUploading && (
                      <>
                        <Ionicons name="cloud-upload" size={16} color={COLORS.white} />
                        <Text style={styles.uploadStateText}>Uploading...</Text>
                      </>
                    )}
                    {isFailed && (
                      <>
                        <Ionicons name="alert-circle" size={16} color={COLORS.error} />
                        <Text style={styles.uploadStateTextFailed}>Failed • Tap to retry</Text>
                      </>
                    )}
                  </View>
                </View>
              )}

              <View style={styles.photoOverlay}>
                <Ionicons name="expand-outline" size={14} color={COLORS.white} />
              </View>
            </>
          )}
        </TouchableOpacity>
      );
    }
    return grid;
  };

  // Privacy options data
  const privacyOptions = [
    {
      id: 'original' as DisplayPhotoVariant,
      title: 'Show Original',
      description: 'Display your verified photo as-is. Others will see your real photo.',
      icon: 'person-circle' as const,
    },
    {
      id: 'blurred' as DisplayPhotoVariant,
      title: 'Blur My Photo',
      description: 'Apply a privacy blur. Your identity is verified but hidden until you match.',
      icon: 'eye-off' as const,
    },
    {
      id: 'cartoon' as DisplayPhotoVariant,
      title: 'Cartoon Avatar',
      description: 'Coming soon! Use an AI-generated avatar for your privacy.',
      icon: 'happy' as const,
      disabled: true,
    },
  ];

  // Primary photo source priority:
  // 1) Normal photo from backend (slot 0), else
  // 2) Temporary preview during upload, else
  // 3) Verification reference photo (from face verification), else
  // 4) Empty placeholder
  const referencePhotoUrl = userQuery?.verificationReferencePhotoUrl || verificationReferencePrimary?.url || '';
  const hasReferencePhotoUrl = referencePhotoUrl.length > 0;
  const hasReferencePhotoId = !!verificationReferencePrimary || !!userQuery?.verificationReferencePhotoId;
  // Use backend onboarding status as source of truth for reference photo existence
  const referencePhotoExistsBackend = onboardingStatus?.referencePhotoExists ?? false;
  // Consider reference photo valid if backend says it exists OR we have a URL to display
  const hasReferencePhoto = referencePhotoExistsBackend || hasReferencePhotoUrl;

  const normalPrimaryBackendUrl = backendUrlByIndex[0]; // Backend URL for slot 0
  const normalPrimaryPreview = slotPreviewUriByIndex[0]; // Temporary preview during upload
  const normalPrimaryPhoto = normalPrimaryPreview ?? normalPrimaryBackendUrl; // Prefer preview, fallback to backend
  const hasNormalPrimary = typeof normalPrimaryPhoto === 'string' && normalPrimaryPhoto.length > 0;
  const normalPrimaryExists = hasNormalPrimary; // Backend URLs are always valid

  // Determine which photo to use as primary
  const primaryPhoto = hasNormalPrimary ? normalPrimaryPhoto : (hasReferencePhoto ? referencePhotoUrl : null);
  const hasPrimaryPhoto = hasNormalPrimary || hasReferencePhoto;
  const primaryPhotoExists = normalPrimaryExists || hasReferencePhoto;
  const primaryPhotoMissing = false; // No file state check needed for backend URLs
  const primarySource = hasNormalPrimary ? 'normal' : (hasReferencePhoto ? 'reference' : 'none');

  // Upload state for primary photo (only relevant for normal photos)
  const primaryUploadState = uploadStateByIndex[0] || 'idle';
  const primaryIsUploading = primaryUploadState === 'uploading';
  const primaryIsFailed = primaryUploadState === 'failed';

  // Log primary photo source for debugging
  React.useEffect(() => {
    if (__DEV__) {
      console.log('[PHOTO_UI_PRIMARY]', {
        source: primarySource,
        hasNormalPrimary,
        hasReferencePhoto,
        primaryPhotoExists,
      });
    }
  }, [primarySource, hasNormalPrimary, hasReferencePhoto, primaryPhotoExists]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OnboardingProgressHeader />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.title}>Your Photos</Text>
        <Text style={styles.subtitle}>Add up to {MAX_PHOTOS} photos to show more of yourself.</Text>

        {/* Primary Photo Circle */}
        <View style={styles.primarySection}>
          <TouchableOpacity
            style={styles.primaryCircle}
            onPress={primaryIsFailed ? () => pickImageForIndex(0) : handlePrimaryPhotoPress}
            activeOpacity={0.8}
          >
            {primaryPhotoExists && !slotError[0] ? (
              <>
                <Image
                  source={{ uri: primaryPhoto ?? undefined }}
                  style={styles.primaryImage}
                  contentFit="cover"
                  blurRadius={displayPhotoVariant === 'blurred' ? 15 : 0}
                />
                {/* Upload State Overlay for Primary Photo */}
                {(primaryIsUploading || primaryIsFailed) && (
                  <View style={[styles.uploadStateOverlay, styles.primaryUploadOverlay]}>
                    <View style={styles.uploadStateContent}>
                      {primaryIsUploading && (
                        <>
                          <Ionicons name="cloud-upload" size={20} color={COLORS.white} />
                          <Text style={styles.uploadStateText}>Uploading...</Text>
                        </>
                      )}
                      {primaryIsFailed && (
                        <>
                          <Ionicons name="alert-circle" size={20} color={COLORS.error} />
                          <Text style={styles.uploadStateTextFailed}>Failed • Tap to retry</Text>
                        </>
                      )}
                    </View>
                  </View>
                )}
              </>
            ) : primaryPhotoMissing ? (
              <View style={styles.primaryPlaceholder}>
                <Ionicons name="alert-circle" size={32} color={COLORS.error} />
                <Text style={[styles.primaryAddText, { color: COLORS.error }]}>File Missing</Text>
                <Text style={styles.primaryMissingHint}>Tap to re-upload</Text>
              </View>
            ) : (
              <View style={styles.primaryPlaceholder}>
                <Ionicons name="add" size={32} color={COLORS.primary} />
                <Text style={styles.primaryAddText}>Add Photo</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.primaryLabel}>Primary Photo</Text>
        </View>

        {/* DEV: Reset Photos button */}
        {__DEV__ && (
          <TouchableOpacity
            style={{
              marginHorizontal: 16,
              marginBottom: 16,
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: COLORS.error,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
            onPress={handleResetPhotos}
          >
            <Ionicons name="trash-outline" size={18} color={COLORS.error} />
            <Text style={{ color: COLORS.error, fontWeight: '600', fontSize: 14 }}>
              Reset Photos (DEV)
            </Text>
          </TouchableOpacity>
        )}

        {/* Bio Section */}
        <View style={styles.bioSection}>
          <Text style={styles.sectionTitle}>About You</Text>
          <TextInput
            style={[styles.bioInput, bioError && styles.bioInputError]}
            value={bio}
            onChangeText={(text) => {
              setBio(text);
              // Mark as dirty - user has manually edited
              if (!bioDirty) setBioDirty(true);
              // Clear error when user types
              if (bioError) setBioError(null);
            }}
            placeholder="Write a short bio about yourself…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={3}
            maxLength={VALIDATION.BIO_MAX_LENGTH}
            textAlignVertical="top"
          />
          <View style={styles.bioFooter}>
            {bioError ? (
              <Text style={styles.bioErrorText}>{bioError}</Text>
            ) : (
              <View />
            )}
            <Text style={styles.bioCharCount}>
              {bio.length}/{VALIDATION.BIO_MAX_LENGTH}
            </Text>
          </View>
        </View>

        {/* Privacy Options */}
        <View style={styles.privacySection}>
          <Text style={styles.sectionTitle}>Display Options</Text>
          {privacyOptions.map((option) => {
            const isSelected = displayPhotoVariant === option.id;
            const isDisabled = option.disabled;
            return (
              <TouchableOpacity
                key={option.id}
                style={[
                  styles.privacyOption,
                  isSelected && styles.privacyOptionSelected,
                  isDisabled && styles.privacyOptionDisabled,
                ]}
                onPress={() => !isDisabled && setDisplayPhotoVariant(option.id)}
                disabled={isDisabled}
              >
                <View style={[styles.privacyIcon, isSelected && styles.privacyIconSelected]}>
                  <Ionicons
                    name={option.icon}
                    size={20}
                    color={isSelected ? COLORS.white : COLORS.primary}
                  />
                </View>
                <View style={styles.privacyContent}>
                  <View style={styles.privacyHeader}>
                    <Text style={[styles.privacyTitle, isDisabled && styles.privacyTitleDisabled]}>
                      {option.title}
                    </Text>
                    {isDisabled && (
                      <View style={styles.comingSoonBadge}>
                        <Text style={styles.comingSoonText}>Soon</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.privacyDescription}>{option.description}</Text>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Additional Photos Grid */}
        <View style={styles.gridSection}>
          <Text style={styles.sectionTitle}>Additional Photos</Text>
          {photoCount >= MAX_PHOTOS ? (
            <Text style={styles.photoHelperTextMax}>
              Maximum reached ({photoCount}/{MAX_PHOTOS}). Remove one to add.
            </Text>
          ) : (
            <Text style={styles.photoHelperText}>
              You can add up to {MAX_PHOTOS} photos (1 primary + {GRID_SLOTS} additional).
            </Text>
          )}
          <View style={styles.photoGrid}>{renderPhotoGrid()}</View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          {/* Inline warning when trying to proceed with < 2 photos */}
          {showPhotoWarning && (
            <View style={styles.warningBanner}>
              <Ionicons name="warning" size={16} color={COLORS.error} />
              <Text style={styles.warningText}>Add at least {MIN_PHOTOS_REQUIRED} photos to continue.</Text>
            </View>
          )}
          <Button
            title="Continue"
            variant="primary"
            onPress={handleNext}
            fullWidth
          />
          {photoCount < MIN_PHOTOS_REQUIRED && !showPhotoWarning && (
            <Text style={styles.hint}>Add at least {MIN_PHOTOS_REQUIRED} photos to continue</Text>
          )}
        </View>
      </ScrollView>

      {/* Full-screen photo viewer modal */}
      <Modal
        visible={viewerOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseViewer}
      >
        <View style={styles.viewerContainer}>
          {/* Close button at top */}
          <TouchableOpacity style={styles.viewerCloseButton} onPress={handleCloseViewer}>
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>

          {/* Photo display */}
          {viewerIndex !== null && (backendUrlByIndex[viewerIndex] || slotPreviewUriByIndex[viewerIndex]) && (
            <Image
              source={{ uri: (slotPreviewUriByIndex[viewerIndex] ?? backendUrlByIndex[viewerIndex])! }}
              style={styles.viewerImage}
              contentFit="contain"
            />
          )}

          {/* Primary badge in viewer */}
          {viewerIndex === 0 && (
            <View style={styles.viewerPrimaryBadge}>
              <Text style={styles.viewerPrimaryText}>Primary Photo</Text>
            </View>
          )}

          {/* Action buttons at bottom */}
          <View style={styles.viewerActions}>
            <TouchableOpacity style={styles.viewerActionButton} onPress={handleReplace}>
              <Ionicons name="swap-horizontal" size={24} color={COLORS.white} />
              <Text style={styles.viewerActionText}>Replace</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.viewerActionButton} onPress={handleRemove}>
              <Ionicons name="trash-outline" size={24} color={COLORS.error} />
              <Text style={[styles.viewerActionText, { color: COLORS.error }]}>Remove</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.viewerActionButton} onPress={handleCloseViewer}>
              <Ionicons name="close-circle-outline" size={24} color={COLORS.white} />
              <Text style={styles.viewerActionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: GRID_PADDING,
    paddingTop: 8,
    paddingBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 10,
  },
  // Primary photo circle section
  primarySection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  primaryCircle: {
    width: PRIMARY_CIRCLE_SIZE,
    height: PRIMARY_CIRCLE_SIZE,
    borderRadius: PRIMARY_CIRCLE_SIZE / 2,
    borderWidth: 3,
    borderColor: COLORS.primary,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  primaryImage: {
    width: '100%',
    height: '100%',
  },
  primaryPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryAddText: {
    fontSize: 11,
    color: COLORS.primary,
    marginTop: 4,
    fontWeight: '500',
  },
  primaryMissingHint: {
    fontSize: 9,
    color: COLORS.textLight,
    marginTop: 2,
  },
  primaryLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 8,
    fontWeight: '500',
  },
  // Bio section
  bioSection: {
    marginBottom: 16,
  },
  bioInput: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bioInputError: {
    borderColor: COLORS.error,
    borderWidth: 2,
  },
  bioFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  bioErrorText: {
    fontSize: 12,
    color: COLORS.error,
    fontWeight: '500',
  },
  bioCharCount: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  // Privacy options section
  privacySection: {
    marginBottom: 20,
  },
  privacyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  privacyOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight + '20',
  },
  privacyOptionDisabled: {
    opacity: 0.6,
  },
  privacyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  privacyIconSelected: {
    backgroundColor: COLORS.primary,
  },
  privacyContent: {
    flex: 1,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  privacyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  privacyTitleDisabled: {
    color: COLORS.textLight,
  },
  privacyDescription: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
    lineHeight: 14,
  },
  comingSoonBadge: {
    backgroundColor: COLORS.textMuted,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  comingSoonText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: '600',
  },
  // Grid section
  gridSection: {
    marginBottom: 16,
  },
  photoHelperText: {
    fontSize: 11,
    color: COLORS.textLight,
    marginBottom: 8,
    lineHeight: 14,
  },
  photoHelperTextMax: {
    fontSize: 11,
    color: COLORS.error,
    marginBottom: 8,
    lineHeight: 14,
    fontWeight: '500',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  photoItem: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  photoOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 6,
    padding: 2,
  },
  uploadStateOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadStateContent: {
    alignItems: 'center',
    gap: 4,
  },
  uploadStateText: {
    fontSize: 10,
    color: COLORS.white,
    fontWeight: '600',
    textAlign: 'center',
  },
  uploadStateTextFailed: {
    fontSize: 10,
    color: COLORS.error,
    fontWeight: '600',
    textAlign: 'center',
  },
  primaryUploadOverlay: {
    borderRadius: PRIMARY_CIRCLE_SIZE / 2,
  },
  addPhotoButton: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoText: {
    fontSize: 9,
    color: COLORS.textLight,
    marginTop: 2,
  },
  photoImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  // Footer
  footer: {
    paddingTop: 12,
  },
  hint: {
    fontSize: 10,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 4,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error + '40',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    gap: 8,
  },
  warningText: {
    fontSize: 13,
    color: COLORS.error,
    fontWeight: '500',
    flex: 1,
  },
  // Viewer modal styles
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerCloseButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  viewerImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65,
  },
  viewerPrimaryBadge: {
    position: 'absolute',
    top: 100,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  viewerPrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  viewerActions: {
    position: 'absolute',
    bottom: 50,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
  },
  viewerActionButton: {
    alignItems: 'center',
    padding: 12,
  },
  viewerActionText: {
    color: COLORS.white,
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
});
