import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  TOD_VOICE_MAX_DURATION_SEC,
  formatTodMediaLimit,
} from '@/lib/todMediaLimits';

/*
 * VoicePromptRecorder
 *
 * Self-contained voice recording sheet for the Truth/Dare new-post composer.
 * Decoupled from TodPrompt + TodIdentityStore (those belong to the answer
 * composer). Returns a local file:// URI + duration via `onConfirm` so the
 * caller can attach it to the prompt and let the existing optimistic upload
 * pipeline handle storage + createPrompt.
 *
 * Behavior:
 *  - Tap "Start" → request mic permission → on grant, begin recording.
 *  - On deny: friendly alert, sheet stays open so the user can cancel.
 *  - Recording shows a pulsing waveform-style indicator + MM:SS timer.
 *  - Auto-stops at TOD_VOICE_MAX_DURATION_SEC (60s).
 *  - On stop: preview play/pause, "Redo" (re-records, discards prior clip),
 *    "Use voice" (calls onConfirm with the local URI + durationMs).
 *  - Closing the sheet (or unmount) cleans up recorder + sound + interval.
 *  - Re-entry resets all state.
 */

const C = INCOGNITO_COLORS;
const MAX_SECONDS = TOD_VOICE_MAX_DURATION_SEC;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called with the recorded local audio URI + measured duration in ms. */
  onConfirm: (audioUri: string, durationMs: number) => void;
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoicePromptRecorder({ visible, onClose, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const autoStoppedRef = useRef(false);

  const cleanup = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch {
        /* swallow */
      }
      recordingRef.current = null;
    }
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch {
        /* swallow */
      }
      soundRef.current = null;
    }
  }, []);

  // Reset state whenever the sheet is opened.
  useEffect(() => {
    if (visible) {
      setIsRecording(false);
      setHasRecording(false);
      setSeconds(0);
      setAudioUri(null);
      setIsPlaying(false);
      setPermissionDenied(false);
      autoStoppedRef.current = false;
    }
  }, [visible]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cleanup().catch(() => {});
    };
  }, [cleanup]);

  // Pulse animation while recording.
  useEffect(() => {
    if (isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.25, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(1);
    return undefined;
  }, [isRecording, pulseAnim]);

  const stopRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      if (uri) {
        setAudioUri(uri);
        setHasRecording(true);
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[VoicePromptRecorder] stop failed', error);
      }
      recordingRef.current = null;
      setIsRecording(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        setPermissionDenied(true);
        Alert.alert(
          'Microphone Permission',
          'Please allow microphone access to record a voice prompt.'
        );
        return;
      }
      setPermissionDenied(false);

      // If a prior recording exists, drop it before re-recording.
      if (soundRef.current) {
        try {
          await soundRef.current.unloadAsync();
        } catch {
          /* swallow */
        }
        soundRef.current = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      autoStoppedRef.current = false;

      setAudioUri(null);
      setHasRecording(false);
      setIsPlaying(false);
      setSeconds(0);
      setIsRecording(true);

      // Tick once per second; auto-stop on hitting MAX_SECONDS.
      intervalRef.current = setInterval(() => {
        setSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_SECONDS && !autoStoppedRef.current) {
            autoStoppedRef.current = true;
            // Schedule stop outside the setState callback.
            setTimeout(() => {
              stopRecording().catch(() => {});
            }, 0);
            return MAX_SECONDS;
          }
          return next;
        });
      }, 1000);
    } catch (error) {
      if (__DEV__) {
        console.warn('[VoicePromptRecorder] start failed', error);
      }
      setIsRecording(false);
      Alert.alert('Recording Error', 'Failed to start recording. Please try again.');
    }
  }, [stopRecording]);

  const togglePreview = useCallback(async () => {
    if (!audioUri) return;
    try {
      if (soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await soundRef.current.pauseAsync();
          setIsPlaying(false);
          return;
        }
        if (status.isLoaded) {
          await soundRef.current.playFromPositionAsync(0);
          setIsPlaying(true);
          return;
        }
        // Not loaded — drop and recreate.
        try {
          await soundRef.current.unloadAsync();
        } catch {
          /* swallow */
        }
        soundRef.current = null;
      }

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
          }
        }
      );
      soundRef.current = sound;
      setIsPlaying(true);
    } catch (error) {
      if (__DEV__) {
        console.warn('[VoicePromptRecorder] preview failed', error);
      }
      setIsPlaying(false);
    }
  }, [audioUri]);

  const handleClose = useCallback(async () => {
    await cleanup();
    setIsRecording(false);
    setHasRecording(false);
    setAudioUri(null);
    setSeconds(0);
    setIsPlaying(false);
    onClose();
  }, [cleanup, onClose]);

  const handleConfirm = useCallback(async () => {
    if (!audioUri) return;
    if (seconds <= 0) {
      Alert.alert('Recording Too Short', 'Record at least one second before posting.');
      return;
    }
    if (seconds > MAX_SECONDS) {
      Alert.alert('Recording Too Long', formatTodMediaLimit('voice'));
      return;
    }
    // Pause any playback so we don't leak audio after the sheet closes.
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch {
        /* swallow */
      }
      soundRef.current = null;
      setIsPlaying(false);
    }
    onConfirm(audioUri, seconds * 1000);
  }, [audioUri, seconds, onConfirm]);

  const renderControls = () => {
    if (isRecording) {
      return (
        <TouchableOpacity style={styles.stopBtn} onPress={() => stopRecording()} activeOpacity={0.85}>
          <Ionicons name="stop" size={26} color="#FFFFFF" />
        </TouchableOpacity>
      );
    }
    if (hasRecording) {
      return (
        <View style={styles.previewRow}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => startRecording()}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={18} color={C.text} />
            <Text style={styles.secondaryBtnText} maxFontSizeMultiplier={1.15}>
              Redo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={handleConfirm}
            activeOpacity={0.88}
          >
            <Ionicons name="checkmark" size={18} color="#FFFFFF" />
            <Text style={styles.confirmBtnText} maxFontSizeMultiplier={1.15}>
              Use voice
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <TouchableOpacity style={styles.recordBtn} onPress={() => startRecording()} activeOpacity={0.85}>
        <View style={styles.recordInner} />
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close voice recorder">
        <Pressable
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 12) + 12 },
          ]}
          onPress={(event) => event.stopPropagation?.()}
        >
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={1.2}>
              Record voice prompt
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close voice recorder"
            >
              <Ionicons name="close" size={22} color={C.textLight} />
            </TouchableOpacity>
          </View>

          <View style={styles.indicatorArea}>
            {isRecording ? (
              <Animated.View
                style={[
                  styles.recordingPulse,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              >
                <Ionicons name="mic" size={42} color="#FFFFFF" />
              </Animated.View>
            ) : hasRecording ? (
              <TouchableOpacity
                onPress={togglePreview}
                style={styles.previewPlayBtn}
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? 'Pause preview' : 'Play preview'}
              >
                <Ionicons
                  name={isPlaying ? 'pause-circle' : 'play-circle'}
                  size={64}
                  color={C.primary}
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.idleIcon}>
                <Ionicons name="mic-outline" size={44} color={C.textLight} />
              </View>
            )}
          </View>

          <Text style={styles.timer} maxFontSizeMultiplier={1.2}>
            {formatTime(seconds)}
          </Text>
          <Text style={styles.maxLabel} maxFontSizeMultiplier={1.15}>
            Max {MAX_SECONDS}s
          </Text>

          {permissionDenied ? (
            <Text style={styles.deniedText} maxFontSizeMultiplier={1.15}>
              Microphone access is blocked. Enable it in Settings to record.
            </Text>
          ) : null}

          <View style={styles.controls}>{renderControls()}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 18,
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    letterSpacing: 0.3,
  },
  indicatorArea: {
    height: 110,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  recordingPulse: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#E94560',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E94560',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  previewPlayBtn: {
    padding: 8,
  },
  idleIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  timer: {
    fontSize: 28,
    fontWeight: '700',
    color: C.text,
    marginTop: 6,
  },
  maxLabel: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 16,
  },
  deniedText: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  controls: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 76,
    width: '100%',
    marginTop: 4,
  },
  recordBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.primary,
  },
  stopBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F44336',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    letterSpacing: 0.3,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.36,
    shadowRadius: 14,
    elevation: 6,
  },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
