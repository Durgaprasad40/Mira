import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { filterContent, getFilterMessage, isContentClean } from '@/lib/contentFilter';
import type { DesireCategory } from '@/types';

const C = INCOGNITO_COLORS;
const ALL_DESIRE_CATEGORIES: DesireCategory[] = ['romantic', 'adventurous', 'intellectual', 'social', 'creative', 'spiritual'];
const DESIRE_BIO_MAX = 150;

export default function PrivateProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, setProfile, markSetup, isSetup } = usePrivateProfileStore();
  const [editing, setEditing] = useState(!isSetup);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [selectedDesires, setSelectedDesires] = useState<DesireCategory[]>(profile.desireCategories);
  const [blurPhoto, setBlurPhoto] = useState(profile.blurPhoto);

  const toggleDesire = (cat: DesireCategory) => {
    setSelectedDesires((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSave = () => {
    if (username.trim().length < 3) {
      Alert.alert('Username too short', 'Must be at least 3 characters.');
      return;
    }
    if (!isContentClean(username.trim())) {
      Alert.alert('Username Not Allowed', 'Your username contains content that is not permitted.');
      return;
    }
    if (bio.trim().length > 0) {
      const bioResult = filterContent(bio.trim());
      if (!bioResult.isClean) {
        Alert.alert('Bio Not Allowed', getFilterMessage(bioResult));
        return;
      }
    }
    setProfile({
      username: username.trim(),
      bio: bio.trim(),
      desireCategories: selectedDesires,
      blurPhoto,
    });
    markSetup();
    setEditing(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Ionicons name="person-circle" size={24} color={C.primary} />
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.profileContent}>
        {/* Avatar preview */}
        <View style={styles.profileAvatarSection}>
          <View style={styles.profileAvatarCircle}>
            <Ionicons name="person" size={48} color={C.textLight} />
          </View>
          <Text style={styles.profileDisplayName}>{profile.username}</Text>
          <View style={styles.blurBadge}>
            <Ionicons name={profile.blurPhoto ? 'eye-off' : 'eye'} size={14} color={C.primary} />
            <Text style={styles.blurBadgeText}>{profile.blurPhoto ? 'Photo blurred' : 'Photo visible'}</Text>
          </View>
        </View>

        {editing ? (
          <>
            <Text style={styles.fieldLabel}>Private Username</Text>
            <TextInput
              style={styles.fieldInput}
              value={username}
              onChangeText={setUsername}
              maxLength={20}
              placeholder="Choose a username..."
              placeholderTextColor={C.textLight}
            />

            <Text style={styles.fieldLabel}>Connection Vibe</Text>
            <Text style={styles.fieldHint}>Share your vibe, boundaries, and pace (keep it respectful).</Text>
            <TextInput
              style={[styles.fieldInput, { minHeight: 80, textAlignVertical: 'top' }]}
              value={bio}
              onChangeText={setBio}
              maxLength={DESIRE_BIO_MAX}
              multiline
              placeholder="What are you open to? Set your pace..."
              placeholderTextColor={C.textLight}
            />
            <Text style={styles.fieldCharCount}>{bio.length}/{DESIRE_BIO_MAX}</Text>

            <Text style={styles.fieldLabel}>Connection Tags</Text>
            <View style={styles.desirePicker}>
              {ALL_DESIRE_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.desirePickerChip, selectedDesires.includes(cat) && styles.desirePickerChipActive]}
                  onPress={() => toggleDesire(cat)}
                >
                  <Text style={[styles.desirePickerText, selectedDesires.includes(cat) && styles.desirePickerTextActive]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.blurToggle} onPress={() => setBlurPhoto(!blurPhoto)}>
              <View style={styles.blurToggleLeft}>
                <Ionicons name="eye-off" size={20} color={C.textLight} />
                <Text style={styles.blurToggleLabel}>Blur my photo by default</Text>
              </View>
              <Ionicons
                name={blurPhoto ? 'checkbox' : 'square-outline'}
                size={22}
                color={blurPhoto ? C.primary : C.textLight}
              />
            </TouchableOpacity>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Save Profile</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {profile.bio ? (
              <View style={styles.viewField}>
                <Text style={styles.viewFieldLabel}>Connection Vibe</Text>
                <Text style={styles.viewFieldValue}>{profile.bio}</Text>
              </View>
            ) : null}

            {profile.desireCategories.length > 0 && (
              <View style={styles.viewField}>
                <Text style={styles.viewFieldLabel}>Connection Tags</Text>
                <View style={styles.desireRow}>
                  {profile.desireCategories.map((cat) => (
                    <View key={cat} style={styles.desireChip}>
                      <Text style={styles.desireChipText}>{cat}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
              <Ionicons name="create-outline" size={18} color={C.primary} />
              <Text style={styles.editBtnText}>Edit Private Profile</Text>
            </TouchableOpacity>

            <View style={styles.privacyNote}>
              <Ionicons name="shield-checkmark" size={18} color={C.textLight} />
              <Text style={styles.privacyNoteText}>
                This profile is separate from your main profile and only visible inside the Private tab.
              </Text>
            </View>
          </>
        )}

        {/* Back to Main App */}
        <TouchableOpacity
          style={styles.backToMainBtn}
          onPress={() => router.replace('/(main)/(tabs)/home' as any)}
        >
          <Ionicons name="arrow-back" size={18} color={C.textLight} />
          <Text style={styles.backToMainText}>Back to Main App</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text, flex: 1, marginLeft: 10 },
  profileContent: { padding: 20 },
  profileAvatarSection: { alignItems: 'center', marginBottom: 24 },
  profileAvatarCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  profileDisplayName: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 6 },
  blurBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  blurBadgeText: { fontSize: 12, color: C.primary },

  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.textLight, marginTop: 16, marginBottom: 6 },
  fieldHint: { fontSize: 12, color: C.textLight, marginBottom: 8, fontStyle: 'italic' },
  fieldCharCount: { fontSize: 11, color: C.textLight, textAlign: 'right', marginTop: 4 },
  fieldInput: {
    backgroundColor: C.surface, borderRadius: 10, padding: 12,
    fontSize: 14, color: C.text,
  },
  desirePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  desirePickerChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.surface,
  },
  desirePickerChipActive: { backgroundColor: C.primary + '20', borderColor: C.primary },
  desirePickerText: { fontSize: 13, color: C.textLight, textTransform: 'capitalize' },
  desirePickerTextActive: { color: C.primary, fontWeight: '600' },
  blurToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, backgroundColor: C.surface, borderRadius: 10, marginTop: 16,
  },
  blurToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  blurToggleLabel: { fontSize: 14, color: C.text },
  saveBtn: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 24,
  },
  saveBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },

  viewField: { marginBottom: 16 },
  viewFieldLabel: { fontSize: 12, fontWeight: '600', color: C.textLight, marginBottom: 6 },
  viewFieldValue: { fontSize: 14, color: C.text, lineHeight: 20 },
  desireRow: { flexDirection: 'row', gap: 4, marginBottom: 6, flexWrap: 'wrap' },
  desireChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: C.primary + '20' },
  desireChipText: { fontSize: 10, color: C.primary, fontWeight: '500', textTransform: 'capitalize' },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 12, backgroundColor: C.surface, marginTop: 16,
  },
  editBtnText: { fontSize: 14, fontWeight: '600', color: C.primary },
  privacyNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 14, backgroundColor: C.surface, borderRadius: 10, marginTop: 20,
  },
  privacyNoteText: { flex: 1, fontSize: 12, color: C.textLight, lineHeight: 18 },

  backToMainBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: C.surface, marginTop: 32,
  },
  backToMainText: { fontSize: 14, fontWeight: '600', color: C.textLight },
});
