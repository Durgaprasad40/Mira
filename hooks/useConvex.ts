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

// LOG_FORMAT_FIX: Disable Convex server log forwarding to client console
// Setting logger: false creates a noop logger, which prevents server-side
// console.log calls from being forwarded to the client with styled
// %c[CONVEX Q(...)] [LOG] formatting.
// Note: verbose: false only affects client debug logs, NOT server log forwarding.
export const convex = new ConvexReactClient(convexUrl, {
  verbose: false,
  logger: false,
});

