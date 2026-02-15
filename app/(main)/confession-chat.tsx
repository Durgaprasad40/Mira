import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { useConfessionStore } from '@/stores/confessionStore';
import { useAuthStore } from '@/stores/authStore';
import { MutualRevealStatus } from '@/types';
import { logDebugEvent } from '@/lib/debugEventLogger';

function formatTimeLeft(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getRevealStatusText(
  status: MutualRevealStatus,
  currentUserId: string,
  initiatorId: string,
  declinedBy?: string,
): string {
  switch (status) {
    case 'both_agreed':
      return 'Both sides agreed — identities revealed!';
    case 'declined':
      return declinedBy === currentUserId
        ? 'You declined the reveal request.'
        : 'The other person declined the reveal.';
    case 'initiator_agreed':
      return currentUserId === initiatorId
        ? 'You agreed to reveal. Waiting for the other person...'
        : 'The other person wants to reveal. Your choice below.';
    case 'responder_agreed':
      return currentUserId !== initiatorId
        ? 'You agreed to reveal. Waiting for the other person...'
        : 'The other person wants to reveal. Your choice below.';
    default:
      return '';
  }
}

export default function ConfessionChatScreen() {
  const router = useRouter();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { userId } = useAuthStore();
  const currentUserId = userId || 'demo_user_1';

  const chats = useConfessionStore((s) => s.chats);
  const confessions = useConfessionStore((s) => s.confessions);
  const addChatMessage = useConfessionStore((s) => s.addChatMessage);
  const agreeMutualReveal = useConfessionStore((s) => s.agreeMutualReveal);
  const declineMutualReveal = useConfessionStore((s) => s.declineMutualReveal);
  const cleanupExpiredChats = useConfessionStore((s) => s.cleanupExpiredChats);

  const chat = chats.find((c) => c.id === chatId) || null;
  const confessionText = chat
    ? confessions.find((c) => c.id === chat.confessionId)?.text
    : undefined;

  // Navigation guard: prevent opening expired chats
  const [guardTriggered, setGuardTriggered] = useState(false);
  useEffect(() => {
    if (guardTriggered || !chatId) return;

    // Check if chat doesn't exist or is expired
    const now = Date.now();
    if (!chat) {
      setGuardTriggered(true);
      logDebugEvent('CHAT_EXPIRED', `Confession chat not found: ${chatId}`);
      router.back();
      return;
    }

    if (now > chat.expiresAt) {
      setGuardTriggered(true);
      logDebugEvent('CHAT_EXPIRED', `Confession chat expired: ${chatId}`);
      cleanupExpiredChats([chat.id]);
      router.back();
    }
  }, [guardTriggered, chatId, chat, cleanupExpiredChats, router]);

  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  // Near-bottom tracking for smart auto-scroll
  const isNearBottomRef = useRef(true);
  const SCROLL_THRESHOLD = 120;
  const prevMessageCount = useRef(0);
  const hasInitialScrolled = useRef(false);

  // Scroll to bottom helper with platform-specific timing
  const scrollToBottom = useCallback((animated = true) => {
    const run = () => listRef.current?.scrollToEnd({ animated });
    if (Platform.OS === 'android') {
      InteractionManager.runAfterInteractions(() => setTimeout(run, 120));
    } else {
      requestAnimationFrame(run);
    }
  }, []);

  // Track scroll position to determine if user is near bottom
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    isNearBottomRef.current = distanceFromBottom < SCROLL_THRESHOLD;
  }, []);

  // Initial scroll on first load
  useEffect(() => {
    if (!hasInitialScrolled.current && chat?.messages.length) {
      hasInitialScrolled.current = true;
      scrollToBottom(false);
    }
  }, [chat?.messages.length, scrollToBottom]);

  // Scroll to bottom when message count increases (only if user is near bottom)
  useEffect(() => {
    const currentCount = chat?.messages.length ?? 0;
    if (currentCount > prevMessageCount.current && isNearBottomRef.current) {
      scrollToBottom(true);
    }
    prevMessageCount.current = currentCount;
  }, [chat?.messages.length, scrollToBottom]);

  const handleSend = useCallback(() => {
    if (!text.trim() || !chat) return;
    const message = {
      id: `ccm_new_${Date.now()}`,
      chatId: chat.id,
      senderId: currentUserId,
      text: text.trim(),
      createdAt: Date.now(),
    };
    addChatMessage(chat.id, message);
    setText('');
    // Always scroll to bottom on send (user's own message)
    isNearBottomRef.current = true;
    scrollToBottom(true);
  }, [text, chat, currentUserId, addChatMessage, scrollToBottom]);

  const handleAgreeReveal = useCallback(() => {
    if (!chat) return;
    agreeMutualReveal(chat.id, currentUserId);
  }, [chat, currentUserId, agreeMutualReveal]);

  const handleDeclineReveal = useCallback(() => {
    if (!chat) return;
    declineMutualReveal(chat.id, currentUserId);
  }, [chat, currentUserId, declineMutualReveal]);

  const handleMenu = useCallback(() => {
    Alert.alert('Options', undefined, [
      {
        text: 'Block & Report',
        style: 'destructive',
        onPress: () => router.back(),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [router]);

  if (!chat) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Chat not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const revealStatus = chat.mutualRevealStatus || 'none';
  const isRevealed = revealStatus === 'both_agreed';
  const isDeclined = revealStatus === 'declined';
  const iAmInitiator = chat.initiatorId === currentUserId;
  const iHaveAgreed =
    (iAmInitiator && (revealStatus === 'initiator_agreed' || revealStatus === 'both_agreed')) ||
    (!iAmInitiator && (revealStatus === 'responder_agreed' || revealStatus === 'both_agreed'));
  const otherRequested =
    (!iAmInitiator && revealStatus === 'initiator_agreed') ||
    (iAmInitiator && revealStatus === 'responder_agreed');
  const showRevealActions = !isRevealed && !isDeclined && !iHaveAgreed;
  const statusText = getRevealStatusText(revealStatus, currentUserId, chat.initiatorId, chat.declinedBy);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {isRevealed ? 'Chat (Revealed)' : 'Anonymous Chat'}
          </Text>
          <Text style={styles.headerSubtitle}>{formatTimeLeft(chat.expiresAt)}</Text>
        </View>
        <TouchableOpacity onPress={handleMenu} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="ellipsis-vertical" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Anonymous Chat Tag */}
      <View style={styles.chatTag}>
        <Ionicons name="eye-off" size={12} color={COLORS.textMuted} />
        <Text style={styles.chatTagText}>Anonymous Chat from Confess</Text>
      </View>

      {/* Safety Notice */}
      <View style={styles.safetyBanner}>
        <Ionicons name="shield-checkmark" size={13} color={COLORS.primary} />
        <Text style={styles.safetyText}>Be kind. Do not share personal info.</Text>
      </View>

      {/* Pinned Confession Snippet */}
      {confessionText ? (
        <View style={styles.pinnedSnippet}>
          <Ionicons name="chatbubble-outline" size={13} color={COLORS.textMuted} />
          <Text style={styles.pinnedText} numberOfLines={2}>{confessionText}</Text>
        </View>
      ) : null}

      {/* Mutual Reveal Banner */}
      {revealStatus !== 'none' && (
        <View style={[styles.revealBanner, isRevealed && styles.revealBannerSuccess]}>
          <Ionicons
            name={isRevealed ? 'checkmark-circle' : isDeclined ? 'close-circle' : 'time'}
            size={16}
            color={isRevealed ? '#34C759' : isDeclined ? COLORS.textMuted : COLORS.primary}
          />
          <Text style={[styles.revealBannerText, isRevealed && styles.revealBannerTextSuccess]}>
            {statusText}
          </Text>
        </View>
      )}

      {/* Reveal Action Buttons */}
      {showRevealActions && (
        <View style={styles.revealActions}>
          {otherRequested ? (
            <>
              <Text style={styles.revealPrompt}>The other person wants to reveal identities. Do you agree?</Text>
              <View style={styles.revealButtonRow}>
                <TouchableOpacity style={styles.revealAgreeButton} onPress={handleAgreeReveal}>
                  <Ionicons name="checkmark" size={16} color={COLORS.white} />
                  <Text style={styles.revealAgreeText}>Agree to Reveal</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.revealDeclineButton} onPress={handleDeclineReveal}>
                  <Ionicons name="close" size={16} color={COLORS.text} />
                  <Text style={styles.revealDeclineText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity style={styles.revealRequestButton} onPress={handleAgreeReveal}>
              <Ionicons name="eye" size={16} color={COLORS.primary} />
              <Text style={styles.revealRequestText}>Request Mutual Reveal</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={chat.messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isMe = item.senderId === currentUserId;
          return (
            <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
              <Text style={[styles.bubbleSender, isMe && styles.bubbleSenderMe]}>{isMe ? 'You' : 'Anon'}</Text>
              <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.text}</Text>
              <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                {formatTime(item.createdAt)}
              </Text>
            </View>
          );
        }}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor={COLORS.textMuted}
          value={text}
          onChangeText={setText}
          maxLength={500}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, !text.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!text.trim()}
        >
          <Ionicons
            name="send"
            size={18}
            color={text.trim() ? COLORS.white : COLORS.textMuted}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundDark,
  },
  errorText: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 12,
  },
  backLink: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  chatTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    backgroundColor: COLORS.backgroundDark,
  },
  chatTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  safetyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,107,107,0.06)',
  },
  safetyText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  pinnedSnippet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  pinnedText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  revealBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,107,107,0.06)',
  },
  revealBannerSuccess: {
    backgroundColor: 'rgba(52,199,89,0.08)',
  },
  revealBannerText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
    flex: 1,
  },
  revealBannerTextSuccess: {
    color: '#34C759',
  },
  revealActions: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  revealPrompt: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  revealButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  revealAgreeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },
  revealAgreeText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.white,
  },
  revealDeclineButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  revealDeclineText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  revealRequestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  revealRequestText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  messageList: {
    padding: 16,
    paddingBottom: 8,
  },
  bubble: {
    maxWidth: '78%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.white,
    borderBottomLeftRadius: 4,
  },
  bubbleSender: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  bubbleSenderMe: {
    color: 'rgba(255,255,255,0.7)',
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20,
    color: COLORS.text,
  },
  bubbleTextMe: {
    color: COLORS.white,
  },
  bubbleTime: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  bubbleTimeMe: {
    color: 'rgba(255,255,255,0.7)',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 30 : 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 80,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.border,
  },
});
