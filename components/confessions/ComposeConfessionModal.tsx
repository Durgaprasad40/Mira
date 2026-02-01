import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { ConfessionMood } from '@/types';

const MOOD_OPTIONS: { value: ConfessionMood; emoji: string; label: string; color: string }[] = [
  { value: 'romantic', emoji: '\u2764\uFE0F', label: 'Romantic', color: '#E91E63' },
  { value: 'spicy', emoji: '\uD83D\uDD25', label: 'Spicy', color: '#FF5722' },
  { value: 'emotional', emoji: '\uD83D\uDE22', label: 'Emotional', color: '#2196F3' },
  { value: 'funny', emoji: '\uD83D\uDE02', label: 'Funny', color: '#FF9800' },
];

interface ComposeConfessionModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (text: string, isAnonymous: boolean, mood: ConfessionMood) => void;
}

export default function ComposeConfessionModal({
  visible,
  onClose,
  onSubmit,
}: ComposeConfessionModalProps) {
  const [text, setText] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [mood, setMood] = useState<ConfessionMood>('emotional');

  const canSubmit = text.trim().length >= 10;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(text.trim(), isAnonymous, mood);
    setText('');
    setIsAnonymous(true);
    setMood('emotional');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Confession</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          >
            <Text style={[styles.submitText, !canSubmit && styles.submitTextDisabled]}>
              Post
            </Text>
          </TouchableOpacity>
        </View>

        {/* Text Input */}
        <TextInput
          style={styles.textInput}
          placeholder="What's on your mind? Share your confession..."
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={500}
          value={text}
          onChangeText={setText}
          autoFocus
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{text.length}/500</Text>

        {/* Mood Picker */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Mood</Text>
          <View style={styles.moodRow}>
            {MOOD_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.moodChip,
                  mood === option.value && { backgroundColor: option.color + '20', borderColor: option.color },
                ]}
                onPress={() => setMood(option.value)}
              >
                <Text style={styles.moodEmoji}>{option.emoji}</Text>
                <Text
                  style={[
                    styles.moodLabel,
                    mood === option.value && { color: option.color, fontWeight: '700' },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Anonymous Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Ionicons
              name={isAnonymous ? 'eye-off' : 'eye'}
              size={20}
              color={isAnonymous ? COLORS.textMuted : COLORS.primary}
            />
            <View>
              <Text style={styles.toggleLabel}>
                {isAnonymous ? 'Anonymous' : 'Visible'}
              </Text>
              <Text style={styles.toggleDesc}>
                {isAnonymous
                  ? 'Your identity is hidden'
                  : 'Others can see your profile'}
              </Text>
            </View>
          </View>
          <Switch
            value={isAnonymous}
            onValueChange={setIsAnonymous}
            trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
            thumbColor={isAnonymous ? COLORS.primary : '#f4f3f4'}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  submitText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },
  submitTextDisabled: {
    color: COLORS.textMuted,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.text,
    paddingHorizontal: 16,
    paddingTop: 16,
    maxHeight: 250,
  },
  charCount: {
    textAlign: 'right',
    paddingHorizontal: 16,
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  moodRow: {
    flexDirection: 'row',
    gap: 8,
  },
  moodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundDark,
  },
  moodEmoji: {
    fontSize: 14,
  },
  moodLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  toggleDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});
