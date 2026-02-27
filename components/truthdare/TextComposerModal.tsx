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
  /** Initial text to prefill when editing existing comment */
  initialText?: string;
  onClose: () => void;
  onSubmit: (text: string, isAnonymous?: boolean, profileVisibility?: TodProfileVisibility) => void;
}

// Identity mode: 'show_profile' | 'blur_photo' | 'anonymous'
type IdentityMode = 'show_profile' | 'blur_photo' | 'anonymous';

export function TextComposerModal({ visible, prompt, initialText, onClose, onSubmit }: TextComposerModalProps) {
  const [text, setText] = useState(initialText || '');
  const [identityMode, setIdentityMode] = useState<IdentityMode>('show_profile');

  // Reset state when modal opens
  React.useEffect(() => {
    if (visible) {
      setText(initialText || '');
      // Reset to default: show profile (NOT anonymous)
      setIdentityMode('show_profile');
    }
  }, [visible, initialText]);

  const handleSubmit = () => {
    if (text.trim().length < 3) return;
    // Map identity mode to isAnonymous and profileVisibility
    const isAnonymous = identityMode === 'anonymous';
    const profileVisibility: TodProfileVisibility = identityMode === 'blur_photo' ? 'blurred' : 'clear';
    onSubmit(text.trim(), isAnonymous, profileVisibility);
    setText('');
    setIdentityMode('show_profile');
  };

  const handleClose = () => {
    setText('');
    setIdentityMode('show_profile');
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

          {/* Identity Mode Picker - 3 clear options */}
          <View style={styles.identitySection}>
            <View style={styles.identityHeader}>
              <Ionicons name="person-outline" size={14} color={C.textLight} />
              <Text style={styles.identityTitle}>Your identity</Text>
            </View>
            <View style={styles.identityOptions}>
              {/* Option 1: Show profile (default) */}
              <TouchableOpacity
                style={[styles.identityOption, identityMode === 'show_profile' && styles.identityOptionActive]}
                onPress={() => setIdentityMode('show_profile')}
              >
                <View style={styles.radioOuter}>
                  {identityMode === 'show_profile' && <View style={styles.radioInner} />}
                </View>
                <Ionicons name="person" size={16} color={identityMode === 'show_profile' ? C.primary : C.textLight} />
                <Text style={[styles.identityOptionText, identityMode === 'show_profile' && { color: C.primary }]}>
                  Show profile
                </Text>
                <View style={styles.recommendedBadge}>
                  <Text style={styles.recommendedText}>Default</Text>
                </View>
              </TouchableOpacity>

              {/* Option 2: Blur photo */}
              <TouchableOpacity
                style={[styles.identityOption, identityMode === 'blur_photo' && styles.identityOptionActive]}
                onPress={() => setIdentityMode('blur_photo')}
              >
                <View style={styles.radioOuter}>
                  {identityMode === 'blur_photo' && <View style={styles.radioInner} />}
                </View>
                <Ionicons name="eye-outline" size={16} color={identityMode === 'blur_photo' ? C.primary : C.textLight} />
                <Text style={[styles.identityOptionText, identityMode === 'blur_photo' && { color: C.primary }]}>
                  Blur photo
                </Text>
              </TouchableOpacity>

              {/* Option 3: Anonymous */}
              <TouchableOpacity
                style={[styles.identityOption, identityMode === 'anonymous' && styles.identityOptionActive]}
                onPress={() => setIdentityMode('anonymous')}
              >
                <View style={styles.radioOuter}>
                  {identityMode === 'anonymous' && <View style={styles.radioInner} />}
                </View>
                <Ionicons name="eye-off" size={16} color={identityMode === 'anonymous' ? C.primary : C.textLight} />
                <Text style={[styles.identityOptionText, identityMode === 'anonymous' && { color: C.primary }]}>
                  Anonymous
                </Text>
              </TouchableOpacity>
            </View>
          </View>

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
  // Identity picker (3 options)
  identitySection: {
    backgroundColor: C.surface, borderRadius: 10,
    padding: 12, marginBottom: 12,
  },
  identityHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  identityTitle: { fontSize: 12, fontWeight: '600', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.3 },
  identityOptions: { gap: 6 },
  identityOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8,
  },
  identityOptionActive: { backgroundColor: C.primary + '10' },
  identityOptionText: { flex: 1, fontSize: 13, color: C.text, fontWeight: '500' },
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
