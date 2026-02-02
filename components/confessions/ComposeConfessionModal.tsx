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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { ConfessionTopic, ConfessionRevealPolicy, TimedRevealOption } from '@/types';
import { isContentClean } from '@/lib/contentFilter';
import PersonPicker from './PersonPicker';

interface ComposeConfessionModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (
    text: string,
    isAnonymous: boolean,
    topic: ConfessionTopic,
    targetUserId?: string,
    revealPolicy?: ConfessionRevealPolicy,
    timedReveal?: TimedRevealOption,
  ) => void;
}

const TIMED_OPTIONS: { value: TimedRevealOption; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: '24h', label: '24 hours' },
  { value: '48h', label: '48 hours' },
];

export default function ComposeConfessionModal({
  visible,
  onClose,
  onSubmit,
}: ComposeConfessionModalProps) {
  const [text, setText] = useState('');
  const [confessToSomeone, setConfessToSomeone] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | undefined>();
  const [targetName, setTargetName] = useState<string | undefined>();
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [revealPolicy, setRevealPolicy] = useState<ConfessionRevealPolicy>('never');
  const [timedReveal, setTimedReveal] = useState<TimedRevealOption>('never');

  const canSubmit = text.trim().length >= 10;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const trimmed = text.trim();
    // Block phone numbers and emails
    const phonePattern = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
    if (phonePattern.test(trimmed) || emailPattern.test(trimmed)) {
      Alert.alert('Safety Warning', "Don't include phone numbers or personal details.");
      return;
    }
    if (!isContentClean(trimmed)) {
      Alert.alert('Content Warning', 'Your confession contains inappropriate content. Please revise it.');
      return;
    }
    onSubmit(
      text.trim(),
      true, // always anonymous on the feed
      'crush',
      confessToSomeone ? targetUserId : undefined,
      revealPolicy,
      confessToSomeone ? timedReveal : 'never',
    );
    setText('');
    setConfessToSomeone(false);
    setTargetUserId(undefined);
    setTargetName(undefined);
    setRevealPolicy('never');
    setTimedReveal('never');
  };

  const handleSelectPerson = (userId: string, name: string) => {
    setTargetUserId(userId);
    setTargetName(name);
    setShowPersonPicker(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
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

        {/* Safety text */}
        <View style={styles.safetyBanner}>
          <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
          <Text style={styles.safetyText}>Don't include phone numbers or personal details.</Text>
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

        {/* Confess to Someone Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Ionicons
              name="heart"
              size={20}
              color={confessToSomeone ? COLORS.primary : COLORS.textMuted}
            />
            <View>
              <Text style={styles.toggleLabel}>Confess to Someone</Text>
              <Text style={styles.toggleDesc}>
                {confessToSomeone
                  ? targetName
                    ? `Sending to ${targetName}`
                    : 'Tap to pick a person'
                  : 'Send a secret confession to someone'}
              </Text>
            </View>
          </View>
          <Switch
            value={confessToSomeone}
            onValueChange={(val) => {
              setConfessToSomeone(val);
              if (val && !targetUserId) {
                setShowPersonPicker(true);
              }
            }}
            trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
            thumbColor={confessToSomeone ? COLORS.primary : '#f4f3f4'}
          />
        </View>

        {confessToSomeone && (
          <TouchableOpacity
            style={styles.pickPersonButton}
            onPress={() => setShowPersonPicker(true)}
          >
            <Text style={styles.pickPersonText}>
              {targetName ? `Change person (${targetName})` : 'Pick a person'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        {/* Reveal Policy */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Ionicons
              name={revealPolicy === 'allow_later' ? 'eye' : 'eye-off'}
              size={20}
              color={revealPolicy === 'allow_later' ? COLORS.primary : COLORS.textMuted}
            />
            <View>
              <Text style={styles.toggleLabel}>Allow Reveal Later</Text>
              <Text style={styles.toggleDesc}>
                {revealPolicy === 'allow_later'
                  ? 'You can reveal your identity in chat'
                  : 'Identity stays hidden forever'}
              </Text>
            </View>
          </View>
          <Switch
            value={revealPolicy === 'allow_later'}
            onValueChange={(val) => setRevealPolicy(val ? 'allow_later' : 'never')}
            trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
            thumbColor={revealPolicy === 'allow_later' ? COLORS.primary : '#f4f3f4'}
          />
        </View>

        {/* Timed Reveal — only when confessing to someone */}
        {confessToSomeone && revealPolicy === 'allow_later' && (
          <View style={styles.timedSection}>
            <Text style={styles.timedLabel}>Auto-reveal identity after:</Text>
            <View style={styles.timedRow}>
              {TIMED_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.timedChip,
                    timedReveal === opt.value && styles.timedChipActive,
                  ]}
                  onPress={() => setTimedReveal(opt.value)}
                >
                  <Text
                    style={[
                      styles.timedChipText,
                      timedReveal === opt.value && styles.timedChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      <PersonPicker
        visible={showPersonPicker}
        onSelect={handleSelectPerson}
        onClose={() => setShowPersonPicker(false)}
      />
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
  safetyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,107,107,0.06)',
  },
  safetyText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.text,
    paddingHorizontal: 16,
    paddingTop: 16,
    maxHeight: 200,
  },
  charCount: {
    textAlign: 'right',
    paddingHorizontal: 16,
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
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
  pickPersonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  pickPersonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  timedSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  timedLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  timedRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timedChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  timedChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  timedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  timedChipTextActive: {
    color: COLORS.white,
  },
});
