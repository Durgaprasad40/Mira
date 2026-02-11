/**
 * CameraPhotoSheet - Bottom sheet for secure photo options.
 *
 * LOCKED UI:
 * - NO camera view (gallery picker handled externally)
 * - NO photo preview shown
 * - NO blur
 * - NO crop/edit
 * - Static placeholder with lock icon
 * - Timer: Once / 3s / 10s / 30s / 60s
 * - Viewing mode: Timed / Hold
 * - Cancel / Send buttons
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/lib/constants';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.48; // ~48% of screen for options only

export interface CameraPhotoOptions {
  timer: number; // 0 = once, 3, 10, 30, 60
  viewingMode: 'tap' | 'hold';
}

interface CameraPhotoSheetProps {
  visible: boolean;
  /** URI of the image picked from gallery */
  imageUri: string | null;
  onConfirm: (imageUri: string, options: CameraPhotoOptions) => void;
  onCancel: () => void;
}

const TIMER_OPTIONS = [
  { label: 'Once', value: 0 },
  { label: '3s', value: 3 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
];

export function CameraPhotoSheet({
  visible,
  imageUri,
  onConfirm,
  onCancel,
}: CameraPhotoSheetProps) {
  const insets = useSafeAreaInsets();

  // State
  const [timer, setTimer] = useState(0); // Default: Once
  const [viewingMode, setViewingMode] = useState<'tap' | 'hold'>('tap');

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setTimer(0);
      setViewingMode('tap');
    }
  }, [visible]);

  const handleSend = () => {
    if (!imageUri) return;
    onConfirm(imageUri, { timer, viewingMode });
    // Reset for next use
    setTimer(0);
    setViewingMode('tap');
  };

  const handleCancel = () => {
    setTimer(0);
    setViewingMode('tap');
    onCancel();
  };

  // Don't render if no imageUri
  if (!visible || !imageUri) return null;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={handleCancel}>
        <Pressable
          style={[styles.sheet, { height: SHEET_HEIGHT, paddingBottom: insets.bottom + 16 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          {/* Header: Thumbnail + Title */}
          <View style={styles.optionsContainer}>
            <View style={styles.headerRow}>
              <Image
                source={{ uri: imageUri }}
                style={styles.thumbnail}
                contentFit="cover"
              />
              <View style={styles.headerTextContainer}>
                <View style={styles.titleRow}>
                  <Ionicons name="shield-checkmark" size={18} color={COLORS.primary} />
                  <Text style={styles.secureTitle}>Secure Photo</Text>
                </View>
                <Text style={styles.secureSubtitle}>Photo disappears after viewing once</Text>
              </View>
            </View>

            {/* TIME selector */}
            <View style={styles.optionSection}>
              <Text style={styles.sectionLabel}>TIME</Text>
              <View style={styles.timerButtons}>
                {TIMER_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.timerButton,
                      timer === opt.value && styles.timerButtonActive,
                    ]}
                    onPress={() => setTimer(opt.value)}
                  >
                    <Text
                      style={[
                        styles.timerButtonText,
                        timer === opt.value && styles.timerButtonTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Viewing mode: Timed / Hold */}
            <View style={styles.viewingModeContainer}>
              <TouchableOpacity
                style={[
                  styles.viewingModeButton,
                  viewingMode === 'tap' && styles.viewingModeButtonActive,
                ]}
                onPress={() => setViewingMode('tap')}
              >
                <Text
                  style={[
                    styles.viewingModeText,
                    viewingMode === 'tap' && styles.viewingModeTextActive,
                  ]}
                >
                  Timed
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.viewingModeButton,
                  viewingMode === 'hold' && styles.viewingModeButtonActive,
                ]}
                onPress={() => setViewingMode('hold')}
              >
                <Text
                  style={[
                    styles.viewingModeText,
                    viewingMode === 'hold' && styles.viewingModeTextActive,
                  ]}
                >
                  Hold
                </Text>
              </TouchableOpacity>
            </View>

            {/* Cancel / Send buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
                <Text style={styles.sendButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
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
    marginBottom: 8,
  },

  // Options container
  optionsContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  // Header row: thumbnail + title/subtitle
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 12,
  },
  thumbnail: {
    width: 52,
    height: 52,
    borderRadius: 8,
  },
  headerTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secureTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  secureSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },

  // Timer section
  optionSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 10,
  },
  timerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  timerButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
  },
  timerButtonActive: {
    backgroundColor: COLORS.primary,
  },
  timerButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  timerButtonTextActive: {
    color: COLORS.white,
  },

  // Viewing mode
  viewingModeContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  viewingModeButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  viewingModeButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  viewingModeText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  viewingModeTextActive: {
    color: COLORS.white,
  },

  // Action buttons
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  sendButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
});
