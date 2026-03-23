/**
 * DetailsSection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles Height, Weight, Job Title, Company, School with expandable UI.
 *
 * NO LOGIC CHANGES - Structure refactor only.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { Input } from '@/components/ui';

interface DetailsSectionProps {
  expanded: boolean;
  onToggleExpand: () => void;
  height: string;
  weight: string;
  jobTitle: string;
  company: string;
  school: string;
  onChangeHeight: (value: string) => void;
  onChangeWeight: (value: string) => void;
  onChangeJobTitle: (value: string) => void;
  onChangeCompany: (value: string) => void;
  onChangeSchool: (value: string) => void;
}

export function DetailsSection({
  expanded,
  onToggleExpand,
  height,
  weight,
  jobTitle,
  company,
  school,
  onChangeHeight,
  onChangeWeight,
  onChangeJobTitle,
  onChangeCompany,
  onChangeSchool,
}: DetailsSectionProps) {
  // Filter input to only allow digits for height/weight
  const handleHeightChange = (value: string) => {
    const filtered = value.replace(/[^0-9]/g, '');
    onChangeHeight(filtered);
  };
  const handleWeightChange = (value: string) => {
    const filtered = value.replace(/[^0-9]/g, '');
    onChangeWeight(filtered);
  };

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.reviewHeader} onPress={onToggleExpand} activeOpacity={0.7}>
        <View style={styles.reviewHeaderLeft}>
          <Text style={styles.reviewSectionTitle}>Details</Text>
          <Text style={styles.reviewSummary}>
            {[height && `${height}cm`, weight && `${weight}kg`, jobTitle].filter(Boolean).join(' · ') || 'Add details'}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={COLORS.textMuted}
        />
      </TouchableOpacity>

      {/* Collapsed: Show key values */}
      {!expanded && (
        <View style={styles.reviewRowList}>
          {height ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Height</Text>
              <Text style={styles.reviewRowValue}>{height} cm</Text>
            </View>
          ) : null}
          {weight ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Weight</Text>
              <Text style={styles.reviewRowValue}>{weight} kg</Text>
            </View>
          ) : null}
          {jobTitle ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>Job</Text>
              <Text style={styles.reviewRowValue} numberOfLines={1}>{jobTitle}{company ? ` at ${company}` : ''}</Text>
            </View>
          ) : null}
          {school ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>School</Text>
              <Text style={styles.reviewRowValue} numberOfLines={1}>{school}</Text>
            </View>
          ) : null}
          {!height && !weight && !jobTitle && !school && (
            <Text style={styles.reviewEmptyHint}>Tap to add your details</Text>
          )}
        </View>
      )}

      {/* Expanded: Full edit UI */}
      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Height (cm)</Text>
            <Input placeholder="e.g. 170" value={height} onChangeText={handleHeightChange} keyboardType="numeric" maxLength={3} style={styles.numberInput} />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Weight (kg)</Text>
            <Input placeholder="e.g. 65" value={weight} onChangeText={handleWeightChange} keyboardType="numeric" maxLength={3} style={styles.numberInput} />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Job Title</Text>
            <Input placeholder="e.g. Software Engineer" value={jobTitle} onChangeText={onChangeJobTitle} />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Company</Text>
            <Input placeholder="e.g. Google" value={company} onChangeText={onChangeCompany} />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>School</Text>
            <Input placeholder="e.g. Stanford University" value={school} onChangeText={onChangeSchool} />
          </View>
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
  reviewRowList: {
    marginTop: 12,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  reviewRowLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  reviewRowValue: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    maxWidth: '60%',
    textAlign: 'right',
  },
  reviewEmptyHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  expandedContent: {
    marginTop: 16,
  },
  inputRow: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '500', color: COLORS.text, marginBottom: 8 },
  numberInput: { width: 120 },
});
