import { Stack } from 'expo-router';
import { ConvexProvider } from 'convex/react';
import { convex } from '@/hooks/useConvex';

export default function RootLayout() {
  return (
    <ConvexProvider client={convex}>
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(main)" options={{ headerShown: false }} />
      </Stack>
    </ConvexProvider>
  );
}
