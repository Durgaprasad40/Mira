/**
 * Central feature flags for the app.
 * Toggle features on/off without touching component code.
 */
export const FEATURES = {
  /**
   * When true, Private Mode (Face 2) photos are pixelation-blurred on device.
   * When false, original image URLs are used as-is (for demo / testing).
   * If enabled and blur fails at runtime, the app falls back to the original URL.
   */
  ENABLE_PRIVATE_BLUR: false,
} as const;
