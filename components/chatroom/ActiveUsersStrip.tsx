import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';

interface ActiveUser {
  id: string;
  avatar?: string;
  isOnline: boolean;
}

interface ActiveUsersStripProps {
  users: ActiveUser[];
  /** Called when the entire strip is pressed (opens members list) */
  onPress?: () => void;
  theme?: 'light' | 'dark';
}

const MAX_VISIBLE = 6;

export default function ActiveUsersStrip({
  users,
  onPress,
  theme = 'light',
}: ActiveUsersStripProps) {
  const C = theme === 'dark' ? INCOGNITO_COLORS : COLORS as any;
  const onlineUsers = users.filter((u) => u.isOnline);

  if (onlineUsers.length === 0) return null;

  const visible = onlineUsers.slice(0, MAX_VISIBLE);
  const extraCount = onlineUsers.length - MAX_VISIBLE;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { borderBottomColor: theme === 'dark' ? C.surface : C.border },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, { color: theme === 'dark' ? C.textLight : C.textMuted }]}>
        Active members
      </Text>
      <View style={styles.avatarsRow}>
        {visible.map((user) => (
          <View key={user.id} style={styles.avatarWrapper}>
            {user.avatar ? (
              <Image
                source={{ uri: user.avatar }}
                style={styles.avatar}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: theme === 'dark' ? C.accent : C.backgroundDark }]}>
                <Ionicons name="person" size={14} color={C.textLight} />
              </View>
            )}
            <View style={styles.onlineDot} />
          </View>
        ))}
        {extraCount > 0 && (
          <View style={[styles.moreCircle, { backgroundColor: theme === 'dark' ? C.accent : C.backgroundDark }]}>
            <Text style={[styles.moreText, { color: C.textLight }]}>+{extraCount}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 11,
    marginRight: 8,
  },
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00B894',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  moreCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
