import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

type SystemSubtype =
  | 'screenshot_taken'
  | 'screenshot_attempted'
  | 'access_requested'
  | 'permission_granted'
  | 'permission_revoked'
  | 'expired';

interface SystemMessageProps {
  text: string;
  subtype?: SystemSubtype;
}

const SUBTYPE_ICONS: Record<string, { name: string; color: string }> = {
  screenshot_taken: { name: 'camera', color: '#FF9800' },
  screenshot_attempted: { name: 'camera-outline', color: '#FF9800' },
  access_requested: { name: 'key-outline', color: COLORS.primary },
  permission_granted: { name: 'lock-open-outline', color: '#4CAF50' },
  permission_revoked: { name: 'lock-closed-outline', color: '#F44336' },
  expired: { name: 'timer-outline', color: COLORS.textMuted },
};

export function SystemMessage({ text, subtype }: SystemMessageProps) {
  const iconInfo = subtype ? SUBTYPE_ICONS[subtype] : null;

  return (
    <View style={styles.container}>
      {iconInfo && (
        <Ionicons
          name={iconInfo.name as any}
          size={13}
          color={iconInfo.color}
          style={styles.icon}
        />
      )}
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginVertical: 6,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    gap: 5,
  },
  icon: {
    marginRight: 2,
  },
  text: {
    fontSize: 12,
    color: COLORS.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
