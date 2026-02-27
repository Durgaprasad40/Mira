import { Stack } from 'expo-router';

export default function Phase2OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="photo-select" />
      <Stack.Screen name="profile-edit" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="looking-for-edit" />
    </Stack>
  );
}
