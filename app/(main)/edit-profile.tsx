import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, GENDER_OPTIONS, SMOKING_OPTIONS, DRINKING_OPTIONS, KIDS_OPTIONS, EDUCATION_OPTIONS, RELIGION_OPTIONS } from '@/lib/constants';
import { Button, Input } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export default function EditProfileScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId: userId as any } : 'skip'
  );

  const updateProfile = useMutation(api.users.updateProfile);

  const [bio, setBio] = useState(currentUser?.bio || '');
  const [height, setHeight] = useState(currentUser?.height?.toString() || '');
  const [smoking, setSmoking] = useState(currentUser?.smoking || null);
  const [drinking, setDrinking] = useState(currentUser?.drinking || null);
  const [kids, setKids] = useState(currentUser?.kids || null);
  const [education, setEducation] = useState(currentUser?.education || null);
  const [religion, setReligion] = useState(currentUser?.religion || null);
  const [jobTitle, setJobTitle] = useState(currentUser?.jobTitle || '');
  const [company, setCompany] = useState(currentUser?.company || '');
  const [school, setSchool] = useState(currentUser?.school || '');

  React.useEffect(() => {
    if (currentUser) {
      setBio(currentUser.bio || '');
      setHeight(currentUser.height?.toString() || '');
      setSmoking(currentUser.smoking || null);
      setDrinking(currentUser.drinking || null);
      setKids(currentUser.kids || null);
      setEducation(currentUser.education || null);
      setReligion(currentUser.religion || null);
      setJobTitle(currentUser.jobTitle || '');
      setCompany(currentUser.company || '');
      setSchool(currentUser.school || '');
    }
  }, [currentUser]);

  const handleSave = async () => {
    if (!userId) return;

    try {
      await updateProfile({
        userId: userId as any,
        bio: bio || undefined,
        height: height ? parseInt(height) : undefined,
        smoking: smoking || undefined,
        drinking: drinking || undefined,
        kids: kids || undefined,
        education: education || undefined,
        religion: religion || undefined,
        jobTitle: jobTitle || undefined,
        company: company || undefined,
        school: school || undefined,
      });
      Alert.alert('Success', 'Profile updated!');
      router.back();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile');
    }
  };

  if (!currentUser) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={styles.saveButton}>Save</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Input
          placeholder="Tell us about yourself..."
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={4}
          maxLength={500}
          style={styles.bioInput}
        />
        <Text style={styles.charCount}>{bio.length}/500</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Basic Info</Text>
        <View style={styles.inputRow}>
          <Text style={styles.label}>Height (cm)</Text>
          <Input
            placeholder="Height"
            value={height}
            onChangeText={setHeight}
            keyboardType="numeric"
            style={styles.numberInput}
          />
        </View>

        <View style={styles.inputRow}>
          <Text style={styles.label}>Job Title</Text>
          <Input
            placeholder="Job title"
            value={jobTitle}
            onChangeText={setJobTitle}
          />
        </View>

        <View style={styles.inputRow}>
          <Text style={styles.label}>Company</Text>
          <Input
            placeholder="Company name"
            value={company}
            onChangeText={setCompany}
          />
        </View>

        <View style={styles.inputRow}>
          <Text style={styles.label}>School</Text>
          <Input
            placeholder="School/University"
            value={school}
            onChangeText={setSchool}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Lifestyle</Text>
        <View style={styles.inputRow}>
          <Text style={styles.label}>Smoking</Text>
          <View style={styles.optionsRow}>
            {SMOKING_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  smoking === option.value && styles.optionChipSelected,
                ]}
                onPress={() => setSmoking(smoking === option.value ? null : option.value as any)}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    smoking === option.value && styles.optionChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputRow}>
          <Text style={styles.label}>Drinking</Text>
          <View style={styles.optionsRow}>
            {DRINKING_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  drinking === option.value && styles.optionChipSelected,
                ]}
                onPress={() => setDrinking(drinking === option.value ? null : option.value as any)}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    drinking === option.value && styles.optionChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputRow}>
          <Text style={styles.label}>Kids</Text>
          <View style={styles.optionsRow}>
            {KIDS_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionChip,
                  kids === option.value && styles.optionChipSelected,
                ]}
                onPress={() => setKids(kids === option.value ? null : option.value as any)}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    kids === option.value && styles.optionChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Education & Religion</Text>
        <View style={styles.inputRow}>
          <Text style={styles.label}>Education</Text>
          <View style={styles.selectContainer}>
            {EDUCATION_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.selectOption,
                  education === option.value && styles.selectOptionSelected,
                ]}
                onPress={() => setEducation(education === option.value ? null : option.value as any)}
              >
                <Text
                  style={[
                    styles.selectOptionText,
                    education === option.value && styles.selectOptionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputRow}>
          <Text style={styles.label}>Religion</Text>
          <View style={styles.selectContainer}>
            {RELIGION_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.selectOption,
                  religion === option.value && styles.selectOptionSelected,
                ]}
                onPress={() => setReligion(religion === option.value ? null : option.value as any)}
              >
                <Text
                  style={[
                    styles.selectOptionText,
                    religion === option.value && styles.selectOptionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Button title="Save Changes" variant="primary" onPress={handleSave} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  saveButton: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  bioInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'right',
    marginTop: 4,
  },
  inputRow: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  numberInput: {
    width: 120,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  optionChipText: {
    fontSize: 14,
    color: COLORS.text,
  },
  optionChipTextSelected: {
    color: COLORS.white,
    fontWeight: '600',
  },
  selectContainer: {
    gap: 8,
  },
  selectOption: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectOptionSelected: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  selectOptionText: {
    fontSize: 14,
    color: COLORS.text,
  },
  selectOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
  },
});
