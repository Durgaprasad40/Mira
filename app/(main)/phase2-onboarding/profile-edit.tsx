/**
 * Phase 2 Onboarding - Step 2.5: Profile Edit/Management
 *
 * This is the ONLY screen for editing Phase-2 profile after initial import.
 * All "Edit" buttons from Step-3 route here.
 *
 * Shows:
 * - 9-slot photo grid with add/replace/delete/main/blur
 * - Intent categories (Looking For)
 * - Desire text input
 */
import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  Modal,
  Pressable,
  Alert,
  TextInput,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { useShallow } from 'zustand/react/shallow';
import {
  usePrivateProfileStore,
  PHASE2_MIN_PHOTOS,
  PHASE2_MIN_INTENTS,
  PHASE2_MAX_INTENTS,
  PHASE2_DESIRE_MIN_LENGTH,
  PHASE2_DESIRE_MAX_LENGTH,
  selectCanContinueIntents,
  selectCanContinueDesire,
  selectIsProfileDetailsComplete,
} from '@/stores/privateProfileStore';
import {
  GENDER_OPTIONS,
  SMOKING_OPTIONS,
  DRINKING_OPTIONS,
  EDUCATION_OPTIONS,
  RELIGION_OPTIONS,
} from '@/lib/constants';

const C = INCOGNITO_COLORS;
const GRID_SLOTS = 9;
const COLUMNS = 3;
const GRID_GAP = 8;
const SCREEN_PADDING = 16;
const screenWidth = Dimensions.get('window').width;
const slotSize = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

type PhotoSlots9 = (string | null)[];

function createEmptySlots(): PhotoSlots9 {
  return [null, null, null, null, null, null, null, null, null];
}

