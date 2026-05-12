export const DEFAULT_MIN_AGE = 18;
export const DEFAULT_MAX_AGE = 40;
export const DEFAULT_MAX_DISTANCE_MILES = 50;

export const KM_PER_MILE = 1.60934;
export const MILES_PER_KM = 1 / KM_PER_MILE;

// Existing app convention stores discovery distance in km and rounds mile input.
export const DEFAULT_MAX_DISTANCE_KM = Math.round(DEFAULT_MAX_DISTANCE_MILES * KM_PER_MILE);

export function milesToKmRounded(miles: number): number {
  return Math.round(miles * KM_PER_MILE);
}

export function kmToMilesRounded(km: number): number {
  return Math.round(km * MILES_PER_KM);
}

export function normalizeDiscoveryAgeRange(
  minAge?: number | null,
  maxAge?: number | null,
): { minAge: number; maxAge: number } {
  const safeMin = Number.isFinite(minAge)
    ? Math.max(DEFAULT_MIN_AGE, Math.floor(minAge as number))
    : DEFAULT_MIN_AGE;
  const rawMax = Number.isFinite(maxAge)
    ? Math.floor(maxAge as number)
    : DEFAULT_MAX_AGE;

  return {
    minAge: safeMin,
    maxAge: Math.max(safeMin, rawMax),
  };
}

export function normalizeDiscoveryMaxDistanceKm(maxDistanceKm?: number | null): number {
  return Number.isFinite(maxDistanceKm) && (maxDistanceKm as number) > 0
    ? (maxDistanceKm as number)
    : DEFAULT_MAX_DISTANCE_KM;
}

export function normalizeDiscoveryPreferences(values: {
  minAge?: number | null;
  maxAge?: number | null;
  maxDistance?: number | null;
}): { minAge: number; maxAge: number; maxDistance: number } {
  const ageRange = normalizeDiscoveryAgeRange(values.minAge, values.maxAge);
  return {
    ...ageRange,
    maxDistance: normalizeDiscoveryMaxDistanceKm(values.maxDistance),
  };
}
