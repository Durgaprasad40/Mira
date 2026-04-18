/**
 * PhotoGridEditor Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles 9-slot photo grid with reordering and main photo badge.
 *
 * NO LOGIC CHANGES - Structure refactor only.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { PhotoSlots9 } from '@/types';

const GRID_SIZE = 9;
const COLUMNS = 3;
const GRID_GAP = 8;
const SCREEN_PADDING = 16;
const screenWidth = Dimensions.get('window').width;
const slotSize = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

function isValidPhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && url !== 'undefined' && url !== 'null';
}

interface PhotoGridEditorProps {
  photoSlots: PhotoSlots9;
  failedSlots: Set<number>;
  validPhotoCount: number;
  onUploadPhoto: (slotIndex: number) => void;
  onRemovePhoto: (slotIndex: number) => void;
  onSetMainPhoto: (fromSlot: number) => void;
  onPreviewPhoto: (photo: { url: string; index: number }) => void;
  onImageError: (slotIndex: number) => void;
  onPhotoLoad: (slotIndex: number) => void;
}

export function PhotoGridEditor({
  photoSlots,
  failedSlots,
  validPhotoCount,
  onUploadPhoto,
  onRemovePhoto,
  onSetMainPhoto,
  onPreviewPhoto,
  onImageError,
  onPhotoLoad,
}: PhotoGridEditorProps) {
  const renderPhotoSlot = (slotIndex: number) => {
    const url = photoSlots[slotIndex];
    const hasValidPhoto = isValidPhotoUrl(url) && !failedSlots.has(slotIndex);

    if (hasValidPhoto) {
      const isMain = slotIndex === 0;

      return (
        <View key={slotIndex} style={styles.photoSlot}>
          {/* Tap photo to preview */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => onPreviewPhoto({ url: url!, index: slotIndex })}
            accessibilityLabel={`Preview photo ${slotIndex + 1}`}
          >
            <Image
              source={{ uri: url }}
              style={styles.photoImage}
              contentFit="cover"
              transition={200}
              onError={() => onImageError(slotIndex)}
              onLoadEnd={() => onPhotoLoad(slotIndex)}
            />
          </Pressable>
          <TouchableOpacity
            style={styles.photoRemoveButton}
            onPress={() => onRemovePhoto(slotIndex)}
            accessibilityLabel={`Remove photo ${slotIndex + 1}`}
          >
            <Ionicons name="close" size={14} color={COLORS.white} />
          </TouchableOpacity>
          {/* Star indicator: filled = current main (slot 0), outline = tap to make main */}
          {isMain ? (
            <View style={styles.mainStarBadge}>
              <Ionicons name="star" size={12} color="#FFD700" />
            </View>
          ) : (
            <TouchableOpacity
              style={styles.setMainButton}
              onPress={() => onSetMainPhoto(slotIndex)}
              accessibilityLabel={`Set photo ${slotIndex + 1} as main photo`}
            >
              <Ionicons name="star-outline" size={12} color={COLORS.white} />
            </TouchableOpacity>
          )}
        </View>
      );
    }
    // Empty slot
    return (
      <TouchableOpacity
        key={slotIndex}
        style={[styles.photoSlot, styles.photoSlotEmpty]}
        onPress={() => onUploadPhoto(slotIndex)}
        activeOpacity={0.7}
        accessibilityLabel={`Add photo to slot ${slotIndex + 1}`}
      >
        <Ionicons name="add" size={28} color={COLORS.primary} />
        <Text style={styles.uploadText}>Add</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Photos</Text>
      <Text style={styles.sectionHint}>Add up to 9 photos. Your first photo will be your main profile picture.</Text>
      <View style={styles.photoGrid}>{Array.from({ length: GRID_SIZE }).map((_, i) => renderPhotoSlot(i))}</View>
      <Text style={styles.photoCount}>{validPhotoCount} of {GRID_SIZE} photos</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  sectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  photoSlot: { width: slotSize, height: slotSize * 1.25, borderRadius: 10, overflow: 'hidden', backgroundColor: COLORS.backgroundDark },
  photoSlotEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.border, borderStyle: 'dashed' },
  photoImage: { width: '100%', height: '100%' },
  photoRemoveButton: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  uploadText: { fontSize: 11, color: COLORS.primary, marginTop: 4, fontWeight: '500' },
  photoCount: { fontSize: 12, color: COLORS.textLight, textAlign: 'center', marginTop: 12 },
  // Filled star badge for main photo (slot 0)
  mainStarBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setMainButton: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
