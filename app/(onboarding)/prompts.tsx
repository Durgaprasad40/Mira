import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, PROFILE_PROMPT_QUESTIONS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Ionicons } from '@expo/vector-icons';
import { scrollToFirstInvalid } from '@/lib/onboardingValidation';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';

const MAX_PROMPTS = 3;
const MAX_ANSWER_LENGTH = 200;

export default function PromptsScreen() {
  const { profilePrompts, setProfilePrompts, setStep } = useOnboardingStore();
  const { userId } = useAuthStore();
  const demoHydrated = useDemoStore((s) => s._hasHydrated);
  const demoProfile = useDemoStore((s) =>
    isDemoMode && userId ? s.demoProfiles[userId] : null
  );
  const router = useRouter();
  const params = useLocalSearchParams<{ editFromReview?: string }>();

  // CENTRAL EDIT HUB: Detect if editing from Review screen
  const isEditFromReview = params.editFromReview === 'true';

  const [prompts, setPrompts] = useState<{ question: string; answer: string }[]>(
    profilePrompts.length > 0 ? profilePrompts : []
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showTopError, setShowTopError] = useState(false);
  const [promptsError, setPromptsError] = useState('');

  // Refs for scroll-to-invalid behavior
  const scrollRef = useRef<ScrollView>(null);
  const promptsSectionRef = useRef<View>(null);

  // Prefill from demoProfiles if onboardingStore is empty
  useEffect(() => {
    if (isDemoMode && demoHydrated && demoProfile?.profilePrompts && prompts.length === 0) {
      const saved = demoProfile.profilePrompts;
      if (saved.length > 0) {
        console.log(`[PROMPTS] prefilled ${saved.length} prompts from demoProfile`);
        setPrompts(saved);
        setProfilePrompts(saved);
      }
    }
  }, [demoHydrated, demoProfile]);

  const usedQuestions = prompts.map((p) => p.question);
  const availableQuestions = PROFILE_PROMPT_QUESTIONS.filter(
    (q) => !usedQuestions.includes(q.text)
  );

  const handleSelectQuestion = (questionText: string) => {
    const newPrompts = [...prompts, { question: questionText, answer: '' }];
    setPrompts(newPrompts);
    setEditingIndex(newPrompts.length - 1);
    setShowPicker(false);
  };

  const handleUpdateAnswer = (index: number, answer: string) => {
    const updated = [...prompts];
    updated[index] = { ...updated[index], answer };
    setPrompts(updated);
    // Clear error when user types an answer
    if (answer.trim().length > 0 && promptsError) {
      setPromptsError('');
      setShowTopError(false);
    }
  };

  const handleDeletePrompt = (index: number) => {
    const updated = prompts.filter((_, i) => i !== index);
    setPrompts(updated);
    if (editingIndex === index) setEditingIndex(null);
    else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  // Count prompts with non-empty answers (trimmed)
  const filledPrompts = prompts.filter((p) => p.answer.trim().length > 0);

  const handleNext = () => {
    // Validate: at least 1 prompt must be answered
    if (filledPrompts.length < 1) {
      setPromptsError('Answer at least 1 prompt to continue.');
      setShowTopError(true);
      // Scroll to prompts section
      scrollToFirstInvalid(scrollRef, { prompts: promptsSectionRef }, 'prompts');
      return;
    }

    // Clear errors and proceed
    setPromptsError('');
    setShowTopError(false);

    // Save to onboardingStore
    setProfilePrompts(filledPrompts);

    // SAVE-AS-YOU-GO: Persist to demoProfiles immediately
    if (isDemoMode && userId) {
      const demoStore = useDemoStore.getState();
      demoStore.saveDemoProfile(userId, { profilePrompts: filledPrompts });
      console.log(`[PROMPTS] saved ${filledPrompts.length} prompts to demoProfile`);
    }

    // CENTRAL EDIT HUB: Return to Review if editing from there
    if (isEditFromReview) {
      if (__DEV__) console.log('[ONB] prompts → review (editFromReview)');
      router.replace('/(onboarding)/review' as any);
      return;
    }

    if (__DEV__) console.log('[ONB] prompts → profile-details (continue)');
    setStep('profile_details');
    router.push('/(onboarding)/profile-details' as any);
  };

  // Previous goes back (respects navigation history)
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] prompts → back (previous)');
    router.back();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <OnboardingProgressHeader />
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content}>
      {/* Top error banner */}
      {showTopError && (
        <View style={styles.topErrorBanner}>
          <Text style={styles.topErrorText}>Please complete highlighted fields.</Text>
        </View>
      )}

      <Text style={styles.title}>Profile prompts</Text>
      <Text style={styles.subtitle}>
        Answer prompts to let others know more about you. At least 1 is required, up to 3 max.
      </Text>

      {/* Prompts section with ref for scroll-to */}
      <View ref={promptsSectionRef}>
      {prompts.map((prompt, index) => (
        <View key={index} style={[styles.promptCard, promptsError ? styles.promptCardError : null]}>
          <View style={styles.promptHeader}>
            <Text style={styles.promptQuestion}>{prompt.question}</Text>
            <TouchableOpacity onPress={() => handleDeletePrompt(index)}>
              <Ionicons name="close-circle" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          {index === 0 && prompts.length === 1 && !prompt.answer.trim() && (
            <Text style={styles.requiredLabel}>Required</Text>
          )}
          <TextInput
            style={styles.answerInput}
            value={prompt.answer}
            onChangeText={(text) => handleUpdateAnswer(index, text)}
            placeholder="Type your answer..."
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={MAX_ANSWER_LENGTH}
            autoFocus={editingIndex === index}
            onFocus={() => setEditingIndex(index)}
          />
          <Text style={styles.charCount}>
            {prompt.answer.length}/{MAX_ANSWER_LENGTH}
          </Text>
        </View>
      ))}

      {prompts.length < MAX_PROMPTS && !showPicker && (
        <TouchableOpacity
          style={[styles.addButton, promptsError ? styles.addButtonError : null]}
          onPress={() => setShowPicker(true)}
        >
          <Ionicons name="add-circle-outline" size={22} color={promptsError ? COLORS.error : COLORS.primary} />
          <Text style={[styles.addButtonText, promptsError ? styles.addButtonTextError : null]}>
            Add a prompt ({prompts.length}/{MAX_PROMPTS})
          </Text>
        </TouchableOpacity>
      )}

      {/* Inline error for prompts section */}
      {promptsError ? <Text style={styles.fieldError}>{promptsError}</Text> : null}
      </View>

      {showPicker && (
        <View style={styles.pickerContainer}>
          <Text style={styles.pickerTitle}>Choose a prompt</Text>
          {availableQuestions.map((q) => (
            <TouchableOpacity
              key={q.id}
              style={styles.pickerOption}
              onPress={() => handleSelectQuestion(q.text)}
            >
              <Text style={styles.pickerOptionText}>{q.text}</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.pickerCancel}
            onPress={() => setShowPicker(false)}
          >
            <Text style={styles.pickerCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          fullWidth
        />
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navButton} onPress={handlePrevious}>
            <Text style={styles.navText}>Previous</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 24,
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
  promptCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  promptCardError: {
    borderLeftColor: COLORS.error,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  topErrorBanner: {
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error + '40',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  topErrorText: {
    fontSize: 14,
    color: COLORS.error,
    fontWeight: '500',
    textAlign: 'center',
  },
  fieldError: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 4,
    marginBottom: 8,
  },
  promptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  promptQuestion: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  requiredLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  answerInput: {
    fontSize: 16,
    color: COLORS.text,
    minHeight: 60,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
    borderStyle: 'dashed',
    marginBottom: 16,
    gap: 8,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  addButtonError: {
    borderColor: COLORS.error,
  },
  addButtonTextError: {
    color: COLORS.error,
  },
  pickerContainer: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  pickerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pickerOptionText: {
    fontSize: 15,
    color: COLORS.text,
    flex: 1,
  },
  pickerCancel: {
    alignItems: 'center',
    paddingTop: 12,
  },
  pickerCancelText: {
    fontSize: 14,
    color: COLORS.textMuted,
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
