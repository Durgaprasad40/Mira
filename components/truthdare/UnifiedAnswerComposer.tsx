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
import { INCOGNITO_COLORS } from '@/lib/constants';
import { InAppMediaCamera, MediaCaptureResult } from './InAppMediaCamera';
import type { TodPrompt } from '@/types';

const C = INCOGNITO_COLORS;
const MAX_TEXT_CHARS = 400;
const MAX_AUDIO_SEC = 60;

// P2-001: Media file size limits (in bytes)
const MAX_PHOTO_SIZE_MB = 10;
const MAX_VIDEO_SIZE_MB = 50;
const MAX_AUDIO_SIZE_MB = 5;
const MAX_PHOTO_SIZE = MAX_PHOTO_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_SIZE = MAX_VIDEO_SIZE_MB * 1024 * 1024;
const MAX_AUDIO_SIZE = MAX_AUDIO_SIZE_MB * 1024 * 1024;

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
  onClose,
  onSubmit,
  isSubmitting,
}: UnifiedAnswerComposerProps) {
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
      console.log('[T/D COMPOSER] open', {
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
          console.log(`[T/D Composer] Voice recording rejected: size ${fileSize} exceeds limit`);
          return; // Size validation failed, don't attach
        }

        setAttachment({
          kind: 'audio',
          uri,
          mime: 'audio/mp4',
          durationMs: finalSeconds * 1000,
        });
        setMediaRemoved(false);
        console.log(`[T/D Composer] Voice recorded: ${finalSeconds}s, size: ${fileSize}`);
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
      console.warn('[T/D COMPOSER] Could not determine file size, allowing upload');
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
      console.log('[T/D COMPOSER] gallery_pick', {
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
    console.log('[T/D COMPOSER] camera_capture', {
      kind: result.kind,
      isFrontCamera: result.isFrontCamera,
      uriPrefix,
      durationMs: result.durationMs,
      fileSize,
    });
  }, []);

  const removeAttachment = () => {
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
    console.log('[T/D COMPOSER] close', { hadAttachment: !!attachment, hadText: text.trim().length > 0 });
    onClose();
  }, [onClose, attachment, text]);

  // P1-001: Actual submit logic (extracted for reuse)
  // P1-005 FIX: Include voice messages in visibility handling
  const executeSubmit = useCallback(async () => {
    const trimmedText = text.trim();
    const hasMedia = !!attachment;

    console.log('[T/D COMPOSER] submit_execute', {
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

    console.log('[T/D COMPOSER] submit_start', {
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
      {/* P1-004 FIX: Add 'height' behavior for Android to prevent keyboard overlap */}
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
              <Text style={styles.badgeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
            </View>
            <Text style={styles.promptPreview} numberOfLines={1}>{prompt.text}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={22} color={C.textLight} />
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
              autoComplete="off"
              textContentType="none"
              importantForAutofill="noExcludeDescendants"
            />
            <Text style={styles.charCount}>{text.length}/{MAX_TEXT_CHARS}</Text>

            {/* Attachment Preview */}
            {attachment && (
              <View style={styles.attachmentPreview}>
                {attachment.kind === 'audio' && (
                  <View style={styles.audioPreview}>
                    <TouchableOpacity onPress={playAudioPreview} style={styles.audioPlayBtn}>
                      <Ionicons
                        name={isPlayingPreview ? 'pause-circle' : 'play-circle'}
                        size={36}
                        color={C.primary}
                      />
                    </TouchableOpacity>
                    <View style={styles.audioWaveform}>
                      {Array.from({ length: 12 }).map((_, i) => (
                        <View
                          key={i}
                          style={[styles.audioBar, { height: 6 + (i % 4) * 5 }]}
                        />
                      ))}
                    </View>
                    <Text style={styles.audioDuration}>
                      {formatTime(Math.ceil((attachment.durationMs || 0) / 1000))}
                    </Text>
                    <TouchableOpacity onPress={removeAttachment} style={styles.removeBtn}>
                      <Ionicons name="close-circle" size={24} color={C.textLight} />
                    </TouchableOpacity>
                  </View>
                )}

                {attachment.kind === 'photo' && (() => {
                  const shouldUnmirror = attachment.isFrontCamera === true;
                  // P3-004: Gate noisy render-time log with __DEV__
                  if (__DEV__) console.log(`[T/D Composer] previewRender kind=photo isFrontCamera=${attachment.isFrontCamera} applyUnmirror=${shouldUnmirror}`);
                  return (
                    <TouchableOpacity
                      style={styles.mediaPreview}
                      onPress={() => setFullscreenMedia({ uri: attachment.uri, type: 'photo', isFrontCamera: attachment.isFrontCamera })}
                      activeOpacity={0.8}
                    >
                      <Image source={{ uri: attachment.uri }} style={[styles.mediaThumbnail, shouldUnmirror && styles.unmirrorMedia]} />
                      <View style={styles.mediaOverlay}>
                        <Ionicons name="expand-outline" size={24} color="#FFF" />
                        <Text style={styles.mediaLabel}>Tap to preview</Text>
                      </View>
                      <TouchableOpacity onPress={removeAttachment} style={styles.removeMediaBtn}>
                        <Ionicons name="close-circle" size={28} color="#FFF" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })()}

                {attachment.kind === 'video' && (() => {
                  const shouldUnmirror = attachment.isFrontCamera === true;
                  // P3-004: Gate noisy render-time log with __DEV__
                  if (__DEV__) console.log(`[T/D Composer] previewRender kind=video isFrontCamera=${attachment.isFrontCamera} applyUnmirror=${shouldUnmirror}`);
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
                        <Ionicons name="play-circle" size={48} color="#FFF" />
                        <Text style={styles.mediaLabel}>Tap to preview</Text>
                      </View>
                      <TouchableOpacity onPress={removeAttachment} style={styles.removeMediaBtn}>
                        <Ionicons name="close-circle" size={28} color="#FFF" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })()}
              </View>
            )}

            {/* Recording indicator */}
            {isRecording && (
              <View style={styles.recordingIndicator}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>Recording... {formatTime(recordSeconds)}</Text>
                <TouchableOpacity onPress={stopRecording} style={styles.stopRecordBtn}>
                  <Ionicons name="stop" size={20} color="#FFF" />
                </TouchableOpacity>
              </View>
            )}

            {/* Attachment buttons */}
            {!attachment && !isRecording && (
              <View style={styles.attachmentButtons}>
                <TouchableOpacity style={styles.attachBtn} onPress={pickFromGallery}>
                  <Ionicons name="images-outline" size={22} color="#00B894" />
                  <Text style={styles.attachBtnText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.attachBtn} onPress={openMediaCamera}>
                  <Ionicons name="camera-outline" size={22} color="#E94560" />
                  <Text style={styles.attachBtnText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.attachBtn} onPress={startRecording}>
                  <Ionicons name="mic-outline" size={22} color="#FF9800" />
                  <Text style={styles.attachBtnText}>Voice</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Identity Picker - only show for new answers */}
            {/* P1-003 FIX: Simplified identity options with clearer descriptions */}
            {isNewAnswer && (
              <View style={styles.identitySection}>
                <View style={styles.identityHeader}>
                  <Ionicons name="person-outline" size={14} color={C.textLight} />
                  <Text style={styles.identityTitle}>Your identity</Text>
                </View>
                <View style={styles.identityOptions}>
                  {/* Anonymous (DEFAULT) - P1-003: Clearer description */}
                  <TouchableOpacity
                    style={[styles.identityOption, identityMode === 'anonymous' && styles.identityOptionActive]}
                    onPress={() => setIdentityMode('anonymous')}
                  >
                    <View style={styles.radioOuter}>
                      {identityMode === 'anonymous' && <View style={styles.radioInner} />}
                    </View>
                    <Ionicons name="eye-off" size={16} color={identityMode === 'anonymous' ? C.primary : C.textLight} />
                    <View style={styles.identityTextContainer}>
                      <Text style={[styles.identityText, identityMode === 'anonymous' && { color: C.primary }]}>
                        Anonymous
                      </Text>
                      <Text style={styles.identitySubtext}>Hidden identity</Text>
                    </View>
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>Default</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Profile - P1-003: Moved up, more prominent */}
                  <TouchableOpacity
                    style={[styles.identityOption, identityMode === 'profile' && styles.identityOptionActive]}
                    onPress={() => setIdentityMode('profile')}
                  >
                    <View style={styles.radioOuter}>
                      {identityMode === 'profile' && <View style={styles.radioInner} />}
                    </View>
                    <Ionicons name="person" size={16} color={identityMode === 'profile' ? C.primary : C.textLight} />
                    <View style={styles.identityTextContainer}>
                      <Text style={[styles.identityText, identityMode === 'profile' && { color: C.primary }]}>
                        Show profile
                      </Text>
                      <Text style={styles.identitySubtext}>Name, age, photo visible</Text>
                    </View>
                  </TouchableOpacity>

                  {/* No photo - P1-003: Clearer description, moved to last position */}
                  <TouchableOpacity
                    style={[styles.identityOption, identityMode === 'no_photo' && styles.identityOptionActive]}
                    onPress={() => setIdentityMode('no_photo')}
                  >
                    <View style={styles.radioOuter}>
                      {identityMode === 'no_photo' && <View style={styles.radioInner} />}
                    </View>
                    <Ionicons name="person-outline" size={16} color={identityMode === 'no_photo' ? C.primary : C.textLight} />
                    <View style={styles.identityTextContainer}>
                      <Text style={[styles.identityText, identityMode === 'no_photo' && { color: C.primary }]}>
                        Name only
                      </Text>
                      <Text style={styles.identitySubtext}>Photo blurred</Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Media Visibility Selector - for photo/video/voice on new answers */}
                {/* P1-005 FIX: Include voice messages in visibility options */}
                {/* P1-002 FIX: Clearer labels with icons */}
                {attachment && (
                  <View style={styles.visibilitySection}>
                    <View style={styles.visibilitySeparator} />
                    <View style={styles.visibilityHeader}>
                      <Ionicons name="eye-outline" size={14} color={C.textLight} />
                      <Text style={styles.visibilityTitle}>Who can view your {attachment.kind === 'audio' ? 'voice message' : attachment.kind}?</Text>
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
                          size={14}
                          color={mediaVisibility === 'private' ? '#FFF' : C.textLight}
                          style={styles.segmentIcon}
                        />
                        <Text style={[
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
                          size={14}
                          color={mediaVisibility === 'public' ? '#FFF' : C.textLight}
                          style={styles.segmentIcon}
                        />
                        <Text style={[
                          styles.segmentBtnText,
                          mediaVisibility === 'public' && styles.segmentBtnTextActive,
                        ]}>Everyone</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.visibilityHelperText}>
                      {mediaVisibility === 'private'
                        ? 'Only the prompt creator can view this'
                        : 'Anyone viewing this thread can see it'}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={styles.viewModeHint}>
              <Ionicons name="eye-outline" size={14} color={C.textLight} />
              <Text style={styles.viewModeText}>Tap to view</Text>
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
                  <Ionicons name="send" size={18} color="#FFF" />
                  <Text style={styles.submitText}>Post</Text>
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
              style={styles.fullscreenClose}
              onPress={() => setFullscreenMedia(null)}
            >
              <Ionicons name="close" size={28} color="#FFF" />
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
                  size={32}
                  color={mediaVisibility === 'private' ? '#00B894' : '#E94560'}
                />
              </View>
              <Text style={styles.mediaConfirmTitle}>
                {mediaVisibility === 'private' ? 'Send to prompt creator?' : 'Share with everyone?'}
              </Text>
              <Text style={styles.mediaConfirmMessage}>
                {mediaVisibility === 'private'
                  ? 'Only the prompt creator will be able to view your media. They can view it once.'
                  : 'Anyone viewing this thread will be able to see your media. Each person can view it once.'}
              </Text>
              <View style={styles.mediaConfirmButtons}>
                <TouchableOpacity
                  style={styles.mediaConfirmCancelBtn}
                  onPress={() => setShowMediaConfirmModal(false)}
                >
                  <Text style={styles.mediaConfirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.mediaConfirmSendBtn,
                    mediaVisibility === 'private' && styles.mediaConfirmSendBtnPrivate,
                  ]}
                  onPress={handleMediaConfirmSend}
                >
                  <Ionicons name="send" size={16} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.mediaConfirmSendText}>Send</Text>
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  promptPreview: { flex: 1, fontSize: 13, color: C.textLight },

  content: { paddingHorizontal: 16, paddingVertical: 12 },

  textInput: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: C.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: { fontSize: 11, color: C.textLight, textAlign: 'right', marginTop: 2, marginBottom: 8 },

  // Attachment preview
  attachmentPreview: { marginBottom: 8 },

  audioPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 10,
  },
  audioPlayBtn: { padding: 2 },
  audioWaveform: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  audioBar: { width: 3, borderRadius: 1.5, backgroundColor: C.primary },
  audioDuration: { fontSize: 12, fontWeight: '600', color: C.textLight },
  removeBtn: { padding: 2 },

  mediaPreview: {
    height: 100,
    borderRadius: 12,
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
  mediaLabel: { fontSize: 13, color: '#FFF', fontWeight: '600', marginTop: 4 },
  removeMediaBtn: { position: 'absolute', top: 8, right: 8 },

  // Recording indicator
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F4433620',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F44336',
  },
  recordingText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#F44336' },
  stopRecordBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F44336',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Attachment buttons
  attachmentButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  attachBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    backgroundColor: C.surface,
    borderRadius: 10,
  },
  attachBtnText: { fontSize: 11, fontWeight: '600', color: C.text },

  // Identity picker
  identitySection: {
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  identityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  identityTitle: { fontSize: 12, fontWeight: '600', color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.3 },
  identityOptions: { gap: 4 },
  identityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  identityOptionActive: { backgroundColor: C.primary + '10' },
  // P1-003 FIX: Added container for text + subtext
  identityTextContainer: { flex: 1 },
  identityText: { fontSize: 13, color: C.text, fontWeight: '500' },
  identitySubtext: { fontSize: 11, color: C.textLight, marginTop: 1 },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: C.textLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  defaultBadge: {
    backgroundColor: C.primary + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  defaultBadgeText: { fontSize: 9, fontWeight: '700', color: C.primary },

  // Media visibility selector (segmented control)
  // P1-002 FIX: Added header styles for clearer visibility section
  visibilitySection: { marginTop: 4 },
  visibilitySeparator: {
    height: 1,
    backgroundColor: C.background,
    marginVertical: 8,
  },
  visibilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  visibilityTitle: { fontSize: 12, fontWeight: '600', color: C.textLight },
  visibilitySegmented: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.textLight + '40',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  segmentIcon: { marginRight: 2 },
  segmentBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  segmentBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
  },
  segmentBtnTextActive: {
    color: '#FFF',
  },
  visibilityHelperText: {
    fontSize: 11,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 6,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  viewModeHint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewModeText: { fontSize: 12, color: C.textLight },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { fontSize: 14, fontWeight: '600', color: '#FFF' },

  // Fullscreen media preview
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenClose: {
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
    padding: 24,
  },
  mediaConfirmSheet: {
    backgroundColor: C.background,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
  },
  mediaConfirmHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  mediaConfirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  mediaConfirmMessage: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  mediaConfirmButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  mediaConfirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: C.surface,
    alignItems: 'center',
  },
  mediaConfirmCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  mediaConfirmSendBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // P1-001: Green color for private/secure sends
  mediaConfirmSendBtnPrivate: {
    backgroundColor: '#00B894',
  },
  mediaConfirmSendText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
});
