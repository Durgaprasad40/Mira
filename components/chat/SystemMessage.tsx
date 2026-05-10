import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { CHAT_DENSITY, CHAT_TYPOGRAPHY } from '@/lib/chatTypography';

const SYSTEM_NOTICE_TEXT_PROPS = {
  maxFontSizeMultiplier: CHAT_TYPOGRAPHY.systemNotice.maxFontSizeMultiplier,
} as const;

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
  compact?: boolean;
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

export function SystemMessage({ text, subtype, compact = false }: SystemMessageProps) {
  const iconInfo = subtype ? SUBTYPE_ICONS[subtype] : null;

  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      {iconInfo && (
        <Ionicons
          name={iconInfo.name}
          size={13}
          color={iconInfo.color}
          style={styles.icon}
        />
      )}
      <Text {...SYSTEM_NOTICE_TEXT_PROPS} style={[styles.text, compact && styles.compactText]}>{text}</Text>
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
    marginVertical: CHAT_DENSITY.systemMessageMargin,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    gap: 5,
  },
  compactContainer: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginVertical: 4,
  },
  icon: {
    marginRight: 2,
  },
  text: {
    fontSize: CHAT_TYPOGRAPHY.systemNotice.fontSize,
    lineHeight: CHAT_TYPOGRAPHY.systemNotice.lineHeight,
    color: COLORS.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  compactText: {
    lineHeight: 15,
  },
});
