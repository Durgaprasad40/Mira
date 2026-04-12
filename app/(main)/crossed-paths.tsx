/**
 * CROSSED PATHS - BLOCKED
 *
 * This feature is temporarily blocked due to wrong backend args:
 * - api.crossPaths.getCrossedPaths: expects { userId } but gets { token, refreshKey }
 * - api.crossPaths.hideCrossedPath: expects { authUserId, historyId } but gets { token, ... }
 *
 * DO NOT REMOVE this blocking code until backend is fixed.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

export default function CrossedPathsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', 'crossed_paths');
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={COLORS.text} />
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="footsteps-outline" size={64} color={COLORS.primary} />
        </View>
        <Text style={styles.title}>Crossed Paths</Text>
        <Text style={styles.subtitle}>Coming Soon</Text>
        <Text style={styles.description}>
          See people you've crossed paths with. This feature is being enhanced.
        </Text>
        <TouchableOpacity style={styles.goBackBtn} onPress={() => router.back()}>
          <Text style={styles.goBackText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  backButton: { position: 'absolute', top: 60, left: 16, zIndex: 10, padding: 8 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  iconContainer: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 18, fontWeight: '600', color: COLORS.primary, marginBottom: 16 },
  description: { fontSize: 14, color: COLORS.textLight, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  goBackBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
  goBackText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
