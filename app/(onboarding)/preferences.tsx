import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, GENDER_OPTIONS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import { Input, Button } from '@/components/ui';
import { Toast } from '@/components/ui/Toast';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';
import type { Gender, ActivityFilter } from '@/types';

const MIN_INTERESTS = 3;
const MAX_INTERESTS = 7;

export default function PreferencesScreen() {
  const {
    lookingFor,
    relationshipIntent,
    activities,
    minAge,
    maxAge,
    maxDistance,
    toggleLookingFor,
    toggleRelationshipIntent,
    toggleActivity,
    setMinAge,
    setMaxAge,
    setMaxDistance,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();

  const handleActivityToggle = (activity: ActivityFilter) => {
    const isSelected = activities.includes(activity);
    if (!isSelected && activities.length >= MAX_INTERESTS) {
      Toast.show(`Maximum ${MAX_INTERESTS} interests allowed`);
      return;
    }
    toggleActivity(activity);
  };

  const handleNext = () => {
    if (lookingFor.length === 0) {
      Alert.alert('Required', 'Please select who you\'re looking for');
      return;
    }
    if (activities.length < MIN_INTERESTS) {
      Alert.alert('Required', `Please select at least ${MIN_INTERESTS} interests`);
      return;
    }

    if (__DEV__) console.log('[ONB] preferences → permissions (continue)');
    setStep('permissions');
    router.push('/(onboarding)/permissions' as any);
  };

  // POST-VERIFICATION: Skip advances to next step
  const handleSkip = () => {
    if (__DEV__) console.log('[ONB] preferences → permissions (skip)');
    setStep('permissions');
    router.push('/(onboarding)/permissions' as any);
  };

  // POST-VERIFICATION: Previous goes back
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] preferences → profile-details (previous)');
    setStep('profile_details');
    router.push('/(onboarding)/profile-details' as any);
  };

  const canContinue = lookingFor.length > 0 && activities.length >= MIN_INTERESTS;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Match Preferences</Text>
      <Text style={styles.subtitle}>
        Tell us what you're looking for. You can change these anytime.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Looking For</Text>
        <Text style={styles.sectionSubtitle}>Select all that apply</Text>
        <View style={styles.chipsContainer}>
          {GENDER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.chip, lookingFor.includes(option.value as Gender) && styles.chipSelected]}
              onPress={() => toggleLookingFor(option.value as Gender)}
            >
              <Text style={[styles.chipText, lookingFor.includes(option.value as Gender) && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Relationship Intent</Text>
        <Text style={styles.sectionSubtitle}>What are you looking for?</Text>
        <View style={styles.chipsContainer}>
          {RELATIONSHIP_INTENTS.map((intent) => (
            <TouchableOpacity
              key={intent.value}
              style={[styles.chip, relationshipIntent.includes(intent.value) && styles.chipSelected]}
              onPress={() => toggleRelationshipIntent(intent.value)}
            >
              <Text style={styles.chipEmoji}>{intent.emoji}</Text>
              <Text style={[styles.chipText, relationshipIntent.includes(intent.value) && styles.chipTextSelected]}>
                {intent.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.interestsHeader}>
          <Text style={styles.sectionTitle}>Interests</Text>
          <Text style={[
            styles.interestsCounter,
            activities.length >= MIN_INTERESTS && styles.interestsCounterValid
          ]}>
            {activities.length}/{MAX_INTERESTS} selected
          </Text>
        </View>
        <View style={styles.interestsGrid}>
          {ACTIVITY_FILTERS.map((activity) => (
            <TouchableOpacity
              key={activity.value}
              style={[styles.interestChip, activities.includes(activity.value) && styles.interestChipSelected]}
              onPress={() => handleActivityToggle(activity.value)}
              activeOpacity={0.7}
            >
              <Text style={styles.interestEmoji}>{activity.emoji}</Text>
              <Text
                style={[styles.interestLabel, activities.includes(activity.value) && styles.interestLabelSelected]}
                numberOfLines={1}
              >
                {activity.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Age Range</Text>
        <View style={styles.ageRow}>
          <View style={styles.ageInputContainer}>
            <Text style={styles.ageLabel}>Min</Text>
            <Input
              value={minAge.toString()}
              onChangeText={(text) => setMinAge(parseInt(text) || 18)}
              keyboardType="numeric"
              style={styles.ageInput}
            />
          </View>
          <Text style={styles.ageSeparator}>to</Text>
          <View style={styles.ageInputContainer}>
            <Text style={styles.ageLabel}>Max</Text>
            <Input
              value={maxAge.toString()}
              onChangeText={(text) => setMaxAge(parseInt(text) || 100)}
              keyboardType="numeric"
              style={styles.ageInput}
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Maximum Distance</Text>
        <View style={styles.distanceContainer}>
          <Input
            value={maxDistance.toString()}
            onChangeText={(text) => setMaxDistance(parseInt(text) || 50)}
            keyboardType="numeric"
            style={styles.distanceInput}
          />
          <Text style={styles.distanceUnit}>miles</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
          disabled={!canContinue}
          fullWidth
        />
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navButton} onPress={handlePrevious}>
            <Text style={styles.navText}>Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navButton} onPress={handleSkip}>
            <Text style={styles.navText}>Skip</Text>
          </TouchableOpacity>
        </View>
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
  content: {
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 24,
    lineHeight: 22,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 16,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipEmoji: {
    fontSize: 16,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  chipTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  interestsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  interestsCounter: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  interestsCounterValid: {
    color: COLORS.success,
  },
  interestsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  interestChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  interestEmoji: {
    fontSize: 14,
  },
  interestLabel: {
    fontSize: 12,
    color: COLORS.text,
  },
  interestLabelSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  ageInputContainer: {
    flex: 1,
  },
  ageLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  ageInput: {
    width: '100%',
  },
  ageSeparator: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 24,
  },
  distanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  distanceInput: {
    flex: 1,
  },
  distanceUnit: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 24,
  },
  footer: {
    marginTop: 24,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  navButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  navText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
});
