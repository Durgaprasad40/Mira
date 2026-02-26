/**
 * Phase 2 Onboarding - Step 2: Profile Setup
 *
 * FINALIZED: Phase-1 style photo management after confirmation
 * - Blur ON by default, per-photo toggle
 * - Main photo with star icon
 * - Full preview with Replace/Delete/Set Main actions
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Switch,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import {
  usePrivateProfileStore,
  PHASE2_MIN_PHOTOS,
  PHASE2_MIN_INTENTS,
  PHASE2_MAX_INTENTS,
} from '@/stores/privateProfileStore';
import { useDemoStore } from '@/stores/demoStore';

const C = INCOGNITO_COLORS;
const GRID_SLOTS = 9;
const COLUMNS = 3;
const GRID_GAP = 8;
const SCREEN_PADDING = 16;
const screenWidth = Dimensions.get('window').width;
const slotSize = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

const LIFESTYLE_LABELS: Record<string, string> = {
  never: 'Never', sometimes: 'Sometimes', socially: 'Socially',
  regularly: 'Regularly', trying_to_quit: 'Trying to quit',
  sober: 'Sober', daily: 'Daily',
};
const KIDS_LABELS: Record<string, string> = {
  have_and_want_more: 'Have kids, want more', have_and_dont_want_more: 'Have kids, done',
  dont_have_and_want: "Don't have, want", dont_have_and_dont_want: "Don't have, don't want",
  not_sure: 'Not sure yet',
};
const EDUCATION_LABELS: Record<string, string> = {
  high_school: 'High School', some_college: 'Some College', associate: 'Associate',
  bachelors: "Bachelor's", masters: "Master's", doctorate: 'Doctorate',
  trade_school: 'Trade School', professional: 'Professional', diploma: 'Diploma', other: 'Other',
};
const RELIGION_LABELS: Record<string, string> = {
  christian: 'Christian', muslim: 'Muslim', hindu: 'Hindu', buddhist: 'Buddhist',
  jewish: 'Jewish', sikh: 'Sikh', atheist: 'Atheist', agnostic: 'Agnostic',
  spiritual: 'Spiritual', other: 'Other', prefer_not_to_say: 'Prefer not to say',
};
const GENDER_LABELS: Record<string, string> = {
  male: 'Man', female: 'Woman', non_binary: 'Non-binary',
};

function calculateAgeFromDob(dob: string | undefined | null): number {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 0;
  const [y, m, d] = dob.split('-').map(Number);
  const birthDate = new Date(y, m - 1, d, 12, 0, 0);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export default function Phase2ProfileSetup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ============================================================
  // SOURCE OF TRUTH: Read photos from Phase-1 profile
  // ============================================================
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const getCurrentProfile = useDemoStore((s) => s.getCurrentProfile);

  const phase1PhotoSlots = useMemo(() => {
    const profile = getCurrentProfile();
    const slots = profile?.photoSlots || [null, null, null, null, null, null, null, null, null];
    const nonNullSlots = slots.map((uri, idx) => (uri ? idx : -1)).filter((i) => i >= 0);
    console.log('[P2 STEP2 RENDER] nonNullSlots=' + JSON.stringify(nonNullSlots));
    return slots;
  }, [getCurrentProfile, demoProfiles, currentDemoUserId]);

  // Profile info from Phase-1
  const phase1Profile = useMemo(() => getCurrentProfile(), [getCurrentProfile, demoProfiles, currentDemoUserId]);
  const displayName = phase1Profile?.name || 'Anonymous';
  const age = phase1Profile?.dateOfBirth ? calculateAgeFromDob(phase1Profile.dateOfBirth) : 0;
  const gender = phase1Profile?.gender || '';
  const height = (phase1Profile as any)?.height || 0;
  const smoking = (phase1Profile as any)?.smoking || '';
  const drinking = (phase1Profile as any)?.drinking || '';
  const kids = (phase1Profile as any)?.kids || '';
  const education = (phase1Profile as any)?.education || '';
  const religion = (phase1Profile as any)?.religion || '';
  const hobbies = (phase1Profile as any)?.hobbies || [];

  // Store
  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setIntentKeys = usePrivateProfileStore((s) => s.setIntentKeys);

  // ============================================================
  // LOCAL STATE
  // ============================================================
  // Selection mode state
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [failedSlots, setFailedSlots] = useState<number[]>([]);

  // Post-confirmation state (Phase-1 style)
  const [phase2Photos, setPhase2Photos] = useState<string[] | null>(null);
  const [mainPhotoIndex, setMainPhotoIndex] = useState(0);
  const [photoBlurStates, setPhotoBlurStates] = useState<boolean[]>([]);

  // Preview state
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Mode flags
  const isSelectionMode = phase2Photos === null;
  const isPhotoMode = phase2Photos !== null;

  // Validation
  const validPhotoCount = phase1PhotoSlots.filter((uri, idx) => uri && !failedSlots.includes(idx)).length;
  const selectedCount = selectedSlots.length;
  const canSelectPhotos = selectedCount >= PHASE2_MIN_PHOTOS;
  const canContinueIntents = intentKeys.length >= PHASE2_MIN_INTENTS && intentKeys.length <= PHASE2_MAX_INTENTS;
  const canContinue = isPhotoMode && canContinueIntents && phase2Photos.length >= PHASE2_MIN_PHOTOS;

  // ============================================================
  // SELECTION MODE HANDLERS
  // ============================================================
  const toggleSelection = useCallback((slotIndex: number) => {
    if (!isSelectionMode) return;
    setSelectedSlots((prev) => {
      if (prev.includes(slotIndex)) {
        return prev.filter((s) => s !== slotIndex);
      }
      return [...prev, slotIndex];
    });
  }, [isSelectionMode]);

  const handleConfirmPhotos = useCallback(() => {
    if (selectedSlots.length < PHASE2_MIN_PHOTOS) return;
    // Create Phase-2 photos array from selected slots
    const photos: string[] = [];
    for (const slotIndex of selectedSlots) {
      const uri = phase1PhotoSlots[slotIndex];
      if (uri) photos.push(uri);
    }
    setPhase2Photos(photos);
    // Blur ON by default for all photos
    setPhotoBlurStates(photos.map(() => true));
    setMainPhotoIndex(0);
  }, [selectedSlots, phase1PhotoSlots]);

  const onSlotError = useCallback((slotIndex: number) => {
    setFailedSlots((prev) => prev.includes(slotIndex) ? prev : [...prev, slotIndex]);
    setSelectedSlots((prev) => prev.filter((s) => s !== slotIndex));
  }, []);

  // ============================================================
  // PHOTO MODE HANDLERS (Phase-1 style)
  // ============================================================
  const openPreview = useCallback((index: number) => {
    if (!isPhotoMode) return;
    setPreviewIndex(index);
  }, [isPhotoMode]);

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
  }, []);

  const togglePhotoBlur = useCallback((index: number) => {
    setPhotoBlurStates((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }, []);

  const setAsMainPhoto = useCallback(() => {
    if (previewIndex === null) return;
    setMainPhotoIndex(previewIndex);
    closePreview();
  }, [previewIndex, closePreview]);

  const handleReplacePhoto = useCallback(async () => {
    if (previewIndex === null || !phase2Photos) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const newUri = result.assets[0].uri;
        setPhase2Photos((prev) => {
          if (!prev) return prev;
          const next = [...prev];
          next[previewIndex] = newUri;
          return next;
        });
        closePreview();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to pick image');
    }
  }, [previewIndex, phase2Photos, closePreview]);

  const handleDeletePhoto = useCallback(() => {
    if (previewIndex === null || !phase2Photos) return;
    if (phase2Photos.length <= PHASE2_MIN_PHOTOS) {
      Alert.alert('Cannot Delete', `You must have at least ${PHASE2_MIN_PHOTOS} photos.`);
      return;
    }
    Alert.alert('Delete Photo', 'Are you sure you want to remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setPhase2Photos((prev) => {
            if (!prev) return prev;
            const next = prev.filter((_, i) => i !== previewIndex);
            return next;
          });
          setPhotoBlurStates((prev) => prev.filter((_, i) => i !== previewIndex));
          // Adjust main photo index if needed
          if (previewIndex === mainPhotoIndex) {
            setMainPhotoIndex(0);
          } else if (previewIndex < mainPhotoIndex) {
            setMainPhotoIndex((prev) => prev - 1);
          }
          closePreview();
        },
      },
    ]);
  }, [previewIndex, phase2Photos, mainPhotoIndex, closePreview]);

  // ============================================================
  // OTHER HANDLERS
  // ============================================================
  const toggleIntent = useCallback((key: string) => {
    const current = usePrivateProfileStore.getState().intentKeys;
    if (current.includes(key as any)) {
      setIntentKeys(current.filter((k) => k !== key) as any);
    } else if (current.length < PHASE2_MAX_INTENTS) {
      setIntentKeys([...current, key] as any);
    }
  }, [setIntentKeys]);

  const handleContinue = () => {
    if (!canContinue || isProcessing || !phase2Photos) return;
    setIsProcessing(true);
    setSelectedPhotos([], phase2Photos);
    router.push('/(main)/phase2-onboarding/profile-setup' as any);
    setIsProcessing(false);
  };

  const infoItems = [
    height ? { label: 'Height', value: `${height} cm` } : null,
    smoking ? { label: 'Smoking', value: LIFESTYLE_LABELS[smoking] || smoking } : null,
    drinking ? { label: 'Drinking', value: LIFESTYLE_LABELS[drinking] || drinking } : null,
    kids ? { label: 'Kids', value: KIDS_LABELS[kids] || kids } : null,
    education ? { label: 'Education', value: EDUCATION_LABELS[education] || education } : null,
    religion ? { label: 'Religion', value: RELIGION_LABELS[religion] || religion } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Setup</Text>
        <Text style={styles.stepLabel}>Step 2 of 3</Text>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Section A: Photos */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {isSelectionMode ? 'Select Your Photos' : 'Your Phase-2 Photos'}
          </Text>
          <Text style={styles.sectionSubtitle}>
            {isSelectionMode
              ? `Select at least ${PHASE2_MIN_PHOTOS} photos for your Phase-2 profile.`
              : 'Tap a photo to preview, replace, or delete.'}
          </Text>

          {/* Empty state */}
          {validPhotoCount === 0 && isSelectionMode && (
            <View style={styles.emptyStateContainer}>
              <Ionicons name="images-outline" size={48} color={C.textLight} />
              <Text style={styles.emptyStateTitle}>No Photos Found</Text>
              <Text style={styles.emptyStateText}>
                Your Phase-1 photos could not be loaded. Please go back and add photos first.
              </Text>
            </View>
          )}

          {/* GRID */}
          <View style={styles.grid}>
            {isSelectionMode ? (
              // SELECTION MODE
              phase1PhotoSlots.map((uri, slotIndex) => {
                const hasFailed = failedSlots.includes(slotIndex);
                const isSelected = selectedSlots.includes(slotIndex);
                const selectionOrder = isSelected ? selectedSlots.indexOf(slotIndex) + 1 : 0;

                if (uri && !hasFailed) {
                  return (
                    <Pressable
                      key={`slot-${slotIndex}`}
                      style={styles.slot}
                      onPress={() => toggleSelection(slotIndex)}
                    >
                      <Image source={{ uri }} style={styles.slotImage} resizeMode="cover" onError={() => onSlotError(slotIndex)} />
                      {isSelected && (
                        <View pointerEvents="none" style={styles.orderBadge}>
                          <Text style={styles.orderBadgeText}>{selectionOrder}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                }

                return (
                  <View key={`empty-${slotIndex}`} style={[styles.slot, styles.emptySlot]}>
                    <Ionicons name="image-outline" size={24} color={C.textLight} />
                  </View>
                );
              })
            ) : (
              // PHOTO MODE (Phase-1 style)
              phase2Photos!.map((uri, idx) => {
                const isMain = idx === mainPhotoIndex;
                const isBlurred = photoBlurStates[idx];

                return (
                  <View key={`p2-${idx}`} style={styles.slot}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => openPreview(idx)}>
                      <Image source={{ uri }} style={styles.slotImage} resizeMode="cover" blurRadius={isBlurred ? 15 : 0} />
                    </Pressable>
                    {/* Main photo star */}
                    {isMain && (
                      <View pointerEvents="none" style={styles.starBadge}>
                        <Ionicons name="star" size={14} color="#FFD700" />
                      </View>
                    )}
                    {/* Blur toggle eye icon - tappable */}
                    <TouchableOpacity
                      style={styles.blurToggleBtn}
                      onPress={() => togglePhotoBlur(idx)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name={isBlurred ? 'eye-off' : 'eye'} size={16} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>

          {/* SELECT PHOTOS BUTTON (selection mode only) */}
          {isSelectionMode && (
            <TouchableOpacity
              style={[styles.selectPhotosBtn, !canSelectPhotos && styles.selectPhotosBtnDisabled]}
              onPress={handleConfirmPhotos}
              disabled={!canSelectPhotos}
            >
              <Ionicons name="checkmark-circle" size={20} color={canSelectPhotos ? '#FFF' : C.textLight} />
              <Text style={[styles.selectPhotosBtnText, !canSelectPhotos && styles.selectPhotosBtnTextDisabled]}>
                {canSelectPhotos ? 'Confirm Photos' : `Confirm Photos (select at least ${PHASE2_MIN_PHOTOS})`}
              </Text>
            </TouchableOpacity>
          )}

          {/* Photo count */}
          {isSelectionMode && (
            <Text style={[styles.countText, !canSelectPhotos && styles.countWarning]}>
              {selectedCount < PHASE2_MIN_PHOTOS
                ? `Select ${PHASE2_MIN_PHOTOS - selectedCount} more photo${PHASE2_MIN_PHOTOS - selectedCount === 1 ? '' : 's'}`
                : `${selectedCount}/${GRID_SLOTS} selected`}
            </Text>
          )}
          {isPhotoMode && (
            <Text style={styles.countText}>
              {phase2Photos!.length} photos (blur ON by default)
            </Text>
          )}
        </View>

        {/* Section B: Profile Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Profile Info</Text>
          <Text style={styles.sectionSubtitle}>Imported from main profile. Edit later in settings.</Text>

          <View style={styles.profileCard}>
            <View style={styles.mainInfo}>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Name</Text>
                <Text style={styles.infoValue}>{displayName || 'Anonymous'}</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Age</Text>
                <Text style={styles.infoValue}>{age > 0 ? age : '-'}</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Gender</Text>
                <Text style={styles.infoValue}>{GENDER_LABELS[gender] || gender || '-'}</Text>
              </View>
            </View>

            {infoItems.length > 0 && (
              <View style={styles.infoChips}>
                {infoItems.map((item, i) => (
                  <View key={i} style={styles.chip}>
                    <Text style={styles.chipLabel}>{item.label}</Text>
                    <Text style={styles.chipValue}>{item.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {hobbies && hobbies.length > 0 && (
              <View style={styles.hobbiesSection}>
                <Text style={styles.hobbiesLabel}>Interests</Text>
                <View style={styles.hobbyTags}>
                  {hobbies.slice(0, 6).map((h: string, i: number) => (
                    <View key={i} style={styles.hobbyTag}>
                      <Text style={styles.hobbyText}>{h}</Text>
                    </View>
                  ))}
                  {hobbies.length > 6 && (
                    <View style={styles.hobbyTag}>
                      <Text style={styles.hobbyText}>+{hobbies.length - 6}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Section C: Intents */}
        <View style={styles.section}>
          <View style={styles.intentHeader}>
            <Text style={styles.sectionTitle}>What are you looking for?</Text>
            <Text style={[styles.intentCount, canContinueIntents && styles.intentCountValid]}>
              {intentKeys.length}/{PHASE2_MAX_INTENTS}
            </Text>
          </View>
          <Text style={[styles.sectionSubtitle, !canContinueIntents && styles.countWarning]}>
            Select {PHASE2_MIN_INTENTS}-{PHASE2_MAX_INTENTS} intents
          </Text>

          <View style={styles.intentGrid}>
            {PRIVATE_INTENT_CATEGORIES.map((cat) => {
              const selected = intentKeys.includes(cat.key as any);
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.intentChip, selected && styles.intentChipSelected]}
                  onPress={() => toggleIntent(cat.key)}
                >
                  <Ionicons name={cat.icon as any} size={16} color={selected ? C.primary : C.textLight} />
                  <Text style={[styles.intentText, selected && styles.intentTextSelected]}>{cat.label}</Text>
                  {selected && <Ionicons name="checkmark" size={14} color={C.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {isSelectionMode && (
          <Text style={styles.bottomHint}>Select photos above, then press "Confirm Photos"</Text>
        )}
        {isPhotoMode && !canContinueIntents && (
          <Text style={styles.bottomHint}>Select at least {PHASE2_MIN_INTENTS} intent to continue</Text>
        )}
        <TouchableOpacity
          style={[styles.continueBtn, (!canContinue || isProcessing) && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!canContinue || isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Text style={[styles.continueText, !canContinue && styles.continueTextDisabled]}>Continue</Text>
              <Ionicons name="arrow-forward" size={18} color={canContinue ? '#FFF' : C.textLight} />
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* FULL-SCREEN PREVIEW MODAL (Phase-1 style) */}
      <Modal visible={isPhotoMode && previewIndex !== null} transparent animationType="fade" onRequestClose={closePreview}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {previewIndex !== null && phase2Photos && phase2Photos[previewIndex] && (
              <Image
                source={{ uri: phase2Photos[previewIndex] }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}

            {/* Action buttons */}
            <View style={styles.previewActions}>
              <TouchableOpacity style={styles.actionBtn} onPress={setAsMainPhoto}>
                <Ionicons name="star" size={22} color="#FFD700" />
                <Text style={styles.actionBtnText}>Set Main</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={handleReplacePhoto}>
                <Ionicons name="swap-horizontal" size={22} color="#FFF" />
                <Text style={styles.actionBtnText}>Replace</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={handleDeletePhoto}>
                <Ionicons name="trash" size={22} color="#FF6B6B" />
                <Text style={[styles.actionBtnText, { color: '#FF6B6B' }]}>Delete</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={closePreview}>
                <Ionicons name="close" size={22} color="#FFF" />
                <Text style={styles.actionBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            {/* Close button */}
            <TouchableOpacity style={styles.modalCloseBtn} onPress={closePreview}>
              <Ionicons name="close" size={28} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scrollView: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  stepLabel: { fontSize: 12, color: C.textLight },
  section: { paddingHorizontal: SCREEN_PADDING, paddingTop: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: C.textLight, marginBottom: 12 },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  slot: {
    width: slotSize, height: slotSize * 1.25, borderRadius: 10,
    overflow: 'hidden', backgroundColor: C.surface, position: 'relative',
  },
  emptySlot: { alignItems: 'center', justifyContent: 'center', opacity: 0.5 },
  slotImage: { width: '100%', height: '100%' },

  // Badges
  orderBadge: {
    position: 'absolute', top: 6, right: 6, width: 26, height: 26,
    borderRadius: 13, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  orderBadgeText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  starBadge: {
    position: 'absolute', top: 6, left: 6, width: 26, height: 26,
    borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  blurToggleBtn: {
    position: 'absolute', bottom: 6, right: 6, width: 28, height: 28,
    borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },

  // Select button
  selectPhotosBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, marginTop: 16,
  },
  selectPhotosBtnDisabled: { backgroundColor: C.surface },
  selectPhotosBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  selectPhotosBtnTextDisabled: { color: C.textLight },

  countText: { fontSize: 13, color: C.textLight, textAlign: 'center', marginTop: 12 },
  countWarning: { color: C.primary, fontWeight: '500' },

  // Empty state
  emptyStateContainer: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 32,
    backgroundColor: C.surface, borderRadius: 12, marginBottom: 16,
  },
  emptyStateTitle: { fontSize: 16, fontWeight: '600', color: C.text, marginTop: 12, marginBottom: 8 },
  emptyStateText: { fontSize: 13, color: C.textLight, textAlign: 'center', paddingHorizontal: 24 },

  // Profile card
  profileCard: { backgroundColor: C.surface, borderRadius: 12, padding: 16 },
  mainInfo: {
    flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16,
    paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.background,
  },
  infoItem: { alignItems: 'center', flex: 1 },
  infoLabel: { fontSize: 11, color: C.textLight, marginBottom: 4 },
  infoValue: { fontSize: 16, fontWeight: '700', color: C.text },
  infoChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: C.background, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chipLabel: { fontSize: 10, color: C.textLight, marginBottom: 2 },
  chipValue: { fontSize: 13, fontWeight: '600', color: C.text },
  hobbiesSection: { marginTop: 16 },
  hobbiesLabel: { fontSize: 11, color: C.textLight, marginBottom: 8 },
  hobbyTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hobbyTag: { backgroundColor: C.primary + '20', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  hobbyText: { fontSize: 11, color: C.primary, fontWeight: '500' },

  // Intents
  intentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  intentCount: {
    fontSize: 12, fontWeight: '600', color: C.textLight,
    backgroundColor: C.surface, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  intentCountValid: { color: '#4CAF50', backgroundColor: 'rgba(76,175,80,0.15)' },
  intentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  intentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20,
    backgroundColor: '#2A2A2A', borderWidth: 1.5, borderColor: '#3A3A3A',
  },
  intentChipSelected: { backgroundColor: C.primary + '18', borderColor: C.primary },
  intentText: { fontSize: 13, color: '#CCC', fontWeight: '500' },
  intentTextSelected: { color: C.primary, fontWeight: '600' },

  // Bottom
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1,
    borderTopColor: C.surface, backgroundColor: C.background,
  },
  bottomHint: { fontSize: 12, color: C.primary, textAlign: 'center', marginBottom: 8 },
  continueBtn: {
    flexDirection: 'row', backgroundColor: C.primary, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  continueBtnDisabled: { backgroundColor: C.surface },
  continueText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  continueTextDisabled: { color: C.textLight },

  // Preview Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  modalContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  previewImage: {
    width: screenWidth - 40, height: screenWidth * 1.25, borderRadius: 12,
  },
  previewActions: {
    flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 24,
  },
  actionBtn: {
    alignItems: 'center', justifyContent: 'center', padding: 12,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, minWidth: 70,
  },
  actionBtnText: { fontSize: 11, color: '#FFF', marginTop: 4, fontWeight: '500' },
  modalCloseBtn: {
    position: 'absolute', top: 50, right: 20,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
});
