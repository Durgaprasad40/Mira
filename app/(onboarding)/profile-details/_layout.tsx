import { Stack } from 'expo-router';

export default function ProfileDetailsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="lifestyle" />
      <Stack.Screen name="education-religion" />
    </Stack>
  );
}
