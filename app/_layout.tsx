import { useEffect } from "react";
import { Stack } from "expo-router";
import { ConvexProvider, useMutation } from "convex/react";
import { convex, isDemoMode } from "@/hooks/useConvex";
import { View, Text, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Camera } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { collectDeviceFingerprint } from "@/lib/deviceFingerprint";

function DemoBanner() {
  if (!isDemoMode) return null;

  return (
    <View style={styles.demoBanner}>
      <Text style={styles.demoText}>
        🎮 DEMO MODE - Run "npx convex dev" to connect backend
      </Text>
    </View>
  );
}

function DeviceFingerprintCollector() {
  const { userId } = useAuthStore();
  const registerFingerprint = useMutation(api.deviceFingerprint.registerDeviceFingerprint);

  useEffect(() => {
    if (isDemoMode || !userId) return;

    (async () => {
      try {
        const data = await collectDeviceFingerprint();
        await registerFingerprint({
          userId: userId as any,
          ...data,
        });
      } catch {
        // Silent failure — fingerprinting is non-critical
      }
    })();
  }, [userId]);

  return null;
}

export default function RootLayout() {
  useEffect(() => {
    (async () => {
      await Camera.requestCameraPermissionsAsync();
      await Camera.requestMicrophonePermissionsAsync();
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    })();
  }, []);

  return (
    <ConvexProvider client={convex}>
      <StatusBar style="light" />
      <DemoBanner />
      <DeviceFingerprintCollector />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(main)" />
      </Stack>
    </ConvexProvider>
  );
}

const styles = StyleSheet.create({
  demoBanner: {
    backgroundColor: "#FF6B6B",
    padding: 8,
    alignItems: "center",
  },
  demoText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
});
