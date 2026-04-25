import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { COLORS } from '@/lib/constants';
import { getPrimaryPhotoUrl } from '@/lib/photoUtils';

interface ProfileCardProps {
  profile: any;
  onPress: () => void;
  width?: number;
  height?: number;
}

export function ProfileCard({ profile, onPress, width = 140, height = 180 }: ProfileCardProps) {
  const distance =
    typeof profile.distanceKm === 'number'
      ? profile.distanceKm
      : typeof profile.distance === 'number'
        ? profile.distance
        : undefined;

  const photoUrl = getPrimaryPhotoUrl(profile.photos);

  return (
    <TouchableOpacity
      style={[styles.card, { width, height }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={styles.avatar}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>
            {(profile.name ?? '?')[0].toUpperCase()}
          </Text>
        </View>
      )}
      <Text style={styles.name} numberOfLines={1}>
        {profile.name}, {profile.age}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {profile.city ?? ''}
        {distance != null ? ` · ${distance} km` : ''}
      </Text>
      {profile.bio ? (
        <Text style={styles.bio} numberOfLines={2}>
          {profile.bio}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
    padding: 12,
    justifyContent: 'flex-start',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 8,
    backgroundColor: COLORS.border,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  meta: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  bio: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    lineHeight: 16,
  },
});
