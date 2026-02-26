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
  NativeSyntheticEvent,
  NativeScrollEvent,
  Keyboard,
  LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { safePush } from '@/lib/safeRouter';
import { COLORS } from '@/lib/constants';
import { useConfessionStore } from '@/stores/confessionStore';
import { useAuthStore } from '@/stores/authStore';
import { MutualRevealStatus } from '@/types';
import { logDebugEvent } from '@/lib/debugEventLogger';
import { formatTime, shouldShowTimestamp } from '@/utils/chatTime';

function formatTimeLeft(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
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
  const insets = useSafeAreaInsets();
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
  const confession = chat ? confessions.find((c) => c.id === chat.confessionId) : null;
  const confessionText = confession?.text;

  // Navigation guard: prevent opening expired chats or chats for expired confessions
  const EXPIRY_MS = 24 * 60 * 60 * 1000;
  const [guardTriggered, setGuardTriggered] = useState(false);
  useEffect(() => {
    if (guardTriggered || !chatId) return;

    const now = Date.now();

    // Check if chat doesn't exist
    if (!chat) {
      setGuardTriggered(true);
      logDebugEvent('CHAT_EXPIRED', `Confession chat not found: ${chatId}`);
      router.back();
      return;
    }

    // Check if chat is expired
    if (now > chat.expiresAt) {
      setGuardTriggered(true);
      logDebugEvent('CHAT_EXPIRED', `Confession chat expired: ${chatId}`);
      cleanupExpiredChats([chat.id]);
      router.back();
      return;
    }

    // Check if underlying confession is expired
    const confession = confessions.find((c) => c.id === chat.confessionId);
    if (confession) {
      const confessionExpiresAt = confession.expiresAt ?? (confession.createdAt + EXPIRY_MS);
      if (now > confessionExpiresAt) {
        setGuardTriggered(true);
        logDebugEvent('CHAT_EXPIRED', `Confession for chat expired: ${chat.confessionId}`);
        cleanupExpiredChats([chat.id]);
        router.back();
      }
    }
  }, [guardTriggered, chatId, chat, confessions, cleanupExpiredChats, router]);

  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  // Near-bottom tracking for smart auto-scroll
  const isNearBottomRef = useRef(true);
  const SCROLL_THRESHOLD = 120;
  const prevMessageCount = useRef(0);
  const hasInitialScrolled = useRef(false);

  // Keyboard visibility and composer height for proper layout
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [composerH, setComposerH] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Footer height for FlatList (exact spacing above composer)
  const footerH = composerH + (keyboardVisible ? 0 : insets.bottom) + 8;

  // Scroll to bottom helper
  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  // Track scroll position to determine if user is near bottom
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    isNearBottomRef.current = distanceFromBottom < SCROLL_THRESHOLD;
  }, []);

  // Initial scroll only after composer is measured
  useEffect(() => {
    if (!hasInitialScrolled.current && composerH > 0 && chat?.messages.length) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
      });
      hasInitialScrolled.current = true;
      prevMessageCount.current = chat.messages.length;
    }
  }, [composerH, chat?.messages.length]);

  // Scroll to bottom when message count increases (only if user is near bottom)
  useEffect(() => {
    const currentCount = chat?.messages.length ?? 0;
    if (hasInitialScrolled.current && currentCount > prevMessageCount.current && isNearBottomRef.current) {
      scrollToBottom(true);
    }
    prevMessageCount.current = currentCount;
  }, [chat?.messages.length, scrollToBottom]);

  // Auto-scroll when keyboard opens
  useEffect(() => {
    if (keyboardVisible && chat?.messages.length) {
      scrollToBottom(true);
    }
  }, [keyboardVisible, chat?.messages.length, scrollToBottom]);

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

  // Navigate to other person's profile during active reveal
  const handleViewRevealProfile = useCallback(() => {
    if (!chat || !confession) return;
    // Determine who the other person is
    const isTagged = confession.targetUserId === currentUserId;
    const otherUserId = isTagged ? confession.userId : confession.targetUserId;
    if (!otherUserId) return;

    // Navigate to profile with confess_reveal mode
    safePush(router, {
      pathname: '/(main)/profile/[id]',
      params: {
        id: otherUserId,
        mode: 'confess_reveal',
        chatId: chat.id,
        confessionId: confession.id,
      },
    } as any, 'confessionChat->revealProfile');
  }, [chat, confession, currentUserId, router]);

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

  // Expiry check: hide reveal CTAs when chat is expired (expiry overrides pending reveal)
  const isChatExpired = Date.now() > chat.expiresAt;

  // Per spec: Only the TAGGED person can request reveal
  // Confessor (author) can only accept/decline after tagged person requests
  const isTaggedPerson = confession?.targetUserId === currentUserId;
  const isConfessor = confession?.userId === currentUserId;

  // Track reveal agreement states based on chat role (initiator/responder in chat)
  const iAmChatInitiator = chat.initiatorId === currentUserId;
  const iHaveAgreed =
    (iAmChatInitiator && (revealStatus === 'initiator_agreed' || revealStatus === 'both_agreed')) ||
    (!iAmChatInitiator && (revealStatus === 'responder_agreed' || revealStatus === 'both_agreed'));

  // Tagged person requested reveal (regardless of chat role)
  const taggedPersonRequested = revealStatus === 'initiator_agreed' || revealStatus === 'responder_agreed';

  // Show accept/decline to confessor only when tagged person has requested (and chat not expired)
  const showConfessorPrompt = isConfessor && taggedPersonRequested && !iHaveAgreed && !isDeclined && !isChatExpired;

  // Show request button only to tagged person who hasn't agreed yet (and chat not expired)
  const showTaggedRequestButton = isTaggedPerson && revealStatus === 'none' && !isDeclined && !isChatExpired;

  // Show "waiting" status to tagged person after they requested (and chat not expired)
  const showTaggedWaiting = isTaggedPerson && taggedPersonRequested && !isRevealed && !isDeclined && iHaveAgreed && !isChatExpired;

  const statusText = getRevealStatusText(revealStatus, currentUserId, chat.initiatorId, chat.declinedBy);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
        <View style={{ width: 24 }} />
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

      {/* View Profile Button - Active when mutual reveal is complete */}
      {isRevealed && (
        <View style={styles.revealActions}>
          <TouchableOpacity style={styles.viewRevealProfileButton} onPress={handleViewRevealProfile}>
            <Ionicons name="person-circle-outline" size={18} color={COLORS.white} />
            <Text style={styles.viewRevealProfileText}>View Their Profile</Text>
          </TouchableOpacity>
          <Text style={styles.viewRevealHint}>Like to connect in Messages • Skip to keep chatting anonymously</Text>
        </View>
      )}

      {/* Reveal Action Buttons */}
      {/* Tagged person: show request button (only they can initiate) */}
      {showTaggedRequestButton && (
        <View style={styles.revealActions}>
          <TouchableOpacity style={styles.revealRequestButton} onPress={handleAgreeReveal}>
            <Ionicons name="eye" size={16} color={COLORS.primary} />
            <Text style={styles.revealRequestText}>Request Mutual Reveal</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tagged person: show waiting status after they requested */}
      {showTaggedWaiting && (
        <View style={styles.revealActions}>
          <View style={styles.revealWaitingRow}>
            <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.revealWaitingText}>Waiting for them to accept reveal...</Text>
          </View>
        </View>
      )}

      {/* Confessor: show accept/decline prompt when tagged person has requested */}
      {showConfessorPrompt && (
        <View style={styles.revealActions}>
          <Text style={styles.revealPrompt}>The person you confessed to wants to reveal identities. Accept?</Text>
          <View style={styles.revealButtonRow}>
            <TouchableOpacity style={styles.revealAgreeButton} onPress={handleAgreeReveal}>
              <Ionicons name="checkmark" size={16} color={COLORS.white} />
              <Text style={styles.revealAgreeText}>Accept Reveal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.revealDeclineButton} onPress={handleDeclineReveal}>
              <Ionicons name="close" size={16} color={COLORS.text} />
              <Text style={styles.revealDeclineText}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={chat.messages}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isMe = item.senderId === currentUserId;
            // Simple status: own messages shown as "seen" (blue ticks) for demo
            const ticks = isMe ? '✓✓' : '';
            const tickColor = '#34B7F1'; // WhatsApp blue for seen
            return (
              <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                {!isMe && <Text style={styles.bubbleSender}>Anon</Text>}
                <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.text}</Text>
                <View style={styles.bubbleMeta}>
                  <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                    {formatTime(item.createdAt)}
                  </Text>
                  {isMe && <Text style={[styles.bubbleTicks, { color: tickColor }]}>{ticks}</Text>}
                </View>
              </View>
            );
          }}
          ListFooterComponent={<View style={{ height: footerH }} />}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        />

        {/* Input */}
        <View
          style={[styles.inputBar, { paddingBottom: keyboardVisible ? 10 : Math.max(insets.bottom, 10) }]}
          onLayout={(e) => setComposerH(e.nativeEvent.layout.height)}
        >
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
    </SafeAreaView>
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
    paddingVertical: 12,
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
  revealWaitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  revealWaitingText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  viewRevealProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  viewRevealProfileText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },
  viewRevealHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
  messageList: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 0,
  },
  bubble: {
    maxWidth: '80%',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 3,
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
    marginBottom: 2,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 18,
    color: COLORS.text,
  },
  bubbleTextMe: {
    color: COLORS.white,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    gap: 3,
  },
  bubbleTime: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  bubbleTimeMe: {
    color: 'rgba(255,255,255,0.6)',
  },
  bubbleTicks: {
    fontSize: 11,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingTop: 10,
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
