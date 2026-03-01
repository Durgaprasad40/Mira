import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useDemoStore } from '@/stores/demoStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import * as FileSystem from 'expo-file-system/legacy';

/** Check if URL is a valid remote URL (http/https) */
function isRemoteUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Check if URL is a local file */
function isLocalFile(url: string | undefined | null): boolean {
  if (!url) return false;
  return url.startsWith('file://') || url.startsWith('content://');
}

/** Check if path is from unstable ImagePicker cache */
function isUnstableCachePath(url: string | undefined | null): boolean {
  if (!url) return false;
  return url.includes('/cache/ImagePicker/') || url.includes('/Cache/ImagePicker/');
}

type PostType = 'truth' | 'dare';
type VisibilityMode = 'anonymous' | 'public' | 'no_photo';

/** Parse DOB string to calculate age */
function calculateAge(dob: string | undefined): number | undefined {
  if (!dob) return undefined;
  const dobDate = new Date(dob);
  if (isNaN(dobDate.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - dobDate.getFullYear();
  const monthDiff = today.getMonth() - dobDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
    age--;
  }
  return age > 0 ? age : undefined;
}

export default function CreateTodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [postType, setPostType] = useState<PostType>('truth');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<VisibilityMode>('anonymous');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get user data from canonical sources
  const userId = useAuthStore((s) => s.userId);

  // Source 1: demoStore - select STABLE primitives
  const currentDemoUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoProfiles = useDemoStore((s) => s.demoProfiles);

  // Source 2: privateProfileStore - Phase-2 data
  const p2DisplayName = usePrivateProfileStore((s) => s.displayName);
  const p2Age = usePrivateProfileStore((s) => s.age);
  const p2Gender = usePrivateProfileStore((s) => s.gender);
  const p2PhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const p2BlurredPhotoUrls = usePrivateProfileStore((s) => s.blurredPhotoUrls);

  // Derive identity - collect ALL photo candidates (https preferred, then file://)
  const ownerIdentity = useMemo(() => {
    // Collect all photo candidates from Phase-2
    const allP2Photos: string[] = [];
    if (p2PhotoUrls) allP2Photos.push(...p2PhotoUrls.filter(u => u && u.length > 0));
    if (p2BlurredPhotoUrls) allP2Photos.push(...p2BlurredPhotoUrls.filter(u => u && u.length > 0));

    // Try demoStore first (canonical for demo mode)
    const demoProfile = currentDemoUserId ? demoProfiles[currentDemoUserId] : null;

    if (demoProfile) {
      const demoName = demoProfile.name;
      const demoAge = demoProfile.dateOfBirth ? calculateAge(demoProfile.dateOfBirth) : undefined;
      const demoGender = demoProfile.gender;

      // Collect demo photos
      const demoPhotos: string[] = [];
      if (demoProfile.photoSlots) {
        demoPhotos.push(...demoProfile.photoSlots.filter((p): p is string => p !== null && p.length > 0));
      } else if (demoProfile.photos && demoProfile.photos.length > 0) {
        demoPhotos.push(...demoProfile.photos.map(p => p.url).filter(u => u && u.length > 0));
      }

      // Combine: demo photos + P2 photos
      const allPhotos = [...demoPhotos, ...allP2Photos];

      if (demoName) {
        return {
          name: demoName,
          age: demoAge,
          gender: demoGender,
          photoCandidates: allPhotos,
        };
      }
    }

    // Fallback to privateProfileStore (Phase-2 data)
    if (p2DisplayName) {
      return {
        name: p2DisplayName,
        age: p2Age > 0 ? p2Age : undefined,
        gender: p2Gender || undefined,
        photoCandidates: allP2Photos,
      };
    }

    // No identity available
    return { name: undefined, age: undefined, gender: undefined, photoCandidates: [] };
  }, [currentDemoUserId, demoProfiles, p2DisplayName, p2Age, p2Gender, p2PhotoUrls, p2BlurredPhotoUrls]);

  // Convex mutation
  const createPrompt = useMutation(api.truthDare.createPrompt);

  const maxLength = 280;
  const canSubmit = content.trim().length >= 10 && !isSubmitting;

  /**
   * Resolve best photo URL from candidates:
   * 1. Prefer https URLs (always valid)
   * 2. Try file:// URLs but verify existence (skip unstable cache paths)
   * 3. Return undefined if no valid photo found
   * Logs a single summary line (no spam).
   */
  async function resolveBestPhoto(candidates: string[]): Promise<{ url: string | undefined; type: string; reason: string }> {
    let remoteCount = 0;
    let skippedCacheCount = 0;
    let verifiedLocalCount = 0;
    let chosenUrl: string | undefined;
    let chosenType = 'none';
    let chosenReason = 'no_valid_candidate';

    // Step A: Count and try https first
    for (const uri of candidates) {
      if (isRemoteUrl(uri)) {
        remoteCount++;
        if (!chosenUrl) {
          chosenUrl = uri;
          chosenType = 'https';
          chosenReason = 'found_remote';
        }
      }
    }

    // Step B: If no remote, try file:// URLs with existence check
    if (!chosenUrl) {
      for (const uri of candidates) {
        if (!isLocalFile(uri)) continue;

        // Skip unstable cache paths
        if (isUnstableCachePath(uri)) {
          skippedCacheCount++;
          continue;
        }

        try {
          const info = await FileSystem.getInfoAsync(uri);
          const size = info.exists ? ((info as any).size || 0) : 0;

          if (info.exists && size > 0) {
            verifiedLocalCount++;
            if (!chosenUrl) {
              chosenUrl = uri;
              chosenType = 'file';
              chosenReason = 'verified_local';
            }
          }
        } catch {
          // Silently skip errors
        }
      }
    }

    // Single summary log line
    console.log(`[T/D REPORT] photoPick remoteCount=${remoteCount} verifiedLocalCount=${verifiedLocalCount} skippedCacheCount=${skippedCacheCount} chosen=${chosenType} reason=${chosenReason}`);

    return { url: chosenUrl, type: chosenType, reason: chosenReason };
  }

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);

    try {
      if (visibility === 'anonymous') {
        // Anonymous: no identity, no photo
        await createPrompt({
          type: postType,
          text: content.trim(),
          ownerUserId: userId || `anon_${Date.now()}`,
          isAnonymous: true,
          photoBlurMode: 'none',
        });
        console.log(`[T/D REPORT] created visibility=anonymous`);
      } else if (visibility === 'no_photo') {
        // Without photo: identity visible, NO photo
        await createPrompt({
          type: postType,
          text: content.trim(),
          ownerUserId: userId || `anon_${Date.now()}`,
          isAnonymous: false,
          photoBlurMode: 'none',
          ownerName: ownerIdentity.name,
          ownerAge: ownerIdentity.age,
          ownerGender: ownerIdentity.gender,
          // NO ownerPhotoUrl - explicitly omit
        });
        console.log(`[T/D REPORT] created visibility=no_photo`);
      } else {
        // Everyone (public): identity + photo
        const photoResult = await resolveBestPhoto(ownerIdentity.photoCandidates || []);

        await createPrompt({
          type: postType,
          text: content.trim(),
          ownerUserId: userId || `anon_${Date.now()}`,
          isAnonymous: false,
          photoBlurMode: 'none',
          ownerName: ownerIdentity.name,
          ownerAge: ownerIdentity.age,
          ownerGender: ownerIdentity.gender,
          ownerPhotoUrl: photoResult.url,
        });
        console.log(`[T/D REPORT] created visibility=public photoType=${photoResult.type}`);
      }

      router.back();
    } catch (error) {
      console.error('[T/D UI] Post failed:', error);
      setIsSubmitting(false);
      Alert.alert('Error', 'Failed to create your post. Please try again.');
    }
  };

  const C = INCOGNITO_COLORS;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header - close button only, no Post button here */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Post</Text>
        {/* Spacer for alignment */}
        <View style={{ width: 24 }} />
      </View>

      {/* Type Selector */}
      <View style={styles.typeSelector}>
        <TouchableOpacity
          style={[styles.typeOption, postType === 'truth' && styles.typeOptionActive]}
          onPress={() => setPostType('truth')}
        >
          <Ionicons name="help-circle" size={20} color={postType === 'truth' ? '#FFFFFF' : C.textLight} />
          <Text style={[styles.typeLabel, postType === 'truth' && styles.typeLabelActive]}>Truth</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeOption, postType === 'dare' && styles.typeOptionDareActive]}
          onPress={() => setPostType('dare')}
        >
          <Ionicons name="flash" size={20} color={postType === 'dare' ? '#FFFFFF' : C.textLight} />
          <Text style={[styles.typeLabel, postType === 'dare' && styles.typeLabelActive]}>Dare</Text>
        </TouchableOpacity>
      </View>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder={
            postType === 'truth'
              ? 'Ask a truth question...'
              : 'Write a dare challenge...'
          }
          placeholderTextColor={C.textLight}
          multiline
          maxLength={maxLength}
          value={content}
          onChangeText={setContent}
          autoFocus
        />
        <Text style={styles.charCount}>
          {content.length}/{maxLength}
        </Text>
      </View>

      {/* 3-Option Visibility Selector */}
      <View style={styles.visibilityContainer}>
        <Text style={styles.visibilityLabel}>Who can see your identity?</Text>
        <View style={styles.visibilityOptions}>
          {/* Anonymous */}
          <TouchableOpacity
            style={[styles.visibilityOption, visibility === 'anonymous' && styles.visibilityOptionActive]}
            onPress={() => setVisibility('anonymous')}
          >
            <Ionicons
              name="eye-off"
              size={18}
              color={visibility === 'anonymous' ? '#FFFFFF' : C.textLight}
            />
            <Text style={[styles.visibilityText, visibility === 'anonymous' && styles.visibilityTextActive]}>
              Anonymous
            </Text>
          </TouchableOpacity>

          {/* Public */}
          <TouchableOpacity
            style={[styles.visibilityOption, visibility === 'public' && styles.visibilityOptionActive]}
            onPress={() => setVisibility('public')}
          >
            <Ionicons
              name="person"
              size={18}
              color={visibility === 'public' ? '#FFFFFF' : C.textLight}
            />
            <Text style={[styles.visibilityText, visibility === 'public' && styles.visibilityTextActive]}>
              Everyone
            </Text>
          </TouchableOpacity>

          {/* Without photo */}
          <TouchableOpacity
            style={[styles.visibilityOption, visibility === 'no_photo' && styles.visibilityOptionActive]}
            onPress={() => setVisibility('no_photo')}
          >
            <Ionicons
              name="person-outline"
              size={18}
              color={visibility === 'no_photo' ? '#FFFFFF' : C.textLight}
            />
            <Text style={[styles.visibilityText, visibility === 'no_photo' && styles.visibilityTextActive]}>
              No photo
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.visibilityHint}>
          {visibility === 'anonymous'
            ? 'Your identity is completely hidden'
            : visibility === 'public'
            ? 'Your profile photo is visible'
            : 'Your name is visible, no photo'}
        </Text>

        {/* POST button - directly under visibility options */}
        <TouchableOpacity
          style={[styles.postButtonMain, !canSubmit && styles.postButtonMainDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={[styles.postButtonMainText, !canSubmit && styles.postButtonMainTextDisabled]}>
              POST
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const C = INCOGNITO_COLORS;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: C.text },

  typeSelector: {
    flexDirection: 'row', padding: 16, gap: 12,
  },
  typeOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 12, gap: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.surface,
  },
  typeOptionActive: { backgroundColor: '#6C5CE7', borderColor: '#6C5CE7' },
  typeOptionDareActive: { backgroundColor: '#E17055', borderColor: '#E17055' },
  typeLabel: { fontSize: 15, fontWeight: '600', color: C.textLight },
  typeLabelActive: { color: '#FFFFFF' },

  inputContainer: {
    paddingHorizontal: 16, paddingVertical: 8,
  },
  textInput: {
    fontSize: 16, color: C.text, minHeight: 120, textAlignVertical: 'top',
    backgroundColor: C.surface, borderRadius: 12, padding: 16, lineHeight: 24,
  },
  charCount: {
    fontSize: 12, color: C.textLight, textAlign: 'right', marginTop: 8,
  },

  visibilityContainer: {
    paddingHorizontal: 16, paddingVertical: 12,
  },
  visibilityLabel: {
    fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 10,
  },
  visibilityOptions: {
    flexDirection: 'row', gap: 8,
  },
  visibilityOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 10, borderRadius: 10, backgroundColor: C.surface,
  },
  visibilityOptionActive: {
    backgroundColor: C.primary,
  },
  visibilityText: {
    fontSize: 12, fontWeight: '600', color: C.textLight,
  },
  visibilityTextActive: {
    color: '#FFFFFF',
  },
  visibilityHint: {
    fontSize: 12, color: C.textLight, marginTop: 8, textAlign: 'center',
  },

  // Main POST button - placed directly under visibility options
  postButtonMain: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  postButtonMainDisabled: {
    backgroundColor: C.surface,
  },
  postButtonMainText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  postButtonMainTextDisabled: {
    color: C.textLight,
  },
});
