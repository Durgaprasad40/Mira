/**
 * SingleThumbSlider - PHASE-2 ONLY
 *
 * A single-thumb slider for distance/value selection.
 * Features:
 * - Single draggable thumb
 * - Smooth, responsive gesture handling using react-native-gesture-handler
 * - Live helper text display
 * - Step size of 1
 *
 * PERFORMANCE FIX:
 * - Uses local state during drag, only commits to parent on release
 * - Uses useSharedValue for worklet-safe value tracking (no ref.current mutations)
 */
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import { INCOGNITO_COLORS, COLORS } from '@/lib/constants';

interface SingleThumbSliderProps {
  value: number;
  minValue?: number;
  maxValue?: number;
  unit?: string; // e.g., "miles"
  helperTextPrefix?: string; // e.g., "Showing profiles within"
  onValueChange: (value: number) => void;
  isDarkTheme?: boolean;
}

const THUMB_SIZE = 32;
const TRACK_HEIGHT = 6;
const HIT_SLOP = 16;

export function SingleThumbSlider({
  value,
  minValue = 0,
  maxValue = 100,
  unit = 'miles',
  helperTextPrefix = 'Showing profiles within',
  onValueChange,
  isDarkTheme = true,
}: SingleThumbSliderProps) {
  const [sliderWidth, setSliderWidth] = useState(0);

  // LOCAL state for smooth dragging - only commits to parent on release
  const [localValue, setLocalValue] = useState(value);

  // Track if we've initialized from props (prevents reset on re-render)
  const didInit = useRef(false);

  // Sync local state from props ONLY on initial mount
  useEffect(() => {
    if (!didInit.current) {
      setLocalValue(value);
      didInit.current = true;
    }
  }, [value]);

  // Shared values for worklet-safe tracking (avoids "Tried to modify key current" warning)
  const valueShared = useSharedValue(value);
  const sliderWidthShared = useSharedValue(0);
  const startX = useSharedValue(0);

  // Sync shared value when local state changes
  useEffect(() => {
    valueShared.value = localValue;
  }, [localValue]);

  // Theme colors
  const theme = isDarkTheme ? INCOGNITO_COLORS : COLORS;
  const trackBg = isDarkTheme ? '#3A3A3A' : '#E0E0E0';
  const activeTrackColor = theme.primary;
  const thumbBg = isDarkTheme ? theme.primary : COLORS.primary;

  // Calculate effective track width
  const effectiveWidth = sliderWidth > 0 ? sliderWidth - THUMB_SIZE : 0;
  const range = maxValue - minValue;

  // Calculate position from value
  const valueToPosition = useCallback((val: number): number => {
    if (effectiveWidth === 0) return 0;
    return ((val - minValue) / range) * effectiveWidth;
  }, [effectiveWidth, minValue, range]);

  // Handle layout
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setSliderWidth(width);
    sliderWidthShared.value = width;
  }, []);

  // Update local value during drag (fast, no store write)
  const updateLocalValue = useCallback((newValue: number) => {
    setLocalValue((prev) => {
      const clamped = Math.max(minValue, Math.min(maxValue, newValue));
      return clamped !== prev ? clamped : prev;
    });
  }, [minValue, maxValue]);

  // Commit to parent store on gesture end
  const commitValue = useCallback(() => {
    onValueChange(localValue);
  }, [onValueChange, localValue]);

  // Thumb gesture
  const thumbGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      const r = maxValue - minValue;
      startX.value = ((valueShared.value - minValue) / r) * ew;
    })
    .onUpdate((event) => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      if (ew <= 0) return;

      const r = maxValue - minValue;
      const newX = startX.value + event.translationX;
      const clampedX = Math.max(0, Math.min(ew, newX));
      const newValue = Math.round((clampedX / ew) * r + minValue);

      runOnJS(updateLocalValue)(newValue);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(commitValue)();
    })
    .hitSlop({ top: HIT_SLOP, bottom: HIT_SLOP, left: HIT_SLOP, right: HIT_SLOP })
    .minDistance(0)
    .activeOffsetX([-5, 5]),
  [minValue, maxValue, updateLocalValue, commitValue]);

  // Calculate position using LOCAL state (not props)
  const thumbPos = valueToPosition(localValue);

  return (
    <View style={styles.container}>
      {/* Helper text shows LOCAL state for instant feedback */}
      <Text style={[styles.helperText, { color: theme.primary }]}>
        {helperTextPrefix} {localValue} {unit}
      </Text>

      <View style={styles.sliderContainer} onLayout={handleLayout}>
        <View style={[styles.track, { backgroundColor: trackBg }]} />

        {sliderWidth > 0 && (
          <View
            style={[
              styles.activeTrack,
              {
                backgroundColor: activeTrackColor,
                width: thumbPos + THUMB_SIZE / 2,
              },
            ]}
          />
        )}

        {sliderWidth > 0 && (
          <GestureDetector gesture={thumbGesture}>
            <Animated.View
              style={[
                styles.thumb,
                { backgroundColor: thumbBg, left: thumbPos },
              ]}
            >
              <Text style={styles.thumbText}>{localValue}</Text>
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      <View style={styles.labelsRow}>
        <Text style={[styles.limitLabel, { color: isDarkTheme ? INCOGNITO_COLORS.textLight : COLORS.textLight }]}>
          {minValue}
        </Text>
        <Text style={[styles.limitLabel, { color: isDarkTheme ? INCOGNITO_COLORS.textLight : COLORS.textLight }]}>
          {maxValue}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  helperText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  sliderContainer: {
    height: THUMB_SIZE + 20,
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  track: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    right: THUMB_SIZE / 2,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  activeTrack: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    top: (THUMB_SIZE + 20 - TRACK_HEIGHT) / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 3,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    top: (20 - THUMB_SIZE) / 2 + THUMB_SIZE / 2,
  },
  thumbText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  limitLabel: {
    fontSize: 12,
  },
});

export default SingleThumbSlider;
