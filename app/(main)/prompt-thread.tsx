import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { TextComposerModal } from '@/components/truthdare/TextComposerModal';
import { VoiceComposer } from '@/components/truthdare/VoiceComposer';
import { CameraPhotoSheet, CameraPhotoOptions } from '@/components/chat/CameraPhotoSheet';
import { uploadPhotoToConvex } from '@/lib/uploadUtils';
import { getTimeAgo } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';
import type { TodPrompt, TodProfileVisibility } from '@/types';

const C = INCOGNITO_COLORS;

// Available emoji reactions
const REACTION_EMOJIS = ['😂', '🔥', '😍', '👏', '😮', '💀'];

// Time remaining helper
function formatTimeLeft(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h left`;
  return `${minutes}m left`;
}

export default function PromptThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    promptId: string;
    autoOpenComposer?: 'new' | 'edit';
  }>();
  const { promptId, autoOpenComposer } = params;
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = userId || 'demo_user_1';

  // Get profile data for author identity snapshot
  const p2DisplayName = usePrivateProfileStore((s) => s.displayName);
  const p2Age = usePrivateProfileStore((s) => s.age);
  const p2Gender = usePrivateProfileStore((s) => s.gender);
  const p2PhotoUrls = usePrivateProfileStore((s) => s.selectedPhotoUrls);

  // Build author profile for comments
  const authorProfile = useMemo(() => {
    const photoUrl = Array.isArray(p2PhotoUrls) && p2PhotoUrls.length > 0
      ? p2PhotoUrls.find((url) => url && !url.includes('/cache/'))
      : undefined;

    return {
      name: p2DisplayName || undefined,
      age: p2Age || undefined,
      gender: p2Gender || undefined,
      photoUrl,
    };
  }, [p2DisplayName, p2Age, p2Gender, p2PhotoUrls]);

  // Fetch thread data from Convex
  const threadData = useQuery(
    api.truthDare.getPromptThread,
    promptId ? { promptId, viewerUserId: currentUserId } : 'skip'
  );

  // Mutations
  const createOrEditAnswer = useMutation(api.truthDare.createOrEditAnswer);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const setReaction = useMutation(api.truthDare.setAnswerReaction);
  const reportAnswer = useMutation(api.truthDare.reportAnswer);
  const deleteAnswer = useMutation(api.truthDare.deleteMyAnswer);

  const isLoading = threadData === undefined;
  const prompt = threadData?.prompt;
  const answers = threadData?.answers ?? [];
  const isExpired = threadData?.isExpired ?? false;

  // Find user's own answer
  const myAnswer = useMemo(() => {
    return answers.find((a) => a.isOwnAnswer);
  }, [answers]);

  // Composer state
  const [showTextComposer, setShowTextComposer] = useState(false);
  const [showVoiceComposer, setShowVoiceComposer] = useState(false);
  const [showAnswerMenu, setShowAnswerMenu] = useState(false);
  // Inline + menu for editing own comment
  const [showInlineMenu, setShowInlineMenu] = useState(false);

  // Gallery media state for privacy sheet
  const [galleryMedia, setGalleryMedia] = useState<{
    uri: string;
    type: 'photo' | 'video';
    durationSec?: number;
  } | null>(null);
  const [isSubmittingMedia, setIsSubmittingMedia] = useState(false);

  // Emoji picker state (per answer)
  const [emojiPickerAnswerId, setEmojiPickerAnswerId] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);

  // Auto-open composer if requested from feed
  useEffect(() => {
    if (autoOpenComposer === 'new' && !myAnswer) {
      setShowAnswerMenu(true);
    } else if (autoOpenComposer === 'edit' && myAnswer) {
      // For now, show text composer for editing - could expand later
      setShowTextComposer(true);
    }
  }, [autoOpenComposer, myAnswer]);

  const scrollToEnd = () => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
  };

  // Handle emoji reaction
  const handleReact = useCallback(async (answerId: string, emoji: string) => {
    if (!userId) return;
    setEmojiPickerAnswerId(null);
    try {
      await setReaction({ answerId, userId, emoji });
    } catch (error: any) {
      if (error.message?.includes('Rate limit')) {
        Alert.alert('Slow down', 'Please wait a moment before reacting again.');
      }
    }
  }, [userId, setReaction]);

  // Handle report
  const handleReport = useCallback(async (answerId: string, authorId: string) => {
    if (!userId || userId === authorId) return;

    Alert.alert(
      'Report Comment',
      'Are you sure you want to report this comment as inappropriate?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await reportAnswer({
                answerId,
                reporterId: userId,
              });
              if (result.isNowHidden) {
                Alert.alert('Reported', 'This comment has been hidden due to multiple reports.');
              } else {
                Alert.alert('Reported', 'Thank you for your report. We will review it.');
              }
            } catch (error: any) {
              if (error.message?.includes('already reported')) {
                Alert.alert('Already Reported', 'You have already reported this comment.');
              } else if (error.message?.includes('daily report limit')) {
                Alert.alert('Limit Reached', 'You have reached your daily report limit.');
              } else {
                Alert.alert('Error', 'Failed to report. Please try again.');
              }
            }
          },
        },
      ]
    );
  }, [userId, reportAnswer]);

  // Handle delete own comment
  const handleDeleteAnswer = useCallback(async (answerId: string) => {
    if (!userId) return;

    Alert.alert(
      'Delete Comment',
      'Are you sure you want to delete your comment? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAnswer({ answerId, userId });
            } catch (error) {
              Alert.alert('Error', 'Failed to delete comment. Please try again.');
            }
          },
        },
      ]
    );
  }, [userId, deleteAnswer]);

  // Text submit handler - actually calls createOrEditAnswer mutation
  const handleTextSubmit = useCallback(async (text: string, isAnonymous?: boolean, profileVisibility?: TodProfileVisibility) => {
    if (!promptId || !currentUserId) return;

    setShowTextComposer(false);

    // IMPORTANT: Default to NOT anonymous (show profile) if not specified
    const isAnon = isAnonymous ?? false;
    // Map profileVisibility to photoBlurMode
    const photoBlurMode = profileVisibility === 'blurred' ? 'blur' : 'none';

    try {
      await createOrEditAnswer({
        promptId,
        userId: currentUserId,
        type: 'text',
        text: text.trim(),
        isAnonymous: isAnon,
        visibility: 'public',
        // Author identity snapshot (only included if not anonymous)
        authorName: isAnon ? undefined : authorProfile.name,
        authorPhotoUrl: isAnon ? undefined : authorProfile.photoUrl,
        authorAge: authorProfile.age, // Always include age
        authorGender: authorProfile.gender, // Always include gender
        photoBlurMode: isAnon ? undefined : (photoBlurMode as 'none' | 'blur'),
      });
      // Convex query auto-refreshes, comment will appear automatically
      scrollToEnd();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to post comment. Please try again.');
    }
  }, [promptId, currentUserId, createOrEditAnswer, authorProfile]);

  // Voice submit handler - actually calls createOrEditAnswer mutation
  const handleVoiceSubmit = useCallback(async (durationSec: number, isAnonymous?: boolean, _profileVisibility?: TodProfileVisibility) => {
    if (!promptId || !currentUserId) return;

    setShowVoiceComposer(false);

    // Voice requires mediaStorageId - for now show not implemented
    // In production, VoiceComposer would upload the audio and pass mediaStorageId
    Alert.alert('Voice Comments', 'Voice upload coming soon. Use text for now.');
  }, [promptId, currentUserId]);

  const openCamera = () => {
    setShowAnswerMenu(false);
    router.push({
      pathname: '/(main)/camera-composer' as any,
      params: { promptId: promptId!, promptType: prompt?.type },
    });
  };

  // Gallery picker - pick photo/video from library, then show privacy sheet
  const openGallery = useCallback(async () => {
    setShowAnswerMenu(false);

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const mediaType = asset.type === 'video' ? 'video' : 'photo';
      const durationSec = asset.duration ? Math.round(asset.duration / 1000) : undefined;

      // Set gallery media state to show privacy sheet
      setGalleryMedia({
        uri: asset.uri,
        type: mediaType,
        durationSec,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to open gallery. Please try again.');
    }
  }, []);

  // Handle gallery media privacy settings confirmation
  const handleGalleryMediaConfirm = useCallback(async (
    imageUri: string,
    options: CameraPhotoOptions
  ) => {
    if (!promptId || !currentUserId || !galleryMedia) return;

    setIsSubmittingMedia(true);

    try {
      // Upload media to Convex storage
      const storageId = await uploadPhotoToConvex(imageUri, generateUploadUrl);

      // Create media comment via mutation (anonymous by default for media)
      await createOrEditAnswer({
        promptId,
        userId: currentUserId,
        type: galleryMedia.type,
        mediaStorageId: storageId,
        durationSec: galleryMedia.durationSec,
        isAnonymous: true, // Default to anonymous for media comments
        visibility: 'public',
        viewMode: options.viewingMode,
        viewDurationSec: options.timer > 0 ? options.timer : undefined,
        // Author identity (always include age/gender even for anonymous)
        authorAge: authorProfile.age,
        authorGender: authorProfile.gender,
      });

      // Clear gallery media state and close sheet
      setGalleryMedia(null);
      scrollToEnd();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to post media comment. Please try again.');
    } finally {
      setIsSubmittingMedia(false);
    }
  }, [promptId, currentUserId, galleryMedia, generateUploadUrl, createOrEditAnswer, authorProfile]);

  // Handle gallery media cancel
  const handleGalleryMediaCancel = useCallback(() => {
    setGalleryMedia(null);
  }, []);

  // Helper for gender icon
  const getCommentGenderIcon = (gender: string | undefined): string => {
    if (!gender) return '';
    const g = gender.toLowerCase();
    if (g === 'male' || g === 'm') return '♂';
    if (g === 'female' || g === 'f') return '♀';
    return '⚧';
  };

  // Render answer card
  const renderAnswer = ({ item }: { item: typeof answers[0] }) => {
    const isOwnAnswer = item.isOwnAnswer;
    const hasReported = item.hasReported;
    const showEmojiPicker = emojiPickerAnswerId === item._id;

    // Get top 3 emojis for display (reactionCounts is array of { emoji, count })
    const topEmojis = (item.reactionCounts ?? [])
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Author identity display logic
    const isAnon = item.isAnonymous !== false; // default to anonymous if undefined

    // Backward compatibility: if NOT anonymous but missing author fields,
    // use current user profile if this is our own comment
    let authorName = item.authorName;
    let authorPhotoUrl = item.authorPhotoUrl;
    let authorAge = item.authorAge;
    let authorGender = item.authorGender;
    const photoBlurMode = item.photoBlurMode;

    // Fallback for old comments without author snapshot
    if (!isAnon && isOwnAnswer && !authorName) {
      authorName = authorProfile.name;
      authorPhotoUrl = authorProfile.photoUrl;
      authorAge = authorProfile.age;
      authorGender = authorProfile.gender;
    }

    const genderIcon = getCommentGenderIcon(authorGender);

    // Build age + gender string
    const ageGenderStr = [
      authorAge ? `${authorAge}` : '',
      genderIcon,
    ].filter(Boolean).join(' · ');

    return (
      <View style={styles.answerCard}>
        {/* Header */}
        <View style={styles.answerHeader}>
          {/* Avatar: Anonymous icon OR photo (possibly blurred) OR placeholder */}
          {isAnon ? (
            <View style={styles.answerAvatarAnon}>
              <Ionicons name="eye-off" size={16} color={C.textLight} />
            </View>
          ) : authorPhotoUrl ? (
            <Image
              source={{ uri: authorPhotoUrl }}
              style={styles.answerAvatar}
              blurRadius={photoBlurMode === 'blur' ? 15 : 0}
            />
          ) : (
            <View style={styles.answerAvatarPlaceholder}>
              <Ionicons name="person" size={16} color={C.textLight} />
            </View>
          )}
          <View style={styles.answerInfo}>
            <View style={styles.answerNameRow}>
              <Text style={styles.answerName}>
                {isAnon ? 'Anonymous' : (authorName || 'User')}
              </Text>
              {isOwnAnswer && (
                <View style={styles.youBadge}>
                  <Text style={styles.youBadgeText}>You</Text>
                </View>
              )}
            </View>
            {/* Time + Age/Gender row */}
            <View style={styles.answerMetaRow}>
              <Text style={styles.answerTime}>{getTimeAgo(item.createdAt)}</Text>
              {!isAnon && ageGenderStr ? (
                <>
                  <Text style={styles.answerMetaDot}>·</Text>
                  <Text style={styles.answerAgeGender}>{ageGenderStr}</Text>
                </>
              ) : null}
            </View>
          </View>
        </View>

        {/* Content */}
        {item.type === 'text' && item.text && (
          <Text style={styles.answerText}>{item.text}</Text>
        )}

        {item.type === 'voice' && (
          <View style={styles.voiceRow}>
            <Ionicons name="play-circle" size={32} color={C.primary} />
            <View style={styles.voiceWaveform}>
              {Array.from({ length: 16 }).map((_, i) => (
                <View key={i} style={[styles.voiceBar, { height: 4 + (i % 4) * 6 }]} />
              ))}
            </View>
            <Text style={styles.voiceDuration}>{item.durationSec}s</Text>
          </View>
        )}

        {(item.type === 'photo' || item.type === 'video') && (
          <View style={styles.mediaContainer}>
            <View style={styles.mediaBadge}>
              <Ionicons
                name={item.type === 'video' ? 'videocam' : 'image'}
                size={20}
                color={C.primary}
              />
              <Text style={styles.mediaBadgeText}>
                {item.type === 'video' ? 'Video' : 'Photo'}
              </Text>
              {item.viewMode && (
                <Text style={styles.mediaViewMode}>
                  {item.viewMode === 'hold' ? 'Hold to view' : 'Tap to view'}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Actions: Reactions + Inline Edit + Delete */}
        <View style={styles.answerActions}>
          {/* Reaction bubbles */}
          <View style={styles.reactionArea}>
            {topEmojis.length > 0 && (
              <View style={styles.reactionBubbles}>
                {topEmojis.map(({ emoji, count }) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[
                      styles.reactionBubble,
                      item.myReaction === emoji && styles.reactionBubbleActive,
                    ]}
                    onPress={() => handleReact(item._id, item.myReaction === emoji ? '' : emoji)}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    <Text style={styles.reactionCount}>{count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Add reaction button */}
            <TouchableOpacity
              style={styles.addReactionBtn}
              onPress={() => setEmojiPickerAnswerId(showEmojiPicker ? null : item._id)}
            >
              <Ionicons
                name={item.myReaction ? 'happy' : 'happy-outline'}
                size={18}
                color={item.myReaction ? C.primary : C.textLight}
              />
              {item.totalReactionCount > 0 && (
                <Text style={styles.totalReactionCount}>{item.totalReactionCount}</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Own comment: Inline + button + Delete */}
          {isOwnAnswer ? (
            <View style={styles.ownCommentActions}>
              {/* Inline + button for editing/replacing */}
              <TouchableOpacity
                style={styles.inlineAddBtn}
                onPress={() => setShowInlineMenu(!showInlineMenu)}
              >
                <Ionicons name={showInlineMenu ? 'close' : 'add'} size={24} color={C.primary} />
              </TouchableOpacity>
              {/* Delete button */}
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDeleteAnswer(item._id)}
              >
                <Ionicons name="trash-outline" size={16} color={C.textLight} />
              </TouchableOpacity>
            </View>
          ) : !hasReported ? (
            <TouchableOpacity
              style={styles.reportBtn}
              onPress={() => handleReport(item._id, item.userId)}
            >
              <Ionicons name="flag-outline" size={16} color={C.textLight} />
            </TouchableOpacity>
          ) : (
            <View style={styles.reportedBadge}>
              <Ionicons name="flag" size={12} color={C.textLight} />
              <Text style={styles.reportedText}>Reported</Text>
            </View>
          )}
        </View>

        {/* Inline menu for editing (own comment only) */}
        {isOwnAnswer && showInlineMenu && (
          <View style={styles.inlineMenuOverlay}>
            <TouchableOpacity
              style={styles.inlineMenuItem}
              onPress={() => { setShowInlineMenu(false); setShowTextComposer(true); }}
            >
              <Ionicons name="create-outline" size={18} color="#6C5CE7" />
              <Text style={styles.inlineMenuText}>Text</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.inlineMenuItem}
              onPress={() => { setShowInlineMenu(false); setShowVoiceComposer(true); }}
            >
              <Ionicons name="mic-outline" size={18} color="#FF9800" />
              <Text style={styles.inlineMenuText}>Voice</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.inlineMenuItem}
              onPress={() => { setShowInlineMenu(false); openCamera(); }}
            >
              <Ionicons name="camera-outline" size={18} color="#E94560" />
              <Text style={styles.inlineMenuText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.inlineMenuItem}
              onPress={() => { setShowInlineMenu(false); openGallery(); }}
            >
              <Ionicons name="images-outline" size={18} color="#00B894" />
              <Text style={styles.inlineMenuText}>Gallery</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Emoji picker overlay */}
        {showEmojiPicker && (
          <View style={styles.emojiPickerOverlay}>
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={[
                  styles.emojiPickerItem,
                  item.myReaction === emoji && styles.emojiPickerItemActive,
                ]}
                onPress={() => handleReact(item._id, item.myReaction === emoji ? '' : emoji)}
              >
                <Text style={styles.emojiPickerEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Hidden indicator for reported content */}
        {item.isHiddenForOthers && !isOwnAnswer && (
          <View style={styles.hiddenIndicator}>
            <Ionicons name="eye-off" size={12} color={C.textLight} />
            <Text style={styles.hiddenText}>Hidden due to reports</Text>
          </View>
        )}
      </View>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Loading thread...</Text>
      </View>
    );
  }

  // Not found state
  if (!prompt) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Thread</Text>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.emptyTitle}>Prompt not found</Text>
          <Text style={styles.emptySubtitle}>This prompt may have expired or been removed.</Text>
        </View>
      </View>
    );
  }

  const isTruth = prompt.type === 'truth';
  const timeLeft = formatTimeLeft(prompt.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000);

  // Helper for gender icon
  const getGenderIcon = (gender: string | undefined): string => {
    if (!gender) return '';
    const g = gender.toLowerCase();
    if (g === 'male' || g === 'm') return '♂';
    if (g === 'female' || g === 'f') return '♀';
    return '⚧';
  };

  // Build owner identity display string
  const ownerIsAnonymous = prompt.isAnonymous !== false; // Default to anonymous if undefined
  const ownerAge = prompt.ownerAge;
  const ownerGender = prompt.ownerGender;
  const ownerName = prompt.ownerName;
  const ownerPhotoUrl = prompt.ownerPhotoUrl;
  const genderIcon = getGenderIcon(ownerGender);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={[styles.headerBadge, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
          <Text style={styles.headerBadgeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
        </View>
        <Text style={styles.headerTitle}>Thread</Text>
        <View style={{ flex: 1 }} />
        <View style={styles.timeLeftBadge}>
          <Ionicons name="time-outline" size={12} color={C.textLight} />
          <Text style={styles.timeLeftText}>{timeLeft}</Text>
        </View>
      </View>

      {/* FIXED Question Block (does NOT scroll) */}
      <View style={styles.questionBlock}>
        {/* Owner Identity Row */}
        <View style={styles.ownerIdentityRow}>
          {/* Left: Photo or Anonymous icon */}
          {ownerIsAnonymous ? (
            <View style={styles.ownerAvatarAnon}>
              <Ionicons name="eye-off" size={16} color={C.textLight} />
            </View>
          ) : ownerPhotoUrl ? (
            <Image source={{ uri: ownerPhotoUrl }} style={styles.ownerAvatar} />
          ) : (
            <View style={styles.ownerAvatarPlaceholder}>
              <Ionicons name="person" size={16} color={C.textLight} />
            </View>
          )}

          {/* Owner info: name/anonymous + age + gender */}
          <View style={styles.ownerInfo}>
            <Text style={styles.ownerName}>
              {ownerIsAnonymous ? 'Anonymous' : (ownerName || 'User')}
            </Text>
            <Text style={styles.ownerDetails}>
              {ownerAge ? `${ownerAge}` : ''}
              {ownerAge && genderIcon ? ' · ' : ''}
              {genderIcon}
            </Text>
          </View>

          {/* Answer count: +N format */}
          {prompt.answerCount > 0 && (
            <Text style={styles.threadCountText}>+{prompt.answerCount}</Text>
          )}
        </View>

        {/* Prompt text */}
        <Text style={styles.promptText}>{prompt.text}</Text>
      </View>

      {/* Expired banner */}
      {isExpired && (
        <View style={styles.expiredBanner}>
          <Ionicons name="time-outline" size={16} color="#FF9800" />
          <Text style={styles.expiredBannerText}>This prompt has expired. No new answers allowed.</Text>
        </View>
      )}

      {/* Answers list (SCROLLABLE area - flex:1 takes remaining space) */}
      <FlatList
        ref={listRef}
        data={answers}
        keyExtractor={(item) => item._id}
        renderItem={renderAnswer}
        style={styles.answersListContainer}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.commentsHeader}>
            <Text style={styles.commentsHeaderText}>Comments</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyComments}>
            <Text style={styles.emptyCommentsText}>No comments yet. Be the first!</Text>
          </View>
        }
      />

      {/* FAB (only if not expired and hasn't commented) */}
      {!isExpired && !myAnswer && (
        <View style={[styles.commentFab, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
          {showAnswerMenu && (
            <View style={styles.fabOptions}>
              <TouchableOpacity
                style={styles.fabIcon}
                onPress={() => { setShowAnswerMenu(false); setShowTextComposer(true); }}
              >
                <Ionicons name="create-outline" size={20} color="#6C5CE7" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.fabIcon}
                onPress={() => { setShowAnswerMenu(false); setShowVoiceComposer(true); }}
              >
                <Ionicons name="mic-outline" size={20} color="#FF9800" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.fabIcon} onPress={openCamera}>
                <Ionicons name="camera-outline" size={20} color="#E94560" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.fabIcon} onPress={openGallery}>
                <Ionicons name="images-outline" size={20} color="#00B894" />
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={[styles.fabBtn, showAnswerMenu && styles.fabBtnOpen]}
            onPress={() => setShowAnswerMenu(!showAnswerMenu)}
            activeOpacity={0.8}
          >
            <Ionicons name={showAnswerMenu ? 'close' : 'add'} size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}


      {/* Composers */}
      <TextComposerModal
        visible={showTextComposer}
        prompt={{
          id: prompt._id as unknown as string,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          ownerUserId: prompt.ownerUserId,
          answerCount: prompt.answerCount,
          activeCount: 0,
          createdAt: prompt.createdAt,
          expiresAt: prompt.expiresAt,
        }}
        initialText={myAnswer?.text || ''}
        onClose={() => setShowTextComposer(false)}
        onSubmit={handleTextSubmit}
      />
      <VoiceComposer
        visible={showVoiceComposer}
        prompt={{
          id: prompt._id as unknown as string,
          type: prompt.type,
          text: prompt.text,
          isTrending: prompt.isTrending,
          ownerUserId: prompt.ownerUserId,
          answerCount: prompt.answerCount,
          activeCount: 0,
          createdAt: prompt.createdAt,
          expiresAt: prompt.expiresAt,
        }}
        onClose={() => setShowVoiceComposer(false)}
        onSubmit={handleVoiceSubmit}
      />

      {/* Gallery Media Privacy Sheet - same as camera flow */}
      <CameraPhotoSheet
        visible={!!galleryMedia}
        imageUri={galleryMedia?.uri ?? null}
        mediaType={galleryMedia?.type}
        onConfirm={handleGalleryMediaConfirm}
        onCancel={handleGalleryMediaCancel}
      />

      {/* Loading overlay for media upload */}
      {isSubmittingMedia && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.uploadingText}>Posting media...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  centered: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: C.textLight },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  headerBadgeText: { fontSize: 9, fontWeight: '700', color: '#FFF' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  timeLeftBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeLeftText: { fontSize: 12, color: C.textLight },

  // Fixed Question Block (sticky at top)
  questionBlock: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
    backgroundColor: C.background,
  },
  ownerIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  ownerAvatarAnon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  ownerAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerInfo: {
    flex: 1,
    marginLeft: 10,
  },
  ownerName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  ownerDetails: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 1,
  },
  threadCountText: {
    fontSize: 14,
    fontWeight: '700',
    color: C.primary,
  },
  promptText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    lineHeight: 24,
  },

  // Comments list
  answersListContainer: {
    flex: 1,
  },
  commentsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.surface + '40',
  },
  commentsHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  expiredBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FF980015', paddingHorizontal: 16, paddingVertical: 10,
  },
  expiredBannerText: { fontSize: 12, color: '#FF9800' },

  listContent: { paddingBottom: 100 },

  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text },
  emptySubtitle: { fontSize: 14, color: C.textLight, textAlign: 'center' },

  emptyComments: { padding: 40, alignItems: 'center' },
  emptyCommentsText: { fontSize: 14, color: C.textLight },

  // Answer card
  answerCard: {
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.surface + '40',
    position: 'relative',
  },
  answerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  answerAvatarPlaceholder: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  answerAvatarAnon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  answerAvatar: {
    width: 32, height: 32, borderRadius: 16,
  },
  answerInfo: { flex: 1, marginLeft: 10 },
  answerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  answerName: { fontSize: 13, fontWeight: '600', color: C.text },
  youBadge: { backgroundColor: C.primary + '25', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  youBadgeText: { fontSize: 9, fontWeight: '700', color: C.primary },
  answerMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  answerTime: { fontSize: 11, color: C.textLight },
  answerMetaDot: { fontSize: 11, color: C.textLight, marginHorizontal: 4 },
  answerAgeGender: { fontSize: 11, color: C.textLight },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },

  answerText: { fontSize: 14, color: C.text, lineHeight: 21, marginBottom: 8 },

  voiceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 8, padding: 10, backgroundColor: C.surface, borderRadius: 10,
  },
  voiceWaveform: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  voiceBar: { width: 2, borderRadius: 1, backgroundColor: C.primary + '60' },
  voiceDuration: { fontSize: 12, color: C.textLight, fontWeight: '600' },

  mediaContainer: { marginBottom: 8 },
  mediaBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 10, padding: 14,
  },
  mediaBadgeText: { fontSize: 13, fontWeight: '600', color: C.text },
  mediaViewMode: { fontSize: 11, color: C.textLight, marginLeft: 'auto' },

  // Actions
  answerActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  reactionArea: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reactionBubbles: { flexDirection: 'row', gap: 4 },
  reactionBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: C.surface, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 12,
  },
  reactionBubbleActive: {
    backgroundColor: `${C.primary}30`,
    borderWidth: 1, borderColor: C.primary,
  },
  reactionEmoji: { fontSize: 12 },
  reactionCount: { fontSize: 10, color: C.textLight, fontWeight: '600' },
  addReactionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4,
  },
  totalReactionCount: { fontSize: 12, color: C.textLight, fontWeight: '600' },

  // Own comment actions (inline + and delete)
  ownCommentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineAddBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: { padding: 6 },
  reportBtn: { padding: 6 },
  reportedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  reportedText: { fontSize: 10, color: C.textLight },

  // Emoji picker
  emojiPickerOverlay: {
    position: 'absolute', bottom: 50, left: 16,
    flexDirection: 'row', gap: 2,
    backgroundColor: C.surface, borderRadius: 16, padding: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
    zIndex: 10,
  },
  emojiPickerItem: { padding: 6, borderRadius: 8 },
  emojiPickerItemActive: { backgroundColor: `${C.primary}30` },
  emojiPickerEmoji: { fontSize: 18 },

  // Inline menu for editing own comment
  inlineMenuOverlay: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  inlineMenuItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderRadius: 10,
    gap: 4,
  },
  inlineMenuText: {
    fontSize: 11,
    fontWeight: '600',
    color: C.text,
  },

  hiddenIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, padding: 8, backgroundColor: C.surface, borderRadius: 8,
  },
  hiddenText: { fontSize: 11, color: C.textLight },

  // FAB
  commentFab: { position: 'absolute', right: 16, alignItems: 'center' },
  fabBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4,
  },
  fabBtnOpen: { backgroundColor: C.textLight },
  fabOptions: { position: 'absolute', bottom: 60, alignItems: 'center', gap: 10 },
  fabIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2, shadowRadius: 3,
  },

  // Uploading overlay
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  uploadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#FFF',
    fontWeight: '600',
  },
});
