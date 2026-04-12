/**
 * PromptsSection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles 4-section prompts with accordion-style UI.
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
  BUILDER_PROMPTS,
  PERFORMER_PROMPTS,
  SEEKER_PROMPTS,
  GROUNDED_PROMPTS,
  PROMPT_ANSWER_MIN_LENGTH,
  PROMPT_ANSWER_MAX_LENGTH,
  TOTAL_SECTIONS,
} from '@/lib/constants';

// Section-based prompt types
type SectionKey = 'builder' | 'performer' | 'seeker' | 'grounded';
type SectionPromptEntry = { section: SectionKey; question: string; answer: string };

// Section configuration for prompts with display labels (Section 1-4)
const PROMPT_SECTIONS: { key: SectionKey; label: string; questions: { id: string; text: string }[] }[] = [
  { key: 'builder', label: 'Section 1', questions: BUILDER_PROMPTS },
  { key: 'performer', label: 'Section 2', questions: PERFORMER_PROMPTS },
  { key: 'seeker', label: 'Section 3', questions: SEEKER_PROMPTS },
  { key: 'grounded', label: 'Section 4', questions: GROUNDED_PROMPTS },
];

interface PromptsSectionProps {
  expanded: boolean;
  onToggleExpand: () => void;
  sectionAnswers: Record<SectionKey, SectionPromptEntry | null>;
  activePromptSection: SectionKey | null;
  onTogglePromptSection: (sectionKey: SectionKey) => void;
  onSelectQuestion: (sectionKey: SectionKey, questionText: string) => void;
  onUpdateSectionAnswer: (sectionKey: SectionKey, answer: string) => void;
}

export function PromptsSection({
  expanded,
  onToggleExpand,
  sectionAnswers,
  activePromptSection,
  onTogglePromptSection,
  onSelectQuestion,
  onUpdateSectionAnswer,
}: PromptsSectionProps) {
  // Compute filled prompts
  const filledPrompts = Object.values(sectionAnswers)
    .filter((entry): entry is SectionPromptEntry => entry !== null && entry.answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH)
    .map((entry) => ({ question: entry.question, answer: entry.answer }));

  const filledSectionCount = filledPrompts.length;
  const allSectionsFilled = filledSectionCount === TOTAL_SECTIONS;

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.reviewHeader} onPress={onToggleExpand} activeOpacity={0.7}>
        <View style={styles.reviewHeaderLeft}>
          <Text style={styles.reviewSectionTitle}>Prompts</Text>
          <Text style={styles.reviewSummary}>
            {filledSectionCount > 0
              ? `${filledSectionCount} of ${TOTAL_SECTIONS} sections`
              : 'Add prompts'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {allSectionsFilled && <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={COLORS.textMuted}
          />
        </View>
      </TouchableOpacity>

      {/* Collapsed: Show prompt previews */}
      {!expanded && filledPrompts.length > 0 && (
        <View style={styles.reviewPreviewList}>
          {filledPrompts.slice(0, 2).map((prompt, idx) => (
            <View key={idx} style={styles.reviewPreviewItem}>
              <Text style={styles.reviewPreviewQuestion} numberOfLines={1}>{prompt.question}</Text>
              <Text style={styles.reviewPreviewAnswer} numberOfLines={1}>{prompt.answer}</Text>
            </View>
          ))}
          {filledPrompts.length > 2 && (
            <Text style={styles.reviewMoreText}>+{filledPrompts.length - 2} more</Text>
          )}
        </View>
      )}

      {/* Expanded: Section-based edit UI (Section 1-4 accordion style) */}
      {expanded && (
        <View style={styles.expandedContent}>
          <Text style={styles.promptSectionHint}>Choose 1 question from each section:</Text>
          {PROMPT_SECTIONS.map((section) => {
            const currentAnswer = sectionAnswers[section.key];
            const isExpanded = activePromptSection === section.key;
            const hasValidAnswer = currentAnswer && currentAnswer.answer.trim().length >= PROMPT_ANSWER_MIN_LENGTH;

            return (
              <View key={section.key} style={styles.promptSectionContainer}>
                {/* Section Header - simple accordion style */}
                <TouchableOpacity
                  style={[styles.promptSectionHeader, hasValidAnswer && styles.promptSectionHeaderComplete]}
                  onPress={() => onTogglePromptSection(section.key)}
                  activeOpacity={0.7}
                >
                  <View style={styles.promptSectionHeaderLeft}>
                    <Text style={styles.promptSectionTitle}>{section.label}</Text>
                    {hasValidAnswer && <Ionicons name="checkmark-circle" size={16} color={COLORS.success} style={{ marginLeft: 8 }} />}
                  </View>
                  <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
                </TouchableOpacity>

                {/* Section Content (expanded) */}
                {isExpanded && (
                  <View style={styles.promptSectionContent}>
                    {section.questions.map((question) => {
                      const isSelected = currentAnswer?.question === question.text;
                      return (
                        <View key={question.id}>
                          <TouchableOpacity
                            style={[styles.promptQuestionOption, isSelected && styles.promptQuestionSelected]}
                            onPress={() => onSelectQuestion(section.key, question.text)}
                            activeOpacity={0.7}
                          >
                            <Ionicons
                              name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                              size={18}
                              color={isSelected ? COLORS.primary : COLORS.textMuted}
                            />
                            <Text style={[styles.promptQuestionText, isSelected && styles.promptQuestionTextSelected]}>
                              {question.text}
                            </Text>
                          </TouchableOpacity>
                          {isSelected && (
                            <View style={styles.promptAnswerBox}>
                              <TextInput
                                style={styles.promptAnswerInput}
                                value={currentAnswer?.answer || ''}
                                onChangeText={(t) => onUpdateSectionAnswer(section.key, t)}
                                placeholder="Type your answer..."
                                placeholderTextColor={COLORS.textMuted}
                                multiline
                                maxLength={PROMPT_ANSWER_MAX_LENGTH}
                                textAlignVertical="top"
                              />
                              <View style={styles.promptAnswerFooter}>
                                {currentAnswer?.answer && currentAnswer.answer.trim().length > 0 &&
                                  currentAnswer.answer.trim().length < PROMPT_ANSWER_MIN_LENGTH && (
                                  <Text style={styles.promptMinCharWarn}>
                                    {PROMPT_ANSWER_MIN_LENGTH - currentAnswer.answer.trim().length} more chars
                                  </Text>
                                )}
                                <Text style={styles.promptCharCount}>
                                  {currentAnswer?.answer?.length || 0}/{PROMPT_ANSWER_MAX_LENGTH}
                                </Text>
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Collapsed preview */}
                {!isExpanded && currentAnswer && (
                  <View style={styles.promptCollapsedPreview}>
                    <Text style={styles.promptCollapsedQuestion} numberOfLines={1}>{currentAnswer.question}</Text>
                    {currentAnswer.answer && (
                      <Text style={styles.promptCollapsedAnswer} numberOfLines={1}>{currentAnswer.answer}</Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
          {!allSectionsFilled && (
            <View style={styles.promptValidationHint}>
              <Ionicons name="information-circle" size={16} color={COLORS.warning} />
              <Text style={styles.promptValidationText}>
                Complete all {TOTAL_SECTIONS} sections ({PROMPT_ANSWER_MIN_LENGTH}+ chars each)
              </Text>
            </View>
          )}
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
  reviewPreviewList: {
    marginTop: 12,
  },
  reviewPreviewItem: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.primary,
  },
  reviewPreviewQuestion: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  reviewPreviewAnswer: {
    fontSize: 14,
    color: COLORS.text,
  },
  reviewMoreText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
    paddingTop: 4,
  },
  expandedContent: {
    marginTop: 16,
  },
  promptSectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12, fontWeight: '500' },
  promptSectionContainer: { marginBottom: 12, borderRadius: 10, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  promptSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14 },
  promptSectionHeaderComplete: { borderLeftWidth: 3, borderLeftColor: COLORS.success },
  promptSectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  promptSectionTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  promptSectionContent: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  promptQuestionOption: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, paddingHorizontal: 6, borderRadius: 6, marginTop: 8, gap: 8 },
  promptQuestionSelected: { backgroundColor: COLORS.primary + '15' },
  promptQuestionText: { fontSize: 13, color: COLORS.text, flex: 1, lineHeight: 18 },
  promptQuestionTextSelected: { fontWeight: '500', color: COLORS.primary },
  promptAnswerBox: { marginLeft: 26, marginTop: 6, marginBottom: 6, backgroundColor: COLORS.background, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: COLORS.primary },
  promptAnswerInput: { fontSize: 14, color: COLORS.text, minHeight: 50, maxHeight: 100, lineHeight: 18, padding: 0 },
  promptAnswerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  promptMinCharWarn: { fontSize: 11, color: COLORS.warning, fontWeight: '500' },
  promptCharCount: { fontSize: 10, color: COLORS.textMuted },
  promptCollapsedPreview: { paddingHorizontal: 12, paddingBottom: 10, marginLeft: 42 },
  promptCollapsedQuestion: { fontSize: 12, color: COLORS.textLight, fontWeight: '500' },
  promptCollapsedAnswer: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  promptValidationHint: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.warning + '15', padding: 10, borderRadius: 8, marginTop: 4, gap: 6 },
  promptValidationText: { fontSize: 12, color: COLORS.warning, flex: 1 },
});
