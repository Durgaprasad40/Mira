/**
 * Phase-2 Voice Recorder (pure-UI)
 *
 * STRICT ISOLATION:
 *   - No Convex queries / mutations.
 *   - No Phase-1 backend (`api.media.*`, `api.protectedMedia.*`).
 *   - All upload/send work is performed by the parent (`incognito-chat.tsx`)
 *     via Phase-2-only mutations:
 *         api.privateConversations.generateSecureMediaUploadUrl
 *         api.privateConversations.sendPrivateMessage  (type: 'voice')
 *
 * Behaviour:
 *   - User opens the modal, taps mic to record (max 60s, auto-stop).
 *   - Stop button finalises and yields { audioUri, durationMs } via onComplete.
 *   - Cancel discards the recording.
 *   - All recording resources are released on unmount / cancel / re-open.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { COLORS, FONT_SIZE, SPACING } from '@/lib/constants';

const MAX_DURATION_SEC = 60;

interface Phase2VoiceRecorderProps {
  visible: boolean;
  onCancel: () => void;
  onComplete: (audioUri: string, durationMs: number) => Promise<void> | void;
  isUploading?: boolean;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Phase2VoiceRecorder({
  visible,
  onCancel,
  onComplete,
  isUploading,
}: Phase2VoiceRecorderProps) {
  const [stage, setStage] = useState<'idle' | 'recording' | 'preview'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  const releaseRecording = useCallback(async () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (rec) {
      try {
        const status = await rec.getStatusAsync();
        if (status.isRecording) {
          await rec.stopAndUnloadAsync();
        }
      } catch {
        /* no-op */
      }
    }
  }, []);

  const resetState = useCallback(() => {
    setStage('idle');
    setSeconds(0);
    setAudioUri(null);
    setDurationMs(0);
    startedAtRef.current = 0;
  }, []);

  // Whenever the modal closes, release recorder and reset state.
  useEffect(() => {
    if (!visible) {
      releaseRecording().finally(() => resetState());
    }
  }, [visible, releaseRecording, resetState]);

  // Always release on unmount.
  useEffect(() => {
    return () => {
      releaseRecording();
    };
  }, [releaseRecording]);

  const startRecording = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Microphone needed',
          'Allow microphone access to record a voice message.'
        );
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      startedAtRef.current = Date.now();
      setSeconds(0);
      setStage('recording');
      // Tick every second; auto-stop at MAX_DURATION_SEC.
      tickRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_DURATION_SEC) {
          // Auto-stop
          stopRecording();
        }
      }, 250);
    } catch (err: any) {
      Alert.alert('Recording failed', err?.message || 'Could not start recording.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    try {
      await rec.stopAndUnloadAsync();
    } catch {
      /* no-op */
    }
    let uri: string | null = null;
    let actualDurationMs = (Date.now() - startedAtRef.current) || seconds * 1000;
    try {
      uri = rec.getURI();
      const status = await rec.getStatusAsync();
      if (status && typeof (status as any).durationMillis === 'number') {
        actualDurationMs = (status as any).durationMillis;
      }
    } catch {
      /* fall back to wall clock */
    }
    recordingRef.current = null;
    if (!uri) {
      Alert.alert('Recording failed', 'No audio was captured. Please try again.');
      resetState();
      return;
    }
    setAudioUri(uri);
    setDurationMs(actualDurationMs);
    setStage('preview');
  }, [resetState, seconds]);

  const handleSend = useCallback(async () => {
    if (!audioUri || !durationMs) return;
    await onComplete(audioUri, durationMs);
    // Parent is responsible for closing the modal after upload.
  }, [audioUri, durationMs, onComplete]);

  const handleDiscard = useCallback(async () => {
    await releaseRecording();
    resetState();
  }, [releaseRecording, resetState]);

  const handleCancel = useCallback(async () => {
    await releaseRecording();
    resetState();
    onCancel();
  }, [releaseRecording, resetState, onCancel]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Voice note</Text>
            <TouchableOpacity
              onPress={handleCancel}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close voice recorder"
              disabled={isUploading}
            >
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          {stage === 'idle' ? (
            <>
              <Text style={styles.helper}>Tap to start recording (max 60s)</Text>
              <TouchableOpacity
                onPress={startRecording}
                style={styles.recordBtn}
                accessibilityRole="button"
                accessibilityLabel="Start recording"
              >
                <Ionicons name="mic" size={28} color="#FFFFFF" />
              </TouchableOpacity>
            </>
          ) : null}

          {stage === 'recording' ? (
            <>
              <Text style={styles.timer}>{formatTimer(seconds)}</Text>
              <Text style={styles.helper}>Recording…</Text>
              <TouchableOpacity
                onPress={stopRecording}
                style={styles.stopBtn}
                accessibilityRole="button"
                accessibilityLabel="Stop recording"
              >
                <Ionicons name="stop" size={26} color="#FFFFFF" />
              </TouchableOpacity>
            </>
          ) : null}

          {stage === 'preview' ? (
            <>
              <Text style={styles.timer}>{formatTimer(Math.round(durationMs / 1000))}</Text>
              <Text style={styles.helper}>Ready to send</Text>
              <View style={styles.previewActions}>
                <TouchableOpacity
                  onPress={handleDiscard}
                  style={[styles.actionBtn, styles.discardBtn]}
                  disabled={isUploading}
                  accessibilityRole="button"
                  accessibilityLabel="Discard recording"
                >
                  <Ionicons name="trash-outline" size={20} color={COLORS.textMuted} />
                  <Text style={styles.discardText}>Discard</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSend}
                  style={[
                    styles.actionBtn,
                    styles.sendBtn,
                    isUploading && styles.actionDisabled,
                  ]}
                  disabled={isUploading}
                  accessibilityRole="button"
                  accessibilityLabel="Send voice message"
                >
                  {isUploading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color="#FFFFFF" />
                      <Text style={styles.sendText}>Send</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
    alignItems: 'center',
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '600',
    color: COLORS.text,
  },
  helper: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
  },
  timer: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
    fontVariant: ['tabular-nums'],
  },
  recordBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  stopBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E0245E',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  previewActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginTop: SPACING.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 24,
    gap: 6,
  },
  discardBtn: {
    backgroundColor: COLORS.backgroundDark,
  },
  discardText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  sendBtn: {
    backgroundColor: COLORS.primary,
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  actionDisabled: { opacity: 0.6 },
});
