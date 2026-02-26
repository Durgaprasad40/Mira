/**
 * Phase 2 Onboarding - Step 3: Desire (Bio) + Review
 *
 * - Single text field named "Desire (Bio)"
 * - Min length: 30 characters
 * - Max length: 300 characters
 * - One short guidance line
 * - Review screen showing: selected photos, relationship intents, desire text
 * - Confirm → enter Phase-2 and mark permanently complete
 */
import React, { useState, useRef } from 'react';
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

const C = INCOGNITO_COLORS;
const screenWidth = Dimensions.get('window').width;

export default function Phase2DesireReview() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bioInputRef = useRef<TextInput>(null);

  // Store state
  const displayName = usePrivateProfileStore((s) => s.displayName);
  const age = usePrivateProfileStore((s) => s.age);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const blurMyPhoto = usePrivateProfileStore((s) => s.blurMyPhoto);

  // Store actions
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);
  const completeSetup = usePrivateProfileStore((s) => s.completeSetup);

  // Validation
  const canContinueDesire = usePrivateProfileStore(selectCanContinueDesire);

  // Computed values
  const bioLength = privateBio.trim().length;
  const photoCount = selectedPhotoUrls.length;

  // Get selected intent labels
  const selectedIntents = PRIVATE_INTENT_CATEGORIES.filter((cat) =>
    intentKeys.includes(cat.key as any)
  );

  // Can complete: desire is valid
  const canComplete = canContinueDesire;

  // Focus bio input when tapping the container
  const handleBioContainerPress = () => {
    bioInputRef.current?.focus();
  };

  // Handle completion
  const handleComplete = () => {
    if (!canComplete) {
      if (bioLength < PHASE2_DESIRE_MIN_LENGTH) {
        Alert.alert('Desire Required', `Please write at least ${PHASE2_DESIRE_MIN_LENGTH} characters about what you desire.`);
      } else if (bioLength > PHASE2_DESIRE_MAX_LENGTH) {
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
        bioLength,
        photoCount,
        blurMyPhoto,
      });
    }

    // Navigate to Phase-2 private tabs
    router.replace('/(main)/(private)/(tabs)' as any);
  };

  // Get validation hint text
  const getDesireHint = () => {
    if (bioLength < PHASE2_DESIRE_MIN_LENGTH) {
      return `Write ${PHASE2_DESIRE_MIN_LENGTH - bioLength} more character${PHASE2_DESIRE_MIN_LENGTH - bioLength > 1 ? 's' : ''}`;
    }
    if (bioLength > PHASE2_DESIRE_MAX_LENGTH) {
      return `${bioLength - PHASE2_DESIRE_MAX_LENGTH} characters over limit`;
    }
    return `${bioLength}/${PHASE2_DESIRE_MAX_LENGTH}`;
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
        <Text style={styles.headerTitle}>Desire & Review</Text>
        <Text style={styles.stepLabel}>Step 3 of 3</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Desire (Bio) Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Desire (Bio)</Text>
          <Text style={styles.guidanceLine}>
            Share what you're looking for in a private connection.
          </Text>
          <TouchableOpacity
            style={styles.bioContainer}
            onPress={handleBioContainerPress}
            activeOpacity={1}
          >
            <TextInput
              ref={bioInputRef}
              style={styles.bioInput}
              value={privateBio}
              onChangeText={setPrivateBio}
              maxLength={PHASE2_DESIRE_MAX_LENGTH + 50} // Allow slightly over for UX, show warning
              multiline
              placeholder="Describe what you desire..."
              placeholderTextColor={C.textLight}
              textAlignVertical="top"
            />
          </TouchableOpacity>
          <View style={styles.bioFooter}>
            <Text
              style={[
                styles.charCount,
                bioLength < PHASE2_DESIRE_MIN_LENGTH && styles.charCountWarning,
                bioLength > PHASE2_DESIRE_MAX_LENGTH && styles.charCountError,
                bioLength >= PHASE2_DESIRE_MIN_LENGTH && bioLength <= PHASE2_DESIRE_MAX_LENGTH && styles.charCountValid,
              ]}
            >
              {getDesireHint()}
            </Text>
          </View>
        </View>

        {/* Review Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Review Your Profile</Text>
          <Text style={styles.sectionSubtitle}>
            This is how your private profile will appear to others.
          </Text>

          {/* Profile Preview Card */}
          <View style={styles.previewCard}>
            {/* Photos Preview */}
            <View style={styles.photosPreview}>
              {selectedPhotoUrls.slice(0, 3).map((url, idx) => (
                <View key={idx} style={styles.photoPreviewSlot}>
                  <Image
                    source={{ uri: url }}
                    style={styles.photoPreviewImage}
                    contentFit="cover"
                  />
                  {blurMyPhoto && (
                    <View style={styles.blurOverlay}>
                      <Ionicons name="eye-off" size={16} color="#FFFFFF" />
                    </View>
                  )}
                </View>
              ))}
              {photoCount > 3 && (
                <View style={[styles.photoPreviewSlot, styles.morePhotosSlot]}>
                  <Text style={styles.morePhotosText}>+{photoCount - 3}</Text>
                </View>
              )}
            </View>

            {/* Name & Age */}
            <View style={styles.nameRow}>
              <Text style={styles.previewName}>
                {displayName || 'Anonymous'}
                {age > 0 ? `, ${age}` : ''}
              </Text>
              {blurMyPhoto && (
                <View style={styles.blurBadge}>
                  <Ionicons name="eye-off" size={12} color={C.primary} />
                  <Text style={styles.blurBadgeText}>Blur ON</Text>
                </View>
              )}
            </View>

            {/* Relationship Intents */}
            {selectedIntents.length > 0 && (
              <View style={styles.intentsPreview}>
                <Text style={styles.intentsLabel}>Looking for</Text>
                <View style={styles.intentsTags}>
                  {selectedIntents.map((intent) => (
                    <View key={intent.key} style={styles.intentTag}>
                      <Ionicons name={intent.icon as any} size={14} color={C.primary} />
                      <Text style={styles.intentTagText}>{intent.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Desire Preview */}
            {privateBio.trim().length > 0 && (
              <View style={styles.desirePreview}>
                <Text style={styles.desireLabel}>Desire</Text>
                <Text style={styles.desireText} numberOfLines={4}>
                  {privateBio.trim()}
                </Text>
              </View>
            )}
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
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Action */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}>
        {!canComplete && (
          <Text style={styles.bottomHint}>
            {bioLength < PHASE2_DESIRE_MIN_LENGTH
              ? `Write ${PHASE2_DESIRE_MIN_LENGTH - bioLength} more character${PHASE2_DESIRE_MIN_LENGTH - bioLength > 1 ? 's' : ''} in Desire`
              : bioLength > PHASE2_DESIRE_MAX_LENGTH
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

  // Sections
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: C.textLight, marginBottom: 12 },
  guidanceLine: { fontSize: 13, color: C.textLight, marginBottom: 12, fontStyle: 'italic' },

  // Bio Input
  bioContainer: {
    backgroundColor: C.surface,
    borderRadius: 12,
    minHeight: 140,
  },
  bioInput: {
    padding: 14,
    fontSize: 14,
    color: C.text,
    minHeight: 140,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  bioFooter: {
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

  // Preview Card
  previewCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
  },

  // Photos Preview
  photosPreview: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  photoPreviewSlot: {
    width: (screenWidth - 64 - 24) / 4,
    height: (screenWidth - 64 - 24) / 4 * 1.2,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: C.background,
  },
  photoPreviewImage: {
    width: '100%',
    height: '100%',
  },
  blurOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  morePhotosSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary + '20',
  },
  morePhotosText: {
    fontSize: 14,
    fontWeight: '700',
    color: C.primary,
  },

  // Name Row
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  previewName: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
  },
  blurBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  blurBadgeText: {
    fontSize: 11,
    color: C.primary,
    fontWeight: '500',
  },

  // Intents Preview
  intentsPreview: {
    marginBottom: 12,
  },
  intentsLabel: {
    fontSize: 11,
    color: C.textLight,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  intentsTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  intentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  intentTagText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: '500',
  },

  // Desire Preview
  desirePreview: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.background,
  },
  desireLabel: {
    fontSize: 11,
    color: C.textLight,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  desireText: {
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
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
});
