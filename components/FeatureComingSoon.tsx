/**
 * FEATURE COMING SOON - Blocking Component
 *
 * Used to temporarily block access to broken Phase-2 features
 * while backend implementation is in progress.
 *
 * DO NOT REMOVE - This prevents app crashes from missing API functions.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

interface FeatureComingSoonProps {
  featureName: string;
  featureKey: string;
  description?: string;
  showBackButton?: boolean;
  iconName?: keyof typeof Ionicons.glyphMap;
}

export default function FeatureComingSoon({
  featureName,
  featureKey,
  description = 'This feature is being built and will be available soon.',
  showBackButton = true,
  iconName = 'construct-outline',
}: FeatureComingSoonProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Log blocked feature access in dev mode
  if (__DEV__) {
    console.log('[BLOCKED FEATURE]', featureKey, { featureName, timestamp: Date.now() });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {showBackButton && (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
      )}

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name={iconName} size={64} color={C.primary} />
        </View>

        <Text style={styles.title}>{featureName}</Text>
        <Text style={styles.subtitle}>Coming Soon</Text>
        <Text style={styles.description}>{description}</Text>

        {showBackButton && (
          <TouchableOpacity
            style={styles.goBackBtn}
            onPress={() => router.back()}
          >
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: 16,
    zIndex: 10,
    padding: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.primary,
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  goBackBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  goBackText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
