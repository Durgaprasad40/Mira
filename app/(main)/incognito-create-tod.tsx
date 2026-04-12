import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import { uploadMediaToConvex } from '@/lib/uploadUtils';
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

export default function CreateTodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    editPromptId?: string;
    editType?: string;
    editText?: string;
  }>();

  // Edit mode detection
  const isEditMode = !!params.editPromptId;
  const editPromptId = params.editPromptId;

  const [postType, setPostType] = useState<PostType>('truth');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<VisibilityMode>('anonymous');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize state from edit params
  useEffect(() => {
    if (isEditMode && params.editText) {
      setContent(params.editText);
      if (params.editType === 'truth' || params.editType === 'dare') {
        setPostType(params.editType);
      }
    }
  }, [isEditMode, params.editText, params.editType]);

  // Get user data from canonical sources
  const token = useAuthStore((s) => s.token);

  // Source 2: privateProfileStore - Phase-2 data
  const p2DisplayName = usePrivateProfileStore((s) => s.displayName);
  const p2Age = usePrivateProfileStore((s) => s.age);
  const p2Gender = usePrivateProfileStore((s) => s.gender);
  const p2PhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);
  const currentPrivateProfile = useQuery(
    api.privateProfiles.getCurrentOnboardingProfile,
    token ? { token } : 'skip'
  );

  // Derive the live Phase-2 identity snapshot used by the prompt.
  const ownerIdentity = useMemo(() => {
    const allP2Photos: string[] = [];
    if (currentPrivateProfile?.privatePhotoUrls) {
      allP2Photos.push(
        ...currentPrivateProfile.privatePhotoUrls.filter((u: string) => u.length > 0)
      );
    }
    if (p2PhotoUrls) allP2Photos.push(...p2PhotoUrls.filter((u) => u && u.length > 0));

    return {
      name: currentPrivateProfile?.displayName || p2DisplayName || undefined,
      age: currentPrivateProfile?.age || (p2Age > 0 ? p2Age : undefined),
      gender: currentPrivateProfile?.gender || p2Gender || undefined,
      photoCandidates: allP2Photos,
    };
  }, [currentPrivateProfile, p2DisplayName, p2Age, p2Gender, p2PhotoUrls]);

  // Convex mutations
  const createPrompt = useMutation(api.truthDare.createPrompt);
  const editPromptMutation = useMutation(api.truthDare.editPrompt);
  const generateUploadUrl = useMutation(api.truthDare.generateUploadUrl);

  const maxLength = 280;
  const canSubmit = content.trim().length >= 10 && !isSubmitting;

  // Synchronous lock to prevent double-tap race condition
  const isSubmittingRef = useRef(false);

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
    // Synchronous guard: prevent double-tap race condition
    if (!canSubmit || isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (!token) {
      isSubmittingRef.current = false;
      Alert.alert('Sign in required', 'Please sign in again before posting.');
      return;
    }

    setIsSubmitting(true);

    try {
      // EDIT MODE: Update existing prompt text only
      if (isEditMode && editPromptId) {
        await editPromptMutation({
          promptId: editPromptId as any,
          text: content.trim(),
          token,
        });
        console.log(`[T/D REPORT] edited promptId=${editPromptId}`);
        router.back();
        return;
      }

      // CREATE MODE: Use strict session-token auth for server-side verification
      if (visibility === 'anonymous') {
        // Anonymous: no identity, no photo
        await createPrompt({
          type: postType,
          text: content.trim(),
          token,
          isAnonymous: true,
          photoBlurMode: 'none',
        });
        console.log(`[T/D REPORT] created visibility=anonymous`);
      } else if (visibility === 'no_photo') {
        // Without photo: identity visible, NO photo
        await createPrompt({
          type: postType,
          text: content.trim(),
          token,
          isAnonymous: false,
          photoBlurMode: 'none',
          ownerName: ownerIdentity.name,
          ownerAge: ownerIdentity.age,
          ownerGender: ownerIdentity.gender,
          // NO ownerPhotoUrl - explicitly omit
        });
        console.log(`[T/D REPORT] created visibility=no_photo`);
      } else {
        // Name + photo: identity + photo
        const photoResult = await resolveBestPhoto(ownerIdentity.photoCandidates || []);
        if (!photoResult.url) {
          throw new Error('Your profile photo is not ready yet.');
        }

        let ownerPhotoStorageId: string | undefined;
        if (photoResult.type === 'file') {
          ownerPhotoStorageId = await uploadMediaToConvex(
            photoResult.url,
            () => generateUploadUrl({ token }),
            'photo'
          );
        }

        await createPrompt({
          type: postType,
          text: content.trim(),
          token,
          isAnonymous: false,
          photoBlurMode: 'none',
          ownerName: ownerIdentity.name,
          ownerAge: ownerIdentity.age,
          ownerGender: ownerIdentity.gender,
          ownerPhotoUrl: photoResult.type === 'https' ? photoResult.url : undefined,
          ownerPhotoStorageId: ownerPhotoStorageId as any,
        });
        console.log(`[T/D REPORT] created visibility=public photoType=${photoResult.type}`);
      }

      router.back();
    } catch (error) {
      console.error('[T/D UI] Post failed:', error);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      Alert.alert('Error', 'Failed to create your post. Please try again.');
    }
  };

  const C = INCOGNITO_COLORS;
  const bottomScrollPadding = Math.max(insets.bottom, 16) + 20;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="close" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEditMode ? 'Edit Post' : 'New Post'}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: bottomScrollPadding },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="always"
          scrollIndicatorInsets={{ bottom: bottomScrollPadding }}
        >
          <View style={[styles.typeSelector, isEditMode && { opacity: 0.5 }]}>
            <TouchableOpacity
              style={[styles.typeOption, postType === 'truth' && styles.typeOptionActive]}
              onPress={() => !isEditMode && setPostType('truth')}
              disabled={isEditMode}
            >
              <Ionicons name="help-circle" size={20} color={postType === 'truth' ? '#FFFFFF' : C.textLight} />
              <Text style={[styles.typeLabel, postType === 'truth' && styles.typeLabelActive]}>Truth</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeOption, postType === 'dare' && styles.typeOptionDareActive]}
              onPress={() => !isEditMode && setPostType('dare')}
              disabled={isEditMode}
            >
              <Ionicons name="flash" size={20} color={postType === 'dare' ? '#FFFFFF' : C.textLight} />
              <Text style={[styles.typeLabel, postType === 'dare' && styles.typeLabelActive]}>Dare</Text>
            </TouchableOpacity>
          </View>

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

          {!isEditMode && (
            <>
              <View style={styles.visibilityContainer}>
                <Text style={styles.visibilityLabel}>How should your identity appear?</Text>
                <View style={styles.visibilityOptions}>
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
                      Name + photo
                    </Text>
                  </TouchableOpacity>

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
                      Name only
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.visibilityHint}>
                  {visibility === 'anonymous'
                    ? 'Your identity is completely hidden'
                    : visibility === 'public'
                    ? 'Your name and profile photo appear on the post'
                    : 'Your name appears on the post without a photo'}
                </Text>
              </View>

              <View style={styles.postButtonInlineContainer}>
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
                      {isEditMode ? 'SAVE' : 'POST'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.howItWorksCard}>
                <Text style={styles.howItWorksTitle}>How it works</Text>
                <Text style={styles.howItWorksText}>
                  Post, get replies, and connect with someone you like.
                </Text>
              </View>
            </>
          )}

          {isEditMode && (
            <View style={styles.postButtonInlineContainer}>
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
                    {isEditMode ? 'SAVE' : 'POST'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.guidelinesContainer}>
            <Text style={styles.guidelinesTitle}>Before you post</Text>
            <Text style={styles.guidelinesPoint}>• Be respectful to others</Text>
            <Text style={styles.guidelinesPoint}>• Keep content safe and appropriate</Text>
            <Text style={styles.guidelinesPoint}>• No scams or misleading content</Text>
            <Text style={styles.guidelinesPoint}>• Respect privacy and consent</Text>
            <Text style={styles.guidelinesLinkText}>
              Read full{' '}
              <Text
                style={styles.guidelinesLink}
                onPress={() => router.push('/(main)/community-guidelines')}
              >
                community guidelines
              </Text>
            </Text>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const C = INCOGNITO_COLORS;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  screen: { flex: 1, backgroundColor: C.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
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
    fontSize: 12,
    color: C.textLight,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 18,
  },
  howItWorksCard: {
    marginTop: 0,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(108, 92, 231, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(108, 92, 231, 0.18)',
  },
  howItWorksTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  howItWorksText: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  postButtonInlineContainer: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 14,
  },

  // Main POST button - inline primary CTA
  postButtonMain: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Guidelines section - below POST button
  guidelinesContainer: {
    marginTop: 8,
    marginHorizontal: 16,
    marginBottom: 0,
    padding: 14,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  guidelinesTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    marginBottom: 8,
  },
  guidelinesPoint: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 4,
    lineHeight: 18,
  },
  guidelinesLinkText: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 8,
    lineHeight: 18,
  },
  guidelinesLink: {
    color: C.primary,
    textDecorationLine: 'underline',
  },
});
