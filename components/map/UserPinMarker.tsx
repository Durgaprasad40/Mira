/**
 * UserPinMarker — Blue teardrop map pin with profile photo.
 *
 * Design: Static PNG pin background with profile photo overlay in center circle.
 * This eliminates the layered View rendering that caused 1/4 quadrant clipping on Android.
 *
 * Android Rendering Fixes (CRITICAL for proper snapshot):
 * 1. Root container has explicit width/height, transparent background
 * 2. collapsable={false} prevents Android view flattening
 * 3. renderToHardwareTextureAndroid={true} for GPU rendering
 * 4. Static PNG background eliminates layered shape rendering issues
 * 5. tracksViewChanges stays TRUE until ALL loads complete:
 *    - root onLayout fired
 *    - pin PNG loaded
 *    - profile photo loaded OR errored
 * 6. Double requestAnimationFrame ensures snapshot happens AFTER paint
 * 7. NO overflow:hidden on root (only on inner photo circle)
 * 8. Marker anchor should be { x: 0.5, y: 1 } (bottom-center, tip at coordinate)
 * 9. refreshToken prop triggers re-snapshot when map zoom/pan ends
 */
import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { View, Image, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

// Static PNG asset for pin background (eliminates layered View clipping)
// React Native auto-selects @2x on high-density devices
const PIN_BLUE_PNG = require('../../assets/map/pin_blue.png');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserPinMarkerProps {
  /** URL of the user's photo */
  photoUrl: string;
  /** User's display name */
  name: string;
  /** Time string like "5m ago" */
  timeLabel?: string;
  /** Whether this marker is highlighted (focused) */
  isHighlighted?: boolean;
  /** Whether this marker has not been seen yet (shows tinted pin) */
  isUnseen?: boolean;
  /** Callback when marker is ready to freeze (all loads complete) */
  onReady?: () => void;
  /** Token that triggers re-snapshot when changed (for zoom/pan refresh) */
  refreshToken?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Pin colors
const PIN_BLUE = '#4A90D9';

// Marker dimensions (maintains PNG aspect ratio 256:320 = 0.8)
const MARKER_WIDTH = 90;
const MARKER_HEIGHT = 112;

// Photo circle dimensions and position (calculated from PNG coordinates)
// PNG: circle at (128, 112) with radius 78 in 256x320 viewBox
// Scaled: center at (45, 39) with radius 27.4 in 90x112
const PHOTO_CIRCLE_SIZE = 55;
const PHOTO_CIRCLE_TOP = 12;  // (39 - 27) = 12
const PHOTO_CIRCLE_LEFT = (MARKER_WIDTH - PHOTO_CIRCLE_SIZE) / 2; // centered horizontally

// Label position (below the pin)
const LABEL_TOP = 90; // just below pin tip

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function UserPinMarkerComponent({
  photoUrl,
  name,
  timeLabel,
  isHighlighted = false,
  isUnseen = false,
  onReady,
  refreshToken = 0,
}: UserPinMarkerProps) {
  // Track all load states
  const [laidOut, setLaidOut] = useState(false);
  const [pinImageLoaded, setPinImageLoaded] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const hasFiredReady = useRef(false);
  const lastRefreshToken = useRef(refreshToken);

  // Reset ready state when refreshToken changes (triggers re-snapshot)
  useEffect(() => {
    if (refreshToken !== lastRefreshToken.current) {
      lastRefreshToken.current = refreshToken;
      hasFiredReady.current = false;
    }
  }, [refreshToken]);

  // Fire onReady using double requestAnimationFrame
  const tryFireReady = useCallback(() => {
    if (hasFiredReady.current) return;
    hasFiredReady.current = true;

    // Double requestAnimationFrame for Android paint safety
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onReady?.();
      });
    });
  }, [onReady]);

  // Handle root layout complete
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setLaidOut(true);
  }, []);

  // Handle pin PNG load
  const handlePinLoad = useCallback(() => {
    setPinImageLoaded(true);
  }, []);

  // Handle profile photo load success
  const handlePhotoLoad = useCallback(() => {
    setPhotoLoaded(true);
  }, []);

  // Handle profile photo load error
  const handlePhotoError = useCallback(() => {
    setPhotoError(true);
    setPhotoLoaded(true); // Treat error as "done loading"
  }, []);

  // Check if ready to freeze: layout + pin PNG + (photo loaded OR errored)
  const photoReady = photoLoaded || photoError || !photoUrl;
  useEffect(() => {
    if (laidOut && pinImageLoaded && photoReady && !hasFiredReady.current) {
      tryFireReady();
    }
  }, [laidOut, pinImageLoaded, photoReady, tryFireReady, refreshToken]);

  // Show placeholder icon if no photo or photo failed to load
  const showPlaceholder = !photoUrl || photoError;

  // Tint styles for highlighted/unseen states
  const pinTintStyle = isUnseen
    ? { tintColor: '#E85D75' }
    : isHighlighted
    ? { tintColor: COLORS.primary }
    : undefined;

  return (
    // Root wrapper: explicit size, transparent bg, collapsable=false, NO overflow:hidden
    <View
      style={styles.root}
      onLayout={handleLayout}
      collapsable={false}
      renderToHardwareTextureAndroid={true}
    >
      {/* Pin background image (static PNG) */}
      <Image
        source={PIN_BLUE_PNG}
        style={[styles.pinImage, pinTintStyle]}
        resizeMode="contain"
        onLoad={handlePinLoad}
      />

      {/* Photo circle overlay (positioned over the white center) */}
      <View style={styles.photoCircle}>
        {showPlaceholder ? (
          // Person icon placeholder
          <Ionicons name="person" size={28} color={PIN_BLUE} />
        ) : (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            resizeMode="cover"
            onLoad={handlePhotoLoad}
            onError={handlePhotoError}
          />
        )}
      </View>

      {/* Name label below pin */}
      <View style={styles.labelContainer}>
        <Text style={styles.nameText} numberOfLines={1}>{name}</Text>
        {timeLabel && <Text style={styles.timeText}>{timeLabel}</Text>}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Root: explicit size, transparent bg, NO overflow:hidden
  root: {
    width: MARKER_WIDTH,
    height: MARKER_HEIGHT + 30, // Extra space for label
    alignItems: 'center',
    backgroundColor: 'transparent',
  },

  // Pin PNG background (fills marker area)
  pinImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: MARKER_WIDTH,
    height: MARKER_HEIGHT,
  },

  // Photo circle - positioned over the white center in the PNG
  // overflow:hidden ONLY here for circular photo crop
  photoCircle: {
    position: 'absolute',
    top: PHOTO_CIRCLE_TOP,
    left: PHOTO_CIRCLE_LEFT,
    width: PHOTO_CIRCLE_SIZE,
    height: PHOTO_CIRCLE_SIZE,
    borderRadius: PHOTO_CIRCLE_SIZE / 2,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden', // Only here for circular crop
  },

  // Profile photo
  photo: {
    width: PHOTO_CIRCLE_SIZE,
    height: PHOTO_CIRCLE_SIZE,
    borderRadius: PHOTO_CIRCLE_SIZE / 2,
  },

  // Name label below pin
  labelContainer: {
    position: 'absolute',
    top: LABEL_TOP,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
    maxWidth: MARKER_WIDTH + 10,
  },
  nameText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },
  timeText: {
    fontSize: 9,
    color: COLORS.textLight,
  },
});

// ---------------------------------------------------------------------------
// Export (memoized for performance)
// ---------------------------------------------------------------------------

export const UserPinMarker = memo(UserPinMarkerComponent);
