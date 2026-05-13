/**
 * CONFESSION CONTEXT MENU
 * Small premium floating popup card for confession actions.
 *
 * - Owner: Title "Your confession" + Edit / Delete rows + Cancel
 * - Non-owner: Title "Report this confession" + horizontal [Cancel] [Report] buttons
 *
 * Tapping Report invokes the existing onReport callback (which opens the
 * report-reason picker in the parent screen). Backdrop tap, Cancel, and
 * Android hardware back all dismiss the popup.
 */
import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, FONT_SIZE, FONT_WEIGHT, SPACING, lineHeight } from '@/lib/constants';

interface ConfessionMenuSheetProps {
  visible: boolean;
  isOwner: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
}

export function ConfessionMenuSheet({
  visible,
  isOwner,
  onClose,
  onEdit,
  onDelete,
  onReport,
}: ConfessionMenuSheetProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(330, Math.max(280, width - SPACING.xl * 2));

  const title = isOwner ? 'Your confession' : 'Report this confession';
  const subtitle = isOwner ? null : 'Choose an action.';

  // CRITICAL: call action handler FIRST, then close, so the parent has a
  // chance to capture menuTargetConfession before it is cleared.
  const handleEdit = () => {
    onEdit?.();
    onClose();
  };

  const handleDelete = () => {
    onDelete?.();
    onClose();
  };

  const handleReport = () => {
    onReport?.();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close confession options"
      >
        <View
          style={[
            styles.cardWrap,
            {
              paddingBottom: Math.max(insets.bottom, SPACING.md),
              paddingTop: Math.max(insets.top, SPACING.md),
            },
          ]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[styles.card, { width: cardWidth }]}
          >
            <View style={styles.header}>
              <Text
                maxFontSizeMultiplier={1.2}
                style={isOwner ? styles.ownerLabel : styles.title}
                accessibilityRole={isOwner ? 'header' : undefined}
              >
                {isOwner ? title.toUpperCase() : title}
              </Text>
              {subtitle ? (
                <Text maxFontSizeMultiplier={1.2} style={styles.subtitle}>
                  {subtitle}
                </Text>
              ) : null}
            </View>

            {isOwner ? (
              <View style={styles.ownerOptionGroup}>
                <TouchableOpacity
                  style={styles.ownerOptionCard}
                  onPress={handleEdit}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel="Edit your confession"
                >
                  <View
                    style={[styles.iconWrap, { backgroundColor: `${COLORS.primary}14` }]}
                  >
                    <Ionicons name="pencil" size={18} color={COLORS.primary} />
                  </View>
                  <Text maxFontSizeMultiplier={1.2} style={styles.ownerOptionText}>
                    Edit
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ownerOptionCard}
                  onPress={handleDelete}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel="Delete your confession"
                >
                  <View
                    style={[styles.iconWrap, { backgroundColor: `${COLORS.error}14` }]}
                  >
                    <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                  </View>
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={[styles.ownerOptionText, styles.optionTextDestructive]}
                  >
                    Delete
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.ownerOptionCard, styles.ownerOptionCardCancel]}
                  onPress={onClose}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <View
                    style={[styles.iconWrap, { backgroundColor: COLORS.backgroundDark }]}
                  >
                    <Ionicons name="close" size={18} color={COLORS.textLight} />
                  </View>
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={[styles.ownerOptionText, styles.ownerOptionTextNeutral]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.rowButton, styles.rowButtonNeutral]}
                  onPress={onClose}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text maxFontSizeMultiplier={1.2} style={styles.rowButtonNeutralText}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.rowButton, styles.rowButtonPrimary]}
                  onPress={handleReport}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Report confession"
                >
                  <Ionicons name="flag-outline" size={16} color={COLORS.white} />
                  <Text maxFontSizeMultiplier={1.2} style={styles.rowButtonPrimaryText}>
                    Report
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    // Extremely subtle wash so the screen behind stays clearly visible.
    backgroundColor: 'rgba(0,0,0,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 14,
  },
  header: {
    paddingHorizontal: SPACING.xs,
    paddingBottom: SPACING.sm,
    alignItems: 'center',
  },
  title: {
    fontSize: FONT_SIZE.md,
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.md, 1.2),
  },
  // Owner-mode label header — small, quiet, premium uppercase tag instead
  // of a bold heavy title above the action group.
  ownerLabel: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '700',
    color: COLORS.textMuted,
    textAlign: 'center',
    letterSpacing: 0.6,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.3),
  },
  subtitle: {
    marginTop: 2,
    fontSize: FONT_SIZE.caption,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.caption, 1.3),
  },
  // Owner-mode horizontal Edit / Delete / Cancel row.
  ownerOptionGroup: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'transparent',
    marginTop: SPACING.xxs,
  },
  ownerOptionCard: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  ownerOptionText: {
    fontSize: FONT_SIZE.body2,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.text,
  },
  ownerOptionTextNeutral: {
    color: COLORS.textLight,
  },
  ownerOptionCardCancel: {
    backgroundColor: COLORS.backgroundDark,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTextDestructive: {
    color: COLORS.error,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xxs,
  },
  rowButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACING.md,
  },
  rowButtonNeutral: {
    backgroundColor: COLORS.backgroundDark,
  },
  rowButtonNeutralText: {
    fontSize: FONT_SIZE.body2,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.textLight,
  },
  rowButtonPrimary: {
    backgroundColor: COLORS.error,
  },
  rowButtonPrimaryText: {
    fontSize: FONT_SIZE.body2,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.white,
  },
});
