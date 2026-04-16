import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Slot, useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

export default function AdminLayout() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);

  const adminCheck = useQuery(
    api.users.checkIsAdmin,
    !isDemoMode && userId ? { userId } : 'skip'
  );

  if (isDemoMode) {
    return <Slot />;
  }

  // Loading state while admin status resolves
  if (userId && adminCheck === undefined) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Checking access…</Text>
      </View>
    );
  }

  const isAdmin = adminCheck?.isAdmin === true;

  if (!userId || !isAdmin) {
    return (
      <View style={styles.container}>
        <Ionicons name="lock-closed" size={64} color={COLORS.textLight} />
        <Text style={styles.title}>Not authorized</Text>
        <Text style={styles.subtitle}>Admin access is required to view moderation tools.</Text>
        <TouchableOpacity style={styles.goBackButton} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.goBackText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <Slot />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textLight,
  },
  title: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  goBackButton: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  goBackText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

