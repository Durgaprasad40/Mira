import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Fixed 9-slot grid (3x3)
const TOTAL_SLOTS = 9;
const MIN_PHOTOS_REQUIRED = 1;

// Compute uniform tile size: 3 columns with gaps, portrait aspect ratio 4:6
const GRID_PADDING = 16;
const GRID_GAP = 6;
const TILE_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * 2) / 3;
const TILE_HEIGHT = TILE_WIDTH * (6 / 4); // Portrait 4:6 aspect ratio

export default function AdditionalPhotosScreen() {
  const { photos, setPhotoAtIndex, removePhoto, setStep } = useOnboardingStore();
  const router = useRouter();

  // Full-screen viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

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
      allowsEditing: true, // Show crop screen (user can skip by pressing Done)
      aspect: [4, 6], // Portrait aspect ratio matching tiles
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

  // Handle tap on a photo tile
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
    if (photoCount < MIN_PHOTOS_REQUIRED) {
      Alert.alert('More Photos Needed', `Please add at least ${MIN_PHOTOS_REQUIRED} photo to continue.`);
      return;
    }

    if (__DEV__) console.log('[ONB] additional-photos → bio (continue)');
    setStep('bio');
    router.push('/(onboarding)/bio');
  };

  const handleSkip = () => {
    if (__DEV__) console.log('[ONB] additional-photos → bio (skip)');
    setStep('bio');
    router.push('/(onboarding)/bio');
  };

  const renderPhotoGrid = () => {
    const grid = [];

    for (let i = 0; i < TOTAL_SLOTS; i++) {
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
          {/* BASE LAYER: Always render placeholder (visible when image missing/fails/loading) */}
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
                    cacheKey={renderKey}
                    source={{ uri: photo }}
                    cachePolicy="memory-disk"
                    style={[StyleSheet.absoluteFillObject, styles.photoImage]}
                    contentFit="cover"
                    onLoad={() => {
                      // Image rendered successfully - clear any error state
                      markSlotError(i, false);
                    }}
                    onError={() => {
                      console.log('[AdditionalPhotos] image load error slot=', i, 'uri=', photo);
                      markSlotError(i, true);
                      bumpSlot(i);
                    }}
                  />
                );
              })()}
              <View style={styles.photoOverlay}>
                <Ionicons name="expand-outline" size={14} color={COLORS.white} />
              </View>
              {i === 0 && (
                <View style={styles.primaryBadge}>
                  <Text style={styles.primaryText}>Primary</Text>
                </View>
              )}
            </>
          )}
        </TouchableOpacity>
      );
    }
    return grid;
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.container}>
        {/* Header */}
        <Text style={styles.title}>Add more photos</Text>
        <Text style={styles.subtitle}>Add up to {TOTAL_SLOTS} photos to show more of yourself.</Text>

        {/* Photo Grid */}
        <View style={styles.photoGrid}>{renderPhotoGrid()}</View>

        {/* Photo Tips (always visible) */}
        <View style={styles.tips}>
          <View style={styles.tipItem}>
            <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
            <Text style={styles.tipText}>Show your face clearly</Text>
          </View>
          <View style={styles.tipItem}>
            <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
            <Text style={styles.tipText}>Include photos of your interests</Text>
          </View>
          <View style={styles.tipItem}>
            <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
            <Text style={styles.tipText}>Use recent, high-quality photos</Text>
          </View>
        </View>

        {/* Footer (pushed to bottom) */}
        <View style={styles.footer}>
          <Button
            title="Continue"
            variant="primary"
            onPress={handleNext}
            disabled={photoCount < MIN_PHOTOS_REQUIRED}
            fullWidth
          />
          {photoCount < MIN_PHOTOS_REQUIRED && (
            <Text style={styles.hint}>Add at least {MIN_PHOTOS_REQUIRED} photo to continue</Text>
          )}
          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>

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
              <Text style={styles.primaryText}>Primary Photo</Text>
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
  container: {
    flex: 1,
    paddingHorizontal: GRID_PADDING,
    paddingTop: 8,
    paddingBottom: 16,
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
    marginBottom: 10,
  },
  // Uniform 3x3 grid with portrait tiles (4:6 aspect ratio)
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
  photo: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 6,
    padding: 2,
  },
  primaryBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryText: {
    fontSize: 8,
    fontWeight: '600',
    color: COLORS.white,
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
  // Photo tips (always visible, compact)
  tips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 4,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tipText: {
    fontSize: 10,
    color: COLORS.textLight,
  },
  // Footer pushed to bottom
  footer: {
    marginTop: 'auto',
    paddingTop: 12,
  },
  hint: {
    fontSize: 10,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 4,
  },
  skipButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  skipText: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '500',
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
