import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, GENDER_OPTIONS, RELATIONSHIP_INTENTS, ACTIVITY_FILTERS } from '@/lib/constants';
import { Button } from '@/components/ui';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { Ionicons } from '@expo/vector-icons';
import { uploadPhotosToConvex } from '@/lib/uploadUtils';

export default function ReviewScreen() {
  const {
    name,
    dateOfBirth,
    gender,
    photos,
    bio,
    height,
    smoking,
    drinking,
    kids,
    education,
    religion,
    jobTitle,
    company,
    school,
    lookingFor,
    relationshipIntent,
    activities,
    minAge,
    maxAge,
    maxDistance,
    setStep,
  } = useOnboardingStore();
  const router = useRouter();
  const { userId, setAuth, setOnboardingCompleted } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);

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

  const handleComplete = async () => {
    if (!userId) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      let photoStorageIds;
      
      // Upload photos if they exist
      if (photos && photos.length > 0) {
        try {
          photoStorageIds = await uploadPhotosToConvex(photos, generateUploadUrl);
        } catch (photoError) {
          console.error('Photo upload error:', photoError);
          Alert.alert(
            'Photo Upload Failed',
            'Failed to upload photos. Continue without photos?',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => setIsSubmitting(false) },
              { text: 'Continue', onPress: () => submitOnboardingData(undefined) }
            ]
          );
          return;
        }
      }

      await submitOnboardingData(photoStorageIds);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to complete onboarding');
      setIsSubmitting(false);
    }
  };

  const submitOnboardingData = async (photoStorageIds: any) => {
    try {
      // Prepare onboarding data
      const onboardingData = {
        userId: userId as any,
        name,
        dateOfBirth,
        gender,
        bio,
        height,
        smoking,
        drinking,
        kids,
        education,
        religion,
        jobTitle,
        company,
        school,
        lookingFor,
        relationshipIntent,
        activities,
        minAge,
        maxAge,
        maxDistance,
        photoStorageIds,
      };

      // Submit all onboarding data to backend
      await completeOnboarding(onboardingData);
      
      setOnboardingCompleted(true);
      setStep('tutorial');
      router.push('/(onboarding)/tutorial' as any);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (step: string) => {
    setStep(step as any);
    router.push(`/(onboarding)/${step}` as any);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Review Your Profile</Text>
      <Text style={styles.subtitle}>
        Make sure everything looks good before you start matching!
      </Text>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <TouchableOpacity onPress={() => handleEdit('additional-photos')}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosScroll}>
          {photos.map((uri, index) => (
            <Image key={index} source={{ uri }} style={styles.photoThumbnail} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Basic Info</Text>
          <TouchableOpacity onPress={() => handleEdit('basic-info')}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Name:</Text>
          <Text style={styles.infoValue}>{name}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Age:</Text>
          <Text style={styles.infoValue}>{dateOfBirth ? calculateAge(dateOfBirth) : 'N/A'}</Text>
        </View>
        {gender && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Gender:</Text>
            <Text style={styles.infoValue}>
              {GENDER_OPTIONS.find((g) => g.value === gender)?.label}
            </Text>
          </View>
        )}
        {height && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Height:</Text>
            <Text style={styles.infoValue}>{height} cm</Text>
          </View>
        )}
      </View>

      {bio && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Bio</Text>
            <TouchableOpacity onPress={() => handleEdit('bio')}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.bioText}>{bio}</Text>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Looking For</Text>
          <TouchableOpacity onPress={() => handleEdit('preferences')}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chipsContainer}>
          {lookingFor.map((gender) => (
            <View key={gender} style={styles.chip}>
              <Text style={styles.chipText}>
                {GENDER_OPTIONS.find((g) => g.value === gender)?.label}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.preferenceText}>
          Age: {minAge} - {maxAge} years
        </Text>
        <Text style={styles.preferenceText}>
          Distance: Up to {maxDistance} miles
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          title="Complete Profile"
          variant="primary"
          onPress={handleComplete}
          loading={isSubmitting}
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
    marginBottom: 32,
    lineHeight: 22,
  },
  section: {
    marginBottom: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  editLink: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  photosScroll: {
    marginTop: 12,
  },
  photoThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginRight: 12,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 15,
    color: COLORS.textLight,
    width: 100,
  },
  infoValue: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '500',
    flex: 1,
  },
  bioText: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
    marginTop: 8,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
  },
  chipText: {
    fontSize: 13,
    color: COLORS.text,
  },
  preferenceText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
  },
  footer: {
    marginTop: 24,
  },
});
