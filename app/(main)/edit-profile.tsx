import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  TextInput,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, GENDER_OPTIONS, SMOKING_OPTIONS, DRINKING_OPTIONS, KIDS_OPTIONS, EDUCATION_OPTIONS, RELIGION_OPTIONS, PROFILE_PROMPT_QUESTIONS } from '@/lib/constants';
import { Button, Input } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { BlurProfileNotice } from '@/components/profile/BlurProfileNotice';
import { isDemoMode } from '@/hooks/useConvex';

export default function EditProfileScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();

  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId: userId as any } : 'skip'
  );

  const updateProfile = useMutation(api.users.updateProfile);
  const updateProfilePrompts = useMutation(api.users.updateProfilePrompts);
  const togglePhotoBlur = isDemoMode ? null : useMutation(api.users.togglePhotoBlur);

  const [blurEnabled, setBlurEnabled] = useState(currentUser?.photoBlurred === true);
  const [showBlurNotice, setShowBlurNotice] = useState(false);

  const [bio, setBio] = useState(currentUser?.bio || '');
  const [prompts, setPrompts] = useState<{ question: string; answer: string }[]>(
    (currentUser as any)?.profilePrompts ?? []
  );
  const [showPromptPicker, setShowPromptPicker] = useState(false);
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
      setPrompts((currentUser as any)?.profilePrompts ?? []);
      setHeight(currentUser.height?.toString() || '');
      setSmoking(currentUser.smoking || null);
      setDrinking(currentUser.drinking || null);
      setKids(currentUser.kids || null);
      setEducation(currentUser.education || null);
      setReligion(currentUser.religion || null);
      setJobTitle(currentUser.jobTitle || '');
      setCompany(currentUser.company || '');
      setSchool(currentUser.school || '');
      setBlurEnabled(currentUser.photoBlurred === true);
    }
  }, [currentUser]);

  const filledPrompts = prompts.filter((p) => p.answer.trim().length > 0);

  const handleDeletePrompt = (index: number) => {
    setPrompts(prompts.filter((_, i) => i !== index));
  };

  const handleUpdatePromptAnswer = (index: number, answer: string) => {
    const updated = [...prompts];
    updated[index] = { ...updated[index], answer };
    setPrompts(updated);
  };

  const handleAddPrompt = (questionText: string) => {
    setPrompts([...prompts, { question: questionText, answer: '' }]);
    setShowPromptPicker(false);
  };

  const usedQuestions = prompts.map((p) => p.question);
  const availableQuestions = PROFILE_PROMPT_QUESTIONS.filter(
    (q) => !usedQuestions.includes(q.text)
  );

  // Blur toggle handler — shows notice first, then toggles
  const handleBlurToggle = (newValue: boolean) => {
    if (newValue) {
      // Turning blur ON → show notice
      setShowBlurNotice(true);
    } else {
      // Turning blur OFF → immediate, no notice needed
      if (isDemoMode) {
        setBlurEnabled(false);
        return;
      }
      if (!userId || !togglePhotoBlur) return;
      togglePhotoBlur({ userId: userId as any, blurred: false })
        .then(() => setBlurEnabled(false))
        .catch((err: any) => Alert.alert('Error', err.message));
    }
  };

  const handleBlurConfirm = async () => {
    setShowBlurNotice(false);
    if (isDemoMode) {
      setBlurEnabled(true);
      return;
    }
    if (!userId || !togglePhotoBlur) return;
    try {
      await togglePhotoBlur({ userId: userId as any, blurred: true });
      setBlurEnabled(true);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleSave = async () => {
    if (!userId) return;

    if (filledPrompts.length === 0) {
      Alert.alert('Prompts Required', 'Add at least one prompt to your profile.');
      return;
    }

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
      await updateProfilePrompts({
        userId: userId as any,
        prompts: filledPrompts,
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
      {/* Blur Notice Modal */}
      <BlurProfileNotice
        visible={showBlurNotice}
        onConfirm={handleBlurConfirm}
        onCancel={() => setShowBlurNotice(false)}
      />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={styles.saveButton}>Save</Text>
        </TouchableOpacity>
      </View>

      {/* Photo Visibility — Blur Toggle */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photo Visibility</Text>
        <View style={styles.blurRow}>
          <View style={styles.blurInfo}>
            <View style={styles.blurLabelRow}>
              <Ionicons name="eye-off-outline" size={18} color={COLORS.primary} />
              <Text style={styles.blurLabel}>Blur My Photo</Text>
            </View>
            <Text style={styles.blurDescription}>
              {blurEnabled
                ? 'Your photo is blurred across Discover and your profile.'
                : 'Blur your photo to protect your privacy. You can unblur anytime.'}
            </Text>
          </View>
          <Switch
            value={blurEnabled}
            onValueChange={handleBlurToggle}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
            thumbColor={COLORS.white}
          />
        </View>
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
        <Text style={styles.sectionTitle}>Prompts</Text>

        {prompts.map((prompt, index) => (
          <View key={index} style={styles.promptCard}>
            <View style={styles.promptHeader}>
              <Text style={styles.promptQuestion}>{prompt.question}</Text>
              <TouchableOpacity onPress={() => handleDeletePrompt(index)}>
                <Ionicons name="close-circle" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.promptAnswerInput}
              value={prompt.answer}
              onChangeText={(text) => handleUpdatePromptAnswer(index, text)}
              placeholder="Type your answer..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={200}
            />
            <Text style={styles.promptCharCount}>{prompt.answer.length}/200</Text>
          </View>
        ))}

        {prompts.length < 3 && !showPromptPicker && (
          <TouchableOpacity
            style={styles.addPromptButton}
            onPress={() => setShowPromptPicker(true)}
          >
            <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
            <Text style={styles.addPromptText}>
              Add a prompt ({prompts.length}/3)
            </Text>
          </TouchableOpacity>
        )}

        {showPromptPicker && (
          <View style={styles.promptPickerContainer}>
            {availableQuestions.map((q) => (
              <TouchableOpacity
                key={q.id}
                style={styles.promptPickerOption}
                onPress={() => handleAddPrompt(q.text)}
              >
                <Text style={styles.promptPickerOptionText}>{q.text}</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.promptPickerCancel}
              onPress={() => setShowPromptPicker(false)}
            >
              <Text style={styles.promptPickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
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
  promptCard: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  promptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  promptQuestion: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
    flex: 1,
    marginRight: 8,
  },
  promptAnswerInput: {
    fontSize: 15,
    color: COLORS.text,
    minHeight: 48,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  promptCharCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'right',
  },
  addPromptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
    borderStyle: 'dashed',
    gap: 6,
  },
  addPromptText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  promptPickerContainer: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 12,
  },
  promptPickerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  promptPickerOptionText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  promptPickerCancel: {
    alignItems: 'center',
    paddingTop: 10,
  },
  promptPickerCancelText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
  },
  // Blur toggle
  blurRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  blurInfo: {
    flex: 1,
    marginRight: 16,
  },
  blurLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  blurLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  blurDescription: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
});
