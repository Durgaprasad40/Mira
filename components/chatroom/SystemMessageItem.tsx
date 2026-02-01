import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

interface SystemMessageItemProps {
  text: string;
  isJoin?: boolean;
}

export default function SystemMessageItem({ text, isJoin = false }: SystemMessageItemProps) {
  if (isJoin) {
    return (
      <View style={styles.joinContainer}>
        <Text style={styles.joinText}>{text}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginVertical: 4,
    borderRadius: 8,
    backgroundColor: C.accent,
  },
  text: {
    fontSize: 11,
    color: C.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  // ── Join messages: left-aligned, subtle ──
  joinContainer: {
    paddingHorizontal: 12,
    paddingVertical: 2,
    marginVertical: 2,
  },
  joinText: {
    fontSize: 10,
    color: C.textLight,
    opacity: 0.65,
  },
});
