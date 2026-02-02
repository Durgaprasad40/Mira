import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { SecretCrush } from '@/types';

interface SecretCrushCardProps {
  crush: SecretCrush;
  onReveal: () => void;
  onDismiss: () => void;
}

function formatTimeLeft(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h left`;
  const minutes = Math.floor(diff / (1000 * 60));
  return `${minutes}m left`;
}

export default function SecretCrushCard({ crush, onReveal, onDismiss }: SecretCrushCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconBadge}>
          <Ionicons name="eye" size={18} color={COLORS.white} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Someone has a confession for you</Text>
          <Text style={styles.timer}>{formatTimeLeft(crush.expiresAt)}</Text>
        </View>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      <Text style={styles.confessionText} numberOfLines={2}>
        "{crush.confessionText}"
      </Text>

      <TouchableOpacity style={styles.revealButton} onPress={onReveal} activeOpacity={0.8}>
        <Ionicons name="lock-open" size={16} color={COLORS.white} />
        <Text style={styles.revealText}>Reveal Identity</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  timer: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  confessionText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  revealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 12,
  },
  revealText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },
});
