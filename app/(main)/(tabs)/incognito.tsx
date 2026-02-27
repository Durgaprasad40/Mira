import React from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

/**
 * Private Tab Placeholder
 *
 * This screen is a placeholder that should never be visible to users.
 * Navigation to Private/Phase-2 is handled by the tab press listener
 * in _layout.tsx which intercepts the tap and navigates directly.
 *
 * If this screen is ever shown, it means the tab press interception failed.
 */
export default function PrivateTabPlaceholder() {
  if (__DEV__) {
    console.log('[PrivateTabPlaceholder] rendered (should not happen normally)');
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={C.primary} />
      <Text style={styles.hint}>Loading Private...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    marginTop: 12,
    fontSize: 14,
    color: C.textLight,
  },
});
