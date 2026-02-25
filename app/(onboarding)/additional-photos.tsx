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
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore, DisplayPhotoVariant } from '@/stores/onboardingStore';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Ionicons } from '@expo/vector-icons';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Total 7 photos: 1 primary (circle) + 6 additional (grid)
const TOTAL_SLOTS = 7;
const GRID_SLOTS = 6; // Additional photos grid slots (indices 1-6)
const MIN_PHOTOS_REQUIRED = 2; // Must have at least 2 photos to continue

// Compute uniform tile size: 3 columns with gaps, portrait aspect ratio
const GRID_PADDING = 16;
const GRID_GAP = 8;
const TILE_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * 2) / 3;
const TILE_HEIGHT = TILE_WIDTH * 1.4; // Portrait aspect ratio

// Primary photo circle size
const PRIMARY_CIRCLE_SIZE = 160;

export default function AdditionalPhotosScreen() {
  const { photos, setPhotoAtIndex, removePhoto, setStep, displayPhotoVariant, setDisplayPhotoVariant, bio, setBio } = useOnboardingStore();
  const { userId } = useAuthStore();
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // CENTRAL EDIT HUB: Detect if editing from Review screen
  const isEditFromReview = params.editFromReview === 'true';

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

  // Per-slot render nonce to force re-render on photo change
  const [slotNonce, setSlotNonce] = useState<number[]>(Array(TOTAL_SLOTS).fill(0));

  // Per-slot error state to fallback to Add Photo placeholder when image fails
  const [slotError, setSlotError] = useState<boolean[]>(Array(TOTAL_SLOTS).fill(false));

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

  // Count valid photos (treat null/undefined/'' as empty)
  const photoCount = photos.filter((p) => typeof p === 'string' && p.length > 0).length;

  // Find first empty slot index
  const firstEmptyIndex = photos.findIndex((p) => !(typeof p === 'string' && p.length > 0));

  // Pick image for a specific slot index with optional crop (4:6 aspect)
  const pickImageForIndex = async (targetIndex: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photos.');
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
          const finalUri = normalized?.uri ?? uri;
          setPhotoAtIndex(targetIndex, finalUri);
          markSlotError(targetIndex, false);
          bumpSlot(targetIndex);
        } catch (e) {
          console.log('[AdditionalPhotos] normalize failed, using original uri', uri, e);
          setPhotoAtIndex(targetIndex, uri);
          markSlotError(targetIndex, false);
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
          const finalUri = normalized?.uri ?? uri;
          setPhotoAtIndex(targetIndex, finalUri);
          markSlotError(targetIndex, false);
          bumpSlot(targetIndex);
        } catch (e) {
          console.log('[AdditionalPhotos] normalize failed, using original uri', uri, e);
          setPhotoAtIndex(targetIndex, uri);
          markSlotError(targetIndex, false);
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

  // Handle tap on a photo tile (for grid slots 1-6)
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
      Alert.alert(
        'Remove Photo?',
        'Are you sure you want to remove this photo?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              removePhoto(viewerIndex);
              setViewerOpen(false);
              setViewerIndex(null);
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

  const handleNext = () => {
    // Gate: minimum 2 photos required
    if (photoCount < MIN_PHOTOS_REQUIRED) {
      setShowPhotoWarning(true);
      return;
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
    if (__DEV__) console.log('[ONB] additional-photos → permissions (continue)');
    setStep('permissions');
    router.push('/(onboarding)/permissions');
  };

  // Render additional photos grid (indices 1-6 only, primary is shown separately)
  const renderPhotoGrid = () => {
    const grid = [];

    // Start from index 1 (skip primary photo which is shown in circle)
    for (let i = 1; i <= GRID_SLOTS; i++) {
      const photo = photos[i];
      const hasPhoto = typeof photo === 'string' && photo.length > 0;
      const showPhoto = hasPhoto && !slotError[i];

      // Determine press behavior
      const handlePress = showPhoto
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
            <Ionicons name="add" size={22} color={COLORS.textLight} />
            <Text style={styles.addPhotoText}>Add</Text>
          </View>

          {/* OVERLAY LAYER: Render image on top if we have a valid photo */}
          {showPhoto && (
            <>
              {(() => {
                const nonce = slotNonce[i] ?? 0;
                const renderKey = `${photo}::${nonce}`;
                return (
                  <Image
                    key={renderKey}
                    recyclingKey={renderKey}
                    source={{ uri: photo }}
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

  const primaryPhoto = photos[0];
  const hasPrimaryPhoto = typeof primaryPhoto === 'string' && primaryPhoto.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <OnboardingProgressHeader />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.title}>Your Photos</Text>
        <Text style={styles.subtitle}>Add up to {TOTAL_SLOTS} photos to show more of yourself.</Text>

        {/* Primary Photo Circle */}
        <View style={styles.primarySection}>
          <TouchableOpacity
            style={styles.primaryCircle}
            onPress={handlePrimaryPhotoPress}
            activeOpacity={0.8}
          >
            {hasPrimaryPhoto && !slotError[0] ? (
              <Image
                source={{ uri: primaryPhoto }}
                style={styles.primaryImage}
                contentFit="cover"
                blurRadius={displayPhotoVariant === 'blurred' ? 15 : 0}
              />
            ) : (
              <View style={styles.primaryPlaceholder}>
                <Ionicons name="add" size={32} color={COLORS.primary} />
                <Text style={styles.primaryAddText}>Add Photo</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.primaryLabel}>Primary Photo</Text>
        </View>

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
          {viewerIndex !== null && photos[viewerIndex] && (
            <Image
              source={{ uri: photos[viewerIndex]! }}
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
