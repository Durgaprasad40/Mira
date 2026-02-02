import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const { width } = Dimensions.get('window');
const GRID_PADDING = 16;
const GRID_GAP = 8;
const COLS = 3;
const ITEM_SIZE = (width - GRID_PADDING * 2 - GRID_GAP * (COLS - 1)) / COLS;

interface PhotoItem {
  id: string;
  url: string;
}

interface PhotoSelectionGridProps {
  photos: PhotoItem[];
  selectedIds: string[];
  onToggle: (id: string, url: string) => void;
  maxSelection?: number;
}

const C = INCOGNITO_COLORS;

export function PhotoSelectionGrid({
  photos,
  selectedIds,
  onToggle,
  maxSelection = 6,
}: PhotoSelectionGridProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        Select 1-{maxSelection} photos from your main profile
      </Text>
      <View style={styles.grid}>
        {photos.map((photo) => {
          const isSelected = selectedIds.includes(photo.id);
          const selectionIndex = selectedIds.indexOf(photo.id);
          const isMaxed = selectedIds.length >= maxSelection && !isSelected;

          return (
            <TouchableOpacity
              key={photo.id}
              style={[styles.item, isSelected && styles.itemSelected]}
              onPress={() => !isMaxed && onToggle(photo.id, photo.url)}
              activeOpacity={isMaxed ? 0.5 : 0.8}
            >
              <Image source={{ uri: photo.url }} style={styles.image} />
              {isSelected && (
                <View style={styles.checkOverlay}>
                  <View style={styles.checkBadge}>
                    <Text style={styles.checkNumber}>{selectionIndex + 1}</Text>
                  </View>
                </View>
              )}
              {isMaxed && (
                <View style={styles.disabledOverlay} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.count}>
        {selectedIds.length} of {maxSelection} selected
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: GRID_PADDING },
  hint: { fontSize: 13, color: C.textLight, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  item: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.3,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  itemSelected: { borderColor: C.primary },
  image: { width: '100%', height: '100%' },
  checkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: 6,
  },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkNumber: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  disabledOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  count: {
    fontSize: 13,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 12,
  },
});
