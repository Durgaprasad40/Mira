/*
 * LOCKED (EXPLORE COMPATIBILITY ROUTE)
 * This route intentionally redirects to Discover in Browse mode.
 * Keep it lightweight and compatibility-only unless Durga Prasad explicitly unlocks it.
 */
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { COLORS } from "@/lib/constants";
import {
  DISCOVER_MODE_STORAGE_KEY,
} from "@/components/discover/DiscoverUnifiedSurface";

export default function ExploreCompatibilityScreen() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.setItem(DISCOVER_MODE_STORAGE_KEY, "browse")
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          router.replace("/(main)/(tabs)/home" as any);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={COLORS.primary} />
      <Text style={styles.text}>Opening Browse in Discover…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: COLORS.background,
  },
  text: {
    fontSize: 14,
    color: COLORS.textLight,
  },
});
