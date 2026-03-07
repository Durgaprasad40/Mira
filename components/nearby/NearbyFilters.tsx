/**
 * NearbyFilters - Filter sheet for Nearby map results
 *
 * Filters available:
 * - Distance range (preset options)
 * - Looking for (relationship intent)
 * - Age range (preset options)
 * - Verified only (face verified)
 * - Common interests (activities)
 *
 * Future filters (not implemented yet):
 * - Pets
 * - Drinking preferences
 * - Other compatibility filters
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NearbyFilterState {
  maxDistance: number; // in meters (100-1000)
  minAge: number;
  maxAge: number;
  lookingFor: string[]; // relationship intent
  verifiedOnly: boolean;
  interests: string[]; // activity types
}

interface NearbyFiltersProps {
  visible: boolean;
  onClose: () => void;
  filters: NearbyFilterState;
  onApply: (filters: NearbyFilterState) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: NearbyFilterState = {
  maxDistance: 1000, // 1km
  minAge: 18,
  maxAge: 50,
  lookingFor: [],
  verifiedOnly: false,
  interests: [],
};

const DISTANCE_OPTIONS = [
  { value: 200, label: '200m' },
  { value: 500, label: '500m' },
  { value: 750, label: '750m' },
  { value: 1000, label: '1km' },
];

const AGE_RANGE_OPTIONS = [
  { minAge: 18, maxAge: 25, label: '18-25' },
  { minAge: 25, maxAge: 35, label: '25-35' },
  { minAge: 35, maxAge: 45, label: '35-45' },
  { minAge: 45, maxAge: 60, label: '45-60' },
  { minAge: 18, maxAge: 50, label: 'Any' },
];

const LOOKING_FOR_OPTIONS = [
  { value: 'long_term', label: 'Long-term' },
  { value: 'short_term', label: 'Short-term' },
  { value: 'new_friends', label: 'New friends' },
  { value: 'figuring_out', label: 'Figuring out' },
];

const INTEREST_OPTIONS = [
  { value: 'coffee', label: 'Coffee' },
  { value: 'travel', label: 'Travel' },
  { value: 'foodie', label: 'Foodie' },
  { value: 'movies', label: 'Movies' },
  { value: 'concerts', label: 'Concerts' },
  { value: 'sports', label: 'Sports' },
  { value: 'outdoors', label: 'Outdoors' },
  { value: 'gym_partner', label: 'Fitness' },
  { value: 'art_culture', label: 'Art & Culture' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NearbyFilters({
  visible,
  onClose,
  filters,
  onApply,
}: NearbyFiltersProps) {
  // Local state for editing
  const [localFilters, setLocalFilters] = useState<NearbyFilterState>(filters);

  // Reset to current filters when modal opens
  React.useEffect(() => {
    if (visible) {
      setLocalFilters(filters);
    }
  }, [visible, filters]);

  // Handle apply
  const handleApply = useCallback(() => {
    onApply(localFilters);
    onClose();
  }, [localFilters, onApply, onClose]);

  // Handle reset
  const handleReset = useCallback(() => {
    setLocalFilters(DEFAULT_FILTERS);
  }, []);

  // Toggle looking for option
  const toggleLookingFor = useCallback((value: string) => {
    setLocalFilters((prev) => ({
      ...prev,
      lookingFor: prev.lookingFor.includes(value)
        ? prev.lookingFor.filter((v) => v !== value)
        : [...prev.lookingFor, value],
    }));
  }, []);

  // Toggle interest option
  const toggleInterest = useCallback((value: string) => {
    setLocalFilters((prev) => ({
      ...prev,
      interests: prev.interests.includes(value)
        ? prev.interests.filter((v) => v !== value)
        : [...prev.interests, value],
    }));
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Filters</Text>
          <TouchableOpacity onPress={handleReset} style={styles.headerButton}>
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Distance */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Maximum Distance</Text>
            <View style={styles.chipContainer}>
              {DISTANCE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    localFilters.maxDistance === option.value && styles.chipSelected,
                  ]}
                  onPress={() =>
                    setLocalFilters((prev) => ({ ...prev, maxDistance: option.value }))
                  }
                >
                  <Text
                    style={[
                      styles.chipText,
                      localFilters.maxDistance === option.value && styles.chipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Age Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Age Range</Text>
            <View style={styles.chipContainer}>
              {AGE_RANGE_OPTIONS.map((option) => {
                const isSelected =
                  localFilters.minAge === option.minAge &&
                  localFilters.maxAge === option.maxAge;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() =>
                      setLocalFilters((prev) => ({
                        ...prev,
                        minAge: option.minAge,
                        maxAge: option.maxAge,
                      }))
                    }
                  >
                    <Text
                      style={[styles.chipText, isSelected && styles.chipTextSelected]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Verified Only */}
          <View style={styles.section}>
            <View style={styles.switchRow}>
              <View>
                <Text style={styles.sectionTitle}>Verified Only</Text>
                <Text style={styles.switchDescription}>
                  Only show face-verified profiles
                </Text>
              </View>
              <Switch
                value={localFilters.verifiedOnly}
                onValueChange={(value: boolean) =>
                  setLocalFilters((prev) => ({ ...prev, verifiedOnly: value }))
                }
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Looking For */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Looking For</Text>
            <Text style={styles.sectionDescription}>
              Filter by relationship intent
            </Text>
            <View style={styles.chipContainer}>
              {LOOKING_FOR_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    localFilters.lookingFor.includes(option.value) &&
                      styles.chipSelected,
                  ]}
                  onPress={() => toggleLookingFor(option.value)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      localFilters.lookingFor.includes(option.value) &&
                        styles.chipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Interests */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Common Interests</Text>
            <Text style={styles.sectionDescription}>
              Find people who share your interests
            </Text>
            <View style={styles.chipContainer}>
              {INTEREST_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    localFilters.interests.includes(option.value) &&
                      styles.chipSelected,
                  ]}
                  onPress={() => toggleInterest(option.value)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      localFilters.interests.includes(option.value) &&
                        styles.chipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Future filters placeholder */}
          <View style={styles.section}>
            <Text style={styles.comingSoonTitle}>Coming Soon</Text>
            <Text style={styles.comingSoonText}>
              Pets, drinking preferences, and more filters
            </Text>
          </View>

          {/* Bottom spacing */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Apply Button */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
            <Text style={styles.applyButtonText}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Default export for convenience
// ---------------------------------------------------------------------------

export { DEFAULT_FILTERS };

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerButton: {
    padding: 4,
    minWidth: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  resetText: {
    fontSize: 15,
    color: COLORS.primary,
    textAlign: 'right',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  sectionDescription: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 12,
    marginTop: -8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchDescription: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '500',
  },
  comingSoonTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textLight,
    textAlign: 'center',
  },
  comingSoonText: {
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  applyButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
