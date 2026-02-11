import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, MESSAGE_TEMPLATES } from '@/lib/constants';
import { Button } from '@/components/ui';
import { isDemoMode } from '@/config/demo';
import { useVoiceRecorder, type VoiceRecorderResult } from '@/hooks/useVoiceRecorder';

interface MessageInputProps {
  onSend: (text: string, type?: 'text' | 'template') => void | Promise<void>;
  onSendImage?: () => void;
  onSendDare?: () => void;
  onSendVoice?: (audioUri: string, durationMs: number) => void | Promise<void>;
  disabled?: boolean;
  isPreMatch?: boolean;
  messagesRemaining?: number;
  subscriptionTier?: 'free' | 'basic' | 'premium';
  canSendCustom?: boolean;
  recipientName?: string;
  /** Pre-fill the input with this text (e.g. a draft). */
  initialText?: string;
  /** Called when the input text changes (for persisting drafts). */
  onTextChange?: (text: string) => void;
}

export function MessageInput({
  onSend,
  onSendImage,
  onSendDare,
  onSendVoice,
  disabled = false,
  isPreMatch = false,
  messagesRemaining = 0,
  subscriptionTier = 'free',
  canSendCustom = false,
  recipientName = '',
  initialText = '',
  onTextChange,
}: MessageInputProps) {
  const [text, setText] = useState(initialText);
  const [showTemplates, setShowTemplates] = useState(false);

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
  };

  const handleSend = async () => {
    if (!text.trim()) return;

    if (!isDemoMode && isPreMatch && !canSendCustom && subscriptionTier === 'free') {
      Alert.alert('Upgrade Required', 'Free users can only send message templates. Upgrade to send custom messages.');
      return;
    }

    if (!isDemoMode && isPreMatch && messagesRemaining <= 0) {
      Alert.alert('No Messages Left', 'You have no messages remaining this week. Upgrade to get more!');
      return;
    }

    const trimmed = text.trim();
    handleTextChange('');
    try {
      await onSend(trimmed, 'text');
    } catch {
      // Restore text so user can retry
      handleTextChange(trimmed);
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

  return (
    <View style={styles.container}>
      {showTemplates && (
        <View style={styles.templatesContainer}>
          <View style={styles.templatesHeader}>
            <Text style={styles.templatesTitle}>Message Templates</Text>
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
              <Text style={styles.templateText}>{template.text.replace('{name}', recipientName || 'there')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <View style={styles.recordingBanner}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            Recording... {formatTime(elapsedMs)} / {formatTime(maxDurationMs)}
          </Text>
        </View>
      )}

      {!isDemoMode && isPreMatch && messagesRemaining > 0 && !isRecording && (
        <View style={styles.quotaBanner}>
          <Ionicons name="information-circle" size={16} color={COLORS.warning} />
          <Text style={styles.quotaText}>
            {messagesRemaining} {messagesRemaining === 1 ? 'message' : 'messages'} remaining this week
          </Text>
        </View>
      )}

      <View style={styles.inputContainer}>
        {/* Mic button - LEFT side of TextInput */}
        {onSendVoice && (
          <TouchableOpacity
            style={[styles.iconButton, isRecording && styles.iconButtonRecording]}
            onPress={toggleRecording}
            disabled={disabled}
          >
            <Ionicons
              name={isRecording ? 'stop' : 'mic'}
              size={24}
              color={isRecording ? COLORS.error : COLORS.primary}
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

        <TextInput
          style={[
            styles.input,
            !isDemoMode && !canSendCustom && isPreMatch && styles.inputDisabled,
            isRecording && styles.inputRecording,
          ]}
          placeholder={isRecording ? 'Recording voice message...' : (!isDemoMode && isPreMatch && !canSendCustom ? 'Use templates to message' : 'Type a message...')}
          placeholderTextColor={isRecording ? COLORS.error : COLORS.textLight}
          value={text}
          onChangeText={handleTextChange}
          multiline
          scrollEnabled
          textAlignVertical="top"
          blurOnSubmit={false}
          maxLength={isDemoMode || canSendCustom ? undefined : 150}
          editable={!disabled && !isRecording && (isDemoMode || canSendCustom || !isPreMatch)}
        />

        {onSendImage && !isRecording && (
          <TouchableOpacity style={styles.iconButton} onPress={onSendImage} disabled={disabled}>
            <Ionicons name="camera" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        {!isRecording && (
          <TouchableOpacity
            style={[styles.sendButton, (!text.trim() || disabled) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || disabled}
          >
            <Ionicons name="send" size={20} color={COLORS.white} />
          </TouchableOpacity>
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
    fontSize: 13,
    color: COLORS.error,
    fontWeight: '600',
  },
  quotaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning + '20',
    padding: 8,
    paddingHorizontal: 16,
  },
  quotaText: {
    fontSize: 12,
    color: COLORS.warning,
    marginLeft: 8,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: 10,
  },
  iconButton: {
    padding: 10,
    marginRight: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  iconButtonRecording: {
    backgroundColor: COLORS.error + '20',
    borderRadius: 22,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 40,
    maxHeight: 100,
    marginRight: 8,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  inputRecording: {
    borderWidth: 1,
    borderColor: COLORS.error + '40',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
