import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, BackHandler, Platform } from 'react-native';
import { Stack, useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useIncognitoStore } from '@/stores/incognitoStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { PrivateConsentGate } from '@/components/private/PrivateConsentGate';

const C = INCOGNITO_COLORS;

export default function PrivateLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ageConfirmed18Plus = useIncognitoStore((s) => s.ageConfirmed18Plus);
  const acceptPrivateTerms = useIncognitoStore((s) => s.acceptPrivateTerms);
  const userId = useAuthStore((s) => s.userId);

  // Get the parent (main) stack navigator — beforeRemove fires here
  // when this screen is about to be popped from the (main) stack.
  const navigation = useNavigation();
  const isExitingRef = useRef(false);

  const exitToHome = () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    try {
      if (router.canGoBack?.()) {
        router.back();
        return;
      }
    } catch {}
    router.navigate('/(main)/(tabs)/home' as any);
  };

  // 1) Intercept any navigation that would remove Private from the stack
  //    (iOS swipe-back, header back, programmatic back). Navigate back
  //    so Private is removed without remounting the tab navigator.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (isExitingRef.current) return; // prevent loop
      e.preventDefault();
      exitToHome();
    });
    return unsub;
  }, [navigation, router]);

  // 2) Android hardware back — extra safety net.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      exitToHome();
      return true; // block default (app exit)
    });
    return () => handler.remove();
  }, [router]);

  const isSetupComplete = usePrivateProfileStore((s) => s.isSetupComplete);
  const hasHydrated = usePrivateProfileStore((s) => s._hasHydrated);

  const convexPrivateProfile = useQuery(
    api.privateProfiles.getByUserId,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  // Consent gate
  if (!ageConfirmed18Plus) {
    return <PrivateConsentGate onAccept={acceptPrivateTerms} />;
  }

  // Wait for store hydration
  if (!hasHydrated) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  // Check setup status
  const setupComplete = isDemoMode
    ? isSetupComplete
    : (convexPrivateProfile?.isSetupComplete ?? isSetupComplete);

  if (!setupComplete) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.setupPrompt}>
          <Ionicons name="eye-off" size={56} color={C.primary} />
          <Text style={styles.setupTitle}>Set Up Private Mode</Text>
          <Text style={styles.setupSubtitle}>
            Create your private profile with blurred photos, intent tags, and boundaries.
          </Text>
          <TouchableOpacity
            style={styles.setupBtn}
            onPress={() => router.push('/(main)/(private-setup)/select-photos' as any)}
          >
            <Text style={styles.setupBtnText}>Start Setup</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  setupPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  setupTitle: { fontSize: 26, fontWeight: '700', color: C.text, textAlign: 'center', marginTop: 16, marginBottom: 8 },
  setupSubtitle: { fontSize: 15, color: C.textLight, textAlign: 'center', marginBottom: 24 },
  setupBtn: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16,
    paddingHorizontal: 32, alignItems: 'center',
  },
  setupBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
