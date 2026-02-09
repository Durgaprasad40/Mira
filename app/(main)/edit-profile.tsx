import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  Alert,
  TextInput,
  Switch,
  Image,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, SMOKING_OPTIONS, DRINKING_OPTIONS, KIDS_OPTIONS, EDUCATION_OPTIONS, RELIGION_OPTIONS, PROFILE_PROMPT_QUESTIONS } from '@/lib/constants';
import { Button, Input } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { BlurProfileNotice } from '@/components/profile/BlurProfileNotice';
import { isDemoMode } from '@/hooks/useConvex';
import { getDemoCurrentUser } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';

const GRID_SIZE = 9;
const COLUMNS = 3;
const GRID_GAP = 8;
const SCREEN_PADDING = 16;
const screenWidth = Dimensions.get('window').width;
const slotSize = (screenWidth - SCREEN_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

function isValidPhotoUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && url !== 'undefined' && url !== 'null';
}

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuthStore();

  // FIX 1: Track initialization to prevent infinite loop
  const hasInitializedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  // Ref for bio TextInput to enable tap-anywhere-to-focus
  const bioInputRef = useRef<TextInput>(null);

  const currentUserQuery = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );
  const currentUser = isDemoMode ? (getDemoCurrentUser() as any) : currentUserQuery;

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isDemoMode) return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const updateProfile = useMutation(api.users.updateProfile);
  const updateProfilePrompts = useMutation(api.users.updateProfilePrompts);
  const togglePhotoBlur = isDemoMode ? null : useMutation(api.users.togglePhotoBlur);

  const [blurEnabled, setBlurEnabled] = useState(false);
  const [showBlurNotice, setShowBlurNotice] = useState(false);
  const [bio, setBio] = useState('');
  const [prompts, setPrompts] = useState<{ question: string; answer: string }[]>([]);
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [height, setHeight] = useState('');
  const [smoking, setSmoking] = useState<string | null>(null);
  const [drinking, setDrinking] = useState<string | null>(null);
  const [kids, setKids] = useState<string | null>(null);
  const [education, setEducation] = useState<string | null>(null);
  const [educationOther, setEducationOther] = useState('');
  const [religion, setReligion] = useState<string | null>(null);
  const [religionOther, setReligionOther] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [school, setSchool] = useState('');

  // Photo state for 9-slot grid
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // FIX 1: Initialize state ONCE per user using refs to prevent infinite loop
  useEffect(() => {
    const currentUserId = currentUser?._id || currentUser?.id || null;
    if (currentUser && (!hasInitializedRef.current || lastUserIdRef.current !== currentUserId)) {
      hasInitializedRef.current = true;
      lastUserIdRef.current = currentUserId;

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

      const existingPhotos = currentUser.photos?.map((p: any) => p?.url || p).filter(isValidPhotoUrl) || [];
      setPhotoUrls(existingPhotos.slice(0, GRID_SIZE));
    }
  }, [currentUser?._id, currentUser?.id]);

  const validPhotos = useMemo(() => {
    return photoUrls.filter((url) => isValidPhotoUrl(url) && !failedImages.has(url));
  }, [photoUrls, failedImages]);

  const handleImageError = useCallback((uri: string) => {
    setFailedImages((prev) => new Set(prev).add(uri));
  }, []);

  const handleUploadPhoto = async (slotIndex: number) => {
    const isReplacing = slotIndex < validPhotos.length;
    const isAdding = !isReplacing;

    // Block adding new photo if already at max 9
    if (isAdding && validPhotos.length >= GRID_SIZE) {
      Alert.alert('Maximum Photos', 'You can only have up to 9 photos.');
      return;
    }

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant photo library access to upload photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        if (isValidPhotoUrl(uri)) {
          setPhotoUrls((prev) => {
            const updated = [...prev];
            if (isReplacing) {
              // Replace existing photo at index
              updated[slotIndex] = uri;
            } else {
              // Add new photo
              updated.push(uri);
            }
            return updated.slice(0, GRID_SIZE);
          });
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to upload photo. Please try again.');
    }
  };

  const handleRemovePhoto = (index: number) => {
    Alert.alert('Remove Photo', 'Are you sure you want to remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setPhotoUrls((prev) => prev.filter((_, i) => i !== index)) },
    ]);
  };

  // FIX D: Set photo as main (move to index 0)
  const handleSetMainPhoto = (index: number) => {
    if (index === 0) return; // Already main
    setPhotoUrls((prev) => {
      const updated = [...prev];
      const [photo] = updated.splice(index, 1);
      updated.unshift(photo);
      if (__DEV__) {
        console.log('[EditProfile] setMainPhoto from index', index, '-> 0');
      }
      return updated;
    });
  };

  const renderPhotoSlot = (index: number) => {
    const url = validPhotos[index];
    if (url) {
      const isMain = index === 0;
      return (
        <View key={index} style={styles.photoSlot}>
          {/* FIX 3: Show blur preview when blurEnabled is ON */}
          <Image
            source={{ uri: url }}
            style={styles.photoImage}
            blurRadius={blurEnabled ? 20 : 0}
            onError={() => handleImageError(url)}
          />
          <TouchableOpacity style={styles.photoEditButton} onPress={() => handleUploadPhoto(index)}>
            <Ionicons name="pencil" size={14} color={COLORS.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoRemoveButton} onPress={() => handleRemovePhoto(index)}>
            <Ionicons name="close" size={14} color={COLORS.white} />
          </TouchableOpacity>
          {/* FIX D: Main badge or Set as Main button */}
          {isMain ? (
            <View style={styles.mainBadge}><Text style={styles.mainBadgeText}>Main</Text></View>
          ) : (
            <TouchableOpacity style={styles.setMainButton} onPress={() => handleSetMainPhoto(index)}>
              <Ionicons name="star" size={10} color={COLORS.white} />
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return (
      <TouchableOpacity key={index} style={[styles.photoSlot, styles.photoSlotEmpty]} onPress={() => handleUploadPhoto(index)} activeOpacity={0.7}>
        <Ionicons name="add" size={28} color={COLORS.primary} />
        <Text style={styles.uploadText}>Add</Text>
      </TouchableOpacity>
    );
  };

  const filledPrompts = prompts.filter((p) => p.answer.trim().length > 0);

  const handleDeletePrompt = (index: number) => setPrompts(prompts.filter((_, i) => i !== index));
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
  const availableQuestions = PROFILE_PROMPT_QUESTIONS.filter((q) => !usedQuestions.includes(q.text));

  const handleBlurToggle = (newValue: boolean) => {
    if (newValue) {
      setShowBlurNotice(true);
    } else {
      // Turning blur OFF - Demo mode: just update local state (no persist)
      if (isDemoMode) {
        setBlurEnabled(false);
        if (__DEV__) console.log('[DEMO] Set blurEnabled=false (local state only)');
        return;
      }
      const convexUserId = currentUser?._id;
      if (!convexUserId || !togglePhotoBlur) return;
      // EXTRA GUARD: Block demo IDs (only startsWith to avoid false positives)
      if (typeof convexUserId === 'string' && convexUserId.startsWith('demo_')) {
        if (__DEV__) console.log('[DEMO GUARD] Blocked togglePhotoBlur (off)', { file: 'edit-profile.tsx' });
        setBlurEnabled(false);
        return;
      }
      togglePhotoBlur({ userId: convexUserId, blurred: false })
        .then(() => setBlurEnabled(false))
        .catch((err: any) => Alert.alert('Error', err.message));
    }
  };

  const handleBlurConfirm = async () => {
    setShowBlurNotice(false);
    // Turning blur ON - Demo mode: just update local state (no persist)
    if (isDemoMode) {
      setBlurEnabled(true);
      if (__DEV__) console.log('[DEMO] Set blurEnabled=true (local state only)');
      return;
    }
    const convexUserId = currentUser?._id;
    if (!convexUserId || !togglePhotoBlur) return;
    // EXTRA GUARD: Block demo IDs (only startsWith to avoid false positives)
    if (typeof convexUserId === 'string' && convexUserId.startsWith('demo_')) {
      if (__DEV__) console.log('[DEMO GUARD] Blocked togglePhotoBlur (on)', { file: 'edit-profile.tsx' });
      setBlurEnabled(true);
      return;
    }
    try {
      await togglePhotoBlur({ userId: convexUserId, blurred: true });
      setBlurEnabled(true);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleSave = async () => {
    if (filledPrompts.length === 0) {
      Alert.alert('Prompts Required', 'Add at least one prompt to your profile.');
      return;
    }
    if (validPhotos.length === 0) {
      Alert.alert('Photos Required', 'Add at least one photo to your profile.');
      return;
    }

    // Demo mode: persist to local demo store, skip Convex
    if (isDemoMode) {
      const demoUserId = useDemoStore.getState().currentDemoUserId;
      if (demoUserId) {
        // Update demo profile with edited fields
        useDemoStore.getState().saveDemoProfile(demoUserId, {
          bio: bio || undefined,
          photos: validPhotos.map((url) => ({ url })),
          profilePrompts: filledPrompts,
          height: height ? parseInt(height) : null,
          smoking: smoking || null,
          drinking: drinking || null,
          kids: kids || null,
          education: education || null,
          religion: religion || null,
          jobTitle: jobTitle || undefined,
          company: company || undefined,
          school: school || undefined,
        });
        if (__DEV__) {
          console.log('[EditProfile] saving mode=demo userIdType=string (local store updated)', {
            demoUserId,
            photoCount: validPhotos.length,
            promptCount: filledPrompts.length,
          });
        }
      }
      Alert.alert('Success', 'Profile updated!');
      router.back();
      return;
    }

    // Prod mode: use Convex document ID from query result
    const convexUserId = currentUser?._id;
    if (!convexUserId) {
      Alert.alert('Error', 'User not found. Please try again.');
      return;
    }

    // EXTRA GUARD: Block demo IDs (only startsWith to avoid false positives)
    if (typeof convexUserId === 'string' && convexUserId.startsWith('demo_')) {
      if (__DEV__) {
        console.log('[DEMO GUARD] Blocked updateProfile with demo userId', { file: 'edit-profile.tsx', convexUserId });
      }
      Alert.alert('Demo Mode', 'Changes saved locally in demo mode.');
      router.back();
      return;
    }

    if (__DEV__) {
      console.log('[EditProfile] saving mode=prod userIdType=convexId', { convexUserId });
    }

    try {
      await updateProfile({
        userId: convexUserId,
        bio: bio || undefined,
        height: height ? parseInt(height) : undefined,
        smoking: (smoking || undefined) as any,
        drinking: (drinking || undefined) as any,
        kids: (kids || undefined) as any,
        education: (education || undefined) as any,
        religion: (religion || undefined) as any,
        jobTitle: jobTitle || undefined,
        company: company || undefined,
        school: school || undefined,
      });
      await updateProfilePrompts({ userId: convexUserId, prompts: filledPrompts });
      Alert.alert('Success', 'Profile updated!');
      router.back();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile');
    }
  };

  if (!currentUser) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>{timedOut ? 'Failed to load profile' : 'Loading...'}</Text>
        <TouchableOpacity style={styles.loadingBackButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={COLORS.white} />
          <Text style={styles.loadingBackText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <BlurProfileNotice visible={showBlurNotice} onConfirm={handleBlurConfirm} onCancel={() => setShowBlurNotice(false)} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave}><Text style={styles.saveButton}>Save</Text></TouchableOpacity>
      </View>

      {/* Photo Grid - 9 slots */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photos</Text>
        <Text style={styles.sectionHint}>Add up to 9 photos. Your first photo will be your main profile picture.</Text>
        <View style={styles.photoGrid}>{Array.from({ length: GRID_SIZE }).map((_, i) => renderPhotoSlot(i))}</View>
        <Text style={styles.photoCount}>{validPhotos.length} of {GRID_SIZE} photos</Text>
      </View>

      {/* Photo Visibility */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photo Visibility</Text>
        <View style={styles.blurRow}>
          <View style={styles.blurInfo}>
            <View style={styles.blurLabelRow}>
              <Ionicons name="eye-off-outline" size={18} color={COLORS.primary} />
              <Text style={styles.blurLabel}>Blur My Photo</Text>
            </View>
            <Text style={styles.blurDescription}>
              {blurEnabled ? 'Your photo is blurred across Discover and your profile.' : 'Blur your photo to protect your privacy.'}
            </Text>
          </View>
          <Switch value={blurEnabled} onValueChange={handleBlurToggle} trackColor={{ false: COLORS.border, true: COLORS.primary }} thumbColor={COLORS.white} />
        </View>
      </View>

      {/* FIX 2: About/Bio with tap-anywhere-to-focus */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Pressable style={styles.bioContainer} onPress={() => bioInputRef.current?.focus()}>
          <TextInput
            ref={bioInputRef}
            style={styles.bioInput}
            placeholder="Tell us about yourself..."
            placeholderTextColor={COLORS.textMuted}
            value={bio}
            onChangeText={setBio}
            multiline
            numberOfLines={4}
            maxLength={500}
            textAlignVertical="top"
          />
        </Pressable>
        <Text style={styles.charCount}>{bio.length}/500</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Prompts</Text>
        {prompts.map((prompt, index) => (
          <View key={index} style={styles.promptCard}>
            <View style={styles.promptHeader}>
              <Text style={styles.promptQuestion}>{prompt.question}</Text>
              <TouchableOpacity onPress={() => handleDeletePrompt(index)}><Ionicons name="close-circle" size={22} color={COLORS.textMuted} /></TouchableOpacity>
            </View>
            <TextInput style={styles.promptAnswerInput} value={prompt.answer} onChangeText={(t) => handleUpdatePromptAnswer(index, t)} placeholder="Type your answer..." placeholderTextColor={COLORS.textMuted} multiline maxLength={200} />
            <Text style={styles.promptCharCount}>{prompt.answer.length}/200</Text>
          </View>
        ))}
        {prompts.length < 3 && !showPromptPicker && (
          <TouchableOpacity style={styles.addPromptButton} onPress={() => setShowPromptPicker(true)}>
            <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
            <Text style={styles.addPromptText}>Add a prompt ({prompts.length}/3)</Text>
          </TouchableOpacity>
        )}
        {showPromptPicker && (
          <View style={styles.promptPickerContainer}>
            {availableQuestions.map((q) => (
              <TouchableOpacity key={q.id} style={styles.promptPickerOption} onPress={() => handleAddPrompt(q.text)}>
                <Text style={styles.promptPickerOptionText}>{q.text}</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.promptPickerCancel} onPress={() => setShowPromptPicker(false)}><Text style={styles.promptPickerCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Basic Info</Text>
        <View style={styles.inputRow}><Text style={styles.label}>Height (cm)</Text><Input placeholder="Height" value={height} onChangeText={setHeight} keyboardType="numeric" style={styles.numberInput} /></View>
        <View style={styles.inputRow}><Text style={styles.label}>Job Title</Text><Input placeholder="Job title" value={jobTitle} onChangeText={setJobTitle} /></View>
        <View style={styles.inputRow}><Text style={styles.label}>Company</Text><Input placeholder="Company name" value={company} onChangeText={setCompany} /></View>
        <View style={styles.inputRow}><Text style={styles.label}>School</Text><Input placeholder="School/University" value={school} onChangeText={setSchool} /></View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Lifestyle</Text>
        <View style={styles.inputRow}>
          <Text style={styles.label}>Smoking</Text>
          <View style={styles.optionsRow}>
            {SMOKING_OPTIONS.map((o) => (
              <TouchableOpacity key={o.value} style={[styles.optionChip, smoking === o.value && styles.optionChipSelected]} onPress={() => setSmoking(smoking === o.value ? null : o.value)}>
                <Text style={[styles.optionChipText, smoking === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.inputRow}>
          <Text style={styles.label}>Drinking</Text>
          <View style={styles.optionsRow}>
            {DRINKING_OPTIONS.map((o) => (
              <TouchableOpacity key={o.value} style={[styles.optionChip, drinking === o.value && styles.optionChipSelected]} onPress={() => setDrinking(drinking === o.value ? null : o.value)}>
                <Text style={[styles.optionChipText, drinking === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.inputRow}>
          <Text style={styles.label}>Kids</Text>
          <View style={styles.optionsRow}>
            {KIDS_OPTIONS.map((o) => (
              <TouchableOpacity key={o.value} style={[styles.optionChip, kids === o.value && styles.optionChipSelected]} onPress={() => setKids(kids === o.value ? null : o.value)}>
                <Text style={[styles.optionChipText, kids === o.value && styles.optionChipTextSelected]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Education & Religion</Text>
        <View style={styles.inputRow}>
          <Text style={styles.label}>Education</Text>
          <View style={styles.chipGrid}>
            {EDUCATION_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o.value}
                style={[styles.compactChip, education === o.value && styles.compactChipSelected]}
                onPress={() => {
                  setEducation(education === o.value ? null : o.value);
                  if (o.value !== 'other') setEducationOther('');
                }}
              >
                <Text style={[styles.compactChipText, education === o.value && styles.compactChipTextSelected]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {education === 'other' && (
            <TextInput
              style={styles.otherInput}
              placeholder="Please specify..."
              placeholderTextColor={COLORS.textMuted}
              value={educationOther}
              onChangeText={setEducationOther}
              maxLength={50}
            />
          )}
        </View>
        <View style={styles.inputRow}>
          <Text style={styles.label}>Religion</Text>
          <View style={styles.chipGrid}>
            {RELIGION_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o.value}
                style={[styles.compactChip, religion === o.value && styles.compactChipSelected]}
                onPress={() => {
                  setReligion(religion === o.value ? null : o.value);
                  if (o.value !== 'other') setReligionOther('');
                }}
              >
                <Text style={[styles.compactChipText, religion === o.value && styles.compactChipTextSelected]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {religion === 'other' && (
            <TextInput
              style={styles.otherInput}
              placeholder="Please specify..."
              placeholderTextColor={COLORS.textMuted}
              value={religionOther}
              onChangeText={setReligionOther}
              maxLength={50}
            />
          )}
        </View>
      </View>

      {/* FIX 1: Footer with proper safe area spacing */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}>
        <Button title="Save Changes" variant="primary" onPress={handleSave} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  loadingText: { fontSize: 16, color: COLORS.textLight },
  loadingBackButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: COLORS.primary },
  loadingBackText: { fontSize: 14, fontWeight: '600', color: COLORS.white },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: COLORS.background, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 20, fontWeight: '600', color: COLORS.text },
  saveButton: { fontSize: 16, fontWeight: '600', color: COLORS.primary },
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  sectionHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 12 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  photoSlot: { width: slotSize, height: slotSize * 1.25, borderRadius: 10, overflow: 'hidden', backgroundColor: COLORS.backgroundDark },
  photoSlotEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.border, borderStyle: 'dashed' },
  photoImage: { width: '100%', height: '100%' },
  photoEditButton: { position: 'absolute', bottom: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  photoRemoveButton: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  slotBadge: { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  slotBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.white },
  uploadText: { fontSize: 11, color: COLORS.primary, marginTop: 4, fontWeight: '500' },
  photoCount: { fontSize: 12, color: COLORS.textLight, textAlign: 'center', marginTop: 12 },
  // FIX 2: Bio container for tap-to-focus
  bioContainer: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    minHeight: 120,
  },
  bioInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 100,
    textAlignVertical: 'top',
    padding: 0,
  },
  charCount: { fontSize: 12, color: COLORS.textLight, textAlign: 'right', marginTop: 4 },
  inputRow: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '500', color: COLORS.text, marginBottom: 8 },
  numberInput: { width: 120 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: COLORS.border },
  optionChipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optionChipText: { fontSize: 14, color: COLORS.text },
  optionChipTextSelected: { color: COLORS.white, fontWeight: '600' },
  selectContainer: { gap: 8 },
  selectOption: { padding: 12, borderRadius: 8, backgroundColor: COLORS.backgroundDark, borderWidth: 1, borderColor: COLORS.border },
  selectOptionSelected: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  selectOptionText: { fontSize: 14, color: COLORS.text },
  selectOptionTextSelected: { color: COLORS.primary, fontWeight: '600' },
  promptCard: { backgroundColor: COLORS.backgroundDark, borderRadius: 12, padding: 14, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: COLORS.primary },
  promptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  promptQuestion: { fontSize: 13, fontWeight: '600', color: COLORS.textLight, flex: 1, marginRight: 8 },
  promptAnswerInput: { fontSize: 15, color: COLORS.text, minHeight: 48, textAlignVertical: 'top', lineHeight: 20 },
  promptCharCount: { fontSize: 11, color: COLORS.textMuted, textAlign: 'right' },
  addPromptButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary + '40', borderStyle: 'dashed', gap: 6 },
  addPromptText: { fontSize: 14, fontWeight: '600', color: COLORS.primary },
  promptPickerContainer: { backgroundColor: COLORS.backgroundDark, borderRadius: 12, padding: 12 },
  promptPickerOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  promptPickerOptionText: { fontSize: 14, color: COLORS.text, flex: 1 },
  promptPickerCancel: { alignItems: 'center', paddingTop: 10 },
  promptPickerCancelText: { fontSize: 13, color: COLORS.textMuted },
  // FIX 1: Footer with better spacing
  footer: { padding: 16, paddingTop: 24, marginTop: 8 },
  blurRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  blurInfo: { flex: 1, marginRight: 16 },
  blurLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  blurLabel: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  blurDescription: { fontSize: 12, color: COLORS.textLight, lineHeight: 16 },
  // Photo badges
  mainBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  mainBadgeText: { fontSize: 10, fontWeight: '700', color: COLORS.white },
  setMainButton: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Compact chip grid for Education & Religion
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  compactChipSelected: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  chipIcon: { fontSize: 14 },
  compactChipText: { fontSize: 13, color: COLORS.text },
  compactChipTextSelected: { color: COLORS.primary, fontWeight: '600' },
  // Other text input for Education/Religion
  otherInput: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontSize: 14,
    color: COLORS.text,
  },
});
