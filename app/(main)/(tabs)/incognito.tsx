import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

/**
 * Thin redirect screen — navigates to the Face 2 (Private) app shell.
 * Uses router.navigate (idempotent) to avoid pushing duplicate stack entries
 * when the user re-enters the Private tab.
 * Consent gate and setup checks are handled by (private)/_layout.tsx.
 */
export default function PrivateRedirectScreen() {
  const router = useRouter();
  const didNavigate = useRef(false);

  useEffect(() => {
    // Guard: only navigate once per mount
    if (didNavigate.current) return;
    didNavigate.current = true;

    // Use navigate (not push) — idempotent, won't stack duplicates
    router.navigate('/(main)/(private)/(tabs)/desire-land' as any);
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
