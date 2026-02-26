/**
 * Phase 2 Onboarding - Step 3: Review + Desire
 *
 * Layout order (top to bottom):
 * A) Title: "Review your profile"
 * B) Photos + Name + DOB + Looking For (with Edit buttons)
 * C) Desire (new input section - Phase-2 only, NOT prefilled from Phase-1 Bio)
 *
 * Photos: tap → full-screen preview
 * Edit Photos → navigate to photo-select (Step 2)
 * Edit Looking For → navigate to photo-select (Step 2)
 */
import React, { useState, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Keyboard,
  Dimensions,
  Modal,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import {
  usePrivateProfileStore,
  selectCanContinueDesire,
  PHASE2_DESIRE_MIN_LENGTH,
  PHASE2_DESIRE_MAX_LENGTH,
} from '@/stores/privateProfileStore';
import { useDemoStore } from '@/stores/demoStore';

const C = INCOGNITO_COLORS;
const screenWidth = Dimensions.get('window').width;

export default function Phase2DesireReview() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const desireInputRef = useRef<TextInput>(null);

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

  // Store actions
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);
  const completeSetup = usePrivateProfileStore((s) => s.completeSetup);

  // Validation
  const canContinueDesire = usePrivateProfileStore(selectCanContinueDesire);

  // Preview state
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Computed values
  const desireLength = privateBio.trim().length;
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

  // Can complete: desire is valid
  const canComplete = canContinueDesire;

  // Photo preview handlers
  const openPreview = useCallback((index: number) => {
    setPreviewIndex(index);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
  }, []);

  // Navigation handlers
  const handleEditPhotos = useCallback(() => {
    router.push('/(main)/phase2-onboarding/photo-select' as any);
  }, [router]);

  const handleEditLookingFor = useCallback(() => {
    // Navigate to dedicated Looking For edit screen
    router.push('/(main)/phase2-onboarding/looking-for-edit' as any);
  }, [router]);

  // Focus desire input when tapping the container
  const handleDesireContainerPress = () => {
    desireInputRef.current?.focus();
  };

  // Handle completion
  const handleComplete = () => {
    if (!canComplete) {
      if (desireLength < PHASE2_DESIRE_MIN_LENGTH) {
        Alert.alert('Desire Required', `Please write at least ${PHASE2_DESIRE_MIN_LENGTH} characters about what you desire.`);
      } else if (desireLength > PHASE2_DESIRE_MAX_LENGTH) {
        Alert.alert('Too Long', `Please keep your desire under ${PHASE2_DESIRE_MAX_LENGTH} characters.`);
      }
      return;
    }

    // Dismiss keyboard before navigating
    Keyboard.dismiss();

    // Call completeSetup - this sets isSetupComplete + phase2OnboardingCompleted permanently
    completeSetup();

    if (__DEV__) {
      console.log('[Phase2DesireReview] Setup complete:', {
        intentCount: intentKeys.length,
        desireLength,
        photoCount,
      });
    }

    // Navigate to Phase-2 private tabs
    router.replace('/(main)/(private)/(tabs)' as any);
  };

  // Get validation hint text
  const getDesireHint = () => {
    if (desireLength < PHASE2_DESIRE_MIN_LENGTH) {
      return `Write ${PHASE2_DESIRE_MIN_LENGTH - desireLength} more character${PHASE2_DESIRE_MIN_LENGTH - desireLength > 1 ? 's' : ''}`;
    }
    if (desireLength > PHASE2_DESIRE_MAX_LENGTH) {
      return `${desireLength - PHASE2_DESIRE_MAX_LENGTH} characters over limit`;
    }
    return `${desireLength}/${PHASE2_DESIRE_MAX_LENGTH}`;
  };

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
        <Text style={styles.headerTitle}>Review & Desire</Text>
        <Text style={styles.stepLabel}>Step 3 of 3</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* === SECTION A: Review Title === */}
        <View style={styles.section}>
          <Text style={styles.mainTitle}>Review your profile</Text>
          <Text style={styles.mainSubtitle}>
            This is how your private profile will appear to others.
          </Text>
        </View>

        {/* === SECTION B: Photos === */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Photos</Text>
            <TouchableOpacity style={styles.editBtn} onPress={handleEditPhotos}>
              <Ionicons name="pencil" size={14} color={C.primary} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.photosGrid}>
            {selectedPhotoUrls.map((url, idx) => (
              <Pressable
                key={idx}
                style={styles.photoSlot}
                onPress={() => openPreview(idx)}
              >
                <Image
                  source={{ uri: url }}
                  style={styles.photoImage}
                  contentFit="cover"
                />
              </Pressable>
            ))}
          </View>
          <Text style={styles.photoHint}>Tap a photo to preview</Text>
        </View>

        {/* === Name & DOB === */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile Info</Text>
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
          </View>
        </View>

        {/* === SECTION: Looking For === */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Looking For</Text>
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

        {/* === SECTION C: Desire (Phase-2 only, NOT from Phase-1 Bio) === */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Desire</Text>
          <Text style={styles.guidanceLine}>
            Share what you're looking for in a private connection.
          </Text>
          <TouchableOpacity
            style={styles.desireContainer}
            onPress={handleDesireContainerPress}
            activeOpacity={1}
          >
            <TextInput
              ref={desireInputRef}
              style={styles.desireInput}
              value={privateBio}
              onChangeText={setPrivateBio}
              maxLength={PHASE2_DESIRE_MAX_LENGTH + 50}
              multiline
              placeholder="Describe what you desire..."
              placeholderTextColor={C.textLight}
              textAlignVertical="top"
            />
          </TouchableOpacity>
          <View style={styles.desireFooter}>
            <Text
              style={[
                styles.charCount,
                desireLength < PHASE2_DESIRE_MIN_LENGTH && styles.charCountWarning,
                desireLength > PHASE2_DESIRE_MAX_LENGTH && styles.charCountError,
                desireLength >= PHASE2_DESIRE_MIN_LENGTH && desireLength <= PHASE2_DESIRE_MAX_LENGTH && styles.charCountValid,
              ]}
            >
              {getDesireHint()}
            </Text>
          </View>
        </View>

        {/* Info Note */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={18} color={C.textLight} />
          <Text style={styles.infoNoteText}>
            After completing setup, you can edit your profile anytime from Phase-2 settings.
          </Text>
        </View>

        {/* Bottom spacing */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom Action */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}>
        {!canComplete && (
          <Text style={styles.bottomHint}>
            {desireLength < PHASE2_DESIRE_MIN_LENGTH
              ? `Write ${PHASE2_DESIRE_MIN_LENGTH - desireLength} more character${PHASE2_DESIRE_MIN_LENGTH - desireLength > 1 ? 's' : ''} in Desire`
              : desireLength > PHASE2_DESIRE_MAX_LENGTH
              ? 'Desire text is too long'
              : ''}
          </Text>
        )}
        <TouchableOpacity
          style={[styles.completeBtn, !canComplete && styles.completeBtnDisabled]}
          onPress={handleComplete}
          disabled={!canComplete}
          activeOpacity={0.8}
        >
          <Text style={[styles.completeBtnText, !canComplete && styles.completeBtnTextDisabled]}>
            Enter Private Mode
          </Text>
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={canComplete ? '#FFFFFF' : C.textLight}
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
              />
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

  // Desire Input
  desireContainer: {
    backgroundColor: C.surface,
    borderRadius: 12,
    minHeight: 140,
  },
  desireInput: {
    padding: 14,
    fontSize: 14,
    color: C.text,
    minHeight: 140,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  desireFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  charCount: {
    fontSize: 12,
    color: C.textLight,
  },
  charCountWarning: {
    color: C.primary,
    fontWeight: '500',
  },
  charCountError: {
    color: '#FF6B6B',
    fontWeight: '600',
  },
  charCountValid: {
    color: '#4CAF50',
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
    color: C.primary,
    textAlign: 'center',
    marginBottom: 10,
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
});
