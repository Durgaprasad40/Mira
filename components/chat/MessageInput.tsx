import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Keyboard } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, INCOGNITO_COLORS, MESSAGE_TEMPLATES } from '@/lib/constants';
import { Button } from '@/components/ui';
import { isDemoMode } from '@/config/demo';
import { useVoiceRecorder, type VoiceRecorderResult } from '@/hooks/useVoiceRecorder';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);
const PHASE1_TEXT_INPUT_MAX_LENGTH = 400;
const PHASE2_LEGACY_TEXT_INPUT_MAX_LENGTH = 150;
const TEXT_PROPS = { maxFontSizeMultiplier: 1.2 } as const;

interface MessageInputProps {
  onSend: (text: string, type?: 'text' | 'template') => void | Promise<void>;
  onSendCamera?: () => void;
  onSendGallery?: () => void;
  onSendDare?: () => void;
  onSendVoice?: (audioUri: string, durationMs: number) => void | Promise<void>;
  disabled?: boolean;
  isPreMatch?: boolean;
  subscriptionTier?: 'free' | 'basic' | 'premium';
  canSendCustom?: boolean;
  recipientName?: string;
  /** Pre-fill the input with this text (e.g. a draft). */
  initialText?: string;
  /** Called when the input text changes (for persisting drafts). */
  onTextChange?: (text: string) => void;
  /** Called when user starts/stops typing (for production typing indicators). */
  onTypingChange?: (isTyping: boolean) => void;
  /** Optional placeholder when composer is disabled for a known reason. */
  disabledPlaceholder?: string;
  /**
   * PHASE-2 PREMIUM THEME (UI-only):
   * When set to 'phase2', the composer renders with the Phase-2 dark/glass
   * palette (deep navy bg, dark surface input, rose primary). Default
   * behavior (Phase-1) is unchanged. No logic, no behavior, no callback
   * change — only colors / borders. Phase-1 callers (ChatScreenInner)
   * MUST NOT pass this prop.
   */
  theme?: 'phase1' | 'phase2';
}

