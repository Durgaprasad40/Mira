/**
 * usePhaseMode - Single source of truth for Phase 1 vs Phase 2 routing
 *
 * CRITICAL: This hook provides a SINGLE derived routing decision.
 * All layout effects MUST use this to determine if they should run.
 *
 * Phase modes:
 * - 'phase1': Route is in Phase 1 (main tabs, discover, messages, etc.)
 * - 'phase2': Route is in Phase 2 (private area - Deep Connect)
 * - 'shared': Route is shared between phases (incognito-chat, match-celebration)
 * - 'loading': Router not ready yet
 *
 * RULES:
 * 1. Only ONE layout should handle navigation effects per route
 * 2. Phase 2 effects should NOT run when mode is 'phase1' or 'shared'
 * 3. Phase 1 effects should NOT run when mode is 'phase2'
 * 4. Shared routes are handled by MainLayout only
 */
import { useMemo } from 'react';
import { useSegments, useRootNavigationState } from 'expo-router';

export type PhaseMode = 'phase1' | 'phase2' | 'shared' | 'loading';

/**
 * Shared routes - these can be reached from either Phase 1 or Phase 2
 * MainLayout handles these; PrivateLayout should NOT intercept navigation to them
 */
const SHARED_ROUTES = new Set([
  'incognito-chat',
  'match-celebration',
  'incognito-room',
  'prompt-thread',
  'confession-thread',
  'confession-chat',
]);

/**
 * Check if a segment array represents a Phase 2 (private) route
 */
export function isPhase2Segment(segments: string[]): boolean {
  return segments.includes('(private)');
}

/**
 * Check if the last segment is a shared route
 */
export function isSharedRoute(segments: string[]): boolean {
  const lastSegment = segments[segments.length - 1];
  // Handle dynamic routes like incognito-room/[id]
  const routeName = lastSegment?.replace(/\[.*\]/, '') || '';
  return SHARED_ROUTES.has(routeName) || SHARED_ROUTES.has(lastSegment);
}

/**
 * Hook: Get current phase mode
 *
 * Usage:
 * ```
 * const phaseMode = usePhaseMode();
 * if (phaseMode !== 'phase2') return; // Skip Phase 2 effects
 * ```
 */
export function usePhaseMode(): PhaseMode {
  const segments = useSegments();
  const rootNavState = useRootNavigationState();

  return useMemo(() => {
    // Router not ready
    if (!rootNavState?.key) {
      return 'loading';
    }

    const segmentStrings = segments as string[];

    // Check for shared routes first (can be accessed from either phase)
    if (isSharedRoute(segmentStrings)) {
      return 'shared';
    }

    // Check for Phase 2 routes
    if (isPhase2Segment(segmentStrings)) {
      return 'phase2';
    }

    // Default to Phase 1
    return 'phase1';
  }, [segments, rootNavState?.key]);
}

/**
 * Hook: Check if we're currently in a specific phase
 * More efficient than usePhaseMode when you only need a boolean
 */
export function useIsPhase2(): boolean {
  const segments = useSegments();
  return useMemo(() => isPhase2Segment(segments as string[]), [segments]);
}

/**
 * Hook: Check if current route is shared between phases
 */
export function useIsSharedRoute(): boolean {
  const segments = useSegments();
  return useMemo(() => isSharedRoute(segments as string[]), [segments]);
}
