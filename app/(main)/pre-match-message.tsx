import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button, Avatar } from '@/components/ui';
import { useAuthStore, useSubscriptionStore } from '@/stores';
import { COLORS } from '@/lib/constants';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';

export default function PreMatchMessageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId: targetUserId } = useLocalSearchParams<{ userId: string }>();
  const { userId } = useAuthStore();
  const { tier } = useSubscriptionStore();
  const isPremium = isDemoMode || tier === 'premium';

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [customMessage, setCustomMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const targetUser = useQuery(
    api.users.getUserById,
    !isDemoMode && targetUserId && userId ? { userId: targetUserId as any, viewerId: userId as any } : 'skip'
  );

  const templates = useQuery(
    api.messageTemplates.getMessageTemplates,
    !isDemoMode && userId && targetUserId
      ? { userId: userId as any, targetUserId: targetUserId as any }
      : 'skip'
  );

  const canSend = useQuery(
    api.messages.canSendMessage,
    !isDemoMode && userId ? { userId: userId as any } : 'skip'
  );

  const sendPreMatchMessage = useMutation(api.messages.sendPreMatchMessage);

  const handleSend = async () => {
    if (!userId || !targetUserId) return;

    const message = selectedTemplate
      ? templates?.find((t) => t.id === selectedTemplate)?.text || customMessage
      : customMessage;

    if (!message.trim()) {
      Alert.alert('Error', 'Please select a template or write a custom message');
      return;
    }

    // Check if user can send custom messages
    if (!isDemoMode && !selectedTemplate && customMessage) {
      const maxLength = isPremium ? 500 : 100;
      if (customMessage.length > maxLength) {
        Alert.alert('Error', `Custom messages are limited to ${maxLength} characters for your tier`);
        return;
      }
    }

    if (!isDemoMode && !canSend?.canSend) {
      Alert.alert('No Messages Remaining', 'You have used all your weekly messages. They reset on Monday.');
      router.push('/(main)/subscription');
      return;
    }

    setSending(true);
    try {
      await sendPreMatchMessage({
        fromUserId: userId as any,
        toUserId: targetUserId as any,
        content: message,
        templateId: selectedTemplate || undefined,
      });
      Alert.alert('Success', 'Message sent! They\'ll see it at the top of their screen.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (!targetUser || !templates) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: 16, color: COLORS.textLight }}>
          {timedOut ? 'Failed to load' : 'Loading...'}
        </Text>
        <TouchableOpacity
          style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: COLORS.primary }}
          onPress={() => router.back()}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.white }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send Message</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.targetUserCard}>
          <Avatar uri={targetUser.photos?.[0]?.url} size={64} />
          <Text style={styles.targetUserName}>{targetUser.name}</Text>
          <Text style={styles.targetUserSubtext}>
            Send a message to stand out!{isDemoMode ? '' : ` (Uses 1 of your ${canSend?.remaining || 0} weekly messages)`}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Choose a Template:</Text>
          {templates.map((template) => (
            <TouchableOpacity
              key={template.id}
              style={[
                styles.templateCard,
                selectedTemplate === template.id && styles.templateCardSelected,
              ]}
              onPress={() => {
                setSelectedTemplate(template.id);
                setCustomMessage('');
              }}
            >
              <Text style={styles.templateText}>{template.text}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {isPremium && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Or write custom:</Text>
            <TextInput
              style={styles.customInput}
              value={customMessage}
              onChangeText={(text) => {
                setCustomMessage(text);
                setSelectedTemplate(null);
              }}
              placeholder="Write your message..."
              multiline
              maxLength={500}
              placeholderTextColor={COLORS.textLight}
            />
            <Text style={styles.charCount}>
              {customMessage.length} / 500 characters
            </Text>
          </View>
        )}

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={20} color={COLORS.primary} />
          <Text style={styles.infoText}>
            Your message will appear at the top of their screen with a special notification.
            If they respond, you'll automatically match!
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={sending ? 'Sending...' : 'Send Message'}
          variant="primary"
          onPress={handleSend}
          disabled={sending || (!selectedTemplate && !customMessage.trim())}
          fullWidth
        />
        {!isDemoMode && (
          <>
            <Text style={styles.footerText}>
              Messages remaining: {canSend?.remaining || 0} of {canSend?.total || 0}
            </Text>
            <Text style={styles.footerSubtext}>Resets Monday</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  placeholder: {
    width: 24,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  targetUserCard: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
    marginBottom: 24,
  },
  targetUserName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 4,
  },
  targetUserSubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  templateCard: {
    padding: 16,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  templateCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  templateText: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
  },
  customInput: {
    minHeight: 120,
    padding: 16,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontSize: 15,
    color: COLORS.text,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 8,
    textAlign: 'right',
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: COLORS.primary + '10',
    borderRadius: 12,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
    fontWeight: '500',
  },
  footerSubtext: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});
