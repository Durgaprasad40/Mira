/**
 * Phase 2 Onboarding - Step 3: Categories & Bio
 *
 * Final setup step where user selects intent categories (3-10) and writes a bio.
 * This screen is STORE-ONLY — no Convex calls.
 *
 * IMPORTANT:
 * - Demo mode: store-only (no Convex)
 * - Prod mode: store-only for now (Convex sync can be added later)
 * - completeSetup() handles versioning automatically
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import {
  usePrivateProfileStore,
  selectCanContinueCategories,
} from '@/stores/privateProfileStore';

const C = INCOGNITO_COLORS;
const BIO_MAX = 500;
const BIO_MIN = 10;
const MIN_INTENTS = 3;
const MAX_INTENTS = 10;

export default function Phase2ProfileSetup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bioInputRef = useRef<TextInput>(null);

  // Store state
  const displayName = usePrivateProfileStore((s) => s.displayName);
  const age = usePrivateProfileStore((s) => s.age);
  const city = usePrivateProfileStore((s) => s.city);
  const selectedPhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const privateBio = usePrivateProfileStore((s) => s.privateBio);
  const blurMyPhoto = usePrivateProfileStore((s) => s.blurMyPhoto);

  // Store actions
  const setIntentKeys = usePrivateProfileStore((s) => s.setIntentKeys);
  const setPrivateBio = usePrivateProfileStore((s) => s.setPrivateBio);
  const completeSetup = usePrivateProfileStore((s) => s.completeSetup);

  // Use selector for validation
  const canContinueFromStore = usePrivateProfileStore(selectCanContinueCategories);

  // Local UI state
  const [maxWarning, setMaxWarning] = useState(false);

  // Computed values
  const photoCount = selectedPhotoUrls.length;
  const intentCount = intentKeys.length;
  const bioLength = privateBio.trim().length;

  // Validation: 3-10 categories + bio >= 10 chars + photos >= 2
  const canSave =
    intentCount >= MIN_INTENTS &&
    intentCount <= MAX_INTENTS &&
    bioLength >= BIO_MIN &&
    photoCount >= 2;

  // Toggle intent category with min/max validation
  const toggleCategory = useCallback(
    (key: string) => {
      if (intentKeys.includes(key as any)) {
        // Deselect
        setIntentKeys(intentKeys.filter((k) => k !== key) as any);
        setMaxWarning(false);
      } else {
        // Select - check max limit
        if (intentKeys.length >= MAX_INTENTS) {
          setMaxWarning(true);
          setTimeout(() => setMaxWarning(false), 2000);
          return;
        }
        setIntentKeys([...intentKeys, key] as any);
        setMaxWarning(false);
      }
    },
    [intentKeys, setIntentKeys]
  );

  // Focus bio input when tapping the container
  const handleBioContainerPress = () => {
    bioInputRef.current?.focus();
  };

  // Handle completion
  const handleComplete = () => {
    if (!canSave) {
      if (photoCount < 2) {
        Alert.alert('Photos Required', 'Please go back and select at least 2 photos.');
      } else if (intentCount < MIN_INTENTS) {
        Alert.alert('More Categories Needed', `Please select at least ${MIN_INTENTS} intent categories.`);
      } else if (intentCount > MAX_INTENTS) {
        Alert.alert('Too Many Categories', `Please select no more than ${MAX_INTENTS} intent categories.`);
      } else if (bioLength < BIO_MIN) {
        Alert.alert('Bio Required', `Please write at least ${BIO_MIN} characters about yourself.`);
      }
      return;
    }

    // Dismiss keyboard before navigating
    Keyboard.dismiss();

    // Call completeSetup - this sets isSetupComplete + phase2SetupVersion automatically
    completeSetup();

    if (__DEV__) {
      console.log('[Phase2ProfileSetup] Setup complete:', {
        intentCount,
        bioLength,
        photoCount,
        blurMyPhoto,
      });
    }

    // Navigate to Phase-2 private tabs
    router.replace('/(main)/(private)/(tabs)' as any);
  };

  // Get validation hint text
  const getIntentHint = () => {
    if (maxWarning) {
      return `Maximum ${MAX_INTENTS} categories allowed`;
    }
    if (intentCount < MIN_INTENTS) {
      return `Select at least ${MIN_INTENTS - intentCount} more`;
    }
    return `${intentCount} of ${MIN_INTENTS}-${MAX_INTENTS} selected ✓`;
  };

  // Get bottom hint text
  const getBottomHint = () => {
    if (photoCount < 2) {
      return 'Go back and select at least 2 photos';
    }
    if (intentCount < MIN_INTENTS) {
      return `Select ${MIN_INTENTS - intentCount} more category${MIN_INTENTS - intentCount > 1 ? 'ies' : 'y'}`;
    }
    if (bioLength < BIO_MIN) {
      return `Write ${BIO_MIN - bioLength} more character${BIO_MIN - bioLength > 1 ? 's' : ''} in bio`;
    }
    return '';
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
        <Text style={styles.headerTitle}>Complete Profile</Text>
        <Text style={styles.stepLabel}>Step 3 of 3</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Summary Card - Owner always sees clear photo */}
        <View style={styles.summaryCard}>
          {selectedPhotoUrls[0] && (
            <Image
              source={{ uri: selectedPhotoUrls[0] }}
              style={styles.summaryPhoto}
              contentFit="cover"
            />
          )}
          <View style={styles.summaryInfo}>
            <Text style={styles.summaryName}>
              {displayName || 'Anonymous'}
              {age > 0 ? `, ${age}` : ''}
            </Text>
            {city ? <Text style={styles.summaryCity}>{city}</Text> : null}
            <View style={styles.statusRow}>
              <View style={[styles.statusBadge, photoCount >= 2 && styles.statusBadgeActive]}>
                <Ionicons
                  name={photoCount >= 2 ? 'checkmark-circle' : 'image-outline'}
                  size={12}
                  color={photoCount >= 2 ? '#4CAF50' : C.textLight}
                />
                <Text style={[styles.statusText, photoCount >= 2 && styles.statusTextActive]}>
                  {photoCount} Photos
                </Text>
              </View>
              {blurMyPhoto && (
                <View style={styles.statusBadge}>
                  <Ionicons name="eye-off" size={12} color={C.primary} />
                  <Text style={[styles.statusText, { color: C.primary }]}>Blur ON</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Intent Categories */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>What are you looking for?</Text>
            <Text
              style={[
                styles.countBadge,
                intentCount >= MIN_INTENTS && styles.countBadgeValid,
                maxWarning && styles.countBadgeWarning,
              ]}
            >
              {intentCount}/{MAX_INTENTS}
            </Text>
          </View>
          <Text
            style={[
              styles.sectionHint,
              intentCount < MIN_INTENTS && styles.hintWarning,
              maxWarning && styles.hintError,
            ]}
          >
            {getIntentHint()}
          </Text>
          <View style={styles.chipGrid}>
            {PRIVATE_INTENT_CATEGORIES.map((cat) => {
              const isSelected = intentKeys.includes(cat.key as any);
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.intentChip, isSelected && styles.intentChipSelected]}
                  onPress={() => toggleCategory(cat.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.intentChipText, isSelected && styles.intentChipTextSelected]}>
                    {cat.label}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={14} color={C.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Bio Input */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tell others about yourself</Text>
          <Text style={styles.sectionHint}>
            Describe your vibe, what you're open to, and what makes you unique
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
              maxLength={BIO_MAX}
              multiline
              placeholder="Tell others about yourself..."
              placeholderTextColor={C.textLight}
              textAlignVertical="top"
            />
          </TouchableOpacity>
          <View style={styles.bioFooter}>
            <Text
              style={[
                styles.charCount,
                bioLength < BIO_MIN && styles.charCountWarning,
                bioLength >= BIO_MIN && styles.charCountValid,
              ]}
            >
              {bioLength < BIO_MIN ? `${BIO_MIN - bioLength} more needed` : `${bioLength}/${BIO_MAX}`}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Bottom Action */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}>
        {!canSave && (
          <Text style={styles.bottomHint}>{getBottomHint()}</Text>
        )}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleComplete}
          disabled={!canSave}
          activeOpacity={0.8}
        >
          <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>
            Complete Setup
          </Text>
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={canSave ? '#FFFFFF' : C.textLight}
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

  // Summary Card
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    gap: 16,
  },
  summaryPhoto: {
    width: 80,
    height: 100,
    borderRadius: 12,
    backgroundColor: C.accent,
  },
  summaryInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  summaryName: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  summaryCity: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: C.background,
  },
  statusBadgeActive: {
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
  },
  statusText: {
    fontSize: 11,
    color: C.textLight,
  },
  statusTextActive: {
    color: '#4CAF50',
    fontWeight: '500',
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  countBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: C.textLight,
    backgroundColor: C.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeValid: {
    color: '#4CAF50',
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  countBadgeWarning: {
    color: '#FF6B6B',
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
  },
  sectionHint: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 12,
  },
  hintWarning: {
    color: C.primary,
  },
  hintError: {
    color: '#FF6B6B',
    fontWeight: '500',
  },

  // Chip Grid
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  // Intent Chips
  intentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
    borderWidth: 1.5,
    borderColor: '#3A3A3A',
  },
  intentChipSelected: {
    backgroundColor: C.primary + '18',
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  intentChipText: {
    fontSize: 13,
    color: '#CCCCCC',
    fontWeight: '500',
  },
  intentChipTextSelected: {
    color: C.primary,
    fontWeight: '600',
  },

  // Bio Input
  bioContainer: {
    backgroundColor: C.surface,
    borderRadius: 12,
    minHeight: 120,
  },
  bioInput: {
    padding: 14,
    fontSize: 14,
    color: C.text,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  bioFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  charCount: {
    fontSize: 11,
    color: C.textLight,
  },
  charCountWarning: {
    color: C.primary,
    fontWeight: '500',
  },
  charCountValid: {
    color: '#4CAF50',
  },

  // Bottom Bar
  bottomBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  bottomHint: {
    fontSize: 12,
    color: C.primary,
    textAlign: 'center',
    marginBottom: 10,
  },
  saveBtn: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveBtnDisabled: {
    backgroundColor: C.surface,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  saveBtnTextDisabled: {
    color: C.textLight,
  },
});
