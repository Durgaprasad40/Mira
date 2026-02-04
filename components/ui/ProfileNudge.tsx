/**
 * ProfileNudge — a small, dismissible banner encouraging profile completion.
 *
 * Variants:
 *  - 'banner'  : compact row with icon + text + dismiss X (Discover, Messages)
 *  - 'inline'  : borderless info line for embedding under headers (Settings)
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

interface ProfileNudgeProps {
  message: string;
  variant?: 'banner' | 'inline';
  onDismiss?: () => void;
}

export function ProfileNudge({ message, variant = 'banner', onDismiss }: ProfileNudgeProps) {
  if (variant === 'inline') {
    return (
      <View style={styles.inlineContainer}>
        <Ionicons name="information-circle-outline" size={16} color={COLORS.primary} />
        <Text style={styles.inlineText}>{message}</Text>
        {onDismiss && (
          <TouchableOpacity onPress={onDismiss} hitSlop={8}>
            <Ionicons name="close" size={14} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.bannerContainer}>
      <Ionicons name="sparkles-outline" size={16} color={COLORS.primary} />
      <Text style={styles.bannerText} numberOfLines={1}>{message}</Text>
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss} hitSlop={8} style={styles.dismissBtn}>
          <Ionicons name="close" size={16} color={COLORS.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.primary + '10',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.primary + '30',
    gap: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  dismissBtn: {
    padding: 2,
  },
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  inlineText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textLight,
  },
});
