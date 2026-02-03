import { ConvexReactClient } from 'convex/react';

// Initialize Convex client
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL || 'https://placeholder.convex.cloud';

// Check if we're in demo mode
export const isDemoMode =
  process.env.EXPO_PUBLIC_DEMO_MODE === 'true' ||
  convexUrl.includes('placeholder') ||
  convexUrl.includes('your-deployment');

export const convex = new ConvexReactClient(convexUrl);

// In demo mode the URL is a placeholder that will never connect.
// The Convex client's WebSocket connection attempt hangs for several seconds
// and then triggers reconnect cycles that cause re-renders across the entire
// app, freezing all touch handling. Closing immediately prevents this while
// still providing the client object that ConvexProvider/useQuery/useMutation
// hooks require (all queries use "skip" in demo mode).
if (isDemoMode) {
  convex.close();
}
