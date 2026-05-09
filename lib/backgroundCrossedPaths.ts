/**
 * Background Crossed Paths — Phase-2 client foundation
 *
 * UI/consent surface ONLY. This module deliberately ships with the feature
 * gated OFF and exposes NO entry points to the OS background-location APIs.
 *
 * Phase-3 (later) will:
 *   - flip the backend `bgCrossedPathsEnabled` feature flag,
 *   - add ACCESS_BACKGROUND_LOCATION + FOREGROUND_SERVICE_LOCATION manifests,
 *   - register the iOS Significant Location Change task,
 *   - register the Android Discovery Mode task via TaskManager,
 *   - and only then call `acceptBackgroundLocationConsent` on a real ON-flip.
 *
 * Until that happens, the in-app toggle remains in a "Coming soon" state and
 * the only consent mutation reachable from the UI is the always-allowed
 * `revokeBackgroundLocationConsent` (so any consent ever recorded can still
 * be cleared from this screen).
 */

/**
 * Client-side mirror of the backend `featureFlags.bgCrossedPathsEnabled` row.
 *
 * MUST stay `false` for the entire Phase-2 milestone. Flipping this to true
 * without the corresponding native + manifest work in Phase-3 would still
 * not actually request OS permissions, but it would unlock the consent
 * mutation in the UI — which is reserved for the Phase-3 unlock so the two
 * sides ship together.
 */
export const BG_CROSSED_PATHS_FEATURE_READY = false;

/**
 * Mirror of the backend `BG_LOCATION_CONSENT_VERSION` (in `convex/crossedPaths.ts`).
 * Used by the UI to decide whether an existing consent stamp is still
 * current. Purely advisory on the client — backend re-validates on every
 * write path.
 */
export const BG_LOCATION_CONSENT_VERSION = 'bg_crossed_paths_v1';

/** Copy strings for the Background Crossed Paths surface. Centralized so
 *  product can iterate without spelunking through the settings file. */
export const BG_COPY = {
  sectionTitle: 'Background crossed paths',
  sectionTagline:
    'Find people you crossed paths with even when Mira is closed — once you choose to turn it on later.',
  toggleTitle: 'Enable background crossed paths',
  toggleDescriptionUnavailable:
    'Coming soon. We will let you know when this is ready to enable.',
  toggleDescriptionReady:
    'Mira will use background location to remember when you cross paths with someone, even when the app is closed.',
  statusComingSoon: 'Unavailable in this version',
  statusConsentGranted: 'Consent granted',
  statusConsentNone: 'Not enabled',
  discoveryActiveLabel: 'Discovery Mode active',
  discoveryInactiveLabel: 'Discovery Mode off',
  // Explainer modal copy
  explainerTitle: 'Background crossed paths',
  explainerLead:
    'When you turn this on later, Mira will be able to record when you cross paths with someone even if the app is closed.',
  explainerBullets: [
    'Mira only uses background location if you explicitly enable it.',
    'Your exact coordinates are never shown to other users — only that you crossed paths.',
    'You can turn it off anytime from Nearby Settings, and your consent is cleared.',
    'Privacy zones, distance rules, and pause still apply to background samples.',
  ],
  explainerNoticeUnavailable:
    'This phase does not start real background location yet. We are only saving your preference.',
  explainerNoticeReady:
    'Tapping continue will record your consent. Mira may then ask the system for background location permission.',
  explainerCancel: 'Cancel',
  explainerContinueUnavailable: 'OK, got it',
  explainerContinueReady: 'I understand, enable',
  // Revoke confirmation copy
  revokeNote:
    'Turning this off clears your background crossed-paths consent and disables Discovery Mode if active.',
} as const;

/**
 * Resolve the user-visible status for the Background Crossed Paths section
 * given the consent fields surfaced by `getCurrentUser`.
 *
 * Returns one of:
 *   - 'unavailable' — backend feature flag is OFF (Phase-2 default)
 *   - 'granted'     — consent recorded with the current version
 *   - 'stale'       — consent recorded but version mismatches (must re-accept)
 *   - 'none'        — no consent on file
 */
export type BgConsentStatus = 'unavailable' | 'granted' | 'stale' | 'none';

export function resolveBgConsentStatus(args: {
  featureReady: boolean;
  consentAt: number | undefined | null;
  consentVersion: string | undefined | null;
}): BgConsentStatus {
  if (!args.featureReady) return 'unavailable';
  if (typeof args.consentAt !== 'number' || args.consentAt <= 0) return 'none';
  if (args.consentVersion !== BG_LOCATION_CONSENT_VERSION) return 'stale';
  return 'granted';
}

/**
 * Format a "Discovery Mode active — ends in 3h 12m" status line, or null when
 * the window has elapsed / never started.
 */
export function formatDiscoveryCountdown(expiresAt: number | undefined | null): string | null {
  if (typeof expiresAt !== 'number' || expiresAt <= 0) return null;
  const now = Date.now();
  if (expiresAt <= now) return null;
  const remainingMs = expiresAt - now;
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}
