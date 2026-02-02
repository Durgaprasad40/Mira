import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

export function useScreenProtection(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    ScreenCapture.preventScreenCaptureAsync();

    return () => {
      ScreenCapture.allowScreenCaptureAsync();
    };
  }, [enabled]);
}
