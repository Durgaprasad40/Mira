/**
 * Sentry Configuration for Mira
 *
 * P0-1 STABILITY FIX: Production crash reporting
 * SENTRY-DEBUG: Full instrumentation enabled for comprehensive debugging
 *
 * This module:
 * - Initializes Sentry with FULL debug logging (tracesSampleRate=1.0)
 * - Provides helpers to capture errors with context
 * - Attaches user context when available
 * - Patches console.log/warn/error to create breadcrumbs
 * - Provides breadcrumb helpers for app-specific events
 *
 * USAGE:
 * - Import { initSentry } in app root and call once at startup
 * - Import { captureException, setUserContext, trackEvent } where needed
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

// SENTRY-DEBUG: Store original console methods for patching
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

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

      // Enable Sentry in all environments when DSN is configured
      // Safe: DSN presence controls whether events are sent
      enabled: true,

      // SENTRY-DEBUG: Enable debug mode for full console output
      debug: true,

      // SENTRY-DEBUG: Enable auto session tracking
      enableAutoSessionTracking: true,

      // Sample rate for errors (1.0 = 100%)
      sampleRate: 1.0,

      // SENTRY-DEBUG: Capture ALL performance traces (100%)
      tracesSampleRate: 1.0,

      // SENTRY-DEBUG: Capture ALL performance profiles (100%)
      profilesSampleRate: 1.0,

      // Attach stack traces to all messages
      attachStacktrace: true,

      // SENTRY-DEBUG: Enable native crash reporting
      enableNative: true,

      // SENTRY-DEBUG: Enable auto performance tracking
      enableAutoPerformanceTracing: true,

      // Don't send errors from these domains (add dev/staging if needed)
      denyUrls: [],

      // Normalize error depths - increased for more context
      normalizeDepth: 10,

      // SENTRY-DEBUG: Max breadcrumbs to capture
      maxBreadcrumbs: 100,

      // Integrations
      integrations: (integrations) => {
        // Keep default integrations, add any custom ones here
        return integrations;
      },

      // Before send hook - can modify or drop events
      beforeSend(event, hint) {
        // SENTRY-DEBUG: Log all events being sent
        if (IS_DEV) {
          originalConsoleLog('[Sentry] Sending event:', event.exception?.values?.[0]?.value || event.message);
        }

        // Filter out non-critical errors
        const error = hint.originalException;
        if (error instanceof Error) {
          // Suppress keep-awake errors (non-critical, dev-only noise)
          if (error.message?.includes('Unable to activate keep awake')) {
            return null;
          }
        }

        return event;
      },

      // SENTRY-DEBUG: Before breadcrumb hook - log all breadcrumbs
      beforeBreadcrumb(breadcrumb) {
        // Don't filter any breadcrumbs - capture everything
        return breadcrumb;
      },
    });

    isInitialized = true;

    // SENTRY-DEBUG: Patch console methods to create breadcrumbs
    patchConsoleMethods();

    // SENTRY-DEBUG: Add initialization breadcrumb
    Sentry.addBreadcrumb({
      category: 'app.lifecycle',
      message: 'Sentry initialized',
      level: 'info',
      data: {
        environment: ENVIRONMENT,
        debug: true,
        tracesSampleRate: 1.0,
      },
    });

    if (IS_DEV) {
      originalConsoleLog('[Sentry] Initialized with FULL DEBUG MODE (tracesSampleRate=1.0)');
    }
  } catch (error) {
    originalConsoleError('[Sentry] Failed to initialize:', error);
  }
}

// ---------------------------------------------------------------------------
// Console Patching (SENTRY-DEBUG)
// ---------------------------------------------------------------------------

/**
 * Patch console.log/warn/error to create Sentry breadcrumbs.
 * This captures all console output as breadcrumbs for debugging.
 */
function patchConsoleMethods(): void {
  // Patch console.log
  console.log = (...args: any[]) => {
    // Create breadcrumb
    Sentry.addBreadcrumb({
      category: 'console',
      message: args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '),
      level: 'info',
    });
    // Call original
    originalConsoleLog.apply(console, args);
  };

  // Patch console.warn
  console.warn = (...args: any[]) => {
    // Create breadcrumb
    Sentry.addBreadcrumb({
      category: 'console',
      message: args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '),
      level: 'warning',
    });
    // Call original
    originalConsoleWarn.apply(console, args);
  };

  // Patch console.error
  console.error = (...args: any[]) => {
    // Create breadcrumb
    Sentry.addBreadcrumb({
      category: 'console',
      message: args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '),
      level: 'error',
    });
    // Call original
    originalConsoleError.apply(console, args);
  };
}

