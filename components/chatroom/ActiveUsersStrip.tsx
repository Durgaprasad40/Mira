import React, { useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';
import { CHAT_SIZES, CHAT_FONTS, SPACING, SIZES, GENDER_COLORS } from '@/lib/responsive';

interface ActiveUser {
  id: string;
  avatar?: string;
  isOnline: boolean;
  /** Timestamp when user joined - used for stable time-based sorting (oldest first) */
  joinedAt?: number;
  /** User's gender for avatar border color */
  gender?: 'male' | 'female' | 'other';
}

interface ActiveUsersStripProps {
  users: ActiveUser[];
  /** Called when the entire strip is pressed (opens members list) */
  onPress?: () => void;
  theme?: 'light' | 'dark';
  /** Hide the "X members" label - for room screen showing online-only */
  hideLabel?: boolean;
}

const MAX_VISIBLE = 6;
const AVATAR_SIZE = CHAT_SIZES.stripAvatar;

export default function ActiveUsersStrip({
  users,
  onPress,
  theme = 'light',
  hideLabel = false,
}: ActiveUsersStripProps) {
  const C = theme === 'dark' ? INCOGNITO_COLORS : COLORS as any;
  const isDark = theme === 'dark';

  // STABILITY FIX: Sort users by joinedAt timestamp (oldest first)
  // Falls back to ID comparison for determinism when timestamps are equal/missing
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const aTime = a.joinedAt ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.joinedAt ?? Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime; // Oldest first
      return a.id.localeCompare(b.id); // Fallback for determinism
    });
  }, [users]);

  // Don't render if no users (especially for online-only mode)
  if (sortedUsers.length === 0) return null;

  const visible = sortedUsers.slice(0, MAX_VISIBLE);
  const extraCount = sortedUsers.length - MAX_VISIBLE;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : C.border },
        pressed && styles.pressed,
      ]}
    >
      {/* Left: Label - hidden in room screen online-only mode */}
      {!hideLabel && (
        <Text style={[styles.label, { color: isDark ? C.textLight : C.textMuted }]}>
          {sortedUsers.length} {sortedUsers.length === 1 ? 'online' : 'online'}
        </Text>
      )}

      {/* Avatars row */}
      <View style={styles.avatarsRow}>
        {visible.map((user) => {
          // AVATAR-BORDER-FIX: Use gender-based colors for consistency across all surfaces
          const ringColor = GENDER_COLORS[user.gender || 'default'];
          return (
          <View key={user.id} style={styles.avatarWrapper}>
            {user.avatar ? (
              <Image
                source={{ uri: user.avatar }}
                style={[
                  styles.avatar,
                  { borderColor: ringColor },
                ]}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.avatarFallback,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : C.backgroundDark,
                    borderColor: ringColor,
                  },
                ]}
              >
                <Ionicons name="person" size={12} color={isDark ? C.textLight : C.textMuted} />
              </View>
            )}
            {user.isOnline && <View style={[styles.onlineDot, { borderColor: isDark ? '#1F1F2E' : '#FFFFFF' }]} />}
          </View>
        );
        })}
        {extraCount > 0 && (
          <View
            style={[
              styles.moreCircle,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : C.backgroundDark,
              },
            ]}
          >
            <Text style={[styles.moreText, { color: isDark ? C.textLight : C.textMuted }]}>
              +{extraCount}
            </Text>
          </View>
        )}
      </View>

      {/* Chevron */}
      <Ionicons
        name="chevron-forward"
        size={16}
        color={isDark ? 'rgba(255,255,255,0.3)' : C.textMuted}
      />
    </Pressable>
  );
}

// P0-002 FIX: Use responsive sizing for strip height
const STRIP_HEIGHT = SIZES.button.md;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: STRIP_HEIGHT,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING.sm + 2,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    // P0-002 FIX: Responsive font size
    fontSize: CHAT_FONTS.label,
    fontWeight: '500',
  },
  avatarsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1.5,
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    borderWidth: 1.5,
  },
  moreCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    // P0-002 FIX: Responsive font size
    fontSize: CHAT_FONTS.secondary,
    fontWeight: '600',
  },
});
