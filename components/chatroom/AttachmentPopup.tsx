import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { INCOGNITO_COLORS } from '@/lib/constants';
import ChatRoomCamera, { ChatRoomMediaResult } from './ChatRoomCamera';

const C = INCOGNITO_COLORS;

// Max video duration for chat rooms (30 seconds)
const MAX_VIDEO_DURATION_SECONDS = 30;

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

      // Brief delay to let modal animation complete
      await new Promise(resolve => setTimeout(resolve, 200));

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
          onVideoSelected(asset.uri);
        } else {
          onGalleryImage(asset.uri);
        }
      }
    } catch {
      Alert.alert('Error', 'Could not open photo library. Please try again.');
    }
  };

  const handleDoodle = () => {
    onClose();
    onDoodlePress();
  };

  return (
    <>
      {/* Attachment Menu */}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={onClose}
        >
          <View style={styles.popup}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <TouchableOpacity style={styles.option} onPress={handleCameraPress} activeOpacity={0.7}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(76,175,80,0.15)' }]}>
                  <Ionicons name="camera" size={24} color="#4CAF50" />
                </View>
                <Text style={styles.optionText}>Camera</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.option} onPress={handleGallery} activeOpacity={0.7}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(33,150,243,0.15)' }]}>
                  <Ionicons name="image" size={24} color="#2196F3" />
                </View>
                <Text style={styles.optionText}>Gallery</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.option} onPress={handleDoodle} activeOpacity={0.7}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,152,0,0.15)' }]}>
                  <Ionicons name="brush" size={24} color="#FF9800" />
                </View>
                <Text style={styles.optionText}>Doodle</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* In-App Camera */}
      <ChatRoomCamera
        visible={showCamera}
        onClose={handleCameraClose}
        onMediaCaptured={handleMediaCaptured}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  popup: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: C.accent,
  },
  scrollContent: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 20,
  },
  option: {
    alignItems: 'center',
    gap: 6,
    width: 60,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    fontSize: 11,
    fontWeight: '600',
    color: C.text,
  },
});
