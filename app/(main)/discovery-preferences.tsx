import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, GENDER_OPTIONS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { Button, Input } from '@/components/ui';
import { useFilterStore, kmToMiles, milesToKm } from '@/stores/filterStore';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Gender } from '@/types';

// Age and distance limits
const MIN_AGE = 18;
const MAX_AGE = 70;
const MAX_DISTANCE_MILES = 100; // UI shows miles
const MAX_DISTANCE_KM = milesToKm(MAX_DISTANCE_MILES); // ~161km stored

export default function DiscoveryPreferencesScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const {
    minAge,
    maxAge,
    maxDistance, // Stored in km
    gender: lookingFor,
    privateIntentKey,
    setMinAge,
    setMaxAge,
    setMaxDistanceKm,
    toggleGender,
    togglePrivateIntentKey,
    incrementFilterVersion,
  } = useFilterStore();

  // Convert km to miles for display
  const initialDistanceMiles = kmToMiles(maxDistance);

  const [localMinAge, setLocalMinAge] = useState(minAge.toString());
  const [localMaxAge, setLocalMaxAge] = useState(maxAge.toString());
  const [localMaxDistanceMiles, setLocalMaxDistanceMiles] = useState(initialDistanceMiles.toString());
  const [saving, setSaving] = useState(false);

  const updatePreferences = useMutation(api.users.updatePreferences);

  const handleSavePreferences = async () => {
    if (!userId || saving) return;

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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Discovery Preferences</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.content}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Looking for</Text>
            <View style={styles.chips}>
              {GENDER_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    lookingFor.includes(option.value as Gender) && styles.chipSelected,
                  ]}
                  onPress={() => toggleGender(option.value as Gender)}
                >
                  <Text
                    style={[
                      styles.chipText,
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
            <Text style={styles.label}>What are you looking for?</Text>
            <Text style={styles.sublabel}>Select one (tap again to clear)</Text>
            <View style={styles.chips}>
              {PRIVATE_INTENT_CATEGORIES.map((intent) => (
                <TouchableOpacity
                  key={intent.key}
                  style={[
                    styles.chip,
                    privateIntentKey === intent.key && styles.chipSelected,
                  ]}
                  onPress={() => togglePrivateIntentKey(intent.key)}
                >
                  <Ionicons
                    name={intent.icon as any}
                    size={14}
                    color={privateIntentKey === intent.key ? COLORS.white : COLORS.textLight}
                    style={styles.chipIcon}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      privateIntentKey === intent.key && styles.chipTextSelected,
                    ]}
                  >
                    {intent.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Age Range</Text>
            <Text style={styles.sublabel}>{MIN_AGE} to {MAX_AGE} years</Text>
            <View style={styles.ageRow}>
              <Input
                placeholder={`Min (${MIN_AGE})`}
                value={localMinAge}
                onChangeText={setLocalMinAge}
                keyboardType="numeric"
                style={styles.ageInput}
              />
              <Text style={styles.ageSeparator}>to</Text>
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
            <Text style={styles.label}>Maximum Distance</Text>
            <Text style={styles.sublabel}>Up to {MAX_DISTANCE_MILES} miles</Text>
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
  chipIcon: {
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
