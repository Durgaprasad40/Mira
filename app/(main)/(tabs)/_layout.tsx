/*
 * LOCKED (PHASE-1 TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 * Nearby tab is the only Phase-1 tab currently unlocked.
 */
import { useEffect, useRef, useMemo } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { stringToUserId } from "@/convex/helpers";
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
import { markTiming } from "@/utils/startupTiming";

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
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  const unreadChats = isDemoMode ? demoUnreadCount : (convexUnreadCount ?? 0);

  // Tagged confession badge count (convexUserId already defined above)
  const convexTaggedCount = useQuery(
    api.confessions.getTaggedConfessionBadgeCount,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Demo mode: use store for tagged count (count confessions targeting current user)
  const demoTaggedCount = useConfessionStore((s) => {
    if (!isDemoMode) return 0;
    // Count tagged confessions in demo store
    return s.confessions.filter((c) => c.targetUserId === currentUserId).length;
  });

  const taggedBadgeCount = isDemoMode ? demoTaggedCount : (convexTaggedCount || 0);

  // Query deletion state for Private tab entry gating (non-demo mode)
  const privateDeletionState = useQuery(
    api.privateDeletion.getPrivateDeletionState,
    !isDemoMode && userId ? { userId: stringToUserId(userId) } : 'skip'
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

  // STABILITY FIX: Boot readiness guard to prevent hydration race condition
  // Ensures auth state, onboarding state, and route decision state are ready
  // before any navigation decisions are made
  const isBootReady = useBootStore((s) => s.isBootReady());

  // Guard: prevent premature navigation if boot not ready
  if (!isBootReady) {
    return null;
  }

  // Handle Private tab press - navigate on user tap only
  const handlePrivateTabPress = (e: any) => {
    // Prevent default tab navigation (we handle it manually)
    e.preventDefault();

    // P2-001 FIX: Wait for store hydration before routing
    // Prevents mis-routing to onboarding when store hasn't loaded persisted state yet
    if (!privateStoreHydrated) {
      if (__DEV__) console.log('[PRIVATE TAP] ignored: not hydrated');
      return;
    }

    // N-001/C-004 FIX: Prevent duplicate navigation during same component lifecycle
    // This guards against rapid state changes triggering multiple router.replace calls
    if (didRouteToPrivateRef.current) {
      if (__DEV__) console.log('[PRIVATE TAP] ignored: already routed');
      return;
    }
    didRouteToPrivateRef.current = true;

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
      router.replace('/(main)/(private)/(tabs)' as any);
    } else {
      if (__DEV__) console.log('[PRIVATE TAP] pressed -> onboarding (direct)');
      router.replace('/(main)/phase2-onboarding' as any);
    }

    // N-001/C-004: Reset guard after navigation settles (allows future taps after returning)
    setTimeout(() => { didRouteToPrivateRef.current = false; }, 1000);
  };

  return (
    <AppErrorBoundary name="MainTabs">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textLight,
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
            title: "Explore",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="search" size={size} color={color} />
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
            tabBarBadge: taggedBadgeCount > 0 ? taggedBadgeCount : undefined,
            tabBarBadgeStyle: { backgroundColor: COLORS.primary, fontSize: 10 },
          }}
        />
        {/* FROZEN: Nearby tab hidden for stability (2026-03-06) */}
        {/* To restore: remove href: null below */}
        <Tabs.Screen
          name="nearby"
          options={{
            title: "Nearby",
            href: null, // FROZEN: hides tab from tab bar
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
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </AppErrorBoundary>
  );
}
