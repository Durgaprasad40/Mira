/**
 * Safe navigation wrapper for expo-router.
 *
 * Wraps router.push/replace in try-catch to prevent silent navigation failures
 * from crashing the app or leaving users stuck.
 *
 * Usage:
 *   import { safePush, safeReplace } from '@/lib/safeRouter';
 *   safePush(router, '/(main)/profile/123', 'explore->profile');
 */
import { log } from '@/utils/logger';
import type { Router } from 'expo-router';

type Href = Parameters<Router['push']>[0];

/**
 * Safely call router.push with error handling.
 * @param router - The expo-router instance
 * @param href - The route to navigate to
 * @param context - Optional context string for logging (e.g., 'explore->category')
 */
export function safePush(router: Router, href: Href, context?: string): void {
  try {
    router.push(href);
  } catch (error) {
    log.warn('[NAV]', 'push failed', {
      href: String(href),
      context: context ?? 'unknown',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Safely call router.replace with error handling.
 * @param router - The expo-router instance
 * @param href - The route to navigate to
 * @param context - Optional context string for logging (e.g., 'messages->chat')
 */
export function safeReplace(router: Router, href: Href, context?: string): void {
  try {
    router.replace(href);
  } catch (error) {
    log.warn('[NAV]', 'replace failed', {
      href: String(href),
      context: context ?? 'unknown',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
