import { Stack } from 'expo-router';

export default function PrivateSetupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="select-photos" />
      <Stack.Screen name="blur-preview" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="activate" />
    </Stack>
  );
}