// ---------------------------------------------------------------------------
// Event Tracking (SENTRY-DEBUG)
// ---------------------------------------------------------------------------

/**
 * Track an app-specific event with Sentry breadcrumb.
 * Use this for important app events like message send, voice playback, etc.
 *
 * @param category - Event category (e.g., 'message', 'voice', 'navigation')
 * @param action - Event action (e.g., 'send', 'play', 'navigate')
 * @param data - Optional additional data
 */
export function trackEvent(
  category: string,
  action: string,
  data?: Record<string, unknown>
): void {
  if (!isInitialized && !SENTRY_DSN) {
    return;
  }

  Sentry.addBreadcrumb({
    category,
    message: action,
    data,
    level: 'info',
  });

  // Also log in dev for visibility
  if (IS_DEV) {
    originalConsoleLog(`[Sentry:${category}] ${action}`, data || '');
  }
}

/**
 * Track a navigation event.
 *
 * @param screenName - The screen being navigated to
 * @param params - Optional navigation params
 */
export function trackNavigation(
  screenName: string,
  params?: Record<string, unknown>
): void {
  trackEvent('navigation', `Navigated to ${screenName}`, params);
}

/**
 * Track a message event (send/receive).
 *
 * @param action - 'send' | 'receive' | 'delete'
 * @param data - Message metadata
 */
export function trackMessage(
  action: 'send' | 'receive' | 'delete',
  data: { messageId?: string; type?: string; phase?: string | number }
): void {
  trackEvent('message', `Message ${action}`, data);
}

/**
 * Track a voice event (record/play/stop).
 *
 * @param action - 'record_start' | 'record_stop' | 'play' | 'pause' | 'finish'
 * @param data - Voice message metadata
 */
export function trackVoice(
  action: 'record_start' | 'record_stop' | 'play' | 'pause' | 'finish',
  data?: { messageId?: string; durationMs?: number }
): void {
  trackEvent('voice', `Voice ${action}`, data);
}

/**
 * Track a Truth or Dare event.
 *
 * @param action - 'invite_send' | 'invite_accept' | 'game_start' | 'turn' | 'end'
 * @param data - Game metadata
 */
export function trackTruthDare(
  action: 'invite_send' | 'invite_accept' | 'game_start' | 'turn' | 'end',
  data?: { sessionId?: string; phase?: string | number }
): void {
  trackEvent('truthdare', `T/D ${action}`, data);
}

/**
 * Wrap an operation with Sentry span tracking (Sentry v8 API).
 * Use this for performance tracking of heavy operations.
 *
 * @param name - Span name
 * @param op - Operation type
 * @param fn - The function to wrap
 */
export async function withSentrySpan<T>(
  name: string,
  op: string,
  fn: () => Promise<T>
): Promise<T> {
  // Add breadcrumb for start
  Sentry.addBreadcrumb({
    category: 'performance',
    message: `${op}: ${name} started`,
    level: 'info',
  });

  const startTime = Date.now();

  try {
    const result = await fn();

    // Add breadcrumb for success
    Sentry.addBreadcrumb({
      category: 'performance',
      message: `${op}: ${name} completed`,
      level: 'info',
      data: { durationMs: Date.now() - startTime },
    });

    return result;
  } catch (error) {
    // Add breadcrumb for failure
    Sentry.addBreadcrumb({
      category: 'performance',
      message: `${op}: ${name} failed`,
      level: 'error',
      data: { durationMs: Date.now() - startTime },
    });
    throw error;
  }
}

/**
 * Wrap a Convex mutation/query with Sentry error capture and breadcrumbs.
 *
 * @param operation - The async operation to wrap
 * @param context - Context for error reporting
 */
export async function wrapConvexOperation<T>(
  operation: () => Promise<T>,
  context: { type: 'query' | 'mutation'; name: string }
): Promise<T> {
  // Add start breadcrumb
  Sentry.addBreadcrumb({
    category: 'convex',
    message: `${context.type}: ${context.name} started`,
    level: 'info',
  });

  const startTime = Date.now();

  try {
    const result = await operation();

    // Add success breadcrumb
    Sentry.addBreadcrumb({
      category: 'convex',
      message: `${context.type}: ${context.name} completed`,
      level: 'info',
      data: { durationMs: Date.now() - startTime },
    });

    return result;
  } catch (error) {
    // Add failure breadcrumb
    Sentry.addBreadcrumb({
      category: 'convex',
      message: `${context.type}: ${context.name} failed`,
      level: 'error',
      data: { durationMs: Date.now() - startTime },
    });

    captureException(error, {
      tags: {
        type: `convex_${context.type}`,
        operation: context.name,
      },
    });
    throw error;
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
