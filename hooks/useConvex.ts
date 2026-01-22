import { ConvexReactClient } from 'convex/react';

// Initialize Convex client
// Replace with your actual Convex deployment URL
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL || 'https://your-deployment.convex.cloud';

export const convex = new ConvexReactClient(convexUrl);
