import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import EmojiPicker from 'rn-emoji-keyboard';

import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { asUserId } from '@/convex/id';
import { COLORS } from '@/lib/constants';
import { isContentClean } from '@/lib/contentFilter';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { useDemoStore } from '@/stores/demoStore';

// Identity modes for confession posting
type IdentityMode = 'anonymous' | 'blur_photo' | 'open_to_all';

const IDENTITY_OPTIONS: { key: IdentityMode; label: string; description: string; icon: string }[] = [
  { key: 'anonymous', label: 'Anonymous', description: 'No name, no photo', icon: 'eye-off-outline' },
  { key: 'blur_photo', label: 'Blur Photo', description: 'Name visible, photo blurred', icon: 'eye-outline' },
  { key: 'open_to_all', label: 'Open to All', description: 'Name and photo visible', icon: 'person-outline' },
];

// P0/P1 MENTION_RULE:
// Mention eligibility for user A = union(
//   users A liked/right-swiped,
//   users A is mutually matched with
// ). Each candidate is tagged with matchType so we can:
//   - sort mutual_match above liked_only (done server-side)
//   - optionally render a visual hint
type LikedUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  age?: number | null;
  disambiguator: string;
  matchType?: 'mutual_match' | 'liked_only';
};

const DEMO_LIKED_USERS: LikedUser[] = [
  { id: 'demo_profile_2', name: 'Priya', avatarUrl: 'https://i.pravatar.cc/150?img=5', age: 24, disambiguator: 'Loves coffee', matchType: 'mutual_match' },
  { id: 'demo_profile_3', name: 'Rahul', avatarUrl: 'https://i.pravatar.cc/150?img=12', age: 27, disambiguator: 'Tech enthusiast', matchType: 'liked_only' },
  { id: 'demo_profile_4', name: 'Ananya', avatarUrl: 'https://i.pravatar.cc/150?img=9', age: 25, disambiguator: 'Mumbai', matchType: 'liked_only' },
  { id: 'demo_profile_5', name: 'Vikram', avatarUrl: 'https://i.pravatar.cc/150?img=11', age: 29, disambiguator: 'Photographer', matchType: 'liked_only' },
  { id: 'demo_profile_6', name: 'Priya', avatarUrl: 'https://i.pravatar.cc/150?img=16', age: 22, disambiguator: 'Yoga instructor', matchType: 'liked_only' },
];

function computeAge(dateOfBirth: string | undefined): number | undefined {
  if (!dateOfBirth) return undefined;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age > 0 && age < 120 ? age : undefined;
}

