import React, { useState } from 'react';
import { View, Text, StyleSheet, Dimensions, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PhotoCarouselProps {
  photos: Array<{ url: string; id?: string }>;
  height?: number;
  showDots?: boolean;
  showCounter?: boolean;
}

export function PhotoCarousel({
  photos,
  height = SCREEN_WIDTH * 0.8,
  showDots = true,
  showCounter = true,
}: PhotoCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!photos || photos.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <Ionicons name="image-outline" size={48} color={COLORS.textLight} />
      </View>
    );
  }

  const handleScroll = (event: any) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / SCREEN_WIDTH);
    setCurrentIndex(index);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}
      >
        {photos.map((photo, index) => (
          <Image
            key={photo.id || index}
            source={{ uri: photo.url }}
            style={[styles.photo, { width: SCREEN_WIDTH, height }]}
            contentFit="cover"
          />
        ))}
      </ScrollView>

      {showDots && photos.length > 1 && (
        <View style={styles.dotsContainer}>
          {photos.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                index === currentIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>
      )}

      {showCounter && photos.length > 1 && (
        <View style={styles.counter}>
          <Text style={styles.counterText}>
            {currentIndex + 1} / {photos.length}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  scrollView: {
    flexGrow: 0,
  },
  photo: {
    backgroundColor: COLORS.border,
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.white,
    opacity: 0.5,
  },
  dotActive: {
    opacity: 1,
    width: 20,
  },
  counter: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  counterText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
});
