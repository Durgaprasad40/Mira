import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';

interface MicroSurveyQuestion {
  id: string;
  text: string;
  options: string[];
}

interface MicroSurveyModalProps {
  visible: boolean;
  question: MicroSurveyQuestion;
  onSubmit: (questionId: string, questionText: string, response: string) => void;
  onCancel: () => void;
}

export function MicroSurveyModal({ visible, question, onSubmit, onCancel }: MicroSurveyModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSubmit = () => {
    if (selected && question) {
      onSubmit(question.id, question.text, selected);
      setSelected(null);
    }
  };

  if (!question) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeBtn} onPress={onCancel}>
            <Ionicons name="close" size={24} color={COLORS.textLight} />
          </TouchableOpacity>
          <Text style={styles.title}>Quick Question</Text>
          <Text style={styles.question}>{question.text}</Text>
          <View style={styles.options}>
            {question.options.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.option, selected === option && styles.optionSelected]}
                onPress={() => setSelected(option)}
              >
                <Text style={[styles.optionText, selected === option && styles.optionTextSelected]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.submitBtn, !selected && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!selected}
          >
            <Text style={styles.submitText}>Submit</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  question: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 16,
  },
  options: {
    gap: 8,
    marginBottom: 16,
  },
  option: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  optionText: {
    fontSize: 15,
    color: COLORS.text,
  },
  optionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
