/**
 * PhotoCircle — Circular profile photo overlay for map markers.
 *
 * This is rendered as a SECOND marker overlay on top of the native pin image.
 * Designed for Android stability (no 1/4 quadrant snapshot bug).
 *
 * Design:
 * - Perfect circle crop (overflow hidden)
 * - White border ring
 * - No fade on Android (fadeDuration=0)
 * - Calls onReady only after layout + photo load OR placeholder render
 * - collapsable={false} + renderToHardwareTextureAndroid for stability
 */
import React, { useEffect, useRef } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhotoCircleProps {
  /** URL of the user's photo (http/https/file) */
  photoUrl?: string | null;
  /** Size of the circle (default 44) */
  size?: number;
  /** Callback when ready to freeze tracking */
  onReady?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhotoCircle({ photoUrl, size = 44, onReady }: PhotoCircleProps) {
  const didLayout = useRef(false);
  const didVisual = useRef(false);
  const fired = useRef(false);

  const tryReady = () => {
    if (fired.current) return;
    if (!didLayout.current) return;
    if (!didVisual.current) return;

    fired.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()));
  };

  // Check if URL is valid (http/https/file)
  const validUrl =
    typeof photoUrl === 'string' &&
    photoUrl.length > 8 &&
    (photoUrl.startsWith('http://') || photoUrl.startsWith('https://') || photoUrl.startsWith('file:'));

  // Reset refs when photo changes so we re-gate properly
  useEffect(() => {
    fired.current = false;
    didLayout.current = false;
    didVisual.current = false;
  }, [photoUrl]);

  // DEBUG: Log what we're rendering
  if (__DEV__) {
    console.log('[PhotoCircle] render', { photoUrl: photoUrl?.substring(0, 50), validUrl });
  }

  return (
    <View
      collapsable={false}
      renderToHardwareTextureAndroid
      onLayout={() => {
        didLayout.current = true;
        tryReady();
      }}
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      {validUrl ? (
        <Image
          source={{ uri: photoUrl! }}
          style={styles.photo}
          resizeMode="cover"
          fadeDuration={0}
          onLoad={() => {
            if (__DEV__) {
              console.log('[PhotoCircle] onLoad', photoUrl?.substring(0, 50));
            }
            didVisual.current = true;
            tryReady();
          }}
          onError={(e) => {
            if (__DEV__) {
              console.log('[PhotoCircle] onError', { photoUrl: photoUrl?.substring(0, 50), error: e?.nativeEvent });
            }
            // If load fails, show placeholder instead and still ready
            didVisual.current = true;
            tryReady();
          }}
        />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons name="person" size={size * 0.45} color="#999" />
          {(() => {
            // Placeholder is immediately "visual ready"
            didVisual.current = true;
            // Use setTimeout to avoid calling during render
            setTimeout(() => tryReady(), 0);
            return null;
          })()}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#fff',
  },
  placeholder: {
    flex: 1,
    backgroundColor: '#eee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
});
