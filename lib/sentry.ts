/**
 * Sentry Configuration for Mira
 *
 * APP-WIDE SENTRY: Full crash reporting and error tracking for the entire app.
 *
 * This module:
 * - Initializes Sentry with app-wide coverage (all features)
 * - Provides helpers to capture errors with feature/screen context
 * - Attaches user context when available
 * - Provides breadcrumb helpers for app-specific events
 * - Auto-tags events with current feature for filtering in Sentry dashboard
 *
 * PRIVACY: Only internal IDs are sent. No personal content (messages, names, etc.)
 *
 * PERFORMANCE: UI interaction tracing disabled to prevent jank.
 * Native crash reporting and JS errors are fully captured.
 *
 * USAGE:
 * - Import { initSentry } in app root and call once at startup
 * - Import { captureException, setUserContext, trackEvent } where needed
 * - Use setCurrentFeature() to tag errors by feature
 */

import * as Sentry from '@sentry/react-native';
import {
  getCurrentFeature,
  getCurrentScreen,
  getFeatureGroup,
  currentFeatureRef,
  currentScreenRef,
  setCurrentFeature,
  setCurrentScreen,
  SENTRY_FEATURES,
  type SentryFeature,
} from './sentryFeatureFilter';
import { DEBUG_SENTRY_VERBOSE } from './debugFlags';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// TODO: Replace with your actual Sentry DSN from sentry.io project settings
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

// Environment detection
const IS_DEV = __DEV__;
const ENVIRONMENT = IS_DEV ? 'development' : 'production';
const SENTRY_VERBOSE_MODE = IS_DEV ? false : DEBUG_SENTRY_VERBOSE;
const SENTRY_TRACES_SAMPLE_RATE = IS_DEV ? 0 : (DEBUG_SENTRY_VERBOSE ? 1.0 : 0.2);
const SENTRY_PROFILES_SAMPLE_RATE = IS_DEV ? 0 : (DEBUG_SENTRY_VERBOSE ? 1.0 : 0);

// App version (set via EAS build or package.json)
const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION || '1.0.0';
const BUILD_NUMBER = process.env.EXPO_PUBLIC_BUILD_NUMBER || '1';

// Store original console methods for internal use
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// ---------------------------------------------------------------------------
// Sensitive Data Filters
// ---------------------------------------------------------------------------

// Keywords that indicate sensitive data - scrub from error messages
const SENSITIVE_KEYWORDS = [
  'password', 'token', 'secret', 'api_key', 'apikey', 'bearer',
  'phone', 'email', 'address', 'location', 'coordinates',
  'message_content', 'private_bio', 'real_name',
];

/**
 * Scrub sensitive data from error messages and context.
 */
function scrubSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    let scrubbed = data;
    SENSITIVE_KEYWORDS.forEach(keyword => {
      const regex = new RegExp(`(${keyword})[=:]["']?[^"'\\s,}]+`, 'gi');
      scrubbed = scrubbed.replace(regex, `$1=[REDACTED]`);
    });
    return scrubbed;
  }

  if (Array.isArray(data)) {
    return data.map(scrubSensitiveData);
  }

  if (data && typeof data === 'object') {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYWORDS.some(k => lowerKey.includes(k))) {
        scrubbed[key] = '[REDACTED]';
      } else {
        scrubbed[key] = scrubSensitiveData(value);
      }
    }
    return scrubbed;
  }

  return data;
}

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
  if (isInitialized) {
    return;
  }

  if (!SENTRY_DSN) {
    if (IS_DEV) {
      originalConsoleLog('[Sentry] No DSN configured - crash reporting disabled');
    }
    return;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: ENVIRONMENT,
      release: `mira@${APP_VERSION}+${BUILD_NUMBER}`,

      // Enable Sentry when DSN is configured
      enabled: true,

      // Keep native SDK debug output off in development to avoid bridge/log overhead.
      debug: SENTRY_VERBOSE_MODE,

      // Session tracking for crash-free rate
      enableAutoSessionTracking: true,

      // Capture all errors (100%)
      sampleRate: 1.0,

      // Keep navigation tracing off in development; production keeps the existing policy.
      tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,

      // Keep native profiling off in development; production keeps the existing policy.
      profilesSampleRate: SENTRY_PROFILES_SAMPLE_RATE,

      // Stack traces on all messages
      attachStacktrace: true,

      // Native crash reporting
      enableNative: true,

      // PERF: Disabled to prevent UI jank (keep disabled even in debug mode)
      enableUserInteractionTracing: false,
      enableAutoPerformanceTracing: false,

      // Normalize error depths - increased for debug mode
      normalizeDepth: DEBUG_SENTRY_VERBOSE ? 12 : 8,

      // Breadcrumb limit - increased for debug mode
      maxBreadcrumbs: DEBUG_SENTRY_VERBOSE ? 100 : 50,

      // Remove heavy integrations that cause jank
      integrations: (integrations) => {
        return integrations.filter(
          (i) => i.name !== 'TouchEventBoundary' && i.name !== 'ReactNativeTracing'
        );
      },

      // APP-WIDE: Accept all events, tag with feature context
      beforeSend(event, hint) {
        // DEV DEBUG MODE: Log every event to console for visibility
        if (SENTRY_VERBOSE_MODE && IS_DEV) {
          originalConsoleLog('[SENTRY EVENT]', {
            type: event.exception ? 'exception' : 'message',
            message: event.message || event.exception?.values?.[0]?.value,
            tags: event.tags,
            level: event.level,
            timestamp: new Date().toISOString(),
          });
        }

        // Auto-tag with current feature and screen
        const feature = getCurrentFeature();
        const screen = getCurrentScreen();
        const featureGroup = getFeatureGroup(feature);

        event.tags = {
          ...event.tags,
          feature: feature || 'unknown',
          feature_group: featureGroup,
          screen: screen || 'unknown',
          debug_mode: SENTRY_VERBOSE_MODE ? 'verbose' : 'normal',
        };

        // Add feature context
        event.contexts = {
          ...event.contexts,
          app_context: {
            feature,
            screen,
            feature_group: featureGroup,
            debug_verbose: SENTRY_VERBOSE_MODE,
          },
        };

        // DEV DEBUG MODE: Capture ALL events, no filtering
        if (SENTRY_VERBOSE_MODE) {
          // Scrub sensitive data but don't filter any events
          if (event.extra) {
            event.extra = scrubSensitiveData(event.extra) as Record<string, unknown>;
          }
          return event;
        }

        // Normal mode: Filter out known non-critical errors
        const error = hint.originalException;
        if (error instanceof Error) {
          const msg = error.message?.toLowerCase() || '';
          // Skip known benign errors
          if (
            msg.includes('unable to activate keep awake') ||
            msg.includes('network request failed') && !msg.includes('mutation') ||
            msg.includes('aborted') ||
            msg.includes('cancelled')
          ) {
            return null;
          }
        }

        // Scrub sensitive data from extras
        if (event.extra) {
          event.extra = scrubSensitiveData(event.extra) as Record<string, unknown>;
        }

        return event;
      },

      // APP-WIDE: Filter low-value breadcrumbs, tag with feature
      // SENTRY_VERBOSE_MODE: bypass filtering for full diagnostic visibility
      beforeBreadcrumb(breadcrumb) {
        // In verbose mode, keep all breadcrumbs for maximum visibility
        if (!SENTRY_VERBOSE_MODE) {
          // LOG_NOISE_FIX: Filter out low-value debug console breadcrumbs
          if (breadcrumb?.category === 'console') {
            const msg = breadcrumb?.message || '';

            if (
              msg.includes('CHATROOM_') ||
              msg.includes('[VideoCache]') ||
              msg.includes('[PHASE2_DISCOVER_FE]') ||
              msg.includes('[DISCOVER_READY]')
            ) {
              return null;
            }
            const debugTags = [
              '[PRESENCE]',
              '[LOCATION]',
              '[PHOTO_RENDER]',
              '[PLANNER]',
              '[QUEUE]',
              '[REFETCH]',
              '[P1_',
              '[P2_SLOT]',
              '[P2_DIST]',
              '[P2_INTENT]',
              '[P2_DATA]',
              '[SENTRY]',
              'Sentry Logger',
            ];
            if (debugTags.some(tag => msg.includes(tag))) {
              return null; // Drop this breadcrumb
            }

            // Truncate long messages
            if (msg.length > 500) {
              breadcrumb.message = msg.substring(0, 500) + '... [truncated]';
            }
          }
        }

        // Tag breadcrumb with current feature
        const feature = getCurrentFeature();
        if (feature) {
          breadcrumb.data = {
            ...breadcrumb.data,
            feature,
          };
        }

        return breadcrumb;
      },
    });

    isInitialized = true;

    // Add initialization breadcrumb
    Sentry.addBreadcrumb({
      category: 'app.lifecycle',
      message: 'Sentry initialized',
      level: 'info',
      data: {
        environment: ENVIRONMENT,
        version: APP_VERSION,
        build: BUILD_NUMBER,
      },
    });

    if (IS_DEV) {
      originalConsoleLog(`[Sentry] Initialized - debug=${SENTRY_VERBOSE_MODE ? 'VERBOSE' : 'off'}`);
    }
  } catch (error) {
    originalConsoleError('[Sentry] Failed to initialize:', error);
  }
}

