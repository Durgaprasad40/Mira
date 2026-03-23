/**
 * LifeRhythmSection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles City, Social Style, Sleep, Travel, Work, Core Values with expandable UI.
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
  SOCIAL_RHYTHM_OPTIONS,
  SLEEP_SCHEDULE_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  WORK_STYLE_OPTIONS,
  CORE_VALUES_OPTIONS,
  SocialRhythmValue,
  SleepScheduleValue,
  TravelStyleValue,
  WorkStyleValue,
  CoreValueValue,
} from '@/lib/constants';
import { Input } from '@/components/ui';

interface LifeRhythmSectionProps {
  expanded: boolean;
  onToggleExpand: () => void;
  lifeRhythmCity: string;
  socialRhythm: SocialRhythmValue | null;
  sleepSchedule: SleepScheduleValue | null;
  travelStyle: TravelStyleValue | null;
  workStyle: WorkStyleValue | null;
  coreValues: CoreValueValue[];
  onChangeCity: (value: string) => void;
  onChangeSocialRhythm: (value: SocialRhythmValue | null) => void;
  onChangeSleepSchedule: (value: SleepScheduleValue | null) => void;
  onChangeTravelStyle: (value: TravelStyleValue | null) => void;
  onChangeWorkStyle: (value: WorkStyleValue | null) => void;
  onToggleCoreValue: (value: CoreValueValue) => void;
  getOptionLabel: (options: { value: string; label: string }[], value: string | null) => string;
}

export function LifeRhythmSection({
  expanded,
  onToggleExpand,
  lifeRhythmCity,
  socialRhythm,
  sleepSchedule,
  travelStyle,
  workStyle,
  coreValues,
  onChangeCity,
  onChangeSocialRhythm,
  onChangeSleepSchedule,
  onChangeTravelStyle,
  onChangeWorkStyle,
  onToggleCoreValue,
  getOptionLabel,
}: LifeRhythmSectionProps) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.reviewHeader} onPress={onToggleExpand} activeOpacity={0.7}>
        <View style={styles.reviewHeaderLeft}>
          <Text style={styles.reviewSectionTitle}>Life Rhythm</Text>
          <Text style={styles.reviewSummary}>
            {[
              socialRhythm && getOptionLabel(SOCIAL_RHYTHM_OPTIONS, socialRhythm),
              sleepSchedule && getOptionLabel(SLEEP_SCHEDULE_OPTIONS, sleepSchedule),
            ].filter(Boolean).join(' · ') || 'Add life rhythm info'}
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
          {lifeRhythmCity ? (
            <View style={styles.reviewRow}>
              <Text style={styles.reviewRowLabel}>City</Text>
              <Text style={styles.reviewRowValue}>{lifeRhythmCity}</Text>
            </View>
          ) : null}
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Social Style</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(SOCIAL_RHYTHM_OPTIONS, socialRhythm)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Sleep Schedule</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(SLEEP_SCHEDULE_OPTIONS, sleepSchedule)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Travel Style</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(TRAVEL_STYLE_OPTIONS, travelStyle)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Work Style</Text>
            <Text style={styles.reviewRowValue}>{getOptionLabel(WORK_STYLE_OPTIONS, workStyle)}</Text>
          </View>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewRowLabel}>Core Values</Text>
            <Text style={styles.reviewRowValue}>
              {coreValues.length > 0
                ? coreValues.map((v) => CORE_VALUES_OPTIONS.find((o) => o.value === v)?.label || v).join(', ')
                : '—'}
            </Text>
          </View>
        </View>
      )}

      {/* Expanded: Full edit UI */}
      {expanded && (
        <View style={styles.expandedContent}>
          <View style={styles.inputRow}>
            <Text style={styles.label}>City</Text>
            <Input
              placeholder="e.g. San Francisco"
              value={lifeRhythmCity}
              onChangeText={onChangeCity}
            />
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Social Style</Text>
            <View style={styles.optionsRow}>
              {SOCIAL_RHYTHM_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, socialRhythm === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeSocialRhythm(socialRhythm === o.value ? null : o.value as SocialRhythmValue)}
                >
                  <Text style={[styles.optionChipText, socialRhythm === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Sleep Schedule</Text>
            <View style={styles.optionsRow}>
              {SLEEP_SCHEDULE_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, sleepSchedule === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeSleepSchedule(sleepSchedule === o.value ? null : o.value as SleepScheduleValue)}
                >
                  <Text style={[styles.optionChipText, sleepSchedule === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Travel Style (optional)</Text>
            <View style={styles.optionsRow}>
              {TRAVEL_STYLE_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, travelStyle === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeTravelStyle(travelStyle === o.value ? null : o.value as TravelStyleValue)}
                >
                  <Text style={[styles.optionChipText, travelStyle === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Work Style (optional)</Text>
            <View style={styles.optionsRow}>
              {WORK_STYLE_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, workStyle === o.value && styles.optionChipSelected]}
                  onPress={() => onChangeWorkStyle(workStyle === o.value ? null : o.value as WorkStyleValue)}
                >
                  <Text style={[styles.optionChipText, workStyle === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.inputRow}>
            <Text style={styles.label}>Core Values (select up to 3)</Text>
            <View style={styles.optionsRow}>
              {CORE_VALUES_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.optionChip, coreValues.includes(o.value) && styles.optionChipSelected]}
                  onPress={() => onToggleCoreValue(o.value)}
                >
                  <Text style={[styles.optionChipText, coreValues.includes(o.value) && styles.optionChipTextSelected]}>{o.label}</Text>
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
