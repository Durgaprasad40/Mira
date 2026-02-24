import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { processPhotoVariant, PhotoVariant } from '@/services/photoPrivacy';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';

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
  const { photos, setStep, setDisplayPhotoVariant } = useOnboardingStore();
  const router = useRouter();

  const [selectedVariant, setSelectedVariant] = useState<PhotoVariant>('original');
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  // Get first non-null photo for display
  const profilePhoto = photos[0] ?? null;

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
      Alert.alert('Error', 'No profile photo found. Please go back and upload a photo.');
      return;
    }

    setIsProcessing(true);

    try {
      // Store the selected variant
      if (setDisplayPhotoVariant) {
        setDisplayPhotoVariant(selectedVariant);
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
          ) : (
            <View style={styles.noPhoto}>
              <Ionicons name="image-outline" size={48} color={COLORS.textLight} />
              <Text style={styles.noPhotoText}>No photo</Text>
            </View>
          )}
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
});
