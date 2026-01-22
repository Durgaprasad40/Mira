import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

interface AvatarProps {
  uri?: string | null;
  size?: number;
  style?: ViewStyle;
  showVerified?: boolean;
  showOnline?: boolean;
}

export function Avatar({
  uri,
  size = 48,
  style,
  showVerified = false,
  showOnline = false,
}: AvatarProps) {
  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View
          style={[
            styles.placeholder,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Ionicons name="person" size={size * 0.5} color={COLORS.textMuted} />
        </View>
      )}

      {showVerified && (
        <View style={[styles.badge, styles.verifiedBadge]}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.secondary} />
        </View>
      )}

      {showOnline && (
        <View style={[styles.badge, styles.onlineBadge]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  image: {
    backgroundColor: COLORS.backgroundDark,
  },
  placeholder: {
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
  verifiedBadge: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
  },
  onlineBadge: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.success,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
});