// ---------------------------------------------------------------------------
// Feature & Screen Context
// ---------------------------------------------------------------------------

/**
 * Combined helper to set both feature and screen.
 * Useful for screen-level useEffect hooks.
 *
 * @param feature - Feature identifier
 * @param screen - Screen name
 */
export function setFeatureAndScreen(feature: SentryFeature, screen: string): void {
  setCurrentFeature(feature);
  setCurrentScreen(screen);

  // Add navigation breadcrumb
  Sentry.addBreadcrumb({
    category: 'navigation',
    message: `Entered ${screen}`,
    level: 'info',
    data: { feature, screen },
  });
}

/**
 * Clear feature context (call when leaving a feature).
 */
export function clearFeatureContext(): void {
  setCurrentFeature(null);
  setCurrentScreen(null);
}

// ---------------------------------------------------------------------------
// Event Tracking
// ---------------------------------------------------------------------------

/**
 * Track an app-specific event with Sentry breadcrumb.
 *
 * @param category - Event category
 * @param action - Event action
 * @param data - Optional additional data (will be scrubbed)
 */
export function trackEvent(
  category: string,
  action: string,
  data?: Record<string, unknown>
): void {
  if (!isInitialized && !SENTRY_DSN) return;

  const safeData = data ? scrubSensitiveData(data) as Record<string, unknown> : undefined;

  Sentry.addBreadcrumb({
    category,
    message: action,
    data: {
      ...safeData,
      feature: getCurrentFeature(),
    },
    level: 'info',
  });
}

/**
 * Track a user action (button tap, swipe, etc.).
 * Use for key user interactions that help debug issues.
 *
 * @param action - Action name (e.g., 'like_sent', 'photo_next')
 * @param data - Optional context
 */
export function trackAction(
  action: string,
  data?: Record<string, unknown>
): void {
  trackEvent('user.action', action, data);
}

/**
 * Track a navigation event.
 *
 * @param screenName - The screen being navigated to
 * @param params - Optional navigation params (IDs only, no content)
 */
export function trackNavigation(
  screenName: string,
  params?: Record<string, unknown>
): void {
  trackEvent('navigation', `Navigated to ${screenName}`, params);
}

// ---------------------------------------------------------------------------
// Error Capture
// ---------------------------------------------------------------------------

/**
 * Capture an exception and send to Sentry.
 * Auto-tagged with current feature and screen context.
 *
 * @param error - The error to capture
 * @param context - Optional context object
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
    if (IS_DEV) {
      originalConsoleError('[Sentry] captureException (not initialized):', error);
    }
    return;
  }

  Sentry.withScope((scope) => {
    // Auto-tag with current feature/screen
    const feature = getCurrentFeature();
    const screen = getCurrentScreen();

    scope.setTag('feature', feature || 'unknown');
    scope.setTag('screen', screen || 'unknown');
    scope.setTag('feature_group', getFeatureGroup(feature));

    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    if (context?.extra) {
      const safeExtra = scrubSensitiveData(context.extra) as Record<string, unknown>;
      Object.entries(safeExtra).forEach(([key, value]) => {
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
  if (!isInitialized && !SENTRY_DSN) return;

  Sentry.withScope((scope) => {
    scope.setTag('feature', getCurrentFeature() || 'unknown');
    scope.setTag('screen', getCurrentScreen() || 'unknown');
    Sentry.captureMessage(message, level);
  });
}

// ---------------------------------------------------------------------------
// User Context
// ---------------------------------------------------------------------------

/**
 * Set the current user context for error reports.
 * Call this after successful authentication.
 *
 * PRIVACY: Only internal ID is stored. No PII.
 *
 * @param userId - The authenticated user's ID
 * @param extra - Optional safe metadata
 */
