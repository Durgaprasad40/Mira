import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import {
  FONT_SIZE,
  INCOGNITO_COLORS,
  SPACING,
  SIZES,
  lineHeight,
  moderateScale,
} from '@/lib/constants';
import { useTodIdentityStore, TodIdentityChoice } from '@/stores/todIdentityStore';
import type { TodPrompt, TodProfileVisibility } from '@/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const C = INCOGNITO_COLORS;
const MAX_DURATION_SEC = 60; // 60 seconds max
const TEXT_MAX_SCALE = 1.2;
const HEADER_ICON_SIZE = moderateScale(22, 0.25);
const PREVIEW_ICON_SIZE = moderateScale(58, 0.25);
const EMPTY_MIC_ICON_SIZE = moderateScale(44, 0.25);
const STOP_ICON_SIZE = moderateScale(28, 0.25);
const ACTION_ICON_SIZE = SIZES.icon.md;
const ACTION_SEND_ICON_SIZE = moderateScale(18, 0.25);
const RECORD_BUTTON_SIZE = moderateScale(68, 0.25);
const RECORD_INNER_SIZE = moderateScale(52, 0.25);
const STOP_BUTTON_SIZE = moderateScale(60, 0.25);
const WAVEFORM_HEIGHT = moderateScale(76, 0.25);
const WAVEFORM_BAR_HEIGHT = moderateScale(46, 0.25);
const SHEET_RADIUS = moderateScale(20, 0.25);
const TIMER_SIZE = moderateScale(30, 0.35);

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
  const insets = useSafeAreaInsets();
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
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SPACING.base) + SPACING.base }]}>
          <View style={styles.header}>
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.title}>Voice Answer</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={HEADER_ICON_SIZE} color={C.textLight} />
            </TouchableOpacity>
          </View>

          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.promptText} numberOfLines={2}>
            {prompt.text}
          </Text>

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
                        height: moderateScale(8 + Math.random() * 32, 0.3),
                        transform: [{ scaleY: pulseAnim }],
                      },
                    ]}
                  />
                ))}
              </View>
            )}
            {!isRecording && hasRecording && (
              <TouchableOpacity onPress={playPreview} style={styles.previewPlayBtn}>
                <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={PREVIEW_ICON_SIZE} color={C.primary} />
              </TouchableOpacity>
            )}
            {!isRecording && !hasRecording && (
              <Ionicons name="mic-outline" size={EMPTY_MIC_ICON_SIZE} color={C.textLight} />
            )}
          </View>

          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.timer}>{formatTime(seconds)}</Text>
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.maxLabel}>Max {MAX_DURATION_SEC}s</Text>

          {/* Identity Mode Picker - only show if no stored choice */}
          {!hasStoredChoice && (
            <View style={styles.identitySection}>
              <View style={styles.identityHeader}>
                <Ionicons name="person-outline" size={SIZES.icon.xs} color={C.textLight} />
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.identityTitle}>Your identity</Text>
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
                  <Ionicons name="eye-off" size={SIZES.icon.sm} color={identityMode === 'anonymous' ? C.primary : C.textLight} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[styles.identityOptionText, identityMode === 'anonymous' && { color: C.primary }]}>
                    Anonymous
                  </Text>
                  <View style={styles.recommendedBadge}>
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.recommendedBadgeText}>Default</Text>
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
                  <Ionicons name="person-outline" size={SIZES.icon.sm} color={identityMode === 'no_photo' ? C.primary : C.textLight} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[styles.identityOptionText, identityMode === 'no_photo' && { color: C.primary }]}>
                    Blur photo
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
                  <Ionicons name="person" size={SIZES.icon.sm} color={identityMode === 'show_profile' ? C.primary : C.textLight} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[styles.identityOptionText, identityMode === 'show_profile' && { color: C.primary }]}>
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
                <Ionicons name="stop" size={STOP_ICON_SIZE} color="#FFF" />
              </TouchableOpacity>
            )}
            {!isRecording && hasRecording && (
              <View style={styles.postRow}>
                <TouchableOpacity style={styles.retryBtn} onPress={startRecording}>
                  <Ionicons name="refresh" size={ACTION_ICON_SIZE} color={C.text} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.retryText}>Redo</Text>
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
                      <Ionicons name="send" size={ACTION_SEND_ICON_SIZE} color="#FFF" />
                      <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.postText}>Post</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* One-time view info */}
          {hasRecording && (
            <View style={styles.viewModeInfo}>
              <Ionicons name="eye-outline" size={SIZES.icon.xs} color={C.textLight} />
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.viewModeText}>Tap to view</Text>
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
    backgroundColor: C.background, borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS,
    padding: SPACING.lg, alignItems: 'center',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginBottom: SPACING.md,
  },
  title: { fontSize: FONT_SIZE.xl, fontWeight: '700', lineHeight: lineHeight(FONT_SIZE.xl, 1.2), color: C.text },
  promptText: { fontSize: FONT_SIZE.body2, lineHeight: lineHeight(FONT_SIZE.body2, 1.35), color: C.textLight, textAlign: 'center', marginBottom: SPACING.lg },
  waveformArea: {
    height: WAVEFORM_HEIGHT, justifyContent: 'center', alignItems: 'center', marginBottom: SPACING.md,
  },
  waveformBars: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs - 1, height: WAVEFORM_BAR_HEIGHT },
  waveBar: { width: moderateScale(3, 0.25), borderRadius: moderateScale(1.5, 0.25), backgroundColor: C.primary },
  previewPlayBtn: { padding: SPACING.sm },
  timer: { fontSize: TIMER_SIZE, fontWeight: '700', lineHeight: lineHeight(TIMER_SIZE, 1.2), color: C.text, marginBottom: SPACING.xs },
  maxLabel: { fontSize: FONT_SIZE.sm, lineHeight: lineHeight(FONT_SIZE.sm, 1.2), color: C.textLight, marginBottom: SPACING.base },
  // Identity picker
  identitySection: {
    backgroundColor: C.surface, borderRadius: SIZES.radius.md,
    padding: SPACING.md, marginBottom: SPACING.base, width: '100%',
  },
  identityHeader: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm - 2, marginBottom: SPACING.sm + SPACING.xs,
  },
  identityTitle: { fontSize: FONT_SIZE.caption, fontWeight: '600', lineHeight: lineHeight(FONT_SIZE.caption, 1.2), color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.3 },
  identityOptions: { gap: SPACING.sm - 2 },
  identityOption: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + SPACING.xs,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.sm, borderRadius: SIZES.radius.sm,
  },
  identityOptionActive: { backgroundColor: C.primary + '10' },
  identityOptionText: { flex: 1, fontSize: FONT_SIZE.body2, lineHeight: lineHeight(FONT_SIZE.body2, 1.35), color: C.text, fontWeight: '500' },
  radioOuter: {
    width: moderateScale(18, 0.25), height: moderateScale(18, 0.25), borderRadius: SIZES.radius.full,
    borderWidth: 2, borderColor: C.textLight,
    alignItems: 'center', justifyContent: 'center',
  },
  radioInner: { width: moderateScale(10, 0.25), height: moderateScale(10, 0.25), borderRadius: SIZES.radius.full, backgroundColor: C.primary },
  recommendedBadge: {
    backgroundColor: C.primary + '20', paddingHorizontal: SPACING.sm - 2, paddingVertical: SPACING.xxs, borderRadius: SIZES.radius.xs + 2,
  },
  recommendedBadgeText: { fontSize: FONT_SIZE.xxs, lineHeight: lineHeight(FONT_SIZE.xxs, 1.2), fontWeight: '700', color: C.primary },
  controls: { alignItems: 'center', marginBottom: SPACING.md },
  recordBtn: {
    width: RECORD_BUTTON_SIZE, height: RECORD_BUTTON_SIZE, borderRadius: RECORD_BUTTON_SIZE / 2, borderWidth: moderateScale(3, 0.2), borderColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  recordInner: { width: RECORD_INNER_SIZE, height: RECORD_INNER_SIZE, borderRadius: RECORD_INNER_SIZE / 2, backgroundColor: C.primary },
  stopBtn: {
    width: STOP_BUTTON_SIZE, height: STOP_BUTTON_SIZE, borderRadius: STOP_BUTTON_SIZE / 2, backgroundColor: '#F44336',
    alignItems: 'center', justifyContent: 'center',
  },
  postRow: { flexDirection: 'row', gap: SPACING.base, alignItems: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm - 2,
    paddingHorizontal: SPACING.base, paddingVertical: moderateScale(10, 0.5), borderRadius: SIZES.radius.xl,
    backgroundColor: C.surface,
  },
  retryText: { fontSize: FONT_SIZE.body, lineHeight: lineHeight(FONT_SIZE.body, 1.2), fontWeight: '600', color: C.text },
  postBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm - 2,
    backgroundColor: C.primary, paddingHorizontal: SPACING.xl, paddingVertical: moderateScale(10, 0.5), borderRadius: SIZES.radius.xl,
    minWidth: moderateScale(90, 0.25), justifyContent: 'center',
  },
  postBtnDisabled: { opacity: 0.6 },
  postText: { fontSize: FONT_SIZE.body, lineHeight: lineHeight(FONT_SIZE.body, 1.2), fontWeight: '600', color: '#FFF' },
  viewModeInfo: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm - 2,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, backgroundColor: C.surface, borderRadius: SIZES.radius.sm,
  },
  viewModeText: { fontSize: FONT_SIZE.caption, lineHeight: lineHeight(FONT_SIZE.caption, 1.2), color: C.textLight },
});
