import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  children: ReactNode;
  /** Optional: identifier for logging (e.g., screen name) */
  name?: string;
  /** Optional: custom fallback renderer */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Navigation helper (works outside React Navigation context)
// ---------------------------------------------------------------------------

let _navigateToHome: (() => void) | null = null;

/**
 * Register the navigation function from a component that has router access.
 * Call this once from your root layout or app entry.
 */
export function registerErrorBoundaryNavigation(navigateFn: () => void) {
  _navigateToHome = navigateFn;
}

// ---------------------------------------------------------------------------
// AppErrorBoundary Component
// ---------------------------------------------------------------------------

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error with context
    const { name } = this.props;
    const context = name ? `[${name}]` : '[AppErrorBoundary]';

    console.error(`${context} Caught error:`, error);
    console.error(`${context} Component stack:`, errorInfo.componentStack);

    // In production, you could send this to a crash reporting service
    // e.g., Sentry, Bugsnag, etc.
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    // Reset the error state first
    this.setState({ hasError: false, error: null });

    // Navigate to home if navigation is registered
    if (_navigateToHome) {
      try {
        _navigateToHome();
      } catch (navError) {
        console.error('[AppErrorBoundary] Navigation failed:', navError);
      }
    }
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback, name } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return <>{fallback}</>;
      }

      // Default fallback UI
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            {/* Icon */}
            <View style={styles.iconContainer}>
              <Ionicons name="warning-outline" size={48} color={COLORS.error} />
            </View>

            {/* Title */}
            <Text style={styles.title}>Something went wrong</Text>

            {/* Subtitle */}
            <Text style={styles.subtitle}>
              We hit an unexpected error.{'\n'}Please try again or go back to the home screen.
            </Text>

            {/* Error details (dev only) */}
            {__DEV__ && error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorLabel}>
                  {name ? `Error in ${name}:` : 'Error:'}
                </Text>
                <Text style={styles.errorMessage} numberOfLines={4}>
                  {error.message}
                </Text>
              </View>
            )}

            {/* Buttons */}
            <View style={styles.buttons}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={this.handleReset}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={18} color={COLORS.white} />
                <Text style={styles.primaryButtonText}>Try Again</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={this.handleGoHome}
                activeOpacity={0.8}
              >
                <Ionicons name="home" size={18} color={COLORS.primary} />
                <Text style={styles.secondaryButtonText}>Go to Home</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    return children;
  }
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
    maxWidth: 320,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,59,48,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  errorBox: {
    width: '100%',
    backgroundColor: 'rgba(255,59,48,0.08)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.15)',
  },
  errorLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.error,
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 12,
    color: COLORS.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },
  buttons: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 28,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,107,107,0.1)',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.2)',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
});

export default AppErrorBoundary;
