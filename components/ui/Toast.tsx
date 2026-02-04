/**
 * Toast — lightweight, non-intrusive feedback banner.
 *
 * Usage:
 *   Toast.show('Blocked');
 *   Toast.show('Reported — thanks for keeping Mira safe');
 *
 * Renders at the top of the screen, auto-dismisses after a short delay.
 * Only one toast at a time (new calls replace the current one).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@/lib/constants';

// ── Imperative API ──

type ToastListener = (message: string, icon?: string) => void;
let _listener: ToastListener | null = null;

export const Toast = {
  show(message: string, icon?: string) {
    _listener?.(message, icon);
  },
};

// ── Component (mount once near app root or in a layout) ──

export function ToastHost() {
  const [text, setText] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setText(message);

      opacity.setValue(0);
      translateY.setValue(-20);

      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();

      timerRef.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: -20, duration: 300, useNativeDriver: true }),
        ]).start(() => setText(''));
      }, 2200);
    },
    [opacity, translateY],
  );

  useEffect(() => {
    _listener = show;
    return () => {
      _listener = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [show]);

  if (!text) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity, transform: [{ translateY }] },
      ]}
      pointerEvents="none"
    >
      <View style={styles.pill}>
        <Text style={styles.text}>{text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  pill: {
    backgroundColor: 'rgba(0,0,0,0.82)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
});
