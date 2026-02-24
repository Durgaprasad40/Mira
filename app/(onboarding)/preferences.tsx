import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, GENDER_OPTIONS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import { Input, Button } from '@/components/ui';
import { Toast } from '@/components/ui/Toast';
import { useOnboardingStore } from '@/stores/onboardingStore';
import type { Gender, ActivityFilter, RelationshipIntent } from '@/types';
import { OnboardingProgressHeader } from '@/components/OnboardingProgressHeader';

// Age range constraints
const MIN_AGE_LIMIT = 18;
const MAX_AGE_LIMIT = 70;

// Distance constraints
const DISTANCE_MIN = 1;
const DISTANCE_MAX = 75;
const DISTANCE_DEFAULT = 50;

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
    setActivities,
    setMinAge,
    setMaxAge,
    setMaxDistance,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const distanceSectionRef = useRef<View>(null);
  const interestsSectionRef = useRef<View>(null);
  const relationshipIntentSectionRef = useRef<View>(null);
  const { width: screenWidth } = useWindowDimensions();

  // Validation state
  const [showTopError, setShowTopError] = useState(false);
  const [interestsError, setInterestsError] = useState('');
  const [relationshipIntentError, setRelationshipIntentError] = useState('');

  // Calculate interest chip width: 3 columns default, 2 for narrow screens (<360px)
  const contentPadding = 48; // 24px * 2
  const gapSize = 6;
  const numColumns = screenWidth < 360 ? 2 : 3;
  const interestChipWidth = (screenWidth - contentPadding - gapSize * (numColumns - 1)) / numColumns;

  // Keyboard height state for Android
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Sanitize interests on mount: remove any "ghost" items not in current ACTIVITY_FILTERS
  useEffect(() => {
    const validKeys = new Set(ACTIVITY_FILTERS.map((a) => a.value));
    const sanitized = activities.filter((item) => validKeys.has(item));
    if (sanitized.length !== activities.length) {
      // Ghost items found, update store to remove them
      setActivities(sanitized as typeof activities);
    }
  }, []); // Run only on mount

  // Distance clamping handler
  const handleDistanceBlur = () => {
    let val = maxDistance;
    if (isNaN(val) || val < DISTANCE_MIN) {
      val = DISTANCE_MIN;
    } else if (val > DISTANCE_MAX) {
      val = DISTANCE_MAX;
    }
    setMaxDistance(val);
  };

  // Scroll to distance input when focused (ensures visibility above keyboard)
  const handleDistanceFocus = () => {
    setTimeout(() => {
      distanceSectionRef.current?.measureLayout(
        scrollRef.current?.getInnerViewNode() as any,
        (_x, y) => {
          scrollRef.current?.scrollTo({ y: y - 100, animated: true });
        },
        () => {}
      );
    }, 100);
  };

  // Age clamping handlers
  const handleMinAgeBlur = () => {
    let val = minAge;
    if (isNaN(val) || val < MIN_AGE_LIMIT) {
      val = MIN_AGE_LIMIT;
    } else if (val > MAX_AGE_LIMIT) {
      val = MAX_AGE_LIMIT;
    }
    setMinAge(val);
    // Ensure maxAge >= minAge
    if (maxAge < val) {
      setMaxAge(val);
    }
  };

  const handleMaxAgeBlur = () => {
    let val = maxAge;
    if (isNaN(val) || val < MIN_AGE_LIMIT) {
      val = MIN_AGE_LIMIT;
    } else if (val > MAX_AGE_LIMIT) {
      val = MAX_AGE_LIMIT;
    }
    // Ensure maxAge >= minAge
    if (val < minAge) {
      val = minAge;
    }
    setMaxAge(val);
  };

  const handleActivityToggle = (activity: ActivityFilter) => {
    const isSelected = activities.includes(activity);
    if (!isSelected && activities.length >= MAX_INTERESTS) {
      Toast.show(`Maximum ${MAX_INTERESTS} interests allowed`);
      return;
    }
    toggleActivity(activity);
    // Clear error when user selects at least 1 interest
    if (!isSelected && interestsError) {
      setInterestsError('');
      if (!relationshipIntentError) setShowTopError(false);
    }
  };

  const handleRelationshipIntentToggle = (intentValue: RelationshipIntent) => {
    toggleRelationshipIntent(intentValue);
    // Clear error when user selects at least 1 intent
    const isSelected = relationshipIntent.includes(intentValue);
    if (!isSelected && relationshipIntentError) {
      setRelationshipIntentError('');
      if (!interestsError) setShowTopError(false);
    }
  };

  const handleNext = () => {
    if (lookingFor.length === 0) {
      Alert.alert('Required', 'Please select who you\'re looking for');
      return;
    }

    let hasError = false;
    let firstErrorRef: React.RefObject<View | null> | null = null;

    // Validate relationship intent: require at least 1
    if (relationshipIntent.length < 1) {
      setRelationshipIntentError('Select a relationship goal to continue.');
      hasError = true;
      if (!firstErrorRef) firstErrorRef = relationshipIntentSectionRef;
    } else {
      setRelationshipIntentError('');
    }

    // Validate interests: require at least 1
    if (activities.length < 1) {
      setInterestsError('Select at least 1 interest to continue.');
      hasError = true;
      if (!firstErrorRef) firstErrorRef = interestsSectionRef;
    } else {
      setInterestsError('');
    }

    if (hasError) {
      setShowTopError(true);
      // Scroll to first error section
      firstErrorRef?.current?.measureLayout(
        scrollRef.current?.getInnerViewNode() as any,
        (_x, y) => scrollRef.current?.scrollTo({ y: y - 100, animated: true }),
        () => {}
      );
      return;
    }

    setShowTopError(false);
    if (__DEV__) console.log('[ONB] preferences → display-privacy (continue)');
    setStep('display_privacy');
    router.push('/(onboarding)/display-privacy' as any);
  };

  // POST-VERIFICATION: Previous goes back
  const handlePrevious = () => {
    if (__DEV__) console.log('[ONB] preferences → profile-details (previous)');
    setStep('profile_details');
    router.push('/(onboarding)/profile-details' as any);
  };

  const canContinue = lookingFor.length > 0 && relationshipIntent.length >= 1 && activities.length >= 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <OnboardingProgressHeader />
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: 24 + keyboardHeight }]}
      keyboardShouldPersistTaps="handled"
    >
      {showTopError && (
        <View style={styles.topErrorBanner}>
          <Text style={styles.topErrorText}>Please complete highlighted fields.</Text>
        </View>
      )}
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

      <View ref={relationshipIntentSectionRef} style={styles.section}>
        <Text style={styles.sectionTitle}>Relationship Intent</Text>
        <Text style={styles.sectionSubtitle}>What are you looking for?</Text>
        <View style={[styles.chipsContainer, relationshipIntentError ? styles.chipsContainerError : null]}>
          {RELATIONSHIP_INTENTS.map((intent) => (
            <TouchableOpacity
              key={intent.value}
              style={[styles.chip, relationshipIntent.includes(intent.value) && styles.chipSelected]}
              onPress={() => handleRelationshipIntentToggle(intent.value)}
            >
              <Text style={styles.chipEmoji}>{intent.emoji}</Text>
              <Text style={[styles.chipText, relationshipIntent.includes(intent.value) && styles.chipTextSelected]}>
                {intent.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {relationshipIntentError ? <Text style={styles.fieldError}>{relationshipIntentError}</Text> : null}
      </View>

      <View ref={interestsSectionRef} style={styles.section}>
        <View style={styles.interestsHeader}>
          <Text style={styles.sectionTitle}>Interests</Text>
          <Text style={[
            styles.interestsCounter,
            activities.length >= 1 && styles.interestsCounterValid
          ]}>
            {activities.length}/{MAX_INTERESTS} selected
          </Text>
        </View>
        <View style={[styles.interestsGrid, interestsError ? styles.interestsGridError : null]}>
          {ACTIVITY_FILTERS.map((activity) => (
            <TouchableOpacity
              key={activity.value}
              style={[
                styles.interestChip,
                { width: interestChipWidth },
                activities.includes(activity.value) && styles.interestChipSelected
              ]}
              onPress={() => handleActivityToggle(activity.value)}
              activeOpacity={0.7}
            >
              <Text style={styles.interestEmoji}>{activity.emoji}</Text>
              <Text
                style={[styles.interestLabel, activities.includes(activity.value) && styles.interestLabelSelected]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {activity.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {interestsError ? <Text style={styles.fieldError}>{interestsError}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Age Range</Text>
        <Text style={styles.sectionSubtitle}>{MIN_AGE_LIMIT} - {MAX_AGE_LIMIT} years</Text>
        <View style={styles.ageRow}>
          <View style={styles.ageInputContainer}>
            <Text style={styles.ageLabel}>Min</Text>
            <Input
              value={minAge.toString()}
              onChangeText={(text) => setMinAge(parseInt(text) || MIN_AGE_LIMIT)}
              onBlur={handleMinAgeBlur}
              keyboardType="numeric"
              style={styles.ageInput}
            />
          </View>
          <Text style={styles.ageSeparator}>to</Text>
          <View style={styles.ageInputContainer}>
            <Text style={styles.ageLabel}>Max</Text>
            <Input
              value={maxAge.toString()}
              onChangeText={(text) => setMaxAge(parseInt(text) || MAX_AGE_LIMIT)}
              onBlur={handleMaxAgeBlur}
              keyboardType="numeric"
              style={styles.ageInput}
            />
          </View>
        </View>
      </View>

      <View ref={distanceSectionRef} style={styles.section}>
        <Text style={styles.sectionTitle}>Maximum Distance</Text>
        <Text style={styles.sectionSubtitle}>{DISTANCE_MIN} - {DISTANCE_MAX} miles</Text>
        <View style={styles.distanceInputWrapper}>
          <TextInput
            value={maxDistance.toString()}
            onChangeText={(text) => setMaxDistance(parseInt(text) || DISTANCE_DEFAULT)}
            onBlur={handleDistanceBlur}
            onFocus={handleDistanceFocus}
            keyboardType="numeric"
            style={styles.distanceTextInput}
            placeholderTextColor={COLORS.textMuted}
          />
          <View style={styles.distanceSuffixContainer} pointerEvents="none">
            <Text style={styles.distanceSuffix}>miles</Text>
          </View>
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
  topErrorBanner: {
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error + '40',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  topErrorText: {
    fontSize: 14,
    color: COLORS.error,
    fontWeight: '500',
    textAlign: 'center',
  },
  fieldError: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 8,
  },
  interestsGridError: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.error,
    padding: 4,
    margin: -4,
  },
  chipsContainerError: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.error,
    padding: 4,
    margin: -4,
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
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 999,
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
    fontSize: 13,
  },
  interestLabel: {
    fontSize: 12,
    color: COLORS.text,
    flexShrink: 1,
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
  distanceInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    height: 52,
  },
  distanceTextInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    paddingVertical: 0,
  },
  distanceSuffixContainer: {
    marginLeft: 8,
  },
  distanceSuffix: {
    fontSize: 16,
    color: COLORS.textLight,
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
