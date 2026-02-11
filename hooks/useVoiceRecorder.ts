/**
 * useVoiceRecorder — Hook for voice message recording with expo-av
 *
 * Features:
 * - Tap to start recording, tap again to stop and send
 * - 30s max duration with auto-stop and auto-send
 * - Auto-send on navigation away / app background
 * - Permission handling
 * - Double-tap protection via state machine
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { Audio } from 'expo-av';
import { useIsFocused } from '@react-navigation/native';

const MAX_DURATION_MS = 30000; // 30 seconds

export type RecordingState = 'idle' | 'recording';

export interface VoiceRecorderResult {
  audioUri: string;
  durationMs: number;
}

interface UseVoiceRecorderOptions {
  onRecordingComplete: (result: VoiceRecorderResult) => void;
  onError?: (message: string) => void;
}

export function useVoiceRecorder({
  onRecordingComplete,
  onError,
}: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecordingState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);

  // Track focus to auto-send when navigating away
  const isFocused = useIsFocused();
  const wasFocusedRef = useRef(isFocused);

  // Stop recording and return the result
  const stopRecording = useCallback(async (): Promise<VoiceRecorderResult | null> => {
    if (!recordingRef.current || isProcessingRef.current) return null;

    isProcessingRef.current = true;

    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const status = await recordingRef.current.getStatusAsync();
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      setState('idle');
      setElapsedMs(0);
      isProcessingRef.current = false;

      if (!uri) {
        return null;
      }

      const durationMs = status.isRecording
        ? Date.now() - startTimeRef.current
        : status.durationMillis || 0;

      return { audioUri: uri, durationMs };
    } catch (error) {
      console.error('[VoiceRecorder] Stop error:', error);
      recordingRef.current = null;
      setState('idle');
      setElapsedMs(0);
      isProcessingRef.current = false;
      return null;
    }
  }, []);

  // Stop and send the recording
  const stopAndSend = useCallback(async () => {
    const result = await stopRecording();
    if (result && result.durationMs > 500) {
      // Only send if > 0.5s
      onRecordingComplete(result);
    }
  }, [stopRecording, onRecordingComplete]);

  // Start recording
  const startRecording = useCallback(async () => {
    if (state !== 'idle' || isProcessingRef.current) return;

    try {
      // Request permission
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Microphone Permission',
          'Please allow microphone access to send voice messages.',
          [{ text: 'OK' }]
        );
        onError?.('Microphone permission denied');
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
      startTimeRef.current = Date.now();
      setState('recording');
      setElapsedMs(0);

      // Start elapsed timer
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setElapsedMs(elapsed);

        // Auto-stop at 30 seconds
        if (elapsed >= MAX_DURATION_MS) {
          stopAndSend();
        }
      }, 100);
    } catch (error) {
      console.error('[VoiceRecorder] Start error:', error);
      onError?.('Recording failed, try again');
      setState('idle');
    }
  }, [state, stopAndSend, onError]);

  // Toggle recording (tap handler)
  const toggleRecording = useCallback(() => {
    if (state === 'idle') {
      startRecording();
    } else if (state === 'recording') {
      stopAndSend();
    }
  }, [state, startRecording, stopAndSend]);

  // Auto-send when screen loses focus (navigation away)
  useEffect(() => {
    if (wasFocusedRef.current && !isFocused && state === 'recording') {
      stopAndSend();
    }
    wasFocusedRef.current = isFocused;
  }, [isFocused, state, stopAndSend]);

  // Auto-send when app goes to background
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== 'active' && state === 'recording') {
        stopAndSend();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [state, stopAndSend]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  return {
    state,
    elapsedMs,
    maxDurationMs: MAX_DURATION_MS,
    toggleRecording,
    isRecording: state === 'recording',
  };
}
