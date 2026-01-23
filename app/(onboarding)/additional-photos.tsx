import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';

export default function AdditionalPhotosScreen() {
  const { photos, addPhoto, removePhoto, reorderPhotos, setStep } = useOnboardingStore();
  const router = useRouter();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const pickImage = async () => {
    if (photos.length >= VALIDATION.MAX_PHOTOS) {
      Alert.alert('Maximum Photos', `You can upload up to ${VALIDATION.MAX_PHOTOS} photos.`);
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      if (asset.width < VALIDATION.MIN_PHOTO_SIZE || asset.height < VALIDATION.MIN_PHOTO_SIZE) {
        Alert.alert('Image Too Small', `Please upload an image that is at least ${VALIDATION.MIN_PHOTO_SIZE}x${VALIDATION.MIN_PHOTO_SIZE} pixels.`);
        return;
      }
      addPhoto(asset.uri);
    }
  };

  const handleNext = () => {
    if (photos.length < VALIDATION.MIN_PHOTOS) {
      Alert.alert('More Photos Needed', `Please add at least ${VALIDATION.MIN_PHOTOS} photo to continue.`);
      return;
    }

    setStep('bio');
    router.push('/(onboarding)/bio');
  };

  const renderPhotoGrid = () => {
    const grid = [];
    const maxPhotos = VALIDATION.MAX_PHOTOS;
    
    for (let i = 0; i < maxPhotos; i++) {
      if (i < photos.length) {
        grid.push(
          <TouchableOpacity
            key={i}
            style={styles.photoItem}
            onLongPress={() => setDraggedIndex(i)}
            onPress={() => {
              Alert.alert(
                'Remove Photo?',
                'Do you want to remove this photo?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => removePhoto(i),
                  },
                ]
              );
            }}
          >
            <Image source={{ uri: photos[i] }} style={styles.photo} />
            <View style={styles.photoOverlay}>
              <Ionicons name="close-circle" size={24} color={COLORS.white} />
            </View>
            {i === 0 && (
              <View style={styles.primaryBadge}>
                <Text style={styles.primaryText}>Primary</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      } else {
        grid.push(
          <TouchableOpacity
            key={i}
            style={[styles.photoItem, styles.addPhotoButton]}
            onPress={pickImage}
          >
            <Ionicons name="add" size={32} color={COLORS.textLight} />
            <Text style={styles.addPhotoText}>Add Photo</Text>
          </TouchableOpacity>
        );
      }
    }
    return grid;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Add more photos</Text>
      <Text style={styles.subtitle}>
        Add {VALIDATION.MIN_PHOTOS}-{VALIDATION.MAX_PHOTOS} photos to show more of yourself. The first photo is your primary photo.
      </Text>

      <View style={styles.photoGrid}>{renderPhotoGrid()}</View>

      <View style={styles.tips}>
        <Text style={styles.tipsTitle}>Photo Tips:</Text>
        <View style={styles.tipItem}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={styles.tipText}>Show your face clearly in at least one photo</Text>
        </View>
        <View style={styles.tipItem}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={styles.tipText}>Include photos that show your interests</Text>
        </View>
        <View style={styles.tipItem}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={styles.tipText}>Use recent, high-quality photos</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          disabled={photos.length < VALIDATION.MIN_PHOTOS}
          fullWidth
        />
        {photos.length < VALIDATION.MIN_PHOTOS && (
          <Text style={styles.hint}>
            Add at least {VALIDATION.MIN_PHOTOS} photo{VALIDATION.MIN_PHOTOS > 1 ? 's' : ''} to continue
          </Text>
        )}
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
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  photoItem: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  primaryBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  primaryText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.white,
  },
  addPhotoButton: {
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoText: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 8,
  },
  tips: {
    backgroundColor: COLORS.backgroundDark,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  tipText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  footer: {
    marginTop: 24,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
  },
});
