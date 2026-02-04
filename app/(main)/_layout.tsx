import { useEffect, useRef } from "react";
import { View } from "react-native";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { computeEnforcementLevel } from "@/lib/securityEnforcement";
import { ToastHost } from "@/components/ui/Toast";

export default function MainLayout() {
  const userId = useAuthStore((s) => s.userId);
  const didRedirect = useRef(false);

  // ── Navigation hooks ──
  // useRouter() returns a new object on every navigation state change.
  // Store it in a ref so the verification effect doesn't re-run from
  // router identity changes alone.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  // These subscribe to navigation state → re-render MainLayout on every
  // nav event. segmentsKey is derived as a stable string for the effect.
  const segments = useSegments();
  const rootNavState = useRootNavigationState();

  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : "skip"
  );

  // Security gate — guarded one-shot redirect.
  const needsVerification = !isDemoMode && currentUser && (() => {
    const level =
      currentUser.verificationEnforcementLevel ||
      computeEnforcementLevel({
        createdAt: currentUser.createdAt,
        verificationStatus:
          (currentUser.verificationStatus as any) || "unverified",
      });
    return level === "security_only";
  })();

  const segmentsKey = segments.join("/");

  useEffect(() => {
    if (didRedirect.current) return;
    if (isDemoMode) return;
    if (!rootNavState?.key) return;
    if (!needsVerification) return;

    if (segmentsKey.includes("(main)/verification")) {
      didRedirect.current = true;
      return;
    }

    didRedirect.current = true;
    routerRef.current.replace("/(main)/verification" as any);
  }, [needsVerification, rootNavState?.key, segmentsKey]);

  return (
    <View style={{ flex: 1 }}>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="match-celebration"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="boost" options={{ presentation: "modal" }} />
      <Stack.Screen name="crossed-paths" />
      <Stack.Screen name="discover" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="likes" />
      <Stack.Screen name="notifications" />
      <Stack.Screen
        name="pre-match-message"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen name="profile/[id]" />
      <Stack.Screen name="private-profile/[userId]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="subscription" options={{ presentation: "modal" }} />
      <Stack.Screen
        name="incognito-create-tod"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen name="prompt-thread" />
      <Stack.Screen name="confession-thread" />
      <Stack.Screen
        name="compose-confession"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="confession-chat"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="person-picker"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen
        name="stand-out"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen name="explore-category/[categoryId]" />
      <Stack.Screen name="chat-room/[roomId]" />
      <Stack.Screen
        name="camera-composer"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="incognito-chat" />
      <Stack.Screen name="incognito-room/[id]" />
      <Stack.Screen name="(private)" options={{ headerShown: false }} />
      <Stack.Screen
        name="(private-setup)"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="verification"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="demo-panel" options={{ presentation: "modal" }} />
    </Stack>
    <ToastHost />
    </View>
  );
}
