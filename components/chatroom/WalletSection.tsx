import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

interface WalletSectionProps {
  coins: number;
}

export default function WalletSection({ coins }: WalletSectionProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Ionicons name="wallet-outline" size={20} color={C.text} />
        <Text style={styles.label}>Wallet</Text>
      </View>
      <View style={styles.balanceRow}>
        <View style={styles.coinIcon}>
          <Ionicons name="ellipse" size={16} color="#FFD700" />
        </View>
        <Text style={styles.coins}>{coins}</Text>
        <Text style={styles.coinLabel}>coins</Text>
      </View>
      <Text style={styles.hint}>1 message = 1 coin earned</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: C.background,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coinIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coins: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFD700',
  },
  coinLabel: {
    fontSize: 14,
    color: C.textLight,
    marginTop: 2,
  },
  hint: {
    fontSize: 11,
    color: C.textLight,
    fontStyle: 'italic',
  },
});
