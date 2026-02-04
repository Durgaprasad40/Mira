import { useEffect } from "react";
import { Stack } from "expo-router";
import { ConvexProvider, useMutation } from "convex/react";
import { convex, isDemoMode } from "@/hooks/useConvex";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { collectDeviceFingerprint } from "@/lib/deviceFingerprint";

function DemoBanner() {
  return null;
}

function DeviceFingerprintCollector() {
  const userId = useAuthStore((s) => s.userId);
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
  // Permissions are NOT requested here. Each screen that needs camera,
  // microphone, or media library access requests permission at point of
  // use (e.g. AttachmentPopup, camera-composer, photo-upload).
  // Requesting at launch violates App Store guidelines and causes users
  // to deny permissions before they understand why they're needed.

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConvexProvider client={convex}>
        <StatusBar style="light" />
        <DemoBanner />
        <DeviceFingerprintCollector />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="demo-profile" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(main)" options={{ gestureEnabled: false }} />
        </Stack>
      </ConvexProvider>
    </GestureHandlerRootView>
  );
}

