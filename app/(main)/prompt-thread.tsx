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
import { UnifiedAnswerComposer, IdentityMode, Attachment } from '@/components/truthdare/UnifiedAnswerComposer';
import { TodVoicePlayer } from '@/components/truthdare/TodVoicePlayer';
import { CameraPhotoSheet, CameraPhotoOptions } from '@/components/chat/CameraPhotoSheet';
import { uploadMediaToConvex } from '@/lib/uploadUtils';
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
  const generateUploadUrl = useMutation(api.truthDare.generateUploadUrl);
  const setReaction = useMutation(api.truthDare.setAnswerReaction);
  const reportAnswer = useMutation(api.truthDare.reportAnswer);
  const deleteAnswer = useMutation(api.truthDare.deleteMyAnswer);
  // Secure media APIs (for future viewer implementation)
  const claimAnswerMediaView = useMutation(api.truthDare.claimAnswerMediaView);
  const finalizeAnswerMediaView = useMutation(api.truthDare.finalizeAnswerMediaView);

  const isLoading = threadData === undefined;
  const prompt = threadData?.prompt;
  const answers = threadData?.answers ?? [];
  const isExpired = threadData?.isExpired ?? false;

  // Find user's own answer
  const myAnswer = useMemo(() => {
    return answers.find((a) => a.isOwnAnswer);
  }, [answers]);

  // Composer state - unified composer for text + optional media
  const [showUnifiedComposer, setShowUnifiedComposer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Gallery media state for privacy sheet (camera flow)
  const [galleryMedia, setGalleryMedia] = useState<{
    uri: string;
    type: 'photo' | 'video';
    durationSec?: number;
  } | null>(null);
  const [isSubmittingMedia, setIsSubmittingMedia] = useState(false);

  // Emoji picker state (per answer)
  const [emojiPickerAnswerId, setEmojiPickerAnswerId] = useState<string | null>(null);

  // Media viewer state for tap-to-view
  const [viewingMedia, setViewingMedia] = useState<{
    answerId: string;
    mediaUrl: string;
    mediaType: 'photo' | 'video';
    isOwnAnswer: boolean;
    hasViewed?: boolean;
    isFrontCamera?: boolean;
  } | null>(null);

  const listRef = useRef<FlatList>(null);

  // Auto-open composer if requested from feed
  useEffect(() => {
    if (autoOpenComposer === 'new' && !myAnswer) {
      setShowUnifiedComposer(true);
    } else if (autoOpenComposer === 'edit' && myAnswer) {
      setShowUnifiedComposer(true);
    }
  }, [autoOpenComposer, myAnswer]);

  const scrollToEnd = () => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
  };

  // Handle emoji reaction
  const handleReact = useCallback(async (answerId: string, emoji: string) => {
    if (!userId) {
      console.log('[T/D REACTION] skip - no userId');
      return;
    }
    setEmojiPickerAnswerId(null);

    // Find the answer to get additional context
    const answer = answers.find((a) => a._id === answerId);
    const answerIdPrefix = answerId.substring(0, 8);

    console.log('[T/D REACTION] tap', {
      answerIdPrefix,
      emoji: emoji || '(remove)',
      currentCount: answer?.totalReactionCount ?? 0,
      isOwnAnswer: answer?.isOwnAnswer ?? false,
      hasAuth: !!userId,
    });

    try {
      const result = await setReaction({ answerId, userId, emoji });
      // Handle server returning ok: false (no throw, graceful fail)
      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        console.warn('[T/D REACTION] failed', { reason: (result as any).reason });
      } else {
        console.log('[T/D REACTION] success', { action: (result as any)?.action });
      }
    } catch (error: any) {
      // Graceful handling - don't crash UI
      console.warn('[T/D REACTION] error', { message: error?.message?.substring(0, 50) });
      if (error.message?.includes('Rate limit')) {
        Alert.alert('Slow down', 'Please wait a moment before reacting again.');
      }
    }
  }, [userId, setReaction, answers]);

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

  // Handle tap-to-view for media content
  const handleViewMedia = useCallback(async (answer: typeof answers[0]) => {
    if (!answer.mediaUrl || (answer.type !== 'photo' && answer.type !== 'video')) return;

    const isOwner = answer.isOwnAnswer;
    const hasAlreadyViewed = answer.hasViewedMedia;

    // Owner can always view their own media
    if (isOwner) {
      setViewingMedia({
        answerId: answer._id,
        mediaUrl: answer.mediaUrl,
        mediaType: answer.type as 'photo' | 'video',
        isOwnAnswer: true,
        isFrontCamera: answer.isFrontCamera,
      });
      return;
    }

    // Non-owner: check if already viewed (one-time view)
    if (hasAlreadyViewed) {
      Alert.alert('Already Viewed', 'This media can only be viewed once.');
      return;
    }

    try {
      // Claim the view before showing
      await claimAnswerMediaView({
        answerId: answer._id,
        viewerId: currentUserId,
      });

      // Show the media
      setViewingMedia({
        answerId: answer._id,
        mediaUrl: answer.mediaUrl,
        mediaType: answer.type as 'photo' | 'video',
        isOwnAnswer: false,
        hasViewed: false,
        isFrontCamera: answer.isFrontCamera,
      });
    } catch (error: any) {
      console.error('[T/D] Claim media view failed:', error);
      if (error.message?.includes('already viewed')) {
        Alert.alert('Already Viewed', 'This media can only be viewed once.');
      } else {
        Alert.alert('Error', 'Failed to view media. Please try again.');
      }
    }
  }, [currentUserId, claimAnswerMediaView]);

  // Handle closing the media viewer
  const handleCloseMediaViewer = useCallback(async () => {
    if (viewingMedia && !viewingMedia.isOwnAnswer && !viewingMedia.hasViewed) {
      // Finalize the view for non-owners
      try {
        await finalizeAnswerMediaView({
          answerId: viewingMedia.answerId,
          viewerId: currentUserId,
        });
        console.log('[T/D] Media view finalized');
      } catch (error) {
        console.error('[T/D] Finalize media view failed:', error);
      }
    }
    setViewingMedia(null);
  }, [viewingMedia, currentUserId, finalizeAnswerMediaView]);

  // Unified submit handler - handles text + optional media attachment
  // Uses MERGE behavior: only sends fields that changed
  const handleUnifiedSubmit = useCallback(async (params: {
    text: string;
    attachment: Attachment | null;
    removeMedia?: boolean;
    identityMode: IdentityMode;
    mediaVisibility?: 'private' | 'public';
  }) => {
    if (!promptId || !currentUserId) return;

    setIsSubmitting(true);

    try {
      const { text, attachment, removeMedia, identityMode, mediaVisibility } = params;

      console.log('[T/D BEHAVIOR] submit_pipeline_start', {
        hasText: !!text.trim(),
        hasAttachment: !!attachment,
        attachmentKind: attachment?.kind ?? 'none',
        removeMedia: !!removeMedia,
        identityMode,
        mediaVisibility: mediaVisibility ?? 'public',
      });

      const isAnon = identityMode === 'anonymous';
      const isNoPhoto = identityMode === 'no_photo';
      const photoBlurMode = isNoPhoto ? 'blur' : 'none';

      // Upload media if new attachment provided
      let mediaStorageId: string | undefined;
      let mediaMime: string | undefined;
      let durationSec: number | undefined;
      let isFrontCamera: boolean | undefined;

      if (attachment) {
        // Check if this is a remote URL (already uploaded media from existing answer)
        // Remote URLs start with http:// or https:// and should NOT be re-uploaded
        const isRemoteUrl = attachment.uri.startsWith('http://') || attachment.uri.startsWith('https://');

        if (isRemoteUrl) {
          // Media is already in storage - don't upload, don't change mediaStorageId
          console.log('[T/D UPLOAD] skip - remote URL (existing media)');
        } else {
          // Local file - upload to Convex storage
          isFrontCamera = attachment.isFrontCamera;
          mediaMime = attachment.mime;

          const mediaType = attachment.kind === 'audio' ? 'audio' : attachment.kind;
          console.log('[T/D UPLOAD] start', { type: mediaType, isFrontCamera });

          try {
            mediaStorageId = await uploadMediaToConvex(attachment.uri, generateUploadUrl, mediaType);
            const storageIdPrefix = mediaStorageId?.substring(0, 8) ?? 'none';
            console.log('[T/D UPLOAD] success', { storageIdPrefix });
          } catch (uploadError: any) {
            console.error('[T/D UPLOAD] failed', { error: uploadError?.message?.substring(0, 50) });
            throw uploadError;
          }

          if (attachment.durationMs) {
            durationSec = Math.ceil(attachment.durationMs / 1000);
          }
        }
      }

      // Create or edit the answer with MERGE behavior
      // Only send fields that are explicitly provided
      console.log('[T/D BEHAVIOR] createOrEditAnswer start', { identityMode, visibility: mediaVisibility === 'private' ? 'owner_only' : 'public' });
      await createOrEditAnswer({
        promptId,
        userId: currentUserId,
        // Text - send if provided (even empty string is valid to clear)
        text: text.trim() || undefined,
        // Media - only send if new attachment or removeMedia
        mediaStorageId: mediaStorageId as any,
        mediaMime,
        durationSec,
        removeMedia,
        // Identity - only used on first creation
        identityMode,
        isAnonymous: isAnon,
        visibility: mediaVisibility === 'private' ? 'owner_only' : 'public',
        viewMode: attachment ? 'tap' : undefined, // One-time tap to view for media
        // Author identity based on choice
        authorName: isAnon ? undefined : authorProfile.name,
        authorPhotoUrl: isAnon || isNoPhoto ? undefined : authorProfile.photoUrl,
        authorAge: isAnon ? undefined : authorProfile.age,
        authorGender: isAnon ? undefined : authorProfile.gender,
        photoBlurMode: photoBlurMode as 'none' | 'blur',
        isFrontCamera,
      });

      console.log('[T/D BEHAVIOR] createOrEditAnswer success');
      setShowUnifiedComposer(false);
      scrollToEnd();
    } catch (error: any) {
      console.error('[T/D BEHAVIOR] submit_pipeline_failed', { error: error?.message?.substring(0, 50) });
      Alert.alert('Error', error.message || 'Failed to post comment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [promptId, currentUserId, generateUploadUrl, createOrEditAnswer, authorProfile]);

  // These functions are kept for camera-composer route compatibility
  const openCamera = () => {
    router.push({
      pathname: '/(main)/camera-composer' as any,
      params: { promptId: promptId!, promptType: prompt?.type },
    });
  };

  // Gallery picker - pick photo/video from library, then show privacy sheet
  const openGallery = useCallback(async () => {
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
      const storageId = await uploadMediaToConvex(imageUri, generateUploadUrl, galleryMedia.type);

      // Default to anonymous for this legacy flow
      const identityMode: IdentityMode = 'anonymous';
      const isAnon = true;

      await createOrEditAnswer({
        promptId,
        userId: currentUserId,
        mediaStorageId: storageId,
        mediaMime: galleryMedia.type === 'video' ? 'video/mp4' : 'image/jpeg',
        durationSec: galleryMedia.durationSec,
        identityMode,
        isAnonymous: isAnon,
        visibility: 'public',
        viewMode: options.viewingMode,
        viewDurationSec: options.timer > 0 ? options.timer : undefined,
      });

      // Clear gallery media state and close sheet
      setGalleryMedia(null);
      scrollToEnd();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to post media comment. Please try again.');
    } finally {
      setIsSubmittingMedia(false);
    }
  }, [promptId, currentUserId, galleryMedia, generateUploadUrl, createOrEditAnswer]);

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
          {/* Avatar: Anonymous icon OR photo (if public) OR placeholder (no_photo/blur) */}
          {isAnon ? (
            <View style={styles.answerAvatarAnon}>
              <Ionicons name="eye-off" size={16} color={C.textLight} />
            </View>
          ) : authorPhotoUrl && photoBlurMode !== 'blur' ? (
            <Image
              source={{ uri: authorPhotoUrl }}
              style={styles.answerAvatar}
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

        {/* Content: ALWAYS show text first (if exists), then media below */}
        {item.text && item.text.trim().length > 0 && (
          <Text style={styles.answerText}>{item.text}</Text>
        )}

        {/* Voice media */}
        {item.type === 'voice' && item.mediaUrl && (
          <TodVoicePlayer
            answerId={item._id}
            audioUrl={item.mediaUrl}
            durationSec={item.durationSec || 0}
          />
        )}

        {/* Photo/Video media */}
        {(item.type === 'photo' || item.type === 'video') && item.mediaUrl && (
          <TouchableOpacity
            style={styles.mediaContainer}
            onPress={() => handleViewMedia(item)}
            activeOpacity={0.7}
          >
            <View style={[
              styles.mediaBadge,
              item.hasViewedMedia && !isOwnAnswer && styles.mediaBadgeViewed,
            ]}>
              <Ionicons
                name={item.type === 'video' ? 'videocam' : 'image'}
                size={20}
                color={item.hasViewedMedia && !isOwnAnswer ? C.textLight : C.primary}
              />
              <Text style={[
                styles.mediaBadgeText,
                item.hasViewedMedia && !isOwnAnswer && styles.mediaBadgeTextViewed,
              ]}>
                {item.type === 'video' ? 'Video' : 'Photo'}
              </Text>
              <Text style={[
                styles.mediaViewMode,
                item.hasViewedMedia && !isOwnAnswer && { color: C.textLight },
              ]}>
                {item.hasViewedMedia && !isOwnAnswer ? 'Viewed' : 'Tap to view'}
              </Text>
            </View>
          </TouchableOpacity>
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

          {/* Own comment: Edit + button + Delete */}
          {isOwnAnswer ? (
            <View style={styles.ownCommentActions}>
              {/* Direct edit button - opens composer immediately */}
              <TouchableOpacity
                style={styles.inlineAddBtn}
                onPress={() => setShowUnifiedComposer(true)}
              >
                <Ionicons name="add" size={24} color={C.primary} />
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

      {/* FAB (only if not expired and hasn't commented) - opens unified composer */}
      {!isExpired && !myAnswer && (
        <View style={[styles.commentFab, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
          <TouchableOpacity
            style={styles.fabBtn}
            onPress={() => setShowUnifiedComposer(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}


      {/* Unified Answer Composer - text + optional media */}
      <UnifiedAnswerComposer
        visible={showUnifiedComposer}
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
        initialAttachment={myAnswer?.mediaUrl ? {
          kind: myAnswer.type === 'voice' ? 'audio' : (myAnswer.type === 'video' ? 'video' : 'photo'),
          uri: myAnswer.mediaUrl,
          durationMs: myAnswer.durationSec ? myAnswer.durationSec * 1000 : undefined,
        } as Attachment : null}
        existingIdentityMode={myAnswer?.identityMode as IdentityMode | undefined}
        isNewAnswer={!myAnswer}
        onClose={() => setShowUnifiedComposer(false)}
        onSubmit={handleUnifiedSubmit}
        isSubmitting={isSubmitting}
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

      {/* Media Viewer Modal - Tap to view */}
      <Modal
        visible={!!viewingMedia}
        transparent
        animationType="fade"
        onRequestClose={handleCloseMediaViewer}
      >
        <View style={styles.mediaViewerOverlay}>
          <TouchableOpacity
            style={styles.mediaViewerClose}
            onPress={handleCloseMediaViewer}
          >
            <Ionicons name="close" size={28} color="#FFF" />
          </TouchableOpacity>

          {viewingMedia?.mediaType === 'photo' && (
            <Image
              source={{ uri: viewingMedia.mediaUrl }}
              style={[
                styles.mediaViewerImage,
                viewingMedia.isFrontCamera && styles.unmirrorMedia,
              ]}
              contentFit="contain"
            />
          )}

          {viewingMedia?.mediaType === 'video' && (
            <Video
              source={{ uri: viewingMedia.mediaUrl }}
              style={[
                styles.mediaViewerVideo,
                viewingMedia.isFrontCamera && styles.unmirrorMedia,
              ]}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              useNativeControls
              isLooping={false}
            />
          )}

          {!viewingMedia?.isOwnAnswer && (
            <View style={styles.mediaViewerHint}>
              <Ionicons name="eye-outline" size={14} color="#FFF" />
              <Text style={styles.mediaViewerHintText}>
                One-time view — this will disappear when you close
              </Text>
            </View>
          )}
        </View>
      </Modal>
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

  // Media badge viewed state
  mediaBadgeViewed: {
    backgroundColor: C.surface + '80',
    borderWidth: 1,
    borderColor: C.textLight + '30',
  },
  mediaBadgeTextViewed: {
    color: C.textLight,
  },

  // Media viewer modal
  mediaViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaViewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  mediaViewerImage: {
    width: '100%',
    height: '80%',
  },
  mediaViewerVideo: {
    width: '100%',
    height: '80%',
  },
  unmirrorMedia: {
    transform: [{ scaleX: -1 }],
  },
  mediaViewerHint: {
    position: 'absolute',
    bottom: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  mediaViewerHintText: {
    fontSize: 13,
    color: '#FFF',
    fontWeight: '500',
  },
});
