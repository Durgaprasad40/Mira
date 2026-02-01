import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MessageActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  messageText: string;
  senderName: string;
  onReply?: () => void;
  onReport?: () => void;
}

export default function MessageActionsSheet({
  visible,
  onClose,
  messageText,
  senderName,
  onReply,
  onReport,
}: MessageActionsSheetProps) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [visible]);

  if (!visible) return null;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(messageText);
    onClose();
  };

  const handleReply = () => {
    onReply?.();
    onClose();
  };

  const handleReport = () => {
    onReport?.();
    onClose();
  };

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        {/* Message preview */}
        <View style={styles.preview}>
          <Text style={styles.previewSender}>{senderName}</Text>
          <Text style={styles.previewText} numberOfLines={2}>
            {messageText}
          </Text>
        </View>

        {/* Actions */}
        <TouchableOpacity style={styles.action} onPress={handleCopy}>
          <Ionicons name="copy-outline" size={20} color={C.text} />
          <Text style={styles.actionText}>Copy</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.action} onPress={handleReply}>
          <Ionicons name="arrow-undo-outline" size={20} color={C.text} />
          <Text style={styles.actionText}>Reply</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.action} onPress={handleReport}>
          <Ionicons name="flag-outline" size={20} color={C.primary} />
          <Text style={[styles.actionText, { color: C.primary }]}>Report</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 150,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    alignSelf: 'center',
    marginBottom: 16,
  },
  preview: {
    backgroundColor: C.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  previewSender: {
    fontSize: 12,
    fontWeight: '700',
    color: C.primary,
    marginBottom: 4,
  },
  previewText: {
    fontSize: 14,
    color: C.text,
    lineHeight: 19,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '500',
    color: C.text,
  },
  cancelButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 20,
    backgroundColor: C.accent,
    marginTop: 16,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
});
