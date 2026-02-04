/**
 * Demo Profile Creation Screen
 *
 * Shown only in demo mode when no profile exists yet.
 * Collects name + at least 1 photo, then sets auth and navigates to main tabs.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS } from '@/lib/constants';
import { Button, Input } from '@/components/ui';
import { useDemoStore } from '@/stores/demoStore';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { useAuthStore } from '@/stores/authStore';

const DEMO_USER_ID = 'demo_user_1';

export default function DemoProfileScreen() {
  const router = useRouter();
  const saveDemoProfile = useDemoStore((s) => s.saveDemoProfile);
  const { setAuth } = useAuthStore();

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  const handlePickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Please allow access to your photos to add a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images' as const],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, result.assets[0].uri]);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleContinue = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Name Required', 'Please enter your name to continue.');
      return;
    }
    if (photos.length === 0) {
      Alert.alert('Photo Required', 'Please add at least one photo to continue.');
      return;
    }

    // Save profile to demoStore (persisted)
    saveDemoProfile(DEMO_USER_ID, {
      name: trimmedName,
      photos: photos.map((uri) => ({ url: uri })),
      bio: bio.trim() || undefined,
    });

    // Set auth so the app treats us as authenticated
    setAuth(DEMO_USER_ID, 'demo_token', true);

    // Clear stale data from any previous demo session, then seed fresh
    useDemoDmStore.setState({ conversations: {}, meta: {}, drafts: {} });
    useDemoStore.setState({ seeded: false, matches: [], likes: [], profiles: [] });
    useDemoStore.getState().seed();

    if (__DEV__) console.log('[DemoGate] profile_created name=' + trimmedName + ' photos=' + photos.length);

    router.replace('/(main)/(tabs)/home' as any);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Ionicons name="heart" size={40} color={COLORS.primary} />
          <Text style={styles.title}>Create Your Profile</Text>
          <Text style={styles.subtitle}>
            Add your name and a photo to get started
          </Text>
        </View>

        {/* Name */}
        <View style={styles.field}>
          <Input
            label="Your Name"
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            autoCapitalize="words"
            autoComplete="name"
          />
        </View>

        {/* Bio (optional) */}
        <View style={styles.field}>
          <Input
            label="Bio (optional)"
            value={bio}
            onChangeText={setBio}
            placeholder="Tell others about yourself..."
            multiline
          />
        </View>

        {/* Photos */}
        <Text style={styles.photoLabel}>Profile Photos</Text>
        <Text style={styles.photoHint}>Add at least 1 photo (tap + to add)</Text>
        <View style={styles.photosRow}>
          {photos.map((uri, i) => (
            <View key={i} style={styles.photoContainer}>
              <Image source={{ uri }} style={styles.photo} />
              <TouchableOpacity
                style={styles.removePhotoBtn}
                onPress={() => handleRemovePhoto(i)}
              >
                <Ionicons name="close-circle" size={22} color={COLORS.error} />
              </TouchableOpacity>
            </View>
          ))}
          {photos.length < 4 && (
            <TouchableOpacity style={styles.addPhotoBtn} onPress={handlePickPhoto}>
              <Ionicons name="add" size={32} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.footer}>
          <Button
            title="Continue"
            variant="primary"
            onPress={handleContinue}
            fullWidth
            disabled={!name.trim() || photos.length === 0}
          />
          <Text style={styles.demoNote}>
            Demo Mode — no account needed
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  field: {
    marginBottom: 16,
  },
  photoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  photoHint: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 12,
  },
  photosRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 32,
  },
  photoContainer: {
    position: 'relative',
  },
  photo: {
    width: 90,
    height: 120,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: COLORS.background,
    borderRadius: 11,
  },
  addPhotoBtn: {
    width: 90,
    height: 120,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  footer: {
    marginTop: 'auto',
  },
  demoNote: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 12,
    opacity: 0.7,
  },
});
