import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_DESIRE_TAGS } from '@/lib/privateConstants';

const C = INCOGNITO_COLORS;

interface DesireTagPickerProps {
  selected: string[];
  onToggle: (key: string) => void;
  minSelection?: number;
  maxSelection?: number;
}

export function DesireTagPicker({
  selected,
  onToggle,
  minSelection = 3,
  maxSelection = 10,
}: DesireTagPickerProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>What are you looking for?</Text>
      <Text style={styles.hint}>
        Pick {minSelection}-{maxSelection} tags that describe your vibe
      </Text>
      <View style={styles.chips}>
        {PRIVATE_DESIRE_TAGS.map((tag) => {
          const isSelected = selected.includes(tag.key);
          const isMaxed = selected.length >= maxSelection && !isSelected;

          return (
            <TouchableOpacity
              key={tag.key}
              style={[
                styles.chip,
                isSelected && styles.chipSelected,
                isMaxed && styles.chipDisabled,
              ]}
              onPress={() => !isMaxed && onToggle(tag.key)}
              activeOpacity={isMaxed ? 0.5 : 0.7}
            >
              <Text
                style={[
                  styles.chipText,
                  isSelected && styles.chipTextSelected,
                  isMaxed && styles.chipTextDisabled,
                ]}
              >
                {tag.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.count}>
        {selected.length} of {minSelection}-{maxSelection} selected
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16 },
  label: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  hint: { fontSize: 12, color: C.textLight, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.surface,
  },
  chipSelected: {
    backgroundColor: C.primary + '20',
    borderColor: C.primary,
  },
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 13, color: C.textLight },
  chipTextSelected: { color: C.primary, fontWeight: '600' },
  chipTextDisabled: { color: C.textLight },
  count: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 12,
  },
});
