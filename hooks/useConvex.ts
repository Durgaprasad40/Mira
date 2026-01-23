import { ConvexReactClient } from 'convex/react';

// Initialize Convex client
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL || 'https://placeholder.convex.cloud';

// Check if we're in demo mode
export const isDemoMode =
  process.env.EXPO_PUBLIC_DEMO_MODE === 'true' ||
  convexUrl.includes('placeholder') ||
  convexUrl.includes('your-deployment');

export const convex = new ConvexReactClient(convexUrl);
