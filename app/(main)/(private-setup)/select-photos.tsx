import React, { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

// Legacy Phase-2 onboarding photo route.
// Keep this as a surgical redirect so any stale links land on the active
// photo-selection screen inside the Phase-2 onboarding stack.
export default function LegacySelectPhotosRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/(main)/phase2-onboarding/photo-select" as any);
  }, [router]);

  return <View style={{ flex: 1, backgroundColor: "#0B1116" }} />;
}
