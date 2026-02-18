/**
 * TelegramMediaSheet - Telegram-style bottom sheet for camera + gallery media selection.
 *
 * Features:
 * - Requests both Camera + Gallery permissions upfront
 * - Camera tile at top (expandable to full camera view)
 * - Gallery grid with recent photos
 * - Photo capture (tap shutter)
 * - Video capture (long press shutter, max 30s)
 * - Preview with OK/Retake
 * - Routes selected/captured media to existing Secure Photo flow
 *
 * Permission Behavior:
 * - If either permission is denied: Shows "Grant Permissions" screen
 * - Only shows Telegram UI when BOTH are granted
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  FlatList,
  Dimensions,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { CameraType } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/lib/constants';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.7;
const CAMERA_TILE_HEIGHT = 180;
const THUMBNAIL_SIZE = (SCREEN_WIDTH - 48) / 3;
const MAX_VIDEO_DURATION_MS = 30000; // 30 seconds

interface TelegramMediaSheetProps {
  visible: boolean;
  onSelectMedia: (uri: string, type: 'photo' | 'video') => void;
  onClose: () => void;
}

interface GalleryAsset {
  id: string;
  uri: string;
  mediaType: 'photo' | 'video';
  duration?: number;
}

export function TelegramMediaSheet({
  visible,
  onSelectMedia,
  onClose,
}: TelegramMediaSheetProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  // Permissions
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaLibraryPermission, setMediaLibraryPermission] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [micPermission, setMicPermission] = useState<boolean | null>(null);
  const [permissionsChecked, setPermissionsChecked] = useState(false);

  // State
  const [cameraExpanded, setCameraExpanded] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');
  const [galleryAssets, setGalleryAssets] = useState<GalleryAsset[]>([]);
  const [isLoadingGallery, setIsLoadingGallery] = useState(false);

  // Capture state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);

  // Preview state
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'photo' | 'video'>('photo');

  // Computed: both permissions granted
  const bothPermissionsGranted =
    cameraPermission?.granted === true && mediaLibraryPermission === 'granted';

  // Request both permissions upfront when sheet becomes visible
  useEffect(() => {
    if (visible && !permissionsChecked) {
      requestBothPermissions();
    }
    return () => {
      // Cleanup recording timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [visible, permissionsChecked]);

  // Request both camera + media library permissions
  const requestBothPermissions = async () => {
    setPermissionsChecked(true);

    // Request camera permission
    if (!cameraPermission?.granted) {
      await requestCameraPermission();
    }

    // Request media library permission (read-only)
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(false);
      setMediaLibraryPermission(status === 'granted' ? 'granted' : 'denied');
    } catch (error) {
      console.warn('[TelegramMediaSheet] MediaLibrary permission failed:', error);
      setMediaLibraryPermission('denied');
    }
  };

  // Load gallery assets when both permissions granted
  useEffect(() => {
    if (visible && bothPermissionsGranted) {
      loadGalleryAssets();
    }
  }, [visible, bothPermissionsGranted]);

  // Load gallery assets
  const loadGalleryAssets = async () => {
    setIsLoadingGallery(true);
    try {
      const assets = await MediaLibrary.getAssetsAsync({
        first: 50,
        sortBy: [MediaLibrary.SortBy.creationTime],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      });

      setGalleryAssets(
        assets.assets.map((a) => ({
          id: a.id,
          uri: a.uri,
          mediaType: a.mediaType === MediaLibrary.MediaType.video ? 'video' : 'photo',
          duration: a.duration,
        }))
      );
    } catch (error) {
      console.warn('[TelegramMediaSheet] Gallery load failed:', error);
      setGalleryAssets([]);
    } finally {
      setIsLoadingGallery(false);
    }
  };

  // Handle "Grant Permissions" button press
  const handleGrantPermissions = async () => {
    // Re-request permissions
    const cameraResult = await requestCameraPermission();
    const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync(false);
    setMediaLibraryPermission(mediaStatus === 'granted' ? 'granted' : 'denied');

    // If still denied after re-request, open settings
    if (!cameraResult.granted || mediaStatus !== 'granted') {
      Alert.alert(
        'Permissions Required',
        'Camera and Gallery permissions are required. Please enable them in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
    }
  };

  // Request mic permission for video recording
  const requestMicPermission = async (): Promise<boolean> => {
    if (micPermission === true) return true;

    try {
      const { status } = await Audio.requestPermissionsAsync();
      const granted = status === 'granted';
      setMicPermission(granted);
      return granted;
    } catch (error) {
      console.warn('[TelegramMediaSheet] Mic permission failed:', error);
      setMicPermission(false);
      return false;
    }
  };

  // Expand camera to full screen
  const handleExpandCamera = () => {
    setCameraExpanded(true);
  };

  // Take photo
  const handleTakePhoto = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
      });
      if (photo?.uri) {
        setPreviewUri(photo.uri);
        setPreviewType('photo');
      }
    } catch (error) {
      console.warn('[TelegramMediaSheet] Photo capture failed:', error);
      Alert.alert('Error', 'Failed to capture photo. Please try again.');
    }
  };

  // Start video recording
  const handleStartRecording = async () => {
    if (!cameraRef.current || isRecording) return;

    // Check mic permission for video BEFORE starting
    const hasMic = await requestMicPermission();
    if (!hasMic) {
      Alert.alert(
        'Microphone Permission',
        'Microphone permission is required for video recording. You can still take photos.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setIsRecording(true);
      recordingStartRef.current = Date.now();
      setRecordingDuration(0);

      // Start duration timer
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - recordingStartRef.current;
        setRecordingDuration(elapsed);

        // Auto-stop at 30 seconds
        if (elapsed >= MAX_VIDEO_DURATION_MS) {
          handleStopRecording();
        }
      }, 100);

      const video = await cameraRef.current.recordAsync({
        maxDuration: MAX_VIDEO_DURATION_MS / 1000,
      });

      if (video?.uri) {
        setPreviewUri(video.uri);
        setPreviewType('video');
      }
    } catch (error: any) {
      console.warn('[TelegramMediaSheet] Video recording failed:', error);
      const errorMsg = error?.message || '';
      if (!errorMsg.includes('stop') && !errorMsg.includes('cancelled')) {
        Alert.alert('Recording Error', 'Failed to record video. Please try again.');
      }
    } finally {
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  // Stop video recording
  const handleStopRecording = useCallback(() => {
    if (cameraRef.current && isRecording) {
      try {
        cameraRef.current.stopRecording();
      } catch {
        // Ignore stop errors
      }
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  }, [isRecording]);

  // Handle gallery item press
  const handleGalleryItemPress = (asset: GalleryAsset) => {
    setPreviewUri(asset.uri);
    setPreviewType(asset.mediaType);
  };

  // Confirm selection (OK button)
  const handleConfirm = () => {
    if (previewUri) {
      onSelectMedia(previewUri, previewType);
      resetState();
    }
  };

  // Retake (discard and go back)
  const handleRetake = () => {
    setPreviewUri(null);
    setPreviewType('photo');
  };

  // Reset all state
  const resetState = () => {
    setPreviewUri(null);
    setPreviewType('photo');
    setCameraExpanded(false);
    setIsRecording(false);
    setRecordingDuration(0);
    setPermissionsChecked(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // Close sheet
  const handleClose = () => {
    resetState();
    onClose();
  };

  // Toggle camera facing
  const toggleCameraFacing = () => {
    setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  };

  // Format duration for display
  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  if (!visible) return null;

  // Preview screen
  if (previewUri) {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.previewContainer}>
          <Image
            source={{ uri: previewUri }}
            style={styles.previewImage}
            contentFit="contain"
          />
          {previewType === 'video' && (
            <View style={[styles.videoIndicator, { top: insets.top + 60 }]}>
              <Ionicons name="videocam" size={20} color={COLORS.white} />
              <Text style={styles.videoIndicatorText}>Video</Text>
            </View>
          )}
          <View style={[styles.previewActions, { paddingBottom: insets.bottom + 20 }]}>
            <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
              <Ionicons name="refresh" size={24} color={COLORS.white} />
              <Text style={styles.retakeText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
              <Ionicons name="checkmark" size={24} color={COLORS.white} />
              <Text style={styles.confirmText}>OK</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.closeButton, { top: insets.top + 10 }]}
            onPress={handleClose}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // Expanded camera view
  if (cameraExpanded) {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.expandedCameraContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.expandedCamera}
            facing={cameraFacing}
            mode={isRecording ? 'video' : 'picture'}
          />

          {/* Recording indicator */}
          {isRecording && (
            <View style={[styles.recordingBanner, { top: insets.top + 10 }]}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>
                {formatDuration(recordingDuration)} / 0:30
              </Text>
            </View>
          )}

          {/* Camera controls */}
          <View style={[styles.cameraControls, { paddingBottom: insets.bottom + 20 }]}>
            {/* Back button */}
            <TouchableOpacity
              style={styles.cameraControlButton}
              onPress={() => setCameraExpanded(false)}
              disabled={isRecording}
            >
              <Ionicons name="arrow-back" size={28} color={COLORS.white} />
            </TouchableOpacity>

            {/* Shutter button - tap for photo, long press for video */}
            <Pressable
              style={[styles.shutterButton, isRecording && styles.shutterButtonRecording]}
              onPress={isRecording ? undefined : handleTakePhoto}
              onLongPress={handleStartRecording}
              onPressOut={isRecording ? handleStopRecording : undefined}
              delayLongPress={300}
            >
              {isRecording ? (
                <View style={styles.shutterInnerRecording} />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </Pressable>

            {/* Flip camera button */}
            <TouchableOpacity
              style={styles.cameraControlButton}
              onPress={toggleCameraFacing}
              disabled={isRecording}
            >
              <Ionicons name="camera-reverse" size={28} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          {/* Instruction text */}
          {!isRecording && (
            <View style={styles.instructionContainer}>
              <Text style={styles.instructionText}>
                Tap for photo, hold for video (max 30s)
              </Text>
            </View>
          )}

          {/* Close button */}
          <TouchableOpacity
            style={[styles.closeButton, { top: insets.top + 10 }]}
            onPress={handleClose}
            disabled={isRecording}
          >
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // Permission request screen (if either permission not granted)
  if (!bothPermissionsGranted) {
    return (
      <Modal visible={visible} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={handleClose}>
          <Pressable
            style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />

            <View style={styles.permissionContainer}>
              <View style={styles.permissionIconRow}>
                <Ionicons name="camera" size={32} color={COLORS.primary} />
                <Text style={styles.permissionPlus}>+</Text>
                <Ionicons name="images" size={32} color={COLORS.primary} />
              </View>
              <Text style={styles.permissionTitle}>Allow Camera & Gallery</Text>
              <Text style={styles.permissionSubtitle}>
                Camera and gallery access is required to take photos, record videos, and select media.
              </Text>
              <TouchableOpacity
                style={styles.grantButton}
                onPress={handleGrantPermissions}
              >
                <Text style={styles.grantButtonText}>Grant Permissions</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // Main sheet view (camera tile + gallery grid) - only shown when both permissions granted
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          {/* Camera tile */}
          <TouchableOpacity
            style={styles.cameraTile}
            onPress={handleExpandCamera}
            activeOpacity={0.8}
          >
            <View style={styles.cameraTileContent}>
              <Ionicons name="camera" size={40} color={COLORS.white} />
              <Text style={styles.cameraTileText}>Camera</Text>
            </View>
          </TouchableOpacity>

          {/* Gallery grid */}
          <View style={styles.galleryContainer}>
            {isLoadingGallery ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.loadingText}>Loading gallery...</Text>
              </View>
            ) : galleryAssets.length === 0 ? (
              <View style={styles.emptyGallery}>
                <Ionicons name="images-outline" size={40} color={COLORS.textLight} />
                <Text style={styles.emptyGalleryText}>No photos or videos</Text>
              </View>
            ) : (
              <FlatList
                data={galleryAssets}
                numColumns={3}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.thumbnailContainer}
                    onPress={() => handleGalleryItemPress(item)}
                    activeOpacity={0.7}
                  >
                    <Image
                      source={{ uri: item.uri }}
                      style={styles.thumbnail}
                      contentFit="cover"
                    />
                    {item.mediaType === 'video' && (
                      <View style={styles.videoBadge}>
                        <Ionicons name="videocam" size={12} color={COLORS.white} />
                        {item.duration != null && (
                          <Text style={styles.videoDuration}>
                            {formatDuration(item.duration * 1000)}
                          </Text>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.galleryContent}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 12,
  },

  // Permission screen
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  permissionIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  permissionPlus: {
    fontSize: 24,
    color: COLORS.textLight,
    fontWeight: '300',
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  permissionSubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  grantButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 25,
  },
  grantButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },

  // Camera tile
  cameraTile: {
    height: CAMERA_TILE_HEIGHT,
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
  },
  cameraTileContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cameraTileText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },

  // Gallery
  galleryContainer: {
    flex: 1,
    marginTop: 12,
  },
  galleryContent: {
    paddingHorizontal: 12,
  },
  thumbnailContainer: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    padding: 4,
  },
  thumbnail: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
  },
  videoBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  videoDuration: {
    fontSize: 10,
    color: COLORS.white,
    fontWeight: '500',
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textLight,
  },

  // Empty gallery
  emptyGallery: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyGalleryText: {
    fontSize: 14,
    color: COLORS.textLight,
  },

  // Expanded camera
  expandedCameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  expandedCamera: {
    flex: 1,
  },

  // Camera controls
  cameraControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  cameraControlButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterButtonRecording: {
    borderColor: COLORS.error,
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.white,
  },
  shutterInnerRecording: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: COLORS.error,
  },

  // Recording banner
  recordingBanner: {
    position: 'absolute',
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
    marginRight: 8,
  },
  recordingText: {
    fontSize: 14,
    color: COLORS.white,
    fontWeight: '600',
  },

  // Instruction
  instructionContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 13,
    color: COLORS.white,
    opacity: 0.7,
  },

  // Close button
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Preview
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewImage: {
    flex: 1,
  },
  videoIndicator: {
    position: 'absolute',
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  videoIndicatorText: {
    fontSize: 14,
    color: COLORS.white,
    fontWeight: '600',
  },
  previewActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 25,
  },
  retakeText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 25,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
});
