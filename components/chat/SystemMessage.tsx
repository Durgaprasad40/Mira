import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

export type SystemSubtype =
  | 'screenshot_taken'
  | 'screenshot_attempted'
  | 'access_requested'
  | 'permission_granted'
  | 'permission_revoked'
  | 'expired'
  // P2-TOD-CHAT-EVENTS: Phase-2 Truth-or-Dare in-chat event chips.
  // 'tod_perm' stays in transcript; 'tod_temp' is hidden by MessageBubble
  // 5 minutes after the viewer's readAt is set. Phase-1 'truthdare' marker
  // path is unchanged.
  | 'tod_perm'
  | 'tod_temp'
  | 'truthdare';

interface SystemMessageProps {
  text: string;
  subtype?: SystemSubtype;
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const SUBTYPE_ICONS: Record<SystemSubtype, { name: IoniconName; color: string }> = {
  screenshot_taken: { name: 'camera', color: '#FF9800' },
  screenshot_attempted: { name: 'camera-outline', color: '#FF9800' },
  access_requested: { name: 'key-outline', color: COLORS.primary },
  permission_granted: { name: 'lock-open-outline', color: '#4CAF50' },
  permission_revoked: { name: 'lock-closed-outline', color: '#F44336' },
  expired: { name: 'timer-outline', color: COLORS.textMuted },
  truthdare: { name: 'dice', color: COLORS.secondary },
  // P2-TOD-CHAT-EVENTS: reuse the dice icon for both Phase-2 T/D event
  // chips so the visual language matches the existing 'truthdare' marker.
  tod_perm: { name: 'dice', color: COLORS.secondary },
  tod_temp: { name: 'dice', color: COLORS.secondary },
};

export function SystemMessage({ text, subtype }: SystemMessageProps) {
  const iconInfo = subtype ? SUBTYPE_ICONS[subtype] : null;

  return (
    <View style={styles.container}>
      {iconInfo && (
        <Ionicons
          name={iconInfo.name}
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
