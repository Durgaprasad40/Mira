import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, GENDER_OPTIONS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import { Input, Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { Ionicons } from '@expo/vector-icons';
import type { Gender } from '@/types';

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

  const handleNext = () => {
    if (lookingFor.length === 0) {
      Alert.alert('Required', 'Please select who you\'re looking for');
      return;
    }

    setStep('permissions');
    router.push('/(onboarding)/permissions' as any);
  };

  return (
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
        <Text style={styles.sectionTitle}>Activities</Text>
        <Text style={styles.sectionSubtitle}>What do you like to do?</Text>
        <View style={styles.chipsContainer}>
          {ACTIVITY_FILTERS.map((activity) => (
            <TouchableOpacity
              key={activity.value}
              style={[styles.chip, activities.includes(activity.value) && styles.chipSelected]}
              onPress={() => toggleActivity(activity.value)}
            >
              <Text style={styles.chipEmoji}>{activity.emoji}</Text>
              <Text style={[styles.chipText, activities.includes(activity.value) && styles.chipTextSelected]}>
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
          disabled={lookingFor.length === 0}
          fullWidth
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
