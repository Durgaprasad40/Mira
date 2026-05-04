/**
 * RangeSlider - Shared (Phase-1 + Phase-2)
 *
 * A two-handle range slider used for selecting an age range (or any
 * numeric range with a min and max value). Mirrors the gesture/animation
 * approach used in SingleThumbSlider:
 *
 * - Smooth gesture handling via react-native-gesture-handler
 * - Worklet-safe shared values via react-native-reanimated
 * - Local state during drag, only commits to parent on release
 * - Dark + light theme aware
 * - Step size of 1
 *
 * The two thumbs are prevented from crossing each other so that the
 * resulting (lowValue, highValue) pair is always valid:
 *   lowValue <= highValue
 *
 * Touch targets are generous (32px thumb + 16px hitSlop) so the slider
 * is easy to drag on Samsung, OnePlus, small screens, and large screens.
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

interface RangeSliderProps {
  lowValue: number;
  highValue: number;
  minValue: number;
  maxValue: number;
  unit?: string; // e.g., "years"
  onValuesChange: (low: number, high: number) => void;
  isDarkTheme?: boolean;
}

const THUMB_SIZE = 28;
const TRACK_HEIGHT = 8;
const HIT_SLOP = 20;
const MIN_GAP = 1; // smallest allowed gap between low and high

export function RangeSlider({
  lowValue,
  highValue,
  minValue,
  maxValue,
  unit = 'years',
  onValuesChange,
  isDarkTheme = false,
}: RangeSliderProps) {
  const [sliderWidth, setSliderWidth] = useState(0);

  // LOCAL state for smooth dragging - only commits to parent on release
  const [localLow, setLocalLow] = useState(lowValue);
  const [localHigh, setLocalHigh] = useState(highValue);

  // Track if we've initialized from props (prevents reset on re-render)
  const didInit = useRef(false);

  // Sync local state from props ONLY on initial mount (and whenever parent
  // hydrates from server with very different values)
  useEffect(() => {
    if (!didInit.current) {
      setLocalLow(lowValue);
      setLocalHigh(highValue);
      didInit.current = true;
    }
  }, [lowValue, highValue]);

  // Shared values for worklet-safe tracking
  const lowShared = useSharedValue(lowValue);
  const highShared = useSharedValue(highValue);
  const sliderWidthShared = useSharedValue(0);
  const startX = useSharedValue(0);

  // Sync shared values when local state changes
  useEffect(() => {
    lowShared.value = localLow;
  }, [localLow]);
  useEffect(() => {
    highShared.value = localHigh;
  }, [localHigh]);

  // Theme colors
  const trackBg = isDarkTheme ? '#3A3A3A' : '#E0E0E0';
  const activeTrackColor = isDarkTheme ? INCOGNITO_COLORS.primary : COLORS.primary;
  const thumbBg = isDarkTheme ? INCOGNITO_COLORS.primary : COLORS.primary;
  const helperColor = isDarkTheme ? INCOGNITO_COLORS.primary : COLORS.primary;
  const limitColor = isDarkTheme ? INCOGNITO_COLORS.textLight : COLORS.textLight;

  // Calculate effective track width (accounts for thumb diameter so thumb
  // edges align with the visual track edges)
  const effectiveWidth = sliderWidth > 0 ? sliderWidth - THUMB_SIZE : 0;
  const range = maxValue - minValue;

  // Calculate position from value
  const valueToPosition = useCallback((val: number): number => {
    if (effectiveWidth === 0 || range === 0) return 0;
    return ((val - minValue) / range) * effectiveWidth;
  }, [effectiveWidth, minValue, range]);

  // Handle layout
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setSliderWidth(width);
    sliderWidthShared.value = width;
  }, []);

  // Update LOW value during drag (no parent commit)
  const updateLowValue = useCallback((newValue: number) => {
    setLocalLow((prev) => {
      const clamped = Math.max(minValue, Math.min(newValue, maxValue));
      // Don't allow crossing the high thumb
      const cappedByHigh = Math.min(clamped, localHigh - MIN_GAP);
      const next = Math.max(minValue, cappedByHigh);
      return next !== prev ? next : prev;
    });
  }, [minValue, maxValue, localHigh]);

  // Update HIGH value during drag (no parent commit)
  const updateHighValue = useCallback((newValue: number) => {
    setLocalHigh((prev) => {
      const clamped = Math.max(minValue, Math.min(newValue, maxValue));
      // Don't allow crossing the low thumb
      const flooredByLow = Math.max(clamped, localLow + MIN_GAP);
      const next = Math.min(maxValue, flooredByLow);
      return next !== prev ? next : prev;
    });
  }, [minValue, maxValue, localLow]);

  // Commit both values to parent on gesture end
  const commitValues = useCallback(() => {
    onValuesChange(localLow, localHigh);
  }, [onValuesChange, localLow, localHigh]);

  // LOW thumb gesture
  const lowGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      const r = maxValue - minValue;
      startX.value = r > 0 ? ((lowShared.value - minValue) / r) * ew : 0;
    })
    .onUpdate((event) => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      if (ew <= 0) return;

      const r = maxValue - minValue;
      const newX = startX.value + event.translationX;
      const clampedX = Math.max(0, Math.min(ew, newX));
      const newValue = Math.round((clampedX / ew) * r + minValue);

      runOnJS(updateLowValue)(newValue);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(commitValues)();
    })
    .hitSlop({ top: HIT_SLOP, bottom: HIT_SLOP, left: HIT_SLOP, right: HIT_SLOP })
    .minDistance(0)
    .activeOffsetX([-5, 5]),
  [minValue, maxValue, updateLowValue, commitValues]);

  // HIGH thumb gesture
  const highGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      const r = maxValue - minValue;
      startX.value = r > 0 ? ((highShared.value - minValue) / r) * ew : 0;
    })
    .onUpdate((event) => {
      'worklet';
      const ew = sliderWidthShared.value - THUMB_SIZE;
      if (ew <= 0) return;

      const r = maxValue - minValue;
      const newX = startX.value + event.translationX;
      const clampedX = Math.max(0, Math.min(ew, newX));
      const newValue = Math.round((clampedX / ew) * r + minValue);

      runOnJS(updateHighValue)(newValue);
    })
    .onEnd(() => {
      'worklet';
      runOnJS(commitValues)();
    })
    .hitSlop({ top: HIT_SLOP, bottom: HIT_SLOP, left: HIT_SLOP, right: HIT_SLOP })
    .minDistance(0)
    .activeOffsetX([-5, 5]),
  [minValue, maxValue, updateHighValue, commitValues]);

  // Calculate positions using LOCAL state (live updates while dragging)
  const lowPos = valueToPosition(localLow);
  const highPos = valueToPosition(localHigh);

  return (
    <View style={styles.container}>
      {/* Premium value pill — large, centered, accent-tinted */}
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
        <Text style={[styles.valueNumber, { color: helperColor }]}>
          {localLow}
        </Text>
        <Text style={[styles.valueSeparator, { color: helperColor }]}> to </Text>
        <Text style={[styles.valueNumber, { color: helperColor }]}>
          {localHigh}
        </Text>
        <Text style={[styles.valueUnit, { color: helperColor }]}> {unit}</Text>
      </View>

      <View style={styles.sliderContainer} onLayout={handleLayout}>
        {/* Background track */}
        <View style={[styles.track, { backgroundColor: trackBg }]} />

        {/* Active (selected) range segment */}
        {sliderWidth > 0 && (
          <View
            style={[
              styles.activeTrack,
              {
                backgroundColor: activeTrackColor,
                left: lowPos + THUMB_SIZE / 2,
                width: Math.max(0, highPos - lowPos),
              },
            ]}
          />
        )}

        {/* LOW thumb */}
        {sliderWidth > 0 && (
          <GestureDetector gesture={lowGesture}>
            <Animated.View
              style={[
                styles.thumb,
                {
                  backgroundColor: '#FFFFFF',
                  borderColor: thumbBg,
                  left: lowPos,
                },
              ]}
            >
              <View
                style={[styles.thumbCore, { backgroundColor: thumbBg }]}
              />
            </Animated.View>
          </GestureDetector>
        )}

        {/* HIGH thumb */}
        {sliderWidth > 0 && (
          <GestureDetector gesture={highGesture}>
            <Animated.View
              style={[
                styles.thumb,
                {
                  backgroundColor: '#FFFFFF',
                  borderColor: thumbBg,
                  left: highPos,
                },
              ]}
            >
              <View
                style={[styles.thumbCore, { backgroundColor: thumbBg }]}
              />
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      <View style={styles.labelsRow}>
        <Text style={[styles.limitLabel, { color: limitColor }]}>
          {minValue}
        </Text>
        <Text style={[styles.limitLabel, { color: limitColor }]}>
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
  valueNumber: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  valueSeparator: {
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.85,
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

export default RangeSlider;
