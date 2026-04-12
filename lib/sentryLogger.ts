/**
 * Sentry Manual Logging Helpers
 *
 * DEV DEBUG MODE: Provides easy-to-use logging functions that:
 * - Log to console for immediate visibility
 * - Add breadcrumbs to Sentry for crash context
 * - Capture events/exceptions to Sentry dashboard
 *
 * USAGE:
 * - logInfo('User tapped button', { screen: 'Home' })
 * - logWarning('Rate limit approaching', { remaining: 5 })
 * - logError(error, 'Failed to load profile')
 * - logEvent('purchase_completed', { productId: 'premium' })
 */

import * as Sentry from '@sentry/react-native';
import { getCurrentFeature, getCurrentScreen } from './sentryFeatureFilter';
import { DEBUG_SENTRY_VERBOSE } from './debugFlags';

// ---------------------------------------------------------------------------
// Info Logging
// ---------------------------------------------------------------------------

/**
 * Log an informational message with optional data.
 * Adds breadcrumb + console log.
 *
 * @param message - Descriptive message
 * @param data - Optional context data
 */
export function logInfo(message: string, data?: Record<string, unknown>): void {
  // Console log for immediate visibility
  if (__DEV__) {
    console.log('[INFO]', message, data ?? '');
  }

  // Add breadcrumb for crash context
  Sentry.addBreadcrumb({
    category: 'info',
    message,
    data: {
      ...data,
      feature: getCurrentFeature(),
      screen: getCurrentScreen(),
    },
    level: 'info',
  });
}

// ---------------------------------------------------------------------------
// Warning Logging
// ---------------------------------------------------------------------------

/**
 * Log a warning message with optional data.
 * Adds breadcrumb + console warning.
 *
 * @param message - Warning message
 * @param data - Optional context data
 */
export function logWarning(message: string, data?: Record<string, unknown>): void {
  // Console warning for immediate visibility
  if (__DEV__) {
    console.warn('[WARNING]', message, data ?? '');
  }

  // Add breadcrumb for crash context
  Sentry.addBreadcrumb({
    category: 'warning',
    message,
    data: {
      ...data,
      feature: getCurrentFeature(),
      screen: getCurrentScreen(),
    },
    level: 'warning',
  });

  // In verbose mode, also capture as message
  if (DEBUG_SENTRY_VERBOSE) {
    Sentry.captureMessage(`[WARNING] ${message}`, {
      level: 'warning',
      extra: data,
    });
  }
}

// ---------------------------------------------------------------------------
// Error Logging
// ---------------------------------------------------------------------------

/**
 * Log an error with optional context.
 * Captures to Sentry + console error.
 *
 * @param error - The error object or message
 * @param context - Optional context string describing where the error occurred
 * @param extra - Optional additional data
 */
