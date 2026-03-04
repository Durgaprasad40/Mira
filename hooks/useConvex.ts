import { ConvexReactClient } from 'convex/react';

// Re-export demo mode flag for backward compatibility (permanently disabled)
// Demo mode is now permanently false - app always uses Convex backend
export { isDemoMode } from '@/config/demo';

// Initialize Convex client
// EXPO_PUBLIC_CONVEX_URL must be set — fail fast if missing
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    '[useConvex] EXPO_PUBLIC_CONVEX_URL is required. ' +
    'Please provide a valid Convex URL in your environment variables.'
  );
}

export const convex = new ConvexReactClient(convexUrl);
