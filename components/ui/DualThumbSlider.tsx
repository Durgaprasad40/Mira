/**
 * DualThumbSlider - PHASE-2 ONLY
 *
 * A dual-thumb range slider for age selection.
 * Features:
 * - Left thumb = minimum age
 * - Right thumb = maximum age
 * - Minimum 2-year gap between thumbs
 * - Thumbs cannot cross
 * - Values constrained between minLimit and maxLimit (default 18-70)
 * - Smooth, responsive gesture handling using react-native-gesture-handler
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

interface DualThumbSliderProps {
  minValue: number;
  maxValue: number;
  minLimit?: number;
  maxLimit?: number;
  minGap?: number; // Minimum gap between thumbs (default 2)
  onValuesChange: (min: number, max: number) => void;
  isDarkTheme?: boolean;
}

const THUMB_SIZE = 32;
const TRACK_HEIGHT = 6;
const HIT_SLOP = 16;

export function DualThumbSlider({
  minValue,
  maxValue,
  minLimit = 18,
  maxLimit = 70,
  minGap = 2,
  onValuesChange,
  isDarkTheme = true,
}: DualThumbSliderProps) {
  const [sliderWidth, setSliderWidth] = useState(0);

  // LOCAL state for smooth dragging - only commits to parent on release
  const [localMin, setLocalMin] = useState(minValue);
  const [localMax, setLocalMax] = useState(maxValue);

  // Track if we've initialized from props (prevents reset on re-render)
  const didInit = useRef(false);

  // Sync local state from props ONLY on initial mount or when props change externally
  useEffect(() => {
    if (!didInit.current) {
      // First mount - initialize from props
      setLocalMin(minValue);
      setLocalMax(maxValue);
      didInit.current = true;
    }
  }, [minValue, maxValue]);

  // Shared values for worklet-safe tracking (avoids "Tried to modify key current" warning)
  const minShared = useSharedValue(minValue);
  const maxShared = useSharedValue(maxValue);
  const sliderWidthShared = useSharedValue(0);
  const minStartX = useSharedValue(0);
  const maxStartX = useSharedValue(0);

  // Sync shared values when local state changes
  useEffect(() => {
    minShared.value = localMin;
    maxShared.value = localMax;
  }, [localMin, localMax]);

  // Theme colors
  const theme = isDarkTheme ? INCOGNITO_COLORS : COLORS;
  const trackBg = isDarkTheme ? '#3A3A3A' : '#E0E0E0';
  const activeTrackColor = theme.primary;
  const thumbBg = isDarkTheme ? theme.primary : COLORS.primary;

  // Calculate effective track width
  const effectiveWidth = sliderWidth > 0 ? sliderWidth - THUMB_SIZE : 0;
  const range = maxLimit - minLimit;

  // Calculate position from value
  const valueToPosition = useCallback((value: number): number => {
    if (effectiveWidth === 0) return 0;
    return ((value - minLimit) / range) * effectiveWidth;
  }, [effectiveWidth, minLimit, range]);

  // Handle layout
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setSliderWidth(width);
    sliderWidthShared.value = width;
  }, []);

  // Update local min during drag (fast, no store write)
  const updateLocalMin = useCallback((newMin: number) => {
    setLocalMin((prevMin) => {
      const clampedMin = Math.max(minLimit, Math.min(newMin, localMax - minGap));
      return clampedMin !== prevMin ? clampedMin : prevMin;
    });
  }, [minLimit, minGap, localMax]);

  // Update local max during drag (fast, no store write)
  const updateLocalMax = useCallback((newMax: number) => {
    setLocalMax((prevMax) => {
      const clampedMax = Math.min(maxLimit, Math.max(newMax, localMin + minGap));
      return clampedMax !== prevMax ? clampedMax : prevMax;
    });
  }, [maxLimit, minGap, localMin]);

  // Commit to parent store on gesture end
  const commitValues = useCallback(() => {
    onValuesChange(localMin, localMax);
  }, [onValuesChange, localMin, localMax]);

  // Min thumb gesture
  const minGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      const r = maxLimit - minLimit;
      minStartX.value = ((minShared.value - minLimit) / r) * ew;
    })
    .onUpdate((event) => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      if (ew <= 0) return;

      const r = maxLimit - minLimit;
      const newX = minStartX.value + event.translationX;
      const clampedX = Math.max(0, Math.min(ew, newX));
      const newValue = Math.round((clampedX / ew) * r + minLimit);

      runOnJS(updateLocalMin)(newValue);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(commitValues)();
    })
    .hitSlop({ top: HIT_SLOP, bottom: HIT_SLOP, left: HIT_SLOP, right: HIT_SLOP })
    .minDistance(0)
    .activeOffsetX([-5, 5]),
  [minLimit, maxLimit, updateLocalMin, commitValues]);

  // Max thumb gesture
  const maxGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      const r = maxLimit - minLimit;
      maxStartX.value = ((maxShared.value - minLimit) / r) * ew;
    })
    .onUpdate((event) => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      if (ew <= 0) return;

      const r = maxLimit - minLimit;
      const newX = maxStartX.value + event.translationX;
      const clampedX = Math.max(0, Math.min(ew, newX));
      const newValue = Math.round((clampedX / ew) * r + minLimit);

      runOnJS(updateLocalMax)(newValue);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(commitValues)();
    })
    .hitSlop({ top: HIT_SLOP, bottom: HIT_SLOP, left: HIT_SLOP, right: HIT_SLOP })
    .minDistance(0)
    .activeOffsetX([-5, 5]),
  [minLimit, maxLimit, updateLocalMax, commitValues]);

  // Calculate positions using LOCAL state (not props)
  const minPos = valueToPosition(localMin);
  const maxPos = valueToPosition(localMax);

  return (
    <View style={styles.container}>
      {/* Helper text shows LOCAL state for instant feedback */}
      <Text style={[styles.helperText, { color: theme.primary }]}>
        Showing profiles aged {localMin}–{localMax}
      </Text>

      <View style={styles.sliderContainer} onLayout={handleLayout}>
        <View style={[styles.track, { backgroundColor: trackBg }]} />

        {sliderWidth > 0 && (
          <View
            style={[
              styles.activeTrack,
              {
                backgroundColor: activeTrackColor,
                left: minPos + THUMB_SIZE / 2,
                width: Math.max(0, maxPos - minPos),
              },
            ]}
          />
        )}

        {sliderWidth > 0 && (
          <GestureDetector gesture={minGesture}>
            <Animated.View
              style={[
                styles.thumb,
                { backgroundColor: thumbBg, left: minPos },
              ]}
            >
              <Text style={styles.thumbText}>{localMin}</Text>
            </Animated.View>
          </GestureDetector>
        )}

        {sliderWidth > 0 && (
          <GestureDetector gesture={maxGesture}>
            <Animated.View
              style={[
                styles.thumb,
                { backgroundColor: thumbBg, left: maxPos },
              ]}
            >
              <Text style={styles.thumbText}>{localMax}</Text>
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      <View style={styles.labelsRow}>
        <Text style={[styles.limitLabel, { color: isDarkTheme ? INCOGNITO_COLORS.textLight : COLORS.textLight }]}>
          {minLimit}
        </Text>
        <Text style={[styles.limitLabel, { color: isDarkTheme ? INCOGNITO_COLORS.textLight : COLORS.textLight }]}>
          {maxLimit}
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

export default DualThumbSlider;