export function MessageInput({
  onSend,
  onSendCamera,
  onSendGallery,
  onSendDare,
  onSendVoice,
  disabled = false,
  isPreMatch = false,
  subscriptionTier = 'free',
  canSendCustom = false,
  recipientName = '',
  initialText = '',
  onTextChange,
  onTypingChange,
  disabledPlaceholder,
  theme = 'phase1',
}: MessageInputProps) {
  // PHASE-2 PREMIUM: precompute palette overrides once. No logic change.
  const isPhase2 = theme === 'phase2';
  const p2 = INCOGNITO_COLORS;
  // Dark glass surface for input field — distinctly lighter than chat bg
  // (#1A1A2E) but still part of the dark family. Matches the Phase-2
  // protected-media card fill so the composer reads as a sibling surface.
  const PHASE2_INPUT_FILL = '#22223A';
  const PHASE2_BORDER = 'rgba(255,255,255,0.06)';
  const PHASE2_FOCUS_BORDER = 'rgba(233, 69, 96, 0.45)'; // rose-tinted focus
  const [text, setText] = useState(initialText);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Send button animation
  const sendButtonScale = useSharedValue(1);
  const inputBorderColor = useSharedValue(0);

  const sendButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendButtonScale.value }],
  }));

  // INPUT-COLOR-FIX: Focus border no longer uses COLORS.primary (brand red) —
  // that was making the composer look like an error state while typing. Use
  // a neutral premium border tone (same hue family as the border token, a
  // touch darker when focused so there is still feedback).
  // PHASE-2 PREMIUM: focus uses a soft rose-tinted border on the dark glass
  // input; resting state stays a faint white-on-dark hairline.
  const inputAnimatedStyle = useAnimatedStyle(() => ({
    borderWidth: 1,
    borderColor: isPhase2
      ? (inputBorderColor.value === 1 ? PHASE2_FOCUS_BORDER : PHASE2_BORDER)
      : (inputBorderColor.value === 1 ? 'rgba(0, 0, 0, 0.12)' : 'transparent'),
  }));

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    if (showAttachMenu) {
      setShowAttachMenu(false);
    }
    if (showTemplates) {
      setShowTemplates(false);
    }
    inputBorderColor.value = withTiming(1, { duration: 150 });
  }, [inputBorderColor, showAttachMenu, showTemplates]);

  const [isSending, setIsSending] = useState(false);

  // P1-A FIX: Ref-based guard to prevent duplicate sends on rapid double-tap
  // State updates are async; ref is synchronous and prevents race
  const isSendingRef = useRef(false);
  const isTypingRef = useRef(false);

  // Typing notification timer ref (for debouncing typing status)
  const hideTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P1-B FIX: Ref to hold latest onTypingChange callback
  // Prevents stale closure in setTimeout
  const onTypingChangeRef = useRef(onTypingChange);

  // P1-B FIX: Sync ref when onTypingChange prop changes
  useEffect(() => {
    onTypingChangeRef.current = onTypingChange;
  }, [onTypingChange]);

  const emitTypingState = useCallback((nextIsTyping: boolean) => {
    if (isTypingRef.current === nextIsTyping) return;
    isTypingRef.current = nextIsTyping;
    onTypingChangeRef.current?.(nextIsTyping);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    inputBorderColor.value = withTiming(0, { duration: 150 });
    if (hideTypingTimerRef.current) {
      clearTimeout(hideTypingTimerRef.current);
      hideTypingTimerRef.current = null;
    }
    emitTypingState(false);
  }, [emitTypingState, inputBorderColor]);

  const handleSendPressIn = useCallback(() => {
    sendButtonScale.value = withSpring(0.92, { damping: 15, stiffness: 400 });
  }, [sendButtonScale]);

  const handleSendPressOut = useCallback(() => {
    sendButtonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  }, [sendButtonScale]);

  // Voice recording
  const handleRecordingComplete = useCallback((result: VoiceRecorderResult) => {
    onSendVoice?.(result.audioUri, result.durationMs);
  }, [onSendVoice]);

  const handleRecordingError = useCallback((message: string) => {
    Alert.alert('Recording Error', message);
  }, []);

  const {
    isRecording,
    elapsedMs,
    maxDurationMs,
    toggleRecording,
  } = useVoiceRecorder({
    onRecordingComplete: handleRecordingComplete,
    onError: handleRecordingError,
  });

  // Format elapsed time as 0:xx
  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const handleTextChange = (value: string) => {
    setText(value);
    onTextChange?.(value);

    // Close attach menu when user starts typing
    if (value.trim().length > 0 && showAttachMenu) {
      setShowAttachMenu(false);
    }

    // Clear any existing timer
    if (hideTypingTimerRef.current) clearTimeout(hideTypingTimerRef.current);

    const hasText = value.trim().length > 0;

    // Production mode: notify parent of typing state change
    // P1-B FIX: Use ref for ALL calls to avoid stale closure in setTimeout
    if (!isDemoMode && onTypingChangeRef.current) {
      if (hasText) {
        // User is typing - notify immediately
        emitTypingState(true);
        // Stop typing after 2s of inactivity
        hideTypingTimerRef.current = setTimeout(() => {
          emitTypingState(false);
        }, 2000);
      } else {
        // User cleared input - stop typing
        emitTypingState(false);
      }
    }

  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hideTypingTimerRef.current) clearTimeout(hideTypingTimerRef.current);
      emitTypingState(false);
    };
  }, [emitTypingState]);

  const handleSend = async () => {
    // P1-A FIX: Ref guard at START - prevents double-tap race condition
    if (isSendingRef.current) return;
    if (!text.trim() || isSending) return;

    if (!isDemoMode && isPreMatch && !canSendCustom && subscriptionTier === 'free') {
      Alert.alert('Upgrade Required', 'Free users can only send message templates. Upgrade to send custom messages.');
      return;
    }

    const trimmed = text.trim();
    handleTextChange('');
    // P2-024 FIX: Dismiss keyboard after sending message
    Keyboard.dismiss();
    // P1-A FIX: Set ref BEFORE async operation
    isSendingRef.current = true;
    setIsSending(true);
    try {
      await onSend(trimmed, 'text');
    } catch {
      // P1-RETRY-FIX: Restore text for retry, but don't show alert (parent handles it)
      // ChatScreenInner already shows Alert with actual error message - avoid duplicate
      handleTextChange(trimmed);
    } finally {
      // P1-A FIX: Reset ref in finally (always runs)
      isSendingRef.current = false;
      setIsSending(false);
    }
  };

  // C7 fix: make async with await and try/catch to prevent double-send
  const [isSendingTemplate, setIsSendingTemplate] = useState(false);
  const handleTemplateSelect = async (template: typeof MESSAGE_TEMPLATES[0]) => {
    if (isSendingTemplate) return;
    setIsSendingTemplate(true);
    const personalizedText = template.text.replace('{name}', recipientName || 'there');
    try {
      await onSend(personalizedText, 'template');
      setShowTemplates(false);
    } catch {
      // Error handled by parent; keep templates open so user can retry
    } finally {
      setIsSendingTemplate(false);
    }
  };

  // 5-6: Memoize templates list to prevent re-creation on every render
  const availableTemplates = useMemo(() => {
    const limit = subscriptionTier === 'premium' ? 50 : subscriptionTier === 'basic' ? 25 : 10;
    return MESSAGE_TEMPLATES.slice(0, limit);
  }, [subscriptionTier]);

  // Attachment menu handlers
  const handleCameraPress = () => {
    setShowAttachMenu(false);
    onSendCamera?.();
  };

  const handleGalleryPress = () => {
    setShowAttachMenu(false);
    onSendGallery?.();
  };

  const handleVoicePress = () => {
    setShowAttachMenu(false);
    toggleRecording();
  };

  // PHASE-2 PREMIUM: per-render style overrides (object identity is stable
  // across renders only when isPhase2 toggles — toggling never happens at
  // runtime in the current codebase, so no perf concern).
  const containerStyle = isPhase2
    ? [styles.container, { backgroundColor: p2.background, borderTopColor: 'rgba(255,255,255,0.06)' }]
    : styles.container;
  const attachButtonStyle = isPhase2
    ? [styles.attachButton, { backgroundColor: PHASE2_INPUT_FILL }]
    : styles.attachButton;
  const sendButtonBaseStyle = isPhase2
    ? [styles.sendButton, { backgroundColor: p2.primary, shadowColor: p2.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.45, shadowRadius: 6, elevation: 4 }]
    : styles.sendButton;
  const inputStyleOverride = isPhase2
    ? { backgroundColor: PHASE2_INPUT_FILL, color: p2.text }
    : null;
  const placeholderColor = isPhase2
    ? (isRecording ? COLORS.error : p2.textLight)
    : (isRecording ? COLORS.error : COLORS.textLight);
  const plusIconColor = isPhase2 ? p2.primary : COLORS.primary;
  const textLimit = isPhase2
    ? PHASE2_LEGACY_TEXT_INPUT_MAX_LENGTH
    : PHASE1_TEXT_INPUT_MAX_LENGTH;

  return (
    <View style={containerStyle}>
      {/* FLOATING-PANEL: Vertical attach panel — absolutely positioned above
          the composer and over the chat. Does NOT push or move chat UI.
          Tap outside (handled by parent overlay) or tap + again to dismiss. */}
      {showAttachMenu && !isRecording && (
        <View style={styles.attachPanelFloating} pointerEvents="box-none">
          <View style={styles.attachPanelStack}>
            {onSendCamera && (
              <TouchableOpacity
                style={[styles.attachCircle, { backgroundColor: COLORS.primary }]}
                onPress={handleCameraPress}
                activeOpacity={0.85}
                accessibilityLabel="Secure camera"
              >
                <Ionicons name="camera" size={22} color={COLORS.white} />
              </TouchableOpacity>
            )}
            {onSendGallery && (
              <TouchableOpacity
                style={[styles.attachCircle, { backgroundColor: COLORS.secondary }]}
                onPress={handleGalleryPress}
                activeOpacity={0.85}
                accessibilityLabel="Secure gallery"
              >
                <Ionicons name="images" size={22} color={COLORS.white} />
              </TouchableOpacity>
            )}
            {onSendVoice && (
              <TouchableOpacity
                style={[styles.attachCircle, { backgroundColor: '#9B59B6' }]}
                onPress={handleVoicePress}
                activeOpacity={0.85}
                accessibilityLabel="Voice message"
              >
                <Ionicons name="mic" size={22} color={COLORS.white} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {showTemplates && (
        <View style={styles.templatesContainer}>
          <View style={styles.templatesHeader}>
            <Text {...TEXT_PROPS} style={styles.templatesTitle}>Message Templates</Text>
            <TouchableOpacity onPress={() => setShowTemplates(false)}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          {availableTemplates.map((template) => (
            <TouchableOpacity
              key={template.id}
              style={styles.templateItem}
              onPress={() => handleTemplateSelect(template)}
            >
              <Text {...TEXT_PROPS} style={styles.templateText}>{template.text.replace('{name}', recipientName || 'there')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <View style={styles.recordingBanner}>
          <View style={styles.recordingDot} />
          <Text {...TEXT_PROPS} style={styles.recordingText}>
            Recording... {formatTime(elapsedMs)} / {formatTime(maxDurationMs)}
          </Text>
          <TouchableOpacity onPress={toggleRecording} style={styles.stopRecordingButton}>
            <Ionicons name="stop" size={20} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      )}

      {/* Message limit banner removed — no weekly limit for now (until subscriptions added) */}

      <View style={styles.inputContainer}>
        {/* + Button toggles the inline circular attach row */}
        {!isRecording && (
          <TouchableOpacity
            style={attachButtonStyle}
            onPress={() => {
              setShowAttachMenu((v) => {
                const next = !v;
                if (next) Keyboard.dismiss();
                return next;
              });
            }}
            disabled={disabled}
            accessibilityLabel={showAttachMenu ? 'Close attachments' : 'Open attachments'}
          >
            <Ionicons
              name={showAttachMenu ? 'close' : 'add'}
              size={26}
              color={plusIconColor}
            />
          </TouchableOpacity>
        )}

        {isPreMatch && !isRecording && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setShowTemplates(!showTemplates)}
          >
            <Ionicons name="document-text" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        {onSendDare && !isRecording && (
          <TouchableOpacity style={styles.iconButton} onPress={onSendDare} disabled={disabled}>
            <Ionicons name="dice" size={24} color={COLORS.secondary} />
          </TouchableOpacity>
        )}

        <Animated.View style={[styles.inputWrapper, inputAnimatedStyle]}>
          <TextInput
            style={[
              styles.input,
              inputStyleOverride,
              !isDemoMode && !canSendCustom && isPreMatch && styles.inputDisabled,
              isRecording && styles.inputRecording,
            ]}
            placeholder={
              isRecording
                ? 'Recording voice message...'
                : disabled && disabledPlaceholder
                  ? disabledPlaceholder
                  : (!isDemoMode && isPreMatch && !canSendCustom ? 'Use templates to message' : 'Type a message...')
            }
            placeholderTextColor={placeholderColor}
            value={text}
            onChangeText={handleTextChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            multiline
            scrollEnabled
            textAlignVertical="top"
            blurOnSubmit={false}
            maxLength={textLimit}
            editable={!disabled && !isRecording && (isDemoMode || canSendCustom || !isPreMatch)}
            autoComplete="off"
            textContentType="none"
            importantForAutofill="noExcludeDescendants"
          />
        </Animated.View>

        {!isRecording && (
          <AnimatedTouchable
            style={[
              sendButtonBaseStyle,
              (!text.trim() || disabled || isSending) && styles.sendButtonDisabled,
              sendButtonStyle,
            ]}
            onPress={handleSend}
            onPressIn={handleSendPressIn}
            onPressOut={handleSendPressOut}
            disabled={!text.trim() || disabled || isSending}
            activeOpacity={0.9}
          >
            {isSending ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="send" size={20} color={COLORS.white} />
            )}
          </AnimatedTouchable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  templatesContainer: {
    maxHeight: 200,
    backgroundColor: COLORS.backgroundDark,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  templatesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  templatesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  templateItem: {
    padding: 12,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    marginBottom: 8,
  },
  templateText: {
    fontSize: 14,
    color: COLORS.text,
  },
  recordingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.error + '15',
    padding: 8,
    paddingHorizontal: 16,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
    marginRight: 8,
  },
  recordingText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.error,
    fontWeight: '600',
  },
  stopRecordingButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // FLOATING-PANEL: positioned absolutely above the composer (bottom: 100%)
  // so the chat thread does NOT shift when the panel opens.
  attachPanelFloating: {
    position: 'absolute',
    bottom: '100%',
    left: 12,
    paddingBottom: 8,
    zIndex: 10,
    elevation: 10,
  },
  attachPanelStack: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  attachCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  iconButton: {
    padding: 8,
    marginRight: 4,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  iconButtonRecording: {
    backgroundColor: COLORS.error + '20',
    borderRadius: 22,
  },
  inputWrapper: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  input: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 40,
    maxHeight: 100,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  inputRecording: {
    borderWidth: 1,
    borderColor: COLORS.error + '40',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
