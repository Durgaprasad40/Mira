import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import {
  PHASE2_DESIRE_MAX_LENGTH,
  PHASE2_DESIRE_MIN_LENGTH,
  PHASE2_MAX_INTENTS,
  PHASE2_MIN_INTENTS,
  PHASE2_MIN_PHOTOS,
  usePrivateProfileStore,
} from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { useScreenTrace } from '@/lib/devTrace';

const C = INCOGNITO_COLORS;

function isPersistedPhotoUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export default function Phase2ReviewScreen() {
  useScreenTrace('P2_ONB_REVIEW');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const token = useAuthStore((s) => s.token);

  const displayName = usePrivateProfileStore((s) => s.displayName);
  const age = usePrivateProfileStore((s) => s.age);
  const gender = usePrivateProfileStore((s) => s.gender);
  const city = usePrivateProfileStore((s) => s.city);
  const hobbies = usePrivateProfileStore((s) => s.hobbies);
  const isVerified = usePrivateProfileStore((s) => s.isVerified);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const completeSetup = usePrivateProfileStore((s) => s.completeSetup);

  const finalizeOnboardingProfile = useMutation(api.privateProfiles.finalizeOnboardingProfile);
  const setPhase2Completed = useMutation(api.users.setPhase2OnboardingCompleted);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const isFinalizingRef = useRef(false);

  const validPhotoUrls = useMemo(
    () => selectedPhotoUrls.filter((url) => isPersistedPhotoUrl(url)),
    [selectedPhotoUrls]
  );

  const selectedIntents = useMemo(
    () => PRIVATE_INTENT_CATEGORIES.filter((intent) => intentKeys.includes(intent.key as any)),
    [intentKeys]
  );

  const bioLength = privateBio.trim().length;
  const canComplete =
    !!token &&
    validPhotoUrls.length >= PHASE2_MIN_PHOTOS &&
    intentKeys.length >= PHASE2_MIN_INTENTS &&
    intentKeys.length <= PHASE2_MAX_INTENTS &&
    bioLength >= PHASE2_DESIRE_MIN_LENGTH &&
    bioLength <= PHASE2_DESIRE_MAX_LENGTH;

  const missingItems = useMemo(() => {
    const missing: string[] = [];
    if (validPhotoUrls.length < PHASE2_MIN_PHOTOS) {
      missing.push('photos');
    }
    if (intentKeys.length < PHASE2_MIN_INTENTS || intentKeys.length > PHASE2_MAX_INTENTS) {
      missing.push('looking for');
    }
    if (bioLength < PHASE2_DESIRE_MIN_LENGTH || bioLength > PHASE2_DESIRE_MAX_LENGTH) {
      missing.push('private bio');
    }
    return missing;
  }, [bioLength, intentKeys.length, validPhotoUrls.length]);

  const handleComplete = async () => {
    if (!token || !canComplete || isFinalizingRef.current) return;

    isFinalizingRef.current = true;
    setIsSubmitting(true);

    try {
      const profileResult = await finalizeOnboardingProfile({ token });
      if (!profileResult?.success) {
        throw new Error('Profile save did not succeed');
      }

      const completionResult = await setPhase2Completed({ token });
      if (!completionResult?.success) {
        throw new Error('Onboarding completion flag did not succeed');
      }

      completeSetup();
      router.replace('/(main)/(private)/(tabs)/desire-land' as any);
    } catch (error) {
      Alert.alert(
        'Unable to finish setup',
        'Your Private Mode profile was not created. Please try again.'
      );
      isFinalizingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review & create</Text>
        <Text style={styles.stepLabel}>Step 4 of 4</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.mainTitle}>Review your Private Mode profile</Text>
          <Text style={styles.mainSubtitle}>
            This is the final check before you enter. We will only finish onboarding after the backend profile save succeeds.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Imported basics</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Nickname</Text>
              <Text style={styles.rowValue}>{displayName || 'Anonymous'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Age</Text>
              <Text style={styles.rowValue}>{age > 0 ? age : 'Not available'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Gender</Text>
              <Text style={styles.rowValue}>{gender || 'Not available'}</Text>
            </View>
            {city ? (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>City</Text>
                <Text style={styles.rowValue}>{city}</Text>
              </View>
            ) : null}
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.rowLabel}>Verified</Text>
              <Text style={styles.rowValue}>{isVerified ? 'Yes' : 'No'}</Text>
            </View>
          </View>
          {hobbies.length > 0 ? (
            <View style={styles.hobbiesWrap}>
              {hobbies.map((hobby) => (
                <View key={hobby} style={styles.hobbyChip}>
                  <Text style={styles.hobbyChipText}>{hobby}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <View style={styles.photoGrid}>
            {validPhotoUrls.map((url, index) => (
              <Pressable key={`${url}-${index}`} style={styles.photoSlot} onPress={() => setPreviewIndex(index)}>
                <Image source={{ uri: url }} style={styles.photoImage} contentFit="cover" />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Looking for</Text>
          <View style={styles.intentWrap}>
            {selectedIntents.map((intent) => (
              <View key={intent.key} style={styles.intentChip}>
                <Ionicons name={intent.icon as any} size={15} color={C.primary} />
                <Text style={styles.intentChipText}>{intent.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Private bio</Text>
          <View style={styles.bioCard}>
            <Text style={styles.bioText}>{privateBio.trim()}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {!canComplete ? (
          <Text style={styles.bottomHint}>Finish: {missingItems.join(', ')}</Text>
        ) : (
          <Text style={styles.bottomHint}>We save your profile first, then unlock Private Mode.</Text>
        )}
        <TouchableOpacity
          style={[styles.completeButton, !canComplete && styles.completeButtonDisabled]}
          onPress={handleComplete}
          disabled={!canComplete || isSubmitting}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.completeButtonText}>Enter Private Mode</Text>
              <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
            </>
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={previewIndex !== null} transparent animationType="fade" onRequestClose={() => setPreviewIndex(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {previewIndex !== null ? (
              <Image
                source={{ uri: validPhotoUrls[previewIndex] }}
                style={styles.previewImage}
                contentFit="contain"
              />
            ) : null}
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setPreviewIndex(null)}>
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  stepLabel: {
    fontSize: 12,
    color: C.textLight,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  section: {
    marginBottom: 24,
  },
  mainTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    marginBottom: 8,
  },
  mainSubtitle: {
    fontSize: 14,
    color: C.textLight,
    lineHeight: 21,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 12,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.background,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLabel: {
    fontSize: 14,
    color: C.textLight,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  hobbiesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  hobbyChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: C.surface,
  },
  hobbyChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoSlot: {
    width: '31%',
    aspectRatio: 0.78,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  intentWrap: {
    gap: 10,
  },
  intentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: C.surface,
  },
  intentChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  bioCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
  },
  bioText: {
    fontSize: 15,
    color: C.text,
    lineHeight: 22,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  bottomHint: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 10,
  },
  completeButton: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  completeButtonDisabled: {
    backgroundColor: C.surface,
  },
  completeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 54,
    right: 20,
  },
});
