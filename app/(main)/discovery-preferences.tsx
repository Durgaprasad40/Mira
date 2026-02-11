import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, GENDER_OPTIONS, ORIENTATION_OPTIONS, RELATIONSHIP_INTENTS, INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { Button, Input } from '@/components/ui';
import { useFilterStore, kmToMiles, milesToKm } from '@/stores/filterStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Gender, Orientation } from '@/types';

// Age and distance limits
const MIN_AGE = 18;
const MAX_AGE = 70;
const MAX_DISTANCE_MILES = 100; // UI shows miles
const MAX_DISTANCE_KM = milesToKm(MAX_DISTANCE_MILES); // ~161km stored

// "Looking for" selection limits (applies to BOTH phases)
const MIN_LOOKING_FOR = 1;
const MAX_LOOKING_FOR = 2;

// Phase-1 intent selection limits
const MIN_PHASE1_INTENTS = 1;
const MAX_PHASE1_INTENTS = 3;

// Phase-2 intent selection limits
const MIN_PHASE2_INTENTS = 1;
const MAX_PHASE2_INTENTS = 5;

export default function DiscoveryPreferencesScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const segments = useSegments();

  // Phase detection: explicit param takes priority, then infer from route segments
  // Phase-2 ONLY if mode='phase2' explicitly OR navigated from (private) route group
  const isInPrivateRoute = segments.some(s => String(s).includes('private'));
  const isPhase2 = mode === 'phase2' || (mode === undefined && isInPrivateRoute);

  const { userId } = useAuthStore();

  const {
    minAge,
    maxAge,
    maxDistance, // Stored in km
    gender: lookingFor,
    orientation,
    relationshipIntent,
    privateIntentKeys,
    setMinAge,
    setMaxAge,
    setMaxDistanceKm,
    toggleGender,
    toggleOrientation,
    toggleRelationshipIntent,
    togglePrivateIntentKey,
    setRelationshipIntent,
    setPrivateIntentKeys,
    incrementFilterVersion,
  } = useFilterStore();

  // Theme colors based on phase
  const theme = isPhase2 ? INCOGNITO_COLORS : COLORS;
  const bgColor = isPhase2 ? INCOGNITO_COLORS.background : COLORS.background;
  const textColor = isPhase2 ? INCOGNITO_COLORS.text : COLORS.text;
  const textLightColor = isPhase2 ? INCOGNITO_COLORS.textLight : COLORS.textLight;
  const accentColor = isPhase2 ? INCOGNITO_COLORS.primary : COLORS.primary;

  // Defensive cleanup: remove stale/invalid intent values from old saves
  useEffect(() => {
    // Phase-1: Filter relationshipIntent to only valid RELATIONSHIP_INTENTS values
    const validPhase1Keys = RELATIONSHIP_INTENTS.map(i => i.value);
    const cleanedPhase1 = relationshipIntent.filter(v => validPhase1Keys.includes(v));
    if (cleanedPhase1.length !== relationshipIntent.length) {
      setRelationshipIntent(cleanedPhase1);
      if (__DEV__) console.log('[Prefs] Cleaned stale Phase-1 intents:', relationshipIntent.length - cleanedPhase1.length, 'removed');
    }

    // Phase-2: Filter privateIntentKeys to only valid PRIVATE_INTENT_CATEGORIES values
    const validPhase2Keys: string[] = PRIVATE_INTENT_CATEGORIES.map(c => c.key);
    const cleanedPhase2 = privateIntentKeys.filter(k => validPhase2Keys.includes(k));
    if (cleanedPhase2.length !== privateIntentKeys.length) {
      setPrivateIntentKeys(cleanedPhase2);
      if (__DEV__) console.log('[Prefs] Cleaned stale Phase-2 intents:', privateIntentKeys.length - cleanedPhase2.length, 'removed');
    }
  }, []); // Run once on mount

  // "Looking for" toggle with min/max enforcement (applies to BOTH phases)
  const handleLookingForToggle = (genderValue: Gender) => {
    const isSelected = lookingFor.includes(genderValue);

    if (isSelected) {
      // Trying to deselect — enforce minimum
      if (lookingFor.length <= MIN_LOOKING_FOR) {
        Alert.alert('Selection limit', `Select at least ${MIN_LOOKING_FOR}.`);
        return;
      }
    } else {
      // Trying to select — enforce maximum
      if (lookingFor.length >= MAX_LOOKING_FOR) {
        Alert.alert('Selection limit', `You can select up to ${MAX_LOOKING_FOR}.`);
        return;
      }
    }

    toggleGender(genderValue);
  };

  // Phase-1 intent toggle with min/max enforcement
  const handlePhase1IntentToggle = (intentValue: typeof RELATIONSHIP_INTENTS[number]['value']) => {
    const isSelected = relationshipIntent.includes(intentValue);

    if (isSelected) {
      // Trying to deselect — enforce minimum
      if (relationshipIntent.length <= MIN_PHASE1_INTENTS) {
        Alert.alert('Selection limit', `Select at least ${MIN_PHASE1_INTENTS}.`);
        return;
      }
    } else {
      // Trying to select — enforce maximum
      if (relationshipIntent.length >= MAX_PHASE1_INTENTS) {
        Alert.alert('Selection limit', `You can select up to ${MAX_PHASE1_INTENTS}.`);
        return;
      }
    }

    toggleRelationshipIntent(intentValue);
  };

  // Phase-2 intent toggle with min/max enforcement
  const handlePhase2IntentToggle = (intentKey: string) => {
    const isSelected = privateIntentKeys.includes(intentKey);

    if (isSelected) {
      // Trying to deselect — enforce minimum
      if (privateIntentKeys.length <= MIN_PHASE2_INTENTS) {
        Alert.alert('Selection limit', `Select at least ${MIN_PHASE2_INTENTS}.`);
        return;
      }
    } else {
      // Trying to select — enforce maximum
      if (privateIntentKeys.length >= MAX_PHASE2_INTENTS) {
        Alert.alert('Selection limit', `You can select up to ${MAX_PHASE2_INTENTS}.`);
        return;
      }
    }

    togglePrivateIntentKey(intentKey);
  };

  // Convert km to miles for display
  const initialDistanceMiles = kmToMiles(maxDistance);

  const [localMinAge, setLocalMinAge] = useState(minAge.toString());
  const [localMaxAge, setLocalMaxAge] = useState(maxAge.toString());
  const [localMaxDistanceMiles, setLocalMaxDistanceMiles] = useState(initialDistanceMiles.toString());
  const [saving, setSaving] = useState(false);

  const updatePreferences = useMutation(api.users.updatePreferences);

  const handleSavePreferences = async () => {
    if (!userId || saving) return;

    // Both phases: Enforce minimum "Looking for" selection before saving
    if (lookingFor.length < MIN_LOOKING_FOR) {
      Alert.alert('Selection limit', `Select at least ${MIN_LOOKING_FOR} in "Looking for".`);
      return;
    }

    // Phase-1: Enforce minimum intent selection before saving
    if (!isPhase2 && relationshipIntent.length < MIN_PHASE1_INTENTS) {
      Alert.alert('Selection limit', `Select at least ${MIN_PHASE1_INTENTS}.`);
      return;
    }

    setSaving(true);
    try {
      // Parse and clamp values to valid ranges
      let parsedMinAge = parseInt(localMinAge) || MIN_AGE;
      let parsedMaxAge = parseInt(localMaxAge) || MAX_AGE;
      let parsedDistanceMiles = parseInt(localMaxDistanceMiles) || 50;

      // Enforce age limits (18-70)
      parsedMinAge = Math.max(MIN_AGE, Math.min(MAX_AGE, parsedMinAge));
      parsedMaxAge = Math.max(MIN_AGE, Math.min(MAX_AGE, parsedMaxAge));

      // Ensure maxAge >= minAge
      if (parsedMaxAge < parsedMinAge) {
        parsedMaxAge = parsedMinAge;
      }

      // Enforce distance limit (1-100 miles)
      parsedDistanceMiles = Math.max(1, Math.min(MAX_DISTANCE_MILES, parsedDistanceMiles));

      // Convert miles to km for storage
      const parsedDistanceKm = milesToKm(parsedDistanceMiles);

      // Update local state with clamped values
      setLocalMinAge(parsedMinAge.toString());
      setLocalMaxAge(parsedMaxAge.toString());
      setLocalMaxDistanceMiles(parsedDistanceMiles.toString());

      // Update filter store (distance stored in km)
      setMinAge(parsedMinAge);
      setMaxAge(parsedMaxAge);
      setMaxDistanceKm(parsedDistanceKm);

      // Increment filter version to trigger Discover refetch
      incrementFilterVersion();

      // Update backend if not in demo mode (backend uses km)
      if (!isDemoMode) {
        await updatePreferences({
          userId: userId as any,
          minAge: parsedMinAge,
          maxAge: parsedMaxAge,
          maxDistance: parsedDistanceKm,
        });
      }

      Alert.alert('Saved', 'Your preferences have been updated.');
      router.back();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bgColor }]} edges={['top']}>
      <ScrollView style={[styles.container, { backgroundColor: bgColor }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.header, isPhase2 && { borderBottomColor: INCOGNITO_COLORS.accent }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={textColor} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textColor }]}>
            {isPhase2 ? 'Desire Preferences' : 'Discovery Preferences'}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.content}>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: textColor }]}>Looking for</Text>
            <Text style={[styles.sublabel, { color: textLightColor }]}>
              {`Select ${MIN_LOOKING_FOR}–${MAX_LOOKING_FOR} (${lookingFor.length} selected)`}
            </Text>
            <View style={styles.chips}>
              {GENDER_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    isPhase2 && styles.chipDark,
                    lookingFor.includes(option.value as Gender) && [styles.chipSelected, { backgroundColor: accentColor, borderColor: accentColor }],
                  ]}
                  onPress={() => handleLookingForToggle(option.value as Gender)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: isPhase2 ? INCOGNITO_COLORS.text : COLORS.text },
                      lookingFor.includes(option.value as Gender) && styles.chipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: textColor }]}>Orientation</Text>
            <Text style={[styles.sublabel, { color: textLightColor }]}>
              Optional (tap again to clear)
            </Text>
            <View style={styles.chips}>
              {ORIENTATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    isPhase2 && styles.chipDark,
                    orientation === option.value && [styles.chipSelected, { backgroundColor: accentColor, borderColor: accentColor }],
                  ]}
                  onPress={() => toggleOrientation(option.value as Orientation)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: isPhase2 ? INCOGNITO_COLORS.text : COLORS.text },
                      orientation === option.value && styles.chipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: textColor }]}>What are you looking for?</Text>
            <Text style={[styles.sublabel, { color: textLightColor }]}>
              {isPhase2
                ? `Select ${MIN_PHASE2_INTENTS}–${MAX_PHASE2_INTENTS} (${privateIntentKeys.length} selected)`
                : `Select ${MIN_PHASE1_INTENTS}–${MAX_PHASE1_INTENTS} (${relationshipIntent.length} selected)`}
            </Text>
            <View style={styles.chips}>
              {/* Phase 1: Multi-select relationship intents (min 1, max 3) */}
              {!isPhase2 && RELATIONSHIP_INTENTS.map((intent) => (
                <TouchableOpacity
                  key={intent.value}
                  style={[
                    styles.chip,
                    relationshipIntent.includes(intent.value) && styles.chipSelected,
                  ]}
                  onPress={() => handlePhase1IntentToggle(intent.value)}
                >
                  <Text style={styles.chipEmoji}>{intent.emoji}</Text>
                  <Text
                    style={[
                      styles.chipText,
                      relationshipIntent.includes(intent.value) && styles.chipTextSelected,
                    ]}
                  >
                    {intent.label}
                  </Text>
                </TouchableOpacity>
              ))}
              {/* Phase 2: Multi-select private intents (min 1, max 5) */}
              {isPhase2 && PRIVATE_INTENT_CATEGORIES.map((intent) => (
                <TouchableOpacity
                  key={intent.key}
                  style={[
                    styles.chip,
                    styles.chipDark,
                    privateIntentKeys.includes(intent.key) && [styles.chipSelected, { backgroundColor: accentColor, borderColor: accentColor }],
                  ]}
                  onPress={() => handlePhase2IntentToggle(intent.key)}
                >
                  <Ionicons
                    name={intent.icon as any}
                    size={14}
                    color={privateIntentKeys.includes(intent.key) ? COLORS.white : INCOGNITO_COLORS.textLight}
                    style={styles.chipIcon}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      { color: INCOGNITO_COLORS.text },
                      privateIntentKeys.includes(intent.key) && styles.chipTextSelected,
                    ]}
                  >
                    {intent.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: textColor }]}>Age Range</Text>
            <Text style={[styles.sublabel, { color: textLightColor }]}>{MIN_AGE} to {MAX_AGE} years</Text>
            <View style={styles.ageRow}>
              <Input
                placeholder={`Min (${MIN_AGE})`}
                value={localMinAge}
                onChangeText={setLocalMinAge}
                keyboardType="numeric"
                style={styles.ageInput}
              />
              <Text style={[styles.ageSeparator, { color: textLightColor }]}>to</Text>
              <Input
                placeholder={`Max (${MAX_AGE})`}
                value={localMaxAge}
                onChangeText={setLocalMaxAge}
                keyboardType="numeric"
                style={styles.ageInput}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: textColor }]}>Maximum Distance</Text>
            <Text style={[styles.sublabel, { color: textLightColor }]}>Up to {MAX_DISTANCE_MILES} miles</Text>
            <Input
              placeholder="Distance in miles"
              value={localMaxDistanceMiles}
              onChangeText={setLocalMaxDistanceMiles}
              keyboardType="numeric"
              style={styles.distanceInput}
            />
          </View>

          <Button
            title={saving ? 'Saving…' : 'Save Preferences'}
            variant="primary"
            onPress={handleSavePreferences}
            disabled={saving}
            loading={saving}
            style={styles.saveButton}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    padding: 16,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  sublabel: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 12,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    minHeight: 40,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipDark: {
    backgroundColor: INCOGNITO_COLORS.surface,
    borderColor: INCOGNITO_COLORS.accent,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  chipTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ageInput: {
    flex: 1,
  },
  ageSeparator: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  distanceInput: {
    width: '100%',
  },
  saveButton: {
    marginTop: 16,
  },
});
