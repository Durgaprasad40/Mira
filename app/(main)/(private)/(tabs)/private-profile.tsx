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
 * - Store-only (no Convex calls)
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
import { BlurView } from 'expo-blur';
import { Paths, File as ExpoFile, Directory } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { isDemoMode } from '@/hooks/useConvex';
import { getDemoCurrentUser } from '@/lib/demoData';

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
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Phase-2 store data
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const displayName = usePrivateProfileStore((s) => s.displayName);
  const age = usePrivateProfileStore((s) => s.age);
  const blurMyPhoto = usePrivateProfileStore((s) => s.blurMyPhoto);
  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setBlurMyPhoto = usePrivateProfileStore((s) => s.setBlurMyPhoto);
  const resetPhase2 = usePrivateProfileStore((s) => s.resetPhase2);

  // Local UI state
  const [previewAsOthers, setPreviewAsOthers] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPhotoIndex, setViewerPhotoIndex] = useState(0);
  const [missingPhotos, setMissingPhotos] = useState<Set<string>>(new Set());
  const [isAddingPhotos, setIsAddingPhotos] = useState(false);

  // Track last checked photos to avoid redundant checks
  const lastCheckedRef = useRef<string>('');

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
      setMissingPhotos(new Set());
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

    setMissingPhotos(missing);

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
  const gridPhotos = validPhotos.slice(1);
  const canAddMore = validPhotos.length < 9;

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
   * Set a photo as main (move to index 0)
   */
  const handleSetAsMain = useCallback(
    (index: number) => {
      if (index === 0 || index >= validPhotos.length) return;

      const newOrder = [...validPhotos];
      const [photo] = newOrder.splice(index, 1);
      newOrder.unshift(photo);

      setSelectedPhotos([], newOrder);

      if (__DEV__) {
        console.log('[PrivateProfile] Set photo as main:', { index });
      }
    },
    [validPhotos, setSelectedPhotos]
  );

  /**
   * Remove a photo
   */
  const handleRemovePhoto = useCallback(
    (index: number) => {
      if (index < 0 || index >= validPhotos.length) return;

      const newPhotos = validPhotos.filter((_, i) => i !== index);
      setSelectedPhotos([], newPhotos);

      if (__DEV__) {
        console.log('[PrivateProfile] Removed photo:', { index, remaining: newPhotos.length });
      }
    },
    [validPhotos, setSelectedPhotos]
  );

  /**
   * Move photo up in order
   */
  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0 || index >= validPhotos.length) return;

      const newOrder = [...validPhotos];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      setSelectedPhotos([], newOrder);
    },
    [validPhotos, setSelectedPhotos]
  );

  /**
   * Move photo down in order
   */
  const handleMoveDown = useCallback(
    (index: number) => {
      if (index < 0 || index >= validPhotos.length - 1) return;

      const newOrder = [...validPhotos];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      setSelectedPhotos([], newOrder);
    },
    [validPhotos, setSelectedPhotos]
  );

  /**
   * Quick add photos directly from gallery (no onboarding flow)
   * Opens ImagePicker, copies to permanent storage, updates store
   */
  const handleQuickAddPhotos = async () => {
    // Check if we can add more photos
    if (validPhotos.length >= MAX_PHOTOS) {
      Alert.alert('Maximum Photos', `You can have up to ${MAX_PHOTOS} photos.`);
      return;
    }

    if (isAddingPhotos) return;
    setIsAddingPhotos(true);

    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library access to add photos.');
        setIsAddingPhotos(false);
        return;
      }

      // Calculate how many photos can still be added
      const slotsAvailable = MAX_PHOTOS - validPhotos.length;

      // Launch gallery
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        selectionLimit: slotsAvailable,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsAddingPhotos(false);
        return;
      }

      // Copy each selected photo to permanent storage
      const newPermanentUris: string[] = [];
      for (let i = 0; i < result.assets.length; i++) {
        const asset = result.assets[i];
        const permanentUri = await copyToPermamentStorage(asset.uri, Date.now() + i);
        if (permanentUri) {
          newPermanentUris.push(permanentUri);
        }
      }

      if (newPermanentUris.length > 0) {
        // Append to existing photos
        const updatedPhotos = [...validPhotos, ...newPermanentUris].slice(0, MAX_PHOTOS);
        setSelectedPhotos([], updatedPhotos);

        // Reset the check ref so existence check runs again
        lastCheckedRef.current = '';

        if (__DEV__) {
          console.log('[PrivateProfile] Added', newPermanentUris.length, 'photos');
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[PrivateProfile] Quick add error:', error);
      }
      Alert.alert('Error', 'Failed to add photos. Please try again.');
    } finally {
      setIsAddingPhotos(false);
    }
  };

  /**
   * Navigate to full photo edit screen (onboarding flow)
   * Only used for "Edit All" which needs the full grid UI
   */
  const handleEditAllPhotos = () => {
    router.push('/(main)/phase2-onboarding/photo-select' as any);
  };

  /**
   * Navigate to profile edit screen
   */
  const handleEditProfile = () => {
    router.push('/(main)/phase2-onboarding/profile-setup' as any);
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
        />
        {shouldShowBlur && (
          <BlurView intensity={80} tint="dark" style={styles.gridPhotoBlur} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="person-circle" size={24} color={C.primary} />
        <Text style={styles.headerTitle}>My Private Profile</Text>
        <TouchableOpacity onPress={handleEditProfile} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
                />
                {shouldShowBlur && (
                  <BlurView intensity={80} tint="dark" style={styles.mainPhotoBlur} />
                )}
              </View>
              {/* Tap hint badge */}
              <View style={styles.tapHint}>
                <Ionicons name="expand-outline" size={12} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.mainPhotoEmpty} onPress={handleQuickAddPhotos}>
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
          <TouchableOpacity
            style={styles.warningBanner}
            onPress={handleQuickAddPhotos}
            activeOpacity={0.8}
          >
            <Ionicons name="warning-outline" size={20} color="#FF9500" />
            <View style={styles.warningContent}>
              <Text style={styles.warningTitle}>
                {missingPhotos.size + cacheUriCount} photo{(missingPhotos.size + cacheUriCount) > 1 ? 's' : ''} need re-adding
              </Text>
              <Text style={styles.warningText}>Tap to select photos that will persist</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>
        )}

        {/* Photo Grid */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Photos ({validPhotos.length}/9)</Text>
            <TouchableOpacity onPress={handleEditAllPhotos} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.editLink}>Edit All</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.photoGrid}>
            {/* Grid photos */}
            {gridPhotos.map((uri, idx) => {
              const actualIndex = idx + 1; // +1 because main photo is index 0
              return (
                <View key={`grid-${idx}-${uri.slice(-20)}`} style={styles.gridSlot}>
                  {renderGridPhoto(uri, actualIndex, () => openViewer(actualIndex))}

                  {/* Photo controls */}
                  <View style={styles.gridControls}>
                    <TouchableOpacity
                      style={styles.gridControlBtn}
                      onPress={() => handleSetAsMain(actualIndex)}
                    >
                      <Ionicons name="star" size={12} color="#FFD700" />
                    </TouchableOpacity>
                    {actualIndex > 1 && (
                      <TouchableOpacity
                        style={styles.gridControlBtn}
                        onPress={() => handleMoveUp(actualIndex)}
                      >
                        <Ionicons name="chevron-up" size={12} color={C.text} />
                      </TouchableOpacity>
                    )}
                    {actualIndex < validPhotos.length - 1 && (
                      <TouchableOpacity
                        style={styles.gridControlBtn}
                        onPress={() => handleMoveDown(actualIndex)}
                      >
                        <Ionicons name="chevron-down" size={12} color={C.text} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.gridControlBtn, styles.gridControlBtnDanger]}
                      onPress={() => handleRemovePhoto(actualIndex)}
                    >
                      <Ionicons name="close" size={12} color="#FF6B6B" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            {/* Add photo slot */}
            {canAddMore && (
              <TouchableOpacity
                style={[styles.addPhotoSlot, isAddingPhotos && styles.addPhotoSlotDisabled]}
                onPress={handleQuickAddPhotos}
                disabled={isAddingPhotos}
              >
                {isAddingPhotos ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <>
                    <Ionicons name="add" size={28} color={C.primary} />
                    <Text style={styles.addPhotoText}>Add</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.photoGridHint}>
            <Ionicons name="star" size={11} color="#FFD700" /> = Set as main • Arrows = Reorder • <Ionicons name="close" size={11} color="#FF6B6B" /> = Remove
          </Text>
        </View>

        {/* Connection Vibe */}
        {privateBio && privateBio.trim().length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Connection Vibe</Text>
              <TouchableOpacity onPress={handleEditProfile} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.bioText}>{privateBio}</Text>
          </View>
        )}

        {/* Looking For Tags */}
        {intentLabels.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Looking For</Text>
              <TouchableOpacity onPress={handleEditProfile} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.tagGrid}>
              {intentLabels.map((label, i) => (
                <View key={`tag-${i}`} style={styles.tag}>
                  <Text style={styles.tagText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Settings Shortcuts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>

          <TouchableOpacity style={styles.settingsRow} activeOpacity={0.7}>
            <View style={styles.settingsRowLeft}>
              <Ionicons name="diamond-outline" size={20} color={C.primary} />
              <View>
                <Text style={styles.settingsRowLabel}>Subscription</Text>
                <Text style={styles.settingsRowValue}>Free Plan</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingsRow} activeOpacity={0.7}>
            <View style={styles.settingsRowLeft}>
              <Ionicons name="shield-checkmark-outline" size={20} color={C.primary} />
              <View>
                <Text style={styles.settingsRowLabel}>Privacy Settings</Text>
                <Text style={styles.settingsRowValue}>Manage who can see you</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.settingsRow, styles.settingsRowDanger]}
            onPress={handleResetPhase2}
            activeOpacity={0.7}
          >
            <View style={styles.settingsRowLeft}>
              <Ionicons name="refresh-outline" size={20} color="#FF6B6B" />
              <View>
                <Text style={[styles.settingsRowLabel, styles.settingsRowLabelDanger]}>
                  Reset Private Profile
                </Text>
                <Text style={styles.settingsRowValue}>Start over with a fresh setup</Text>
              </View>
            </View>
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

        {/* Back to Main App */}
        <TouchableOpacity
          style={styles.backToMainBtn}
          onPress={() => router.replace('/(main)/(tabs)/home' as any)}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={18} color={C.textLight} />
          <Text style={styles.backToMainText}>Back to Main App</Text>
        </TouchableOpacity>
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
              />
              {shouldShowBlur && (
                <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
              )}
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
});
