import { useEffect, useRef, useMemo } from "react";
import { Tabs, useRouter } from "expo-router";
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
import { asUserId } from "@/convex/id";
import { AppErrorBoundary, registerErrorBoundaryNavigation } from "@/components/safety";
import { processThreadsIntegrity } from "@/lib/threadsIntegrity";
import { markTiming, printStartupPerfReport } from "@/utils/startupTiming";
import {
  schedulePostFirstPaint,
  registerStartupTask,
} from "@/utils/startupCoordinator";
import { applyDemoDataCaps } from "@/utils/demoDataCaps";

// Register startup tasks once at module load (runs after first paint)
if (isDemoMode) {
  registerStartupTask({
    name: 'applyDemoDataCaps',
    fn: applyDemoDataCaps,
    critical: false,
  });
}

registerStartupTask({
  name: 'printStartupPerfReport',
  fn: printStartupPerfReport,
  critical: false,
});

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

  // Schedule post-first-paint tasks (data caps, perf report, etc.)
  // Runs once after InteractionManager settles + 500ms delay
  useEffect(() => {
    schedulePostFirstPaint();
  }, []);

  // Register navigation for error boundary "Go Home" button
  useEffect(() => {
    registerErrorBoundaryNavigation(() => {
      router.replace('/(main)/(tabs)/home');
    });
  }, [router]);
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = userId || 'demo_user_1';
  const convexUserId = asUserId(currentUserId);

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
        />
        <Tabs.Screen
          name="incognito"
          options={{
            title: "Private",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="eye-off" size={size} color={color} />
            ),
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
