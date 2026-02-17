import { ConvexReactClient } from 'convex/react';

// Single source of truth for demo mode — imported from config/demo.ts
// All other files should import isDemoMode from here or from @/config/demo
export { isDemoMode } from '@/config/demo';
import { isDemoMode } from '@/config/demo';

// Initialize Convex client
// In live mode, EXPO_PUBLIC_CONVEX_URL must be set — fail fast if missing
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!isDemoMode && !convexUrl) {
  throw new Error(
    '[useConvex] EXPO_PUBLIC_CONVEX_URL is required in live mode. ' +
    'Set EXPO_PUBLIC_DEMO_MODE=true for demo mode, or provide a valid Convex URL.'
  );
}

// In demo mode, use a placeholder URL (client stays idle with "skip" queries)
const effectiveUrl = convexUrl || 'https://placeholder.convex.cloud';

export const convex = new ConvexReactClient(effectiveUrl);

// In demo mode all hooks use useQuery("skip") which creates zero subscriptions,
// and useMutation returns a memoized stub. The client stays open but idle —
// closing it causes "ConvexReactClient has already been closed" when
// Expo Router remounts layouts or on fast refresh.
