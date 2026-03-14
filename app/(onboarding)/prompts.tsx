/**
 * LEGACY REDIRECT: prompts.tsx -> prompts-part1.tsx
 *
 * This file redirects to the new 2-page prompt system.
 * The old single-page prompt system has been replaced with:
 * - prompts-part1.tsx: Seed questions (identity, social battery, values)
 * - prompts-part2.tsx: Section prompts (builder, performer, seeker, grounded)
 *
 * This redirect ensures backward compatibility for any existing navigation.
 */
import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '@/lib/constants';

export default function PromptsRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  useEffect(() => {
    // Redirect to new prompts-part1 with any query params preserved
    const queryString = params.editFromReview ? '?editFromReview=true' : '';
    if (__DEV__) console.log('[ONB] prompts -> prompts-part1 (redirect)');
    router.replace(`/(onboarding)/prompts-part1${queryString}` as any);
  }, []);

  // Show loading indicator while redirecting
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
