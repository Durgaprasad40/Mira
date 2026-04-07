/**
 * DEV-only structured logging for onboarding, tabs, and navigation.
 * All logs are NO-OP in production builds.
 *
 * VERBOSE MODE: Set DEV_TRACE_VERBOSE = true to enable detailed logging.
 * Default is false to reduce console noise.
 *
 * Usage:
 *   trace("EVENT_NAME", { key: value })
 *   traceOnce("key", "EVENT_NAME", { ... })  // logs once per session
 *   traceDedupe("key", 1500, "EVENT_NAME", { ... })  // prevents spam
 *   useRouteTrace("SCOPE", () => ({ extra }))  // logs route changes
 *   useScreenTrace("SCREEN_NAME", () => ({ extra }))  // logs mount/focus
 *   dumpOnboardingSummary("trigger", { ... })  // formatted summary log
 */
import { useEffect, useRef, useCallback } from 'react';
import { usePathname, useSegments } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

// VERBOSE MODE: Set to true only when debugging navigation/onboarding issues
const DEV_TRACE_VERBOSE = false;

// Session ID generated once per app launch
const SESSION_ID = __DEV__ ? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` : '';
const START_TIME = Date.now();

// Track one-time logs
const onceLogs = new Set<string>();

// Track dedupe timestamps
const dedupeTimestamps = new Map<string, number>();

/**
 * Get elapsed time in ms since app start
 */
function elapsed(): number {
  return Date.now() - START_TIME;
}

/**
 * Format payload for logging (single line, no sensitive data)
 */
function formatPayload(payload?: Record<string, unknown>): string {
  if (!payload) return '';
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    // Skip sensitive or large values
    if (k.toLowerCase().includes('token') && typeof v === 'string') {
      safe[k] = v ? '[REDACTED]' : null;
    } else if (k.toLowerCase().includes('base64') || k.toLowerCase().includes('image')) {
      safe[k] = '[BINARY]';
    } else if (typeof v === 'string' && v.length > 100) {
      safe[k] = v.slice(0, 50) + '...[truncated]';
    } else {
      safe[k] = v;
    }
  }
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : '';
}

/**
 * Core trace function - DEV only, gated by DEV_TRACE_VERBOSE
 */
export function trace(event: string, payload?: Record<string, unknown>): void {
  if (!__DEV__ || !DEV_TRACE_VERBOSE) return;
  const p = formatPayload(payload);
  console.log(`[TRACE] {t:${elapsed()}, sid:${SESSION_ID}, ev:${event}${p ? ', ' + p.slice(1, -1) : ''}}`);
}

/**
 * Log once per session (by key)
 */
export function traceOnce(key: string, event: string, payload?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (onceLogs.has(key)) return;
  onceLogs.add(key);
  trace(event, payload);
}

/**
 * Dedupe logs within a time window (ms)
 */
export function traceDedupe(key: string, ms: number, event: string, payload?: Record<string, unknown>): void {
  if (!__DEV__) return;
  const now = Date.now();
  const last = dedupeTimestamps.get(key);
  if (last && now - last < ms) return;
  dedupeTimestamps.set(key, now);
  trace(event, payload);
}

/**
 * Dump onboarding summary - formatted multi-line for readability
 * This is always enabled (not gated by DEV_TRACE_VERBOSE) as it's a key debug tool
 */
export function dumpOnboardingSummary(trigger: string, summary: Record<string, unknown>): void {
  if (!__DEV__ || !DEV_TRACE_VERBOSE) return;
  console.log(`\n[ONBOARDING SUMMARY] trigger=${trigger}, sid=${SESSION_ID}, t=${elapsed()}ms`);
  console.log('----------------------------------------');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
  console.log('----------------------------------------\n');
}

/**
 * Hook: Log route/pathname changes
 * Call at top of a layout component
 *
 * Pass scope="SKIP" to suppress logging (useful for shared routes)
 */
export function useRouteTrace(
  scope: string,
  getExtra?: () => Record<string, unknown>
): void {
  if (!__DEV__) return;

  const pathname = usePathname();
  const segments = useSegments();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip logging when scope is "SKIP" (shared routes, etc.)
    if (scope === 'SKIP') return;

    if (pathname === prevPathRef.current) return;
    prevPathRef.current = pathname;

    const extra = getExtra?.() ?? {};
    traceDedupe(
      `route_${scope}_${pathname}`,
      500,
      `ROUTE_${scope}`,
      {
        pathname,
        segments: segments.join('/'),
        ...extra,
      }
    );
  }, [pathname, segments, scope, getExtra]);
}

/**
 * Hook: Log screen mount/unmount and focus/blur
 * Call at top of a screen component
 */
export function useScreenTrace(
  screenName: string,
  getExtra?: () => Record<string, unknown>
): void {
  if (!__DEV__) return;

  const mountedRef = useRef(false);

  // Log mount/unmount
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      const extra = getExtra?.() ?? {};
      traceDedupe(
        `screen_mount_${screenName}`,
        1000,
        `SCREEN_MOUNT`,
        { screen: screenName, ...extra }
      );
    }
    return () => {
      traceDedupe(
        `screen_unmount_${screenName}`,
        1000,
        `SCREEN_UNMOUNT`,
        { screen: screenName }
      );
    };
  }, [screenName, getExtra]);

  // Log focus/blur
  useFocusEffect(
    useCallback(() => {
      const extra = getExtra?.() ?? {};
      traceDedupe(
        `screen_focus_${screenName}`,
        1000,
        `SCREEN_FOCUS`,
        { screen: screenName, ...extra }
      );

      return () => {
        traceDedupe(
          `screen_blur_${screenName}`,
          1000,
          `SCREEN_BLUR`,
          { screen: screenName }
        );
      };
    }, [screenName, getExtra])
  );
}

// Export session ID for reference in other logs
export const DEV_SESSION_ID = SESSION_ID;
