import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Paths, File as ExpoFile, Directory } from 'expo-file-system';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { INCOGNITO_COLORS } from '@/lib/constants';
import type { TodMediaVisibility } from '@/types';

const C = INCOGNITO_COLORS;
const MAX_VIDEO_SEC = 60;

export default function CameraComposerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; promptId?: string; promptType?: string }>();

  // Support both: explicit mode from old callers, or switchable mode (default)
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>(
    params.mode === 'video' ? 'video' : 'photo'
  );

  const [permission, requestPermission] = useCameraPermissions();
  const [tab, setTab] = useState<'camera' | 'gallery'>('camera');
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoSeconds, setVideoSeconds] = useState(0);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedType, setCapturedType] = useState<'photo' | 'video'>('photo');
  const [isCapturing, setIsCapturing] = useState(false);
  const [mediaVisibility, setMediaVisibility] = useState<TodMediaVisibility>('owner_only');
  const cameraRef = useRef<CameraView>(null);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
    };
  }, []);

  const handleTakePhoto = async () => {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) {
        setCapturedUri(photo.uri);
        setCapturedType('photo');
      }
    } catch {
      Alert.alert('Error', 'Failed to take photo');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleStartVideo = async () => {
    if (!cameraRef.current || isRecordingVideo) return;
    setIsRecordingVideo(true);
    setVideoSeconds(0);
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
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SEC });
      if (video?.uri) {
        setCapturedUri(video.uri);
        setCapturedType('video');
      }
    } catch {
      // Recording stopped
    }
  };

  const handleStopVideo = () => {
    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    setIsRecordingVideo(false);
    cameraRef.current?.stopRecording();
  };

  const handlePickFromGallery = async () => {
    // Allow both photos and videos from gallery
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: MAX_VIDEO_SEC,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      if (isVideo && asset.duration && asset.duration > MAX_VIDEO_SEC * 1000) {
        Alert.alert('Too Long', `Video must be ${MAX_VIDEO_SEC} seconds or less.`);
        return;
      }
      setCapturedUri(asset.uri);
      setCapturedType(isVideo ? 'video' : 'photo');
      if (isVideo && asset.duration) {
        setVideoSeconds(Math.round(asset.duration / 1000));
      }
    }
  };

  const handleSubmit = async () => {
    if (!capturedUri) return;
    try {
      // Copy media to permanent document directory so URI survives navigation
      const mediaDir = new Directory(Paths.document, 'tod_media');
      if (!mediaDir.exists) {
        mediaDir.create();
      }
      const ext = capturedType === 'video' ? 'mp4' : 'jpg';
      const fileName = `${Date.now()}.${ext}`;
      const sourceFile = new ExpoFile(capturedUri);
      const destFile = new ExpoFile(mediaDir, fileName);
      sourceFile.copy(destFile);
      const permanentUri = destFile.uri;

      await AsyncStorage.setItem('tod_captured_media', JSON.stringify({
        uri: permanentUri,
        type: capturedType,
        promptId: params.promptId,
        durationSec: capturedType === 'video' ? videoSeconds : undefined,
        visibility: mediaVisibility,
      }));
      router.back();
    } catch {
      Alert.alert('Error', 'Failed to save media. Please try again.');
    }
  };

  const handleRetake = () => {
    setCapturedUri(null);
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

  // Preview captured media
  if (capturedUri) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.previewHeader}>
          <TouchableOpacity onPress={handleRetake}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.previewTitle}>Preview</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.previewArea}>
          <Image source={{ uri: capturedUri }} style={styles.previewImage} contentFit="contain" />
          {capturedType === 'video' && (
            <View style={styles.videoDurationBadge}>
              <Ionicons name="videocam" size={14} color="#FFF" />
              <Text style={styles.videoDurationText}>{formatTime(videoSeconds)}</Text>
            </View>
          )}
        </View>

        {/* Visibility selector */}
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

        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
            <Ionicons name="refresh" size={20} color={C.text} />
            <Text style={styles.retakeBtnText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            <Ionicons name="send" size={18} color="#FFF" />
            <Text style={styles.submitBtnText}>Post</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={C.text} />
        </TouchableOpacity>
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'camera' && styles.tabBtnActive]}
            onPress={() => setTab('camera')}
          >
            <Text style={[styles.tabText, tab === 'camera' && styles.tabTextActive]}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'gallery' && styles.tabBtnActive]}
            onPress={() => { setTab('gallery'); handlePickFromGallery(); }}
          >
            <Text style={[styles.tabText, tab === 'gallery' && styles.tabTextActive]}>Gallery</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setFacing((f) => f === 'front' ? 'back' : 'front')}>
          <Ionicons name="camera-reverse-outline" size={24} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Camera */}
      {tab === 'camera' && (
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
              <Text style={styles.videoTimerText}>{formatTime(videoSeconds)} / {formatTime(MAX_VIDEO_SEC)}</Text>
            </View>
          )}
        </View>
      )}

      {tab === 'gallery' && (
        <View style={styles.galleryPlaceholder}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.galleryText}>Opening gallery...</Text>
        </View>
      )}

      {/* Bottom controls */}
      {tab === 'camera' && (
        <View style={styles.bottomBar}>
          {/* Mode toggle: Photo / Video */}
          <View style={styles.modeToggleRow}>
            <TouchableOpacity
              style={[styles.modeToggleBtn, captureMode === 'photo' && styles.modeToggleActive]}
              onPress={() => !isRecordingVideo && setCaptureMode('photo')}
            >
              <Text style={[styles.modeToggleText, captureMode === 'photo' && styles.modeToggleTextActive]}>PHOTO</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeToggleBtn, captureMode === 'video' && styles.modeToggleActive]}
              onPress={() => !isRecordingVideo && setCaptureMode('video')}
            >
              <Text style={[styles.modeToggleText, captureMode === 'video' && styles.modeToggleTextActive]}>VIDEO</Text>
            </TouchableOpacity>
          </View>

          {/* Capture button */}
          {captureMode === 'photo' ? (
            <TouchableOpacity style={styles.captureBtn} onPress={handleTakePhoto} disabled={isCapturing}>
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
      )}
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
  tabRow: { flexDirection: 'row', gap: 4 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14 },
  tabBtnActive: { backgroundColor: C.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: C.textLight },
  tabTextActive: { color: '#FFF' },
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
  // Gallery placeholder
  galleryPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  galleryText: { fontSize: 14, color: C.textLight },
  // Bottom
  bottomBar: { alignItems: 'center', paddingVertical: 16, gap: 12 },
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
  previewImage: { flex: 1 },
  videoDurationBadge: {
    position: 'absolute', bottom: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  videoDurationText: { fontSize: 12, fontWeight: '600', color: '#FFF' },
  previewActions: {
    flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 20,
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
