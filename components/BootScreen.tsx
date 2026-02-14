import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { COLORS } from '@/lib/constants';

const BOOT_TIMEOUT_MS = 7000; // 7 seconds

interface BootScreenProps {
  isReady: boolean;
  onRetry?: () => void;
}

/**
 * BootScreen - Shows immediately on app launch until ready to render main content.
 *
 * SAFETY:
 * - Does NOT modify any stores or backend data
 * - Does NOT affect auth state, onboarding, or messages
 * - Pure UI component with timeout fallback
 */
export function BootScreen({ isReady, onRetry }: BootScreenProps) {
  const [showTimeout, setShowTimeout] = useState(false);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  // Fade in animation
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Timeout fallback
  useEffect(() => {
    if (isReady) {
      setShowTimeout(false);
      return;
    }

    const timer = setTimeout(() => {
      if (!isReady) {
        setShowTimeout(true);
        if (__DEV__) {
          console.warn('[BootScreen] Timeout reached - app may be stuck');
        }
      }
    }, BOOT_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isReady]);

  // Don't render if already ready
  if (isReady) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Brand Logo/Name */}
      <View style={styles.logoContainer}>
        <Text style={styles.logoText}>Mira</Text>
        <Text style={styles.tagline}>Find your connection</Text>
      </View>

      {/* Loading indicator or retry */}
      <View style={styles.loadingContainer}>
        {showTimeout ? (
          <View style={styles.timeoutContainer}>
            <Text style={styles.timeoutText}>Taking longer than usual...</Text>
            {onRetry && __DEV__ && (
              <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
                <Text style={styles.retryText}>Tap to retry</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Loading...</Text>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  logoText: {
    fontSize: 48,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 2,
  },
  tagline: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    minHeight: 80,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: COLORS.textLight,
  },
  timeoutContainer: {
    alignItems: 'center',
  },
  timeoutText: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 24,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
});

export default BootScreen;
