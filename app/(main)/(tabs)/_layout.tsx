/*
 * LOCKED (PHASE-1 TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 * Nearby tab is the only Phase-1 tab currently unlocked.
 */
import { useEffect, useRef, useMemo, useCallback } from "react";
import { Tabs, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { isDemoMode } from "@/hooks/useConvex";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";
import { useBlockStore } from "@/stores/blockStore";
import { useDemoDmStore } from "@/stores/demoDmStore";
import { useConfessionStore } from "@/stores/confessionStore";
import { useLocationStore } from "@/stores/locationStore";
import { usePrivateProfileStore } from "@/stores/privateProfileStore";
import { useBootStore } from "@/stores/bootStore";
import { asUserId } from "@/convex/id";
import { AppErrorBoundary, registerErrorBoundaryNavigation } from "@/components/safety";
import { processThreadsIntegrity } from "@/lib/threadsIntegrity";
import { DEMO_CONFESSION_CONNECT_REQUESTS } from "@/lib/demoData";
import { markTiming } from "@/utils/startupTiming";

/** Concrete DeepConnect screen — avoids group route `/(tabs)` resolving to pathname "/" */
const PHASE2_DEEPCONNECT_ROUTE = '/(main)/(private)/(tabs)/deep-connect';

export default function MainTabsLayout() {
  // Milestone E: first tab screen mounted
  markTiming('first_tab');

  const router = useRouter();
  const locationPrewarmed = useRef(false);
  const fetchLastKnownOnly = useLocationStore((s) => s.fetchLastKnownOnly);

  // Prewarm with lastKnown only (fast) — full tracking starts when Nearby tab opens
  // This avoids blocking startup with slow GPS acquisition
  useEffect(() => {
    if (!locationPrewarmed.current) {
      locationPrewarmed.current = true;
      fetchLastKnownOnly();
    }
  }, [fetchLastKnownOnly]);

  // Register navigation for error boundary "Go Home" button
  useEffect(() => {
    registerErrorBoundaryNavigation(() => {
      router.replace('/(main)/(tabs)/home');
    });
  }, [router]);
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  // BUGFIX: In live mode, never use demo_user_1 fallback for Convex queries
  // Demo mode: use demo_user_1 fallback for UI consistency
  // Live mode: use actual userId or undefined (queries will skip if falsy)
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : (userId || undefined);
  const convexUserId = currentUserId ? asUserId(currentUserId) : undefined;

  // BUGFIX #27: Use same unread logic for badge as messages list
  // Demo mode: use processThreadsIntegrity for consistency
  const demoMatches = useDemoStore((s) => s.matches);
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);
  const demoConversations = useDemoDmStore((s) => s.conversations);
  const demoMeta = useDemoDmStore((s) => s.meta);

  const demoUnreadCount = useMemo(() => {
    if (!isDemoMode) return 0;
    const result = processThreadsIntegrity({
      matches: demoMatches,
      conversations: demoConversations,
      meta: demoMeta,
      blockedUserIds,
      currentUserId,
    });
    return result.totalUnreadCount;
  }, [demoMatches, demoConversations, demoMeta, blockedUserIds, currentUserId]);

  // Convex mode: query unread count from server
  const convexUnreadCount = useQuery(
    api.messages.getUnreadCount,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  const unreadChats = isDemoMode ? demoUnreadCount : (convexUnreadCount ?? 0);

  // Confess inbox badge count: tagged confessions + unseen connect requests.
  const convexConfessInboxBadge = useQuery(
    api.confessions.getConfessInboxBadgeCount,
    !isDemoMode && token ? { token } : 'skip'
  );

  // Demo mode: use store for tagged count (count confessions targeting current user)
  const demoTaggedCount = useConfessionStore((s) => {
    if (!isDemoMode) return 0;
    // Count tagged confessions in demo store
    return s.confessions.filter((c) => c.taggedUserId === currentUserId).length;
  });
  const seenDemoConnectRequestIds = useConfessionStore((s) => s.seenConfessionConnectRequestIds);
  const demoConnectRequestCount = isDemoMode
    ? DEMO_CONFESSION_CONNECT_REQUESTS.filter(
        (request) => !seenDemoConnectRequestIds.includes(request.connectId)
      ).length
    : 0;

  const confessBadgeCount = isDemoMode
    ? demoTaggedCount + demoConnectRequestCount
    : (convexConfessInboxBadge?.total || 0);

  // Query deletion state for Private tab entry gating (non-demo mode)
  const privateDeletionState = useQuery(
    api.privateDeletion.getPrivateDeletionState,
    !isDemoMode && userId && token ? { token, authUserId: userId } : 'skip'
  );

  // STABILITY FIX: Query users.phase2OnboardingCompleted for durable routing decision
  // This ensures onboarding doesn't show again after force-quit/restart
  const userOnboardingStatus = useQuery(
    api.users.getOnboardingStatus,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Private tab state - check if Phase-2 onboarding is complete
  // MUST match the same logic used in PrivateLayout to avoid redirect flash
  // STABILITY FIX: Now checks both local store AND backend flag
  const localPhase2OnboardingCompleted = usePrivateProfileStore((s) => s.phase2OnboardingCompleted);
  const phase2OnboardingCompleted = isDemoMode
    ? localPhase2OnboardingCompleted
    : (localPhase2OnboardingCompleted || userOnboardingStatus?.phase2OnboardingCompleted === true);
  const privateStoreHydrated = usePrivateProfileStore((s) => s._hasHydrated);
  const localDeletionStatus = usePrivateProfileStore((s) => s.deletionStatus);
  // N-001/C-004 FIX: Permanent guard to prevent duplicate router.replace calls
  // Only resets on component remount (not timeout-based)
  const didRouteToPrivateRef = useRef(false);
  // E4: Track the private tab timeout for proper cleanup
  const privateTabTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // STABILITY FIX: Boot readiness guard to prevent hydration race condition
  // Ensures auth state, onboarding state, and route decision state are ready
  // before any navigation decisions are made
  const isBootReady = useBootStore((s) => s.isBootReady());

  // E4: Cleanup private tab timeout on unmount to prevent stale guard resets
  useEffect(() => {
    return () => {
      if (privateTabTimeoutRef.current) {
        clearTimeout(privateTabTimeoutRef.current);
        privateTabTimeoutRef.current = null;
      }
    };
  }, []);

  // Guard: prevent premature navigation if boot not ready
  if (!isBootReady) {
    return null;
  }

  // Handle Private tab press - navigate on user tap only
  const handlePrivateTabPress = (e: any) => {
    // Prevent default tab navigation (we handle it manually)
    e.preventDefault();

    // N-001/C-004 FIX: Prevent duplicate navigation during same component lifecycle
    // This guards against rapid state changes triggering multiple router.replace calls
    if (didRouteToPrivateRef.current) {
      if (__DEV__) console.log('[PRIVATE TAP] ignored: already routed');
      return;
    }
    didRouteToPrivateRef.current = true;

    // FIX: Do not silently ignore tap when not hydrated - proceed with best-effort routing
    // If not hydrated, navigate directly to Deep Connect (deep-connect); shell still gates on hydration
    if (!privateStoreHydrated) {
      if (__DEV__) console.log('[PRIVATE TAP] pressed -> Phase-2 tabs (hydration pending, shell will gate)');
      if (__DEV__) console.log('[PRIVATE TAP ROUTE TARGET]', PHASE2_DEEPCONNECT_ROUTE);
      router.replace(PHASE2_DEEPCONNECT_ROUTE as any);
      // Reset guard after navigation settles
      if (privateTabTimeoutRef.current) clearTimeout(privateTabTimeoutRef.current);
      privateTabTimeoutRef.current = setTimeout(() => {
        didRouteToPrivateRef.current = false;
        privateTabTimeoutRef.current = null;
      }, 1000);
      return;
    }

    // Determine effective deletion status (server in non-demo, local in demo)
    const effectiveDeletionStatus = isDemoMode
      ? localDeletionStatus
      : (privateDeletionState?.status ?? localDeletionStatus);

    // Check deletion state FIRST - if pending, go to recovery screen
    if (effectiveDeletionStatus === 'pending_deletion') {
      if (__DEV__) console.log('[PRIVATE TAP] pressed -> Recovery (deletion pending)');
      router.replace('/(main)/private-recovery' as any);
    }
    // Otherwise, navigate based on onboarding completion
    else if (phase2OnboardingCompleted) {
      if (__DEV__) console.log('[PRIVATE TAP] pressed -> Phase-2 tabs');
      if (__DEV__) console.log('[PRIVATE TAP ROUTE TARGET]', PHASE2_DEEPCONNECT_ROUTE);
      router.replace(PHASE2_DEEPCONNECT_ROUTE as any);
    } else {
      if (__DEV__) console.log('[PRIVATE TAP] pressed -> onboarding (direct)');
      router.replace('/(main)/phase2-onboarding' as any);
    }

    // N-001/C-004: Reset guard after navigation settles (allows future taps after returning)
    // E4: Clear previous timeout before setting new one to prevent stale resets
    if (privateTabTimeoutRef.current) {
      clearTimeout(privateTabTimeoutRef.current);
    }
    privateTabTimeoutRef.current = setTimeout(() => {
      didRouteToPrivateRef.current = false;
      privateTabTimeoutRef.current = null;
    }, 1000);
  };

  const handleMessagesTabPress = (e: any) => {
    e.preventDefault();
    router.replace('/(main)/(tabs)/messages' as any);
  };

  return (
    <AppErrorBoundary name="MainTabs">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textLight,
          tabBarAllowFontScaling: false,
          tabBarLabelStyle: { fontSize: 10 },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: "Discover",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="flame" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            title: "Vibes",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sparkles" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="confessions"
          options={{
            title: "Confess",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="megaphone" size={size} color={color} />
            ),
            tabBarBadge: confessBadgeCount > 0 ? confessBadgeCount : undefined,
            tabBarBadgeStyle: { backgroundColor: COLORS.primary, fontSize: 10 },
          }}
        />
        <Tabs.Screen
          name="nearby"
          options={{
            title: "Nearby",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="location" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: "Messages",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubbles" size={size} color={color} />
            ),
            tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
            tabBarBadgeStyle: { backgroundColor: COLORS.primary, fontSize: 10 },
          }}
          listeners={{
            tabPress: handleMessagesTabPress,
          }}
        />
        <Tabs.Screen
          name="incognito"
          options={{
            title: "Private",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="eye-off" size={size} color={color} />
            ),
          }}
          listeners={{
            tabPress: handlePrivateTabPress,
          }}
        />
        {/*
          Profile route is preserved for navigation from header avatar buttons,
          but hidden from the bottom tab bar via `href: null`. The route file
          `app/(main)/(tabs)/profile.tsx` remains intact and is opened via
          `router.push('/(main)/(tabs)/profile')` from <HeaderAvatarButton />.
        */}
        <Tabs.Screen
          name="profile"
          options={{
            href: null,
          }}
        />
      </Tabs>
    </AppErrorBoundary>
  );
}
