/**
 * InterestsSection Component
 *
 * Handles user activities/interests selection for Edit Profile.
 * Allows selecting up to 5 interests from ACTIVITY_FILTERS.
 *
 * FIX: This component was missing, causing interests to not appear in Edit Profile.
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ACTIVITY_FILTERS, ActivityFilter } from '@/lib/constants';

const MAX_INTERESTS = 5;

interface InterestsSectionProps {
  expanded: boolean;
  onToggleExpand: () => void;
  activities: ActivityFilter[];
  onToggleActivity: (activity: ActivityFilter) => void;
}

export function InterestsSection({
  expanded,
  onToggleExpand,
  activities,
  onToggleActivity,
}: InterestsSectionProps) {
  // Debug log for profile interests
  if (__DEV__) {
    console.log('[PROFILE_INTERESTS]', {
      source: 'InterestsSection',
      count: activities.length,
      values: activities,
    });
  }

  // Get selected interests with their labels and emojis
  const selectedInterests = useMemo(() => {
    return activities.map((activityValue) => {
      const found = ACTIVITY_FILTERS.find((f) => f.value === activityValue);
      return found || { value: activityValue, label: activityValue, emoji: '🏷️' };
    });
  }, [activities]);

  // Summary for collapsed view
  const summaryText = useMemo(() => {
    if (selectedInterests.length === 0) return 'Add your interests';
    return selectedInterests.slice(0, 3).map((i) => `${i.emoji} ${i.label}`).join(' · ');
  }, [selectedInterests]);

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.reviewHeader} onPress={onToggleExpand} activeOpacity={0.7}>
        <View style={styles.reviewHeaderLeft}>
          <Text style={styles.reviewSectionTitle}>Interests</Text>
          <Text style={styles.reviewSummary} numberOfLines={1}>
            {summaryText}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.countBadge}>{activities.length}/{MAX_INTERESTS}</Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={COLORS.textMuted}
          />
        </View>
      </TouchableOpacity>

      {/* Collapsed: Show selected interests as chips */}
      {!expanded && selectedInterests.length > 0 && (
        <View style={styles.collapsedChips}>
          {selectedInterests.map((interest) => (
            <View key={interest.value} style={styles.collapsedChip}>
              <Text style={styles.collapsedChipText}>
                {interest.emoji} {interest.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Expanded: Full edit UI with all interests */}
      {expanded && (
        <View style={styles.expandedContent}>
          <Text style={styles.helperText}>
            Select up to {MAX_INTERESTS} interests that define you
          </Text>
          <ScrollView
            style={styles.interestsScroll}
            contentContainerStyle={styles.interestsContainer}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {ACTIVITY_FILTERS.map((option) => {
              const isSelected = activities.includes(option.value);
              const isDisabled = !isSelected && activities.length >= MAX_INTERESTS;

              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.interestChip,
                    isSelected && styles.interestChipSelected,
                    isDisabled && styles.interestChipDisabled,
                  ]}
                  onPress={() => {
                    if (!isDisabled || isSelected) {
                      onToggleActivity(option.value);
                    }
                  }}
                  activeOpacity={isDisabled ? 1 : 0.7}
                >
                  <Text
                    style={[
                      styles.interestChipText,
                      isSelected && styles.interestChipTextSelected,
                      isDisabled && styles.interestChipTextDisabled,
                    ]}
                  >
                    {option.emoji} {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  reviewHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reviewSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 0,
  },
  reviewSummary: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  countBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    backgroundColor: COLORS.primarySubtle,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  collapsedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  collapsedChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.primarySubtle,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  collapsedChipText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  expandedContent: {
    marginTop: 16,
  },
  helperText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 12,
  },
  interestsScroll: {
    maxHeight: 300,
  },
  interestsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 8,
  },
  interestChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  interestChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  interestChipDisabled: {
    opacity: 0.4,
  },
  interestChipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  interestChipTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  interestChipTextDisabled: {
    color: COLORS.textMuted,
  },
});
