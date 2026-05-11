/**
 * Phase2CameraPhotoSheet — secure media review + options bottom sheet for
 * Phase-2 (Deep Connect) Messages. UX parity with Phase-1 CameraPhotoSheet:
 *   - Thumbnail preview of the captured/picked photo or video
 *   - Normal / view-once / timed delivery options
 *   - Cancel / Send actions
 *
 * Differences from Phase-1:
 *   - Uses INCOGNITO_COLORS (Phase-2 dark navy + rose/pink primary)
 *   - Confirm payload uses Phase-2 privateMessages fields only.
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
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.5;

const C = INCOGNITO_COLORS;

export interface Phase2CameraPhotoOptions {
  /** Protected media timer in seconds. 0 means normal unless viewOnce is true. */
  timer: 0 | 30 | 60;
  /** True for one successful recipient view, with no countdown timer. */
  viewOnce: boolean;
  /** Phase-2 backend value */
  viewingMode: 'tap' | 'hold';
}

interface Phase2CameraPhotoSheetProps {
  visible: boolean;
  imageUri: string | null;
  mediaType?: 'photo' | 'video';
  onConfirm: (imageUri: string, options: Phase2CameraPhotoOptions) => void;
  onCancel: () => void;
}

const TIMER_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Normal', value: 0 },
  { label: 'View once', value: -1 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
];

export function Phase2CameraPhotoSheet({
  visible,
  imageUri,
  mediaType = 'photo',
  onConfirm,
  onCancel,
}: Phase2CameraPhotoSheetProps) {
  const isVideo = mediaType === 'video';
  const insets = useSafeAreaInsets();
  const [timer, setTimer] = useState<number>(0);

  useEffect(() => {
    if (!visible) setTimer(0);
  }, [visible]);

  const handleSend = () => {
    if (!imageUri) return;
    const viewOnce = timer === -1;
    const protectedMediaTimer = viewOnce ? 0 : timer;
    onConfirm(imageUri, {
      timer: protectedMediaTimer as 0 | 30 | 60,
      viewOnce,
      viewingMode: 'tap',
    });
    setTimer(0);
  };

  const handleCancel = () => {
    setTimer(0);
    onCancel();
  };

  if (!visible || !imageUri) return null;

  const subtitle =
    timer === -1
      ? `${isVideo ? 'Video' : 'Photo'} closes after the first successful view`
      : timer > 0
        ? `${isVideo ? 'Video' : 'Photo'} expires ${timer}s after it is opened`
        : `${isVideo ? 'Video' : 'Photo'} stays protected and opens on tap`;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={handleCancel}>
        <Pressable
          style={[
            styles.sheet,
            { height: SHEET_HEIGHT, paddingBottom: insets.bottom + 16 },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          <View style={styles.body}>
            <View style={styles.headerRow}>
              <View style={styles.thumbnailWrap}>
                <Image
                  source={{ uri: imageUri }}
                  style={styles.thumbnail}
                  contentFit="cover"
                />
                {isVideo && (
                  <View style={styles.videoBadge}>
                    <Ionicons name="videocam" size={12} color="#FFF" />
                  </View>
                )}
              </View>
              <View style={styles.headerText}>
                <View style={styles.titleRow}>
                  <Ionicons
                    name="shield-checkmark"
                    size={18}
                    color={C.primary}
                  />
                  <Text style={styles.secureTitle}>
                    {isVideo ? 'Secure Video' : 'Secure Photo'}
                  </Text>
                </View>
                <Text style={styles.secureSubtitle}>{subtitle}</Text>
              </View>
            </View>

            <View style={styles.optionSection}>
              <Text style={styles.sectionLabel}>TIME</Text>
              <View style={styles.timerButtons}>
                {TIMER_OPTIONS.map((opt) => {
                  const active = timer === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.timerButton, active && styles.timerButtonActive]}
                      onPress={() => setTimer(opt.value)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.timerButtonText,
                          active && styles.timerButtonTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.timerHint}>
                Timer starts only after the recipient opens the media.
              </Text>
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancel}
                activeOpacity={0.85}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sendButton}
                onPress={handleSend}
                activeOpacity={0.85}
              >
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
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 12,
  },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: C.accent,
  },
  videoBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    padding: 2,
  },
  headerText: { flex: 1, marginLeft: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secureTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  secureSubtitle: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 4,
    lineHeight: 17,
  },
  optionSection: { marginBottom: 16 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textLight,
    letterSpacing: 1,
    marginBottom: 10,
  },
  timerButtons: { flexDirection: 'row', gap: 8 },
  timerButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: C.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  timerButtonActive: {
    backgroundColor: C.primary,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  timerButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
  },
  timerButtonTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  timerHint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: C.textLight,
  },
  actionButtons: { flexDirection: 'row', gap: 12 },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.surface,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  sendButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
});
