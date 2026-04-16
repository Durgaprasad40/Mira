import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';

/**
 * Legacy Phase-1 route.
 *
 * The in-app "Report a person" entry point now uses the structured flow under:
 * `/(main)/settings/report-person`.
 *
 * We keep this screen to make direct navigation/deep-links safe by redirecting.
 */
export default function ReportUserLegacyRoute() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/(main)/settings/report-person' as any);
  }, [router]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={styles.title}>Redirecting…</Text>
        <Text style={styles.subtitle}>Opening the updated reporting flow.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});

