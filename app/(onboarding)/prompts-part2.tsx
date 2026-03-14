/**
 * Phase-1 Onboarding: Prompts Part 2 (Section Prompts)
 *
 * 4 collapsible sections, each with 4 descriptive text prompts:
 * 1. Builder/Alchemist - Creative & project-oriented
 * 2. Performer/Artist - Expression & entertainment
 * 3. Seeker/Explorer - Adventure & discovery
 * 4. Grounded/Zen - Values & inner peace
 *
 * Minimum 1 answer per section required to continue.
 * 200 character limit per answer.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  SECTION_PROMPTS,
  SECTION_LABELS,
  PROMPT_ANSWER_MAX_LENGTH,
  MIN_ANSWERS_PER_SECTION,
  PromptSectionKey,
  SectionPromptAnswer,
} from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';
import { useScreenTrace } from '@/lib/devTrace';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SECTION_KEYS: PromptSectionKey[] = ['builder', 'performer', 'seeker', 'grounded'];

export default function PromptsPart2Screen() {
  useScreenTrace('ONB_PROMPTS_PART2');

  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams<{ editFromReview?: string }>();
  const isEditFromReview = params.editFromReview === 'true';

  // Store state and actions
  const {
    sectionPrompts,
    setSectionPromptAnswer,
    removeSectionPromptAnswer,
    setStep,
  } = useOnboardingStore();

  // Local state for UI
  const [expandedSections, setExpandedSections] = useState<Record<PromptSectionKey, boolean>>({
    builder: true,
    performer: false,
    seeker: false,
    grounded: false,
  });

  // Local answers state for immediate feedback
  const [localAnswers, setLocalAnswers] = useState<Record<PromptSectionKey, Record<string, string>>>({
    builder: {},
    performer: {},
    seeker: {},
    grounded: {},
  });

  // Initialize local state from store
  useEffect(() => {
    const initial: Record<PromptSectionKey, Record<string, string>> = {
      builder: {},
      performer: {},
      seeker: {},
      grounded: {},
    };
    SECTION_KEYS.forEach((key) => {
      sectionPrompts[key].forEach((item: SectionPromptAnswer) => {
        initial[key][item.question] = item.answer;
      });
    });
    setLocalAnswers(initial);
  }, []);

  // Toggle section expansion
  const toggleSection = useCallback((section: PromptSectionKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  // Update answer for a prompt
  const handleAnswerChange = useCallback((section: PromptSectionKey, question: string, answer: string) => {
    setLocalAnswers((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [question]: answer,
      },
    }));
  }, []);

  // Count filled answers per section
  const getFilledCount = (section: PromptSectionKey): number => {
    return Object.values(localAnswers[section]).filter((a) => a.trim().length > 0).length;
  };

  // Validation: at least 1 answer per section
  const canContinue = SECTION_KEYS.every((key) => getFilledCount(key) >= MIN_ANSWERS_PER_SECTION);

  // Get validation status text for section
  const getSectionStatus = (section: PromptSectionKey): { text: string; isValid: boolean } => {
    const count = getFilledCount(section);
    const isValid = count >= MIN_ANSWERS_PER_SECTION;
    return {
      text: `${count}/4 answered`,
      isValid,
    };
  };

  const handleContinue = () => {
    if (!canContinue) return;

    // Save all answers to store
    SECTION_KEYS.forEach((section) => {
      // First clear existing answers for this section
      sectionPrompts[section].forEach((item: SectionPromptAnswer) => {
        if (!localAnswers[section][item.question]?.trim()) {
          removeSectionPromptAnswer(section, item.question);
        }
      });

      // Then add/update current answers
      Object.entries(localAnswers[section]).forEach(([question, answer]) => {
        if (answer.trim().length > 0) {
          setSectionPromptAnswer(section, question, answer.trim());
        }
      });
    });

    // Navigate
    if (isEditFromReview) {
      if (__DEV__) console.log('[ONB] prompts-part2 -> review (editFromReview)');
      router.replace('/(onboarding)/review' as any);
    } else {
      if (__DEV__) console.log('[ONB] prompts-part2 -> profile-details');
      setStep('profile_details');
      router.push('/(onboarding)/profile-details' as any);
    }
  };

  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] prompts-part2 -> back');
    router.back();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <OnboardingProgressHeader />
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Tell us more</Text>
          <Text style={styles.subtitle}>
            Answer at least 1 prompt from each section to continue. These help others know you better.
          </Text>

          {/* Section Accordions */}
          {SECTION_KEYS.map((sectionKey) => {
            const label = SECTION_LABELS[sectionKey];
            const prompts = SECTION_PROMPTS[sectionKey];
            const isExpanded = expandedSections[sectionKey];
            const status = getSectionStatus(sectionKey);

            return (
              <View key={sectionKey} style={styles.section}>
                {/* Section Header */}
                <TouchableOpacity
                  style={[
                    styles.sectionHeader,
                    !status.isValid && styles.sectionHeaderError,
                  ]}
                  onPress={() => toggleSection(sectionKey)}
                  activeOpacity={0.7}
                >
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionEmoji}>{label.emoji}</Text>
                    <View style={styles.sectionTitleContainer}>
                      <Text style={styles.sectionTitle}>{label.title}</Text>
                      <Text style={styles.sectionDescription}>{label.description}</Text>
                    </View>
                  </View>
                  <View style={styles.sectionRight}>
                    <Text
                      style={[
                        styles.sectionStatus,
                        status.isValid ? styles.sectionStatusValid : styles.sectionStatusInvalid,
                      ]}
                    >
                      {status.text}
                    </Text>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={COLORS.textMuted}
                    />
                  </View>
                </TouchableOpacity>

                {/* Section Content (prompts) */}
                {isExpanded && (
                  <View style={styles.sectionContent}>
                    {prompts.map((prompt, index) => {
                      const answer = localAnswers[sectionKey][prompt.text] || '';
                      return (
                        <View key={prompt.id} style={styles.promptCard}>
                          <Text style={styles.promptQuestion}>{prompt.text}</Text>
                          <TextInput
                            style={styles.promptInput}
                            value={answer}
                            onChangeText={(text) => handleAnswerChange(sectionKey, prompt.text, text)}
                            placeholder="Type your answer..."
                            placeholderTextColor={COLORS.textMuted}
                            multiline
                            maxLength={PROMPT_ANSWER_MAX_LENGTH}
                            textAlignVertical="top"
                          />
                          <Text style={styles.charCount}>
                            {answer.length}/{PROMPT_ANSWER_MAX_LENGTH}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

          {/* Validation hint */}
          {!canContinue && (
            <View style={styles.validationHint}>
              <Ionicons name="information-circle" size={18} color={COLORS.warning} />
              <Text style={styles.validationHintText}>
                Answer at least 1 prompt in each section to continue
              </Text>
            </View>
          )}

          {/* Footer */}
          <View style={styles.footer}>
            <Button
              title="Continue"
              variant="primary"
              onPress={handleContinue}
              disabled={!canContinue}
              fullWidth
            />
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.navButton} onPress={handlePrevious}>
                <Text style={styles.navText}>Previous</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  flex1: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 24,
    lineHeight: 22,
  },
  section: {
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: COLORS.backgroundDark,
  },
  sectionHeaderError: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.warning,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  sectionEmoji: {
    fontSize: 24,
  },
  sectionTitleContainer: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  sectionDescription: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  sectionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionStatus: {
    fontSize: 12,
    fontWeight: '500',
  },
  sectionStatusValid: {
    color: COLORS.success,
  },
  sectionStatusInvalid: {
    color: COLORS.textMuted,
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  promptCard: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  promptQuestion: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 10,
  },
  promptInput: {
    fontSize: 15,
    color: COLORS.text,
    minHeight: 60,
    maxHeight: 100,
    lineHeight: 20,
    padding: 0,
  },
  charCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 6,
  },
  validationHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning + '15',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    gap: 8,
  },
  validationHintText: {
    fontSize: 13,
    color: COLORS.warning,
    flex: 1,
  },
  footer: {
    marginTop: 24,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  navButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  navText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
});
