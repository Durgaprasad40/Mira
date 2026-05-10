/**
 * Auth error sanitization.
 *
 * Convex client errors arrive with backend frames embedded in the message,
 * e.g.:
 *
 *   [CONVEX M(auth:loginWithEmail)] [Request ID: abc] Server Error
 *   Uncaught Error: Invalid email or password
 *       at handler (../../convex/auth.ts:741:12)
 *     Called by client
 *
 * Such strings must never reach the UI. `sanitizeAuthError` maps known
 * backend-thrown invariants from `convex/auth.ts` to fixed user-facing
 * copy and collapses everything else to a generic message so that file
 * paths, line numbers, request IDs, the literal "[CONVEX" prefix, the
 * "Called by client" suffix, and any stack frames are dropped.
 *
 * The raw error is still logged to the console in __DEV__ for engineers
 * debugging Metro builds; release builds never log or display the raw
 * detail.
 */

export type AuthErrorKind =
  | 'login'
  | 'register'
  | 'otp_send'
  | 'otp_verify'
  | 'generic';

/**
 * Returns a sanitized, user-facing string for an auth-flow error. The
 * returned string is guaranteed to contain none of: file paths, line
 * numbers, request IDs, "[CONVEX", "Server Error", "Called by client",
 * "at handler", or the underlying `error.message` if unrecognized.
 */
export function sanitizeAuthError(
  err: unknown,
  kind: AuthErrorKind = 'generic',
): string {
  if (__DEV__) {
    // Keep raw detail in Metro logs only; never surfaced in UI.
    // eslint-disable-next-line no-console
    console.warn('[authErrors] raw error:', err);
  }

  const raw = extractRawMessage(err);

  // Known invariants thrown by convex/auth.ts (loginWithEmail). Matched
  // case-insensitively and via substring to tolerate Convex client wrapping.
  if (/invalid\s+email\s+or\s+password/i.test(raw)) {
    return 'Invalid email or password.';
  }
  if (/too\s+many\s+login\s+attempts/i.test(raw)) {
    return 'Too many login attempts. Please try again later.';
  }
  if (/account\s+has\s+been\s+suspended/i.test(raw)) {
    return 'Your account has been suspended.';
  }

  // Network / connectivity signals (RN fetch / Convex transport).
  if (/network\s+request\s+failed|failed\s+to\s+fetch|networkerror/i.test(raw)) {
    return 'Something went wrong. Please try again.';
  }

  switch (kind) {
    case 'login':
      return 'Something went wrong. Please try again.';
    case 'register':
      return 'Could not create your account. Please try again.';
    case 'otp_send':
      return 'Could not send verification code. Please try again.';
    case 'otp_verify':
      return 'Verification failed. Please try again.';
    case 'generic':
    default:
      return 'Something went wrong. Please try again.';
  }
}

function extractRawMessage(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const anyErr = err as { message?: unknown; data?: unknown };
    if (typeof anyErr.message === 'string') return anyErr.message;
    if (typeof anyErr.data === 'string') return anyErr.data;
    try {
      return JSON.stringify(err);
    } catch {
      return '';
    }
  }
  return String(err);
}
