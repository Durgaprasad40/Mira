import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

const MIN_INPUT_HEIGHT = 40;
const MAX_INPUT_HEIGHT = 120;

export type ComposerPanel = 'none';

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Called when send is pressed. Can be async. If it throws, text is preserved. */
  onSend: () => void | Promise<void>;
  onPlusPress?: () => void;
  onMicPress?: () => void;
  onInputFocus?: () => void;
  onPanelChange?: (panel: ComposerPanel) => void;
}

export default function ChatComposer({
  value,
  onChangeText,
  onSend,
  onPlusPress,
  onMicPress,
  onInputFocus,
}: ChatComposerProps) {
  const inputRef = useRef<TextInput>(null);
  const hasText = value.trim().length > 0;
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const [isSending, setIsSending] = useState(false);

  const handleSend = useCallback(async () => {
    if (!hasText || isSending) return;
    const textBeforeSend = value;
    setIsSending(true);
    try {
      await onSend();
      setInputHeight(MIN_INPUT_HEIGHT);
    } catch {
      // Restore text on failure (parent may have cleared it)
      onChangeText(textBeforeSend);
      Alert.alert('Send Failed', 'Message could not be sent. Please try again.');
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [hasText, isSending, value, onSend, onChangeText]);

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
      {/* + Attachments */}
      <TouchableOpacity onPress={onPlusPress} style={styles.iconBtn}>
        <Ionicons name="add" size={22} color={C.textLight} />
      </TouchableOpacity>

      {/* Multiline text input */}
      <View style={[styles.inputRow, { minHeight: inputHeight + 2 }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { height: inputHeight }]}
          placeholder="Type here..."
          placeholderTextColor={C.textLight}
          value={value}
          onChangeText={onChangeText}
          maxLength={2000}
          multiline
          scrollEnabled
          textAlignVertical="top"
          blurOnSubmit={false}
          onContentSizeChange={handleContentSizeChange}
          onFocus={() => {
            onInputFocus?.();
          }}
        />
      </View>

      {/* Voice */}
      <TouchableOpacity onPress={onMicPress} style={styles.iconBtn}>
        <Ionicons name="mic" size={22} color={C.textLight} />
      </TouchableOpacity>

      {/* Send (visible when there is text) */}
      {hasText && (
        <TouchableOpacity
          onPress={handleSend}
          style={[styles.sendCircle, isSending && styles.sendCircleDisabled]}
          disabled={isSending}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="send" size={18} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: C.surface,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: C.accent,
    gap: 2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: C.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.accent,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: C.text,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sendCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircleDisabled: {
    opacity: 0.6,
  },
});
