import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, BackHandler, Platform } from 'react-native';
import { Stack, useRouter, useNavigation, usePathname, useSegments } from 'expo-router';
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
import { setPhase2Active } from '@/hooks/useNotifications';

const C = INCOGNITO_COLORS;

// Phase-2 Back Navigation Constants
const PHASE2_HOME_ROUTE = '/(main)/(private)/(tabs)/desire-land';
const PHASE1_DISCOVER_ROUTE = '/(main)/(tabs)/home';

// Phase-2 tab root screens (BackGuard ONLY intercepts on these)
// Nested screens (chat detail, etc.) use normal back behavior
const PHASE2_TAB_ROOTS = new Set([
  'desire-land',
  'chats',
  'chat-rooms',
  'truth-or-dare',
  'private-profile',
  'confess',
  'rooms',
]);

export default function PrivateLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const ageConfirmed18Plus = useIncognitoStore((s) => s.ageConfirmed18Plus);
  const acceptPrivateTerms = useIncognitoStore((s) => s.acceptPrivateTerms);
  const userId = useAuthStore((s) => s.userId);

  // Get the parent (main) stack navigator — beforeRemove fires here
  // when this screen is about to be popped from the (main) stack.
  const navigation = useNavigation();
  const isExitingRef = useRef(false);

  // Back navigation guards (Android only)
  const lastBackAtRef = useRef(0);
  const isNavigatingRef = useRef(false);

  // 🚨 CRITICAL: Collapse phantom "/" route inside Phase-2
  // Expo Router creates an implicit "/" entry before the real Phase-2 home.
  // This causes double back gestures. Normalize immediately to desire-land.
  useEffect(() => {
    const segmentStrings = segments as string[];
    if (pathname === '/' && segmentStrings.includes('(private)')) {
      router.replace(PHASE2_HOME_ROUTE);
    }
  }, [pathname, segments, router]);

  // Phase 2 isolation: Set module-level flag to block Phase 1-only notifications
  useEffect(() => {
    setPhase2Active(true);
    return () => setPhase2Active(false);
  }, []);

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

  // 2) Android hardware back — Phase-2 Tab-to-Tab Back Controller
  //    ONLY intercepts back on Phase-2 TAB ROOT screens.
  //    Nested screens (chat detail, modals, etc.) use normal back behavior.
  //
  //    Tab root behavior:
  //    - From any Phase-2 tab root (except desire-land) → go to desire-land
  //    - From desire-land → go to Phase-1 Discover
  //
  //    Note: segments/pathname are captured in closure; useEffect re-registers handler when they change.
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // Verify we're actually inside Phase-2 using segments
    const segmentStrings = segments as string[];
    const isInPhase2 = segmentStrings.includes('(private)');
    if (!isInPhase2) return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Get the last segment to check if we're on a tab root
      const lastSegment = segmentStrings[segmentStrings.length - 1];
      const isOnPhase2TabRoot = PHASE2_TAB_ROOTS.has(lastSegment);

      // If NOT on a tab root (e.g., chat detail, nested screen), let normal back happen
      if (!isOnPhase2TabRoot) {
        if (__DEV__) {
          console.log('[BackGuard] not on tab root, allowing normal back:', lastSegment);
        }
        return false; // Let native/router handle it
      }

      const now = Date.now();

      // Debounce: ignore rapid back presses (< 600ms apart)
      if (now - lastBackAtRef.current < 600) {
        if (__DEV__) {
          console.log('[BackGuard] debounced, ignoring');
        }
        return true; // Consume but don't act
      }

      // Transition lock: ignore if already navigating
      if (isNavigatingRef.current) {
        if (__DEV__) {
          console.log('[BackGuard] transition locked, ignoring');
        }
        return true; // Consume but don't act
      }

      // Determine target based on current tab root
      const isOnPhase2Home = lastSegment === 'desire-land';
      const targetRoute = isOnPhase2Home ? PHASE1_DISCOVER_ROUTE : PHASE2_HOME_ROUTE;

      // Prevent redundant navigation to same route
      if (pathname === targetRoute) {
        if (__DEV__) {
          console.log('[BackGuard] already at target, ignoring');
        }
        return true; // Consume but don't act
      }

      // Set locks
      lastBackAtRef.current = now;
      isNavigatingRef.current = true;

      if (__DEV__) {
        console.log('[BackGuard] tab-to-tab:', lastSegment, '→', targetRoute);
      }

      // Navigate using replace() for tab-to-tab (no extra stack entries)
      router.replace(targetRoute);

      // Release transition lock after navigation settles
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 400);

      return true; // We handled it
    });

    return () => handler.remove();
  }, [router, pathname, segments]);

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
