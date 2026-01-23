import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, VALIDATION } from '@/lib/constants';
import { Input, Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function BasicInfoScreen() {
  const { name, dateOfBirth, setName, setDateOfBirth, setStep } = useOnboardingStore();
  const router = useRouter();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    dateOfBirth ? new Date(dateOfBirth) : new Date(2000, 0, 1)
  );
  const [error, setError] = useState('');

  const calculateAge = (dob: string) => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const handleDateChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (date) {
      setSelectedDate(date);
      const age = calculateAge(date.toISOString().split('T')[0]);
      if (age < VALIDATION.MIN_AGE) {
        setError(`You must be at least ${VALIDATION.MIN_AGE} years old`);
        return;
      }
      setDateOfBirth(date.toISOString().split('T')[0]);
      setError('');
    }
  };

  const handleNext = () => {
    if (!name || name.length < VALIDATION.NAME_MIN_LENGTH) {
      setError(`Name must be at least ${VALIDATION.NAME_MIN_LENGTH} characters`);
      return;
    }
    if (name.length > VALIDATION.NAME_MAX_LENGTH) {
      setError(`Name must be no more than ${VALIDATION.NAME_MAX_LENGTH} characters`);
      return;
    }
    if (!/^[a-zA-Z\s]+$/.test(name)) {
      setError('Name can only contain letters');
      return;
    }
    if (!dateOfBirth) {
      setError('Please select your date of birth');
      return;
    }
    const age = calculateAge(dateOfBirth);
    if (age < VALIDATION.MIN_AGE) {
      setError(`You must be at least ${VALIDATION.MIN_AGE} years old`);
      return;
    }

    setStep('photo_upload');
    router.push('/(onboarding)/photo-upload' as any);
  };

  const formatDate = (date: string) => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Tell us about yourself</Text>
      <Text style={styles.subtitle}>
        This information will be shown on your profile.
      </Text>

      <View style={styles.field}>
        <Input
          label="Name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError('');
          }}
          placeholder="Your first name"
          autoCapitalize="words"
          maxLength={VALIDATION.NAME_MAX_LENGTH}
        />
        <Text style={styles.hint}>
          {name.length}/{VALIDATION.NAME_MAX_LENGTH} characters
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Date of Birth</Text>
        <Button
          title={dateOfBirth ? formatDate(dateOfBirth) : 'Select your date of birth'}
          variant="outline"
          onPress={() => setShowDatePicker(true)}
          style={styles.dateButton}
        />
        {dateOfBirth && (
          <Text style={styles.ageText}>
            Age: {calculateAge(dateOfBirth)} years old
          </Text>
        )}
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleDateChange}
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button
          title="Continue"
          variant="primary"
          onPress={handleNext}
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
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 4,
  },
  dateButton: {
    marginTop: 8,
  },
  ageText: {
    fontSize: 14,
    color: COLORS.primary,
    marginTop: 8,
    fontWeight: '500',
  },
  error: {
    fontSize: 14,
    color: COLORS.error,
    marginBottom: 16,
  },
  footer: {
    marginTop: 24,
  },
});
