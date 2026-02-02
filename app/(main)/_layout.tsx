import { Redirect, Stack } from "expo-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthStore } from "@/stores/authStore";
import { isDemoMode } from "@/hooks/useConvex";
import { computeEnforcementLevel } from "@/lib/securityEnforcement";

export default function MainLayout() {
  const { userId } = useAuthStore();

  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : "skip"
  );

  // Security gate — render-based, no useEffect redirect loop.
  // If enforcement level is "security_only" we render ONLY the
  // verification screen; the user cannot navigate anywhere else
  // until they verify.
  if (!isDemoMode && currentUser) {
    const level =
      currentUser.verificationEnforcementLevel ||
      computeEnforcementLevel({
        createdAt: currentUser.createdAt,
        verificationStatus:
          (currentUser.verificationStatus as any) || "unverified",
      });

    if (level === "security_only") {
      return <Redirect href={"/(main)/verification" as any} />;
    }
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="match-celebration"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="boost" options={{ presentation: "modal" }} />
      <Stack.Screen name="crossed-paths" />
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
    </Stack>
  );
}
