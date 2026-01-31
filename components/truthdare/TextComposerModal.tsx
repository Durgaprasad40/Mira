import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import type { TodPrompt, TodProfileVisibility } from '@/types';

const C = INCOGNITO_COLORS;
const MAX_CHARS = 400;

interface TextComposerModalProps {
  visible: boolean;
  prompt: TodPrompt | null;
  onClose: () => void;
  onSubmit: (text: string, isAnonymous?: boolean, profileVisibility?: TodProfileVisibility) => void;
}

export function TextComposerModal({ visible, prompt, onClose, onSubmit }: TextComposerModalProps) {
  const [text, setText] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [profileVisibility, setProfileVisibility] = useState<TodProfileVisibility>('blurred');

  const handleSubmit = () => {
    if (text.trim().length < 3) return;
    onSubmit(text.trim(), isAnonymous, isAnonymous ? profileVisibility : 'clear');
    setText('');
    setIsAnonymous(false);
    setProfileVisibility('blurred');
  };

  const handleClose = () => {
    setText('');
    setIsAnonymous(false);
    setProfileVisibility('blurred');
    onClose();
  };

  if (!prompt) return null;

  const isTruth = prompt.type === 'truth';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
              <Text style={styles.badgeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={22} color={C.textLight} />
            </TouchableOpacity>
          </View>
          <Text style={styles.promptText} numberOfLines={2}>{prompt.text}</Text>
          <TextInput
            style={styles.input}
            placeholder="Write your answer..."
            placeholderTextColor={C.textLight}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={MAX_CHARS}
            autoFocus
          />

          {/* Anonymous toggle — Truth & Dare */}
          <View style={styles.anonRow}>
            <Ionicons name="eye-off-outline" size={16} color={isAnonymous ? C.primary : C.textLight} />
            <Text style={[styles.anonLabel, isAnonymous && { color: C.primary }]}>Answer anonymously</Text>
            <Switch
              value={isAnonymous}
              onValueChange={setIsAnonymous}
              trackColor={{ false: C.accent, true: C.primary + '60' }}
              thumbColor={isAnonymous ? C.primary : C.textLight}
            />
          </View>

          {/* Profile visibility picker — shown when anonymous */}
          {isAnonymous && (
            <View style={styles.visibilitySection}>
              <View style={styles.visibilityHeader}>
                <Ionicons name="lock-closed-outline" size={14} color={C.textLight} />
                <Text style={styles.visibilityTitle}>Profile visibility</Text>
              </View>
              <View style={styles.visibilityOptions}>
                <TouchableOpacity
                  style={[styles.visibilityOption, profileVisibility === 'blurred' && styles.visibilityOptionActive]}
                  onPress={() => setProfileVisibility('blurred')}
                >
                  <View style={styles.radioOuter}>
                    {profileVisibility === 'blurred' && <View style={styles.radioInner} />}
                  </View>
                  <Text style={[styles.visibilityOptionText, profileVisibility === 'blurred' && { color: C.primary }]}>
                    Blurred profile
                  </Text>
                  <View style={styles.recommendedBadge}>
                    <Text style={styles.recommendedText}>Recommended</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.visibilityOption, profileVisibility === 'clear' && styles.visibilityOptionActive]}
                  onPress={() => setProfileVisibility('clear')}
                >
                  <View style={styles.radioOuter}>
                    {profileVisibility === 'clear' && <View style={styles.radioInner} />}
                  </View>
                  <Text style={[styles.visibilityOptionText, profileVisibility === 'clear' && { color: C.primary }]}>
                    Show profile clearly
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.footer}>
            <Text style={styles.charCount}>{text.length}/{MAX_CHARS}</Text>
            <TouchableOpacity
              style={[styles.submitBtn, text.trim().length < 3 && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={text.trim().length < 3}
            >
              <Ionicons name="send" size={18} color="#FFF" />
              <Text style={styles.submitText}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  promptText: { fontSize: 14, color: C.text, lineHeight: 20, marginBottom: 12 },
  input: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    fontSize: 15, color: C.text, minHeight: 120, textAlignVertical: 'top',
    marginBottom: 12,
  },
  anonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 8, paddingHorizontal: 4,
  },
  anonLabel: { flex: 1, fontSize: 13, color: C.textLight, fontWeight: '500' },
  // Profile visibility picker
  visibilitySection: {
    backgroundColor: C.surface, borderRadius: 10,
    padding: 12, marginBottom: 12,
  },
  visibilityHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  visibilityTitle: { fontSize: 12, fontWeight: '600', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.3 },
  visibilityOptions: { gap: 6 },
  visibilityOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8,
  },
  visibilityOptionActive: { backgroundColor: C.primary + '10' },
  visibilityOptionText: { fontSize: 13, color: C.text, fontWeight: '500' },
  radioOuter: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: C.textLight,
    alignItems: 'center', justifyContent: 'center',
  },
  radioInner: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: C.primary,
  },
  recommendedBadge: {
    backgroundColor: C.primary + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  recommendedText: { fontSize: 9, fontWeight: '700', color: C.primary },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  charCount: { fontSize: 12, color: C.textLight },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
});
