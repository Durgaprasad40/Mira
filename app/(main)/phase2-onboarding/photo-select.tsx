/**
 * Phase 2 Onboarding - Step 2: Photo Selection (9-slot grid)
 *
 * Shows a 3x3 grid prefilled with Phase 1 photos. User can toggle selection
 * and upload new photos to empty slots. Must select at least 2 to continue.
 *
 * IMPORTANT:
 * - Owner always sees photos CLEAR (no blur applied here)
 * - blurMyPhoto toggle stores preference (blur applied when OTHERS view)
 * - Demo mode never calls Convex
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Dimensions,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Paths, File as ExpoFile, Directory } from 'expo-file-system';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore, selectCanContinuePhotos } from '@/stores/privateProfileStore';

// Permanent storage directory name for private profile photos
const PRIVATE_PHOTOS_DIR_NAME = 'private_photos';

/**
 * Get the private photos directory
 */
function getPrivatePhotosDir(): Directory {
  return new Directory(Paths.document, PRIVATE_PHOTOS_DIR_NAME);
}

const C = INCOGNITO_COLORS;
const GRID_SIZE = 9;
const MIN_SELECTED = 2;
const COLUMNS = 3;
const GRID_GAP = 8;
const SCREEN_PADDING = 16;
const screenWidth = Dimensions.get('window').width;
const slotSize = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

/**
 * Validate a photo URL is usable
 * MUST be: string, non-empty, not "undefined"/"null", starts with http or file://
 */
function isValidPhotoUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.length > 0 &&
    url !== 'undefined' &&
    url !== 'null' &&
    (url.startsWith('http') || url.startsWith('file://'))
  );
}

/**
 * Check if a URI is already in permanent storage (documentDirectory)
 */
function isInPermanentStorage(uri: string): boolean {
  return uri.includes(PRIVATE_PHOTOS_DIR_NAME) || uri.includes(Paths.document.uri);
}

/**
 * Copy a photo from cache/temporary location to permanent storage
 * Uses expo-file-system v19 class-based API (Paths, File, Directory)
 */
async function copyToPermamentStorage(sourceUri: string, index: number): Promise<string> {
  // Skip if already in permanent storage or is a remote URL
  if (isInPermanentStorage(sourceUri) || sourceUri.startsWith('http')) {
    return sourceUri;
  }

  try {
    // Ensure directory exists
    const privateDir = getPrivatePhotosDir();
    if (!privateDir.exists) {
      privateDir.create();
    }

    // Generate unique filename
    const timestamp = Date.now();
    const extension = sourceUri.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `photo_${timestamp}_${index}.${extension}`;
    const destFile = new ExpoFile(privateDir, filename);

    // Check if destination already exists (avoid duplicate copies)
    if (destFile.exists) {
      return destFile.uri;
    }

    // Copy the file
    const sourceFile = new ExpoFile(sourceUri);
    sourceFile.copy(destFile);

    return destFile.uri;
  } catch (error) {
    if (__DEV__) {
      console.error('[PhotoSelect] Copy failed:', error);
    }
    // Return original URI as fallback (risky but better than nothing)
    return sourceUri;
  }
}

/**
 * Copy multiple photos to permanent storage
 */
async function copyAllToPermanentStorage(uris: string[]): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < uris.length; i++) {
    const newUri = await copyToPermamentStorage(uris[i], i);
    results.push(newUri);
  }
  return results;
}

interface PhotoCandidate {
  id: string;
  uri: string;
  source: 'phase1' | 'uploaded';
}

