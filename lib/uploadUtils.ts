import { Id } from '@/convex/_generated/dataModel';

/**
 * Upload a photo from a local URI to Convex storage
 * @param photoUri - Local file URI (e.g., from expo-image-picker)
 * @param generateUploadUrl - Convex mutation to generate upload URL
 * @returns Storage ID of the uploaded photo
 */
export async function uploadPhotoToConvex(
  photoUri: string,
  generateUploadUrl: () => Promise<string>
): Promise<Id<'_storage'>> {
  try {
    // Get upload URL from Convex
    const uploadUrl = await generateUploadUrl();

    // Fetch the local file as a blob
    const response = await fetch(photoUri);
    const blob = await response.blob();

    // Upload the blob to Convex storage
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'image/jpeg',
      },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    // Get the storage ID from the response
    const result = await uploadResponse.json();
    return result.storageId as Id<'_storage'>;
  } catch (error) {
    console.error('Error uploading photo:', error);
    throw new Error('Failed to upload photo');
  }
}

/**
 * Upload multiple photos to Convex storage
 * @param photoUris - Array of local file URIs
 * @param generateUploadUrl - Convex mutation to generate upload URL
 * @returns Array of storage IDs
 */
export async function uploadPhotosToConvex(
  photoUris: string[],
  generateUploadUrl: () => Promise<string>
): Promise<Id<'_storage'>[]> {
  const storageIds: Id<'_storage'>[] = [];

  for (const uri of photoUris) {
    const storageId = await uploadPhotoToConvex(uri, generateUploadUrl);
    storageIds.push(storageId);
  }

  return storageIds;
}
