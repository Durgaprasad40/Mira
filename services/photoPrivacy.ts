/**
 * Photo Privacy Service
 *
 * Provides client-side image processing for privacy features:
 * - Blur: Applies Gaussian blur to the entire photo
 * - Cartoon: Placeholder for AI-generated cartoon/avatar (requires server-side processing)
 *
 * These features are only available AFTER face verification passes.
 */

import * as ImageManipulator from 'expo-image-manipulator';

// =============================================================================
// Types
// =============================================================================

export type PhotoVariant = 'original' | 'blurred' | 'cartoon';

export interface ProcessedPhoto {
  uri: string;
  variant: PhotoVariant;
  width: number;
  height: number;
}

// =============================================================================
// Blur Effect
// =============================================================================

/**
 * Apply blur effect to a photo.
 *
 * Note: expo-image-manipulator doesn't have a built-in blur filter,
 * so we simulate blur by resizing down then up (pixelation blur).
 * For production, consider using a native module or server-side processing.
 *
 * @param imageUri - URI of the original image
 * @param blurIntensity - Intensity of blur (1-10, default 5)
 * @returns ProcessedPhoto with blurred image URI
 */
export async function applyBlurEffect(
  imageUri: string,
  blurIntensity: number = 5
): Promise<ProcessedPhoto> {
  console.log('[PhotoPrivacy] Applying blur effect...');

  // Simulate blur by resizing down then up
  // Lower resize = more blur effect
  const scaleFactor = Math.max(0.05, 0.15 - (blurIntensity * 0.01));

  // First, resize down (creates blur/pixelation)
  const downsized = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: 100 * scaleFactor * 10 } }], // Reduce to small size
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  // Then resize back up (interpolation creates blur effect)
  const blurred = await ImageManipulator.manipulateAsync(
    downsized.uri,
    [{ resize: { width: 800 } }], // Resize back to normal
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
  );

  console.log('[PhotoPrivacy] Blur effect applied');

  return {
    uri: blurred.uri,
    variant: 'blurred',
    width: blurred.width,
    height: blurred.height,
  };
}

/**
 * Apply a more sophisticated blur using multiple resize operations.
 * This creates a smoother gaussian-like blur effect.
 *
 * @param imageUri - URI of the original image
 * @returns ProcessedPhoto with blurred image URI
 */
export async function applyGaussianBlur(imageUri: string): Promise<ProcessedPhoto> {
  console.log('[PhotoPrivacy] Applying gaussian-like blur effect...');

  // Step 1: Reduce size significantly
  const step1 = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: 50 } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  // Step 2: Resize back up gradually
  const step2 = await ImageManipulator.manipulateAsync(
    step1.uri,
    [{ resize: { width: 200 } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  // Step 3: Final resize to target size
  const final = await ImageManipulator.manipulateAsync(
    step2.uri,
    [{ resize: { width: 600 } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
  );

  console.log('[PhotoPrivacy] Gaussian-like blur effect applied');

  return {
    uri: final.uri,
    variant: 'blurred',
    width: final.width,
    height: final.height,
  };
}

// =============================================================================
// Cartoon Effect (Placeholder)
// =============================================================================

/**
 * Generate a cartoon/avatar version of the photo.
 *
 * IMPORTANT: True cartoon/avatar generation requires AI processing.
 * This is a placeholder that returns the original image.
 *
 * For production, options include:
 * 1. Server-side AI processing (e.g., using stable diffusion, DALL-E, etc.)
 * 2. Third-party avatar generation APIs
 * 3. Pre-defined avatar selection instead of AI generation
 *
 * @param imageUri - URI of the original image
 * @returns ProcessedPhoto (placeholder - returns original)
 */
export async function generateCartoonVersion(imageUri: string): Promise<ProcessedPhoto> {
  console.log('[PhotoPrivacy] Cartoon generation requested');
  console.log('[PhotoPrivacy] Note: True AI cartoon generation requires server-side processing');

  // For now, just get the image dimensions
  const info = await ImageManipulator.manipulateAsync(
    imageUri,
    [],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
  );

  // TODO: Implement server-side AI cartoon generation
  // For now, return the original image with a note
  console.warn('[PhotoPrivacy] Cartoon generation not yet implemented - returning original');

  return {
    uri: info.uri,
    variant: 'cartoon',
    width: info.width,
    height: info.height,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Process a photo with the specified privacy variant.
 *
 * @param imageUri - URI of the original image
 * @param variant - Target variant (original, blurred, cartoon)
 * @returns ProcessedPhoto with the processed image
 */
export async function processPhotoVariant(
  imageUri: string,
  variant: PhotoVariant
): Promise<ProcessedPhoto> {
  console.log(`[PhotoPrivacy] Processing photo as ${variant}`);

  switch (variant) {
    case 'original':
      // Just copy/validate the original
      const original = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      return {
        uri: original.uri,
        variant: 'original',
        width: original.width,
        height: original.height,
      };

    case 'blurred':
      return applyGaussianBlur(imageUri);

    case 'cartoon':
      return generateCartoonVersion(imageUri);

    default:
      throw new Error(`Unknown photo variant: ${variant}`);
  }
}

/**
 * Get display label for a photo variant.
 */
export function getVariantLabel(variant: PhotoVariant): string {
  switch (variant) {
    case 'original':
      return 'Original Photo';
    case 'blurred':
      return 'Blurred Photo';
    case 'cartoon':
      return 'Cartoon Avatar';
    default:
      return 'Unknown';
  }
}

/**
 * Get description for a photo variant.
 */
export function getVariantDescription(variant: PhotoVariant): string {
  switch (variant) {
    case 'original':
      return 'Show your verified photo as-is to others.';
    case 'blurred':
      return 'Others see a blurred version. Your clear photo is stored securely for verification.';
    case 'cartoon':
      return 'Show a cartoon avatar instead. Your real photo is kept private for verification.';
    default:
      return '';
  }
}