export function setUserContext(
  userId: string | null,
  extra?: {
    onboardingCompleted?: boolean;
    isPhase2User?: boolean;
  }
): void {
  if (!isInitialized && !SENTRY_DSN) return;

  if (userId) {
    Sentry.setUser({
      id: userId,
      // Custom safe data only
      ...(extra?.onboardingCompleted !== undefined && {
        onboardingCompleted: String(extra.onboardingCompleted),
      }),
      ...(extra?.isPhase2User !== undefined && {
        isPhase2User: String(extra.isPhase2User),
      }),
    });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Clear user context (call on logout).
 */
export function clearUserContext(): void {
  if (!isInitialized && !SENTRY_DSN) return;
  Sentry.setUser(null);
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

/**
 * Add a breadcrumb for debugging context.
 *
 * @param message - Breadcrumb message
 * @param category - Category
 * @param data - Optional data (will be scrubbed)
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
): void {
  if (!isInitialized && !SENTRY_DSN) return;

  const safeData = data ? scrubSensitiveData(data) as Record<string, unknown> : undefined;

  Sentry.addBreadcrumb({
    message,
    category,
    data: {
      ...safeData,
      feature: getCurrentFeature(),
    },
    level: 'info',
  });
}

// ---------------------------------------------------------------------------
// Performance Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap an async operation with timing breadcrumbs.
 * Use for tracking slow operations.
 *
 * @param name - Operation name
 * @param op - Operation type
 * @param fn - The function to wrap
 */
export async function withTiming<T>(
  name: string,
  op: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  addBreadcrumb(`${op}: ${name} started`, 'performance');

  try {
    const result = await fn();
    addBreadcrumb(`${op}: ${name} completed`, 'performance', {
      durationMs: Date.now() - startTime,
    });
    return result;
  } catch (error) {
    addBreadcrumb(`${op}: ${name} failed`, 'performance', {
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Navigation Tracing (expo-router compatible)
// ---------------------------------------------------------------------------

let _currentRouteName: string | null = null;
let _currentTransaction: ReturnType<typeof Sentry.startInactiveSpan> | null = null;

/**
 * Track a screen/route change for Sentry performance tracing.
 * Call this from a useEffect in your root layout when pathname changes.
 *
 * @param routeName - The current route name (e.g., from usePathname())
 * @param params - Optional route params (will be scrubbed)
 */
export function trackRouteChange(
  routeName: string,
  params?: Record<string, unknown>
): void {
  if (!isInitialized && !SENTRY_DSN) return;
  if (!routeName || routeName === _currentRouteName) return;

  // End previous transaction if exists
  if (_currentTransaction) {
    _currentTransaction.end();
    _currentTransaction = null;
  }

  _currentRouteName = routeName;

  // Update screen context
  setCurrentScreen(routeName);

  // Add navigation breadcrumb
  Sentry.addBreadcrumb({
    category: 'navigation',
    message: `Screen: ${routeName}`,
    level: 'info',
    data: params ? scrubSensitiveData(params) as Record<string, unknown> : undefined,
  });

  // Start new screen transaction for performance tracing
  _currentTransaction = Sentry.startInactiveSpan({
    name: routeName,
    op: 'navigation',
  });
}

// ---------------------------------------------------------------------------
// Convex Error Helpers
// ---------------------------------------------------------------------------

/**
 * Capture a Convex query/mutation error with context.
 * Use this for critical Convex operations that should be tracked.
 *
 * @param error - The error from Convex
 * @param operation - Query/mutation name (e.g., 'users.getCurrentUser')
 * @param context - Additional context
 */
export function captureConvexError(
  error: Error | unknown,
  operation: string,
  context?: {
    args?: Record<string, unknown>;
    isMutation?: boolean;
    isCritical?: boolean;
  }
): void {
  if (!isInitialized && !SENTRY_DSN) {
    if (IS_DEV) {
      originalConsoleError('[Sentry] captureConvexError (not initialized):', operation, error);
    }
    return;
  }

  // Filter out non-critical known errors
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isAuthError = errorMessage.toLowerCase().includes('authentication required');
  const isNotFound = errorMessage.toLowerCase().includes('not found');

  // Skip non-critical auth/not-found errors unless marked critical
  if (!context?.isCritical && (isAuthError || isNotFound)) {
    // Just add breadcrumb for context, don't capture as error
    addBreadcrumb(`Convex ${context?.isMutation ? 'mutation' : 'query'} failed: ${operation}`, 'convex', {
      error: errorMessage,
      expected: true,
    });
    return;
  }

  Sentry.withScope((scope) => {
    scope.setTag('convex_operation', operation);
    scope.setTag('convex_type', context?.isMutation ? 'mutation' : 'query');
    scope.setTag('feature', getCurrentFeature() || 'unknown');

    if (context?.args) {
      const safeArgs = scrubSensitiveData(context.args) as Record<string, unknown>;
      scope.setExtra('convex_args', safeArgs);
    }

    scope.setLevel(context?.isCritical ? 'error' : 'warning');

    Sentry.captureException(error);
  });
}

/**
 * Wrap a Convex mutation with error capture.
 * Use for critical mutations that must succeed.
 *
 * @param mutationFn - The mutation function
 * @param operationName - Name for logging/tracking
 * @param args - Arguments to the mutation
 */
export async function withConvexCapture<T>(
  mutationFn: () => Promise<T>,
  operationName: string,
  options?: { isCritical?: boolean }
): Promise<T> {
  const startTime = Date.now();

  try {
    addBreadcrumb(`Convex: ${operationName} started`, 'convex');
    const result = await mutationFn();
    addBreadcrumb(`Convex: ${operationName} success`, 'convex', {
      durationMs: Date.now() - startTime,
    });
    return result;
  } catch (error) {
    captureConvexError(error, operationName, {
      isMutation: true,
      isCritical: options?.isCritical,
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Verification / Testing Helpers
// ---------------------------------------------------------------------------

/**
 * DEV-ONLY: Trigger a test event to verify Sentry is working.
 * Call this from a dev menu or settings screen.
 *
 * Returns true if Sentry is initialized and event was sent.
 */
export function sentryTestCapture(): boolean {
  if (!isInitialized) {
    if (IS_DEV) {
      originalConsoleLog('[Sentry] Test capture failed - not initialized (no DSN?)');
    }
    return false;
  }

  // Send test message
  Sentry.captureMessage('Sentry Test Event - Mira App', 'info');

  if (IS_DEV) {
    originalConsoleLog('[Sentry] Test event sent - check Sentry dashboard');
  }

  return true;
}

/**
 * DEV-ONLY: Trigger a test exception to verify error capture.
 * This will show up in Sentry as an error.
 */
export function sentryTestException(): boolean {
  if (!isInitialized) {
    if (IS_DEV) {
      originalConsoleLog('[Sentry] Test exception failed - not initialized');
    }
    return false;
  }

  try {
    throw new Error('Sentry Test Exception - Mira App Verification');
  } catch (error) {
    captureException(error, {
      tags: { test: 'true', verification: 'manual' },
      level: 'warning',
    });
  }

  if (IS_DEV) {
    originalConsoleLog('[Sentry] Test exception sent - check Sentry dashboard');
  }

  return true;
}

/**
 * Check if Sentry is properly initialized and has a DSN.
 */
export function isSentryEnabled(): boolean {
  return isInitialized && !!SENTRY_DSN;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { Sentry };

// Re-export feature utilities
export {
  getCurrentFeature,
  getCurrentScreen,
  getFeatureGroup,
  setCurrentFeature,
  setCurrentScreen,
  SENTRY_FEATURES,
  type SentryFeature,
  // Legacy
  isChatRoomsFeatureActive,
  currentFeatureRef,
} from './sentryFeatureFilter';
