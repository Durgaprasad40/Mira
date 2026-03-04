/**
 * Central demo-mode flag (pure — no side effects).
 *
 * DISABLED: Demo mode is permanently disabled. App runs in live mode only.
 * All data comes from Convex backend. No demo profiles/rooms/data.
 *
 * Import from here in stores / helpers that need to bypass limits:
 *   import { isDemoMode } from '@/config/demo';
 */
export const isDemoMode = false; // Permanently disabled - always use Convex backend
