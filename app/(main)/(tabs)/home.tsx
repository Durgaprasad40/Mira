/*
 * LOCKED (DISCOVER TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 *
 * EXCEPTION: Profile Completion Banner (Phase-1) - non-blocking, additive only
 */
import { View, StyleSheet } from "react-native";
import { DiscoverCardStack } from "@/components/screens/DiscoverCardStack";
import { useScreenTrace } from "@/lib/devTrace";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { useDemoStore } from "@/stores/demoStore";
import { isDemoMode } from "@/hooks/useConvex";
import { ProfileCompletionCard } from "@/components/profile/ProfileCompletionCard";
import { getProfileCompletion } from "@/lib/profileCompletion";
import { getDemoCurrentUser } from "@/lib/demoData";
import { useState } from "react";

export default function HomeScreen() {
  useScreenTrace("HOME");

  const userId = useAuthStore((s) => s.userId);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Get user data for completion check
  const convexUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  // Demo mode user
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoUserProfile = isDemoMode && currentDemoUserId && demoHydrated
    ? demoProfiles[currentDemoUserId]
    : null;
  const demoUserBase = isDemoMode ? getDemoCurrentUser() : null;

  // Build user data for completion check
  const userData = isDemoMode
    ? (demoUserProfile || demoUserBase)
    : convexUser;

  // Calculate completion
  const completion = getProfileCompletion(userData as any);

  // Show compact banner if profile < 60% and not dismissed
  const showBanner = !bannerDismissed && completion.percentage < 60;

  return (
    <View style={styles.container}>
      {/* Profile Completion Banner - only for low completion */}
      {showBanner && (
        <View style={styles.bannerContainer}>
          <ProfileCompletionCard
            userData={userData as any}
            compact={true}
            onDismiss={() => setBannerDismissed(true)}
          />
        </View>
      )}

      {/* Main Discover Stack */}
      <View style={styles.stackContainer}>
        <DiscoverCardStack />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bannerContainer: {
    position: 'absolute',
    top: 100, // Below header
    left: 0,
    right: 0,
    zIndex: 10,
  },
  stackContainer: {
    flex: 1,
  },
});
