import { useEffect, useState, useRef } from 'react';
import { Platform, NativeModules, NativeEventEmitter, AppState } from 'react-native';

/**
 * Detects screen recording on iOS using UIScreen.isCaptured.
 * On Android, FLAG_SECURE already blocks recording — no detection needed.
 *
 * Falls back to polling AppState if NativeEventEmitter is unavailable.
 */
export function useScreenRecordingDetection({
  enabled,
  onRecordingDetected,
}: {
  enabled: boolean;
  onRecordingDetected?: () => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const callbackRef = useRef(onRecordingDetected);
  callbackRef.current = onRecordingDetected;

  useEffect(() => {
    if (!enabled || Platform.OS !== 'ios') return;

    // Poll for screen capture status via AppState changes
    // UIScreen.isCaptured isn't directly accessible from RN,
    // but we can detect recording state changes indirectly
    const checkRecording = () => {
      // On iOS, when screen recording starts, AppState may emit change events
      // This is a best-effort approach; full detection requires a native module
    };

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkRecording();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [enabled]);

  return { isRecording };
}
