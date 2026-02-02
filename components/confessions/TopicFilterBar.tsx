import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS, CONFESSION_TOPICS } from '@/lib/constants';
import { ConfessionTopic } from '@/types';

const TOPIC_KEYS: ConfessionTopic[] = ['heartbreak', 'crush', 'funny', 'late_night', 'college', 'office', 'spicy'];

interface TopicFilterBarProps {
  selectedTopic: ConfessionTopic | null;
  onSelect: (topic: ConfessionTopic | null) => void;
}

export default function TopicFilterBar({ selectedTopic, onSelect }: TopicFilterBarProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      <TouchableOpacity
        style={[styles.chip, selectedTopic === null && styles.chipActive]}
        onPress={() => onSelect(null)}
      >
        <Text style={[styles.chipLabel, selectedTopic === null && styles.chipLabelActive]}>
          All
        </Text>
      </TouchableOpacity>

      {TOPIC_KEYS.map((key) => {
        const config = CONFESSION_TOPICS[key];
        const isActive = selectedTopic === key;

        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.chip,
              isActive && { backgroundColor: config.color + '20', borderColor: config.color },
            ]}
            onPress={() => onSelect(isActive ? null : key)}
          >
            <Text style={styles.chipEmoji}>{config.emoji}</Text>
            <Text style={[styles.chipLabel, isActive && { color: config.color, fontWeight: '700' }]}>
              {config.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipEmoji: {
    fontSize: 13,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  chipLabelActive: {
    color: COLORS.white,
  },
});
