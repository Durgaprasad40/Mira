import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, MESSAGE_TEMPLATES } from '@/lib/constants';
import { Button } from '@/components/ui';
import { isDemoMode } from '@/config/demo';

interface MessageInputProps {
  onSend: (text: string, type?: 'text' | 'template') => void | Promise<void>;
  onSendImage?: () => void;
  onSendDare?: () => void;
  disabled?: boolean;
  isPreMatch?: boolean;
  messagesRemaining?: number;
  subscriptionTier?: 'free' | 'basic' | 'premium';
  canSendCustom?: boolean;
  recipientName?: string;
}

export function MessageInput({
  onSend,
  onSendImage,
  onSendDare,
  disabled = false,
  isPreMatch = false,
  messagesRemaining = 0,
  subscriptionTier = 'free',
  canSendCustom = false,
  recipientName = '',
}: MessageInputProps) {
  const [text, setText] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

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
    setText('');
    try {
      await onSend(trimmed, 'text');
    } catch {
      // Restore text so user can retry
      setText(trimmed);
    }
  };

  const handleTemplateSelect = (template: typeof MESSAGE_TEMPLATES[0]) => {
    const personalizedText = template.text.replace('{name}', recipientName || 'there');
    onSend(personalizedText, 'template');
    setShowTemplates(false);
  };

  const availableTemplates = MESSAGE_TEMPLATES.slice(
    0,
    subscriptionTier === 'premium' ? 50 : subscriptionTier === 'basic' ? 25 : 10
  );

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

      {!isDemoMode && isPreMatch && messagesRemaining > 0 && (
        <View style={styles.quotaBanner}>
          <Ionicons name="information-circle" size={16} color={COLORS.warning} />
          <Text style={styles.quotaText}>
            {messagesRemaining} {messagesRemaining === 1 ? 'message' : 'messages'} remaining this week
          </Text>
        </View>
      )}

      <View style={styles.inputContainer}>
        {isPreMatch && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setShowTemplates(!showTemplates)}
          >
            <Ionicons name="document-text" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        {onSendDare && (
          <TouchableOpacity style={styles.iconButton} onPress={onSendDare} disabled={disabled}>
            <Ionicons name="dice" size={24} color={COLORS.secondary} />
          </TouchableOpacity>
        )}

        <TextInput
          style={[styles.input, !isDemoMode && !canSendCustom && isPreMatch && styles.inputDisabled]}
          placeholder={!isDemoMode && isPreMatch && !canSendCustom ? 'Use templates to message' : 'Type a message...'}
          placeholderTextColor={COLORS.textLight}
          value={text}
          onChangeText={setText}
          multiline
          scrollEnabled
          textAlignVertical="top"
          blurOnSubmit={false}
          maxLength={isDemoMode || canSendCustom ? undefined : 150}
          editable={!disabled && (isDemoMode || canSendCustom || !isPreMatch)}
        />

        {onSendImage && (
          <TouchableOpacity style={styles.iconButton} onPress={onSendImage} disabled={disabled}>
            <Ionicons name="camera" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.sendButton, (!text.trim() || disabled) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || disabled}
        >
          <Ionicons name="send" size={20} color={COLORS.white} />
        </TouchableOpacity>
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
    padding: 8,
    marginRight: 8,
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
