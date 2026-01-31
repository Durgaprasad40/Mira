import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import type { TodPrompt, TodProfileVisibility } from '@/types';

const C = INCOGNITO_COLORS;
const MAX_DURATION = 60; // seconds

interface VoiceComposerProps {
  visible: boolean;
  prompt: TodPrompt | null;
  onClose: () => void;
  onSubmit: (durationSec: number, isAnonymous?: boolean, profileVisibility?: TodProfileVisibility) => void;
}

export function VoiceComposer({ visible, prompt, onClose, onSubmit }: VoiceComposerProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [profileVisibility, setProfileVisibility] = useState<TodProfileVisibility>('blurred');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isRecording) {
      intervalRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= MAX_DURATION - 1) {
            stopRecording();
            return MAX_DURATION;
          }
          return s + 1;
        });
      }, 1000);
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      pulseAnim.setValue(1);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRecording]);

  const startRecording = () => {
    setSeconds(0);
    setIsRecording(true);
    setHasRecording(false);
  };

  const stopRecording = () => {
    setIsRecording(false);
    setHasRecording(true);
  };

  const handleClose = () => {
    setIsRecording(false);
    setHasRecording(false);
    setSeconds(0);
    setIsAnonymous(false);
    setProfileVisibility('blurred');
    onClose();
  };

  const handleSubmit = () => {
    onSubmit(seconds, isAnonymous, isAnonymous ? profileVisibility : 'clear');
    setIsRecording(false);
    setHasRecording(false);
    setSeconds(0);
    setIsAnonymous(false);
    setProfileVisibility('blurred');
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!prompt) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Voice Answer</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={22} color={C.textLight} />
            </TouchableOpacity>
          </View>

          <Text style={styles.promptText} numberOfLines={2}>{prompt.text}</Text>

          {/* Waveform placeholder */}
          <View style={styles.waveformArea}>
            {isRecording && (
              <View style={styles.waveformBars}>
                {Array.from({ length: 20 }).map((_, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: 8 + Math.random() * 32,
                        transform: [{ scaleY: isRecording ? pulseAnim : 1 }],
                      },
                    ]}
                  />
                ))}
              </View>
            )}
            {!isRecording && hasRecording && (
              <View style={styles.waveformBars}>
                {Array.from({ length: 20 }).map((_, i) => (
                  <View key={i} style={[styles.waveBar, { height: 8 + (i % 5) * 8, opacity: 0.5 }]} />
                ))}
              </View>
            )}
            {!isRecording && !hasRecording && (
              <Ionicons name="mic-outline" size={48} color={C.textLight} />
            )}
          </View>

          <Text style={styles.timer}>{formatTime(seconds)}</Text>
          <Text style={styles.maxLabel}>Max {MAX_DURATION}s</Text>

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
                <Text style={styles.visibilityLabel}>Profile visibility</Text>
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
                    <Text style={styles.recommendedBadgeText}>Recommended</Text>
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

          <View style={styles.controls}>
            {!isRecording && !hasRecording && (
              <TouchableOpacity style={styles.recordBtn} onPress={startRecording}>
                <View style={styles.recordInner} />
              </TouchableOpacity>
            )}
            {isRecording && (
              <TouchableOpacity style={styles.stopBtn} onPress={stopRecording}>
                <Ionicons name="stop" size={32} color="#FFF" />
              </TouchableOpacity>
            )}
            {!isRecording && hasRecording && (
              <View style={styles.postRow}>
                <TouchableOpacity style={styles.retryBtn} onPress={startRecording}>
                  <Ionicons name="refresh" size={20} color={C.text} />
                  <Text style={styles.retryText}>Redo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.postBtn} onPress={handleSubmit}>
                  <Ionicons name="send" size={18} color="#FFF" />
                  <Text style={styles.postText}>Post</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, alignItems: 'center',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginBottom: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  promptText: { fontSize: 13, color: C.textLight, textAlign: 'center', marginBottom: 20 },
  waveformArea: {
    height: 60, justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  waveformBars: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 48 },
  waveBar: { width: 3, borderRadius: 1.5, backgroundColor: C.primary },
  timer: { fontSize: 32, fontWeight: '700', color: C.text, marginBottom: 4 },
  maxLabel: { fontSize: 11, color: C.textLight, marginBottom: 20 },
  anonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    width: '100%', marginBottom: 8, paddingHorizontal: 4,
  },
  anonLabel: { flex: 1, fontSize: 13, color: C.textLight, fontWeight: '500' },
  // Profile visibility
  visibilitySection: {
    backgroundColor: C.surface, borderRadius: 10,
    padding: 12, marginBottom: 12, width: '100%',
  },
  visibilityHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  visibilityLabel: { fontSize: 12, fontWeight: '600', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.3 },
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
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  recommendedBadge: {
    backgroundColor: C.primary + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  recommendedBadgeText: { fontSize: 9, fontWeight: '700', color: C.primary },
  controls: { alignItems: 'center' },
  recordBtn: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  recordInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary },
  stopBtn: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#F44336',
    alignItems: 'center', justifyContent: 'center',
  },
  postRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: C.surface,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: C.text },
  postBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20,
  },
  postText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
});
