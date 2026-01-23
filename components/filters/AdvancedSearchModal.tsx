import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
} from 'react-native';
import { COLORS, EDUCATION_OPTIONS, RELIGION_OPTIONS } from '@/lib/constants';
import { Button, Input } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

interface AdvancedSearchFilters {
  keyword?: string;
  ageMin: number;
  ageMax: number;
  distanceMax: number;
  heightMin?: number;
  heightMax?: number;
  education?: string[];
  religion?: string[];
  smoking?: string;
  drinking?: string;
  exercise?: string;
}

interface AdvancedSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: AdvancedSearchFilters) => void;
  initialFilters?: Partial<AdvancedSearchFilters>;
}

export function AdvancedSearchModal({
  visible,
  onClose,
  onApply,
  initialFilters = {},
}: AdvancedSearchModalProps) {
  const [filters, setFilters] = useState<AdvancedSearchFilters>({
    ageMin: initialFilters.ageMin || 18,
    ageMax: initialFilters.ageMax || 50,
    distanceMax: initialFilters.distanceMax || 25,
    heightMin: initialFilters.heightMin,
    heightMax: initialFilters.heightMax,
    education: initialFilters.education || [],
    religion: initialFilters.religion || [],
    smoking: initialFilters.smoking,
    drinking: initialFilters.drinking,
    exercise: initialFilters.exercise,
    keyword: initialFilters.keyword,
  });

  const handleApply = () => {
    onApply(filters);
    onClose();
  };

  const toggleEducation = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      education: prev.education?.includes(value)
        ? prev.education.filter((e) => e !== value)
        : [...(prev.education || []), value],
    }));
  };

  const toggleReligion = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      religion: prev.religion?.includes(value)
        ? prev.religion.filter((r) => r !== value)
        : [...(prev.religion || []), value],
    }));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Advanced Search</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {/* Keyword Search */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Search by Keyword</Text>
            <Input
              placeholder="Search interests, bio..."
              value={filters.keyword}
              onChangeText={(text) => setFilters({ ...filters, keyword: text })}
              leftIcon={<Ionicons name="search" size={20} color={COLORS.textLight} />}
            />
          </View>

          {/* Age Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Age Range</Text>
            <View style={styles.rangeContainer}>
              <Text style={styles.rangeValue}>{filters.ageMin}</Text>
              <Text style={styles.rangeSeparator}>to</Text>
              <Text style={styles.rangeValue}>{filters.ageMax}</Text>
            </View>
            {/* TODO: Add RangeSlider component */}
            <Text style={styles.hint}>Drag sliders to adjust range</Text>
          </View>

          {/* Distance */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Maximum Distance</Text>
            <View style={styles.rangeContainer}>
              <Text style={styles.rangeValue}>{filters.distanceMax} miles</Text>
            </View>
            {/* TODO: Add Slider component */}
          </View>

          {/* Height Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Height (Optional)</Text>
            <View style={styles.heightRow}>
              <View style={styles.heightInput}>
                <Text style={styles.heightLabel}>Min</Text>
                <Input
                  placeholder="5'4"
                  value={filters.heightMin?.toString()}
                  onChangeText={(text) =>
                    setFilters({ ...filters, heightMin: text ? parseInt(text) : undefined })
                  }
                  keyboardType="numeric"
                />
              </View>
              <Text style={styles.rangeSeparator}>to</Text>
              <View style={styles.heightInput}>
                <Text style={styles.heightLabel}>Max</Text>
                <Input
                  placeholder="6'2"
                  value={filters.heightMax?.toString()}
                  onChangeText={(text) =>
                    setFilters({ ...filters, heightMax: text ? parseInt(text) : undefined })
                  }
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Education */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Education</Text>
            <View style={styles.optionsGrid}>
              {EDUCATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionChip,
                    filters.education?.includes(option.value) && styles.optionChipSelected,
                  ]}
                  onPress={() => toggleEducation(option.value)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      filters.education?.includes(option.value) && styles.optionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Lifestyle */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lifestyle</Text>
            
            <View style={styles.lifestyleRow}>
              <Text style={styles.lifestyleLabel}>Drinking:</Text>
              <View style={styles.lifestyleOptions}>
                {['Never', 'Socially', 'Regularly', 'Sober'].map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.lifestyleChip,
                      filters.drinking === option.toLowerCase() && styles.lifestyleChipSelected,
                    ]}
                    onPress={() =>
                      setFilters({
                        ...filters,
                        drinking: filters.drinking === option.toLowerCase() ? undefined : option.toLowerCase(),
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.lifestyleText,
                        filters.drinking === option.toLowerCase() && styles.lifestyleTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.lifestyleRow}>
              <Text style={styles.lifestyleLabel}>Smoking:</Text>
              <View style={styles.lifestyleOptions}>
                {['Never', 'Socially', 'Regularly', 'Trying to quit'].map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.lifestyleChip,
                      filters.smoking === option.toLowerCase() && styles.lifestyleChipSelected,
                    ]}
                    onPress={() =>
                      setFilters({
                        ...filters,
                        smoking: filters.smoking === option.toLowerCase() ? undefined : option.toLowerCase(),
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.lifestyleText,
                        filters.smoking === option.toLowerCase() && styles.lifestyleTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.lifestyleRow}>
              <Text style={styles.lifestyleLabel}>Exercise:</Text>
              <View style={styles.lifestyleOptions}>
                {['Never', 'Sometimes', 'Regularly', 'Daily'].map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.lifestyleChip,
                      filters.exercise === option.toLowerCase() && styles.lifestyleChipSelected,
                    ]}
                    onPress={() =>
                      setFilters({
                        ...filters,
                        exercise: filters.exercise === option.toLowerCase() ? undefined : option.toLowerCase(),
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.lifestyleText,
                        filters.exercise === option.toLowerCase() && styles.lifestyleTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Religion */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Religion</Text>
            <View style={styles.optionsGrid}>
              {RELIGION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionChip,
                    filters.religion?.includes(option.value) && styles.optionChipSelected,
                  ]}
                  onPress={() => toggleReligion(option.value)}
                >
                  <Text
                    style={[
                      styles.optionText,
                      filters.religion?.includes(option.value) && styles.optionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            title="Reset"
            variant="outline"
            onPress={() => {
              setFilters({
                ageMin: 18,
                ageMax: 50,
                distanceMax: 25,
              });
            }}
            style={styles.resetButton}
          />
          <Button
            title="Apply Search"
            variant="primary"
            onPress={handleApply}
            style={styles.applyButton}
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
  placeholder: {
    width: 24,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  rangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  rangeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  rangeSeparator: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 4,
  },
  heightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heightInput: {
    flex: 1,
  },
  heightLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  optionText: {
    fontSize: 14,
    color: COLORS.text,
  },
  optionTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  lifestyleRow: {
    marginBottom: 16,
  },
  lifestyleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  lifestyleOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  lifestyleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lifestyleChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  lifestyleText: {
    fontSize: 13,
    color: COLORS.text,
  },
  lifestyleTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  resetButton: {
    flex: 1,
  },
  applyButton: {
    flex: 2,
  },
});
