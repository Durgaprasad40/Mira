import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface HeaderRowProps {
  title: string;
  onPress?: () => void;
}

export function HeaderRow({ title, onPress }: HeaderRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {onPress && (
        <TouchableOpacity onPress={onPress} hitSlop={8}>
          <Text style={styles.seeAll}>See all</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
    marginTop: 18,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  seeAll: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF6B6B',
  },
});
