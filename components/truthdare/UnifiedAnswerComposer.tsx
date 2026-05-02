/**
 * UnifiedAnswerComposer - Text + optional media attachment composer
 * Text always remains. User can optionally attach ONE media (audio/photo/video).
 * Identity mode is chosen ONCE per thread answer, then reused for all edits.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FONT_SIZE,
  INCOGNITO_COLORS,
  SPACING,
  SIZES,
  lineHeight,
  moderateScale,
} from '@/lib/constants';
import { InAppMediaCamera, MediaCaptureResult } from './InAppMediaCamera';
import type { TodPrompt } from '@/types';

const C = INCOGNITO_COLORS;
const MAX_TEXT_CHARS = 400;
const MAX_AUDIO_SEC = 60;
const TEXT_MAX_SCALE = 1.2;
const HEADER_ICON_SIZE = moderateScale(22, 0.25);
const AUDIO_PREVIEW_ICON_SIZE = moderateScale(34, 0.25);
const AUDIO_REMOVE_ICON_SIZE = SIZES.icon.lg;
const MEDIA_OVERLAY_ICON_SIZE = SIZES.icon.lg;
const VIDEO_OVERLAY_ICON_SIZE = moderateScale(44, 0.25);
const LOCK_ICON_SIZE = SIZES.icon.sm;
const REMOVE_MEDIA_ICON_SIZE = moderateScale(26, 0.25);
const RECORD_STOP_ICON_SIZE = SIZES.icon.md;
const ATTACH_ICON_SIZE = moderateScale(22, 0.25);
// Media chooser accent colors (UI-only)
const MEDIA_GALLERY_COLOR = '#00B894'; // green/teal
const MEDIA_CAMERA_COLOR = '#E94560'; // pink/red
const MEDIA_VOICE_COLOR = '#FF9800'; // orange/yellow
const IDENTITY_OPTION_ICON_SIZE = SIZES.icon.sm;
const VISIBILITY_ICON_SIZE = SIZES.icon.xs;
const FOOTER_ICON_SIZE = SIZES.icon.xs;
const SUBMIT_ICON_SIZE = moderateScale(18, 0.25);
const FULLSCREEN_CLOSE_ICON_SIZE = moderateScale(26, 0.25);
const CONFIRM_ICON_SIZE = SIZES.icon.xl;
const SHEET_RADIUS = moderateScale(20, 0.25);
const MODAL_RADIUS = moderateScale(16, 0.25);

// P2-001: Media file size limits (in bytes)
const MAX_PHOTO_SIZE_MB = 10;
const MAX_VIDEO_SIZE_MB = 50;
const MAX_AUDIO_SIZE_MB = 5;
const MAX_PHOTO_SIZE = MAX_PHOTO_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_SIZE = MAX_VIDEO_SIZE_MB * 1024 * 1024;
const MAX_AUDIO_SIZE = MAX_AUDIO_SIZE_MB * 1024 * 1024;

const debugTodLog = (...args: unknown[]) => {
  if (__DEV__) {
    console.log(...args);
  }
};

const debugTodWarn = (...args: unknown[]) => {
  if (__DEV__) {
    console.warn(...args);
  }
};

// Identity modes matching backend
export type IdentityMode = 'anonymous' | 'no_photo' | 'profile';

// Attachment types
export interface Attachment {
  kind: 'audio' | 'photo' | 'video';
  uri: string;
  mime?: string;
  durationMs?: number;
  isFrontCamera?: boolean;
}

interface UnifiedAnswerComposerProps {
  visible: boolean;
  prompt: TodPrompt | null;
  /** Initial text for editing */
  initialText?: string;
  /** Initial attachment for editing (existing media) */
  initialAttachment?: Attachment | null;
  /** Existing identity mode (if answer already exists) */
  existingIdentityMode?: IdentityMode;
  /** Whether this is a new answer (show identity picker) or edit (hide picker) */
  isNewAnswer: boolean;
  /** VISUAL MEDIA LOCK: If true, photo/video has been viewed and cannot be replaced/removed */
  visualMediaLocked?: boolean;
  onClose: () => void;
  /** Called when user submits */
  onSubmit: (params: {
    text: string;
    attachment: Attachment | null;
    removeMedia?: boolean;
    identityMode: IdentityMode;
    mediaVisibility?: 'private' | 'public';
  }) => Promise<void>;
  isSubmitting?: boolean;
}

