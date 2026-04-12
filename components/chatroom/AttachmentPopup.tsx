import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Alert,
  Animated,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INCOGNITO_COLORS } from '@/lib/constants';
import ChatRoomCamera, { ChatRoomMediaResult } from './ChatRoomCamera';

const C = INCOGNITO_COLORS;

// Max video duration for chat rooms (30 seconds)
const MAX_VIDEO_DURATION_SECONDS = 30;

// Button size and spacing
const BUTTON_SIZE = 48;
const BUTTON_SPACING = 10;
// Composer height approximation for positioning
const COMPOSER_HEIGHT = 52;
// Tab bar height approximation
const TAB_BAR_HEIGHT = 49;

interface AttachmentPopupProps {
  visible: boolean;
  onClose: () => void;
  onImageCaptured: (uri: string) => void;
  onGalleryImage: (uri: string) => void;
  onVideoSelected: (uri: string) => void;
  onDoodlePress: () => void;
}

export default function AttachmentPopup({
  visible,
  onClose,
  onImageCaptured,
  onGalleryImage,
  onVideoSelected,
  onDoodlePress,
}: AttachmentPopupProps) {
  // Camera state - managed independently of popup visibility
  const [showCamera, setShowCamera] = useState(false);

  // Gallery preview state - shows preview before upload
  const [galleryPreview, setGalleryPreview] = useState<{
    visible: boolean;
    uri: string;
    type: 'image' | 'video';
  }>({ visible: false, uri: '', type: 'image' });

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateAnim = useRef(new Animated.Value(20)).current;

  // Animate in/out
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(translateAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(translateAnim, {
          toValue: 20,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, translateAnim]);

  // Open camera directly with permission check
  const handleCameraPress = useCallback(async () => {
    try {
      // Request camera permission first
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera Permission',
          'Camera access is required to take photos and videos. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Close popup first
      onClose();

      // Brief delay to let animation complete
      await new Promise(resolve => setTimeout(resolve, 150));

      // Open camera
      setShowCamera(true);
    } catch (error) {
      console.error('[AttachmentPopup] Camera open error:', error);
      Alert.alert('Error', 'Could not open camera. Please try again.');
    }
  }, [onClose]);

  // Handle media captured from camera
  const handleMediaCaptured = useCallback((result: ChatRoomMediaResult) => {
    setShowCamera(false);
    if (result.type === 'image') {
      onImageCaptured(result.uri);
    } else {
      onVideoSelected(result.uri);
    }
  }, [onImageCaptured, onVideoSelected]);

  // Close camera
  const handleCameraClose = useCallback(() => {
    setShowCamera(false);
  }, []);

  const handleGallery = async () => {
    onClose();
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photos Permission',
          'Photo library access is needed. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        if (asset.type === 'video') {
          // Check video duration (duration is in milliseconds)
          const durationSeconds = (asset.duration ?? 0) / 1000;
          if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
            Alert.alert(
              'Video Too Long',
              'Only 30 seconds video is allowed',
              [{ text: 'OK' }]
            );
            return;
          }
          // Show preview instead of immediate upload
          setGalleryPreview({ visible: true, uri: asset.uri, type: 'video' });
        } else {
          // Show preview instead of immediate upload
          setGalleryPreview({ visible: true, uri: asset.uri, type: 'image' });
        }
      }
    } catch {
      Alert.alert('Error', 'Could not open photo library. Please try again.');
    }
  };

  // Gallery preview handlers
  const handleGalleryPreviewCancel = useCallback(() => {
    setGalleryPreview({ visible: false, uri: '', type: 'image' });
  }, []);

  const handleGalleryPreviewReselect = useCallback(async () => {
    // Close current preview and reopen gallery
    setGalleryPreview({ visible: false, uri: '', type: 'image' });
    // Small delay to let modal close
    await new Promise(resolve => setTimeout(resolve, 100));
    handleGallery();
  }, []);

  const handleGalleryPreviewSend = useCallback(() => {
    const { uri, type } = galleryPreview;
    setGalleryPreview({ visible: false, uri: '', type: 'image' });
    if (type === 'video') {
      onVideoSelected(uri);
    } else {
      onGalleryImage(uri);
    }
  }, [galleryPreview, onGalleryImage, onVideoSelected]);

  const handleDoodle = () => {
    onClose();
    onDoodlePress();
  };

  // Get safe area insets for positioning
  const insets = useSafeAreaInsets();

  // Calculate menu position from bottom (above composer + tab bar + safe area)
  const menuBottomOffset = COMPOSER_HEIGHT + TAB_BAR_HEIGHT + insets.bottom + 8;

  return (
    <>
      {/* Floating Attachment Menu - using Modal for reliable full-screen backdrop */}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        {/* Backdrop - tap to close */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        {/* Floating menu - positioned above plus button */}
        <Animated.View
          style={[
            styles.menuContainer,
            {
              bottom: menuBottomOffset,
              opacity: fadeAnim,
              transform: [{ translateY: translateAnim }],
            },
          ]}
        >
          {/* Doodle - top */}
          <TouchableOpacity
            style={[styles.actionButton, styles.doodleButton]}
            onPress={handleDoodle}
            activeOpacity={0.7}
          >
            <Ionicons name="brush" size={22} color="#FF9800" />
          </TouchableOpacity>

          {/* Gallery - middle */}
          <TouchableOpacity
            style={[styles.actionButton, styles.galleryButton]}
            onPress={handleGallery}
            activeOpacity={0.7}
          >
            <Ionicons name="image" size={22} color="#2196F3" />
          </TouchableOpacity>

          {/* Camera - bottom (closest to plus button) */}
          <TouchableOpacity
            style={[styles.actionButton, styles.cameraButton]}
            onPress={handleCameraPress}
            activeOpacity={0.7}
          >
            <Ionicons name="camera" size={22} color="#4CAF50" />
          </TouchableOpacity>
        </Animated.View>
      </Modal>

      {/* In-App Camera */}
      <ChatRoomCamera
        visible={showCamera}
        onClose={handleCameraClose}
        onMediaCaptured={handleMediaCaptured}
      />

      {/* Gallery Preview Modal - shows selected media before upload */}
      <Modal
        visible={galleryPreview.visible}
        transparent={false}
        animationType="fade"
        onRequestClose={handleGalleryPreviewCancel}
      >
        <View style={[styles.previewContainer, { paddingTop: insets.top }]}>
          {/* Media preview */}
          <View style={styles.previewMediaArea}>
            {galleryPreview.type === 'image' ? (
              <Image
                source={{ uri: galleryPreview.uri }}
                style={styles.previewMedia}
                contentFit="contain"
              />
            ) : (
              <Video
                source={{ uri: galleryPreview.uri }}
                style={styles.previewMedia}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping
                isMuted={false}
                useNativeControls
              />
            )}
          </View>

          {/* Preview controls */}
          <View style={[styles.previewControls, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <TouchableOpacity style={styles.previewBtn} onPress={handleGalleryPreviewCancel}>
              <View style={[styles.previewBtnCircle, styles.cancelCircle]}>
                <Ionicons name="close" size={28} color="#FFF" />
              </View>
              <Text style={styles.previewBtnLabel}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.previewBtn} onPress={handleGalleryPreviewReselect}>
              <View style={[styles.previewBtnCircle, styles.reselectCircle]}>
                <Ionicons name="refresh" size={28} color="#FFF" />
              </View>
              <Text style={styles.previewBtnLabel}>Change</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.previewBtn} onPress={handleGalleryPreviewSend}>
              <View style={[styles.previewBtnCircle, styles.sendCircle]}>
                <Ionicons name="send" size={24} color="#FFF" />
              </View>
              <Text style={styles.previewBtnLabel}>Send</Text>
            </TouchableOpacity>
          </View>

          {/* Media type badge */}
          <View style={[styles.mediaTypeBadge, { top: insets.top + 16 }]}>
            <Ionicons
              name={galleryPreview.type === 'image' ? 'image' : 'videocam'}
              size={14}
              color="#FFF"
            />
            <Text style={styles.mediaTypeText}>
              {galleryPreview.type === 'image' ? 'Photo' : 'Video'}
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  menuContainer: {
    position: 'absolute',
    // Bottom is set dynamically based on safe area + composer + tab bar
    left: 12, // Align with plus button left edge
    alignItems: 'center',
    gap: BUTTON_SPACING,
  },
  actionButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle elevation for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  cameraButton: {
    backgroundColor: '#1A1A1F',
    borderWidth: 1.5,
    borderColor: 'rgba(76, 175, 80, 0.4)',
  },
  galleryButton: {
    backgroundColor: '#1A1A1F',
    borderWidth: 1.5,
    borderColor: 'rgba(33, 150, 243, 0.4)',
  },
  doodleButton: {
    backgroundColor: '#1A1A1F',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 152, 0, 0.4)',
  },
  // Gallery Preview styles
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewMediaArea: {
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
  reselectCircle: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  sendCircle: {
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
});
