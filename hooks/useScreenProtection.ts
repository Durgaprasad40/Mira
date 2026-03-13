import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

export function useScreenProtection(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    // STABILITY: Wrap in void + catch to prevent unhandled promise rejection
    void ScreenCapture.preventScreenCaptureAsync().catch(() => {
      // Non-critical: screen capture prevention may not be supported on all devices
    });

    return () => {
      void ScreenCapture.allowScreenCaptureAsync().catch(() => {
        // Non-critical: cleanup failure is acceptable
      });
    };
  }, [enabled]);
}
