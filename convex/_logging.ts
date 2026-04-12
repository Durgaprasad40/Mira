/**
 * Convex Backend Logging Utilities
 *
 * DEV DEBUG MODE: Provides structured logging for Convex functions.
 * These logs are visible in:
 * - Convex dashboard logs
 * - npx convex logs (CLI)
 * - Metro bundler output
 *
 * USAGE:
 * import { convexLog, convexError, withConvexLogging } from './_logging';
 *
 * // Simple logging
 * convexLog('users.getCurrentUser', { userId });
 *
 * // Error logging
 * convexError('users.getCurrentUser', error, { userId });
 *
 * // Wrapped function with timing
 * return await withConvexLogging('users.getCurrentUser', args, async () => {
 *   // your logic here
 * });
 */

// ---------------------------------------------------------------------------
// Environment Detection
// ---------------------------------------------------------------------------

// Check if we're in development (Convex sets NODE_ENV)
const IS_DEV = process.env.NODE_ENV === 'development';

// Enable verbose logging (can be toggled)
const VERBOSE_LOGGING = true;

// ---------------------------------------------------------------------------
// Log Formatting
// ---------------------------------------------------------------------------

/**
 * Format a log entry for consistent output.
 */
function formatLog(
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
  fn: string,
  message?: string,
  data?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  const msgStr = message ? ` ${message}` : '';
  return `[CONVEX ${level}] ${fn}${msgStr}${dataStr} @${timestamp}`;
}

// ---------------------------------------------------------------------------
// Logging Functions
// ---------------------------------------------------------------------------

/**
 * Log an informational message from a Convex function.
 *
 * @param fn - Function name (e.g., 'users.getCurrentUser')
 * @param data - Optional data to log
 */
export function convexLog(fn: string, data?: Record<string, unknown>): void {
  if (!VERBOSE_LOGGING) return;
  console.log(formatLog('INFO', fn, undefined, data));
}

/**
 * Log a debug message from a Convex function.
 * Only logs in verbose mode.
 *
 * @param fn - Function name
 * @param message - Debug message
 * @param data - Optional data
 */
export function convexDebug(fn: string, message: string, data?: Record<string, unknown>): void {
  if (!VERBOSE_LOGGING) return;
  console.log(formatLog('DEBUG', fn, message, data));
}

/**
 * Log a warning from a Convex function.
 *
 * @param fn - Function name
 * @param message - Warning message
 * @param data - Optional data
 */
export function convexWarn(fn: string, message: string, data?: Record<string, unknown>): void {
  console.warn(formatLog('WARN', fn, message, data));
}

/**
 * Log an error from a Convex function.
 *
 * @param fn - Function name
 * @param error - The error object
 * @param context - Optional context data
 */
export function convexError(
  fn: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  console.error(formatLog('ERROR', fn, errorMessage, {
    ...context,
    stack: errorStack?.split('\n').slice(0, 3).join(' | '),
  }));
}

// ---------------------------------------------------------------------------
// Wrapper Functions
// ---------------------------------------------------------------------------

/**
 * Wrap a Convex function with logging and timing.
 *
 * @param fn - Function name
 * @param args - Function arguments (will be logged, sensitive data should be redacted)
 * @param handler - The actual function logic
 * @returns The result of the handler
 *
 * @example
 * export const getUser = query({
 *   args: { userId: v.id('users') },
 *   handler: async (ctx, args) => {
 *     return await withConvexLogging('users.getUser', { userId: args.userId }, async () => {
 *       // your logic here
 *     });
 *   },
 * });
 */
export async function withConvexLogging<T>(
  fn: string,
  args: Record<string, unknown>,
  handler: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  // Log start
  if (VERBOSE_LOGGING) {
    convexLog(fn, { args, status: 'started' });
  }

  try {
    const result = await handler();
    const durationMs = Date.now() - startTime;

    // Log success
    if (VERBOSE_LOGGING) {
      convexLog(fn, { status: 'success', durationMs });
    }

    // Log slow operations
    if (durationMs > 1000) {
      convexWarn(fn, `Slow operation: ${durationMs}ms`);
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Log error
    convexError(fn, error, { args, durationMs });

    // Re-throw to maintain error handling
    throw error;
  }
}

/**
 * Wrap a synchronous Convex function with logging and timing.
 */
export function withConvexLoggingSync<T>(
  fn: string,
  args: Record<string, unknown>,
  handler: () => T
): T {
  const startTime = Date.now();

  // Log start
  if (VERBOSE_LOGGING) {
    convexLog(fn, { args, status: 'started' });
  }

  try {
    const result = handler();
    const durationMs = Date.now() - startTime;

    // Log success
    if (VERBOSE_LOGGING) {
      convexLog(fn, { status: 'success', durationMs });
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Log error
    convexError(fn, error, { args, durationMs });

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Safety Logging (for critical operations)
// ---------------------------------------------------------------------------

/**
 * Log a safety-critical operation.
 * These logs should always be visible regardless of verbose mode.
 *
 * @param fn - Function name
 * @param action - Action being performed
 * @param data - Context data
 */
export function convexSafetyLog(
  fn: string,
  action: string,
  data: Record<string, unknown>
): void {
  console.log(formatLog('INFO', fn, `[SAFETY] ${action}`, data));
}

/**
 * Log a security event.
 *
 * @param fn - Function name
 * @param event - Security event type
 * @param data - Event data
 */
export function convexSecurityLog(
  fn: string,
  event: string,
  data: Record<string, unknown>
): void {
  console.log(formatLog('WARN', fn, `[SECURITY] ${event}`, data));
}
