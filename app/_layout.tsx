import { Stack } from 'expo-router';
import { ConvexProvider } from 'convex/react';
import { convex, isDemoMode } from '@/hooks/useConvex';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

function DemoBanner() {
  if (!isDemoMode) return null;

  return (
    <View style={styles.demoBanner}>
      <Text style={styles.demoText}>
        🎮 DEMO MODE - Run "npx convex dev" to connect backend
      </Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ConvexProvider client={convex}>
      <StatusBar style="light" />
      <DemoBanner />
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(main)" options={{ headerShown: false }} />
      </Stack>
    </ConvexProvider>
  );
}

const styles = StyleSheet.create({
  demoBanner: {
    backgroundColor: '#FF6B6B',
    padding: 8,
    alignItems: 'center',
  },
  demoText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
});
