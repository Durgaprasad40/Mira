/**
 * Phase-2 Edit Prompts Screen
 *
 * Edit prompt answers from profile WITHOUT going through onboarding flow.
 * This is a dedicated edit screen that loads existing answers and saves changes.
 *
 * IMPORTANT:
 * - No onboarding progress indicators
 * - No step navigation
 * - Just edit and save
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  PHASE2_SECTION1_PROMPTS,
  PHASE2_SECTION2_PROMPTS,
  PHASE2_SECTION3_PROMPTS,
  PHASE2_PROMPT_MIN_TEXT_LENGTH,
  PHASE2_PROMPT_MAX_TEXT_LENGTH,
  Phase2PromptAnswer,
} from '@/lib/privateConstants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;

type SectionKey = 'section1' | 'section2' | 'section3';

export default function EditPromptsScreen() {
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);

  // Auth
  const { userId } = useAuthStore();
  const updatePrivateProfile = useMutation(api.privateProfiles.updateFieldsByAuthId);

  // Store
  const promptAnswers = usePrivateProfileStore((s) => s.promptAnswers);
  const setPromptAnswer = usePrivateProfileStore((s) => s.setPromptAnswer);
  const removePromptAnswer = usePrivateProfileStore((s) => s.removePromptAnswer);

  // Local state
  const [expandedSection, setExpandedSection] = useState<SectionKey | null>('section1');
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Get current answer for a prompt
  const getAnswer = useCallback(
    (promptId: string) => {
      return promptAnswers.find((a) => a.promptId === promptId)?.answer || '';
    },
    [promptAnswers]
  );

  // Check if prompt is answered
  const isAnswered = useCallback(
    (promptId: string) => {
      const answer = getAnswer(promptId);
      return answer.trim().length > 0;
    },
    [getAnswer]
  );

  // Toggle section expansion
  const toggleSection = (section: SectionKey) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  // Start editing a prompt
  const startEditing = (promptId: string, question: string) => {
    setEditingPrompt(promptId);
    setDraftAnswer(getAnswer(promptId));
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingPrompt(null);
    setDraftAnswer('');
    Keyboard.dismiss();
  };

  // Save answer for a prompt
  const saveAnswer = (promptId: string, question: string) => {
    if (draftAnswer.trim().length >= PHASE2_PROMPT_MIN_TEXT_LENGTH) {
      setPromptAnswer(promptId, question, draftAnswer.trim());
    } else if (draftAnswer.trim().length === 0) {
      removePromptAnswer(promptId);
    }
    setEditingPrompt(null);
    setDraftAnswer('');
    Keyboard.dismiss();
  };

  // Select answer for multiple choice (Section 1)
  const selectMultipleChoiceAnswer = (promptId: string, question: string, option: string) => {
    const current = getAnswer(promptId);
    if (current === option) {
      removePromptAnswer(promptId);
    } else {
      setPromptAnswer(promptId, question, option);
    }
  };

  // Save all changes to backend
  const handleSave = async () => {
    if (isDemoMode) {
      router.back();
      return;
    }

    if (!userId) {
      Alert.alert('Error', 'Please sign in to save changes.');
      return;
    }

    setIsSaving(true);
    try {
      await updatePrivateProfile({
        authUserId: userId,
        promptAnswers: promptAnswers,
      });
      router.back();
    } catch (error) {
      if (__DEV__) {
        console.error('[EditPrompts] Save failed:', error);
      }
      Alert.alert('Error', 'Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Count answered prompts per section
  const getAnsweredCount = (prompts: ReadonlyArray<{ readonly id: string }>) => {
    return prompts.filter((p) => isAnswered(p.id)).length;
  };

  // Render Section 1 (Multiple Choice)
  const renderSection1 = () => {
    const isExpanded = expandedSection === 'section1';
    const answeredCount = getAnsweredCount(PHASE2_SECTION1_PROMPTS);

    return (
      <View style={styles.sectionCard}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => toggleSection('section1')}
          activeOpacity={0.7}
        >
          <View style={styles.sectionHeaderLeft}>
            <Text style={styles.sectionTitle}>Quick Questions</Text>
            <Text style={styles.sectionSubtitle}>{answeredCount}/3 answered</Text>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={C.textLight}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.sectionContent}>
            {PHASE2_SECTION1_PROMPTS.map((prompt) => {
              const currentAnswer = getAnswer(prompt.id);
              return (
                <View key={prompt.id} style={styles.promptBlock}>
                  <Text style={styles.promptQuestion}>{prompt.question}</Text>
                  <View style={styles.optionsGrid}>
                    {prompt.options.map((option) => (
                      <TouchableOpacity
                        key={option}
                        style={[
                          styles.optionChip,
                          currentAnswer === option && styles.optionChipSelected,
                        ]}
                        onPress={() => selectMultipleChoiceAnswer(prompt.id, prompt.question, option)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            currentAnswer === option && styles.optionTextSelected,
                          ]}
                        >
                          {option}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  // Render text input sections (Section 2 & 3)
  const renderTextSection = (
    sectionKey: 'section2' | 'section3',
    title: string,
    prompts: ReadonlyArray<{ readonly id: string; readonly question: string }>
  ) => {
    const isExpanded = expandedSection === sectionKey;
    const answeredCount = getAnsweredCount(prompts);

    return (
      <View style={styles.sectionCard}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => toggleSection(sectionKey)}
          activeOpacity={0.7}
        >
          <View style={styles.sectionHeaderLeft}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionSubtitle}>{answeredCount}/3 answered</Text>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={C.textLight}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.sectionContent}>
            {prompts.map((prompt) => {
              const currentAnswer = getAnswer(prompt.id);
              const isEditing = editingPrompt === prompt.id;

              return (
                <View key={prompt.id} style={styles.promptBlock}>
                  <Text style={styles.promptQuestion}>{prompt.question}</Text>

                  {isEditing ? (
                    <View style={styles.editArea}>
                      <TextInput
                        style={styles.textInput}
                        value={draftAnswer}
                        onChangeText={setDraftAnswer}
                        placeholder="Type your answer..."
                        placeholderTextColor={C.textLight}
                        multiline
                        maxLength={PHASE2_PROMPT_MAX_TEXT_LENGTH}
                        autoFocus
                      />
                      <Text style={styles.charCount}>
                        {draftAnswer.length}/{PHASE2_PROMPT_MAX_TEXT_LENGTH}
                      </Text>
                      <View style={styles.editActions}>
                        <TouchableOpacity
                          style={styles.cancelBtn}
                          onPress={cancelEditing}
                        >
                          <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.saveBtn,
                            draftAnswer.trim().length < PHASE2_PROMPT_MIN_TEXT_LENGTH &&
                              draftAnswer.trim().length > 0 &&
                              styles.saveBtnDisabled,
                          ]}
                          onPress={() => saveAnswer(prompt.id, prompt.question)}
                        >
                          <Text style={styles.saveBtnText}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : currentAnswer ? (
                    <TouchableOpacity
                      style={styles.answerCard}
                      onPress={() => startEditing(prompt.id, prompt.question)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.answerText} numberOfLines={3}>
                        {currentAnswer}
                      </Text>
                      <Ionicons name="pencil" size={14} color={C.primary} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.addAnswerBtn}
                      onPress={() => startEditing(prompt.id, prompt.question)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={18} color={C.primary} />
                      <Text style={styles.addAnswerText}>Add answer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Answers</Text>
          <TouchableOpacity
            style={[styles.doneBtn, isSaving && styles.doneBtnDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            <Text style={styles.doneBtnText}>{isSaving ? 'Saving...' : 'Done'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {renderSection1()}
          {renderTextSection('section2', 'Your Values', PHASE2_SECTION2_PROMPTS)}
          {renderTextSection('section3', 'Your Personality', PHASE2_SECTION3_PROMPTS)}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  doneBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: C.primary,
    borderRadius: 16,
  },
  doneBtnDisabled: {
    opacity: 0.6,
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  sectionHeaderLeft: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 2,
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  promptBlock: {
    marginBottom: 20,
  },
  promptQuestion: {
    fontSize: 14,
    fontWeight: '500',
    color: C.text,
    marginBottom: 10,
    lineHeight: 20,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: C.accent,
    borderWidth: 1,
    borderColor: C.border,
  },
  optionChipSelected: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  optionText: {
    fontSize: 13,
    color: C.text,
  },
  optionTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  editArea: {
    backgroundColor: C.accent,
    borderRadius: 12,
    padding: 12,
  },
  textInput: {
    fontSize: 15,
    color: C.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 11,
    color: C.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    fontSize: 14,
    color: C.textLight,
  },
  saveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: C.primary,
    borderRadius: 16,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  answerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.accent,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
  },
  answerText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
    marginRight: 8,
  },
  addAnswerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
  },
  addAnswerText: {
    fontSize: 14,
    color: C.primary,
    fontWeight: '500',
  },
});
