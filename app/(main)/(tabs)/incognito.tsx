import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore, selectIsSetupValid } from '@/stores/privateProfileStore';

const C = INCOGNITO_COLORS;

/**
 * Private Tab Entry Guard
 *
 * Hydration-safe navigation:
 * 1. If store not hydrated → show loader (prevents flicker)
 * 2. If hydrated but setup not complete → redirect to onboarding
 * 3. If hydrated and setup complete → redirect to Phase-2 tabs
 *
 * Works identically in demo & prod (store abstracts the difference).
 * No Convex calls. No new state. No flicker.
 */
export default function PrivateEntryGuard() {
  const router = useRouter();
  const didNavigate = useRef(false);

  // Get hydration status directly from store
  const isHydrated = usePrivateProfileStore((s) => s._hasHydrated);

  // Use selector to check if setup is valid
  const isSetupValid = usePrivateProfileStore(selectIsSetupValid);

  useEffect(() => {
    // CRITICAL: Wait for hydration before any navigation decision
    if (!isHydrated) {
      return;
    }

    // Guard: only navigate once per mount
    if (didNavigate.current) {
      return;
    }
    didNavigate.current = true;

    if (!isSetupValid) {
      // Setup not complete → redirect to Phase-2 onboarding
      if (__DEV__) {
        console.log('[PrivateEntryGuard] Setup not valid, redirecting to onboarding');
      }
      router.replace('/(main)/phase2-onboarding' as any);
    } else {
      // Setup complete → redirect to Phase-2 private tabs
      if (__DEV__) {
        console.log('[PrivateEntryGuard] Setup valid, entering Phase-2 tabs');
      }
      router.replace('/(main)/(private)/(tabs)' as any);
    }
  }, [isHydrated, isSetupValid, router]);

  // Show loader while waiting for hydration or navigation
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={C.primary} />
      {!isHydrated && (
        <Text style={styles.hint}>Loading...</Text>
      )}
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
  hint: {
    marginTop: 12,
    fontSize: 14,
    color: C.textLight,
  },
});