export default function Phase2PhotoSelect() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Track if we've already processed Phase-1 photos
  const hasImportedRef = useRef(false);

  // Store state (Phase-1 photos already imported by terms screen)
  const phase1PhotoUrls = usePrivateProfileStore((s) => s.phase1PhotoUrls);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const blurMyPhoto = usePrivateProfileStore((s) => s.blurMyPhoto);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setBlurMyPhoto = usePrivateProfileStore((s) => s.setBlurMyPhoto);

  // Use the selector for validation
  const canContinueFromStore = usePrivateProfileStore(selectCanContinuePhotos);

  // Local state for uploaded photos (not from Phase 1)
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  // Track failed image loads
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  // Loading state for initial import
  const [isImporting, setIsImporting] = useState(true);

  /**
   * Auto-select Phase-1 photos on mount
   * Phase-1 data is already imported by the terms screen (index.tsx)
   * This effect just auto-selects photos from the already-imported phase1PhotoUrls
   */
  useEffect(() => {
    // Skip if already processed
    if (hasImportedRef.current) {
      setIsImporting(false);
      return;
    }

    // Get valid Phase-1 photos from store (already imported by terms screen)
    const safePhase1Photos = Array.isArray(phase1PhotoUrls) ? phase1PhotoUrls : [];
    const validUrls = safePhase1Photos.filter(isValidPhotoUrl);

    if (__DEV__) {
      console.log('[Phase2PhotoSelect] Phase-1 photos from store:', {
        total: safePhase1Photos.length,
        valid: validUrls.length,
      });
    }

    // Auto-select all Phase-1 photos initially if none selected
    const currentSelectedCount = Array.isArray(selectedPhotoUrls) ? selectedPhotoUrls.length : 0;
    if (currentSelectedCount === 0 && validUrls.length > 0) {
      setSelectedPhotos([], validUrls);
    }

    hasImportedRef.current = true;
    setIsImporting(false);
  }, [phase1PhotoUrls, selectedPhotoUrls, setSelectedPhotos]);

  /**
   * Build candidate photos list: Phase 1 photos + uploaded photos
   * - Filter out invalid URLs
   * - Filter out failed images
   * - Deduplicate
   * - NEVER return blank entries
   */
  const candidates: PhotoCandidate[] = useMemo(() => {
    const result: PhotoCandidate[] = [];
    const seen = new Set<string>();

    // DEFENSIVE: Ensure arrays are iterable (may be null/undefined after hydration)
    const safePhase1Photos = Array.isArray(phase1PhotoUrls) ? phase1PhotoUrls : [];
    const safeUploadedPhotos = Array.isArray(uploadedPhotos) ? uploadedPhotos : [];

    // First, add Phase 1 photos
    for (const url of safePhase1Photos) {
      if (isValidPhotoUrl(url) && !seen.has(url) && !failedImages.has(url)) {
        seen.add(url);
        result.push({
          id: `p1-${result.length}`,
          uri: url,
          source: 'phase1',
        });
      }
    }

    // Then, add uploaded photos
    for (const url of safeUploadedPhotos) {
      if (isValidPhotoUrl(url) && !seen.has(url) && !failedImages.has(url)) {
        seen.add(url);
        result.push({
          id: `up-${result.length}`,
          uri: url,
          source: 'uploaded',
        });
      }
    }

    if (__DEV__) {
      console.log('[Phase2PhotoSelect] Candidates computed:', {
        phase1Count: safePhase1Photos.length,
        uploadedCount: safeUploadedPhotos.length,
        validCandidates: result.length,
        failedCount: failedImages.size,
      });
    }

    return result.slice(0, GRID_SIZE);
  }, [phase1PhotoUrls, uploadedPhotos, failedImages]);

  // Selected URIs as a Set for O(1) lookup (defensive: ensure array)
  const safeSelectedUrls = Array.isArray(selectedPhotoUrls) ? selectedPhotoUrls : [];
  const selectedSet = useMemo(() => new Set(safeSelectedUrls), [safeSelectedUrls]);

  // Filter selected to only include valid, non-failed photos
  const validSelectedCount = useMemo(() => {
    return safeSelectedUrls.filter(
      (url) => isValidPhotoUrl(url) && !failedImages.has(url)
    ).length;
  }, [safeSelectedUrls, failedImages]);

  const canContinue = validSelectedCount >= MIN_SELECTED;
  const isFull = candidates.length >= GRID_SIZE;

  const handleTogglePhoto = useCallback(
    (uri: string) => {
      if (selectedSet.has(uri)) {
        // Deselect
        const newSelection = selectedPhotoUrls.filter((u) => u !== uri);
        setSelectedPhotos([], newSelection);
      } else {
        // Select
        setSelectedPhotos([], [...selectedPhotoUrls, uri]);
      }
    },
    [selectedSet, selectedPhotoUrls, setSelectedPhotos]
  );

  const handleImageError = useCallback(
    (uri: string) => {
      if (__DEV__) {
        console.log('[Phase2PhotoSelect] Image failed to load:', { uri: uri.slice(0, 50) });
      }
      setFailedImages((prev) => new Set(prev).add(uri));
      // Also remove from selection if it was selected
      if (selectedPhotoUrls.includes(uri)) {
        setSelectedPhotos([], selectedPhotoUrls.filter((u) => u !== uri));
      }
    },
    [selectedPhotoUrls, setSelectedPhotos]
  );

  const handleUpload = async () => {
    if (isFull) {
      Alert.alert('Grid Full', 'You have already added 9 photos.');
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
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const cacheUri = result.assets[0].uri;
        if (isValidPhotoUrl(cacheUri)) {
          // Copy to permanent storage immediately
          const permanentUri = await copyToPermamentStorage(cacheUri, Date.now());

          setUploadedPhotos((prev) => [...prev, permanentUri]);
          // Auto-select the uploaded photo
          setSelectedPhotos([], [...selectedPhotoUrls, permanentUri]);
        }
      }
    } catch (error) {
      console.error('[Phase2PhotoSelect] Upload error:', error);
      Alert.alert('Error', 'Failed to upload photo. Please try again.');
    }
  };

  // Track if we're processing (prevent double-tap)
  const [isProcessing, setIsProcessing] = useState(false);

  const handleContinue = async () => {
    if (!canContinue) {
      Alert.alert('More Photos Needed', `Please select at least ${MIN_SELECTED} photos.`);
      return;
    }

    if (isProcessing) return;
    setIsProcessing(true);

    try {
      // Filter to only valid, non-failed photos
      const validSelection = selectedPhotoUrls.filter(
        (url) => isValidPhotoUrl(url) && !failedImages.has(url)
      );

      // Copy all selected photos to permanent storage (handles cache URIs)
      const permanentUris = await copyAllToPermanentStorage(validSelection);

      // Save the permanent URIs
      setSelectedPhotos([], permanentUris);

      if (__DEV__) {
        console.log('[Phase2PhotoSelect] Saved', permanentUris.length, 'photos to permanent storage');
      }

      router.push('/(main)/phase2-onboarding/profile-setup' as any);
    } catch (error) {
      console.error('[Phase2PhotoSelect] Error saving photos:', error);
      Alert.alert('Error', 'Failed to save photos. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Render a single photo slot
  const renderPhotoSlot = (candidate: PhotoCandidate) => {
    const isSelected = selectedSet.has(candidate.uri);

    return (
      <TouchableOpacity
        key={candidate.id}
        style={[styles.slot, isSelected && styles.slotSelected]}
        onPress={() => handleTogglePhoto(candidate.uri)}
        activeOpacity={0.8}
      >
        {/* Owner always sees photos CLEAR - no blurRadius here */}
        <Image
          source={{ uri: candidate.uri }}
          style={styles.slotImage}
          onError={() => handleImageError(candidate.uri)}
        />
        {isSelected && (
          <View style={styles.checkBadge}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // Render upload slot
  const renderUploadSlot = (index: number) => (
    <TouchableOpacity
      key={`upload-${index}`}
      style={[styles.slot, styles.slotEmpty]}
      onPress={handleUpload}
      activeOpacity={0.7}
    >
      <Ionicons name="add" size={28} color={C.primary} />
      <Text style={styles.uploadText}>Upload</Text>
    </TouchableOpacity>
  );

  // Render empty slot (placeholder)
  const renderEmptySlot = (index: number) => (
    <View key={`empty-${index}`} style={[styles.slot, styles.slotEmpty, styles.slotPlaceholder]}>
      <Ionicons name="image-outline" size={24} color={C.textLight} />
    </View>
  );

  /**
   * Build grid slots:
   * - First: render all valid photo candidates
   * - Then: ONE upload slot (if not full)
   * - Finally: empty placeholders to fill 9 slots
   * - NEVER render blank first tile
   */
  const gridSlots = useMemo(() => {
    const slots: React.ReactNode[] = [];
    let uploadSlotAdded = false;

    for (let i = 0; i < GRID_SIZE; i++) {
      const candidate = candidates[i];
      if (candidate) {
        // Render photo
        slots.push(renderPhotoSlot(candidate));
      } else if (!uploadSlotAdded && !isFull) {
        // Render upload slot (only one)
        slots.push(renderUploadSlot(i));
        uploadSlotAdded = true;
      } else {
        // Render empty placeholder
        slots.push(renderEmptySlot(i));
      }
    }

    return slots;
  }, [candidates, selectedSet, isFull]);

  // Show loading while importing Phase-1 photos (defensive: ensure array before .length)
  const safePhase1Count = Array.isArray(phase1PhotoUrls) ? phase1PhotoUrls.length : 0;
  if (isImporting && safePhase1Count === 0) {
    return (
      <View style={[styles.container, styles.loadingContainer, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Loading your photos...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Photos</Text>
        <Text style={styles.stepLabel}>Step 2 of 3</Text>
      </View>

      <Text style={styles.subtitle}>
        Tap photos to select them. You need at least {MIN_SELECTED} for your private profile.
      </Text>

      {/* 3x3 Grid */}
      <View style={styles.gridContainer}>
        <View style={styles.grid}>{gridSlots}</View>

        {/* Blur Toggle */}
        <View style={styles.blurToggleCard}>
          <View style={styles.blurToggleContent}>
            <View style={styles.blurToggleHeader}>
              <Ionicons name="eye-off-outline" size={20} color={C.text} />
              <Text style={styles.blurToggleTitle}>Blur my photos to others</Text>
            </View>
            <Text style={styles.blurToggleHint}>
              Your photos appear blurred to other users. You always see them clearly.
            </Text>
          </View>
          <Switch
            value={blurMyPhoto}
            onValueChange={setBlurMyPhoto}
            trackColor={{ false: C.surface, true: C.primary + '60' }}
            thumbColor={blurMyPhoto ? C.primary : '#f4f3f4'}
          />
        </View>
      </View>

      {/* Bottom Action */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <Text style={[styles.selectionCount, !canContinue && styles.selectionCountWarning]}>
          {canContinue
            ? `Selected ${validSelectedCount} photo${validSelectedCount > 1 ? 's' : ''}`
            : `Selected ${validSelectedCount} / ${MIN_SELECTED} required`}
        </Text>
        <TouchableOpacity
          style={[styles.continueBtn, (!canContinue || isProcessing) && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!canContinue || isProcessing}
          activeOpacity={0.8}
        >
          {isProcessing ? (
            <>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.continueBtnText}>Saving...</Text>
            </>
          ) : (
            <>
              <Text style={[styles.continueBtnText, !canContinue && styles.continueBtnTextDisabled]}>
                Continue
              </Text>
              <Ionicons name="arrow-forward" size={18} color={canContinue ? '#FFFFFF' : C.textLight} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: C.textLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  stepLabel: { fontSize: 12, color: C.textLight },
  subtitle: {
    fontSize: 13,
    color: C.textLight,
    paddingHorizontal: SCREEN_PADDING,
    paddingVertical: 10,
  },

  // Grid
  gridContainer: {
    flex: 1,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  slot: {
    width: slotSize,
    height: slotSize * 1.25,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  slotSelected: {
    borderWidth: 2,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  slotEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.surface,
    borderStyle: 'dashed',
  },
  slotPlaceholder: {
    borderStyle: 'solid',
    borderColor: C.surface,
    opacity: 0.5,
  },
  slotImage: {
    width: '100%',
    height: '100%',
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadText: {
    fontSize: 10,
    color: C.primary,
    marginTop: 2,
    fontWeight: '500',
  },

  // Blur toggle
  blurToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    gap: 12,
  },
  blurToggleContent: {
    flex: 1,
  },
  blurToggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  blurToggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  blurToggleHint: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
  },

  // Bottom
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  selectionCount: {
    fontSize: 13,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 8,
  },
  selectionCountWarning: {
    color: C.primary,
    fontWeight: '500',
  },
  continueBtn: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  continueBtnDisabled: { backgroundColor: C.surface },
  continueBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  continueBtnTextDisabled: { color: C.textLight },
});
