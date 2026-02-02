import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Switch,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/lib/constants';

export interface ProtectedMediaOptions {
  timer: number;
  screenshotAllowed: boolean;
  viewOnce: boolean;
  watermark: boolean;
}

interface ProtectedMediaOptionsSheetProps {
  visible: boolean;
  imageUri: string;
  onConfirm: (options: ProtectedMediaOptions) => void;
  onCancel: () => void;
}

const TIMER_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '3s', value: 3 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
];

export function ProtectedMediaOptionsSheet({
  visible,
  imageUri,
  onConfirm,
  onCancel,
}: ProtectedMediaOptionsSheetProps) {
  const insets = useSafeAreaInsets();
  const [timer, setTimer] = useState(0);
  const [screenshotAllowed, setScreenshotAllowed] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
  const [watermark, setWatermark] = useState(false);

  const handleConfirm = () => {
    onConfirm({ timer, screenshotAllowed, viewOnce, watermark });
    // Reset for next use
    setTimer(0);
    setScreenshotAllowed(false);
    setViewOnce(false);
    setWatermark(false);
  };

  const handleCancel = () => {
    setTimer(0);
    setScreenshotAllowed(false);
    setViewOnce(false);
    setWatermark(false);
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={handleCancel}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          <Text style={styles.title}>Protected Photo</Text>

          {/* Preview */}
          <View style={styles.previewContainer}>
            <Image
              source={{ uri: imageUri }}
              style={styles.preview}
              contentFit="cover"
            />
          </View>

          {/* Timer */}
          <View style={styles.optionSection}>
            <View style={styles.optionHeader}>
              <Ionicons name="timer-outline" size={20} color={COLORS.text} />
              <Text style={styles.optionLabel}>Timer</Text>
            </View>
            <View style={styles.segmentedButtons}>
              {TIMER_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.segmentButton,
                    timer === opt.value && styles.segmentButtonActive,
                  ]}
                  onPress={() => setTimer(opt.value)}
                >
                  <Text
                    style={[
                      styles.segmentButtonText,
                      timer === opt.value && styles.segmentButtonTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Screenshot Allowed */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Ionicons name="camera-outline" size={20} color={COLORS.text} />
              <Text style={styles.optionLabel}>Allow screenshots</Text>
            </View>
            <Switch
              value={screenshotAllowed}
              onValueChange={setScreenshotAllowed}
              trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
              thumbColor={screenshotAllowed ? COLORS.primary : COLORS.backgroundDark}
            />
          </View>

          {/* View Once */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Ionicons name="eye-off-outline" size={20} color={COLORS.text} />
              <Text style={styles.optionLabel}>View once</Text>
            </View>
            <Switch
              value={viewOnce}
              onValueChange={setViewOnce}
              trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
              thumbColor={viewOnce ? COLORS.primary : COLORS.backgroundDark}
            />
          </View>

          {/* Watermark */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Ionicons name="water-outline" size={20} color={COLORS.text} />
              <Text style={styles.optionLabel}>Watermark</Text>
            </View>
            <Switch
              value={watermark}
              onValueChange={setWatermark}
              trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
              thumbColor={watermark ? COLORS.primary : COLORS.backgroundDark}
            />
          </View>

          {/* Buttons */}
          <TouchableOpacity style={styles.sendButton} onPress={handleConfirm}>
            <Ionicons name="shield-checkmark" size={20} color={COLORS.white} />
            <Text style={styles.sendButtonText}>Send Protected Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
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
    padding: 20,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  previewContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  preview: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
  },
  optionSection: {
    marginBottom: 16,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  segmentedButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: COLORS.primary,
  },
  segmentButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  segmentButtonTextActive: {
    color: COLORS.white,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  cancelButtonText: {
    fontSize: 15,
    color: COLORS.textLight,
  },
});
