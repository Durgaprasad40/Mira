import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

/**
 * Thin redirect screen — immediately navigates to the Face 2 (Private) app shell.
 * Uses push (not replace) so Android back button can return to Face 1.
 * Consent gate and setup checks are handled by (private)/_layout.tsx.
 */
export default function PrivateRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
    router.push('/(main)/(private)/(tabs)/desire-land' as any);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={C.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
