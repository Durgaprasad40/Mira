/**
 * CountCircle — Tiny overlay component for cluster count in map markers.
 *
 * This is rendered as a SECOND marker overlay on top of the native pin image.
 * Kept minimal to ensure stable Android snapshots.
 *
 * Design:
 * - Small white circle with count number
 * - No shadows, no opacity overlays, no shading
 * - Calls onReady ONLY after:
 *   a) layout done (onLayout fired)
 *   b) after double requestAnimationFrame (painted)
 * - collapsable={false} + renderToHardwareTextureAndroid for GPU rendering
 */
import React, { memo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CountCircleProps {
  /** Number to display */
  count: number;
  /** Size of the circle (default 40) */
  size?: number;
  /** Callback when ready to freeze tracking */
  onReady?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SIZE = 40;
const PIN_BLUE = '#4A90D9';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CountCircleComponent({
  count,
  size = DEFAULT_SIZE,
  onReady,
}: CountCircleProps) {
  // Ready gating refs — fire after layout + double rAF
  const didLayout = useRef(false);
  const fired = useRef(false);

  // Format count for display
  const displayCount = count > 99 ? '99+' : String(count);

  // Try to fire onReady — only fires once when layout is done
  const tryReady = useCallback(() => {
    if (fired.current) return;
    if (!didLayout.current) return;
    fired.current = true;

    // Double requestAnimationFrame ensures Android has painted before snapshot
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onReady?.();
      });
    });
  }, [onReady]);

  // Handle layout complete
  const handleLayout = useCallback((_event: LayoutChangeEvent) => {
    didLayout.current = true;
    tryReady();
  }, [tryReady]);

  const circleStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  // Adjust font size based on circle size
  const fontSize = size * 0.45;

  return (
    <View
      style={[styles.circle, circleStyle]}
      onLayout={handleLayout}
      collapsable={false}
      renderToHardwareTextureAndroid={true}
    >
      <Text style={[styles.countText, { fontSize }]}>{displayCount}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  circle: {
    backgroundColor: 'white', // Solid white, no transparency
    alignItems: 'center',
    justifyContent: 'center',
    // No opacity, no shadows — crisp solid circle
  },
  countText: {
    fontWeight: '700',
    color: PIN_BLUE,
    textAlign: 'center',
    opacity: 1, // Explicit full opacity
  },
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const CountCircle = memo(CountCircleComponent);
