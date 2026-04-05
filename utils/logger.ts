/**
 * Centralized logger utility for Mira app
 *
 * Usage:
 *   import { log } from '@/utils/logger';
 *   log.info('[LIKE]', 'added', { profileId: 'demo_1' });
 *   log.warn('[BUG]', 'mismatch', { raw: 5, filtered: 0 });
 *   log.error('[CRASH]', 'unexpected error', error);
 *   log.debug('[NAV]', 'focus changed'); // Only when LOG_LEVEL = 'debug'
 *
 * Log levels (in order of verbosity):
 *   - 'silent': No logs at all
 *   - 'error':  Errors only
 *   - 'warn':   Errors + warnings
 *   - 'info':   Errors + warnings + info (DEFAULT)
 *   - 'debug':  All logs including verbose debug
 */

// ┌─────────────────────────────────────────────────────────────────┐
// │  CHANGE THIS TO ENABLE DEBUG LOGS FOR DEEP TRACING             │
// │  'info'  = normal (default)                                     │
// │  'debug' = verbose tracing                                      │
// │  'silent' = no logs                                             │
// └─────────────────────────────────────────────────────────────────┘
type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
const LOG_LEVEL: LogLevel = 'info';

// PROD_LOGGING: Enable logging in production builds (standalone APK)
// Set to true to see logs in adb logcat for debugging
const ENABLE_PROD_LOGGING = true;

// ┌─────────────────────────────────────────────────────────────────┐
// │  FEATURE FOCUS: Filter logs to specific feature                 │
// │  null = show all logs (default)                                 │
// │  'phase2' = only show Deep Connect / Phase-2 logs               │
// │  Focused prefixes: [P2_], [PHASE2], [PRIVATE], [INCOGNITO]      │
// └────────────────────────────────────────────────────────���────────┘
type FocusFeature = null | 'phase2';
const FOCUS_FEATURE: FocusFeature = 'phase2'; // Set to null to see all logs

// Prefixes that are always shown (errors, critical) regardless of focus
const ALWAYS_SHOW_PREFIXES = ['[ERROR]', '[CRASH]', '[FATAL]', '[AUTH]'];

// Prefixes that match the focused feature
const PHASE2_PREFIXES = ['[P2_', '[PHASE2', '[PRIVATE', '[INCOGNITO', '[MATCH]', 'P2_UI_'];

function matchesFocusFeature(prefix: string): boolean {
  if (FOCUS_FEATURE === null) return true; // No filter, show all
  if (ALWAYS_SHOW_PREFIXES.some(p => prefix.includes(p))) return true;

  if (FOCUS_FEATURE === 'phase2') {
    return PHASE2_PREFIXES.some(p => prefix.includes(p));
  }

  return true;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function shouldLog(level: LogLevel): boolean {
  // In DEV mode: always check log level
  // In PROD mode: only log if ENABLE_PROD_LOGGING is true
  if (!__DEV__ && !ENABLE_PROD_LOGGING) return false;
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[LOG_LEVEL];
}

// Tracks what we've already logged to prevent duplicates
const loggedOnce = new Set<string>();

/**
 * Format a value for logging - keeps it concise
 */
function formatValue(val: unknown): string {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return `[${val.length} items]`;
  if (typeof val === 'object') {
    // Format object as key=value pairs
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    if (entries.length <= 4) {
      return entries.map(([k, v]) => `${k}=${formatValue(v)}`).join(' ');
    }
    return `{${entries.length} keys}`;
  }
  return String(val);
}

/**
 * Build a single-line log message
 */
function buildMessage(prefix: string, message: string, data?: Record<string, unknown>): string {
  let line = `${prefix} ${message}`;
  if (data && Object.keys(data).length > 0) {
    line += ' ' + formatValue(data);
  }
  return line;
}

export const log = {
  /**
   * Log important events (like added, match created, etc.)
   * Respects FOCUS_FEATURE filter - non-focused logs are suppressed
   */
  info(prefix: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog('info') && matchesFocusFeature(prefix)) {
      console.log(buildMessage(prefix, message, data));
    }
  },

  /**
   * Log warnings (potential issues, unexpected states)
   * Respects FOCUS_FEATURE filter - non-focused logs are suppressed
   */
  warn(prefix: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog('warn') && matchesFocusFeature(prefix)) {
      console.warn(buildMessage(prefix, message, data));
    }
  },

  /**
   * Log errors - ALWAYS shown regardless of feature focus
   */
  error(prefix: string, message: string, error?: unknown): void {
    if (shouldLog('error')) {
      if (error instanceof Error) {
        console.error(`${prefix} ${message}:`, error.message);
      } else if (error) {
        console.error(`${prefix} ${message}:`, error);
      } else {
        console.error(`${prefix} ${message}`);
      }
    }
  },

  /**
   * Verbose debug logs - only enabled when LOG_LEVEL = 'debug'
   * Respects FOCUS_FEATURE filter - non-focused logs are suppressed
   */
  debug(prefix: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug') && matchesFocusFeature(prefix)) {
      console.log(buildMessage(prefix, message, data));
    }
  },

  /**
   * Log something only once per session (prevents spam)
   * Useful for hydration, initialization, etc.
   * Respects FOCUS_FEATURE filter
   */
  once(key: string, prefix: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog('info') && matchesFocusFeature(prefix) && !loggedOnce.has(key)) {
      loggedOnce.add(key);
      console.log(buildMessage(prefix, message, data));
    }
  },

  /**
   * Reset "logged once" tracking (useful for testing)
   */
  resetOnce(): void {
    loggedOnce.clear();
  },
};

export default log;
