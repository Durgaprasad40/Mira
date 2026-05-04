/**
 * SingleThumbSlider - Shared (Phase-1 + Phase-2)
 *
 * A single-thumb slider for distance/value selection.
 * Features:
 * - Single draggable thumb
 * - Smooth, responsive gesture handling using react-native-gesture-handler
 * - Live helper text display
 * - Step size of 1
 * - Dark + light theme support via isDarkTheme prop
 *
 * PERFORMANCE:
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

const THUMB_SIZE = 28;
const TRACK_HEIGHT = 8;
const HIT_SLOP = 20;

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
      {/* Premium value pill — matches RangeSlider styling */}
      <View
        style={[
          styles.valuePill,
          {
            backgroundColor: isDarkTheme
              ? 'rgba(233, 69, 96, 0.12)'
              : 'rgba(255, 107, 107, 0.08)',
            borderColor: isDarkTheme
              ? 'rgba(233, 69, 96, 0.35)'
              : 'rgba(255, 107, 107, 0.25)',
          },
        ]}
      >
        <Text style={[styles.valuePrefix, { color: theme.primary }]}>
          {helperTextPrefix}
        </Text>
        <Text style={[styles.valueNumber, { color: theme.primary }]}>
          {' '}
          {localValue}
        </Text>
        <Text style={[styles.valueUnit, { color: theme.primary }]}> {unit}</Text>
      </View>

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
                {
                  backgroundColor: '#FFFFFF',
                  borderColor: thumbBg,
                  left: thumbPos,
                },
              ]}
            >
              <View style={[styles.thumbCore, { backgroundColor: thumbBg }]} />
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      <View style={styles.labelsRow}>
        <Text
          style={[
            styles.limitLabel,
            { color: isDarkTheme ? INCOGNITO_COLORS.textLight : COLORS.textLight },
          ]}
        >
          {minValue}
        </Text>
        <Text
          style={[
            styles.limitLabel,
            { color: isDarkTheme ? INCOGNITO_COLORS.textLight : COLORS.textLight },
          ]}
        >
          {maxValue}
        </Text>
      </View>
    </View>
  );
}

const SLIDER_HEIGHT = THUMB_SIZE + 24;

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  valuePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 18,
  },
  valuePrefix: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.85,
  },
  valueNumber: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  valueUnit: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.85,
  },
  sliderContainer: {
    height: SLIDER_HEIGHT,
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  track: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    right: THUMB_SIZE / 2,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    top: (SLIDER_HEIGHT - TRACK_HEIGHT) / 2,
  },
  activeTrack: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    top: (SLIDER_HEIGHT - TRACK_HEIGHT) / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    top: (SLIDER_HEIGHT - THUMB_SIZE) / 2,
  },
  thumbCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 6,
  },
  limitLabel: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.7,
  },
});

export default SingleThumbSlider;
