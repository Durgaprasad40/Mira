/**
 * ClusterPinMarker — Blue teardrop map pin for clustered profiles.
 *
 * Design: Static PNG pin background with count text overlay in center circle.
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
 * 6. Double requestAnimationFrame ensures snapshot happens AFTER paint
 * 7. Fallback timeout (250ms) in case onLayout/onLoad are delayed
 * 8. NO overflow:hidden on root
 * 9. Marker anchor should be { x: 0.5, y: 1 } (bottom-center, tip at coordinate)
 * 10. refreshToken prop triggers re-snapshot when map zoom/pan ends
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

export interface ClusterPinMarkerProps {
  /** Number of profiles in this cluster */
  count: number;
  /** Optional callback when the marker is ready (for disabling tracksViewChanges) */
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
// Slightly smaller than UserPinMarker
const MARKER_WIDTH = 80;
const MARKER_HEIGHT = 100;

// Count circle dimensions and position (calculated from PNG coordinates)
// PNG: circle at (128, 112) with radius 78 in 256x320 viewBox
// Scaled: center at (40, 35) with radius ~24.4 in 80x100
const COUNT_CIRCLE_SIZE = 48;
const COUNT_CIRCLE_TOP = 11;  // Adjusted for smaller marker
const COUNT_CIRCLE_LEFT = (MARKER_WIDTH - COUNT_CIRCLE_SIZE) / 2; // centered horizontally

// Label position (below the pin)
const LABEL_TOP = 80;

// Fallback timeout if onLayout/onLoad don't fire
const LAYOUT_FALLBACK_MS = 250;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ClusterPinMarkerComponent({ count, onReady, refreshToken = 0 }: ClusterPinMarkerProps) {
  // Track all load states
  const [laidOut, setLaidOut] = useState(false);
  const [pinImageLoaded, setPinImageLoaded] = useState(false);
  const hasFiredReady = useRef(false);
  const lastRefreshToken = useRef(refreshToken);

  // Format count for display
  const displayCount = count > 99 ? '99+' : String(count);

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

  // Check if ready to freeze: layout + pin PNG loaded
  useEffect(() => {
    if (laidOut && pinImageLoaded && !hasFiredReady.current) {
      tryFireReady();
    }
  }, [laidOut, pinImageLoaded, tryFireReady, refreshToken]);

  // Fallback: fire onReady after timeout if onLayout/onLoad don't fire
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasFiredReady.current) {
        tryFireReady();
      }
    }, LAYOUT_FALLBACK_MS);

    return () => clearTimeout(timer);
  }, [tryFireReady, refreshToken]);

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
        style={styles.pinImage}
        resizeMode="contain"
        onLoad={handlePinLoad}
      />

      {/* Count circle overlay (positioned over the white center) */}
      <View style={styles.countCircle}>
        <Text style={styles.countText}>{displayCount}</Text>
      </View>

      {/* Label below pin */}
      <View style={styles.labelContainer}>
        <Ionicons name="people" size={10} color={COLORS.textLight} />
        <Text style={styles.labelText}>
          {count} {count === 1 ? 'person' : 'people'}
        </Text>
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
    height: MARKER_HEIGHT + 28, // Extra space for label
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

  // Count circle - positioned over the white center in the PNG
  countCircle: {
    position: 'absolute',
    top: COUNT_CIRCLE_TOP,
    left: COUNT_CIRCLE_LEFT,
    width: COUNT_CIRCLE_SIZE,
    height: COUNT_CIRCLE_SIZE,
    borderRadius: COUNT_CIRCLE_SIZE / 2,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Count text
  countText: {
    fontSize: 18,
    fontWeight: '700',
    color: PIN_BLUE,
    textAlign: 'center',
  },

  // Label below pin
  labelContainer: {
    position: 'absolute',
    top: LABEL_TOP,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
    gap: 4,
  },
  labelText: {
    fontSize: 10,
    fontWeight: '500',
    color: COLORS.textLight,
  },
});

// ---------------------------------------------------------------------------
// Export (memoized for performance)
// ---------------------------------------------------------------------------

export const ClusterPinMarker = memo(ClusterPinMarkerComponent);