export function UnifiedAnswerComposer({
  visible,
  prompt,
  initialText,
  initialAttachment,
  existingIdentityMode,
  isNewAnswer,
  visualMediaLocked,
  onClose,
  onSubmit,
  isSubmitting,
}: UnifiedAnswerComposerProps) {
  const insets = useSafeAreaInsets();

  // Text state
  const [text, setText] = useState(initialText || '');

  // Attachment state
  const [attachment, setAttachment] = useState<Attachment | null>(initialAttachment || null);
  const [mediaRemoved, setMediaRemoved] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  // Identity state - default to anonymous for new, use existing for edits
  const [identityMode, setIdentityMode] = useState<IdentityMode>(
    existingIdentityMode ?? 'anonymous'
  );

  // Media visibility state - only applies to photo/video, default private
  const [mediaVisibility, setMediaVisibility] = useState<'private' | 'public'>('private');

  // UI-only: tracks last tapped media tile so the helper line under the row can
  // show a short context message. Does NOT affect upload / capture / recording.
  const [lastMediaIntent, setLastMediaIntent] = useState<'gallery' | 'camera' | 'voice' | null>(null);

  // Fullscreen media preview state (includes isFrontCamera for unmirror)
  const [fullscreenMedia, setFullscreenMedia] = useState<{
    uri: string;
    type: 'photo' | 'video';
    isFrontCamera?: boolean;
  } | null>(null);

  // In-app media camera state (unified photo+video)
  const [showMediaCamera, setShowMediaCamera] = useState(false);

  // P1-001: Media confirmation modal state
  const [showMediaConfirmModal, setShowMediaConfirmModal] = useState(false);

  // Refs
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTriggeredRef = useRef(false);
  // M-007 FIX: Track latest recordSeconds to avoid stale closure
  const recordSecondsRef = useRef(0);

  // Extract prompt type for stable dependency (avoids fragile optional chaining in dep array)
  const promptType = prompt?.type ?? null;

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setText(initialText || '');
      setAttachment(initialAttachment || null);
      setMediaRemoved(false);
      setIsRecording(false);
      setRecordSeconds(0);
      setIsPlayingPreview(false);
      setIdentityMode(existingIdentityMode ?? 'anonymous');
      setMediaVisibility('private');
      setFullscreenMedia(null);
      setShowMediaCamera(false);
      debugTodLog('[T/D COMPOSER] open', {
        mode: promptType,
        hasExistingAnswer: !!initialText || !!initialAttachment,
        attachmentKind: initialAttachment?.kind ?? 'none',
        identityMode: existingIdentityMode ?? 'anonymous',
        mediaVisibility: 'private',
        hasText: !!(initialText && initialText.length > 0),
      });
    }
  }, [visible, initialText, initialAttachment, existingIdentityMode, promptType]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Recording timer - just increment, no side effects
  useEffect(() => {
    if (isRecording) {
      autoStopTriggeredRef.current = false; // Reset guard when recording starts
      recordSecondsRef.current = 0; // M-007 FIX: Reset ref when recording starts
      intervalRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          const newVal = s + 1;
          recordSecondsRef.current = newVal; // M-007 FIX: Keep ref in sync
          return newVal;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRecording]);

  // Auto-stop at max duration - separate effect to avoid side effects in state setter
  useEffect(() => {
    if (isRecording && recordSeconds >= MAX_AUDIO_SEC && !autoStopTriggeredRef.current) {
      autoStopTriggeredRef.current = true;
      stopRecording();
    }
  }, [isRecording, recordSeconds]);

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow microphone access to record voice messages.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
      setRecordSeconds(0);
    } catch (error) {
      console.error('[T/D Composer] Start recording error:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      setIsRecording(false);

      // M-007 FIX: Use ref for latest duration to avoid stale closure
      const finalSeconds = recordSecondsRef.current;
      if (uri && finalSeconds > 0) {
        // P2-001: Validate audio file size before attaching
        const fileSize = await getFileSizeBytes(uri);
        if (!validateMediaSize(fileSize, 'audio')) {
          debugTodLog(`[T/D Composer] Voice recording rejected: size ${fileSize} exceeds limit`);
          return; // Size validation failed, don't attach
        }

        setAttachment({
          kind: 'audio',
          uri,
          mime: 'audio/mp4',
          durationMs: finalSeconds * 1000,
        });
        setMediaRemoved(false);
        debugTodLog(`[T/D Composer] Voice recorded: ${finalSeconds}s, size: ${fileSize}`);
      }
    } catch (error) {
      console.error('[T/D Composer] Stop recording error:', error);
      setIsRecording(false);
    }
  };

  const playAudioPreview = async () => {
    if (!attachment || attachment.kind !== 'audio') return;

    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
        setIsPlayingPreview(false);
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: attachment.uri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlayingPreview(false);
            soundRef.current?.unloadAsync();
            soundRef.current = null;
          }
        }
      );

      soundRef.current = sound;
      setIsPlayingPreview(true);
    } catch (error) {
      console.error('[T/D Composer] Playback error:', error);
      setIsPlayingPreview(false);
    }
  };

  // P2-001: Helper to get file size and validate
  const getFileSizeBytes = async (uri: string): Promise<number | null> => {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && 'size' in info) {
        return info.size;
      }
      return null;
    } catch {
      return null;
    }
  };

  // P2-001: Validate file size before attaching
  const validateMediaSize = (sizeBytes: number | null | undefined, kind: 'photo' | 'video' | 'audio'): boolean => {
    if (sizeBytes === null || sizeBytes === undefined) {
      // Can't determine size, allow it but log warning
      debugTodWarn('[T/D COMPOSER] Could not determine file size, allowing upload');
      return true;
    }

    const limits = {
      photo: { max: MAX_PHOTO_SIZE, label: `${MAX_PHOTO_SIZE_MB}MB` },
      video: { max: MAX_VIDEO_SIZE, label: `${MAX_VIDEO_SIZE_MB}MB` },
      audio: { max: MAX_AUDIO_SIZE, label: `${MAX_AUDIO_SIZE_MB}MB` },
    };

    const limit = limits[kind];
    if (sizeBytes > limit.max) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
      Alert.alert(
        'File Too Large',
        `This ${kind} is ${sizeMB}MB, which exceeds the ${limit.label} limit. Please choose a smaller file.`
      );
      return false;
    }
    return true;
  };

  // Gallery picker - picks both photos and videos
  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 60,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      const kind = isVideo ? 'video' : 'photo';

      // P2-001: Validate file size before attaching
      // Use asset.fileSize if available, otherwise fetch it
      let fileSize = asset.fileSize;
      if (fileSize === undefined || fileSize === null) {
        fileSize = await getFileSizeBytes(asset.uri) ?? undefined;
      }

      if (!validateMediaSize(fileSize, kind)) {
        return; // Size validation failed, don't attach
      }

      const mime = isVideo ? 'video/mp4' : 'image/jpeg';
      const durationMs = asset.duration ? Math.round(asset.duration) : undefined;

      setAttachment({
        kind,
        uri: asset.uri,
        mime,
        durationMs,
        isFrontCamera: false, // Gallery picks are not from front camera
      });
      setMediaRemoved(false);
      // Extract URI prefix for logging (handle indexOf returning -1)
      const slashIdx = asset.uri.indexOf('/', 8);
      const uriPrefix = slashIdx === -1
        ? asset.uri.substring(0, Math.min(15, asset.uri.length))
        : asset.uri.substring(0, Math.min(20, slashIdx + 1));
      debugTodLog('[T/D COMPOSER] gallery_pick', {
        kind,
        uriPrefix,
        fileSize,
        durationMs,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to pick media. Please try again.');
    }
  };

  // Open unified in-app camera (photo + video modes)
  const openMediaCamera = useCallback(() => {
    setShowMediaCamera(true);
  }, []);

  // Handle media captured from in-app camera
  const handleMediaCaptured = useCallback(async (result: MediaCaptureResult) => {
    setShowMediaCamera(false);

    // P2-001: Validate file size before attaching
    const fileSize = await getFileSizeBytes(result.uri);
    if (!validateMediaSize(fileSize, result.kind)) {
      return; // Size validation failed, don't attach
    }

    setAttachment({
      kind: result.kind,
      uri: result.uri,
      mime: result.kind === 'video' ? 'video/mp4' : 'image/jpeg',
      durationMs: result.durationMs,
      isFrontCamera: result.isFrontCamera,
    });
    setMediaRemoved(false);
    const uriPrefix = result.uri.startsWith('file://') ? 'file://' : result.uri.substring(0, 10);
    debugTodLog('[T/D COMPOSER] camera_capture', {
      kind: result.kind,
      isFrontCamera: result.isFrontCamera,
      uriPrefix,
      durationMs: result.durationMs,
      fileSize,
    });
  }, []);

  const removeAttachment = () => {
    // VISUAL MEDIA LOCK: Don't allow removing locked photo/video
    if (visualMediaLocked && attachment && (attachment.kind === 'photo' || attachment.kind === 'video')) {
      Alert.alert(
        'Media Locked',
        'This photo/video has been viewed and cannot be removed. You can still edit text or add audio.'
      );
      return;
    }

    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setAttachment(null);
    setMediaRemoved(true);
    setIsPlayingPreview(false);
  };

  const handleClose = useCallback(() => {
    // Stop any ongoing recording/playback
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsRecording(false);
    setIsPlayingPreview(false);
    debugTodLog('[T/D COMPOSER] close', { hadAttachment: !!attachment, hadText: text.trim().length > 0 });
    onClose();
  }, [onClose, attachment, text]);

  // P1-001: Actual submit logic (extracted for reuse)
  // P1-005 FIX: Include voice messages in visibility handling
  const executeSubmit = useCallback(async () => {
    const trimmedText = text.trim();
    const hasMedia = !!attachment;

    debugTodLog('[T/D COMPOSER] submit_execute', {
      attachmentKind: attachment?.kind ?? 'none',
      identityMode,
      mediaVisibility: hasMedia ? mediaVisibility : 'n/a',
    });

    await onSubmit({
      text: trimmedText,
      attachment,
      removeMedia: mediaRemoved && !attachment,
      identityMode,
      mediaVisibility: hasMedia ? mediaVisibility : undefined,
    });
  }, [text, attachment, mediaRemoved, identityMode, mediaVisibility, onSubmit]);

  const handleSubmit = useCallback(async () => {
    // Validate: text is MANDATORY, media is optional
    const trimmedText = text.trim();
    const hasText = trimmedText.length >= 1;
    const hasAttachment = !!attachment;

    // P1-005 FIX: Track all media types for visibility
    const hasPhotoOrVideo = attachment && (attachment.kind === 'photo' || attachment.kind === 'video');

    debugTodLog('[T/D COMPOSER] submit_start', {
      hasText,
      hasAttachment,
      attachmentKind: attachment?.kind ?? 'none',
      identityMode,
      mediaVisibility: hasAttachment ? mediaVisibility : 'n/a',
      removeMedia: false,
    });

    if (!hasText) {
      Alert.alert('Text Required', 'Please add some text to your answer.');
      return;
    }

    // P1-001: Show confirmation modal for photo/video before submitting
    // Voice messages skip confirmation but still use visibility setting
    if (hasPhotoOrVideo) {
      setShowMediaConfirmModal(true);
      return;
    }

    // No photo/video (including voice) - submit directly
    await executeSubmit();
  }, [text, attachment, identityMode, mediaVisibility, executeSubmit]);

  // P1-001: Handle media confirmation
  const handleMediaConfirmSend = useCallback(async () => {
    setShowMediaConfirmModal(false);
    await executeSubmit();
  }, [executeSubmit]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!prompt) return null;

  const isTruth = prompt.type === 'truth';
  // Text is MANDATORY (media is optional)
  const canSubmit = text.trim().length >= 1 && !isSubmitting && !isRecording;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SPACING.base) + SPACING.base }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.badgeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
            </View>
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.promptPreview} numberOfLines={1}>{prompt.text}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={HEADER_ICON_SIZE} color={C.textLight} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            {/* Text Input */}
            <TextInput
              style={styles.textInput}
              placeholder="Write your answer..."
              placeholderTextColor={C.textLight}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={MAX_TEXT_CHARS}
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              autoComplete="off"
              textContentType="none"
              importantForAutofill="noExcludeDescendants"
            />
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.charCount}>{text.length}/{MAX_TEXT_CHARS}</Text>

            {/* Attachment Preview */}
            {attachment && (
              <View style={styles.attachmentPreview}>
                {attachment.kind === 'audio' && (
                  <View style={styles.audioPreview}>
                    <TouchableOpacity onPress={playAudioPreview} style={styles.audioPlayBtn}>
                      <Ionicons
                        name={isPlayingPreview ? 'pause-circle' : 'play-circle'}
                        size={AUDIO_PREVIEW_ICON_SIZE}
                        color={C.primary}
                      />
                    </TouchableOpacity>
                    <View style={styles.audioWaveform}>
                      {Array.from({ length: 12 }).map((_, i) => (
                        <View
                          key={i}
                          style={[styles.audioBar, { height: moderateScale(6 + (i % 4) * 5, 0.3) }]}
                        />
                      ))}
                    </View>
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.audioDuration}>
                      {formatTime(Math.ceil((attachment.durationMs || 0) / 1000))}
                    </Text>
                    <TouchableOpacity onPress={removeAttachment} style={styles.removeBtn}>
                      <Ionicons name="close-circle" size={AUDIO_REMOVE_ICON_SIZE} color={C.textLight} />
                    </TouchableOpacity>
                  </View>
                )}

                {attachment.kind === 'photo' && (() => {
                  const shouldUnmirror = attachment.isFrontCamera === true;
                  // P3-004: Gate noisy render-time log with __DEV__
                  debugTodLog(`[T/D Composer] previewRender kind=photo isFrontCamera=${attachment.isFrontCamera} applyUnmirror=${shouldUnmirror}`);
                  return (
                    <TouchableOpacity
                      style={styles.mediaPreview}
                      onPress={() => setFullscreenMedia({ uri: attachment.uri, type: 'photo', isFrontCamera: attachment.isFrontCamera })}
                      activeOpacity={0.8}
                    >
                      <Image source={{ uri: attachment.uri }} style={[styles.mediaThumbnail, shouldUnmirror && styles.unmirrorMedia]} />
                      <View style={styles.mediaOverlay}>
                        <Ionicons name="expand-outline" size={MEDIA_OVERLAY_ICON_SIZE} color="#FFF" />
                        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaLabel}>Tap to preview</Text>
                      </View>
                      {/* VISUAL MEDIA LOCK: Show lock icon instead of remove when locked */}
                      {visualMediaLocked ? (
                        <View style={styles.lockedMediaBadge}>
                          <Ionicons name="lock-closed" size={LOCK_ICON_SIZE} color="#FFF" />
                        </View>
                      ) : (
                        <TouchableOpacity onPress={removeAttachment} style={styles.removeMediaBtn}>
                          <Ionicons name="close-circle" size={REMOVE_MEDIA_ICON_SIZE} color="#FFF" />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })()}

                {attachment.kind === 'video' && (() => {
                  const shouldUnmirror = attachment.isFrontCamera === true;
                  // P3-004: Gate noisy render-time log with __DEV__
                  debugTodLog(`[T/D Composer] previewRender kind=video isFrontCamera=${attachment.isFrontCamera} applyUnmirror=${shouldUnmirror}`);
                  return (
                    <TouchableOpacity
                      style={styles.mediaPreview}
                      onPress={() => setFullscreenMedia({ uri: attachment.uri, type: 'video', isFrontCamera: attachment.isFrontCamera })}
                      activeOpacity={0.8}
                    >
                      <Video
                        source={{ uri: attachment.uri }}
                        style={[styles.mediaThumbnail, shouldUnmirror && styles.unmirrorMedia]}
                        resizeMode={ResizeMode.COVER}
                        shouldPlay={false}
                        isMuted
                      />
                      <View style={styles.mediaOverlay}>
                        <Ionicons name="play-circle" size={VIDEO_OVERLAY_ICON_SIZE} color="#FFF" />
                        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaLabel}>Tap to preview</Text>
                      </View>
                      {/* VISUAL MEDIA LOCK: Show lock icon instead of remove when locked */}
                      {visualMediaLocked ? (
                        <View style={styles.lockedMediaBadge}>
                          <Ionicons name="lock-closed" size={LOCK_ICON_SIZE} color="#FFF" />
                        </View>
                      ) : (
                        <TouchableOpacity onPress={removeAttachment} style={styles.removeMediaBtn}>
                          <Ionicons name="close-circle" size={REMOVE_MEDIA_ICON_SIZE} color="#FFF" />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })()}
              </View>
            )}

            {/* Recording indicator */}
            {isRecording && (
              <View style={styles.recordingIndicator}>
                <View style={styles.recordingDot} />
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.recordingText}>Recording... {formatTime(recordSeconds)}</Text>
                <TouchableOpacity onPress={stopRecording} style={styles.stopRecordBtn}>
                  <Ionicons name="stop" size={RECORD_STOP_ICON_SIZE} color="#FFF" />
                </TouchableOpacity>
              </View>
            )}

            {/* VISUAL MEDIA LOCK: Warning when photo/video is locked */}
            {visualMediaLocked && attachment && (attachment.kind === 'photo' || attachment.kind === 'video') && (
              <View style={styles.mediaLockedWarning}>
                <Ionicons name="lock-closed" size={LOCK_ICON_SIZE} color="#F59E0B" />
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaLockedText}>
                  Photo/video already viewed and locked. You can still edit text or audio.
                </Text>
              </View>
            )}

            {/* Attachment buttons */}
            {/* Media chooser: colorful tiles + dynamic helper line below (UI-only state) */}
            {!attachment && !isRecording && (
              <View style={styles.attachmentBlock}>
                <View style={styles.attachmentButtons}>
                  {/* VISUAL MEDIA LOCK: Hide Gallery/Camera when visual media is locked */}
                  {!visualMediaLocked && (
                    <>
                      <TouchableOpacity
                        style={[styles.attachBtn, styles.attachBtnGallery]}
                        onPress={() => { setLastMediaIntent('gallery'); pickFromGallery(); }}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="images" size={ATTACH_ICON_SIZE} color={MEDIA_GALLERY_COLOR} />
                        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.attachBtnText}>Gallery</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.attachBtn, styles.attachBtnCamera]}
                        onPress={() => { setLastMediaIntent('camera'); openMediaCamera(); }}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="camera" size={ATTACH_ICON_SIZE} color={MEDIA_CAMERA_COLOR} />
                        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.attachBtnText}>Camera</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity
                    style={[styles.attachBtn, styles.attachBtnVoice]}
                    onPress={() => { setLastMediaIntent('voice'); startRecording(); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="mic" size={ATTACH_ICON_SIZE} color={MEDIA_VOICE_COLOR} />
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.attachBtnText}>Voice</Text>
                  </TouchableOpacity>
                </View>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.attachmentHelperText}>
                  {lastMediaIntent === 'gallery'
                    ? 'Choose a photo or video from your gallery.'
                    : lastMediaIntent === 'camera'
                    ? 'Take a photo or record a short video.'
                    : lastMediaIntent === 'voice'
                    ? 'Record a voice reply up to 60 seconds.'
                    : 'Optional: add a photo, video, or voice.'}
                </Text>
              </View>
            )}

            {/* Identity Picker - only show for new answers */}
            {/* Identity Correction: side-by-side compact tiles with dynamic description below */}
            {/* Backend values unchanged: anonymous / no_photo / profile */}
            {isNewAnswer && (
              <View style={styles.identitySection}>
                <View style={styles.identityHeader}>
                  <View style={styles.identityHeaderText}>
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.identityTitle}>Reply as</Text>
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.identitySubtitle}>Choose how they'll see you</Text>
                  </View>
                </View>
                <View style={styles.identityTilesRow}>
                  {/* Anonymous (DEFAULT) */}
                  <TouchableOpacity
                    style={[styles.identityTile, identityMode === 'anonymous' && styles.identityTileActive]}
                    onPress={() => setIdentityMode('anonymous')}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="eye-off"
                      size={IDENTITY_OPTION_ICON_SIZE}
                      color={identityMode === 'anonymous' ? C.primary : C.textLight}
                    />
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      numberOfLines={1}
                      style={[styles.identityTileLabel, identityMode === 'anonymous' && styles.identityTileLabelActive]}
                    >
                      Anonymous
                    </Text>
                  </TouchableOpacity>

                  {/* Blur photo (no_photo) */}
                  <TouchableOpacity
                    style={[styles.identityTile, identityMode === 'no_photo' && styles.identityTileActive]}
                    onPress={() => setIdentityMode('no_photo')}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="image-outline"
                      size={IDENTITY_OPTION_ICON_SIZE}
                      color={identityMode === 'no_photo' ? C.primary : C.textLight}
                    />
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      numberOfLines={1}
                      style={[styles.identityTileLabel, identityMode === 'no_photo' && styles.identityTileLabelActive]}
                    >
                      Blur photo
                    </Text>
                  </TouchableOpacity>

                  {/* Full profile */}
                  <TouchableOpacity
                    style={[styles.identityTile, identityMode === 'profile' && styles.identityTileActive]}
                    onPress={() => setIdentityMode('profile')}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="person"
                      size={IDENTITY_OPTION_ICON_SIZE}
                      color={identityMode === 'profile' ? C.primary : C.textLight}
                    />
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      numberOfLines={1}
                      style={[styles.identityTileLabel, identityMode === 'profile' && styles.identityTileLabelActive]}
                    >
                      Full profile
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.identityDescription}>
                  {identityMode === 'anonymous'
                    ? 'No name, no photo'
                    : identityMode === 'no_photo'
                    ? 'They see your name; photo is blurred'
                    : 'Name, age, and clear photo'}
                </Text>
              </View>
            )}

            {/* Batch B: Media Visibility Selector — own card, sibling of identity card */}
            {/* Same gating as before: only when this is a new answer AND an attachment is present */}
            {/* P1-005 FIX: Include voice messages in visibility options */}
            {/* P1-002 FIX: Clearer labels with icons */}
            {isNewAnswer && attachment && (
              <View style={styles.visibilitySection}>
                <View style={styles.visibilityHeader}>
                  <Ionicons name="eye-outline" size={VISIBILITY_ICON_SIZE} color={C.textLight} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.visibilityTitle}>Who can view your {attachment.kind === 'audio' ? 'voice message' : attachment.kind}?</Text>
                </View>
                <View style={styles.visibilitySegmented}>
                  <TouchableOpacity
                    style={[
                      styles.segmentBtn,
                      mediaVisibility === 'private' && styles.segmentBtnActive,
                    ]}
                    onPress={() => setMediaVisibility('private')}
                  >
                    <Ionicons
                      name="lock-closed"
                      size={VISIBILITY_ICON_SIZE}
                      color={mediaVisibility === 'private' ? '#FFF' : C.textLight}
                      style={styles.segmentIcon}
                    />
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[
                      styles.segmentBtnText,
                      mediaVisibility === 'private' && styles.segmentBtnTextActive,
                    ]}>Just them</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.segmentBtn,
                      mediaVisibility === 'public' && styles.segmentBtnActive,
                    ]}
                    onPress={() => setMediaVisibility('public')}
                  >
                    <Ionicons
                      name="people"
                      size={VISIBILITY_ICON_SIZE}
                      color={mediaVisibility === 'public' ? '#FFF' : C.textLight}
                      style={styles.segmentIcon}
                    />
                    <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[
                      styles.segmentBtnText,
                      mediaVisibility === 'public' && styles.segmentBtnTextActive,
                    ]}>Everyone</Text>
                  </TouchableOpacity>
                </View>
                <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.visibilityHelperText}>
                  {mediaVisibility === 'private'
                    ? 'Only the prompt creator can view this'
                    : 'Anyone viewing this thread can see it'}
                </Text>
              </View>
            )}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={styles.viewModeHint}>
              <Ionicons name="eye-outline" size={FOOTER_ICON_SIZE} color={C.textLight} />
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.viewModeText}>Tap to view</Text>
            </View>
            <TouchableOpacity
              style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="send" size={SUBMIT_ICON_SIZE} color="#FFF" />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.submitText}>Post</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Fullscreen Media Preview Modal */}
        <Modal
          visible={!!fullscreenMedia}
          transparent
          animationType="fade"
          onRequestClose={() => setFullscreenMedia(null)}
        >
          <View style={styles.fullscreenOverlay}>
            <TouchableOpacity
              style={[styles.fullscreenClose, { top: insets.top + SPACING.md }]}
              onPress={() => setFullscreenMedia(null)}
            >
              <Ionicons name="close" size={FULLSCREEN_CLOSE_ICON_SIZE} color="#FFF" />
            </TouchableOpacity>

            {fullscreenMedia?.type === 'photo' && (() => {
              const shouldUnmirror = fullscreenMedia.isFrontCamera === true;
              return (
                <Image
                  source={{ uri: fullscreenMedia.uri }}
                  style={[styles.fullscreenMedia, shouldUnmirror && styles.unmirrorMedia]}
                  contentFit="contain"
                />
              );
            })()}

            {fullscreenMedia?.type === 'video' && (() => {
              const shouldUnmirror = fullscreenMedia.isFrontCamera === true;
              return (
                <Video
                  source={{ uri: fullscreenMedia.uri }}
                  style={[styles.fullscreenMedia, shouldUnmirror && styles.unmirrorMedia]}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay
                  useNativeControls
                  isLooping={false}
                />
              );
            })()}
          </View>
        </Modal>

        {/* In-App Media Camera (Photo + Video) */}
        <InAppMediaCamera
          visible={showMediaCamera}
          onClose={() => setShowMediaCamera(false)}
          onMediaCaptured={handleMediaCaptured}
        />

        {/* P1-001: Media Confirmation Modal - Shows visibility choice clearly */}
        <Modal
          visible={showMediaConfirmModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowMediaConfirmModal(false)}
        >
          <View style={styles.mediaConfirmOverlay}>
            <View style={styles.mediaConfirmSheet}>
              <View style={styles.mediaConfirmHeader}>
                <Ionicons
                  name={mediaVisibility === 'private' ? 'lock-closed' : 'people'}
                  size={CONFIRM_ICON_SIZE}
                  color={mediaVisibility === 'private' ? '#00B894' : '#E94560'}
                />
              </View>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaConfirmTitle}>
                {mediaVisibility === 'private' ? 'Send to prompt creator?' : 'Share with everyone?'}
              </Text>
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaConfirmMessage}>
                {mediaVisibility === 'private'
                  ? 'Only the prompt creator will be able to view your media. They can view it once.'
                  : 'Anyone viewing this thread will be able to see your media. Each person can view it once.'}
              </Text>
              <View style={styles.mediaConfirmButtons}>
                <TouchableOpacity
                  style={styles.mediaConfirmCancelBtn}
                  onPress={() => setShowMediaConfirmModal(false)}
                >
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaConfirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.mediaConfirmSendBtn,
                    mediaVisibility === 'private' && styles.mediaConfirmSendBtnPrivate,
                  ]}
                  onPress={handleMediaConfirmSend}
                >
                  <Ionicons name="send" size={SIZES.icon.sm} color="#FFF" style={{ marginRight: SPACING.sm - 2 }} />
                  <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.mediaConfirmSendText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + SPACING.xs,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.base,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  badge: { paddingHorizontal: moderateScale(10, 0.35), paddingVertical: SPACING.xs, borderRadius: SIZES.radius.md },
  badgeText: { fontSize: FONT_SIZE.xs, lineHeight: lineHeight(FONT_SIZE.xs, 1.2), fontWeight: '700', color: '#FFF' },
  promptPreview: { flex: 1, fontSize: FONT_SIZE.body2, lineHeight: lineHeight(FONT_SIZE.body2, 1.35), color: C.textLight },

  content: { paddingHorizontal: SPACING.base, paddingVertical: SPACING.md },

  textInput: {
    backgroundColor: C.surface,
    borderRadius: SIZES.radius.md,
    padding: SPACING.md,
    fontSize: FONT_SIZE.md,
    color: C.text,
    lineHeight: lineHeight(FONT_SIZE.md, 1.35),
    minHeight: moderateScale(80, 0.25),
    textAlignVertical: 'top',
  },
  charCount: { fontSize: FONT_SIZE.sm, lineHeight: lineHeight(FONT_SIZE.sm, 1.2), color: C.textLight, textAlign: 'right', marginTop: SPACING.xxs, marginBottom: SPACING.sm },

  // Attachment preview
  attachmentPreview: { marginBottom: SPACING.sm },

  audioPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + SPACING.xs,
    backgroundColor: C.surface,
    borderRadius: moderateScale(10, 0.25),
    padding: moderateScale(10, 0.35),
  },
  audioPlayBtn: { padding: moderateScale(2, 0.25) },
  audioWaveform: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs, flex: 1 },
  audioBar: { width: moderateScale(3, 0.25), borderRadius: moderateScale(1.5, 0.25), backgroundColor: C.primary },
  audioDuration: { fontSize: FONT_SIZE.caption, lineHeight: lineHeight(FONT_SIZE.caption, 1.2), fontWeight: '600', color: C.textLight },
  removeBtn: { padding: moderateScale(2, 0.25) },

  mediaPreview: {
    height: moderateScale(100, 0.25),
    borderRadius: SIZES.radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  mediaThumbnail: { width: '100%', height: '100%' },
  // Unmirror transform for front camera media
  unmirrorMedia: { transform: [{ scaleX: -1 }] },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaLabel: { fontSize: FONT_SIZE.body2, lineHeight: lineHeight(FONT_SIZE.body2, 1.2), color: '#FFF', fontWeight: '600', marginTop: SPACING.xs },
  removeMediaBtn: { position: 'absolute', top: SPACING.sm, right: SPACING.sm },

  // VISUAL MEDIA LOCK: Locked badge and warning styles
  lockedMediaBadge: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    width: moderateScale(28, 0.25),
    height: moderateScale(28, 0.25),
    borderRadius: SIZES.radius.full,
    backgroundColor: 'rgba(245,158,11,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaLockedWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius: SIZES.radius.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: moderateScale(10, 0.35),
    marginBottom: SPACING.sm,
  },
  mediaLockedText: {
    flex: 1,
    fontSize: FONT_SIZE.caption,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: '#F59E0B',
    fontWeight: '500',
  },

  // Recording indicator
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + SPACING.xs,
    backgroundColor: '#F4433620',
    borderRadius: moderateScale(10, 0.25),
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  recordingDot: {
    width: moderateScale(12, 0.25),
    height: moderateScale(12, 0.25),
    borderRadius: SIZES.radius.full,
    backgroundColor: '#F44336',
  },
  recordingText: { flex: 1, fontSize: FONT_SIZE.body, lineHeight: lineHeight(FONT_SIZE.body, 1.2), fontWeight: '600', color: '#F44336' },
  stopRecordBtn: {
    width: moderateScale(32, 0.25),
    height: moderateScale(32, 0.25),
    borderRadius: SIZES.radius.full,
    backgroundColor: '#F44336',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Attachment buttons
  // Batch C: wrapper for helper text + tiles
  attachmentBlock: {
    marginBottom: SPACING.sm,
  },
  attachmentHelperText: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    marginTop: SPACING.sm,
    paddingHorizontal: moderateScale(2, 0.25),
    textAlign: 'center',
  },
  attachmentButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  attachBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xs,
    backgroundColor: C.surface,
    borderRadius: moderateScale(12, 0.25),
    borderWidth: 1,
    borderColor: 'transparent',
  },
  attachBtnText: { fontSize: FONT_SIZE.sm, lineHeight: lineHeight(FONT_SIZE.sm, 1.2), fontWeight: '600', color: C.text },
  // Premium colored tile variants (UI-only accents; behavior unchanged)
  attachBtnGallery: {
    backgroundColor: MEDIA_GALLERY_COLOR + '14',
    borderColor: MEDIA_GALLERY_COLOR + '33',
  },
  attachBtnCamera: {
    backgroundColor: MEDIA_CAMERA_COLOR + '14',
    borderColor: MEDIA_CAMERA_COLOR + '33',
  },
  attachBtnVoice: {
    backgroundColor: MEDIA_VOICE_COLOR + '14',
    borderColor: MEDIA_VOICE_COLOR + '33',
  },

  // Identity picker
  identitySection: {
    backgroundColor: C.surface,
    borderRadius: moderateScale(10, 0.25),
    padding: moderateScale(10, 0.35),
    marginBottom: SPACING.sm,
  },
  identityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm - 2,
    marginBottom: SPACING.sm,
  },
  // Batch A: container that stacks the new title + subtitle
  identityHeaderText: { flex: 1 },
  identityTitle: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.2),
    fontWeight: '600',
    color: C.text,
  },
  // Batch A: new subtitle under "Reply as"
  identitySubtitle: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    marginTop: moderateScale(2, 0.25),
  },
  // Identity Correction: side-by-side tiles + dynamic description
  identityTilesRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  identityTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xs,
    borderRadius: SIZES.radius.sm,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  identityTileActive: {
    backgroundColor: C.primary + '14',
    borderColor: C.primary,
  },
  identityTileLabel: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
  },
  identityTileLabelActive: {
    color: C.primary,
  },
  identityDescription: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

  // Media visibility selector (segmented control)
  // P1-002 FIX: Added header styles for clearer visibility section
  // Batch B: Now rendered as its own standalone card, sibling of the identity card.
  visibilitySection: {
    backgroundColor: C.surface,
    borderRadius: moderateScale(10, 0.25),
    padding: moderateScale(10, 0.35),
    marginBottom: SPACING.sm,
  },
  visibilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm - 2,
    marginBottom: SPACING.sm,
  },
  visibilityTitle: { fontSize: FONT_SIZE.body2, lineHeight: lineHeight(FONT_SIZE.body2, 1.2), fontWeight: '600', color: C.text, flex: 1 },
  visibilitySegmented: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: moderateScale(10, 0.35),
    borderRadius: SIZES.radius.sm,
    borderWidth: 1,
    borderColor: C.textLight + '40',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm - 2,
  },
  segmentIcon: { marginRight: moderateScale(2, 0.25) },
  segmentBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  segmentBtnText: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.2),
    fontWeight: '600',
    color: C.textLight,
  },
  segmentBtnTextActive: {
    color: '#FFF',
  },
  visibilityHelperText: {
    fontSize: FONT_SIZE.sm,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.35),
    color: C.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm - 2,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.base,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  viewModeHint: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm - 2 },
  viewModeText: { fontSize: FONT_SIZE.caption, lineHeight: lineHeight(FONT_SIZE.caption, 1.2), color: C.textLight },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm - 2,
    backgroundColor: C.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: SIZES.radius.xl,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { fontSize: FONT_SIZE.body, lineHeight: lineHeight(FONT_SIZE.body, 1.2), fontWeight: '600', color: '#FFF' },

  // Fullscreen media preview
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenClose: {
    position: 'absolute',
    right: SPACING.lg,
    width: SIZES.touchTarget,
    height: SIZES.touchTarget,
    borderRadius: SIZES.radius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  fullscreenMedia: {
    width: '100%',
    height: '80%',
  },

  // P1-001: Media confirmation modal
  mediaConfirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  mediaConfirmSheet: {
    backgroundColor: C.background,
    borderRadius: MODAL_RADIUS,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: 320,
  },
  mediaConfirmHeader: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  mediaConfirmTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
    color: C.text,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  mediaConfirmMessage: {
    fontSize: FONT_SIZE.body,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    marginBottom: SPACING.xl,
  },
  mediaConfirmButtons: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  mediaConfirmCancelBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: moderateScale(10, 0.25),
    backgroundColor: C.surface,
    alignItems: 'center',
  },
  mediaConfirmCancelText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
    color: C.text,
  },
  mediaConfirmSendBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: SPACING.md,
    borderRadius: moderateScale(10, 0.25),
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // P1-001: Green color for private/secure sends
  mediaConfirmSendBtnPrivate: {
    backgroundColor: '#00B894',
  },
  mediaConfirmSendText: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
    color: '#FFF',
  },
});
