/**
 * Sentry Configuration for Mira
 *
 * P0-1 STABILITY FIX: Production crash reporting
 *
 * This module:
 * - Initializes Sentry with appropriate settings for Expo/React Native
 * - Provides helpers to capture errors with context
 * - Attaches user context when available
 *
 * USAGE:
 * - Import { initSentry } in app root and call once at startup
 * - Import { captureException, setUserContext } where needed
 */

import * as Sentry from '@sentry/react-native';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// TODO: Replace with your actual Sentry DSN from sentry.io project settings
// Format: https://<key>@<org>.ingest.sentry.io/<project-id>
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

// Environment detection
const IS_DEV = __DEV__;
const ENVIRONMENT = IS_DEV ? 'development' : 'production';

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let isInitialized = false;

/**
 * Initialize Sentry for crash reporting.
 * Call this once at app startup (in root _layout.tsx).
 *
 * Safe to call multiple times - will only initialize once.
 */
export function initSentry(): void {
  // Skip if already initialized
  if (isInitialized) {
    return;
  }

  // Skip initialization if no DSN configured (allows running without Sentry in dev)
  if (!SENTRY_DSN) {
    if (IS_DEV) {
      console.log('[Sentry] No DSN configured - crash reporting disabled');
    }
    return;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: ENVIRONMENT,

      // Only send errors in production by default
      // In dev, errors are logged to console but not sent
      enabled: !IS_DEV,

      // Debug mode (shows Sentry logs in dev)
      debug: IS_DEV,

      // Sample rate for errors (1.0 = 100%)
      sampleRate: 1.0,

      // Trace sample rate for performance monitoring (disabled for now)
      tracesSampleRate: 0,

      // Attach stack traces to all messages
      attachStacktrace: true,

      // Don't send errors from these domains (add dev/staging if needed)
      denyUrls: [],

      // Normalize error depths
      normalizeDepth: 5,

      // Integrations
      integrations: (integrations) => {
        // Keep default integrations, add any custom ones here
        return integrations;
      },

      // Before send hook - can modify or drop events
      beforeSend(event, hint) {
        // In dev mode, log to console but don't send to Sentry
        if (IS_DEV) {
          console.log('[Sentry] Would send event:', event.exception?.values?.[0]?.value);
          return null; // Don't send in dev
        }

        // Filter out non-critical errors if needed
        const error = hint.originalException;
        if (error instanceof Error) {
          // Suppress keep-awake errors (non-critical)
          if (error.message?.includes('Unable to activate keep awake')) {
            return null;
          }
        }

        return event;
      },
    });

    isInitialized = true;

    if (IS_DEV) {
      console.log('[Sentry] Initialized successfully (dev mode - events logged but not sent)');
    }
  } catch (error) {
    console.error('[Sentry] Failed to initialize:', error);
  }
}

// ---------------------------------------------------------------------------
// Error Capture
// ---------------------------------------------------------------------------

/**
 * Capture an exception and send to Sentry.
 * Use this for caught errors that should be reported.
 *
 * @param error - The error to capture
 * @param context - Optional context object with additional info
 */
export function captureException(
  error: Error | unknown,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    level?: Sentry.SeverityLevel;
  }
): void {
  if (!isInitialized && !SENTRY_DSN) {
    // Not initialized - just log in dev
    if (IS_DEV) {
      console.error('[Sentry] captureException (not initialized):', error);
    }
    return;
  }

  Sentry.withScope((scope) => {
    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    if (context?.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }

    if (context?.level) {
      scope.setLevel(context.level);
    }

    Sentry.captureException(error);
  });
}

/**
 * Capture a message (for non-error reporting).
 *
 * @param message - The message to capture
 * @param level - Severity level
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info'
): void {
  if (!isInitialized && !SENTRY_DSN) {
    if (IS_DEV) {
      console.log('[Sentry] captureMessage (not initialized):', message);
    }
    return;
  }

  Sentry.captureMessage(message, level);
}

// ---------------------------------------------------------------------------
// User Context
// ---------------------------------------------------------------------------

/**
 * Set the current user context for error reports.
 * Call this after successful authentication.
 *
 * @param userId - The authenticated user's ID
 * @param extra - Optional extra user info
 */
export function setUserContext(
  userId: string | null,
  extra?: {
    email?: string;
    username?: string;
    onboardingCompleted?: boolean;
  }
): void {
  if (!isInitialized && !SENTRY_DSN) {
    return;
  }

  if (userId) {
    Sentry.setUser({
      id: userId,
      email: extra?.email,
      username: extra?.username,
      // Custom data (appears in error context)
      ...(extra?.onboardingCompleted !== undefined && {
        onboardingCompleted: String(extra.onboardingCompleted),
      }),
    });
  } else {
    // Clear user context on logout
    Sentry.setUser(null);
  }
}

/**
 * Clear user context (call on logout).
 */
export function clearUserContext(): void {
  if (!isInitialized && !SENTRY_DSN) {
    return;
  }
  Sentry.setUser(null);
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

/**
 * Add a breadcrumb for debugging context.
 * Breadcrumbs appear in error reports showing user actions leading to crash.
 *
 * @param message - Breadcrumb message
 * @param category - Category (e.g., 'navigation', 'user', 'api')
 * @param data - Optional additional data
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
): void {
  if (!isInitialized && !SENTRY_DSN) {
    return;
  }

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { Sentry };
