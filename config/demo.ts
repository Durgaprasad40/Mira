/**
 * Central demo-mode flag (pure — no side effects).
 *
 * Import from here in stores / helpers that need to bypass limits:
 *   import { isDemoMode } from '@/config/demo';
 */
export const isDemoMode = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
