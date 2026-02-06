/**
 * Re-export useExploreProfiles from the hooks folder.
 *
 * This hook provides the single source of truth for explore profiles.
 * Works in both demo mode (uses DEMO_PROFILES from demoStore) and
 * live mode (queries Convex getExploreProfiles).
 */
export { useExploreProfiles } from '@/hooks/useExploreProfiles';
