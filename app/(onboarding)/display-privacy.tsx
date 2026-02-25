import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  Dimensions,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { processPhotoVariant, PhotoVariant } from '@/services/photoPrivacy';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// =============================================================================
// Types
// =============================================================================

interface PrivacyOption {
  id: PhotoVariant;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  preview?: string; // Preview URI if different from original
}

// =============================================================================
// Component
// =============================================================================

export default function DisplayPrivacyScreen() {
  const { photos, setPhotoAtIndex, setStep, setDisplayPhotoVariant } = useOnboardingStore();
  const { userId } = useAuthStore();
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const router = useRouter();

  const [selectedVariant, setSelectedVariant] = useState<PhotoVariant>('original');
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  // Get first non-null photo for display
  const profilePhoto = photos[0] ?? null;

  // Prefill from demoProfiles if onboardingStore is empty
  useEffect(() => {
    if (isDemoMode && demoHydrated && demoProfile?.photos && demoProfile.photos.length > 0) {
      const currentPhotoCount = photos.filter((p) => typeof p === 'string' && p.length > 0).length;
      if (currentPhotoCount === 0) {
        const savedPhotos = demoProfile.photos.map((p) => p.url);
        savedPhotos.forEach((uri, idx) => {
          if (uri) setPhotoAtIndex(idx, uri);
        });
        console.log(`[DISPLAY-PRIVACY] prefilled ${savedPhotos.length} photos from demoProfile`);
      }
    }
  }, [demoHydrated, demoProfile]);

  // Handle photo selection from gallery
  const handlePickFromGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images' as const],
        allowsEditing: true,
        aspect: [2, 3], // Portrait 4x6 aspect ratio
        quality: 0.9,
      });

      if (!result.canceled) {
        const uri = result.assets?.[0]?.uri;
        if (typeof uri === 'string' && uri.length > 0) {
          await savePhoto(uri);
        }
      }
    } catch (error) {
      console.error('[DisplayPrivacy] Gallery picker error:', error);
      Alert.alert('Error', 'Failed to pick photo. Please try again.');
    }
  };

  // Handle photo capture from camera
  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your camera.');
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
          await savePhoto(uri);
        }
      }
    } catch (error) {
      console.error('[DisplayPrivacy] Camera error:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  // Save photo to store
  const savePhoto = async (uri: string) => {
    setIsProcessing(true);
    try {
      // Normalize image for cross-platform compatibility
      const normalized = await ImageManipulator.manipulateAsync(
        uri,
        [],
        { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
      );
      const finalUri = normalized?.uri ?? uri;
      setPhotoAtIndex(0, finalUri);
      setPreviewUri(null); // Reset blur preview since we have a new photo
      console.log('[DisplayPrivacy] Photo saved to slot 0');
    } catch (error) {
      console.log('[DisplayPrivacy] normalize failed, using original uri', error);
      setPhotoAtIndex(0, uri);
      setPreviewUri(null);
    } finally {
      setIsProcessing(false);
    }
  };

  // Open full-screen preview when tapping existing photo
  const handleOpenViewer = () => {
    if (profilePhoto) {
      setViewerOpen(true);
    }
  };

  // Alias for compatibility - does nothing if no photo, opens preview if photo exists
  const handlePhotoPress = () => {
    if (!profilePhoto) return;
    setViewerOpen(true);
  };

  // Close viewer
  const handleCloseViewer = () => {
    setViewerOpen(false);
  };

  // Delete photo from onboardingStore and demoProfiles
  const handleDeletePhoto = () => {
    Alert.alert(
      'Delete Photo?',
      'Are you sure you want to remove this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Clear from onboardingStore
            setPhotoAtIndex(0, null as any);
            setPreviewUri(null);

            // Update demoProfiles (save-as-you-go)
            if (isDemoMode && userId) {
              const demoStore = useDemoStore.getState();
              const currentProfile = demoStore.demoProfiles[userId];
              if (currentProfile?.photos) {
                // Remove the first photo, keep others
                const updatedPhotos = currentProfile.photos.slice(1);
                demoStore.saveDemoProfile(userId, { photos: updatedPhotos });
                console.log('[DisplayPrivacy] deleted photo from demoProfile');
              }
            }

            setViewerOpen(false);
          },
        },
      ]
    );
  };

  // Show action sheet for replace options in viewer
  const handleReplacePhoto = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Camera', 'Gallery'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            handleTakePhoto();
          } else if (buttonIndex === 2) {
            handlePickFromGallery();
          }
        }
      );
    } else {
      Alert.alert(
        'Replace Photo',
        'Choose source',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Camera', onPress: handleTakePhoto },
          { text: 'Gallery', onPress: handlePickFromGallery },
        ]
      );
    }
  };

  // Privacy options
  const privacyOptions: PrivacyOption[] = [
    {
      id: 'original',
      title: 'Show Original',
      description: 'Display your verified photo as-is. Others will see your real photo.',
      icon: 'person-circle',
    },
    {
      id: 'blurred',
      title: 'Blur My Photo',
      description: 'Apply a privacy blur. Your identity is verified but hidden until you match.',
      icon: 'eye-off',
    },
    {
      id: 'cartoon',
      title: 'Cartoon Avatar',
      description: 'Coming soon! Use an AI-generated avatar that represents you.',
      icon: 'happy',
    },
  ];

  // Handle option selection
  const handleSelectOption = async (variant: PhotoVariant) => {
    if (variant === 'cartoon') {
      Alert.alert(
        'Coming Soon',
        'Cartoon avatars are coming in a future update! For now, choose Original or Blurred.',
        [{ text: 'OK' }]
      );
      return;
    }

    setSelectedVariant(variant);

    if (variant === 'blurred' && profilePhoto) {
      // Generate preview of blurred version
      setIsProcessing(true);
      try {
        const processed = await processPhotoVariant(profilePhoto, 'blurred');
        setPreviewUri(processed.uri);
      } catch (error) {
        console.error('[DisplayPrivacy] Error generating blur preview:', error);
        Alert.alert('Error', 'Failed to generate preview. Please try again.');
      } finally {
        setIsProcessing(false);
      }
    } else {
      setPreviewUri(null);
    }
  };

  // Handle continue
  const handleContinue = async () => {
    if (!profilePhoto) {
      Alert.alert('Photo Required', 'Please add a photo using Camera or Gallery above.');
      return;
    }

    setIsProcessing(true);

    try {
      // Store the selected variant
      if (setDisplayPhotoVariant) {
        setDisplayPhotoVariant(selectedVariant);
      }

      // SAVE-AS-YOU-GO: Persist to demoProfiles immediately
      if (isDemoMode && userId) {
        const validPhotos = photos.filter((p): p is string => typeof p === 'string' && p.length > 0);
        if (validPhotos.length > 0) {
          const demoStore = useDemoStore.getState();
          demoStore.saveDemoProfile(userId, {
            photos: validPhotos.map((uri) => ({ url: uri })),
          });
          console.log(`[DisplayPrivacy] saved ${validPhotos.length} photos to demoProfile`);
        }
      }

      console.log(`[DisplayPrivacy] User selected variant: ${selectedVariant}`);

      // Navigate to photo upload
      setStep('photo_upload');
      router.push('/(onboarding)/photo-upload' as any);
    } catch (error) {
      console.error('[DisplayPrivacy] Error:', error);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Get display image URI (returns string for rendering, empty string if no photo)
  const getDisplayUri = (): string => {
    if (selectedVariant === 'blurred' && previewUri) {
      return previewUri;
    }
    return profilePhoto ?? '';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <OnboardingProgressHeader />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerBadge}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
            <Text style={styles.headerBadgeText}>Identity Verified</Text>
          </View>
          <Text style={styles.title}>Choose Your Display Photo</Text>
          <Text style={styles.subtitle}>
            Your identity is verified. Now choose how others see your photo.
          </Text>
        </View>

        {/* Photo Preview */}
        <View style={styles.photoContainer}>
          {profilePhoto ? (
            <TouchableOpacity
              onPress={handleOpenViewer}
              activeOpacity={0.8}
              disabled={isProcessing}
            >
              <View style={styles.photoPreview}>
                <Image
                  source={{ uri: getDisplayUri() }}
                  style={styles.photo}
                  contentFit="cover"
                />
                {selectedVariant === 'blurred' && (
                  <View style={styles.blurBadge}>
                    <Ionicons name="eye-off" size={14} color={COLORS.white} />
                    <Text style={styles.blurBadgeText}>Blurred</Text>
                  </View>
                )}
                {isProcessing && (
                  <View style={styles.processingOverlay}>
                    <ActivityIndicator size="small" color={COLORS.white} />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.noPhoto}>
              <Ionicons name="add-circle" size={48} color={COLORS.primary} />
              <Text style={styles.noPhotoText}>Add photo</Text>
            </View>
          )}

          {/* Visible Camera & Gallery buttons */}
          <View style={styles.photoButtons}>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={handleTakePhoto}
              disabled={isProcessing}
            >
              <Ionicons name="camera" size={20} color={COLORS.primary} />
              <Text style={styles.photoButtonText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={handlePickFromGallery}
              disabled={isProcessing}
            >
              <Ionicons name="images" size={20} color={COLORS.primary} />
              <Text style={styles.photoButtonText}>Gallery</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Privacy Options */}
        <View style={styles.optionsContainer}>
          <Text style={styles.optionsTitle}>Privacy Options</Text>

          {privacyOptions.map((option) => {
            const isSelected = selectedVariant === option.id;
            const isDisabled = option.id === 'cartoon';

            return (
              <TouchableOpacity
                key={option.id}
                style={[
                  styles.option,
                  isSelected && styles.optionSelected,
                  isDisabled && styles.optionDisabled,
                ]}
                onPress={() => handleSelectOption(option.id)}
                disabled={isDisabled || isProcessing}
              >
                <View style={[
                  styles.optionIcon,
                  isSelected && styles.optionIconSelected,
                ]}>
                  <Ionicons
                    name={option.icon}
                    size={24}
                    color={isSelected ? COLORS.white : COLORS.primary}
                  />
                </View>
                <View style={styles.optionContent}>
                  <View style={styles.optionHeader}>
                    <Text style={[
                      styles.optionTitle,
                      isDisabled && styles.optionTitleDisabled,
                    ]}>
                      {option.title}
                    </Text>
                    {isDisabled && (
                      <View style={styles.comingSoonBadge}>
                        <Text style={styles.comingSoonText}>Coming Soon</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Privacy Note */}
        <View style={styles.privacyNote}>
          <Ionicons name="shield-checkmark" size={18} color={COLORS.primary} />
          <Text style={styles.privacyNoteText}>
            Your original verification photo is kept private and secure.
            Only you and our verification system can access it.
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Button
            title={isProcessing ? 'Processing...' : 'Continue'}
            variant="primary"
            onPress={handleContinue}
            disabled={isProcessing}
            fullWidth
          />
          <Text style={styles.footerNote}>
            You can change this anytime in Settings
          </Text>
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
          {profilePhoto && (
            <Image
              source={{ uri: profilePhoto }}
              style={styles.viewerImage}
              contentFit="contain"
            />
          )}

          {/* Action buttons at bottom */}
          <View style={styles.viewerActions}>
            <TouchableOpacity style={styles.viewerActionButton} onPress={handleReplacePhoto}>
              <Ionicons name="swap-horizontal" size={24} color={COLORS.white} />
              <Text style={styles.viewerActionText}>Replace</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.viewerActionButton} onPress={handleDeletePhoto}>
              <Ionicons name="trash-outline" size={24} color={COLORS.error} />
              <Text style={[styles.viewerActionText, { color: COLORS.error }]}>Delete</Text>
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

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success + '15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
    marginBottom: 12,
  },
  headerBadgeText: {
    color: COLORS.success,
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  photoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  photoPreview: {
    width: 160,
    height: 160,
    borderRadius: 80,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: COLORS.primary,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  blurBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
    borderRadius: 12,
  },
  blurBadgeText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '600',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noPhoto: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  noPhotoText: {
    color: COLORS.textLight,
    fontSize: 12,
    marginTop: 4,
  },
  photoButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: COLORS.primaryLight + '30',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  photoButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  optionsContainer: {
    marginBottom: 16,
  },
  optionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight + '20',
  },
  optionDisabled: {
    opacity: 0.6,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  optionIconSelected: {
    backgroundColor: COLORS.primary,
  },
  optionContent: {
    flex: 1,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  optionTitleDisabled: {
    color: COLORS.textLight,
  },
  comingSoonBadge: {
    backgroundColor: COLORS.textMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  comingSoonText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '600',
  },
  optionDescription: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
    lineHeight: 16,
  },
  privacyNote: {
    flexDirection: 'row',
    backgroundColor: COLORS.primaryLight + '20',
    padding: 12,
    borderRadius: 10,
    gap: 10,
    marginBottom: 16,
  },
  privacyNoteText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.text,
    lineHeight: 18,
  },
  footer: {
    marginTop: 8,
  },
  footerNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 12,
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
