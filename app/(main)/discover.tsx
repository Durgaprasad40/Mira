import React, { useCallback } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { DiscoverFeed } from "@/components/screens/DiscoverFeed";
import { COLORS } from "@/lib/constants";

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Handle opening Phase-1 public profile from Discover card
  const handleOpenProfile = useCallback((profileId: string) => {
    if (!profileId) {
      if (__DEV__) {
        console.warn('[P1_PROFILE_OPEN] Missing profileId, cannot navigate');
      }
      return;
    }

    // Log navigation for debugging
    if (__DEV__) {
      console.log('[P1_PROFILE_OPEN]', {
        profileId,
        route: `/(main)/profile/${profileId}`,
      });
    }

    // Navigate to Phase-1 public profile
    router.push(`/(main)/profile/${profileId}` as any);
  }, [router]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: COLORS.background }}>
      <DiscoverFeed onOpenProfile={handleOpenProfile} />
    </View>
  );
}
