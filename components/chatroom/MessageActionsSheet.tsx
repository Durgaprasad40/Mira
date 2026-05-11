import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import ReactionBar, { ReactionEmoji } from './ReactionBar';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// Popup dimensions for positioning calculations
const POPUP_WIDTH = 184;
const REACTION_BAR_WIDTH = 256; // 6 emojis × 40px + padding
const REACTION_BAR_HEIGHT = 56;
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
  onReply?: () => void;
  /** Called when user selects a reaction emoji */
  onReact?: (emoji: ReactionEmoji) => void;
  /** Currently selected reaction (if user already reacted) */
  selectedReaction?: ReactionEmoji | null;
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
  onReply,
  onReact,
  selectedReaction,
}: MessageActionsSheetProps) {
  // FLICKER-FIX: Use internal mounted state to control rendering
  // Only mount content when explicitly triggered (visible=true)
  const [shouldRender, setShouldRender] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasAnimatedIn = useRef(false);

  useEffect(() => {
    if (visible) {
      // Mount content and animate in
      setShouldRender(true);
      hasAnimatedIn.current = true;
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    } else if (hasAnimatedIn.current) {
      // Animate out then unmount
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }).start(() => {
        setShouldRender(false);
        hasAnimatedIn.current = false;
      });
    }
  }, [visible, fadeAnim]);

  // FLICKER-FIX: Don't render anything until explicitly triggered
  if (!shouldRender) return null;

  // ROLE SYSTEM: Determine if delete should be shown
  // - Anyone can delete their own messages
  // - Moderators (owners/admins in private rooms, platform admins in public rooms) can delete others'
  const canDelete = isOwnMessage || canModerate;

  // OWN VS OTHER MESSAGE DIFFERENTIATION:
  // Own messages: Reply + Delete only (no Report, no Reactions)
  // Other messages: Reply + Report + Reactions
  const showReactions = !isOwnMessage;
  const showReport = !isOwnMessage;

  // Dynamic height based on available actions
  // Own message: Reply + Delete = 2 actions
  // Other message: Reply + Report = 2 actions (Delete only if moderator)
  let actionCount = 1; // Reply is always shown
  if (canDelete) actionCount += 1; // Delete (own message or moderator)
  if (showReport) actionCount += 1; // Report (only for other messages)
  const dynamicHeight = actionCount * 44 + 8; // 44px per action + padding

  // Total height including reaction bar (only for other messages)
  const totalHeight = showReactions
    ? REACTION_BAR_HEIGHT + 8 + dynamicHeight // reaction bar + gap + actions
    : dynamicHeight; // just actions for own messages

  // Calculate popup position - prefer above the message, shift if near edges
  let popupTop = pressY - totalHeight - 10; // 10px gap above finger
  let popupLeft = pressX - POPUP_WIDTH / 2;

  // Calculate reaction bar position (centered above popup)
  let reactionBarLeft = pressX - REACTION_BAR_WIDTH / 2;

  // If too close to top, show below instead
  if (popupTop < POPUP_MARGIN + 80) {
    // 80px for status bar + header
    popupTop = pressY + 20; // 20px below finger
  }

  // If too close to bottom, shift up
  if (popupTop + totalHeight > SCREEN_HEIGHT - POPUP_MARGIN) {
    popupTop = SCREEN_HEIGHT - totalHeight - POPUP_MARGIN;
  }

  // Keep within horizontal bounds for popup
  if (popupLeft < POPUP_MARGIN) {
    popupLeft = POPUP_MARGIN;
  }
  if (popupLeft + POPUP_WIDTH > SCREEN_WIDTH - POPUP_MARGIN) {
    popupLeft = SCREEN_WIDTH - POPUP_WIDTH - POPUP_MARGIN;
  }

  // Keep reaction bar within bounds
  if (reactionBarLeft < POPUP_MARGIN) {
    reactionBarLeft = POPUP_MARGIN;
  }
  if (reactionBarLeft + REACTION_BAR_WIDTH > SCREEN_WIDTH - POPUP_MARGIN) {
    reactionBarLeft = SCREEN_WIDTH - REACTION_BAR_WIDTH - POPUP_MARGIN;
  }

  const handleReply = () => {
    onReply?.();
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

  const handleReact = (emoji: ReactionEmoji) => {
    onReact?.(emoji);
    onClose();
  };

  return (
    <Modal transparent visible={shouldRender} animationType="none" onRequestClose={onClose}>
      {/* FLICKER-FIX: Wrap everything in Animated.View for controlled fade */}
      <Animated.View style={[styles.fullScreen, { opacity: fadeAnim }]}>
        {/* Backdrop - tap to close */}
        <TouchableOpacity
          style={styles.backdrop}
          onPress={onClose}
          activeOpacity={1}
        />

        {/* Reaction bar - above the action menu (only for other users' messages) */}
        {showReactions && (
          <View style={[styles.reactionBarContainer, { top: popupTop, left: reactionBarLeft }]}>
            <ReactionBar
              onReact={handleReact}
              selectedEmoji={selectedReaction}
            />
          </View>
        )}

        {/* Compact popup menu */}
        <View style={[styles.popup, { top: showReactions ? popupTop + REACTION_BAR_HEIGHT + 8 : popupTop, left: popupLeft }]}>
          {/* Reply action - always shown */}
          <TouchableOpacity style={styles.action} onPress={handleReply}>
            <Ionicons name="arrow-undo-outline" size={18} color={C.text} />
            <Text style={styles.actionText}>Reply</Text>
          </TouchableOpacity>

          {/* Delete action - only if user can delete (own message or moderator) */}
          {canDelete && (
            <TouchableOpacity style={styles.action} onPress={handleDelete}>
              <Ionicons name="trash-outline" size={18} color="#FF6B6B" />
              <Text style={[styles.actionText, { color: '#FF6B6B' }]}>Delete</Text>
            </TouchableOpacity>
          )}

          {/* Report action - only for other users' messages */}
          {showReport && (
            <TouchableOpacity style={styles.action} onPress={handleReport}>
              <Ionicons name="flag-outline" size={18} color={C.primary} />
              <Text style={[styles.actionText, { color: C.primary }]}>Report this message</Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    ...StyleSheet.absoluteFillObject,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  reactionBarContainer: {
    position: 'absolute',
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
