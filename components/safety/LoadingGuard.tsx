import React, { useEffect, useRef, useState, ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoadingGuardProps {
  /** Whether the screen is currently loading */
  isLoading: boolean;
  /** Timeout in ms before showing fallback UI (default: 12000) */
  timeoutMs?: number;
  /** Called when user taps Retry */
  onRetry: () => void;
  /** Title shown on timeout (default: "Still loading…") */
  title?: string;
  /** Subtitle shown on timeout */
  subtitle?: string;
  /** Normal content to render when not timed out */
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// LoadingGuard Component
// ---------------------------------------------------------------------------

export function LoadingGuard({
  isLoading,
  timeoutMs = 12000,
  onRetry,
  title = 'Still loading…',
  subtitle = 'This is taking longer than expected. Check your connection and try again.',
  children,
}: LoadingGuardProps) {
  const router = useRouter();
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any existing timer
  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (isLoading) {
      // Start timeout timer when loading begins
      clearTimer();
      timerRef.current = setTimeout(() => {
        setHasTimedOut(true);
      }, timeoutMs);
    } else {
      // Loading finished — clear timer and reset timeout state
      clearTimer();
      setHasTimedOut(false);
    }

    // Cleanup on unmount or when dependencies change
    return clearTimer;
  }, [isLoading, timeoutMs]);

  // Handle retry: reset timeout state and call onRetry
  const handleRetry = () => {
    setHasTimedOut(false);
    onRetry();
  };

  // Handle go home
  const handleGoHome = () => {
    router.replace('/(main)/(tabs)/home');
  };

  // If loading and timed out, show fallback UI
  if (isLoading && hasTimedOut) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          {/* Calm icon — not scary */}
          <View style={styles.iconContainer}>
            <Ionicons name="time-outline" size={40} color={COLORS.textLight} />
          </View>

          {/* Title */}
          <Text style={styles.title}>{title}</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>{subtitle}</Text>

          {/* Buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={handleRetry}
              activeOpacity={0.8}
            >
              <Ionicons name="refresh" size={18} color={COLORS.white} />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.homeButton}
              onPress={handleGoHome}
              activeOpacity={0.8}
            >
              <Text style={styles.homeButtonText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Normal render — show children (even while loading, before timeout)
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 24,
  },
  content: {
    alignItems: 'center',
    maxWidth: 300,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.backgroundDark,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  buttons: {
    width: '100%',
    gap: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 28,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  homeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  homeButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textLight,
  },
});

export default LoadingGuard;
