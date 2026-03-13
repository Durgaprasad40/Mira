import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// Popup dimensions for positioning calculations
const POPUP_WIDTH = 140;
const POPUP_HEIGHT = 88; // 2 actions × 44px each (Delete + Report)
const POPUP_MARGIN = 12;

interface MessageActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Y position of the pressed message (from top of screen) */
  pressY: number;
  /** X position of the pressed message */
  pressX: number;
  /** Whether the message is from the current user (for delete permission display) */
  isOwnMessage: boolean;
  /** Whether user can moderate (delete others' messages) - from server getMemberRole.canModerate */
  canModerate: boolean;
  onDelete?: () => void;
  onReport?: () => void;
}

export default function MessageActionsSheet({
  visible,
  onClose,
  pressY,
  pressX,
  isOwnMessage,
  canModerate,
  onDelete,
  onReport,
}: MessageActionsSheetProps) {
  if (!visible) return null;

  // ROLE SYSTEM: Determine if delete should be shown
  // - Anyone can delete their own messages
  // - Moderators (owners/admins in private rooms, platform admins in public rooms) can delete others'
  const canDelete = isOwnMessage || canModerate;

  // Dynamic height based on available actions
  const actionCount = (canDelete ? 1 : 0) + 1; // Delete (conditional) + Report
  const dynamicHeight = actionCount * 44 + 8; // 44px per action + padding

  // Calculate popup position - prefer above the message, shift if near edges
  let popupTop = pressY - dynamicHeight - 10; // 10px gap above finger
  let popupLeft = pressX - POPUP_WIDTH / 2;

  // If too close to top, show below instead
  if (popupTop < POPUP_MARGIN + 80) {
    // 80px for status bar + header
    popupTop = pressY + 20; // 20px below finger
  }

  // If too close to bottom, shift up
  if (popupTop + dynamicHeight > SCREEN_HEIGHT - POPUP_MARGIN) {
    popupTop = SCREEN_HEIGHT - dynamicHeight - POPUP_MARGIN;
  }

  // Keep within horizontal bounds
  if (popupLeft < POPUP_MARGIN) {
    popupLeft = POPUP_MARGIN;
  }
  if (popupLeft + POPUP_WIDTH > SCREEN_WIDTH - POPUP_MARGIN) {
    popupLeft = SCREEN_WIDTH - POPUP_WIDTH - POPUP_MARGIN;
  }

  const handleDelete = () => {
    onDelete?.();
    onClose();
  };

  const handleReport = () => {
    onReport?.();
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      {/* Backdrop - tap to close */}
      <TouchableOpacity
        style={styles.backdrop}
        onPress={onClose}
        activeOpacity={1}
      />

      {/* Compact popup menu */}
      <View style={[styles.popup, { top: popupTop, left: popupLeft }]}>
        {/* Delete action - only if user can delete */}
        {canDelete && (
          <TouchableOpacity style={styles.action} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={18} color="#FF6B6B" />
            <Text style={[styles.actionText, { color: '#FF6B6B' }]}>Delete</Text>
          </TouchableOpacity>
        )}

        {/* Report action */}
        <TouchableOpacity style={styles.action} onPress={handleReport}>
          <Ionicons name="flag-outline" size={18} color={C.primary} />
          <Text style={[styles.actionText, { color: C.primary }]}>Report</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  popup: {
    position: 'absolute',
    width: POPUP_WIDTH,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 4,
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    // Shadow for Android
    elevation: 8,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
    color: C.text,
  },
});
