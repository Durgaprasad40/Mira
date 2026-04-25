import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  type PhotoFile,
  type VideoFile,
} from 'react-native-vision-camera';
// FFmpegKit removed - Maven artifacts unavailable (project retired Jan 2025)
import { useVideoPlayer, VideoView } from 'expo-video';
import { Paths, File as ExpoFile, Directory } from 'expo-file-system';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import type { TodMediaVisibility } from '@/types';
import { setHandoff } from '@/lib/memoryHandoff';

const C = INCOGNITO_COLORS;
const MAX_VIDEO_SEC_TOD = 60;
const MAX_VIDEO_SEC_SECURE = 30;

// ═══════════════════════════════════════════════════════════════════════════
// FRONT CAMERA VIDEO MIRROR FIX:
// - isMirrored={true} for front camera: gives "mirror" orientation where
//   user's LEFT hand appears on LEFT side (natural selfie experience)
// - isMirrored={false} for back camera: gives "real world" orientation
// The isMirrored prop is set dynamically based on `facing` state.
// ═══════════════════════════════════════════════════════════════════════════

export default function CameraComposerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    mode?: string;
    promptId?: string;
    promptType?: string;
    todConversationId?: string;
    conversationId?: string;
  }>();

  const isTodAnswer = params.mode === 'tod_answer' && params.todConversationId;
  const isSecureCapture = params.mode === 'secure_capture' && params.conversationId;
  const isPromptAnswer = !!params.promptId;
  const MAX_VIDEO_SEC = isSecureCapture ? MAX_VIDEO_SEC_SECURE : MAX_VIDEO_SEC_TOD;

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION GUARD: Prevent unexpected opening of camera-composer
  // ═══════════════════════════════════════════════════════════════════════════
  const hasValidParams = isTodAnswer || isSecureCapture || isPromptAnswer;
  const isNavigatingAwayRef = useRef(false);

  if (!hasValidParams && !isNavigatingAwayRef.current) {
    isNavigatingAwayRef.current = true;
    setTimeout(() => {
      try {
        if (router.canDismiss?.()) {
          router.dismiss();
        } else if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(main)/(tabs)/home');
        }
      } catch {
        router.replace('/(main)/(tabs)/home');
      }
    }, 0);
    return null;
  }

  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>(
    params.mode === 'video' ? 'video' : 'photo'
  );

  // react-native-vision-camera permissions
  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } = useCameraPermission();
  const { hasPermission: hasMicPermission, requestPermission: requestMicPermission } = useMicrophonePermission();
  const [facing, setFacing] = useState<'front' | 'back'>('front');

  // Get camera device
  const device = useCameraDevice(facing);

  // Recording state
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoSeconds, setVideoSeconds] = useState(0);

  // Captured media state
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedType, setCapturedType] = useState<'photo' | 'video' | null>(null);
  const [capturedFacing, setCapturedFacing] = useState<'front' | 'back'>('front');

  const [isCapturing, setIsCapturing] = useState(false);
  const [mediaVisibility, setMediaVisibility] = useState<TodMediaVisibility>('owner_only');

  const cameraRef = useRef<Camera>(null);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Video preview player
  const previewPlayer = useVideoPlayer(capturedUri ?? '', (player) => {
    player.loop = true;
    player.muted = false;
  });

  useEffect(() => {
    if (capturedUri && capturedType === 'video') {
      previewPlayer.play();
    }
  }, [capturedUri, capturedType, previewPlayer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
    };
  }, []);

  // PHOTO: Take photo with vision camera
  const handleTakePhoto = async () => {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);

    try {
      const photo: PhotoFile = await cameraRef.current.takePhoto();

      if (photo?.path) {
        const photoUri = `file://${photo.path}`;
        setCapturedUri(photoUri);
        setCapturedType('photo');
        setCapturedFacing(facing);
      }
    } catch (e) {
      if (__DEV__) console.warn('[CameraComposer] Photo error:', e);
      Alert.alert('Error', 'Failed to take photo');
    } finally {
      setIsCapturing(false);
    }
  };

  // VIDEO: Recording callbacks
  const onRecordingFinished = useCallback((video: VideoFile) => {
    if (__DEV__) console.log('[CameraComposer] Recording finished:', video.path);

    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }

    setIsRecordingVideo(false);
    const videoUri = `file://${video.path}`;
    // Video orientation is handled at recording time via isMirrored prop
    setCapturedUri(videoUri);
  }, []);

  const onRecordingError = useCallback((error: any) => {
    if (__DEV__) console.warn('[CameraComposer] Recording error:', error);

    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }

    setIsRecordingVideo(false);
    Alert.alert('Error', 'Video recording failed');
  }, []);

  // VIDEO: Start recording
  const handleStartVideo = async () => {
    if (__DEV__) console.log('[CameraComposer] handleStartVideo called');

    if (!cameraRef.current || isRecordingVideo) {
      return;
    }

    // Check microphone permission for video recording
    if (!hasMicPermission) {
      const result = await requestMicPermission();
      if (!result) {
        Alert.alert(
          'Microphone Required',
          'Video recording requires microphone access. Please grant permission in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    // Set state BEFORE recording
    setIsRecordingVideo(true);
    setCapturedType('video');
    setCapturedFacing(facing);
    setVideoSeconds(0);

    // Start timer
    videoTimerRef.current = setInterval(() => {
      setVideoSeconds((s) => {
        if (s >= MAX_VIDEO_SEC - 1) {
          handleStopVideo();
          return MAX_VIDEO_SEC;
        }
        return s + 1;
      });
    }, 1000);

    try {
      // Start recording with vision camera
      cameraRef.current.startRecording({
        onRecordingFinished,
        onRecordingError,
      });
      if (__DEV__) console.log('[CameraComposer] Recording started');
    } catch (e) {
      if (__DEV__) console.warn('[CameraComposer] Failed to start recording:', e);
      setIsRecordingVideo(false);
      if (videoTimerRef.current) {
        clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
    }
  };

  // VIDEO: Stop recording
  const handleStopVideo = async () => {
    if (__DEV__) console.log('[CameraComposer] handleStopVideo called');

    if (!cameraRef.current) {
      return;
    }

    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }

    try {
      await cameraRef.current.stopRecording();
      if (__DEV__) console.log('[CameraComposer] Recording stopped');
    } catch (e) {
      if (__DEV__) console.warn('[CameraComposer] Stop recording error:', e);
    }
  };

  // SUBMIT: Send to chat
  const handleSubmit = async () => {
    if (!capturedUri || !capturedType) return;

    try {
      const dirName = isSecureCapture ? 'secure_media' : 'tod_media';
      const mediaDir = new Directory(Paths.document, dirName);
      if (!mediaDir.exists) {
        mediaDir.create();
      }

      const ext = capturedType === 'video' ? 'mp4' : 'jpg';
      const fileName = `${Date.now()}.${ext}`;

      // Front camera: vision-camera isMirrored={true} already produces a
      // mirrored (selfie-view) file. Trust that as the final source — no
      // additional ImageManipulator flip, no preview scaleX:-1. Photo and
      // video pipelines now match.
      const sourceFile = new ExpoFile(capturedUri);
      const destFile = new ExpoFile(mediaDir, fileName);
      sourceFile.copy(destFile);
      const permanentUri = destFile.uri;

      let storageKey: string;
      if (isSecureCapture) {
        storageKey = `secure_capture_media_${params.conversationId}`;
      } else if (isTodAnswer) {
        storageKey = `tod_camera_answer_${params.todConversationId}`;
      } else {
        storageKey = 'tod_captured_media';
      }

      // ═══════════════════════════════════════════════════════════════════════
      // VIDEO ORIENTATION:
      // - Front camera: isMirrored={true} at recording time gives mirror orientation
      //   (LEFT hand shows as LEFT) - no playback transform needed
      // - Back camera: isMirrored={false} gives real-world orientation - no transform
      // - Both: video FILE is already correct, no playback correction needed
      // ═══════════════════════════════════════════════════════════════════════
      setHandoff(storageKey, {
        uri: permanentUri,
        type: capturedType,
        mediaUri: permanentUri,
        promptId: params.promptId,
        durationSec: capturedType === 'video' ? videoSeconds : undefined,
        visibility: isSecureCapture ? undefined : mediaVisibility,
        isMirrored: false, // Video file is already correct orientation - no playback transform
      });

      router.back();
    } catch (e) {
      Alert.alert('Error', 'Failed to save media. Please try again.');
    }
  };

  // RETAKE: Clear and go back to camera
  const handleRetake = () => {
    setCapturedUri(null);
    setCapturedType(null);
    setVideoSeconds(0);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  // Permission check
  if (!hasCameraPermission) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.permissionBox}>
          <Ionicons name="camera-outline" size={48} color={C.textLight} />
          <Text style={styles.permissionText}>Camera access is needed</Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestCameraPermission}>
            <Text style={styles.permissionBtnText}>Grant Access</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Device not available
  if (!device) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.permissionBox}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.permissionText}>Loading camera...</Text>
        </View>
      </View>
    );
  }

  // PREVIEW SCREEN
  if (capturedUri && capturedType) {
    const isVideo = capturedType === 'video';

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.previewHeader}>
          <TouchableOpacity onPress={handleRetake}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.previewTitle}>
            {isVideo ? 'Video Preview' : 'Photo Preview'}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.previewArea}>
          {isVideo ? (
            // VIDEO PREVIEW: Video file is already correct (no transform needed)
            <VideoView
              player={previewPlayer}
              style={styles.previewMedia}
              contentFit="contain"
              nativeControls={false}
            />
          ) : (
            // PHOTO PREVIEW: File is already in selfie-mirror orientation from
            // vision-camera isMirrored={true}; show it as-is.
            <Image
              source={{ uri: capturedUri }}
              style={styles.previewMedia}
              contentFit="contain"
            />
          )}

          {isVideo && (
            <View style={styles.videoDurationBadge}>
              <Ionicons name="videocam" size={14} color="#FFF" />
              <Text style={styles.videoDurationText}>{formatTime(videoSeconds)}</Text>
            </View>
          )}
        </View>

        {/* Visibility selector - only for T&D */}
        {!isSecureCapture && (
          <View style={styles.visibilitySection}>
            <Text style={styles.visibilityLabel}>Who can view this?</Text>
            <View style={styles.visibilityOptions}>
              <TouchableOpacity
                style={[styles.visibilityOption, mediaVisibility === 'owner_only' && styles.visibilityOptionActive]}
                onPress={() => setMediaVisibility('owner_only')}
              >
                <View style={[styles.radioOuter, mediaVisibility === 'owner_only' && styles.radioOuterActive]}>
                  {mediaVisibility === 'owner_only' && <View style={styles.radioInner} />}
                </View>
                <Text style={[styles.visibilityOptionText, mediaVisibility === 'owner_only' && styles.visibilityOptionTextActive]}>
                  Only question owner
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.visibilityOption, mediaVisibility === 'public' && styles.visibilityOptionActive]}
                onPress={() => setMediaVisibility('public')}
              >
                <View style={[styles.radioOuter, mediaVisibility === 'public' && styles.radioOuterActive]}>
                  {mediaVisibility === 'public' && <View style={styles.radioInner} />}
                </View>
                <Text style={[styles.visibilityOptionText, mediaVisibility === 'public' && styles.visibilityOptionTextActive]}>
                  Anyone can view
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={[styles.previewActions, { paddingBottom: insets.bottom + 20 }]}>
          <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
            <Ionicons name="refresh" size={20} color={C.text} />
            <Text style={styles.retakeBtnText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            <Ionicons name="send" size={18} color="#FFF" />
            <Text style={styles.submitBtnText}>{isSecureCapture ? 'Use' : 'Post'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // CAMERA SCREEN
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={C.text} />
        </TouchableOpacity>
        <View style={{ width: 24 }} />
        <TouchableOpacity onPress={() => setFacing((f) => f === 'front' ? 'back' : 'front')}>
          <Ionicons name="camera-reverse-outline" size={24} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Camera - FRONT CAMERA VIDEO FIX: isMirrored=true for front camera gives mirror orientation */}
      <View style={styles.cameraWrap}>
        <Camera
          ref={cameraRef}
          style={styles.camera}
          device={device}
          isActive={true}
          photo={captureMode === 'photo'}
          video={captureMode === 'video'}
          audio={captureMode === 'video'}
          isMirrored={facing === 'front'}
        />

        {captureMode === 'video' && isRecordingVideo && (
          <View style={styles.videoTimerOverlay}>
            <View style={styles.recordingDot} />
            <Text style={styles.videoTimerText}>
              {formatTime(videoSeconds)} / {formatTime(MAX_VIDEO_SEC)}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {/* Mode toggle - hide when recording */}
        {!isRecordingVideo && (
          <View style={styles.modeToggleRow}>
            <TouchableOpacity
              style={[styles.modeToggleBtn, captureMode === 'photo' && styles.modeToggleActive]}
              onPress={() => setCaptureMode('photo')}
            >
              <Text style={[styles.modeToggleText, captureMode === 'photo' && styles.modeToggleTextActive]}>
                PHOTO
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeToggleBtn, captureMode === 'video' && styles.modeToggleActive]}
              onPress={() => setCaptureMode('video')}
            >
              <Text style={[styles.modeToggleText, captureMode === 'video' && styles.modeToggleTextActive]}>
                VIDEO
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Capture button */}
        {captureMode === 'photo' ? (
          <TouchableOpacity
            style={styles.captureBtn}
            onPress={handleTakePhoto}
            disabled={isCapturing}
          >
            <View style={styles.captureInner} />
          </TouchableOpacity>
        ) : (
          <>
            {!isRecordingVideo ? (
              <TouchableOpacity style={styles.videoCaptureBtn} onPress={handleStartVideo}>
                <View style={styles.videoCaptureInner} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.videoStopBtn} onPress={handleStopVideo}>
                <View style={styles.videoStopInner} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  permissionText: { fontSize: 16, color: C.text, textAlign: 'center' },
  permissionBtn: {
    backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  permissionBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  cancelText: { fontSize: 14, color: C.textLight, marginTop: 8 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  cameraWrap: { flex: 1, overflow: 'hidden', borderRadius: 12, marginHorizontal: 8 },
  camera: { flex: 1 },
  videoTimerOverlay: {
    position: 'absolute', top: 16, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F44336' },
  videoTimerText: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  bottomBar: { alignItems: 'center', paddingTop: 16, gap: 12 },
  modeToggleRow: { flexDirection: 'row', gap: 4 },
  modeToggleBtn: {
    paddingHorizontal: 16, paddingVertical: 5, borderRadius: 12,
  },
  modeToggleActive: { backgroundColor: C.surface },
  modeToggleText: { fontSize: 11, fontWeight: '700', color: C.textLight, letterSpacing: 1 },
  modeToggleTextActive: { color: C.text },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
  },
  captureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF' },
  videoCaptureBtn: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#F44336',
    alignItems: 'center', justifyContent: 'center',
  },
  videoCaptureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#F44336' },
  videoStopBtn: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#F44336',
    alignItems: 'center', justifyContent: 'center',
  },
  videoStopInner: { width: 28, height: 28, borderRadius: 4, backgroundColor: '#F44336' },
  previewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  previewTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  previewArea: { flex: 1, marginHorizontal: 8, borderRadius: 12, overflow: 'hidden' },
  previewMedia: { flex: 1 },
  videoDurationBadge: {
    position: 'absolute', bottom: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  videoDurationText: { fontSize: 12, fontWeight: '600', color: '#FFF' },
  previewActions: {
    flexDirection: 'row', justifyContent: 'center', gap: 16, paddingTop: 20,
  },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, backgroundColor: C.surface,
  },
  retakeBtnText: { fontSize: 14, fontWeight: '600', color: C.text },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14,
  },
  submitBtnText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  visibilitySection: { paddingHorizontal: 16, paddingTop: 12 },
  visibilityLabel: { fontSize: 12, fontWeight: '600', color: C.textLight, marginBottom: 8 },
  visibilityOptions: { flexDirection: 'row', gap: 12 },
  visibilityOption: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: C.surface,
  },
  visibilityOptionActive: { backgroundColor: C.primary + '20' },
  visibilityOptionText: { fontSize: 12, color: C.textLight },
  visibilityOptionTextActive: { color: C.text, fontWeight: '600' },
  radioOuter: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: C.textLight,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOuterActive: { borderColor: C.primary },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
});
