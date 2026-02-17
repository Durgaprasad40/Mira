import { Stack } from 'expo-router';
import { ToastHost } from '@/components/ui/Toast';

export default function OnboardingLayout() {
  return (
    <>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="email-phone" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="password" />
      <Stack.Screen name="basic-info" />
      <Stack.Screen name="consent" />
      <Stack.Screen name="photo-upload" />
      <Stack.Screen name="face-verification" />
      <Stack.Screen name="additional-photos" />
      <Stack.Screen name="bio" />
      <Stack.Screen name="prompts" />
      <Stack.Screen name="profile-details" />
      <Stack.Screen name="preferences" />
      <Stack.Screen name="permissions" />
      <Stack.Screen name="review" />
      <Stack.Screen name="tutorial" />
    </Stack>
    <ToastHost />
    </>
  );
}

