import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

const MIN_INPUT_HEIGHT = 40;
const MAX_INPUT_HEIGHT = 120;

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onPlusPress?: () => void;
  onEmojiPress?: () => void;
  onMicPress?: () => void;
  onInputFocus?: () => void;
  /** Optional right-side extra content (e.g. Online Users button) */
  rightExtra?: React.ReactNode;
}

export default function ChatComposer({
  value,
  onChangeText,
  onSend,
  onPlusPress,
  onEmojiPress,
  onMicPress,
  onInputFocus,
  rightExtra,
}: ChatComposerProps) {
  const inputRef = useRef<TextInput>(null);
  const hasText = value.trim().length > 0;
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);

  const handleSend = useCallback(() => {
    if (!hasText) return;
    onSend();
    setInputHeight(MIN_INPUT_HEIGHT);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [hasText, onSend]);

  const handleEmojiPress = useCallback(() => {
    if (onEmojiPress) {
      onEmojiPress();
    } else {
      inputRef.current?.focus();
    }
  }, [onEmojiPress]);

  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const contentHeight = e.nativeEvent.contentSize.height;
      const newHeight = Math.min(
        MAX_INPUT_HEIGHT,
        Math.max(MIN_INPUT_HEIGHT, contentHeight)
      );
      setInputHeight(newHeight);
    },
    []
  );

  return (
    <View style={styles.container}>
      {/* Emoji — tapping focuses input for system emoji keyboard */}
      <TouchableOpacity
        onPress={handleEmojiPress}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.iconBtn}
      >
        <Ionicons name="happy-outline" size={26} color={C.textLight} />
      </TouchableOpacity>

      {/* Multiline text input — takes all remaining space */}
      <View style={[styles.inputRow, { minHeight: inputHeight + 2 }]}>
        {/* + inside the input area, left edge */}
        <TouchableOpacity
          onPress={onPlusPress}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          style={styles.plusBtn}
        >
          <Ionicons name="add" size={24} color={C.textLight} />
        </TouchableOpacity>

        <TextInput
          ref={inputRef}
          style={[styles.input, { height: inputHeight }]}
          placeholder="Type here…"
          placeholderTextColor={C.textLight}
          value={value}
          onChangeText={onChangeText}
          maxLength={2000}
          multiline
          scrollEnabled
          textAlignVertical="top"
          blurOnSubmit={false}
          onContentSizeChange={handleContentSizeChange}
          onFocus={onInputFocus}
        />
      </View>

      {/* Send or Mic */}
      {hasText ? (
        <TouchableOpacity
          onPress={handleSend}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        >
          <View style={styles.sendCircle}>
            <Ionicons name="send" size={20} color="#FFFFFF" />
          </View>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onMicPress}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          style={styles.iconBtn}
        >
          <Ionicons name="mic" size={26} color={C.textLight} />
        </TouchableOpacity>
      )}

      {/* Optional right extra (e.g. online users) */}
      {rightExtra}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: C.surface,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: C.accent,
    gap: 4,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: C.background,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.accent,
    paddingLeft: 8,
    paddingRight: 4,
  },
  plusBtn: {
    width: 28,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: C.text,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
