import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_BOUNDARIES } from '@/lib/privateConstants';

const C = INCOGNITO_COLORS;

interface BoundaryChecklistProps {
  selected: string[];
  onToggle: (key: string) => void;
  minRequired?: number;
}

export function BoundaryChecklist({
  selected,
  onToggle,
  minRequired = 2,
}: BoundaryChecklistProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Boundaries</Text>
      <Text style={styles.hint}>
        Select at least {minRequired} boundaries you expect others to respect
      </Text>
      {PRIVATE_BOUNDARIES.map((boundary) => {
        const isChecked = selected.includes(boundary.key);
        return (
          <TouchableOpacity
            key={boundary.key}
            style={[styles.row, isChecked && styles.rowChecked]}
            onPress={() => onToggle(boundary.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isChecked ? 'checkbox' : 'square-outline'}
              size={22}
              color={isChecked ? C.primary : C.textLight}
            />
            <Text style={[styles.text, isChecked && styles.textChecked]}>
              {boundary.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      {selected.length < minRequired && (
        <Text style={styles.warning}>
          Select at least {minRequired - selected.length} more
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16 },
  label: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  hint: { fontSize: 12, color: C.textLight, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: C.surface,
    marginBottom: 6,
  },
  rowChecked: { backgroundColor: C.primary + '15' },
  text: { fontSize: 14, color: C.text, flex: 1 },
  textChecked: { color: C.primary, fontWeight: '500' },
  warning: {
    fontSize: 12,
    color: '#FF9800',
    marginTop: 8,
    fontStyle: 'italic',
  },
});
