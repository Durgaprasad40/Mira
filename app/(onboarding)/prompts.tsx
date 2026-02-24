import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, PROFILE_PROMPT_QUESTIONS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';

const MAX_PROMPTS = 3;
const MAX_ANSWER_LENGTH = 200;

export default function PromptsScreen() {
  const { profilePrompts, setProfilePrompts, setStep } = useOnboardingStore();
  const router = useRouter();

  const [prompts, setPrompts] = useState<{ question: string; answer: string }[]>(
    profilePrompts.length > 0 ? profilePrompts : []
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);

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
  };

  const handleDeletePrompt = (index: number) => {
    const updated = prompts.filter((_, i) => i !== index);
    setPrompts(updated);
    if (editingIndex === index) setEditingIndex(null);
    else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const filledPrompts = prompts.filter((p) => p.answer.trim().length > 0);

  const handleNext = () => {
    if (__DEV__) console.log('[ONB] prompts → profile-details (continue)');
    setProfilePrompts(filledPrompts);
    setStep('profile_details');
    router.push('/(onboarding)/profile-details' as any);
  };

  // POST-VERIFICATION: Skip advances to next step
  const handleSkip = () => {
    if (__DEV__) console.log('[ONB] prompts → profile-details (skip)');
    setStep('profile_details');
    router.push('/(onboarding)/profile-details' as any);
  };

  // POST-VERIFICATION: Previous goes back
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] prompts → bio (previous)');
    setStep('bio');
    router.push('/(onboarding)/bio' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profile prompts</Text>
      <Text style={styles.subtitle}>
        Answer prompts to let others know more about you. At least 1 is required, up to 3 max.
      </Text>

      {prompts.map((prompt, index) => (
        <View key={index} style={styles.promptCard}>
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
          style={styles.addButton}
          onPress={() => setShowPicker(true)}
        >
          <Ionicons name="add-circle-outline" size={22} color={COLORS.primary} />
          <Text style={styles.addButtonText}>
            Add a prompt ({prompts.length}/{MAX_PROMPTS})
          </Text>
        </TouchableOpacity>
      )}

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
          disabled={filledPrompts.length < 1}
          fullWidth
        />
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navButton} onPress={handlePrevious}>
            <Text style={styles.navText}>Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navButton} onPress={handleSkip}>
            <Text style={styles.navText}>Skip</Text>
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
