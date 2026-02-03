import { ConvexReactClient } from 'convex/react';

// Initialize Convex client
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL || 'https://placeholder.convex.cloud';

// Check if we're in demo mode
export const isDemoMode =
  process.env.EXPO_PUBLIC_DEMO_MODE === 'true' ||
  convexUrl.includes('placeholder') ||
  convexUrl.includes('your-deployment');

export const convex = new ConvexReactClient(convexUrl);

// In demo mode all hooks use useQuery("skip") which creates zero subscriptions,
// and useMutation returns a memoized stub. The client stays open but idle —
// closing it causes "ConvexReactClient has already been closed" when
// Expo Router remounts layouts or on fast refresh.
