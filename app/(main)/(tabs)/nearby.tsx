/**
 * FROZEN SCREEN (2026-03-06)
 *
 * Nearby feature is temporarily disabled for stability.
 * This placeholder prevents crashes if the route is somehow reached directly.
 *
 * Original file preserved in git history for restoration.
 * To restore: revert this file to the previous commit.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

export default function NearbyScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.content}>
        <Ionicons name="location-outline" size={64} color={COLORS.textLight} />
        <Text style={styles.title}>Nearby</Text>
        <Text style={styles.subtitle}>This feature is coming soon</Text>
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
    paddingHorizontal: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
  },
});
