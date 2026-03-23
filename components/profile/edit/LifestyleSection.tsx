/**
 * LifestyleSection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles Smoking, Drinking, Kids, Exercise, Pets, Insects with expandable UI.
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
import {
  COLORS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  KIDS_OPTIONS,
  EXERCISE_OPTIONS,
  PETS_OPTIONS,
  INSECT_OPTIONS,
} from '@/lib/constants';

interface LifestyleSectionProps {
  expanded: boolean;
  onToggleExpand: () => void;
  smoking: string | null;
  drinking: string | null;
  kids: string | null;
  exercise: string | null;
  pets: string[];
  insect: string | null;
  onChangeSmoking: (value: string | null) => void;
  onChangeDrinking: (value: string | null) => void;
  onChangeKids: (value: string | null) => void;
  onChangeExercise: (value: string | null) => void;
  onTogglePet: (value: string) => void;
  onChangeInsect: (value: string | null) => void;
  getOptionLabel: (options: { value: string; label: string }[], value: string | null) => string;
}

export function LifestyleSection({
  expanded,
  onToggleExpand,
  smoking,
  drinking,
  kids,
  exercise,
  pets,
  insect,
  onChangeSmoking,
  onChangeDrinking,
  onChangeKids,
  onChangeExercise,
  onTogglePet,
  onChangeInsect,
  getOptionLabel,
}: LifestyleSectionProps) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.reviewHeader} onPress={onToggleExpand} activeOpacity={0.7}>
        <View style={styles.reviewHeaderLeft}>
          <Text style={styles.reviewSectionTitle}>Lifestyle</Text>
          <Text style={styles.reviewSummary}>
            {[
              smoking && getOptionLabel(SMOKING_OPTIONS, smoking),
              drinking && getOptionLabel(DRINKING_OPTIONS, drinking),
            ].filter(Boolean).join(' · ') || 'Add lifestyle info'}
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
            <Text style={styles.reviewRowLabel}>Smoking</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(SMOKING_OPTIONS, smoking)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Drinking</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(DRINKING_OPTIONS, drinking)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Kids</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(KIDS_OPTIONS, kids)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Exercise</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(EXERCISE_OPTIONS, exercise)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Pets</Text>
            <Text style={styles.reviewRowValue}>
              {pets.length > 0
                ? pets.map((p) => PETS_OPTIONS.find((o) => o.value === p)?.label || p).join(', ')
                : '—'}
            </Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Insects</Text>
            <Text style={styles.reviewRowValue}>
              {insect ? INSECT_OPTIONS.find((o) => o.value === insect)?.label || insect : '—'}
            </Text>
          </View>
        </View>
      )}

      {/* Expanded: Full edit UI */}
      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Smoking</Text>
            <View style={styles.optionsRow}>
              {SMOKING_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, smoking === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeSmoking(smoking === o.value ? null : o.value)}
                >
                  <Text style={[styles.optionChipText, smoking === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Drinking</Text>
            <View style={styles.optionsRow}>
              {DRINKING_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, drinking === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeDrinking(drinking === o.value ? null : o.value)}
                >
                  <Text style={[styles.optionChipText, drinking === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Kids</Text>
            <View style={styles.optionsRow}>
              {KIDS_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, kids === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeKids(kids === o.value ? null : o.value)}
                >
                  <Text style={[styles.optionChipText, kids === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Exercise</Text>
            <View style={styles.optionsRow}>
              {EXERCISE_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, exercise === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeExercise(exercise === o.value ? null : o.value)}
                >
                  <Text style={[styles.optionChipText, exercise === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Pets (select up to 3)</Text>
            <View style={styles.optionsRow}>
              {PETS_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, pets.includes(o.value) && styles.optionChipSelected]}
                  onPress={() => onTogglePet(o.value)}
                >
                  <Text style={[styles.optionChipText, pets.includes(o.value) && styles.optionChipTextSelected]}>
                    {o.emoji} {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Insects (optional)</Text>
            <View style={styles.optionsRow}>
              {INSECT_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, insect === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeInsect(insect === o.value ? null : o.value)}
                >
                  <Text style={[styles.optionChipText, insect === o.value && styles.optionChipTextSelected]}>
                    {o.emoji} {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
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
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: COLORS.border },
  optionChipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optionChipText: { fontSize: 14, color: COLORS.text },
  optionChipTextSelected: { color: COLORS.white, fontWeight: '600' },
});
