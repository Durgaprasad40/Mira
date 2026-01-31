import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';

export default function PhotoUploadScreen() {
  const { photos, addPhoto, setStep } = useOnboardingStore();
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);

  const requestPermissions = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photos to upload your profile picture.');
      return false;
    }
    return true;
  };

  const pickImage = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images' as const],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      
      // Check minimum size
      if (asset.width < VALIDATION.MIN_PHOTO_SIZE || asset.height < VALIDATION.MIN_PHOTO_SIZE) {
        Alert.alert(
          'Image Too Small',
          `Please upload an image that is at least ${VALIDATION.MIN_PHOTO_SIZE}x${VALIDATION.MIN_PHOTO_SIZE} pixels.`
        );
        return;
      }

      // Resize if needed
      let processedImage = result.assets[0];
      if (asset.width > 2000 || asset.height > 2000) {
        const manipResult = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 2000 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        processedImage = manipResult;
      }

      // TODO: Face detection check
      // For now, just add the photo
      addPhoto(processedImage.uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow camera access to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      
      if (asset.width < VALIDATION.MIN_PHOTO_SIZE || asset.height < VALIDATION.MIN_PHOTO_SIZE) {
        Alert.alert('Image Too Small', `Please take a photo that is at least ${VALIDATION.MIN_PHOTO_SIZE}x${VALIDATION.MIN_PHOTO_SIZE} pixels.`);
        return;
      }

      addPhoto(asset.uri);
    }
  };

  const handleNext = () => {
    if (photos.length === 0) {
      Alert.alert('Photo Required', 'Please upload at least one photo to continue.');
      return;
    }

    setStep('face_verification');
    router.push('/(onboarding)/face-verification' as any);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Add your first photo</Text>
      <Text style={styles.subtitle}>
        Upload a clear photo of yourself. Make sure your face is visible.
      </Text>

      <View style={styles.photoContainer}>
        {photos.length > 0 ? (
          <View style={styles.photoPreview}>
            <Image source={{ uri: photos[0] }} style={styles.photo} />
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => {
                // Remove first photo
                const newPhotos = photos.slice(1);
                // TODO: Update store to remove photo
              }}
            >
              <Ionicons name="close-circle" size={24} color={COLORS.error} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="camera" size={64} color={COLORS.textLight} />
            <Text style={styles.placeholderText}>No photo yet</Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Button
          title="Take Photo"
          variant="outline"
          onPress={takePhoto}
          icon={<Ionicons name="camera" size={20} color={COLORS.primary} />}
          style={styles.actionButton}
        />
        <Button
          title="Choose from Gallery"
          variant="primary"
          onPress={pickImage}
          icon={<Ionicons name="images" size={20} color={COLORS.white} />}
          style={styles.actionButton}
        />
      </View>

      <View style={styles.requirements}>
        <Text style={styles.requirementsTitle}>Photo Requirements:</Text>
        <View style={styles.requirementItem}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={styles.requirementText}>
            Minimum {VALIDATION.MIN_PHOTO_SIZE}x{VALIDATION.MIN_PHOTO_SIZE} pixels
          </Text>
        </View>
        <View style={styles.requirementItem}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={styles.requirementText}>Your face must be clearly visible</Text>
        </View>
        <View style={styles.requirementItem}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={styles.requirementText}>No group photos</Text>
        </View>
        <View style={styles.requirementItem}>
          <Ionicons name="close-circle" size={16} color={COLORS.error} />
          <Text style={styles.requirementText}>No inappropriate or revealing content</Text>
        </View>
        <View style={styles.requirementItem}>
          <Ionicons name="close-circle" size={16} color={COLORS.error} />
          <Text style={styles.requirementText}>No suggestive or inappropriate photos</Text>
        </View>
      </View>

      <View style={styles.nsfwNotice}>
        <Ionicons name="shield-checkmark" size={18} color={COLORS.textLight} />
        <Text style={styles.nsfwNoticeText}>
          All photos are screened for inappropriate content. Violations may result in account restriction.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          disabled={photos.length === 0}
          fullWidth
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 24,
    lineHeight: 22,
  },
  photoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  photoPreview: {
    position: 'relative',
    width: 300,
    height: 300,
    borderRadius: 150,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: COLORS.primary,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: COLORS.background,
    borderRadius: 12,
  },
  placeholder: {
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  placeholderText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
  },
  actions: {
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    marginBottom: 0,
  },
  requirements: {
    backgroundColor: COLORS.backgroundDark,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  nsfwNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    marginBottom: 24,
  },
  nsfwNoticeText: {
    fontSize: 12,
    color: COLORS.textLight,
    flex: 1,
    lineHeight: 18,
  },
  footer: {
    marginTop: 24,
  },
});
