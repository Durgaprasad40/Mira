import React, { useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
  TextInputSelectionChangeEventData,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { SPACING, CHAT_SIZES } from '@/lib/responsive';
import MentionSuggestions, { MentionMember } from './MentionSuggestions';

// Re-export for convenience
export type { MentionMember };

const C = INCOGNITO_COLORS;

const MIN_INPUT_HEIGHT = 40;
const MAX_INPUT_HEIGHT = 120;

export type ComposerPanel = 'none';

/** Reply preview data shown above the composer */
export interface ReplyPreviewData {
  messageId: string;
  senderNickname: string;
  snippet: string;
}

/** Mention data structure for structured storage */
export interface MentionData {
  userId: string;
  nickname: string;
  startIndex: number;
  endIndex: number;
}

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Called when send is pressed. Can be async. If it throws, text is preserved. */
  onSend: () => void | Promise<void>;
  onPlusPress?: () => void;
  onMicPress?: () => void;
  onInputFocus?: () => void;
  onPanelChange?: (panel: ComposerPanel) => void;
  /** Whether voice recording is active */
  isRecording?: boolean;
  /** Elapsed recording time in milliseconds */
  elapsedMs?: number;
  /** Reply preview data (when replying to a message) */
  replyPreview?: ReplyPreviewData | null;
  /** Called when user dismisses the reply preview */
  onCancelReply?: () => void;
  /** Room members for @mention suggestions */
  mentionMembers?: MentionMember[];
  /** Whether members are loading */
  mentionMembersLoading?: boolean;
  /** Called when mentions change (for tracking structured mention data) */
  onMentionsChange?: (mentions: MentionData[]) => void;
}

