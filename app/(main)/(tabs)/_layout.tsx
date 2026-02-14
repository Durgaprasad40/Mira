import { useEffect, useRef, useMemo } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COLORS } from "@/lib/constants";
import { isDemoMode } from "@/hooks/useConvex";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";
import { useDemoDmStore } from "@/stores/demoDmStore";
import { useConfessionStore } from "@/stores/confessionStore";
import { useLocationStore } from "@/stores/locationStore";
import { asUserId } from "@/convex/id";
import { AppErrorBoundary, registerErrorBoundaryNavigation } from "@/components/safety";
import { processThreadsIntegrity } from "@/lib/threadsIntegrity";
import { markTiming } from "@/utils/startupTiming";

export default function MainTabsLayout() {
  // Milestone E: first tab screen mounted
  markTiming('first_tab');

  const router = useRouter();
  const locationPrewarmed = useRef(false);
  const startLocationTracking = useLocationStore((s) => s.startLocationTracking);

  // Prewarm location on app boot — so Nearby tab opens instantly
  useEffect(() => {
    if (!locationPrewarmed.current) {
      locationPrewarmed.current = true;
      startLocationTracking();
    }
  }, [startLocationTracking]);

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
  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);
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
