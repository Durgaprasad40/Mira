/**
 * Phase-2 Edit Profile Details Screen
 *
 * Allows editing profile details for the private profile.
 * This is a standalone edit screen within Phase-2 (no onboarding navigation).
 *
 * Uses onboarding-style selectable cards (all options visible directly).
 *
 * Editable fields: height, weight, smoking, drinking, education, religion
 * Locked fields (read-only): name, age, gender, User ID
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';

const C = INCOGNITO_COLORS;

// Height/Weight validation
const HEIGHT_MIN = 100;
const HEIGHT_MAX = 250;
const WEIGHT_MIN = 30;
const WEIGHT_MAX = 300;

// Options for each field
const SMOKING_OPTIONS = [
  { value: null, label: 'Prefer not to say' },
  { value: 'never', label: 'Never' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'regularly', label: 'Regularly' },
];

const DRINKING_OPTIONS = [
  { value: null, label: 'Prefer not to say' },
  { value: 'never', label: 'Never' },
  { value: 'socially', label: 'Socially' },
  { value: 'regularly', label: 'Regularly' },
];

const EDUCATION_OPTIONS = [
  { value: null, label: 'Prefer not to say' },
  { value: 'high_school', label: 'High School' },
  { value: 'some_college', label: 'Some College' },
  { value: 'bachelors', label: "Bachelor's" },
  { value: 'masters', label: "Master's" },
  { value: 'doctorate', label: 'Doctorate' },
  { value: 'trade_school', label: 'Trade School' },
];

const RELIGION_OPTIONS = [
  { value: null, label: 'Prefer not to say' },
  { value: 'agnostic', label: 'Agnostic' },
  { value: 'atheist', label: 'Atheist' },
  { value: 'buddhist', label: 'Buddhist' },
  { value: 'catholic', label: 'Catholic' },
  { value: 'christian', label: 'Christian' },
  { value: 'hindu', label: 'Hindu' },
  { value: 'jewish', label: 'Jewish' },
  { value: 'muslim', label: 'Muslim' },
  { value: 'spiritual', label: 'Spiritual' },
  { value: 'other', label: 'Other' },
];

const GENDER_LABELS: Record<string, string> = {
  male: 'Man',
  female: 'Woman',
  non_binary: 'Non-binary',
};

export default function EditProfileDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Auth
  const { userId } = useAuthStore();

  // Backend query for profile data
  const backendProfile = useQuery(
    api.privateProfiles.getByAuthUserId,
    !isDemoMode && userId ? { authUserId: userId } : 'skip'
  );

  // Backend mutation for saving (auth-safe, no ctx.auth.getUserIdentity)
  const updatePrivateProfile = useMutation(api.privateProfiles.updateFieldsByAuthId);

  // Store - Read-only fields
  const displayName = usePrivateProfileStore((s) => s.displayName);
  const age = usePrivateProfileStore((s) => s.age);
  const gender = usePrivateProfileStore((s) => s.gender);

  // Store - Editable fields
  const storeHeight = usePrivateProfileStore((s) => s.height);
  const storeWeight = usePrivateProfileStore((s) => s.weight);
  const storeSmoking = usePrivateProfileStore((s) => s.smoking);
  const storeDrinking = usePrivateProfileStore((s) => s.drinking);
  const storeEducation = usePrivateProfileStore((s) => s.education);
  const storeReligion = usePrivateProfileStore((s) => s.religion);

  // Store setters
  const setHeight = usePrivateProfileStore((s) => s.setHeight);
  const setWeight = usePrivateProfileStore((s) => s.setWeight);
  const setSmoking = usePrivateProfileStore((s) => s.setSmoking);
  const setDrinking = usePrivateProfileStore((s) => s.setDrinking);
  const setEducation = usePrivateProfileStore((s) => s.setEducation);
  const setReligion = usePrivateProfileStore((s) => s.setReligion);

  // Local state
  const [heightText, setHeightText] = useState(storeHeight ? String(storeHeight) : '');
  const [weightText, setWeightText] = useState(storeWeight ? String(storeWeight) : '');
  const [smoking, setLocalSmoking] = useState(storeSmoking);
  const [drinking, setLocalDrinking] = useState(storeDrinking);
  const [education, setLocalEducation] = useState(storeEducation);
  const [religion, setLocalReligion] = useState(storeReligion);
  const [isSaving, setIsSaving] = useState(false);

  // Parse height/weight for comparison and validation
  const parsedHeight = heightText.trim() === '' ? null : parseInt(heightText, 10);
  const parsedWeight = weightText.trim() === '' ? null : parseInt(weightText, 10);
  const isHeightValid = parsedHeight === null || (parsedHeight >= HEIGHT_MIN && parsedHeight <= HEIGHT_MAX);
  const isWeightValid = parsedWeight === null || (parsedWeight >= WEIGHT_MIN && parsedWeight <= WEIGHT_MAX);

  // Check if any changes were made
  const hasChanges =
    parsedHeight !== storeHeight ||
    parsedWeight !== storeWeight ||
    smoking !== storeSmoking ||
    drinking !== storeDrinking ||
    education !== storeEducation ||
    religion !== storeReligion;

  const handleSave = async () => {
    if (!hasChanges || isSaving) return;

    // Validate height
    if (!isHeightValid) {
      Alert.alert('Invalid Height', `Height must be between ${HEIGHT_MIN} and ${HEIGHT_MAX} cm.`);
      return;
    }

    // Validate weight
    if (!isWeightValid) {
      Alert.alert('Invalid Weight', `Weight must be between ${WEIGHT_MIN} and ${WEIGHT_MAX} kg.`);
      return;
    }

    setIsSaving(true);
    try {
      // Update local store
      setHeight(parsedHeight);
      setWeight(parsedWeight);
      setSmoking(smoking);
      setDrinking(drinking);
      setEducation(education);
      setReligion(religion);

      // Sync to Convex backend (auth-safe mutation)
      if (!isDemoMode && userId) {
        try {
          const result = await updatePrivateProfile({
            authUserId: userId,
            height: parsedHeight,
            weight: parsedWeight,
            smoking: smoking,
            drinking: drinking,
            education: education,
            religion: religion,
          });
          if (__DEV__ && result.success) {
            console.log('[EditProfileDetails] Synced to Convex');
          }
        } catch (syncError) {
          if (__DEV__) {
            console.error('[EditProfileDetails] Backend sync failed:', syncError);
          }
          // Local store is already updated, continue
        }
      }

      router.back();
    } catch (error) {
      if (__DEV__) {
        console.error('[EditProfileDetails] Save error:', error);
      }
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Render selectable option pills (onboarding-style)
  const renderOptionPills = (
    options: { value: string | null; label: string }[],
    currentValue: string | null,
    setValue: (val: string | null) => void
  ) => {
    return (
      <View style={styles.pillsContainer}>
        {options.map((option, idx) => {
          const isSelected = option.value === currentValue;
          return (
            <TouchableOpacity
              key={idx}
              style={[styles.pill, isSelected && styles.pillSelected]}
              onPress={() => setValue(option.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Details</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!hasChanges || isSaving}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <Text style={[styles.saveBtn, (!hasChanges || isSaving) && styles.saveBtnDisabled]}>
              Save
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Locked Fields Section */}
        <Text style={styles.sectionTitle}>Basic Info</Text>
        <Text style={styles.sectionHint}>These details are imported from your main profile</Text>

        <View style={styles.lockedCard}>
          <View style={styles.lockedRow}>
            <Text style={styles.lockedLabel}>Name</Text>
            <Text style={styles.lockedValue}>{displayName || 'Not set'}</Text>
          </View>
          <View style={styles.lockedRow}>
            <Text style={styles.lockedLabel}>Age</Text>
            <Text style={styles.lockedValue}>{age > 0 ? age : 'Not set'}</Text>
          </View>
          <View style={[styles.lockedRow, styles.lockedRowLast]}>
            <Text style={styles.lockedLabel}>Gender</Text>
            <Text style={styles.lockedValue}>
              {GENDER_LABELS[gender] || gender || 'Not set'}
            </Text>
          </View>
        </View>

        {/* Height & Weight - Numeric Inputs */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Body</Text>

        <View style={styles.numericInputsRow}>
          <View style={styles.numericInputGroup}>
            <Text style={styles.fieldLabel}>Height</Text>
            <View style={styles.numericInputBox}>
              <TextInput
                style={[styles.numericInput, !isHeightValid && styles.numericInputError]}
                value={heightText}
                onChangeText={setHeightText}
                keyboardType="numeric"
                placeholder="178"
                placeholderTextColor={C.textLight}
                maxLength={3}
              />
              <Text style={styles.unitText}>cm</Text>
            </View>
            {!isHeightValid && (
              <Text style={styles.inputError}>
                {HEIGHT_MIN}-{HEIGHT_MAX}
              </Text>
            )}
          </View>

          <View style={styles.numericInputGroup}>
            <Text style={styles.fieldLabel}>Weight</Text>
            <View style={styles.numericInputBox}>
              <TextInput
                style={[styles.numericInput, !isWeightValid && styles.numericInputError]}
                value={weightText}
                onChangeText={setWeightText}
                keyboardType="numeric"
                placeholder="72"
                placeholderTextColor={C.textLight}
                maxLength={3}
              />
              <Text style={styles.unitText}>kg</Text>
            </View>
            {!isWeightValid && (
              <Text style={styles.inputError}>
                {WEIGHT_MIN}-{WEIGHT_MAX}
              </Text>
            )}
          </View>
        </View>

        {/* Smoking */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Lifestyle</Text>

        <Text style={styles.fieldLabel}>Smoking</Text>
        {renderOptionPills(SMOKING_OPTIONS, smoking, setLocalSmoking)}

        {/* Drinking */}
        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Drinking</Text>
        {renderOptionPills(DRINKING_OPTIONS, drinking, setLocalDrinking)}

        {/* Education */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Background</Text>

        <Text style={styles.fieldLabel}>Education</Text>
        {renderOptionPills(EDUCATION_OPTIONS, education, setLocalEducation)}

        {/* Religion */}
        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Religion</Text>
        {renderOptionPills(RELIGION_OPTIONS, religion, setLocalReligion)}
      </ScrollView>
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
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  saveBtn: {
    fontSize: 16,
    fontWeight: '600',
    color: C.primary,
  },
  saveBtnDisabled: {
    color: C.textLight,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 12,
  },
  lockedCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 4,
  },
  lockedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.background,
  },
  lockedRowLast: {
    borderBottomWidth: 0,
  },
  lockedLabel: {
    fontSize: 15,
    color: C.textLight,
  },
  lockedValue: {
    fontSize: 15,
    color: C.text,
    fontWeight: '500',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 10,
    marginTop: 4,
  },
  // Numeric inputs (height/weight)
  numericInputsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  numericInputGroup: {
    flex: 1,
  },
  numericInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  numericInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  numericInputError: {
    color: '#FF6B6B',
  },
  unitText: {
    fontSize: 16,
    color: C.textLight,
    fontWeight: '500',
  },
  inputError: {
    fontSize: 11,
    color: '#FF6B6B',
    marginTop: 4,
    textAlign: 'center',
  },
  // Selectable pills (onboarding-style)
  pillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.surface,
  },
  pillSelected: {
    backgroundColor: C.primary + '20',
    borderColor: C.primary,
  },
  pillText: {
    fontSize: 14,
    color: C.text,
    fontWeight: '500',
  },
  pillTextSelected: {
    color: C.primary,
    fontWeight: '600',
  },
});
