import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

interface BlurProfileNoticeProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Informational notice shown when a user taps "Blur my photo".
 *
 * No blocking. No hard requirements. Just clarity.
 * User can always confirm — the notice explains what's recommended
 * for better match visibility.
 */
export function BlurProfileNotice({
  visible,
  onConfirm,
  onCancel,
}: BlurProfileNoticeProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.iconContainer}>
            <Ionicons name="eye-off-outline" size={32} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>Blurred Profile</Text>

          {/* Explanation */}
          <Text style={styles.body}>
            Blurring your photo helps protect your privacy.
          </Text>

          <Text style={styles.body}>
            For better matches, we recommend:
          </Text>

          <View style={styles.recommendationsList}>
            <RecommendationRow label="Answer at least 3 prompts" />
            <RecommendationRow label="Share your interests" />
            <RecommendationRow label="Write a complete bio" />
          </View>

          <Text style={styles.reassurance}>
            You can unblur anytime when you feel comfortable.
          </Text>

          {/* Actions — always allow confirm */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelText}>Not Now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={onConfirm}
              activeOpacity={0.7}
            >
              <Text style={styles.confirmText}>Blur My Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RecommendationRow({ label }: { label: string }) {
  return (
    <View style={styles.recRow}>
      <Ionicons name="star-outline" size={16} color={COLORS.primary} />
      <Text style={styles.recLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
    marginBottom: 8,
  },
  recommendationsList: {
    marginVertical: 12,
    gap: 10,
  },
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recLabel: {
    fontSize: 14,
    color: COLORS.text,
  },
  reassurance: {
    fontSize: 13,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginTop: 4,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
});
