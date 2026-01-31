import * as ImageManipulator from 'expo-image-manipulator';
import { FEATURES } from '@/lib/featureFlags';

/**
 * Creates a pixelation-blur effect by resizing down to tiny then back up.
 *
 * If FEATURES.ENABLE_PRIVATE_BLUR is false, returns the source URL unchanged.
 * If blur fails for any reason, returns the source URL as a graceful fallback.
 */
export async function createBlurredImage(sourceUrl: string): Promise<string> {
  if (!FEATURES.ENABLE_PRIVATE_BLUR) {
    return sourceUrl;
  }

  try {
    // expo-image-manipulator can handle remote URLs directly in newer SDK versions.
    // Shrink to 40px width for pixelation effect, then scale back up.
    const tiny = await ImageManipulator.manipulateAsync(
      sourceUrl,
      [{ resize: { width: 40 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );

    const blurred = await ImageManipulator.manipulateAsync(
      tiny.uri,
      [{ resize: { width: 800 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );

    return blurred.uri;
  } catch (error) {
    console.warn('[imageBlur] Blur failed, returning original URL as fallback:', error);
    return sourceUrl;
  }
}

/**
 * Batch blur multiple images.
 * Returns array of URIs in same order as input.
 * Individual failures fall back to the original URL silently.
 */
export async function createBlurredImages(sourceUrls: string[]): Promise<string[]> {
  const results = await Promise.all(
    sourceUrls.map((url) => createBlurredImage(url))
  );
  return results;
}