/** Format milliseconds as M:SS */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function ChatComposer({
  value,
  onChangeText,
  onSend,
  onPlusPress,
  onMicPress,
  onInputFocus,
  isRecording = false,
  elapsedMs = 0,
  replyPreview,
  onCancelReply,
  mentionMembers = [],
  mentionMembersLoading = false,
  onMentionsChange,
}: ChatComposerProps) {
  const inputRef = useRef<TextInput>(null);
  const hasText = value.trim().length > 0;
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const [isSending, setIsSending] = useState(false);

  // Mention state
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [mentionSearchText, setMentionSearchText] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  // Track active mentions in text (for structured storage)
  const mentionsRef = useRef<MentionData[]>([]);

  // Clear mentions when text is cleared externally (after send)
  React.useEffect(() => {
    if (value === '' && mentionsRef.current.length > 0) {
      mentionsRef.current = [];
      onMentionsChange?.([]);
    }
  }, [value, onMentionsChange]);

  // Handle text changes with mention detection
  const handleTextChange = useCallback((newText: string) => {
    // Check if text was shortened (deletion) - may need to invalidate mentions
    if (newText.length < value.length) {
      // Update mention indices after deletion
      const deletedChars = value.length - newText.length;
      const deleteStart = cursorPosition - deletedChars;

      // Filter and adjust mentions
      const updatedMentions = mentionsRef.current
        .filter((m) => {
          // Remove mentions that overlap with deleted range
          if (deleteStart < m.endIndex && cursorPosition > m.startIndex) {
            return false;
          }
          return true;
        })
        .map((m) => {
          // Adjust indices for mentions after deletion point
          if (m.startIndex >= cursorPosition) {
            return {
              ...m,
              startIndex: m.startIndex - deletedChars,
              endIndex: m.endIndex - deletedChars,
            };
          }
          return m;
        });

      mentionsRef.current = updatedMentions;
      onMentionsChange?.(updatedMentions);
    }

    // Check for "@" trigger
    const lastAtIndex = newText.lastIndexOf('@', cursorPosition);
    if (lastAtIndex >= 0) {
      // Check if this @ starts a new mention (preceded by space or start of text)
      const charBefore = lastAtIndex > 0 ? newText[lastAtIndex - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
        // Extract search text after @
        const textAfterAt = newText.substring(lastAtIndex + 1, cursorPosition + 1);

        // MENTION-TRIGGER-FIX: Only activate if at least 1 character typed after @ AND no space
        // "@" alone should NOT show suggestions, only "@x" or more
        const hasValidQuery = textAfterAt.length > 0 && !textAfterAt.includes(' ');

        if (hasValidQuery) {
          setMentionActive(true);
          setMentionStartIndex(lastAtIndex);
          setMentionSearchText(textAfterAt);
        } else {
          setMentionActive(false);
          setMentionSearchText('');
        }
      } else {
        setMentionActive(false);
      }
    } else {
      setMentionActive(false);
    }

    onChangeText(newText);
  }, [value, cursorPosition, onChangeText, onMentionsChange]);

  // Handle cursor position changes
  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setCursorPosition(e.nativeEvent.selection.end);
    },
    []
  );

  // Handle mention selection from suggestions
  const handleMentionSelect = useCallback((member: MentionMember) => {
    const mentionText = `@${member.nickname}`;
    const beforeMention = value.substring(0, mentionStartIndex);
    const afterMention = value.substring(cursorPosition);
    const newText = `${beforeMention}${mentionText} ${afterMention}`;

    // Add new mention to tracking
    const newMention: MentionData = {
      userId: member.id,
      nickname: member.nickname,
      startIndex: mentionStartIndex,
      endIndex: mentionStartIndex + mentionText.length,
    };

    // Adjust existing mentions that come after
    const existingMentions = mentionsRef.current.map((m) => {
      if (m.startIndex > mentionStartIndex) {
        const shift = mentionText.length + 1 - (cursorPosition - mentionStartIndex);
        return {
          ...m,
          startIndex: m.startIndex + shift,
          endIndex: m.endIndex + shift,
        };
      }
      return m;
    });

    mentionsRef.current = [...existingMentions, newMention];
    onMentionsChange?.(mentionsRef.current);

    // Update text and close suggestions
    onChangeText(newText);
    setMentionActive(false);
    setMentionSearchText('');

    // Move cursor after mention
    setTimeout(() => {
      inputRef.current?.setNativeProps({
        selection: { start: mentionStartIndex + mentionText.length + 1, end: mentionStartIndex + mentionText.length + 1 },
      });
    }, 50);
  }, [value, mentionStartIndex, cursorPosition, onChangeText, onMentionsChange]);

  const handleSend = useCallback(async () => {
    if (!hasText || isSending) return;
    // P2-013: Light haptic feedback on send for tactile confirmation
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const textBeforeSend = value;
    setIsSending(true);
    try {
      await onSend();
      setInputHeight(MIN_INPUT_HEIGHT);
      // Clear mentions after successful send
      mentionsRef.current = [];
      setMentionActive(false);
    } catch {
      onChangeText(textBeforeSend);
      // Error haptic feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
    <View style={styles.wrapper}>
      {/* Mention Suggestions */}
      {mentionActive && mentionMembers.length > 0 && (
        <MentionSuggestions
          members={mentionMembers}
          searchText={mentionSearchText}
          onSelect={handleMentionSelect}
          isLoading={mentionMembersLoading}
        />
      )}

      {/* Reply Preview Bar */}
      {replyPreview && (
        <View style={styles.replyPreview}>
          <View style={styles.replyContent}>
            <View style={styles.replyAccent} />
            <View style={styles.replyTextContainer}>
              <Text style={styles.replyName} numberOfLines={1}>
                {replyPreview.senderNickname}
              </Text>
              {/* REPLY-UI-FIX: Use 1 line for cleaner preview */}
              <Text
                style={styles.replySnippet}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {replyPreview.snippet}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={onCancelReply}
            style={styles.replyCancelBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={18} color={C.textLight} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.container}>
        {/* + Attachments */}
        <TouchableOpacity onPress={onPlusPress} style={styles.iconBtn} activeOpacity={0.6}>
          <Ionicons name="add" size={24} color={C.textLight} />
        </TouchableOpacity>

      {/* Multiline text input */}
      <View style={[styles.inputRow, { minHeight: inputHeight + 2 }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { height: inputHeight }]}
          placeholder="Type a message..."
          placeholderTextColor={C.textLight}
          value={value}
          onChangeText={handleTextChange}
          onSelectionChange={handleSelectionChange}
          maxLength={2000}
          multiline
          scrollEnabled
          textAlignVertical="top"
          blurOnSubmit={false}
          onContentSizeChange={handleContentSizeChange}
          onFocus={() => {
            onInputFocus?.();
          }}
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
        />
      </View>

      {/* Voice - show recording state when active */}
      {isRecording ? (
        <TouchableOpacity onPress={onMicPress} style={styles.recordingBtn} activeOpacity={0.7}>
          <View style={styles.recordingIndicator} />
          <Text style={styles.recordingTimer}>{formatElapsed(elapsedMs)}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={onMicPress} style={styles.iconBtn} activeOpacity={0.6}>
          <Ionicons name="mic" size={22} color={C.textLight} />
        </TouchableOpacity>
      )}

      {/* Send (visible when there is text) */}
      {hasText && (
        <TouchableOpacity
          onPress={handleSend}
          style={[styles.sendCircle, isSending && styles.sendCircleDisabled]}
          disabled={isSending}
          activeOpacity={0.7}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="send" size={18} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: C.surface,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(109, 40, 217, 0.1)',
    width: '100%',
  },
  replyContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch', // Stretch children to same height
    minWidth: 0,
  },
  replyAccent: {
    width: 3,
    minHeight: 32,
    backgroundColor: '#6D28D9',
    borderRadius: 1.5,
    marginRight: SPACING.sm + 2,
    flexShrink: 0, // Don't shrink the accent bar
  },
  replyTextContainer: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  replyName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6D28D9',
    marginBottom: 2,
  },
  replySnippet: {
    // REPLY-UI-FIX: Clean single-line preview with proper sizing
    fontSize: 13,
    lineHeight: 18,
    color: C.textLight,
  },
  replyCancelBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: C.surface,
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: SPACING.xs + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
    gap: SPACING.xs,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    gap: 8,
  },
  recordingIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  recordingTimer: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
    minWidth: 36,
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: C.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: C.text,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircleDisabled: {
    opacity: 0.5,
  },
});
