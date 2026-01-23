import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

interface SmartSuggestion {
  id: string;
  label: string;
  icon: string;
  count: number;
  filters: {
    relationshipIntents?: string[];
    activities?: string[];
    timeFilters?: string[];
  };
}

interface SmartSuggestionsProps {
  suggestions: SmartSuggestion[];
  onSelect: (suggestion: SmartSuggestion) => void;
}

export function SmartSuggestions({ suggestions, onSelect }: SmartSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="bulb-outline" size={20} color={COLORS.primary} />
        <Text style={styles.title}>Popular Right Now</Text>
      </View>
      <Text style={styles.subtitle}>People near you are looking for:</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
        {suggestions.map((suggestion) => (
          <TouchableOpacity
            key={suggestion.id}
            style={styles.suggestionCard}
            onPress={() => onSelect(suggestion)}
          >
            <View style={styles.suggestionHeader}>
              <Text style={styles.suggestionIcon}>{suggestion.icon}</Text>
              <Text style={styles.suggestionLabel}>{suggestion.label}</Text>
            </View>
            <Text style={styles.suggestionCount}>{suggestion.count} people</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.combinationsSection}>
        <Text style={styles.combinationsTitle}>Try these combinations:</Text>
        <View style={styles.combinationsList}>
          {suggestions.slice(0, 3).map((suggestion, index) => (
            <TouchableOpacity
              key={`combo-${index}`}
              style={styles.combinationItem}
              onPress={() => onSelect(suggestion)}
            >
              <Text style={styles.combinationText}>
                {suggestion.label} ({suggestion.count} matches)
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  scroll: {
    marginBottom: 16,
  },
  suggestionCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    minWidth: 140,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  suggestionIcon: {
    fontSize: 24,
  },
  suggestionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  suggestionCount: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  combinationsSection: {
    marginTop: 8,
  },
  combinationsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  combinationsList: {
    gap: 8,
  },
  combinationItem: {
    padding: 12,
    backgroundColor: COLORS.primary + '10',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  combinationText: {
    fontSize: 13,
    color: COLORS.text,
  },
});
