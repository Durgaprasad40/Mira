import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

export default function LegacyPrivateProfileRedirectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useLocalSearchParams<{ userId?: string }>();

  useEffect(() => {
    if (!userId) {
      router.replace('/(main)/(private)/(tabs)/private-profile' as any);
      return;
    }

    router.replace(`/(main)/(private)/p2-profile/${userId}` as any);
  }, [router, userId]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ActivityIndicator size="large" color={C.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.background,
  },
});
