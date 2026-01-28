import { Stack } from "expo-router";

export default function MainLayout() {
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
      <Stack.Screen name="settings" />
      <Stack.Screen name="subscription" options={{ presentation: "modal" }} />
    </Stack>
  );
}
