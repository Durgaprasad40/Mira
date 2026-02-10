import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Image, ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { isDemoMode } from '@/hooks/useConvex';
import { createBlurredImages } from '@/lib/imageBlur';
import { FEATURES } from '@/lib/featureFlags';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const { width } = Dimensions.get('window');
const PREVIEW_SIZE = (width - 48) / 2;

export default function BlurPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const blurredPhotoLocalUris = usePrivateProfileStore((s) => s.blurredPhotoLocalUris);
  const setBlurredPhotoLocalUris = usePrivateProfileStore((s) => s.setBlurredPhotoLocalUris);
  const setBlurredStorageIds = usePrivateProfileStore((s) => s.setBlurredStorageIds);
  const setBlurredPhotoUrls = usePrivateProfileStore((s) => s.setBlurredPhotoUrls);
  const setCurrentStep = usePrivateProfileStore((s) => s.setCurrentStep);

  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [blurError, setBlurError] = useState<string | null>(null);

  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);

  useEffect(() => {
    setCurrentStep(2);
  }, []);

  const blurSkipped = isDemoMode || !FEATURES.ENABLE_PRIVATE_BLUR;

  // On mount: in demo/blur-off mode, just pass through originals; otherwise generate blurs
  useEffect(() => {
    if (blurredPhotoLocalUris.length === 0 && selectedPhotoUrls.length > 0) {
      if (blurSkipped) {
        setBlurredPhotoLocalUris(selectedPhotoUrls);
      } else {
        generateBlurs();
      }
    }
  }, []);

  const generateBlurs = async () => {
    setProcessing(true);
    setBlurError(null);
    try {
      const blurredUris = await createBlurredImages(selectedPhotoUrls);
      // Validate that all photos were blurred successfully
      if (blurredUris.length !== selectedPhotoUrls.length) {
        throw new Error('Not all photos were blurred');
      }
      // Ensure no undefined/null URIs
      if (blurredUris.some((uri) => !uri)) {
        throw new Error('Some blurred photos are invalid');
      }
      setBlurredPhotoLocalUris(blurredUris);
    } catch (error) {
      // CRITICAL: Never fall back to originals — this would be a privacy breach
      console.error('Blur generation failed:', error);
      setBlurError('Blur generation failed. Please try again.');
      // Clear any partial results — do NOT use originals
      setBlurredPhotoLocalUris([]);
    }
    setProcessing(false);
  };

  const uploadBlurredPhotos = async () => {
    if (isDemoMode) {
      // In demo mode, skip actual upload
      setBlurredStorageIds([]);
      setBlurredPhotoUrls(blurredPhotoLocalUris);
      router.push('/(main)/(private-setup)/categories' as any);
      return;
    }

    setUploading(true);
    try {
      const storageIds: string[] = [];
      const urls: string[] = [];

      for (const localUri of blurredPhotoLocalUris) {
        // Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Read the file and upload
        const response = await fetch(localUri);
        const blob = await response.blob();

        const uploadResult = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'image/jpeg' },
          body: blob,
        });

        const { storageId } = await uploadResult.json();
        storageIds.push(storageId);
        // URL will be resolved later from Convex
        urls.push(localUri); // Temporary — real URL comes from Convex storage
      }

      setBlurredStorageIds(storageIds);
      setBlurredPhotoUrls(urls);
      router.push('/(main)/(private-setup)/categories' as any);
    } catch (error) {
      Alert.alert('Upload Error', 'Failed to upload blurred photos. Please try again.');
      console.error('Upload error:', error);
    }
    setUploading(false);
  };

  // CRITICAL: Only allow proceeding if ALL photos are successfully blurred
  const canProceed =
    !processing &&
    !blurError &&
    blurredPhotoLocalUris.length > 0 &&
    blurredPhotoLocalUris.length === selectedPhotoUrls.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blur Preview</Text>
        <Text style={styles.stepLabel}>Step 2 of 4</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          {blurSkipped
            ? 'Photo blur is currently off. Your selected photos will be used as-is for your private profile preview.'
            : 'These are your blurred photos. Only these pixelated versions will be visible in Private Mode — your originals are never shared.'}
        </Text>

        {processing ? (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.processingText}>
              Generating blurred previews...
            </Text>
          </View>
        ) : blurError ? (
          /* Error state — blur generation failed */
          <View style={styles.errorContainer}>
            <View style={styles.errorBanner}>
              <Ionicons name="warning" size={24} color="#FF6B6B" />
              <Text style={styles.errorText}>{blurError}</Text>
            </View>
            <Text style={styles.errorSubtext}>
              For your privacy, we cannot continue without successfully blurred photos.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={generateBlurs}>
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.retryBtnText}>Retry Blur Generation</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Text style={styles.backBtnText}>Go Back & Select Different Photos</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              {blurredPhotoLocalUris.map((uri, index) => (
                <View key={index} style={styles.previewItem}>
                  <Image source={{ uri }} style={styles.previewImage} />
                  <View style={styles.previewBadge}>
                    <Ionicons name={blurSkipped ? 'image' : 'eye-off'} size={12} color="#FFFFFF" />
                    <Text style={styles.previewBadgeText}>{blurSkipped ? 'Original' : 'Blurred'}</Text>
                  </View>
                </View>
              ))}
            </View>

            {blurredPhotoLocalUris.length > 0 && !blurSkipped && (
              <TouchableOpacity style={styles.regenBtn} onPress={generateBlurs}>
                <Ionicons name="refresh" size={16} color={C.primary} />
                <Text style={styles.regenText}>Regenerate blur</Text>
              </TouchableOpacity>
            )}

            <View style={styles.infoBox}>
              <Ionicons name="shield-checkmark" size={16} color={C.textLight} />
              <Text style={styles.infoText}>
                Your original unblurred photos can only be seen through the mutual reveal system — both you and the other person must agree.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Bottom action */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, (!canProceed || uploading) && styles.nextBtnDisabled]}
          onPress={uploadBlurredPhotos}
          disabled={!canProceed || uploading}
        >
          {uploading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.nextBtnText}>Upload & Continue</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  stepLabel: { fontSize: 12, color: C.textLight },
  content: { padding: 16 },
  subtitle: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 20,
    marginBottom: 16,
  },
  processingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  processingText: { fontSize: 14, color: C.textLight },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    borderWidth: 1,
    borderColor: '#FF6B6B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    width: '100%',
  },
  errorText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#FF6B6B',
  },
  errorSubtext: {
    fontSize: 13,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginBottom: 12,
    width: '100%',
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  backBtn: {
    paddingVertical: 12,
  },
  backBtnText: {
    fontSize: 14,
    color: C.textLight,
    textDecorationLine: 'underline',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  previewItem: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE * 1.3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  previewImage: { width: '100%', height: '100%' },
  previewBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  previewBadgeText: { fontSize: 10, color: '#FFFFFF', fontWeight: '600' },
  regenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 12,
  },
  regenText: { fontSize: 13, color: C.primary, fontWeight: '500' },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  infoText: { flex: 1, fontSize: 12, color: C.textLight, lineHeight: 18 },
  bottomBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  nextBtn: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextBtnDisabled: { backgroundColor: C.surface },
  nextBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
