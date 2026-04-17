/**
 * Phase-1 Discover: unwrap `discover.getDiscoverProfiles` results.
 * Backend may return `{ profiles, phase1EmptyReason }` or legacy plain arrays.
 */

export type Phase1DiscoverEmptyReason =
  | 'auth_missing_or_invalid'
  | 'viewer_unavailable'
  | 'filters_no_match'
  | 'no_more_profiles'
  | 'unknown_empty';

export type Phase1DiscoverQueryResult = {
  profiles: any[];
  phase1EmptyReason?: Phase1DiscoverEmptyReason | null;
};

export function unwrapPhase1DiscoverQueryResult(data: unknown): Phase1DiscoverQueryResult {
  if (data == null) {
    return { profiles: [] };
  }
  if (Array.isArray(data)) {
    return { profiles: data };
  }
  if (typeof data === 'object' && data !== null && 'profiles' in data) {
    const o = data as Phase1DiscoverQueryResult;
    return {
      profiles: Array.isArray(o.profiles) ? o.profiles : [],
      phase1EmptyReason: o.phase1EmptyReason ?? null,
    };
  }
  return { profiles: [] };
}
