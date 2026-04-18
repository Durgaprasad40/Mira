import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, GENDER_OPTIONS, ORIENTATION_OPTIONS, RELATIONSHIP_INTENTS, INCOGNITO_COLORS, VALIDATION } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { Button, Input } from '@/components/ui';
import { useFilterStore, kmToMiles, milesToKm } from '@/stores/filterStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { asUserId } from '@/convex/id';
import type { Gender, Orientation } from '@/types';

// P2-005 FIX: Use centralized validation constants
const MIN_AGE = VALIDATION.DISCOVERY_MIN_AGE;
const MAX_AGE = VALIDATION.DISCOVERY_MAX_AGE;
const MAX_DISTANCE_MILES = VALIDATION.MAX_DISTANCE; // UI shows miles
const MAX_DISTANCE_KM = milesToKm(MAX_DISTANCE_MILES); // ~161km stored

// "Looking for" is single-select (exactly 1)
const LOOKING_FOR_COUNT = 1;

// Phase-1 intent selection limits
const MIN_PHASE1_INTENTS = 1;
const MAX_PHASE1_INTENTS = 3;

// Phase-2 intent selection limits
const MIN_PHASE2_INTENTS = 1;
const MAX_PHASE2_INTENTS = 3;

export default function DiscoveryPreferencesScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const segments = useSegments();

  // Phase detection: explicit param takes priority, then infer from route segments
  // Phase-2 ONLY if mode='phase2' explicitly OR navigated from (private) route group
  const isInPrivateRoute = segments.some(s => String(s).includes('private'));
  const isPhase2 = mode === 'phase2' || (mode === undefined && isInPrivateRoute);

  const { userId, token } = useAuthStore();
  const convexUserId = userId ? asUserId(userId) : undefined;

  // Fetch current user preferences from Convex (source of truth for Phase-1 prefs on users table)
  const currentUser = useQuery(
    api.users.getCurrentUser,
    convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Phase-2: "What are you looking for" lives on userPrivateProfiles.privateIntentKeys — must load separately
  const privateProfileDoc = useQuery(
    api.privateProfiles.getByAuthUserId,
    !isDemoMode && userId && token && isPhase2 ? { token, authUserId: userId } : 'skip'
  );

  const {
    minAge,
    maxAge,
    maxDistance, // Stored in km
    gender: lookingFor,
    orientation,
    relationshipIntent,
    privateIntentKeys,
    sortBy,
    setMinAge,
    setMaxAge,
    setMaxDistanceKm,
    setGender,
    setOrientation,
    toggleOrientation,
    toggleRelationshipIntent,
    togglePrivateIntentKey,
    setRelationshipIntent,
    setPrivateIntentKeys,
    setSortBy,
    incrementFilterVersion,
    _hasHydrated,
  } = useFilterStore();

  const setIntentKeysPrivateStore = usePrivateProfileStore((s) => s.setIntentKeys);

  // Theme colors based on phase
  const theme = isPhase2 ? INCOGNITO_COLORS : COLORS;
  const bgColor = isPhase2 ? INCOGNITO_COLORS.background : COLORS.background;
  const textColor = isPhase2 ? INCOGNITO_COLORS.text : COLORS.text;
  const textLightColor = isPhase2 ? INCOGNITO_COLORS.textLight : COLORS.textLight;
  const accentColor = isPhase2 ? INCOGNITO_COLORS.primary : COLORS.primary;

  // Defensive cleanup: remove stale/invalid Phase-2 intent values
  // NOTE: Phase-1 cleanup is now done during Convex hydration (see hydration effect below)
  // to fix race condition where cleanup ran before data arrived
  useEffect(() => {
    // Phase-2: Filter privateIntentKeys to only valid PRIVATE_INTENT_CATEGORIES values
    const validPhase2Keys = new Set<string>(PRIVATE_INTENT_CATEGORIES.map((c) => c.key));
    const cleanedPhase2 = privateIntentKeys.filter((k) => validPhase2Keys.has(k));
    if (cleanedPhase2.length !== privateIntentKeys.length) {
      setPrivateIntentKeys(cleanedPhase2);
      if (__DEV__) console.log('[Prefs] Cleaned stale Phase-2 intents:', privateIntentKeys.length - cleanedPhase2.length, 'removed');
    }
  }, []); // Run once on mount

  // Phase-2 ONLY: If there is no private profile row yet, sync onboarding store → filter (pre-save)
  const phase2OnboardingIntents = usePrivateProfileStore((s) => s.intentKeys);
  useEffect(() => {
    if (!isPhase2 || isDemoMode) return;
    if (privateProfileDoc === undefined) return; // query still loading
    if (privateProfileDoc !== null) return; // have a Convex row — server hydration effect owns intents

    // privateProfileDoc === null: no row yet — optional onboarding-store fallback
    if (privateIntentKeys.length === 0 && phase2OnboardingIntents.length > 0) {
      const toSync = phase2OnboardingIntents.slice(0, MAX_PHASE2_INTENTS);
      setPrivateIntentKeys(toSync);
      if (__DEV__) {
        console.log('[Prefs] Phase-2 intents from onboarding store (no profile row yet):', toSync.length);
      }
    }
  }, [
    isPhase2,
    isDemoMode,
    privateProfileDoc,
    phase2OnboardingIntents,
    privateIntentKeys.length,
    setPrivateIntentKeys,
  ]);

  // Phase-2: Hydrate filter + privateProfileStore intentKeys from private profile (same field as onboarding saves)
  useEffect(() => {
    if (!isPhase2 || isDemoMode) return;
    if (!privateProfileDoc) return;

    const validPhase2Keys = new Set<string>(PRIVATE_INTENT_CATEGORIES.map((c) => c.key));
    const cleaned = (privateProfileDoc.privateIntentKeys ?? []).filter((k) => validPhase2Keys.has(k));

    setPrivateIntentKeys(cleaned);
    setIntentKeysPrivateStore(cleaned as any);

    if (__DEV__) {
      console.log('[P2_PREF_PREFS_UI]', { privateIntentKeysFromServer: cleaned });
    }
  }, [isPhase2, isDemoMode, privateProfileDoc, setPrivateIntentKeys, setIntentKeysPrivateStore]);

  // "Looking for" is single-select — selecting replaces previous selection
  const handleLookingForSelect = (genderValue: Gender) => {
    // Always set to the selected value (single-select behavior)
    setGender([genderValue]);
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

  // Track if we've already hydrated from Convex (prevent re-runs)
  const [hasHydratedFromConvex, setHasHydratedFromConvex] = useState(false);

  // Hydrate filterStore and local state from Convex (source of truth)
  // This runs ONCE when currentUser data arrives
  useEffect(() => {
    if (!currentUser || hasHydratedFromConvex) return;

    // Extract preferences from Convex user document
    const serverMinAge = currentUser.minAge ?? MIN_AGE;
    const serverMaxAge = currentUser.maxAge ?? MAX_AGE;
    const serverMaxDistance = currentUser.maxDistance ?? 80; // Default 80km
    const serverLookingFor = currentUser.lookingFor ?? [];
    const serverRelationshipIntent = currentUser.relationshipIntent ?? [];
    const serverOrientation = currentUser.orientation ?? null;
    const serverSortBy = (currentUser as any).sortBy ?? 'recommended';

    // Update filterStore with server values
    setMinAge(serverMinAge);
    setMaxAge(serverMaxAge);
    setMaxDistanceKm(serverMaxDistance);

    // Hydrate lookingFor (gender), orientation, and sortBy
    if (serverLookingFor.length > 0) {
      setGender(serverLookingFor as Gender[]);
    }
    // Set orientation directly (don't use toggle, which would toggle OFF if same value)
    setOrientation(serverOrientation as Orientation | null);
    // Hydrate sortBy
    setSortBy(serverSortBy);

    // Hydrate relationshipIntent with IMMEDIATE cleanup of invalid/stale values
    // This fixes the bug where old values (e.g., "long_term") don't match new schema (e.g., "serious_vibes")
    // and cause phantom selections that block new chip selection
    if (serverRelationshipIntent.length > 0) {
      const validPhase1Keys = RELATIONSHIP_INTENTS.map(i => i.value);
      const cleanedIntent = serverRelationshipIntent.filter((v: string) => validPhase1Keys.includes(v as any));
      setRelationshipIntent(cleanedIntent as any[]);
      if (__DEV__ && cleanedIntent.length !== serverRelationshipIntent.length) {
        console.log('[Prefs] Cleaned invalid intents during hydration:', serverRelationshipIntent.length - cleanedIntent.length, 'removed');
      }
    }

    // Update local input state
    setLocalMinAge(serverMinAge.toString());
    setLocalMaxAge(serverMaxAge.toString());
    setLocalMaxDistanceMiles(kmToMiles(serverMaxDistance).toString());

    // Mark as hydrated to prevent re-runs
    setHasHydratedFromConvex(true);

    if (__DEV__) {
      console.log('[Prefs] Hydrated from Convex:', {
        minAge: serverMinAge,
        maxAge: serverMaxAge,
        maxDistance: serverMaxDistance,
        lookingFor: serverLookingFor,
        relationshipIntent: serverRelationshipIntent,
        orientation: serverOrientation,
        sortBy: serverSortBy,
      });
    }
  }, [currentUser, hasHydratedFromConvex, setMinAge, setMaxAge, setMaxDistanceKm, setGender, setRelationshipIntent, setOrientation, setSortBy]);

  // Keyboard avoidance insets
  const insets = useSafeAreaInsets();

  const updatePreferences = useMutation(api.users.updatePreferences);
  const updatePrivateProfileFields = useMutation(api.privateProfiles.updateFieldsByAuthId);

  const handleSavePreferences = async () => {
    if (!userId || saving) return;

    // Both phases: Enforce "Looking for" selection before saving
    if (lookingFor.length < LOOKING_FOR_COUNT) {
      Alert.alert('Selection required', 'Please select who you are looking for.');
      return;
    }

    // Phase-1: Enforce minimum intent selection before saving
    if (!isPhase2 && relationshipIntent.length < MIN_PHASE1_INTENTS) {
      Alert.alert('Selection limit', `Select at least ${MIN_PHASE1_INTENTS}.`);
      return;
    }

    // Phase-2: Deep Connect intents live on userPrivateProfiles — same limits as onboarding
    if (isPhase2 && privateIntentKeys.length < MIN_PHASE2_INTENTS) {
      Alert.alert('Selection required', `Select at least ${MIN_PHASE2_INTENTS} for what you're looking for.`);
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

      // Enforce distance limit (1-150 miles)
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
          lookingFor: lookingFor,
          relationshipIntent: relationshipIntent as any[],
          orientation: orientation,
          sortBy: sortBy,
        });

        // Phase-2: Persist "What are you looking for" to userPrivateProfiles (not users.updatePreferences)
        if (isPhase2) {
          if (!token) {
            throw new Error('Please sign in again to save Deep Connect preferences.');
          }
          const validPhase2Keys = new Set<string>(PRIVATE_INTENT_CATEGORIES.map((c) => c.key));
          const cleanedPrivate = privateIntentKeys.filter((k) => validPhase2Keys.has(k));
          if (__DEV__) {
            console.log('[P2_PREF_SAVE]', { payloadPrivateIntentKeys: cleanedPrivate });
          }
          const p2Result = await updatePrivateProfileFields({
            token,
            authUserId: userId,
            privateIntentKeys: cleanedPrivate,
          });
          if (!p2Result?.success) {
            throw new Error(
              p2Result?.error === 'profile_not_found'
                ? 'Private profile not found. Complete Phase-2 setup first.'
                : 'Could not save Deep Connect preferences.'
            );
          }
          setIntentKeysPrivateStore(cleanedPrivate as any);
          if (__DEV__) {
            console.log('[P2_PREF_STORE]', { intentKeysAfterSave: usePrivateProfileStore.getState().intentKeys });
          }
        }
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
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          style={[styles.container, { backgroundColor: bgColor }]}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
              Select one
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
                  onPress={() => handleLookingForSelect(option.value as Gender)}
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
              Optional — tap to select, tap again to clear
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
            <Text style={[styles.label, { color: textColor }]}>
              {isPhase2 ? 'What are you looking for?' : 'Relationship Goal'}
            </Text>
            <Text style={[styles.sublabel, { color: textLightColor }]}>
              {isPhase2
                ? `Select ${MIN_PHASE2_INTENTS}–${MAX_PHASE2_INTENTS} (${privateIntentKeys.length} selected)`
                : `Select ${MIN_PHASE1_INTENTS}–${MAX_PHASE1_INTENTS} (${relationshipIntent.length} selected)`}
            </Text>
            <View style={styles.chips}>
              {/* Phase 1: Multi-select relationship intents (min 1, max 3) */}
              {!isPhase2 && RELATIONSHIP_INTENTS.map((intent) => {
                const isSelected = relationshipIntent.includes(intent.value);
                return (
                  <TouchableOpacity
                    key={intent.value}
                    style={[
                      styles.chip,
                      isSelected && [styles.chipSelected, { backgroundColor: accentColor, borderColor: accentColor }],
                    ]}
                    onPress={() => handlePhase1IntentToggle(intent.value)}
                  >
                    <Text style={styles.chipEmoji}>{intent.emoji}</Text>
                    <Text
                      style={[
                        styles.chipText,
                        { color: COLORS.text },
                        isSelected && styles.chipTextSelected,
                      ]}
                    >
                      {intent.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardAvoid: {
    flex: 1,
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
