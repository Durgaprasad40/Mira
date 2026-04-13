/**
 * CONFESSION CONTEXT MENU
 * Premium floating context menu for confession actions.
 * HORIZONTAL ROW layout: [Edit] [Delete] [Cancel] or [Report] [Cancel]
 * NO bottom sheet, NO dark backdrop, NO slide animation.
 *
 * Shows different options based on ownership:
 * - Owner: "Your confession" title + [Edit] [Delete] [Cancel]
 * - Non-owner: [Report] [Cancel]
 */
import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

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

  // CRITICAL: Call action handler FIRST, then close menu
  // Previously: onClose() cleared menuTargetConfession before onEdit() could use it
  const handleEdit = () => {
    console.log('[EDIT_MENU_TAP] Edit button pressed, onEdit exists:', !!onEdit);
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
    <Modal visible={visible} transparent animationType="fade">
      {/* Transparent overlay - tap to dismiss */}
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* Centered floating menu container */}
        <View style={styles.menuContainer}>
          <Pressable
            style={styles.menu}
            onPress={(e) => e.stopPropagation()}
          >
            {isOwner ? (
              // Owner: Title + horizontal row [Edit] [Delete] [Cancel]
              <>
                <Text style={styles.menuTitle}>Your confession</Text>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={handleEdit}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="pencil" size={16} color={COLORS.text} />
                    <Text style={styles.actionButtonText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonDestructive]}
                    onPress={handleDelete}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={16} color="#DC2626" />
                    <Text style={[styles.actionButtonText, styles.actionButtonTextDestructive]}>
                      Delete
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonMuted]}
                    onPress={onClose}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.actionButtonTextMuted}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              // Non-owner: horizontal row [Report] [Cancel]
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonDestructive]}
                  onPress={handleReport}
                  activeOpacity={0.7}
                >
                  <Ionicons name="flag-outline" size={16} color="#DC2626" />
                  <Text style={[styles.actionButtonText, styles.actionButtonTextDestructive]}>
                    Report
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonMuted]}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actionButtonTextMuted}>Cancel</Text>
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
  // Transparent overlay - NO dark backdrop
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Container for centering
  menuContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Floating menu card
  menu: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    // Premium soft shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },

  // Title for owner menu
  menuTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.2,
  },

  // Horizontal button row
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  // Individual action button
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    minWidth: 70,
  },

  // Destructive button (delete/report)
  actionButtonDestructive: {
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
  },

  // Muted button (cancel)
  actionButtonMuted: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Button text
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Destructive text
  actionButtonTextDestructive: {
    color: '#DC2626',
  },

  // Muted text (cancel)
  actionButtonTextMuted: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
});
