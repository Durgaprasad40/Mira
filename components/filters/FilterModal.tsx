import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import { Button, Chip } from '@/components/ui';
import { Gender, RelationshipIntent, ActivityFilter, SortOption } from '@/types';

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: FilterValues, sortBy: SortOption) => void;
  initialFilters?: Partial<FilterValues>;
  initialSortBy?: SortOption;
}

interface FilterValues {
  gender: Gender[];
  minAge: number;
  maxAge: number;
  maxDistance: number;
  relationshipIntent: RelationshipIntent[];
  activities: ActivityFilter[];
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'distance', label: 'Distance' },
  { value: 'recently_active', label: 'Recently Active' },
  { value: 'newest', label: 'Newest' },
];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Men' },
  { value: 'female', label: 'Women' },
  { value: 'non_binary', label: 'Non-binary' },
];

export function FilterModal({
  visible,
  onClose,
  onApply,
  initialFilters = {},
  initialSortBy = 'recommended',
}: FilterModalProps) {
  const [filters, setFilters] = useState<FilterValues>({
    gender: initialFilters.gender || [],
    minAge: initialFilters.minAge || 18,
    maxAge: initialFilters.maxAge || 50,
    maxDistance: initialFilters.maxDistance || 25,
    relationshipIntent: initialFilters.relationshipIntent || [],
    activities: initialFilters.activities || [],
  });
  const [sortBy, setSortBy] = useState<SortOption>(initialSortBy);

  const toggleGender = (gender: Gender) => {
    setFilters((prev) => ({
      ...prev,
      gender: prev.gender.includes(gender)
        ? prev.gender.filter((g) => g !== gender)
        : [...prev.gender, gender],
    }));
  };

  const toggleIntent = (intent: RelationshipIntent) => {
    setFilters((prev) => ({
      ...prev,
      relationshipIntent: prev.relationshipIntent.includes(intent)
        ? prev.relationshipIntent.filter((i) => i !== intent)
        : [...prev.relationshipIntent, intent],
    }));
  };

  const toggleActivity = (activity: ActivityFilter) => {
    setFilters((prev) => ({
      ...prev,
      activities: prev.activities.includes(activity)
        ? prev.activities.filter((a) => a !== activity)
        : [...prev.activities, activity],
    }));
  };

  const handleApply = () => {
    onApply(filters, sortBy);
    onClose();
  };

  const handleReset = () => {
    setFilters({
      gender: [],
      minAge: 18,
      maxAge: 50,
      maxDistance: 25,
      relationshipIntent: [],
      activities: [],
    });
    setSortBy('recommended');
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Filters</Text>
          <TouchableOpacity onPress={handleReset}>
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {/* Sort By */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sort By</Text>
            <View style={styles.optionsRow}>
              {SORT_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={sortBy === option.value}
                  onPress={() => setSortBy(option.value)}
                  style={styles.chip}
                />
              ))}
            </View>
          </View>

          {/* Gender */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Show Me</Text>
            <View style={styles.optionsRow}>
              {GENDER_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={filters.gender.includes(option.value)}
                  onPress={() => toggleGender(option.value)}
                  style={styles.chip}
                />
              ))}
            </View>
          </View>

          {/* Age Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Age Range</Text>
            <View style={styles.rangeDisplay}>
              <Text style={styles.rangeText}>{filters.minAge} - {filters.maxAge}</Text>
            </View>
          </View>

          {/* Distance */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Maximum Distance</Text>
            <View style={styles.rangeDisplay}>
              <Text style={styles.rangeText}>{filters.maxDistance} km</Text>
            </View>
          </View>

          {/* Relationship Intent */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Looking For</Text>
            <View style={styles.optionsWrap}>
              {RELATIONSHIP_INTENTS.map((intent) => (
                <Chip
                  key={intent.value}
                  label={`${intent.emoji} ${intent.label}`}
                  selected={filters.relationshipIntent.includes(intent.value)}
                  onPress={() => toggleIntent(intent.value)}
                  style={styles.chip}
                />
              ))}
            </View>
          </View>

          {/* Activities */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Activities</Text>
            <View style={styles.optionsWrap}>
              {ACTIVITY_FILTERS.map((activity) => (
                <Chip
                  key={activity.value}
                  label={`${activity.emoji} ${activity.label}`}
                  selected={filters.activities.includes(activity.value)}
                  onPress={() => toggleActivity(activity.value)}
                  style={styles.chip}
                />
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            title="Apply Filters"
            variant="primary"
            onPress={handleApply}
            fullWidth
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  resetText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    marginBottom: 4,
  },
  rangeDisplay: {
    backgroundColor: COLORS.backgroundDark,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  rangeText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.primary,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
});
