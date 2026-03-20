import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Video, ResizeMode } from 'expo-av';
import * as ImageManipulator from 'expo-image-manipulator';
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
  const MAX_VIDEO_SEC = isSecureCapture ? MAX_VIDEO_SEC_SECURE : MAX_VIDEO_SEC_TOD;

  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>(
    params.mode === 'video' ? 'video' : 'photo'
  );

  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('front');

  // Recording state
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoSeconds, setVideoSeconds] = useState(0);

  // Captured media state
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedType, setCapturedType] = useState<'photo' | 'video' | null>(null);
  const [capturedFacing, setCapturedFacing] = useState<'front' | 'back'>('front');

  const [isCapturing, setIsCapturing] = useState(false);
  const [mediaVisibility, setMediaVisibility] = useState<TodMediaVisibility>('owner_only');

  const cameraRef = useRef<CameraView>(null);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
    };
  }, []);

  // PHOTO: Clean flow
  const handleTakePhoto = async () => {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        shutterSound: false
      });

      if (photo?.uri) {
        // Set state immediately - go to preview
        setCapturedUri(photo.uri);
        setCapturedType('photo');
        setCapturedFacing(facing);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to take photo');
    } finally {
      setIsCapturing(false);
    }
  };

  // VIDEO: Start recording
  const handleStartVideo = async () => {
    if (!cameraRef.current || isRecordingVideo) return;

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
      const video = await cameraRef.current.recordAsync({
        maxDuration: MAX_VIDEO_SEC
      });

      // Recording finished - set URI and go to preview
      if (video?.uri) {
        setCapturedUri(video.uri);
        setIsRecordingVideo(false);
        if (videoTimerRef.current) {
          clearInterval(videoTimerRef.current);
          videoTimerRef.current = null;
        }
      }
    } catch (e) {
      // Recording was stopped or failed
      setIsRecordingVideo(false);
      if (videoTimerRef.current) {
        clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
    }
  };

  // VIDEO: Stop recording
  const handleStopVideo = () => {
    if (!cameraRef.current) return;

    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }

    // This triggers recordAsync to resolve
    cameraRef.current.stopRecording();
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

      // MIRROR FIX: Flip front camera photos
      let finalUri = capturedUri;
      if (capturedType === 'photo' && capturedFacing === 'front') {
        try {
          const flipped = await ImageManipulator.manipulateAsync(
            capturedUri,
            [{ flip: ImageManipulator.FlipType.Horizontal }],
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
          );
          finalUri = flipped.uri;
        } catch (flipErr) {
          console.warn('[CameraComposer] Failed to flip image:', flipErr);
        }
      }

      const sourceFile = new ExpoFile(finalUri);
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

      setHandoff(storageKey, {
        uri: permanentUri,
        type: capturedType,
        mediaUri: permanentUri,
        promptId: params.promptId,
        durationSec: capturedType === 'video' ? videoSeconds : undefined,
        visibility: isSecureCapture ? undefined : mediaVisibility,
        isMirrored: capturedType === 'video' && capturedFacing === 'front',
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
  if (!permission?.granted) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.permissionBox}>
          <Ionicons name="camera-outline" size={48} color={C.textLight} />
          <Text style={styles.permissionText}>Camera access is needed</Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Grant Access</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // PREVIEW SCREEN
  if (capturedUri && capturedType) {
    const isFrontCamera = capturedFacing === 'front';
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
            // VIDEO-PREVIEW-FIX: Use expo-av Video with proper mirroring for front camera
            <Video
              source={{ uri: capturedUri }}
              style={[styles.previewMedia, isFrontCamera && styles.mirrored]}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={true}
              isLooping={true}
              isMuted={false}
            />
          ) : (
            <Image
              source={{ uri: capturedUri }}
              style={[styles.previewMedia, isFrontCamera && styles.mirrored]}
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

        {/* ANDROID-SAFE-AREA-FIX: Use safe area inset for bottom spacing */}
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

      {/* Camera */}
      <View style={styles.cameraWrap}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mode={captureMode === 'video' ? 'video' : 'picture'}
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

      {/* Bottom controls - ANDROID-SAFE-AREA-FIX: Use safe area inset */}
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
  // Permission
  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  permissionText: { fontSize: 16, color: C.text, textAlign: 'center' },
  permissionBtn: {
    backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  permissionBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  cancelText: { fontSize: 14, color: C.textLight, marginTop: 8 },
  // Top bar
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  // Camera
  cameraWrap: { flex: 1, overflow: 'hidden', borderRadius: 12, marginHorizontal: 8 },
  camera: { flex: 1 },
  videoTimerOverlay: {
    position: 'absolute', top: 16, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F44336' },
  videoTimerText: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  // Bottom - ANDROID-SAFE-AREA-FIX: paddingBottom is applied dynamically via style prop
  bottomBar: { alignItems: 'center', paddingTop: 16, gap: 12 },
  // Mode toggle
  modeToggleRow: { flexDirection: 'row', gap: 4 },
  modeToggleBtn: {
    paddingHorizontal: 16, paddingVertical: 5, borderRadius: 12,
  },
  modeToggleActive: { backgroundColor: C.surface },
  modeToggleText: { fontSize: 11, fontWeight: '700', color: C.textLight, letterSpacing: 1 },
  modeToggleTextActive: { color: C.text },
  // Capture buttons
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
  // Preview
  previewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  previewTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  previewArea: { flex: 1, marginHorizontal: 8, borderRadius: 12, overflow: 'hidden' },
  previewMedia: { flex: 1 },
  mirrored: { transform: [{ scaleX: -1 }] },
  videoDurationBadge: {
    position: 'absolute', bottom: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  videoDurationText: { fontSize: 12, fontWeight: '600', color: '#FFF' },
  // ANDROID-SAFE-AREA-FIX: paddingBottom is applied dynamically via style prop
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
  // Visibility selector
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