export default function Phase2ProfileEdit() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const desireInputRef = useRef<TextInput>(null);

  // Store state
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const gender = usePrivateProfileStore((s) => s.gender);
  const height = usePrivateProfileStore((s) => s.height);
  const smoking = usePrivateProfileStore((s) => s.smoking);
  const drinking = usePrivateProfileStore((s) => s.drinking);
  const education = usePrivateProfileStore((s) => s.education);
  const religion = usePrivateProfileStore((s) => s.religion);

  // Store actions
  const setSelectedPhotos = usePrivateProfileStore((s) => s.setSelectedPhotos);
  const setIntentKeys = usePrivateProfileStore((s) => s.setIntentKeys);
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);
  const setGender = usePrivateProfileStore((s) => s.setGender);
  const setHeight = usePrivateProfileStore((s) => s.setHeight);
  const setSmoking = usePrivateProfileStore((s) => s.setSmoking);
  const setDrinking = usePrivateProfileStore((s) => s.setDrinking);
  const setEducation = usePrivateProfileStore((s) => s.setEducation);
  const setReligion = usePrivateProfileStore((s) => s.setReligion);

  // Validation
  const canContinueIntents = usePrivateProfileStore(selectCanContinueIntents);
  const canContinueDesire = usePrivateProfileStore(selectCanContinueDesire);
  const isProfileDetailsComplete = usePrivateProfileStore(selectIsProfileDetailsComplete);
  const missingProfileFields = usePrivateProfileStore(
    useShallow((s) => {
      const missing: string[] = [];
      if (!s.gender) missing.push('Gender');
      if (s.height === null || s.height <= 0) missing.push('Height');
      if (!s.smoking) missing.push('Smoking');
      if (!s.drinking) missing.push('Drinking');
      if (!s.education) missing.push('Education');
      if (!s.religion) missing.push('Religion');
      return missing;
    })
  );

  // ============================================================
  // LOCAL STATE: 9-slot photo management
  // ============================================================
  // Initialize from store - convert URL array to 9-slot array
  const [photoSlots, setPhotoSlots] = useState<PhotoSlots9>(() => {
    const slots = createEmptySlots();
    selectedPhotoUrls.forEach((url, idx) => {
      if (idx < GRID_SLOTS) slots[idx] = url;
    });
    return slots;
  });
  const [photoBlurSlots, setPhotoBlurSlots] = useState<boolean[]>(() =>
    Array(GRID_SLOTS).fill(true)
  );
  const [mainPhotoSlot, setMainPhotoSlot] = useState<number>(0);
  const [previewSlot, setPreviewSlot] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Local state for height input
  const [heightInput, setHeightInput] = useState<string>(height ? height.toString() : '');

  // Computed values
  const photoCount = useMemo(() => photoSlots.filter((uri) => uri !== null).length, [photoSlots]);
  const desireLength = privateBio.trim().length;
  const canContinue = photoCount >= PHASE2_MIN_PHOTOS && canContinueIntents && canContinueDesire && isProfileDetailsComplete;

  // ============================================================
  // PHOTO HANDLERS
  // ============================================================
  const openPreview = useCallback((slotIndex: number) => {
    if (!photoSlots[slotIndex]) return;
    setPreviewSlot(slotIndex);
  }, [photoSlots]);

  const closePreview = useCallback(() => {
    setPreviewSlot(null);
  }, []);

  const togglePhotoBlur = useCallback((slotIndex: number) => {
    setPhotoBlurSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = !next[slotIndex];
      return next;
    });
  }, []);

  const setAsMainPhoto = useCallback(() => {
    if (previewSlot === null) return;
    setMainPhotoSlot(previewSlot);
    closePreview();
  }, [previewSlot, closePreview]);

  const handleAddPhoto = useCallback(async (slotIndex: number) => {
    if (photoSlots[slotIndex] !== null) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const newUri = result.assets[0].uri;
        setPhotoSlots((prev) => {
          const next = [...prev];
          next[slotIndex] = newUri;
          return next;
        });
        setPhotoBlurSlots((prev) => {
          const next = [...prev];
          next[slotIndex] = true;
          return next;
        });
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to pick image');
    }
  }, [photoSlots]);

  const handleReplacePhoto = useCallback(async () => {
    if (previewSlot === null) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const newUri = result.assets[0].uri;
        setPhotoSlots((prev) => {
          const next = [...prev];
          next[previewSlot] = newUri;
          return next;
        });
        closePreview();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to pick image');
    }
  }, [previewSlot, closePreview]);

  const handleDeletePhoto = useCallback(() => {
    if (previewSlot === null) return;

    const currentCount = photoSlots.filter((uri) => uri !== null).length;
    if (currentCount <= PHASE2_MIN_PHOTOS) {
      Alert.alert('Cannot Delete', `You must have at least ${PHASE2_MIN_PHOTOS} photos.`);
      return;
    }

    Alert.alert('Delete Photo', 'Remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setPhotoSlots((prev) => {
            const next = [...prev];
            next[previewSlot] = null;
            return next;
          });

          if (previewSlot === mainPhotoSlot) {
            const nextMain = photoSlots.findIndex((uri, idx) => uri !== null && idx !== previewSlot);
            setMainPhotoSlot(nextMain >= 0 ? nextMain : 0);
          }

          closePreview();
        },
      },
    ]);
  }, [previewSlot, photoSlots, mainPhotoSlot, closePreview]);

  // ============================================================
  // INTENT HANDLERS
  // ============================================================
  const toggleIntent = useCallback((key: string) => {
    const current = usePrivateProfileStore.getState().intentKeys;
    if (current.includes(key as any)) {
      setIntentKeys(current.filter((k) => k !== key) as any);
    } else if (current.length < PHASE2_MAX_INTENTS) {
      setIntentKeys([...current, key] as any);
    }
  }, [setIntentKeys]);

  // ============================================================
  // CONTINUE HANDLER
  // ============================================================
  const handleContinue = useCallback(() => {
    if (!canContinue || isProcessing) return;
    setIsProcessing(true);
    Keyboard.dismiss();

    // Save photos to store (convert slots to URL array)
    const photoUrls = photoSlots.filter((uri): uri is string => uri !== null);
    setSelectedPhotos([], photoUrls);

    // Navigate to review (Step 3)
    router.push('/(main)/phase2-onboarding/profile-setup' as any);
    setIsProcessing(false);
  }, [canContinue, isProcessing, photoSlots, setSelectedPhotos, router]);

  // Desire hint
  const getDesireHint = () => {
    if (desireLength < PHASE2_DESIRE_MIN_LENGTH) {
      return `Write ${PHASE2_DESIRE_MIN_LENGTH - desireLength} more character${PHASE2_DESIRE_MIN_LENGTH - desireLength > 1 ? 's' : ''}`;
    }
    if (desireLength > PHASE2_DESIRE_MAX_LENGTH) {
      return `${desireLength - PHASE2_DESIRE_MAX_LENGTH} over limit`;
    }
    return `${desireLength}/${PHASE2_DESIRE_MAX_LENGTH}`;
  };

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
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <Text style={styles.stepLabel}>Step 2 of 3</Text>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Section A: Photos */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Photos</Text>
          <Text style={styles.sectionSubtitle}>
            Tap to preview. Tap + to add more. Min {PHASE2_MIN_PHOTOS} photos.
          </Text>

          {/* 9-Slot Grid */}
          <View style={styles.grid}>
            {Array.from({ length: GRID_SLOTS }).map((_, slotIndex) => {
              const uri = photoSlots[slotIndex];
              const isMain = slotIndex === mainPhotoSlot && uri !== null;
              const isBlurred = photoBlurSlots[slotIndex];

              if (uri) {
                return (
                  <View key={`slot-${slotIndex}`} style={styles.slot}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={() => openPreview(slotIndex)}>
                      <Image source={{ uri }} style={styles.slotImage} resizeMode="cover" blurRadius={isBlurred ? 15 : 0} />
                    </Pressable>
                    {isMain && (
                      <View pointerEvents="none" style={styles.starBadge}>
                        <Ionicons name="star" size={14} color="#FFD700" />
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.blurToggleBtn}
                      onPress={() => togglePhotoBlur(slotIndex)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name={isBlurred ? 'eye-off' : 'eye'} size={16} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                );
              }

              return (
                <TouchableOpacity
                  key={`add-${slotIndex}`}
                  style={[styles.slot, styles.addPhotoSlot]}
                  onPress={() => handleAddPhoto(slotIndex)}
                >
                  <Ionicons name="add-circle-outline" size={32} color={C.primary} />
                  <Text style={styles.addPhotoText}>Add</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.countText}>
            {photoCount}/{GRID_SLOTS} photos (blur ON by default)
          </Text>
        </View>

        {/* Section B: Intents (Looking For) */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Looking For</Text>
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

        {/* Section C: Profile Details */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Profile Details</Text>
            {isProfileDetailsComplete ? (
              <View style={styles.completeBadge}>
                <Ionicons name="checkmark-circle" size={14} color="#4CAF50" />
                <Text style={styles.completeBadgeText}>Complete</Text>
              </View>
            ) : (
              <Text style={styles.missingCount}>{missingProfileFields.length} missing</Text>
            )}
          </View>
          <Text style={[styles.sectionSubtitle, !isProfileDetailsComplete && styles.countWarning]}>
            All fields required for Phase-2
          </Text>

          {/* Gender */}
          <View style={styles.detailField}>
            <Text style={styles.detailLabel}>Gender {!gender && <Text style={styles.requiredStar}>*</Text>}</Text>
            <View style={styles.optionsRow}>
              {GENDER_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionChip, gender === opt.value && styles.optionChipSelected]}
                  onPress={() => setGender(gender === opt.value ? '' : opt.value)}
                >
                  <Text style={[styles.optionText, gender === opt.value && styles.optionTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Height */}
          <View style={styles.detailField}>
            <Text style={styles.detailLabel}>Height (cm) {(!height || height <= 0) && <Text style={styles.requiredStar}>*</Text>}</Text>
            <View style={styles.heightInputRow}>
              <TextInput
                style={styles.heightInput}
                value={heightInput}
                onChangeText={(text) => {
                  setHeightInput(text);
                  const num = parseInt(text, 10);
                  setHeight(isNaN(num) || num <= 0 ? null : num);
                }}
                placeholder="e.g. 175"
                placeholderTextColor={C.textLight}
                keyboardType="numeric"
                maxLength={3}
              />
              <Text style={styles.heightUnit}>cm</Text>
            </View>
          </View>

          {/* Smoking */}
          <View style={styles.detailField}>
            <Text style={styles.detailLabel}>Smoking {!smoking && <Text style={styles.requiredStar}>*</Text>}</Text>
            <View style={styles.optionsRow}>
              {SMOKING_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionChip, smoking === opt.value && styles.optionChipSelected]}
                  onPress={() => setSmoking(smoking === opt.value ? null : opt.value)}
                >
                  <Text style={[styles.optionText, smoking === opt.value && styles.optionTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Drinking */}
          <View style={styles.detailField}>
            <Text style={styles.detailLabel}>Drinking {!drinking && <Text style={styles.requiredStar}>*</Text>}</Text>
            <View style={styles.optionsRow}>
              {DRINKING_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionChip, drinking === opt.value && styles.optionChipSelected]}
                  onPress={() => setDrinking(drinking === opt.value ? null : opt.value)}
                >
                  <Text style={[styles.optionText, drinking === opt.value && styles.optionTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Education */}
          <View style={styles.detailField}>
            <Text style={styles.detailLabel}>Education {!education && <Text style={styles.requiredStar}>*</Text>}</Text>
            <View style={styles.optionsRow}>
              {EDUCATION_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionChip, education === opt.value && styles.optionChipSelected]}
                  onPress={() => setEducation(education === opt.value ? null : opt.value)}
                >
                  <Text style={[styles.optionText, education === opt.value && styles.optionTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Religion */}
          <View style={styles.detailField}>
            <Text style={styles.detailLabel}>Religion {!religion && <Text style={styles.requiredStar}>*</Text>}</Text>
            <View style={styles.optionsRow}>
              {RELIGION_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optionChip, religion === opt.value && styles.optionChipSelected]}
                  onPress={() => setReligion(religion === opt.value ? null : opt.value)}
                >
                  <Text style={[styles.optionText, religion === opt.value && styles.optionTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Section D: Desire */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Desire</Text>
          <Text style={styles.sectionSubtitle}>
            Share what you're looking for in a private connection.
          </Text>

          <TouchableOpacity
            style={styles.desireContainer}
            onPress={() => desireInputRef.current?.focus()}
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
          <Text
            style={[
              styles.desireHint,
              desireLength < PHASE2_DESIRE_MIN_LENGTH && styles.desireHintWarning,
              desireLength > PHASE2_DESIRE_MAX_LENGTH && styles.desireHintError,
              canContinueDesire && styles.desireHintValid,
            ]}
          >
            {getDesireHint()}
          </Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom Bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {!canContinue && (
          <Text style={styles.bottomHint}>
            {photoCount < PHASE2_MIN_PHOTOS
              ? `Add ${PHASE2_MIN_PHOTOS - photoCount} more photo${PHASE2_MIN_PHOTOS - photoCount > 1 ? 's' : ''}`
              : !canContinueIntents
              ? `Select ${PHASE2_MIN_INTENTS}-${PHASE2_MAX_INTENTS} intents`
              : !isProfileDetailsComplete
              ? `Complete: ${missingProfileFields.slice(0, 2).join(', ')}${missingProfileFields.length > 2 ? '...' : ''}`
              : `Write ${PHASE2_DESIRE_MIN_LENGTH - desireLength} more characters in Desire`}
          </Text>
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
              <Text style={[styles.continueBtnText, !canContinue && styles.continueBtnTextDisabled]}>
                Continue to Review
              </Text>
              <Ionicons name="arrow-forward" size={18} color={canContinue ? '#FFF' : C.textLight} />
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Preview Modal */}
      <Modal visible={previewSlot !== null} transparent animationType="fade" onRequestClose={closePreview}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {previewSlot !== null && photoSlots[previewSlot] && (
              <Image
                source={{ uri: photoSlots[previewSlot]! }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}

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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: C.textLight, marginBottom: 12 },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  slot: {
    width: slotSize, height: slotSize * 1.25, borderRadius: 10,
    overflow: 'hidden', backgroundColor: C.surface, position: 'relative',
  },
  addPhotoSlot: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.primary + '40', borderStyle: 'dashed',
    backgroundColor: C.primary + '08',
  },
  addPhotoText: { fontSize: 11, color: C.primary, fontWeight: '600', marginTop: 4 },
  slotImage: { width: '100%', height: '100%' },

  // Badges
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

  countText: { fontSize: 13, color: C.textLight, textAlign: 'center', marginTop: 12 },
  countWarning: { color: C.primary, fontWeight: '500' },

  // Intents
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

  // Desire
  desireContainer: { backgroundColor: C.surface, borderRadius: 12, minHeight: 120 },
  desireInput: {
    padding: 14, fontSize: 14, color: C.text, minHeight: 120,
    textAlignVertical: 'top', lineHeight: 22,
  },
  desireHint: { fontSize: 12, color: C.textLight, textAlign: 'right', marginTop: 8 },
  desireHintWarning: { color: C.primary, fontWeight: '500' },
  desireHintError: { color: '#FF6B6B', fontWeight: '600' },
  desireHintValid: { color: '#4CAF50' },

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
  continueBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  continueBtnTextDisabled: { color: C.textLight },

  // Preview Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  modalContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  previewImage: { width: screenWidth - 40, height: screenWidth * 1.25, borderRadius: 12 },
  previewActions: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 24 },
  actionBtn: {
    alignItems: 'center', justifyContent: 'center', padding: 12,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, minWidth: 70,
  },
  actionBtnText: { fontSize: 11, color: '#FFF', marginTop: 4, fontWeight: '500' },
  modalCloseBtn: {
    position: 'absolute', top: 50, right: 20, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },

  // Profile Details
  completeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(76,175,80,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  completeBadgeText: { fontSize: 11, fontWeight: '600', color: '#4CAF50' },
  missingCount: {
    fontSize: 12, fontWeight: '600', color: C.primary,
    backgroundColor: C.primary + '15', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  detailField: { marginBottom: 18 },
  detailLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 8 },
  requiredStar: { color: '#FF6B6B', fontWeight: '700' },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
    backgroundColor: '#2A2A2A', borderWidth: 1.5, borderColor: '#3A3A3A',
  },
  optionChipSelected: { backgroundColor: C.primary + '20', borderColor: C.primary },
  optionText: { fontSize: 13, color: '#CCC', fontWeight: '500' },
  optionTextSelected: { color: C.primary, fontWeight: '600' },
  heightInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heightInput: {
    flex: 1, backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text,
    borderWidth: 1.5, borderColor: '#3A3A3A',
  },
  heightUnit: { fontSize: 14, color: C.textLight, fontWeight: '500' },
});
