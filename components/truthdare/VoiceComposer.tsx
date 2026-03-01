import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useTodIdentityStore, TodIdentityChoice } from '@/stores/todIdentityStore';
import type { TodPrompt, TodProfileVisibility } from '@/types';

const C = INCOGNITO_COLORS;
const MAX_DURATION_SEC = 60; // 60 seconds max

interface VoiceComposerProps {
  visible: boolean;
  prompt: TodPrompt | null;
  onClose: () => void;
  /** Called with audioUri and durationMs when user confirms posting */
  onSubmitAudio: (audioUri: string, durationMs: number, isAnonymous: boolean, profileVisibility: TodProfileVisibility) => void;
  /** Optional: if true, show uploading state */
  isUploading?: boolean;
}

// Map store choice to internal identity mode
type IdentityMode = 'anonymous' | 'no_photo' | 'show_profile';

function storeChoiceToMode(choice: TodIdentityChoice): IdentityMode {
  if (choice === 'public') return 'show_profile';
  return choice;
}

function modeToStoreChoice(mode: IdentityMode): TodIdentityChoice {
  if (mode === 'show_profile') return 'public';
  return mode;
}

export function VoiceComposer({ visible, prompt, onClose, onSubmitAudio, isUploading }: VoiceComposerProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [identityMode, setIdentityMode] = useState<IdentityMode>('anonymous');

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Get store functions
  const getChoice = useTodIdentityStore((s) => s.getChoice);
  const setChoice = useTodIdentityStore((s) => s.setChoice);

  // Check if identity is already stored for this thread
  const promptId = prompt?.id;
  const storedChoice = promptId ? getChoice(promptId) : undefined;
  const hasStoredChoice = storedChoice !== undefined;

  // Reset state when modal opens
  useEffect(() => {
    if (visible && promptId) {
      if (storedChoice) {
        setIdentityMode(storeChoiceToMode(storedChoice));
      } else {
        setIdentityMode('anonymous');
      }
    }
  }, [visible, promptId, storedChoice]);

  // Recording timer effect
  useEffect(() => {
    if (isRecording) {
      intervalRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= MAX_DURATION_SEC - 1) {
            stopRecording();
            return MAX_DURATION_SEC;
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      // Request permission
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow microphone access to record voice messages.');
        return;
      }

      // Configure audio mode for recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Create and start recording
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
      setHasRecording(false);
      setAudioUri(null);
      setSeconds(0);
    } catch (error) {
      console.error('[VoiceComposer] Start recording error:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      setIsRecording(false);

      if (uri) {
        setAudioUri(uri);
        setHasRecording(true);
        console.log('[VoiceComposer] Recording saved to:', uri);
      }
    } catch (error) {
      console.error('[VoiceComposer] Stop recording error:', error);
      setIsRecording(false);
    }
  };

  const playPreview = async () => {
    if (!audioUri) return;

    try {
      // Stop if already playing
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
        setIsPlaying(false);
        return;
      }

      // Configure audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
            soundRef.current?.unloadAsync();
            soundRef.current = null;
          }
        }
      );

      soundRef.current = sound;
      setIsPlaying(true);
    } catch (error) {
      console.error('[VoiceComposer] Playback error:', error);
      setIsPlaying(false);
    }
  };

  const handleClose = useCallback(() => {
    // Stop any ongoing recording/playback
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsRecording(false);
    setHasRecording(false);
    setAudioUri(null);
    setSeconds(0);
    setIsPlaying(false);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(() => {
    if (!audioUri || !promptId) return;

    // Save the identity choice for this thread
    const choice = modeToStoreChoice(identityMode);
    setChoice(promptId, choice);

    // Map identity mode to isAnonymous and profileVisibility
    const isAnonymous = identityMode === 'anonymous';
    const profileVisibility: TodProfileVisibility = identityMode === 'no_photo' ? 'blurred' : 'clear';

    // Convert seconds to milliseconds
    const durationMs = seconds * 1000;

    onSubmitAudio(audioUri, durationMs, isAnonymous, profileVisibility);
  }, [audioUri, promptId, identityMode, seconds, setChoice, onSubmitAudio]);

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

          {/* Waveform area */}
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
                        transform: [{ scaleY: pulseAnim }],
                      },
                    ]}
                  />
                ))}
              </View>
            )}
            {!isRecording && hasRecording && (
              <TouchableOpacity onPress={playPreview} style={styles.previewPlayBtn}>
                <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={64} color={C.primary} />
              </TouchableOpacity>
            )}
            {!isRecording && !hasRecording && (
              <Ionicons name="mic-outline" size={48} color={C.textLight} />
            )}
          </View>

          <Text style={styles.timer}>{formatTime(seconds)}</Text>
          <Text style={styles.maxLabel}>Max {MAX_DURATION_SEC}s</Text>

          {/* Identity Mode Picker - only show if no stored choice */}
          {!hasStoredChoice && (
            <View style={styles.identitySection}>
              <View style={styles.identityHeader}>
                <Ionicons name="person-outline" size={14} color={C.textLight} />
                <Text style={styles.identityTitle}>Your identity</Text>
              </View>
              <View style={styles.identityOptions}>
                {/* Option 1: Anonymous (DEFAULT) */}
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
                  <View style={styles.recommendedBadge}>
                    <Text style={styles.recommendedBadgeText}>Default</Text>
                  </View>
                </TouchableOpacity>

                {/* Option 2: No photo */}
                <TouchableOpacity
                  style={[styles.identityOption, identityMode === 'no_photo' && styles.identityOptionActive]}
                  onPress={() => setIdentityMode('no_photo')}
                >
                  <View style={styles.radioOuter}>
                    {identityMode === 'no_photo' && <View style={styles.radioInner} />}
                  </View>
                  <Ionicons name="person-outline" size={16} color={identityMode === 'no_photo' ? C.primary : C.textLight} />
                  <Text style={[styles.identityOptionText, identityMode === 'no_photo' && { color: C.primary }]}>
                    No photo
                  </Text>
                </TouchableOpacity>

                {/* Option 3: Show profile */}
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
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Controls */}
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
                <TouchableOpacity
                  style={[styles.postBtn, isUploading && styles.postBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color="#FFF" />
                      <Text style={styles.postText}>Post</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* One-time view info */}
          {hasRecording && (
            <View style={styles.viewModeInfo}>
              <Ionicons name="eye-outline" size={14} color={C.textLight} />
              <Text style={styles.viewModeText}>Tap to view</Text>
            </View>
          )}
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
    height: 80, justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  waveformBars: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 48 },
  waveBar: { width: 3, borderRadius: 1.5, backgroundColor: C.primary },
  previewPlayBtn: { padding: 8 },
  timer: { fontSize: 32, fontWeight: '700', color: C.text, marginBottom: 4 },
  maxLabel: { fontSize: 11, color: C.textLight, marginBottom: 16 },
  // Identity picker
  identitySection: {
    backgroundColor: C.surface, borderRadius: 10,
    padding: 12, marginBottom: 16, width: '100%',
  },
  identityHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10,
  },
  identityTitle: { fontSize: 12, fontWeight: '600', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.3 },
  identityOptions: { gap: 6 },
  identityOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8,
  },
  identityOptionActive: { backgroundColor: C.primary + '10' },
  identityOptionText: { flex: 1, fontSize: 13, color: C.text, fontWeight: '500' },
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
  controls: { alignItems: 'center', marginBottom: 12 },
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
    minWidth: 90, justifyContent: 'center',
  },
  postBtnDisabled: { opacity: 0.6 },
  postText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  viewModeInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12, backgroundColor: C.surface, borderRadius: 8,
  },
  viewModeText: { fontSize: 12, color: C.textLight },
});