export default function ComposeConfessionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ editId?: string; mode?: string }>();
  const isEditMode = params.mode === 'edit' && !!params.editId;
  const editId = isEditMode ? (params.editId as Id<'confessions'>) : undefined;

  const userId = useAuthStore((s) => s.userId);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : userId;

  const demoAddConfession = useConfessionStore((s) => s.addConfession);
  const demoCanPostConfession = useConfessionStore((s) => s.canPostConfession);
  const demoRecordConfessionTimestamp = useConfessionStore((s) => s.recordConfessionTimestamp);
  const demoConfessions = useConfessionStore((s) => s.confessions);
  const demoCurrentUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const demoCurrentUser = demoCurrentUserId ? demoProfiles[demoCurrentUserId] : null;

  const convexCurrentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && currentUserId ? { userId: asUserId(currentUserId) ?? currentUserId } : 'skip'
  );
  const convexCurrentUserId = !isDemoMode ? (convexCurrentUser?._id ?? asUserId(currentUserId ?? '')) : undefined;
  const likedUsersQuery = useQuery(
    api.likes.getLikedUsers,
    !isDemoMode && convexCurrentUserId ? { userId: convexCurrentUserId } : 'skip'
  );
  const createConfessionMutation = useMutation(api.confessions.createConfession);
  const updateConfessionMutation = useMutation(api.confessions.updateConfession);

  // Fetch existing confession when in edit mode (live mode only)
  const existingConfessionQuery = useQuery(
    api.confessions.getConfession,
    !isDemoMode && editId ? { confessionId: editId } : 'skip'
  );

  // Get existing confession from appropriate source (demo store or Convex)
  const existingConfession = useMemo(() => {
    if (!isEditMode || !params.editId) return null;

    if (isDemoMode) {
      // Demo mode: find confession in demo store
      const demoConfession = demoConfessions.find((c: any) => c.id === params.editId);
      if (demoConfession) {
        return {
          text: demoConfession.text,
          mood: demoConfession.mood,
          isAnonymous: demoConfession.isAnonymous,
          authorPhotoUrl: demoConfession.authorPhotoUrl,
        };
      }
      return null;
    }

    // Live mode: use Convex query result
    return existingConfessionQuery;
  }, [isEditMode, params.editId, demoConfessions, existingConfessionQuery]);

  const [composerText, setComposerText] = useState('');
  const [selectedMood, setSelectedMood] = useState<'romantic' | 'spicy' | 'emotional' | 'funny'>('emotional');
  const [hasPrefilledEdit, setHasPrefilledEdit] = useState(false);
  const [identityMode, setIdentityMode] = useState<IdentityMode>('anonymous');
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [taggedUser, setTaggedUser] = useState<LikedUser | null>(null);
  const [showDuplicatePicker, setShowDuplicatePicker] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<LikedUser[]>([]);
  const composerInputRef = useRef<TextInput>(null);

  const likedUsers = useMemo<LikedUser[]>(
    () => (isDemoMode ? DEMO_LIKED_USERS : (likedUsersQuery ?? [])),
    [likedUsersQuery]
  );

  // Prefill form when editing an existing confession
  useEffect(() => {
    if (isEditMode && existingConfession && !hasPrefilledEdit) {
      setComposerText(existingConfession.text);
      if (existingConfession.mood) {
        setSelectedMood(existingConfession.mood as 'romantic' | 'spicy' | 'emotional' | 'funny');
      }
      // Set identity mode based on existing confession's anonymity
      if (existingConfession.isAnonymous) {
        setIdentityMode('anonymous');
      } else if (existingConfession.authorPhotoUrl) {
        setIdentityMode('open_to_all');
      } else {
        setIdentityMode('blur_photo');
      }
      setHasPrefilledEdit(true);
    }
  }, [isEditMode, existingConfession, hasPrefilledEdit]);

  // Get description for the selected identity mode
  const currentDescription = useMemo(() => {
    return IDENTITY_OPTIONS.find((opt) => opt.key === identityMode)?.description ?? '';
  }, [identityMode]);

  // Get author info based on identity mode
  // - anonymous: no author info at all
  // - blur_photo: name + age + gender, but NO photo
  // - open_to_all: full profile with photo
  const getAuthorInfo = useCallback((mode: IdentityMode) => {
    // Anonymous mode: completely anonymous, no author info
    if (mode === 'anonymous') {
      return {};
    }

    // Get user data for non-anonymous modes
    // Both blur_photo and open_to_all need photo URL - blur_photo blurs it on display
    if (isDemoMode && demoCurrentUser) {
      return {
        authorName: demoCurrentUser.name,
        authorPhotoUrl: demoCurrentUser.photos?.[0]?.url,
        authorAge: (demoCurrentUser as any).age,
        authorGender: (demoCurrentUser as any).gender,
      };
    }

    if (!isDemoMode && convexCurrentUser) {
      const primaryPhoto = convexCurrentUser.photos?.find((photo: any) => photo.isPrimary) ?? convexCurrentUser.photos?.[0];
      return {
        authorName: (convexCurrentUser as any).name,
        authorPhotoUrl: primaryPhoto?.url,
        authorAge: computeAge((convexCurrentUser as any).dateOfBirth),
        authorGender: (convexCurrentUser as any).gender,
      };
    }

    return {};
  }, [convexCurrentUser, demoCurrentUser]);

  const tagSuggestions = useMemo(() => {
    // P0/P1 MENTION_RULE + P1 Confess autocomplete:
    // - `likedUsers` is the single source of truth returned by the server.
    //   It already encodes: union(liked, mutual_match), de-duped by user id,
    //   sorted with mutual_match first then liked_only then alphabetical.
    // - Client-side behaviour:
    //   * Gate on 3+ typed chars.
    //   * Trim + lowercase query before compare.
    //   * Prefix match against candidate name (startsWith).
    //   * DO NOT filter by candidate name length (legacy bug).
    //   * DO NOT re-sort — preserve server-provided matchType order.
    if (!tagInput) {
      if (__DEV__) {
        console.log('[CONFESS_SEARCH][input] empty', { tagInput, taggedUserId: taggedUser?.id });
      }
      return [];
    }
    const normalized = tagInput.toLowerCase().trim();
    if (normalized.length < 3 || taggedUser) {
      if (__DEV__) {
        console.log('[CONFESS_SEARCH][dropdown] hidden', {
          reason: taggedUser ? 'already_tagged' : 'below_min_length',
          tagInput,
          normalized,
          normalizedLength: normalized.length,
        });
      }
      return [];
    }
    const sourceCount = likedUsers.length;
    const mutualCount = likedUsers.filter((u) => u.matchType === 'mutual_match').length;
    const likedOnlyCount = likedUsers.filter((u) => u.matchType === 'liked_only').length;
    const matched = likedUsers
      .filter((user) => user.name.trim().toLowerCase().startsWith(normalized))
      .slice(0, 5);
    if (__DEV__) {
      console.log('[MENTION_RULE][source]', {
        sourceCount,
        mutualCount,
        likedOnlyCount,
      });
      console.log('[MENTION_RULE][search]', {
        query: tagInput,
        normalized,
        matchCount: matched.length,
        matches: matched.map((u) => ({ id: u.id, name: u.name, matchType: u.matchType })),
      });
      console.log('[CONFESS_SEARCH][source]', { sourceCount });
      console.log('[CONFESS_SEARCH][filtered]', {
        tagInput,
        normalized,
        matchCount: matched.length,
        matchedNames: matched.map((u) => u.name),
      });
      console.log('[CONFESS_SEARCH][dropdown]', {
        willShow: matched.length > 0 && !taggedUser,
        shownCount: matched.length,
      });
    }
    return matched;
  }, [likedUsers, tagInput, taggedUser]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    router.back();
  }, [router]);

  const handleTagInputChange = useCallback((text: string) => {
    setTagInput(text);
    setTaggedUser(null);

    const normalized = text.toLowerCase().trim();
    if (!normalized) return;

    const exactMatches = likedUsers.filter((user) => user.name.toLowerCase() === normalized);
    if (exactMatches.length === 1 && exactMatches[0].name.length <= 7) {
      setTaggedUser(exactMatches[0]);
      setTagInput(exactMatches[0].name);
      return;
    }

    if (exactMatches.length > 1) {
      setDuplicateCandidates(exactMatches);
      setShowDuplicatePicker(true);
    }
  }, [likedUsers]);

  const handleSubmit = useCallback(async () => {
    if (!currentUserId || composerSubmitting) return;

    const trimmed = composerText.trim();
    if (trimmed.length < 10) {
      Alert.alert('Too Short', 'Confessions must be at least 10 characters.');
      return;
    }

    if (tagInput.trim() && !taggedUser) {
      Alert.alert('Select a Person', 'Pick a valid person from the suggestions, or clear the tag field.');
      return;
    }

    const phonePattern = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
    if (phonePattern.test(trimmed) || emailPattern.test(trimmed)) {
      Alert.alert('Safety Warning', "Don't include phone numbers or personal details.");
      return;
    }

    if (!isContentClean(trimmed)) {
      Alert.alert('Content Warning', 'Your confession contains inappropriate content. Please revise it.');
      return;
    }

    if (isDemoMode && !demoCanPostConfession()) {
      Alert.alert('Limit Reached', "You've reached today's confession limit. Try again later.");
      return;
    }

    // Determine isAnonymous based on identity mode
    // Only 'anonymous' mode is truly anonymous (no author info sent)
    // 'blur_photo' and 'open_to_all' both send isAnonymous: false with varying author info
    const isAnonymous = identityMode === 'anonymous';
    const authorInfo = getAuthorInfo(identityMode);

    // For non-anonymous modes, require that we have author name (profile loaded)
    if (!isAnonymous && !authorInfo.authorName) {
      Alert.alert('Profile Not Ready', 'Your profile is still loading. Please try again in a moment, or post anonymously.');
      return;
    }

    setComposerSubmitting(true);

    try {
      if (isDemoMode && isEditMode && params.editId) {
        // Demo mode edit: update existing confession in demo store
        const demoUpdateConfession = useConfessionStore.getState().updateConfession;
        if (demoUpdateConfession) {
          demoUpdateConfession(params.editId, trimmed, selectedMood);
        }
      } else if (isDemoMode) {
        // Demo mode create: add new confession
        const createdAt = Date.now();
        demoAddConfession({
          id: `conf_new_${createdAt}`,
          userId: currentUserId,
          text: trimmed,
          isAnonymous,
          mood: 'emotional',
          topEmojis: [],
          replyPreviews: [],
          visibility: 'global',
          replyCount: 0,
          reactionCount: 0,
          createdAt,
          expiresAt: createdAt + 24 * 60 * 60 * 1000,
          revealPolicy: 'never',
          taggedUserId: taggedUser?.id,
          taggedUserName: taggedUser?.name,
          ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
          ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
          ...(authorInfo.authorAge ? { authorAge: authorInfo.authorAge } : {}),
          ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
        } as any);
        demoRecordConfessionTimestamp();
      } else if (isEditMode && editId) {
        // Live mode edit: update existing confession (text and mood only)
        await updateConfessionMutation({
          confessionId: editId,
          userId: currentUserId,
          text: trimmed,
          mood: selectedMood,
        });
      } else {
        // Live mode create: new confession
        // Map frontend identityMode to backend authorVisibility
        const authorVisibility = identityMode === 'anonymous' ? 'anonymous'
          : identityMode === 'blur_photo' ? 'blur_photo'
          : 'open';
        await createConfessionMutation({
          userId: currentUserId,
          text: trimmed,
          isAnonymous,
          mood: selectedMood,
          visibility: 'global',
          authorVisibility,
          taggedUserId: taggedUser?.id as any,
          // Client-suggested mention name. Backend prefers the canonical name
          // resolved from the users table; this is only a fallback.
          ...(taggedUser?.name ? { taggedUserName: taggedUser.name } : {}),
          ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
          ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
          ...(authorInfo.authorAge ? { authorAge: authorInfo.authorAge } : {}),
          ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
        });
      }

      handleClose();
    } catch (error: any) {
      Alert.alert('Error', error?.message || (isEditMode ? 'Failed to update confession' : 'Failed to post confession'));
    } finally {
      setComposerSubmitting(false);
    }
  }, [
    identityMode,
    composerSubmitting,
    composerText,
    createConfessionMutation,
    updateConfessionMutation,
    currentUserId,
    demoAddConfession,
    demoCanPostConfession,
    demoRecordConfessionTimestamp,
    getAuthorInfo,
    handleClose,
    tagInput,
    taggedUser,
    isEditMode,
    editId,
    selectedMood,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        style={styles.keyboardContainer}
      >
        {/* Header with inline warning */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{isEditMode ? 'Edit Confession' : 'New Confession'}</Text>
            <View style={styles.inlineWarning}>
              <Ionicons name="shield-checkmark" size={10} color={COLORS.primary} />
              <Text style={styles.inlineWarningText}>No phone numbers or personal details</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={composerSubmitting || composerText.trim().length < 10}
            style={[
              styles.postButton,
              (composerSubmitting || composerText.trim().length < 10) && styles.postButtonDisabled,
            ]}
          >
            <Text
              style={[
                styles.postButtonText,
                (composerSubmitting || composerText.trim().length < 10) && styles.postButtonTextDisabled,
              ]}
            >
              {composerSubmitting ? (isEditMode ? 'Saving...' : 'Posting...') : (isEditMode ? 'Save' : 'Post')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Loading state when fetching existing confession in edit mode (live mode only) */}
        {isEditMode && !isDemoMode && !existingConfession && (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading confession...</Text>
          </View>
        )}

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.body}>
              {/* Confession text input - increased height */}
              <TextInput
                ref={composerInputRef}
                autoFocus={!isEditMode}
                style={styles.composerInput}
                placeholder="What's on your mind? Share your confession..."
                placeholderTextColor={COLORS.textMuted}
                multiline
                maxLength={500}
                textAlignVertical="top"
                scrollEnabled
                value={composerText}
                onChangeText={setComposerText}
              />

              {/* Toolbar with emoji and char count */}
              <View style={styles.composerToolbar}>
                <TouchableOpacity onPress={() => setShowComposerEmoji(true)}>
                  <Text style={styles.toolbarEmoji}>🙂</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                <Text style={styles.charCount}>{composerText.length}/500</Text>
              </View>

              {/* Mention username section - compact (hidden in edit mode) */}
              {!isEditMode && <View style={styles.tagSection}>
                <View style={styles.tagHeader}>
                  <Ionicons name="at-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.tagTitle}>Mention (optional)</Text>
                </View>

                {taggedUser ? (
                  <View style={styles.selectedTagRow}>
                    {taggedUser.avatarUrl ? (
                      <Image source={{ uri: taggedUser.avatarUrl }} style={styles.tagAvatar} contentFit="cover" />
                    ) : (
                      <View style={styles.tagAvatarFallback}>
                        <Ionicons name="person" size={14} color={COLORS.white} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tagName}>
                        {taggedUser.name}{taggedUser.age ? `, ${taggedUser.age}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        setTaggedUser(null);
                        setTagInput('');
                      }}
                    >
                      <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput
                      style={styles.tagInput}
                      placeholder="Type a name..."
                      placeholderTextColor={COLORS.textMuted}
                      value={tagInput}
                      onChangeText={handleTagInputChange}
                    />
                    <Text style={styles.tagHint}>Like someone first to mention them.</Text>
                  </>
                )}

                {tagSuggestions.length > 0 && !taggedUser && (
                  <View style={styles.suggestionList}>
                    {tagSuggestions.map((user) => (
                      <TouchableOpacity
                        key={user.id}
                        style={styles.suggestionRow}
                        activeOpacity={0.7}
                        onPress={() => {
                          if (__DEV__) {
                            console.log('[MENTION_RULE][selected]', {
                              id: user.id,
                              name: user.name,
                              matchType: user.matchType,
                            });
                          }
                          setTaggedUser(user);
                          setTagInput(user.name);
                        }}
                      >
                        {user.avatarUrl ? (
                          <Image
                            source={{ uri: user.avatarUrl }}
                            style={styles.suggestionAvatarImage}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={styles.suggestionAvatarFallback}>
                            <Ionicons name="person" size={18} color={COLORS.white} />
                          </View>
                        )}
                        <View style={styles.suggestionTextCol}>
                          <Text style={styles.suggestionName} numberOfLines={1}>
                            {user.name}{user.age ? `, ${user.age}` : ''}
                          </Text>
                          {user.disambiguator ? (
                            <Text style={styles.suggestionHint} numberOfLines={1}>
                              {user.disambiguator}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>}

              {/* Identity selector - 3 equal-width buttons in a row (hidden in edit mode) */}
              {!isEditMode && <View style={styles.identitySection}>
                <Text style={styles.identitySectionTitle}>Who can see your identity?</Text>
                <View style={styles.identityRow}>
                  {IDENTITY_OPTIONS.map((option) => {
                    const isSelected = identityMode === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          styles.identityButton,
                          isSelected && styles.identityButtonSelected,
                        ]}
                        onPress={() => setIdentityMode(option.key)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={option.icon as any}
                          size={18}
                          color={isSelected ? '#FFFFFF' : COLORS.textLight}
                        />
                        <Text
                          style={[
                            styles.identityButtonLabel,
                            isSelected && styles.identityButtonLabelSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* Dynamic description below buttons */}
                <Text style={styles.identityDescription}>{currentDescription}</Text>
              </View>}
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>
      </KeyboardAvoidingView>

      <EmojiPicker
        open={showComposerEmoji}
        onClose={() => setShowComposerEmoji(false)}
        onEmojiSelected={(emoji: any) => setComposerText((current) => current + emoji.emoji)}
      />

      <Modal visible={showDuplicatePicker} transparent animationType="fade" onRequestClose={() => setShowDuplicatePicker(false)}>
        <TouchableWithoutFeedback onPress={() => setShowDuplicatePicker(false)}>
          <View style={styles.duplicateOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.duplicateSheet}>
                <Text style={styles.duplicateTitle}>Multiple people named &quot;{tagInput}&quot;</Text>
                <Text style={styles.duplicateSubtitle}>Choose who you want to confess to.</Text>
                {duplicateCandidates.map((user) => (
                  <TouchableOpacity
                    key={user.id}
                    style={styles.duplicateRow}
                    onPress={() => {
                      if (__DEV__) {
                        console.log('[MENTION_RULE][selected]', {
                          id: user.id,
                          name: user.name,
                          matchType: user.matchType,
                          via: 'duplicate_picker',
                        });
                      }
                      setTaggedUser(user);
                      setTagInput(user.name);
                      setShowDuplicatePicker(false);
                    }}
                  >
                    {user.avatarUrl ? (
                      <Image source={{ uri: user.avatarUrl }} style={styles.duplicateAvatar} contentFit="cover" />
                    ) : (
                      <View style={styles.duplicateAvatarFallback}>
                        <Ionicons name="person" size={18} color={COLORS.white} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.duplicateName}>
                        {user.name}{user.age ? `, ${user.age}` : ''}
                      </Text>
                      <Text style={styles.duplicateHint}>{user.disambiguator}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  keyboardContainer: {
    flex: 1,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  inlineWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  inlineWarningText: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  postButton: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: COLORS.primary,
  },
  postButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  postButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.white,
  },
  postButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  scrollContent: {
    flexGrow: 1,
  },
  body: {
    flex: 1,
  },
  composerInput: {
    minHeight: 160,
    maxHeight: 200,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    fontSize: 16,
    lineHeight: 23,
    color: COLORS.text,
  },
  composerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  toolbarEmoji: {
    fontSize: 18,
  },
  charCount: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  tagSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  tagTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  tagInput: {
    fontSize: 14,
    color: COLORS.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundDark,
  },
  tagHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
  },
  selectedTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  tagAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  tagAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  tagName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  suggestionList: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  suggestionAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
  },
  suggestionAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  suggestionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  suggestionName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  suggestionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  // Identity selector styles - stable, no animations
  identitySection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },
  identitySectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 10,
  },
  identityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  identityButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: '#F5F6F8',
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  identityButtonSelected: {
    backgroundColor: '#E8475F',
    borderColor: '#E8475F',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  identityButtonLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },
  identityButtonLabelSelected: {
    color: '#FFFFFF',
  },
  identityDescription: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 10,
    fontWeight: '500',
  },
  // Duplicate picker modal
  duplicateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  duplicateSheet: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  duplicateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  duplicateSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  duplicateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  duplicateAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  duplicateAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  duplicateName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  duplicateHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});
