/**
 * EducationReligionSection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles Education and Religion with expandable UI.
 *
 * NO LOGIC CHANGES - Structure refactor only.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
} from '@/lib/constants';

interface EducationReligionSectionProps {
  expanded: boolean;
  onToggleExpand: () => void;
  education: string | null;
  educationOther: string;
  religion: string | null;
  religionOther: string;
  onChangeEducation: (value: string | null) => void;
  onChangeEducationOther: (value: string) => void;
  onChangeReligion: (value: string | null) => void;
  onChangeReligionOther: (value: string) => void;
  getOptionLabel: (options: { value: string; label: string }[], value: string | null) => string;
}

export function EducationReligionSection({
  expanded,
  onToggleExpand,
  education,
  educationOther,
  religion,
  religionOther,
  onChangeEducation,
  onChangeEducationOther,
  onChangeReligion,
  onChangeReligionOther,
  getOptionLabel,
}: EducationReligionSectionProps) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.reviewHeader} onPress={onToggleExpand} activeOpacity={0.7}>
        <View style={styles.reviewHeaderLeft}>
          <Text style={styles.reviewSectionTitle}>Education & Religion</Text>
          <Text style={styles.reviewSummary}>
            {[
              education && getOptionLabel(EDUCATION_OPTIONS, education),
              religion && getOptionLabel(RELIGION_OPTIONS, religion),
            ].filter(Boolean).join(' · ') || 'Add info'}
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
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Education</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(EDUCATION_OPTIONS, education)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Religion</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(RELIGION_OPTIONS, religion)}</Text>
          </View>
        </View>
      )}

      {/* Expanded: Full edit UI */}
      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Education</Text>
            <View style={styles.chipGrid}>
              {EDUCATION_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.compactChip, education === o.value && styles.compactChipSelected]}
                  onPress={() => {
                    onChangeEducation(education === o.value ? null : o.value);
                    if (o.value !== 'other') onChangeEducationOther('');
                  }}
                >
                  <Text style={[styles.compactChipText, education === o.value && styles.compactChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {education === 'other' && (
              <TextInput
                style={styles.otherInput}
                placeholder="Please specify..."
                placeholderTextColor={COLORS.textMuted}
                value={educationOther}
                onChangeText={onChangeEducationOther}
                maxLength={50}
              />
            )}
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Religion</Text>
            <View style={styles.chipGrid}>
              {RELIGION_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.compactChip, religion === o.value && styles.compactChipSelected]}
                  onPress={() => {
                    onChangeReligion(religion === o.value ? null : o.value);
                    if (o.value !== 'other') onChangeReligionOther('');
                  }}
                >
                  <Text style={[styles.compactChipText, religion === o.value && styles.compactChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {religion === 'other' && (
              <TextInput
                style={styles.otherInput}
                placeholder="Please specify..."
                placeholderTextColor={COLORS.textMuted}
                value={religionOther}
                onChangeText={onChangeReligionOther}
                maxLength={50}
              />
            )}
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
  expandedContent: {
    marginTop: 16,
  },
  inputRow: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '500', color: COLORS.text, marginBottom: 8 },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  compactChipSelected: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  compactChipText: { fontSize: 13, color: COLORS.text },
  compactChipTextSelected: { color: COLORS.primary, fontWeight: '600' },
  otherInput: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontSize: 14,
    color: COLORS.text,
  },
});
