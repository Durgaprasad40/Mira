import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, FONT_SIZE, FONT_WEIGHT, SPACING, lineHeight } from '@/lib/constants';

export type ReportReasonKey =
  | 'sexual_content'
  | 'threats_violence'
  | 'targeting_someone'
  | 'private_information'
  | 'scam_promotion'
  | 'other';

interface ReportConfessionSheetProps {
  visible: boolean;
  mode?: 'confession' | 'reply';
  onClose: () => void;
  onSubmit: (reason: ReportReasonKey) => void | Promise<void>;
}

const REPORT_REASONS: Array<{
  key: ReportReasonKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}> = [
  { key: 'sexual_content', label: 'Sexual content', icon: 'eye-off-outline', color: COLORS.primary },
  { key: 'threats_violence', label: 'Threats or violence', icon: 'warning-outline', color: '#E6A100' },
  { key: 'targeting_someone', label: 'Targeting someone', icon: 'person-remove-outline', color: '#8B5CF6' },
  { key: 'private_information', label: 'Sharing private information', icon: 'lock-closed-outline', color: '#3B82F6' },
  { key: 'scam_promotion', label: 'Scam or promotion', icon: 'pricetag-outline', color: '#F97316' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline', color: COLORS.textLight },
];

export function ReportConfessionSheet({
  visible,
  mode = 'confession',
  onClose,
  onSubmit,
}: ReportConfessionSheetProps) {
  const insets = useSafeAreaInsets();
  const [submittingReason, setSubmittingReason] = useState<ReportReasonKey | null>(null);
  const bottomPadding = Math.max(insets.bottom, SPACING.md);
  const title = mode === 'reply' ? 'Report comment' : 'Report confession';
  const subtitle =
    mode === 'reply'
      ? "What's wrong with this comment?"
      : "What's wrong with this confession?";
  const isSubmitting = submittingReason !== null;

  useEffect(() => {
    if (!visible) {
      setSubmittingReason(null);
    }
  }, [visible]);

  const handleSubmit = async (reason: ReportReasonKey) => {
    if (isSubmitting) return;
    setSubmittingReason(reason);
    try {
      await onSubmit(reason);
    } finally {
      setSubmittingReason(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.backdrop}
          onPress={isSubmitting ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Close report options"
        />

        <View style={[styles.sheet, { paddingBottom: bottomPadding }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text maxFontSizeMultiplier={1.2} style={styles.title}>
              {title}
            </Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.subtitle}>
              {subtitle}
            </Text>
          </View>

          <View style={styles.optionGroup}>
            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason.key}
                style={[styles.optionRow, isSubmitting && styles.optionRowDisabled]}
                onPress={() => { void handleSubmit(reason.key); }}
                disabled={isSubmitting}
                activeOpacity={0.78}
                accessibilityRole="button"
                accessibilityLabel={reason.label}
              >
                <View style={[styles.iconWrap, { backgroundColor: `${reason.color}14` }]}>
                  <Ionicons name={reason.icon} size={20} color={reason.color} />
                </View>
                <Text maxFontSizeMultiplier={1.2} style={styles.optionText}>
                  {reason.label}
                </Text>
                {submittingReason === reason.key ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                )}
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.cancelRow}
            onPress={onClose}
            disabled={isSubmitting}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Cancel report"
          >
            <Text maxFontSizeMultiplier={1.2} style={styles.cancelText}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 18,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  header: {
    paddingHorizontal: SPACING.xs,
    paddingBottom: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.18),
  },
  subtitle: {
    marginTop: SPACING.xxs,
    fontSize: FONT_SIZE.body2,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.3),
  },
  optionGroup: {
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
    overflow: 'hidden',
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  optionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  optionRowDisabled: {
    opacity: 0.65,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
    fontSize: FONT_SIZE.body2,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.text,
  },
  cancelRow: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: FONT_SIZE.body2,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.textLight,
  },
});
