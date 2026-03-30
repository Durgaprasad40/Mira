/**
 * Phase 2 Onboarding - Step 4: Review
 *
 * Layout order (top to bottom):
 * A) Title: "Review your profile"
 * B) Photos section (grid + preview on tap + Edit)
 * C) Desire section (text display + Edit)
 * D) Profile Details (Name, DOB, Gender, Height, etc.)
 * E) Looking For section (tags + Edit)
 * E2) Prompts section (answered prompts from Step 3 + Edit)
 * F) Info note + validation/continue button
 *
 * Photos: tap → full-screen preview (with blur if enabled)
 * All Edit buttons → navigate to profile-edit (Step 2) or prompts (Step 3)
 * Blur consistency: uses blurMyPhoto from store
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES, PREFERENCE_STRENGTH_OPTIONS, INTENT_MATCH_OPTIONS } from '@/lib/privateConstants';
import { useShallow } from 'zustand/react/shallow';
import {
  usePrivateProfileStore,
  selectCanContinueDesire,
  selectCanContinueIntents,
  selectIsProfileDetailsComplete,
  selectIsPhase2ProfileComplete,
  PHASE2_MIN_PHOTOS,
  PHASE2_MIN_INTENTS,
  PHASE2_MAX_INTENTS,
  PHASE2_DESIRE_MIN_LENGTH,
  PHASE2_DESIRE_MAX_LENGTH,
} from '@/stores/privateProfileStore';
import { useScreenTrace } from '@/lib/devTrace';
import {
  GENDER_OPTIONS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
} from '@/lib/constants';
import { useDemoStore } from '@/stores/demoStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;
const screenWidth = Dimensions.get('window').width;

export default function Phase2Review() {
  useScreenTrace("P2_ONB_REVIEW");
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Get Phase-1 profile for DOB
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const getCurrentProfile = useDemoStore((s) => s.getCurrentProfile);

  const phase1Profile = useMemo(
    () => getCurrentProfile(),
    [getCurrentProfile, demoProfiles, currentDemoUserId]
  );

  // Store state
  const displayName = usePrivateProfileStore((s) => s.displayName);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const gender = usePrivateProfileStore((s) => s.gender);
  const height = usePrivateProfileStore((s) => s.height);
  const weight = usePrivateProfileStore((s) => s.weight);
  const smoking = usePrivateProfileStore((s) => s.smoking);
  const drinking = usePrivateProfileStore((s) => s.drinking);
  const education = usePrivateProfileStore((s) => s.education);
  const religion = usePrivateProfileStore((s) => s.religion);
  // FIX #1: Use per-slot blur state from store (persisted from edit screen)
  const photoBlurSlots = usePrivateProfileStore((s) => s.photoBlurSlots);
  // Phase-2 Step 3: Prompt answers
  const promptAnswers = usePrivateProfileStore((s) => s.promptAnswers);
  // Phase-2 Preference Strength
  const preferenceStrength = usePrivateProfileStore((s) => s.preferenceStrength);

  // Store actions
  const completeSetup = usePrivateProfileStore((s) => s.completeSetup);

  // Auth for Convex mutation
  const userId = useAuthStore((s) => s.userId);
  const setPhase2CompletedMutation = useMutation(api.users.setPhase2OnboardingCompleted);
  const upsertPrivateProfileMutation = useMutation(api.privateProfiles.upsertByAuthId);

  // Get age from store (calculated from DOB during onboarding)
  const storeAge = usePrivateProfileStore((s) => s.age);

  // Validation
  const canContinueDesire = usePrivateProfileStore(selectCanContinueDesire);
  const canContinueIntents = usePrivateProfileStore(selectCanContinueIntents);
  const isProfileDetailsComplete = usePrivateProfileStore(selectIsProfileDetailsComplete);
  const isPhase2Complete = usePrivateProfileStore(selectIsPhase2ProfileComplete);
  const allMissingItems = usePrivateProfileStore(
    useShallow((s) => {
      const missing: string[] = [];
      // Photos
      const validPhotos = s.selectedPhotoUrls.filter(
        (url) => typeof url === 'string' && url.length > 0 && url !== 'undefined' && url !== 'null' && (url.startsWith('http') || url.startsWith('file://'))
      );
      if (validPhotos.length < PHASE2_MIN_PHOTOS) {
        missing.push(`${PHASE2_MIN_PHOTOS - validPhotos.length} more photo${PHASE2_MIN_PHOTOS - validPhotos.length > 1 ? 's' : ''}`);
      }
      // Intents
      if (s.intentKeys.length < PHASE2_MIN_INTENTS) {
        missing.push('Looking For selection');
      }
      // Desire
      if (s.privateBio.trim().length < PHASE2_DESIRE_MIN_LENGTH) {
        missing.push('Desire text');
      }
      // Profile details
      if (!s.gender) missing.push('Gender');
      if (s.height === null || s.height <= 0) missing.push('Height');
      if (!s.smoking) missing.push('Smoking');
      if (!s.drinking) missing.push('Drinking');
      if (!s.education) missing.push('Education');
      if (!s.religion) missing.push('Religion');
      return missing;
    })
  );

  // Preview state
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Navigation guard: prevent double-tap on complete
  const isCompletingRef = useRef(false);

  // Computed values
  const photoCount = selectedPhotoUrls.length;

  // Format DOB for display
  const formattedDOB = useMemo(() => {
    const dob = phase1Profile?.dateOfBirth;
    if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
    const [y, m, d] = dob.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[m - 1]} ${d}, ${y}`;
  }, [phase1Profile?.dateOfBirth]);

  // Get selected intent labels
  const selectedIntents = PRIVATE_INTENT_CATEGORIES.filter((cat) =>
    intentKeys.includes(cat.key as any)
  );

  // Helper to get display label from options
  const getOptionLabel = (options: { value: string; label: string }[], value: string | null) => {
    if (!value) return null;
    return options.find((o) => o.value === value)?.label || value;
  };

  // Can complete: photos + intents + desire + profile details all valid
  const canComplete = isPhase2Complete;

  // Photo preview handlers
  const openPreview = useCallback((index: number) => {
    setPreviewIndex(index);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
  }, []);

  // Navigation handlers - pass fromReview=true so edit screens return here after save
  const handleEditProfile = useCallback(() => {
    router.push('/(main)/phase2-onboarding/profile-edit?fromReview=true' as any);
  }, [router]);

  // P2-UX-001 FIX: Dedicated handler for Looking For edit
  const handleEditLookingFor = useCallback(() => {
    router.push('/(main)/phase2-onboarding/looking-for-edit?fromReview=true' as any);
  }, [router]);

  // Handler for editing prompts (Step 3)
  const handleEditPrompts = useCallback(() => {
    router.push('/(main)/phase2-onboarding/prompts?fromReview=true' as any);
  }, [router]);

  // Handle completion
  const handleComplete = useCallback(async () => {
    if (!canComplete) return;
    if (isCompletingRef.current) return; // Prevent double-tap
    isCompletingRef.current = true;
    setIsSubmitting(true);

    // P2-001/P2-002 FIX: Await backend mutations and handle errors
    // Only proceed with navigation if backend succeeds
    if (!isDemoMode && userId) {
      try {
        // 1. Set phase2 onboarding completed flag
        const completedResult = await setPhase2CompletedMutation({ userId: userId as any });
        if (__DEV__) {
          console.log('[Phase2Review] Convex phase2OnboardingCompleted set:', completedResult);
        }

        // 2. Persist the full private profile data
        // IMPORTANT: Only store backend URLs (https), not local file:// URIs
        const backendPhotoUrls = selectedPhotoUrls.filter(
          (url) => typeof url === 'string' && url.startsWith('http')
        );

        const profileResult = await upsertPrivateProfileMutation({
          authUserId: userId,
          displayName: displayName || 'User',
          age: storeAge || 0,
          gender: gender || '',
          privateBio: privateBio.trim(),
          privateIntentKeys: intentKeys,
          privatePhotoUrls: backendPhotoUrls,
          isSetupComplete: true,
          // Profile details (imported from Phase-1)
          height: height ?? null,
          weight: weight ?? null,
          smoking: smoking ?? null,
          drinking: drinking ?? null,
          education: education ?? null,
          religion: religion ?? null,
          // Phase-2 Step 3: Persist prompt answers to backend
          promptAnswers: promptAnswers.map((p) => ({
            promptId: p.promptId,
            question: p.question,
            answer: p.answer,
          })),
          // Phase-2 Preference Strength (only if complete)
          ...(preferenceStrength.smoking && preferenceStrength.drinking && preferenceStrength.intent
            ? {
                preferenceStrength: {
                  smoking: preferenceStrength.smoking,
                  drinking: preferenceStrength.drinking,
                  intent: preferenceStrength.intent,
                },
              }
            : {}),
        });

        if (__DEV__) {
          console.log('[Phase2Review] Convex privateProfile upserted:', profileResult, {
            photoCount: backendPhotoUrls.length,
            intentCount: intentKeys.length,
          });
        }

        // Backend succeeded - now update local store and navigate
        completeSetup();

        if (__DEV__) {
          console.log('[Phase2Review] Setup complete:', {
            intentCount: intentKeys.length,
            desireLength: privateBio.trim().length,
            photoCount,
          });
        }

        // Navigate to Phase-2 private tabs (desire-land is the first tab)
        router.replace('/(main)/(private)/(tabs)/desire-land' as any);
      } catch (err) {
        // P2-001: Show user-facing error
        console.warn('[Phase2Review] Backend mutation failed:', err);
        Alert.alert(
          'Error',
          'Something went wrong. Please try again.',
          [{ text: 'OK' }]
        );
        // P2-002: Reset state to allow retry
        isCompletingRef.current = false;
        setIsSubmitting(false);
      }
    } else {
      // Demo mode - no backend, just complete locally
      completeSetup();

      if (__DEV__) {
        console.log('[Phase2Review] Setup complete (demo mode):', {
          intentCount: intentKeys.length,
          desireLength: privateBio.trim().length,
          photoCount,
        });
      }

      // Navigate to Phase-2 private tabs (desire-land is the first tab)
      router.replace('/(main)/(private)/(tabs)/desire-land' as any);
    }
  }, [
    canComplete, completeSetup, intentKeys, privateBio, photoCount, router,
    userId, setPhase2CompletedMutation, upsertPrivateProfileMutation,
    selectedPhotoUrls, displayName, storeAge, gender, promptAnswers,
    height, weight, smoking, drinking, education, religion, preferenceStrength
  ]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review Profile</Text>
        {/* P2-PHOTO-001: Updated step number for 5-step flow */}
        <Text style={styles.stepLabel}>Step 5 of 5</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* === SECTION A: Review Title === */}
        <View style={styles.section}>
          <Text style={styles.mainTitle}>Almost there</Text>
          <Text style={styles.mainSubtitle}>
            Review your private profile before entering. You can always edit this later.
          </Text>
        </View>

        {/* === SECTION B: Photos === */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Photos</Text>
            <TouchableOpacity style={styles.editBtn} onPress={handleEditProfile}>
              <Ionicons name="pencil" size={14} color={C.primary} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.photosGrid}>
            {selectedPhotoUrls.map((url, idx) => {
              // FIX #1: Use per-slot blur state
              const isBlurred = photoBlurSlots[idx] ?? true;
              return (
                <Pressable
                  key={idx}
                  style={styles.photoSlot}
                  onPress={() => openPreview(idx)}
                >
                  <Image
                    source={{ uri: url }}
                    style={styles.photoImage}
                    contentFit="cover"
                    blurRadius={isBlurred ? 15 : 0}
                  />
                  {isBlurred && (
                    <View style={styles.blurBadge}>
                      <Ionicons name="eye-off" size={12} color="#FFF" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.photoHint}>
            Tap a photo to preview
          </Text>
        </View>

        {/* === SECTION C: Desire (read-only display) === */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Desire</Text>
            <TouchableOpacity style={styles.editBtn} onPress={handleEditProfile}>
              <Ionicons name="pencil" size={14} color={C.primary} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          {privateBio.trim().length > 0 ? (
            <View style={styles.desireDisplay}>
              <Text style={styles.desireText}>{privateBio}</Text>
            </View>
          ) : (
            <Text style={styles.emptyText}>No desire written yet</Text>
          )}
        </View>

        {/* === SECTION D: Profile Details === */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Profile Details</Text>
            <TouchableOpacity style={styles.editBtn} onPress={handleEditProfile}>
              <Ionicons name="pencil" size={14} color={C.primary} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>
          {!isProfileDetailsComplete && (
            <View style={styles.warningBanner}>
              <Ionicons name="alert-circle" size={16} color="#FF6B6B" />
              <Text style={styles.warningText}>
                Please complete the missing fields
              </Text>
            </View>
          )}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Name</Text>
              <Text style={styles.infoValue}>{displayName || 'Anonymous'}</Text>
            </View>
            {formattedDOB && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Date of Birth</Text>
                <Text style={styles.infoValue}>{formattedDOB}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, !gender && styles.infoLabelMissing]}>Gender</Text>
              <Text style={[styles.infoValue, !gender && styles.infoValueMissing]}>
                {getOptionLabel(GENDER_OPTIONS, gender) || 'Not set'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, (!height || height <= 0) && styles.infoLabelMissing]}>Height</Text>
              <Text style={[styles.infoValue, (!height || height <= 0) && styles.infoValueMissing]}>
                {height && height > 0 ? `${height} cm` : 'Not set'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Weight</Text>
              <Text style={styles.infoValue}>
                {weight && weight > 0 ? `${weight} kg` : 'Not set'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, !smoking && styles.infoLabelMissing]}>Smoking</Text>
              <Text style={[styles.infoValue, !smoking && styles.infoValueMissing]}>
                {getOptionLabel(SMOKING_OPTIONS, smoking) || 'Not set'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, !drinking && styles.infoLabelMissing]}>Drinking</Text>
              <Text style={[styles.infoValue, !drinking && styles.infoValueMissing]}>
                {getOptionLabel(DRINKING_OPTIONS, drinking) || 'Not set'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, !education && styles.infoLabelMissing]}>Education</Text>
              <Text style={[styles.infoValue, !education && styles.infoValueMissing]}>
                {getOptionLabel(EDUCATION_OPTIONS, education) || 'Not set'}
              </Text>
            </View>
            <View style={[styles.infoRow, styles.infoRowLast]}>
              <Text style={[styles.infoLabel, !religion && styles.infoLabelMissing]}>Religion</Text>
              <Text style={[styles.infoValue, !religion && styles.infoValueMissing]}>
                {getOptionLabel(RELIGION_OPTIONS, religion) || 'Not set'}
              </Text>
            </View>
          </View>
        </View>

        {/* === SECTION E: Looking For === */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Looking For</Text>
            {/* P2-UX-001 FIX: Use dedicated looking-for-edit route */}
            <TouchableOpacity style={styles.editBtn} onPress={handleEditLookingFor}>
              <Ionicons name="pencil" size={14} color={C.primary} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          {selectedIntents.length > 0 ? (
            <View style={styles.intentsTags}>
              {selectedIntents.map((intent) => (
                <View key={intent.key} style={styles.intentTag}>
                  <Ionicons name={intent.icon as any} size={16} color={C.primary} />
                  <Text style={styles.intentTagText}>{intent.label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No intents selected</Text>
          )}
        </View>

        {/* === SECTION E2: Prompts (answered from Step 3) === */}
        {promptAnswers.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your Answers</Text>
              <TouchableOpacity style={styles.editBtn} onPress={handleEditPrompts}>
                <Ionicons name="pencil" size={14} color={C.primary} />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.promptsContainer}>
              {promptAnswers.map((pa) => (
                <View key={pa.promptId} style={styles.promptAnswerCard}>
                  <Text style={styles.promptQuestion}>{pa.question}</Text>
                  <Text style={styles.promptAnswer}>{pa.answer}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* === SECTION E3: Preference Strength === */}
        {preferenceStrength.smoking && preferenceStrength.drinking && preferenceStrength.intent && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Preference Strength</Text>
              <TouchableOpacity style={styles.editBtn} onPress={handleEditPrompts}>
                <Ionicons name="pencil" size={14} color={C.primary} />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Smoking compatibility</Text>
                <Text style={styles.infoValue}>
                  {PREFERENCE_STRENGTH_OPTIONS.find((o) => o.value === preferenceStrength.smoking)?.label || preferenceStrength.smoking}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Drinking compatibility</Text>
                <Text style={styles.infoValue}>
                  {PREFERENCE_STRENGTH_OPTIONS.find((o) => o.value === preferenceStrength.drinking)?.label || preferenceStrength.drinking}
                </Text>
              </View>
              <View style={[styles.infoRow, styles.infoRowLast]}>
                <Text style={styles.infoLabel}>Intent compatibility</Text>
                <Text style={styles.infoValue}>
                  {INTENT_MATCH_OPTIONS.find((o) => o.value === preferenceStrength.intent)?.label || preferenceStrength.intent}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* === SECTION F: Info Note === */}
        <View style={styles.infoNote}>
          <Ionicons name="lock-closed" size={18} color={C.primary} />
          <Text style={styles.infoNoteText}>
            Your private profile is separate and secure. You can edit anytime from settings.
          </Text>
        </View>

        {/* Bottom spacing */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom Action */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}>
        {!canComplete && (
          <Text style={styles.bottomHint}>
            {allMissingItems.length > 0
              ? `Missing: ${allMissingItems.slice(0, 2).join(', ')}${allMissingItems.length > 2 ? '...' : ''}`
              : 'Complete your profile'}
            {' - '}
            <Text style={styles.bottomHintLink} onPress={handleEditProfile}>Edit Profile</Text>
          </Text>
        )}
        <TouchableOpacity
          style={[styles.completeBtn, (!canComplete || isSubmitting) && styles.completeBtnDisabled]}
          onPress={handleComplete}
          disabled={!canComplete || isSubmitting}
          activeOpacity={0.8}
        >
          <Text style={[styles.completeBtnText, (!canComplete || isSubmitting) && styles.completeBtnTextDisabled]}>
            {isSubmitting ? 'Saving...' : 'Enter Private Mode'}
          </Text>
          <Ionicons
            name={isSubmitting ? 'hourglass-outline' : 'checkmark-circle'}
            size={20}
            color={canComplete && !isSubmitting ? '#FFFFFF' : C.textLight}
          />
        </TouchableOpacity>
      </View>

      {/* === FULL-SCREEN PREVIEW MODAL === */}
      <Modal
        visible={previewIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={closePreview}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {previewIndex !== null && selectedPhotoUrls[previewIndex] && (
              <Image
                source={{ uri: selectedPhotoUrls[previewIndex] }}
                style={styles.previewImage}
                contentFit="contain"
                blurRadius={(photoBlurSlots[previewIndex] ?? true) ? 20 : 0}
              />
            )}

            {/* Blur indicator - FIX #1: Use per-slot blur */}
            {previewIndex !== null && (photoBlurSlots[previewIndex] ?? true) && (
              <View style={styles.blurIndicator}>
                <Ionicons name="eye-off" size={16} color="#FFF" />
                <Text style={styles.blurIndicatorText}>Blur enabled</Text>
              </View>
            )}

            {/* Close button */}
            <TouchableOpacity style={styles.modalCloseBtn} onPress={closePreview}>
              <Ionicons name="close" size={28} color="#FFF" />
            </TouchableOpacity>

            {/* Photo counter */}
            {previewIndex !== null && (
              <View style={styles.photoCounter}>
                <Text style={styles.photoCounterText}>
                  {previewIndex + 1} / {photoCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  content: { padding: 16, paddingBottom: 40 },

  // Main title
  mainTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  mainSubtitle: {
    fontSize: 14,
    color: C.textLight,
  },

  // Sections
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  guidanceLine: { fontSize: 13, color: C.textLight, marginBottom: 12, fontStyle: 'italic' },

  // Edit button
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: C.primary + '15',
    borderRadius: 14,
  },
  editBtnText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: '600',
  },

  // Photos grid
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoSlot: {
    width: (screenWidth - 32 - 16) / 3,
    height: ((screenWidth - 32 - 16) / 3) * 1.25,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoHint: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 8,
  },
  blurBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Info card
  infoCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.background,
  },
  infoLabel: {
    fontSize: 14,
    color: C.textLight,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoLabelMissing: {
    color: '#FF6B6B',
  },
  infoValueMissing: {
    color: '#FF6B6B',
    fontStyle: 'italic',
    fontWeight: '400',
  },

  // Warning banner
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,107,107,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  warningText: {
    fontSize: 13,
    color: '#FF6B6B',
    fontWeight: '500',
  },

  // Intents
  intentsTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  intentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primary + '15',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  intentTagText: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 13,
    color: C.textLight,
    fontStyle: 'italic',
  },

  // Prompts section (Step 3 answers)
  promptsContainer: {
    gap: 12,
  },
  promptAnswerCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
  },
  promptQuestion: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    marginBottom: 6,
    lineHeight: 18,
  },
  promptAnswer: {
    fontSize: 15,
    color: C.text,
    lineHeight: 21,
  },

  // Desire Display (read-only)
  desireDisplay: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
  },
  desireText: {
    fontSize: 14,
    color: C.text,
    lineHeight: 22,
  },

  // Info Note
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: C.surface,
    borderRadius: 8,
  },
  infoNoteText: {
    flex: 1,
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.surface,
    backgroundColor: C.background,
  },
  bottomHint: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    marginBottom: 10,
  },
  bottomHintLink: {
    color: C.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  completeBtn: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  completeBtnDisabled: {
    backgroundColor: C.surface,
  },
  completeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  completeBtnTextDisabled: {
    color: C.textLight,
  },

  // Preview Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  modalContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  previewImage: {
    width: screenWidth - 40,
    height: screenWidth * 1.25,
    borderRadius: 12,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCounter: {
    position: 'absolute',
    bottom: 50,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
  },
  photoCounterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  blurIndicator: {
    position: 'absolute',
    top: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
  },
  blurIndicatorText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFF',
  },
});
