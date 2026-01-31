import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import type { TodPrompt } from '@/types';

const C = INCOGNITO_COLORS;

interface AnswerComposerSheetProps {
  visible: boolean;
  prompt: TodPrompt | null;
  onClose: () => void;
  onSelectText: () => void;
  onSelectCamera: () => void;
  onSelectVideo: () => void;
  onSelectVoice: () => void;
}

const OPTIONS = [
  { key: 'text' as const, icon: 'create-outline' as const, label: 'Text', color: '#6C5CE7' },
  { key: 'camera' as const, icon: 'camera-outline' as const, label: 'Photo', color: '#E94560' },
  { key: 'video' as const, icon: 'videocam-outline' as const, label: 'Video', color: '#00B894' },
  { key: 'voice' as const, icon: 'mic-outline' as const, label: 'Voice', color: '#FF9800' },
];

export function AnswerComposerSheet({
  visible,
  prompt,
  onClose,
  onSelectText,
  onSelectCamera,
  onSelectVideo,
  onSelectVoice,
}: AnswerComposerSheetProps) {
  if (!prompt) return null;

  const handlers: Record<string, () => void> = {
    text: onSelectText,
    camera: onSelectCamera,
    video: onSelectVideo,
    voice: onSelectVoice,
  };

  const isTruth = prompt.type === 'truth';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
              <Text style={styles.badgeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={22} color={C.textLight} />
            </TouchableOpacity>
          </View>
          <Text style={styles.promptText} numberOfLines={2}>{prompt.text}</Text>
          <Text style={styles.subtitle}>Choose how you want to answer</Text>
          <View style={styles.optionsRow}>
            {OPTIONS.map((opt) => (
              <TouchableOpacity key={opt.key} style={styles.optionBtn} onPress={handlers[opt.key]} activeOpacity={0.7}>
                <View style={[styles.optionCircle, { backgroundColor: opt.color + '20' }]}>
                  <Ionicons name={opt.icon} size={28} color={opt.color} />
                </View>
                <Text style={styles.optionLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>Video max 60s. One answer per prompt.</Text>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: C.accent, alignSelf: 'center', marginBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  promptText: { fontSize: 15, color: C.text, lineHeight: 22, marginBottom: 12 },
  subtitle: { fontSize: 13, color: C.textLight, marginBottom: 16 },
  optionsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  optionBtn: { alignItems: 'center', gap: 8 },
  optionCircle: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  optionLabel: { fontSize: 12, fontWeight: '600', color: C.text },
  hint: { fontSize: 11, color: C.textLight, textAlign: 'center', fontStyle: 'italic' },
});
