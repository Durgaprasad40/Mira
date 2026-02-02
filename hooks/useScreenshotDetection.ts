import { useEffect, useRef } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

interface UseScreenshotDetectionOptions {
  enabled: boolean;
  onScreenshot: () => void;
}

export function useScreenshotDetection({
  enabled,
  onScreenshot,
}: UseScreenshotDetectionOptions) {
  // Use a ref so the callback is always fresh without re-subscribing
  const callbackRef = useRef(onScreenshot);
  callbackRef.current = onScreenshot;

  useEffect(() => {
    if (!enabled) return;

    const subscription = ScreenCapture.addScreenshotListener(() => {
      callbackRef.current();
    });

    return () => {
      subscription.remove();
    };
  }, [enabled]);
}
