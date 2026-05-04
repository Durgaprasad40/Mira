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
import { Button, RangeSlider, SingleThumbSlider } from '@/components/ui';
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
const MIN_DISTANCE_MILES = 1;

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
  const bgColor = isPhase2 ? INCOGNITO_COLORS.background : '#F6F7FB';
  const textColor = isPhase2 ? INCOGNITO_COLORS.text : COLORS.text;
  const textLightColor = isPhase2 ? INCOGNITO_COLORS.textLight : COLORS.textLight;
  const accentColor = isPhase2 ? INCOGNITO_COLORS.primary : COLORS.primary;
  // Premium card surface tokens (kept local — does not mutate global constants)
  const cardBg = isPhase2 ? INCOGNITO_COLORS.surface : COLORS.white;
  const cardBorder = isPhase2 ? 'rgba(233, 69, 96, 0.10)' : '#ECEDF2';
  const dividerColor = isPhase2 ? 'rgba(255,255,255,0.05)' : '#EDEEF2';
  // Chip tokens
  const chipUnselectedBg = isPhase2 ? 'rgba(255,255,255,0.04)' : '#F4F5F8';
  const chipUnselectedBorder = isPhase2 ? 'rgba(255,255,255,0.08)' : '#E6E7EC';
  const chipUnselectedText = isPhase2 ? INCOGNITO_COLORS.text : COLORS.text;

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

  // Slider-backed numeric state (no more string text inputs)
  const [localMinAge, setLocalMinAge] = useState<number>(minAge);
  const [localMaxAge, setLocalMaxAge] = useState<number>(maxAge);
  const [localMaxDistanceMiles, setLocalMaxDistanceMiles] = useState<number>(initialDistanceMiles);
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

    // Update local slider state (numeric)
    setLocalMinAge(serverMinAge);
    setLocalMaxAge(serverMaxAge);
    setLocalMaxDistanceMiles(kmToMiles(serverMaxDistance));

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
      // Read from slider-backed numeric state and defensively clamp.
      // The sliders already enforce ranges, but we clamp again to guard
      // against any out-of-band values sneaking in.
      let parsedMinAge = Number.isFinite(localMinAge) ? localMinAge : MIN_AGE;
      let parsedMaxAge = Number.isFinite(localMaxAge) ? localMaxAge : MAX_AGE;
      let parsedDistanceMiles = Number.isFinite(localMaxDistanceMiles)
        ? localMaxDistanceMiles
        : 50;

      // Enforce age limits (18-70)
      parsedMinAge = Math.max(MIN_AGE, Math.min(MAX_AGE, parsedMinAge));
      parsedMaxAge = Math.max(MIN_AGE, Math.min(MAX_AGE, parsedMaxAge));

      // Ensure maxAge >= minAge
      if (parsedMaxAge < parsedMinAge) {
        parsedMaxAge = parsedMinAge;
      }

      // Enforce distance limit (1-150 miles)
      parsedDistanceMiles = Math.max(MIN_DISTANCE_MILES, Math.min(MAX_DISTANCE_MILES, parsedDistanceMiles));

      // Convert miles to km for storage
      const parsedDistanceKm = milesToKm(parsedDistanceMiles);

      // Sync local slider state with clamped values
      setLocalMinAge(parsedMinAge);
      setLocalMaxAge(parsedMaxAge);
      setLocalMaxDistanceMiles(parsedDistanceMiles);

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
          <View
            style={[
              styles.header,
              { borderBottomColor: dividerColor },
            ]}
          >
            <TouchableOpacity
              onPress={() => router.back()}
              style={[
                styles.headerBackBtn,
                {
                  backgroundColor: isPhase2
                    ? 'rgba(255,255,255,0.06)'
                    : 'rgba(0,0,0,0.04)',
                },
              ]}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="arrow-back" size={20} color={textColor} />
            </TouchableOpacity>
            <View style={styles.headerTitleWrap}>
              <Text style={[styles.headerTitle, { color: textColor }]}>
                {isPhase2 ? 'Deep Connect Preferences' : 'Discover Preferences'}
              </Text>
              <Text
                style={[styles.headerSubtitle, { color: textLightColor }]}
                numberOfLines={1}
              >
                {isPhase2 ? 'Tune your Deep Connect matches' : 'Refine who you discover'}
              </Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

        <View style={styles.content}>
          {/* SECTION: Looking for */}
          <View
            style={[
              styles.section,
              { backgroundColor: cardBg, borderColor: cardBorder },
              !isPhase2 && styles.sectionShadowLight,
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Looking for
              </Text>
              <Text style={[styles.sectionHint, { color: textLightColor }]}>
                Choose one
              </Text>
            </View>
            <View style={styles.chips}>
              {GENDER_OPTIONS.map((option) => {
                const isSelected = lookingFor.includes(option.value as Gender);
                return (
                  <TouchableOpacity
                    key={option.value}
                    activeOpacity={0.85}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: chipUnselectedBg,
                        borderColor: chipUnselectedBorder,
                      },
                      isSelected && {
                        backgroundColor: accentColor,
                        borderColor: accentColor,
                      },
                    ]}
                    onPress={() => handleLookingForSelect(option.value as Gender)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: chipUnselectedText },
                        isSelected && styles.chipTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* SECTION: Orientation */}
          <View
            style={[
              styles.section,
              { backgroundColor: cardBg, borderColor: cardBorder },
              !isPhase2 && styles.sectionShadowLight,
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Orientation
              </Text>
              <Text style={[styles.sectionHint, { color: textLightColor }]}>
                Optional · tap again to clear
              </Text>
            </View>
            <View style={styles.chips}>
              {ORIENTATION_OPTIONS.map((option) => {
                const isSelected = orientation === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    activeOpacity={0.85}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: chipUnselectedBg,
                        borderColor: chipUnselectedBorder,
                      },
                      isSelected && {
                        backgroundColor: accentColor,
                        borderColor: accentColor,
                      },
                    ]}
                    onPress={() => toggleOrientation(option.value as Orientation)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: chipUnselectedText },
                        isSelected && styles.chipTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* SECTION: Relationship Goal / Looking for (intent) */}
          <View
            style={[
              styles.section,
              { backgroundColor: cardBg, borderColor: cardBorder },
              !isPhase2 && styles.sectionShadowLight,
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Relationship Goal
              </Text>
              <View style={styles.sectionHintRow}>
                <Text style={[styles.sectionHint, { color: textLightColor }]}>
                  {isPhase2
                    ? `Select ${MIN_PHASE2_INTENTS}–${MAX_PHASE2_INTENTS}`
                    : `Select ${MIN_PHASE1_INTENTS}–${MAX_PHASE1_INTENTS}`}
                </Text>
                <View
                  style={[
                    styles.countBadge,
                    {
                      backgroundColor: isPhase2
                        ? 'rgba(233, 69, 96, 0.14)'
                        : 'rgba(255, 107, 107, 0.10)',
                      borderColor: isPhase2
                        ? 'rgba(233, 69, 96, 0.30)'
                        : 'rgba(255, 107, 107, 0.25)',
                    },
                  ]}
                >
                  <Text style={[styles.countBadgeText, { color: accentColor }]}>
                    {isPhase2 ? privateIntentKeys.length : relationshipIntent.length}
                    {' '}
                    selected
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.chips}>
              {/* Phase 1: Multi-select relationship intents (min 1, max 3) */}
              {!isPhase2 &&
                RELATIONSHIP_INTENTS.map((intent) => {
                  const isSelected = relationshipIntent.includes(intent.value);
                  return (
                    <TouchableOpacity
                      key={intent.value}
                      activeOpacity={0.85}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: chipUnselectedBg,
                          borderColor: chipUnselectedBorder,
                        },
                        isSelected && {
                          backgroundColor: accentColor,
                          borderColor: accentColor,
                        },
                      ]}
                      onPress={() => handlePhase1IntentToggle(intent.value)}
                    >
                      <Text style={styles.chipEmoji}>{intent.emoji}</Text>
                      <Text
                        style={[
                          styles.chipText,
                          { color: chipUnselectedText },
                          isSelected && styles.chipTextSelected,
                        ]}
                      >
                        {intent.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              {/* Phase 2: Multi-select private intents */}
              {isPhase2 &&
                PRIVATE_INTENT_CATEGORIES.map((intent) => {
                  const isSelected = privateIntentKeys.includes(intent.key);
                  return (
                    <TouchableOpacity
                      key={intent.key}
                      activeOpacity={0.85}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: chipUnselectedBg,
                          borderColor: chipUnselectedBorder,
                        },
                        isSelected && {
                          backgroundColor: accentColor,
                          borderColor: accentColor,
                        },
                      ]}
                      onPress={() => handlePhase2IntentToggle(intent.key)}
                    >
                      <Ionicons
                        name={intent.icon as any}
                        size={14}
                        color={isSelected ? COLORS.white : textLightColor}
                        style={styles.chipIcon}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          { color: chipUnselectedText },
                          isSelected && styles.chipTextSelected,
                        ]}
                      >
                        {intent.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
            </View>
          </View>

          {/* SECTION: Age Range */}
          <View
            style={[
              styles.section,
              { backgroundColor: cardBg, borderColor: cardBorder },
              !isPhase2 && styles.sectionShadowLight,
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Age Range
              </Text>
              <Text style={[styles.sectionHint, { color: textLightColor }]}>
                Drag the handles
              </Text>
            </View>
            <RangeSlider
              lowValue={localMinAge}
              highValue={localMaxAge}
              minValue={MIN_AGE}
              maxValue={MAX_AGE}
              unit="years"
              onValuesChange={(low, high) => {
                setLocalMinAge(low);
                setLocalMaxAge(high);
              }}
              isDarkTheme={isPhase2}
            />
          </View>

          {/* SECTION: Maximum Distance */}
          <View
            style={[
              styles.section,
              { backgroundColor: cardBg, borderColor: cardBorder },
              !isPhase2 && styles.sectionShadowLight,
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Maximum Distance
              </Text>
              <Text style={[styles.sectionHint, { color: textLightColor }]}>
                How far to look
              </Text>
            </View>
            <SingleThumbSlider
              value={localMaxDistanceMiles}
              minValue={MIN_DISTANCE_MILES}
              maxValue={MAX_DISTANCE_MILES}
              unit="miles"
              helperTextPrefix="Up to"
              onValueChange={(v) => setLocalMaxDistanceMiles(v)}
              isDarkTheme={isPhase2}
            />
          </View>

          <View style={styles.saveButtonWrap}>
            <Button
              title={saving ? 'Saving…' : 'Save Preferences'}
              variant="primary"
              onPress={handleSavePreferences}
              disabled={saving}
              loading={saving}
              style={styles.saveButton}
            />
          </View>
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
  // ─── Header ────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    opacity: 0.85,
  },
  headerSpacer: {
    width: 36,
  },
  // ─── Content / Sections ────────────────────────────────────
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 14,
  },
  // Subtle shadow only on Phase-1 (light theme); dark theme relies on
  // surface contrast and border for elevation.
  sectionShadowLight: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  sectionHeader: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.15,
  },
  sectionHint: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    opacity: 0.85,
  },
  sectionHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    flexWrap: 'wrap',
    gap: 8,
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  // ─── Chips ─────────────────────────────────────────────────
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
    borderRadius: 999,
    minHeight: 38,
    borderWidth: 1,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  chipTextSelected: {
    color: COLORS.white,
    fontWeight: '700',
  },
  // ─── Save button ───────────────────────────────────────────
  saveButtonWrap: {
    marginTop: 8,
    marginBottom: 8,
  },
  saveButton: {
    borderRadius: 14,
  },
});
