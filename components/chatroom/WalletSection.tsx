import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS, lineHeight } from '@/lib/constants';
import { CHAT_FONTS, CHAT_ROOM_MAX_FONT_SCALE, SPACING, SIZES, normalizeFont } from '@/lib/responsive';

const C = INCOGNITO_COLORS;

interface WalletSectionProps {
  coins: number;
}

export default function WalletSection({ coins }: WalletSectionProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Ionicons name="wallet-outline" size={SIZES.icon.md} color={C.text} />
        <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.label}>Wallet</Text>
      </View>
      <View style={styles.balanceRow}>
        <View style={styles.coinIcon}>
          <Ionicons name="ellipse" size={SIZES.icon.sm} color="#FFD700" />
        </View>
        <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.coins}>{coins}</Text>
        <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.coinLabel}>coins</Text>
      </View>
      <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.hint}>Earn coins through genuine conversations.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: C.background,
    borderRadius: SIZES.radius.md,
    padding: SPACING.base,
    gap: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  label: {
    fontSize: CHAT_FONTS.buttonText,
    fontWeight: '700',
    lineHeight: lineHeight(CHAT_FONTS.buttonText, 1.2),
    color: C.text,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + SPACING.xxs,
  },
  coinIcon: {
    width: SIZES.icon.md,
    height: SIZES.icon.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coins: {
    fontSize: normalizeFont(24, { minSize: 22, maxSize: 26 }),
    fontWeight: '800',
    lineHeight: lineHeight(normalizeFont(24, { minSize: 22, maxSize: 26 }), 1.1),
    color: '#FFD700',
  },
  coinLabel: {
    fontSize: CHAT_FONTS.buttonText,
    lineHeight: lineHeight(CHAT_FONTS.buttonText, 1.2),
    color: C.textLight,
    marginTop: SPACING.xxs,
  },
  hint: {
    fontSize: CHAT_FONTS.secondary,
    lineHeight: lineHeight(CHAT_FONTS.secondary, 1.35),
    color: C.textLight,
    fontStyle: 'italic',
  },
});