export function logError(
  error: Error | unknown,
  context?: string,
  extra?: Record<string, unknown>
): void {
  // Console error for immediate visibility
  if (__DEV__) {
    console.error('[ERROR]', context ?? '', error);
  }

  // Capture exception to Sentry
  Sentry.withScope((scope) => {
    scope.setTag('feature', getCurrentFeature() ?? 'unknown');
    scope.setTag('screen', getCurrentScreen() ?? 'unknown');

    if (context) {
      scope.setTag('error_context', context);
    }

    if (extra) {
      Object.entries(extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }

    scope.setLevel('error');
    Sentry.captureException(error);
  });
}

// ---------------------------------------------------------------------------
// Event Logging
// ---------------------------------------------------------------------------

/**
 * Log a named event with optional data.
 * Captures to Sentry as message + console log.
 *
 * @param name - Event name (e.g., 'purchase_completed', 'onboarding_step')
 * @param data - Optional event data
 */
export function logEvent(name: string, data?: Record<string, unknown>): void {
  // Console log for immediate visibility
  if (__DEV__) {
    console.log('[EVENT]', name, data ?? '');
  }

  // Capture as Sentry message
  Sentry.captureMessage(name, {
    level: 'info',
    extra: {
      ...data,
      feature: getCurrentFeature(),
      screen: getCurrentScreen(),
    },
  });
}

// ---------------------------------------------------------------------------
// Debug Logging (Only in verbose mode)
// ---------------------------------------------------------------------------

/**
 * Log a debug message (only in verbose debug mode).
 * Adds breadcrumb only, no Sentry message.
 *
 * @param tag - Debug tag (e.g., '[PHOTO]', '[AUTH]')
 * @param message - Debug message
 * @param data - Optional data
 */
export function logDebug(tag: string, message: string, data?: Record<string, unknown>): void {
  if (!DEBUG_SENTRY_VERBOSE) return;

  // Console log for immediate visibility
  if (__DEV__) {
    console.log(tag, message, data ?? '');
  }

  // Add breadcrumb for crash context
  Sentry.addBreadcrumb({
    category: 'debug',
    message: `${tag} ${message}`,
    data,
    level: 'debug',
  });
}

// ---------------------------------------------------------------------------
// Performance Logging
// ---------------------------------------------------------------------------

/**
 * Log a performance measurement.
 * Adds breadcrumb with timing data.
 *
 * @param operation - Operation name
 * @param durationMs - Duration in milliseconds
 * @param data - Optional additional data
 */
export function logPerformance(
  operation: string,
  durationMs: number,
  data?: Record<string, unknown>
): void {
  // Console log for immediate visibility
  if (__DEV__) {
    console.log('[PERF]', operation, `${durationMs}ms`, data ?? '');
  }

  // Add breadcrumb for crash context
  Sentry.addBreadcrumb({
    category: 'performance',
    message: `${operation}: ${durationMs}ms`,
    data: {
      ...data,
      durationMs,
      feature: getCurrentFeature(),
      screen: getCurrentScreen(),
    },
    level: 'info',
  });

  // In verbose mode, also capture slow operations (>2s) as warnings
  if (DEBUG_SENTRY_VERBOSE && durationMs > 2000) {
    Sentry.captureMessage(`Slow operation: ${operation} (${durationMs}ms)`, {
      level: 'warning',
      extra: { ...data, durationMs },
    });
  }
}

// ---------------------------------------------------------------------------
// User Action Logging
// ---------------------------------------------------------------------------

/**
 * Log a user action for debugging context.
 * Adds breadcrumb, useful for understanding what user did before crash.
 *
 * @param action - Action name (e.g., 'tapped_like', 'swiped_left')
 * @param data - Optional action data
 */
export function logAction(action: string, data?: Record<string, unknown>): void {
  // Console log for immediate visibility (only in verbose mode)
  if (__DEV__ && DEBUG_SENTRY_VERBOSE) {
    console.log('[ACTION]', action, data ?? '');
  }

  // Add breadcrumb for crash context
  Sentry.addBreadcrumb({
    category: 'user.action',
    message: action,
    data: {
      ...data,
      feature: getCurrentFeature(),
      screen: getCurrentScreen(),
    },
    level: 'info',
  });
}

// ---------------------------------------------------------------------------
// Navigation Logging
// ---------------------------------------------------------------------------

/**
 * Log a navigation event.
 * Adds breadcrumb with from/to context.
 *
 * @param to - Screen navigating to
 * @param from - Screen navigating from (optional)
 * @param params - Navigation params (optional)
 */
export function logNavigation(
  to: string,
  from?: string,
  params?: Record<string, unknown>
): void {
  // Console log for immediate visibility
  if (__DEV__) {
    console.log('[NAV]', from ? `${from} -> ${to}` : `-> ${to}`, params ?? '');
  }

  // Add breadcrumb for crash context
  Sentry.addBreadcrumb({
    category: 'navigation',
    message: `Navigate to ${to}`,
    data: {
      from,
      to,
      ...params,
    },
    level: 'info',
  });
}

// ---------------------------------------------------------------------------
// API/Network Logging
// ---------------------------------------------------------------------------

/**
 * Log an API or network request.
 * Adds breadcrumb with request context.
 *
 * @param operation - API operation name
 * @param status - Request status ('started', 'success', 'error')
 * @param data - Optional request/response data
 */
export function logApi(
  operation: string,
  status: 'started' | 'success' | 'error',
  data?: Record<string, unknown>
): void {
  // Console log for immediate visibility
  if (__DEV__) {
    const icon = status === 'success' ? '✓' : status === 'error' ? '✗' : '→';
    console.log('[API]', icon, operation, data ?? '');
  }

  // Add breadcrumb for crash context
  Sentry.addBreadcrumb({
    category: 'api',
    message: `${operation}: ${status}`,
    data: {
      ...data,
      status,
      feature: getCurrentFeature(),
    },
    level: status === 'error' ? 'error' : 'info',
  });
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/**
 * DEV-ONLY: Trigger a test error to verify Sentry capture.
 * Use from dev menu or debug screen.
 */
export function triggerTestError(): void {
  if (!__DEV__) return;

  console.log('[SENTRY TEST] Triggering test error...');

  try {
    throw new Error('Sentry Test Error - Manual Trigger');
  } catch (error) {
    logError(error, 'sentryLogger.triggerTestError', {
      test: true,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * DEV-ONLY: Log a test event to verify Sentry message capture.
 */
export function triggerTestEvent(): void {
  if (!__DEV__) return;

  console.log('[SENTRY TEST] Triggering test event...');

  logEvent('sentry_test_event', {
    test: true,
    timestamp: new Date().toISOString(),
  });
}
