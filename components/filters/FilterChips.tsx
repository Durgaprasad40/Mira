import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Chip } from '@/components/ui';
import { COLORS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import { RelationshipIntent, ActivityFilter } from '@/types';

interface FilterChipsProps {
  relationshipIntents: RelationshipIntent[];
  activities: ActivityFilter[];
  onToggleIntent: (intent: RelationshipIntent) => void;
  onToggleActivity: (activity: ActivityFilter) => void;
  intentCounts?: Record<string, number>;
  activityCounts?: Record<string, number>;
}

export function FilterChips({
  relationshipIntents,
  activities,
  onToggleIntent,
  onToggleActivity,
  intentCounts = {},
  activityCounts = {},
}: FilterChipsProps) {
  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Relationship Intent</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsContainer}>
          {RELATIONSHIP_INTENTS.map((intent) => {
            const isSelected = relationshipIntents.includes(intent.value);
            const count = intentCounts[intent.value] || 0;
            return (
              <Chip
                key={intent.value}
                label={`${intent.emoji} ${intent.label}${count > 0 ? ` (${count})` : ''}`}
                selected={isSelected}
                onPress={() => onToggleIntent(intent.value)}
                style={styles.chip}
              />
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activities</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsContainer}>
          {ACTIVITY_FILTERS.map((activity) => {
            const isSelected = activities.includes(activity.value);
            const count = activityCounts[activity.value] || 0;
            return (
              <Chip
                key={activity.value}
                label={`${activity.emoji} ${activity.label}${count > 0 ? ` (${count})` : ''}`}
                selected={isSelected}
                onPress={() => onToggleActivity(activity.value)}
                style={styles.chip}
              />
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  chipsContainer: {
    paddingHorizontal: 16,
  },
  chip: {
    marginRight: 8,
  },
});
