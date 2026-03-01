/**
 * InAppMediaCamera - Unified in-app camera for photo and video capture
 * Single camera screen with Photo/Video mode toggle.
 * All preview happens in-app - no external apps or system UI.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const MAX_VIDEO_DURATION_SEC = 60;

// Internal mode for UI, maps to CameraView mode ('picture' | 'video')
type CaptureMode = 'photo' | 'video';

export interface MediaCaptureResult {
  uri: string;
  kind: 'photo' | 'video';
  durationMs?: number;
  isFrontCamera: boolean;
}

interface InAppMediaCameraProps {
  visible: boolean;
  onClose: () => void;
  onMediaCaptured: (result: MediaCaptureResult) => void;
}

export function InAppMediaCamera({
  visible,
  onClose,
  onMediaCaptured,
}: InAppMediaCameraProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();

  // Camera state
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [facing, setFacing] = useState<CameraType>('back');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // Captured media state
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedKind, setCapturedKind] = useState<'photo' | 'video' | null>(null);
  const [capturedDurationMs, setCapturedDurationMs] = useState<number | undefined>();
  const [capturedFacing, setCapturedFacing] = useState<CameraType>('back');

  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setMode('photo');
      setFacing('back');
      setIsRecording(false);
      setRecordSeconds(0);
      setIsProcessing(false);
      setCapturedUri(null);
      setCapturedKind(null);
      setCapturedDurationMs(undefined);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [visible]);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= MAX_VIDEO_DURATION_SEC - 1) {
            stopVideoRecording();
            return MAX_VIDEO_DURATION_SEC;
          }
          return s + 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Request permission if not granted
  useEffect(() => {
    if (visible && permission && !permission.granted) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || isProcessing) return;

    try {
      setIsProcessing(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });

      if (photo?.uri) {
        setCapturedUri(photo.uri);
        setCapturedKind('photo');
        setCapturedFacing(facing);
        console.log(`[InAppMediaCamera] captured kind=photo facingAtCapture=${facing} uri=${photo.uri.substring(0, 50)}...`);
      }
    } catch (error) {
      console.error('[InAppMediaCamera] Photo capture error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [facing, isProcessing]);

  const startVideoRecording = useCallback(async () => {
    if (!cameraRef.current || isRecording || isProcessing) return;

    try {
      setIsRecording(true);
      setRecordSeconds(0);

      const video = await cameraRef.current.recordAsync({
        maxDuration: MAX_VIDEO_DURATION_SEC,
      });

      // This runs after recording stops
      if (video?.uri) {
        setCapturedUri(video.uri);
        setCapturedKind('video');
        setCapturedDurationMs(recordSeconds * 1000);
        setCapturedFacing(facing);
        console.log(`[InAppMediaCamera] captured kind=video facingAtCapture=${facing} uri=${video.uri.substring(0, 50)}...`);
      }
    } catch (error) {
      console.error('[InAppMediaCamera] Video recording error:', error);
    } finally {
      setIsRecording(false);
    }
  }, [facing, isRecording, isProcessing, recordSeconds]);

  const stopVideoRecording = useCallback(async () => {
    if (!cameraRef.current || !isRecording) return;

    try {
      setIsProcessing(true);
      // Store current duration before stopping
      setCapturedDurationMs(recordSeconds * 1000);
      await cameraRef.current.stopRecording();
      // The recordAsync promise will resolve with the video
    } catch (error) {
      console.error('[InAppMediaCamera] Stop recording error:', error);
      setIsRecording(false);
    } finally {
      setIsProcessing(false);
    }
  }, [isRecording, recordSeconds]);

  const handleShutterPress = useCallback(() => {
    if (mode === 'photo') {
      takePhoto();
    } else {
      if (isRecording) {
        stopVideoRecording();
      } else {
        startVideoRecording();
      }
    }
  }, [mode, isRecording, takePhoto, startVideoRecording, stopVideoRecording]);

  // Preview handlers
  const handleCancel = useCallback(() => {
    setCapturedUri(null);
    setCapturedKind(null);
    onClose();
  }, [onClose]);

  const handleReplace = useCallback(() => {
    setCapturedUri(null);
    setCapturedKind(null);
    setCapturedDurationMs(undefined);
  }, []);

  const handleUse = useCallback(() => {
    if (capturedUri && capturedKind) {
      onMediaCaptured({
        uri: capturedUri,
        kind: capturedKind,
        durationMs: capturedKind === 'video' ? capturedDurationMs : undefined,
        isFrontCamera: capturedFacing === 'front',
      });
    }
  }, [capturedUri, capturedKind, capturedDurationMs, capturedFacing, onMediaCaptured]);

  const handleClose = useCallback(() => {
    if (isRecording) {
      stopVideoRecording();
    }
    setCapturedUri(null);
    setCapturedKind(null);
    onClose();
  }, [isRecording, stopVideoRecording, onClose]);

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  if (!visible) return null;

  // Permission loading
  if (!permission) {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.container}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </Modal>
    );
  }

  // Permission not granted
  if (!permission.granted) {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.container}>
          <View style={styles.permissionBox}>
            <Ionicons name="camera-outline" size={48} color={C.textLight} />
            <Text style={styles.permissionText}>
              Camera permission is required to take photos and videos.
            </Text>
            <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>Grant Permission</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // Preview state - show captured media
  // Front camera output may be mirrored on Android, so we apply unmirror transform
  if (capturedUri && capturedKind) {
    const unmirrorPreview = capturedFacing === 'front';
    console.log(`[InAppMediaCamera] preview kind=${capturedKind} capturedFacing=${capturedFacing} unmirrorPreview=${unmirrorPreview}`);

    return (
      <Modal visible={visible} transparent={false} animationType="fade">
        <View style={[styles.container, { paddingTop: insets.top }]}>
          {/* Preview content - apply unmirror for front camera captures */}
          <View style={styles.previewContainer}>
            {capturedKind === 'photo' ? (
              <Image
                source={{ uri: capturedUri }}
                style={[styles.previewMedia, unmirrorPreview && styles.unmirror]}
                contentFit="contain"
              />
            ) : (
              <Video
                source={{ uri: capturedUri }}
                style={[styles.previewMedia, unmirrorPreview && styles.unmirror]}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping
                isMuted={false}
                useNativeControls
              />
            )}
          </View>

          {/* Preview controls: Cancel / Replace / Use */}
          <View style={[styles.previewControls, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <TouchableOpacity style={styles.previewBtn} onPress={handleCancel}>
              <View style={[styles.previewBtnCircle, styles.cancelCircle]}>
                <Ionicons name="close" size={28} color="#FFF" />
              </View>
              <Text style={styles.previewBtnLabel}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.previewBtn} onPress={handleReplace}>
              <View style={[styles.previewBtnCircle, styles.replaceCircle]}>
                <Ionicons name="refresh" size={28} color="#FFF" />
              </View>
              <Text style={styles.previewBtnLabel}>Replace</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.previewBtn} onPress={handleUse}>
              <View style={[styles.previewBtnCircle, styles.useCircle]}>
                <Ionicons name="checkmark" size={28} color="#FFF" />
              </View>
              <Text style={styles.previewBtnLabel}>Use</Text>
            </TouchableOpacity>
          </View>

          {/* Media type indicator */}
          <View style={[styles.mediaTypeBadge, { top: insets.top + 16 }]}>
            <Ionicons
              name={capturedKind === 'photo' ? 'image' : 'videocam'}
              size={14}
              color="#FFF"
            />
            <Text style={styles.mediaTypeText}>
              {capturedKind === 'photo' ? 'Photo' : `Video ${formatTime(Math.ceil((capturedDurationMs || 0) / 1000))}`}
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  // Determine if we need to unmirror the camera preview (front camera on Android is mirrored)
  const applyUnmirror = facing === 'front';
  console.log(`[InAppMediaCamera] facing=${facing} applyingUnmirror=${applyUnmirror}`);

  // Live camera state
  return (
    <Modal visible={visible} transparent={false} animationType="slide">
      <View style={styles.container}>
        {/* Camera stage: camera surface (may be flipped) + overlay (never flipped) */}
        <View style={styles.cameraStage}>
          {/* Camera surface - apply unmirror transform for front camera */}
          <View style={[styles.cameraSurface, applyUnmirror && styles.unmirror]}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing={facing}
              mode={mode === 'photo' ? 'picture' : 'video'}
              mirror={false}
            />
          </View>
        </View>

        {/* Top bar: Close + Recording indicator (NO flip button here anymore) */}
        <View style={[styles.topBar, { top: insets.top + 10 }]}>
          <TouchableOpacity
            style={styles.topBtn}
            onPress={handleClose}
            disabled={isRecording}
          >
            <Ionicons name="close" size={28} color="#FFF" />
          </TouchableOpacity>

          {/* Recording indicator (video mode only) */}
          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>{formatTime(recordSeconds)}</Text>
            </View>
          )}

          {/* Spacer to balance the layout */}
          <View style={styles.topBtnSpacer} />
        </View>

        {/* Bottom controls */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          {/* Mode toggle: Photo | Video */}
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'photo' && styles.modeBtnActive]}
              onPress={() => !isRecording && setMode('photo')}
              disabled={isRecording}
            >
              <Text style={[styles.modeBtnText, mode === 'photo' && styles.modeBtnTextActive]}>
                Photo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'video' && styles.modeBtnActive]}
              onPress={() => !isRecording && setMode('video')}
              disabled={isRecording}
            >
              <Text style={[styles.modeBtnText, mode === 'video' && styles.modeBtnTextActive]}>
                Video
              </Text>
            </TouchableOpacity>
          </View>

          {/* Capture row: Spacer + Shutter + Flip */}
          <View style={styles.captureRow}>
            {/* Spacer to balance the row (left side) */}
            <View style={styles.flipBtnSpacer} />

            {/* Shutter button */}
            <TouchableOpacity
              style={[
                styles.shutterBtn,
                mode === 'video' && styles.shutterBtnVideo,
                isRecording && styles.shutterBtnRecording,
              ]}
              onPress={handleShutterPress}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <View style={[
                  styles.shutterBtnInner,
                  mode === 'video' && styles.shutterBtnInnerVideo,
                  isRecording && styles.shutterBtnInnerRecording,
                ]} />
              )}
            </TouchableOpacity>

            {/* Flip button - right side */}
            <TouchableOpacity
              style={styles.flipBtn}
              onPress={toggleFacing}
              disabled={isRecording}
            >
              <Ionicons name="camera-reverse-outline" size={26} color="#FFF" />
            </TouchableOpacity>
          </View>

          {/* Hint text */}
          <Text style={styles.hintText}>
            {mode === 'photo'
              ? 'Tap to capture'
              : isRecording
                ? 'Tap to stop'
                : 'Tap to record'}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  // Camera stage: wraps camera surface + overlay
  cameraStage: {
    flex: 1,
    position: 'relative',
  },
  cameraSurface: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  // Unmirror transform for front camera (counter Android's default mirroring)
  unmirror: {
    transform: [{ scaleX: -1 }],
  },

  // Top bar
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBtnSpacer: {
    width: 44,
    height: 44,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 8,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F44336',
  },
  recordingTime: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 20,
    gap: 16,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 20,
    padding: 4,
  },
  modeBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 16,
  },
  modeBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  modeBtnTextActive: {
    color: '#FFF',
  },

  // Capture row: flip + shutter + spacer
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  flipBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipBtnSpacer: {
    width: 50,
    height: 50,
  },

  // Shutter button
  shutterBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFF',
  },
  shutterBtnVideo: {
    borderColor: '#F44336',
  },
  shutterBtnRecording: {
    borderColor: '#F44336',
  },
  shutterBtnInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF',
  },
  shutterBtnInnerVideo: {
    backgroundColor: '#F44336',
  },
  shutterBtnInnerRecording: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#F44336',
  },
  hintText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },

  // Preview state
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewMedia: {
    flex: 1,
    width: '100%',
  },
  previewControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  previewBtn: {
    alignItems: 'center',
    gap: 8,
  },
  previewBtnCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelCircle: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  replaceCircle: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  useCircle: {
    backgroundColor: C.primary,
  },
  previewBtnLabel: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '500',
  },
  mediaTypeBadge: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  mediaTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },

  // Permission UI
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  permissionText: {
    fontSize: 16,
    color: C.text,
    textAlign: 'center',
  },
  permissionBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  permissionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  cancelBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  cancelBtnText: {
    fontSize: 14,
    color: C.textLight,
  },
});
