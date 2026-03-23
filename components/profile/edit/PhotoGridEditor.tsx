/**
 * PhotoGridEditor Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles 9-slot photo grid with reordering, blur toggle, and main photo badge.
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

// Detect if a photo URL is a cartoon/avatar (should never be blurred)
function isCartoonPhoto(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes('cartoon') ||
    lowerUrl.includes('avatar') ||
    lowerUrl.includes('illustrated') ||
    lowerUrl.includes('anime') ||
    lowerUrl.includes('robohash') ||
    lowerUrl.includes('dicebear') ||
    lowerUrl.includes('ui-avatars')
  );
}

function isValidPhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && url !== 'undefined' && url !== 'null';
}

interface PhotoGridEditorProps {
  photoSlots: PhotoSlots9;
  failedSlots: Set<number>;
  blurEnabled: boolean;
  blurredPhotos: Record<number, boolean>;
  validPhotoCount: number;
  onUploadPhoto: (slotIndex: number) => void;
  onRemovePhoto: (slotIndex: number) => void;
  onSetMainPhoto: (fromSlot: number) => void;
  onTogglePhotoBlur: (index: number) => void;
  onPreviewPhoto: (photo: { url: string; index: number }) => void;
  onImageError: (slotIndex: number) => void;
  onPhotoLoad: (slotIndex: number) => void;
}

export function PhotoGridEditor({
  photoSlots,
  failedSlots,
  blurEnabled,
  blurredPhotos,
  validPhotoCount,
  onUploadPhoto,
  onRemovePhoto,
  onSetMainPhoto,
  onTogglePhotoBlur,
  onPreviewPhoto,
  onImageError,
  onPhotoLoad,
}: PhotoGridEditorProps) {
  const renderPhotoSlot = (slotIndex: number) => {
    const url = photoSlots[slotIndex];
    const hasValidPhoto = isValidPhotoUrl(url) && !failedSlots.has(slotIndex);

    if (hasValidPhoto) {
      const isMain = slotIndex === 0;
      const isCartoon = isCartoonPhoto(url!);
      const isPhotoBlurred = blurEnabled && !isCartoon && blurredPhotos[slotIndex];

      return (
        <View key={slotIndex} style={styles.photoSlot}>
          {/* Tap photo to preview */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => onPreviewPhoto({ url: url!, index: slotIndex })}>
            <Image
              source={{ uri: url }}
              style={styles.photoImage}
              contentFit="cover"
              blurRadius={isPhotoBlurred ? 8 : 0}
              transition={200}
              onError={() => onImageError(slotIndex)}
              onLoadEnd={() => onPhotoLoad(slotIndex)}
            />
          </Pressable>
          {/* Per-photo blur toggle - only show when blur mode enabled and not a cartoon */}
          {blurEnabled && !isCartoon && (
            <TouchableOpacity
              style={[styles.photoBlurButton, blurredPhotos[slotIndex] && styles.photoBlurButtonActive]}
              onPress={() => onTogglePhotoBlur(slotIndex)}
            >
              <Ionicons
                name={blurredPhotos[slotIndex] ? 'eye-off' : 'eye'}
                size={14}
                color={COLORS.white}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.photoRemoveButton} onPress={() => onRemovePhoto(slotIndex)}>
            <Ionicons name="close" size={14} color={COLORS.white} />
          </TouchableOpacity>
          {/* Main badge or Set as Main button */}
          {isMain ? (
            <View style={styles.mainBadge}><Text style={styles.mainBadgeText}>Main</Text></View>
          ) : (
            <TouchableOpacity style={styles.setMainButton} onPress={() => onSetMainPhoto(slotIndex)}>
              <Ionicons name="star" size={10} color={COLORS.white} />
            </TouchableOpacity>
          )}
        </View>
      );
    }
    // Empty slot
    return (
      <TouchableOpacity key={slotIndex} style={[styles.photoSlot, styles.photoSlotEmpty]} onPress={() => onUploadPhoto(slotIndex)} activeOpacity={0.7}>
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
  photoBlurButton: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBlurButtonActive: {
    backgroundColor: COLORS.primary,
  },
  photoRemoveButton: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  uploadText: { fontSize: 11, color: COLORS.primary, marginTop: 4, fontWeight: '500' },
  photoCount: { fontSize: 12, color: COLORS.textLight, textAlign: 'center', marginTop: 12 },
  mainBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  mainBadgeText: { fontSize: 10, fontWeight: '700', color: COLORS.white },
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
