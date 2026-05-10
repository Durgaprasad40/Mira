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
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { safePush } from '@/lib/safeRouter';
import { COLORS } from '@/lib/constants';
import { useConfessionStore } from '@/stores/confessionStore';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { logDebugEvent } from '@/lib/debugEventLogger';
import { formatTime } from '@/utils/chatTime';
import { Toast } from '@/components/ui/Toast';

type ConfessionConnectStatusValue =
  | 'pending'
  | 'mutual'
  | 'rejected_by_from'
  | 'rejected_by_to'
  | 'cancelled_by_from'
  | 'expired';

type ConfessionConnectViewerRole = 'requester' | 'owner' | null;
type ConfessionConnectIneligibleReason =
  | 'self'
  | 'user_ineligible'
  | 'blocked'
  | 'reported'
  | 'already_matched'
  | 'already_conversing';

type ConfessionConnectStatusResult = {
  exists: boolean;
  connectId?: string;
  status?: ConfessionConnectStatusValue;
  viewerRole: ConfessionConnectViewerRole;
  canRequest: boolean;
  canRespond: boolean;
  canCancel: boolean;
  expiresAt?: number;
  respondedAt?: number;
  conversationId?: string;
  ineligibleReason?: ConfessionConnectIneligibleReason;
  existingConversationId?: string;
  existingMatchId?: string;
};

type ConfessionConnectMutationResult = {
  status?: ConfessionConnectStatusValue;
  conversationId?: string;
  matchId?: string;
  otherUserId?: string;
  partnerUserId?: string;
  ineligibleReason?: ConfessionConnectIneligibleReason;
  existingConversationId?: string;
  existingMatchId?: string;
};

function formatTimeLeft(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export default function ConfessionChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const authReady = useAuthStore((s) => s.authReady);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : (userId ?? null);
  const liveUserLoading = !isDemoMode && !authReady;
  const liveUserUnavailable = !isDemoMode && authReady && (!currentUserId || !token);

  const chats = useConfessionStore((s) => s.chats);
  const confessions = useConfessionStore((s) => s.confessions);
  const addChatMessage = useConfessionStore((s) => s.addChatMessage);
  const cleanupExpiredChats = useConfessionStore((s) => s.cleanupExpiredChats);

  const chat = chats.find((c) => c.id === chatId) || null;
  const confession = chat ? confessions.find((c) => c.id === chat.confessionId) : null;
  const confessionText = confession?.text;
  const liveConfessionId = !isDemoMode ? (chat?.confessionId ?? null) : null;
  const connectStatus = useQuery(
    api.confessions.getConfessionConnectStatus,
    !isDemoMode && token && liveConfessionId
      ? { token, confessionId: liveConfessionId as any }
      : 'skip'
  ) as ConfessionConnectStatusResult | undefined;
  const requestConfessionConnectMutation = useMutation(api.confessions.requestConfessionConnect);
  const respondToConfessionConnectMutation = useMutation(api.confessions.respondToConfessionConnect);
  const cancelConfessionConnectMutation = useMutation(api.confessions.cancelConfessionConnect);

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
  const [connectAction, setConnectAction] = useState<'request' | 'cancel' | 'connect' | 'reject' | null>(null);
  const [connectDismissed, setConnectDismissed] = useState(false);

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

  const showUnavailableToast = useCallback(() => {
    Toast.show(liveUserLoading ? 'Chat is still loading. Please try again.' : 'Chat unavailable. Please try again.');
  }, [liveUserLoading]);

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
    if (!currentUserId) {
      showUnavailableToast();
      return;
    }
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
  }, [text, chat, currentUserId, addChatMessage, scrollToBottom, showUnavailableToast]);

  const openMessagesConversation = useCallback((conversationId?: string | null) => {
    const normalized = typeof conversationId === 'string' ? conversationId.trim() : '';
    if (!normalized) {
      Toast.show('The chat is not ready yet.');
      return;
    }
    safePush(
      router,
      `/(main)/(tabs)/messages/chat/${normalized}` as any,
      'confessionChat->messages'
    );
  }, [router]);

  const openConnectCelebration = useCallback((
    conversationId?: string | null,
    matchId?: string | null,
    otherUserId?: string | null
  ) => {
    const normalized = typeof conversationId === 'string' ? conversationId.trim() : '';
    if (!normalized) {
      Toast.show('Connected. Chat is being prepared.');
      return;
    }
    const params = new URLSearchParams({
      conversationId: normalized,
      source: 'confession',
      phase: 'phase1',
    });
    const normalizedMatchId = typeof matchId === 'string' ? matchId.trim() : '';
    if (normalizedMatchId) {
      params.set('matchId', normalizedMatchId);
    }
    const normalizedOtherUserId = typeof otherUserId === 'string' ? otherUserId.trim() : '';
    if (normalizedOtherUserId) {
      params.set('userId', normalizedOtherUserId);
      params.set('otherUserId', normalizedOtherUserId);
    }
    safePush(
      router,
      `/(main)/match-celebration?${params.toString()}` as any,
      'confessionChat->connectCelebration'
    );
  }, [router]);

  const handleRequestConnect = useCallback(async () => {
    if (isDemoMode) {
      Toast.show('Connect requests are available in live mode.');
      return;
    }
    if (!token || !liveConfessionId || connectAction) {
      showUnavailableToast();
      return;
    }
    setConnectAction('request');
    try {
      const result = await requestConfessionConnectMutation({
        token,
        confessionId: liveConfessionId as any,
      }) as ConfessionConnectMutationResult;
      setConnectDismissed(false);
      if (result?.status === 'mutual' && result.conversationId) {
        openConnectCelebration(
          result.conversationId,
          result.matchId,
          result.otherUserId ?? result.partnerUserId
        );
      } else {
        Toast.show('Request sent. Waiting for them to connect.');
      }
    } catch (error: any) {
      Alert.alert('Connect unavailable', error?.message || 'Please try again later.');
    } finally {
      setConnectAction(null);
    }
  }, [
    connectAction,
    liveConfessionId,
    openConnectCelebration,
    requestConfessionConnectMutation,
    showUnavailableToast,
    token,
  ]);

  const handleSkipOrCancelConnect = useCallback(async () => {
    if (isDemoMode) {
      Toast.show('Connect skipped for now.');
      return;
    }
    if (!connectStatus?.connectId || !connectStatus.canCancel || !token) {
      setConnectDismissed(true);
      Toast.show('Connect skipped for now.');
      return;
    }
    if (connectAction) return;
    setConnectAction('cancel');
    try {
      await cancelConfessionConnectMutation({
        token,
        connectId: connectStatus.connectId as any,
      });
      Toast.show('Connect request cancelled.');
    } catch (error: any) {
      Alert.alert('Unable to cancel', error?.message || 'Please try again later.');
    } finally {
      setConnectAction(null);
    }
  }, [
    cancelConfessionConnectMutation,
    connectAction,
    connectStatus,
    token,
  ]);

  const handleOwnerConnectDecision = useCallback(async (decision: 'connect' | 'reject') => {
    if (isDemoMode) {
      Toast.show(decision === 'connect' ? 'Connected.' : 'Connect request declined.');
      return;
    }
    if (!connectStatus?.connectId || !token || connectAction) {
      showUnavailableToast();
      return;
    }
    setConnectAction(decision);
    try {
      const result = await respondToConfessionConnectMutation({
        token,
        connectId: connectStatus.connectId as any,
        decision,
      }) as ConfessionConnectMutationResult;
      if (decision === 'connect') {
        if (result?.conversationId) {
          openConnectCelebration(
            result.conversationId,
            result.matchId,
            result.otherUserId ?? result.partnerUserId
          );
        } else {
          Toast.show('Connected. Chat is being prepared.');
        }
      } else {
        Toast.show('Connect request declined.');
      }
    } catch (error: any) {
      Alert.alert('Connect unavailable', error?.message || 'Please try again later.');
    } finally {
      setConnectAction(null);
    }
  }, [
    connectAction,
    connectStatus,
    openConnectCelebration,
    respondToConfessionConnectMutation,
    showUnavailableToast,
    token,
  ]);

  if (liveUserLoading || liveUserUnavailable) {
    return (
      <View style={styles.center}>
        {liveUserLoading ? <ActivityIndicator size="small" color={COLORS.primary} /> : null}
        <Text style={styles.errorText}>
          {liveUserLoading ? 'Loading chat...' : 'Chat unavailable'}
        </Text>
        {liveUserUnavailable ? (
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

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

  // Expiry check: hide connect CTAs when this legacy anonymous chat is expired.
  const isChatExpired = Date.now() > chat.expiresAt;

  const renderLiveConnectPanel = () => {
    if (isDemoMode) {
      return (
        <View style={styles.connectActions}>
          <View style={styles.connectWaitingRow}>
            <Ionicons name="heart-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.connectWaitingText}>Connect requests are available in live mode.</Text>
          </View>
        </View>
      );
    }
    if (!token || !liveConfessionId) {
      return (
        <View style={styles.connectActions}>
          <View style={styles.connectWaitingRow}>
            <Ionicons name="alert-circle-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.connectWaitingText}>Connect unavailable right now.</Text>
          </View>
        </View>
      );
    }

    if (connectStatus === undefined) {
      return (
        <View style={styles.connectActions}>
          <View style={styles.connectWaitingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.connectWaitingText}>Checking connect status...</Text>
          </View>
        </View>
      );
    }

    const status = connectStatus.status;
    const actionBusy = connectAction !== null;
    const disabled = actionBusy || isChatExpired;
    const alreadyConnected =
      connectStatus.ineligibleReason === 'already_matched' ||
      connectStatus.ineligibleReason === 'already_conversing';
    const alreadyConnectedConversationId =
      connectStatus.existingConversationId ?? connectStatus.conversationId;

    if (!connectStatus.viewerRole) return null;

    if (alreadyConnected) {
      return (
        <>
          <View style={[styles.connectBanner, styles.connectBannerSuccess]}>
            <Ionicons name="checkmark-circle" size={16} color="#34C759" />
            <Text style={[styles.connectBannerText, styles.connectBannerTextSuccess]}>
              Already connected.
            </Text>
          </View>
          {alreadyConnectedConversationId ? (
            <View style={styles.connectActions}>
              <TouchableOpacity
                style={styles.openChatButton}
                onPress={() => openMessagesConversation(alreadyConnectedConversationId)}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.white} />
                <Text style={styles.openChatButtonText}>
                  Already connected · Open chat
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      );
    }

    if (status === 'mutual') {
      return (
        <>
          <View style={[styles.connectBanner, styles.connectBannerSuccess]}>
            <Ionicons name="checkmark-circle" size={16} color="#34C759" />
            <Text style={[styles.connectBannerText, styles.connectBannerTextSuccess]}>
              You both connected. Continue in Messages.
            </Text>
          </View>
          <View style={styles.connectActions}>
            <TouchableOpacity
              style={styles.openChatButton}
              onPress={() => openMessagesConversation(connectStatus.conversationId)}
              disabled={!connectStatus.conversationId}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.white} />
              <Text style={styles.openChatButtonText}>Open Chat</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }

    if (
      status === 'rejected_by_from' ||
      status === 'rejected_by_to' ||
      status === 'cancelled_by_from' ||
      status === 'expired'
    ) {
      const copy =
        status === 'expired'
          ? 'Request expired.'
          : status === 'cancelled_by_from'
            ? 'Request cancelled.'
            : connectStatus.viewerRole === 'requester'
              ? 'Request declined.'
              : 'Request rejected.';
      return (
        <View style={styles.connectBanner}>
          <Ionicons name="close-circle-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.connectBannerText}>{copy}</Text>
        </View>
      );
    }

    if (connectStatus.viewerRole === 'requester') {
      if (status === 'pending') {
        return (
          <View style={styles.connectActions}>
            <View style={styles.connectWaitingRow}>
              <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.connectWaitingText}>
                Request sent. Waiting for them to connect. Your identity stays protected until both sides connect.
              </Text>
            </View>
            {connectStatus.canCancel ? (
              <TouchableOpacity
                style={styles.connectSecondaryButton}
                onPress={handleSkipOrCancelConnect}
                disabled={actionBusy}
              >
                {connectAction === 'cancel' ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <>
                    <Ionicons name="close" size={16} color={COLORS.text} />
                    <Text style={styles.connectSecondaryButtonText}>Cancel Request</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        );
      }

      if (!connectStatus.exists && connectStatus.canRequest && !connectDismissed) {
        return (
          <View style={styles.connectActions}>
            <Text style={styles.connectPrompt}>
              Connect opens a real Messages chat only if both sides connect. Your identity stays protected until both sides connect.
            </Text>
            <View style={styles.connectButtonRow}>
              <TouchableOpacity
                style={[styles.connectPrimaryButton, disabled && styles.sendButtonDisabled]}
                onPress={handleRequestConnect}
                disabled={disabled}
              >
                {connectAction === 'request' ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="heart" size={16} color={COLORS.white} />
                    <Text style={styles.connectPrimaryButtonText}>Connect</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.connectSecondaryButton}
                onPress={handleSkipOrCancelConnect}
                disabled={actionBusy}
              >
                <Ionicons name="close" size={16} color={COLORS.text} />
                <Text style={styles.connectSecondaryButtonText}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }

      if (connectDismissed) {
        return (
          <View style={styles.connectActions}>
            <View style={styles.connectWaitingRow}>
              <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.connectWaitingText}>Connect skipped for now.</Text>
            </View>
          </View>
        );
      }
    }

    if (connectStatus.viewerRole === 'owner') {
      if (status === 'pending' && connectStatus.canRespond) {
        return (
          <View style={styles.connectActions}>
            <Text style={styles.connectPrompt}>
              Someone wants to connect from your confession. Your identity stays protected until both sides connect.
            </Text>
            <View style={styles.connectButtonRow}>
              <TouchableOpacity
                style={[styles.connectPrimaryButton, disabled && styles.sendButtonDisabled]}
                onPress={() => void handleOwnerConnectDecision('connect')}
                disabled={disabled}
              >
                {connectAction === 'connect' ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color={COLORS.white} />
                    <Text style={styles.connectPrimaryButtonText}>Connect</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.connectSecondaryButton}
                onPress={() => void handleOwnerConnectDecision('reject')}
                disabled={actionBusy}
              >
                {connectAction === 'reject' ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <>
                    <Ionicons name="close" size={16} color={COLORS.text} />
                    <Text style={styles.connectSecondaryButtonText}>Reject</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        );
      }
      if (!connectStatus.exists) {
        return (
          <View style={styles.connectActions}>
            <View style={styles.connectWaitingRow}>
              <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.connectWaitingText}>No connect request yet.</Text>
            </View>
          </View>
        );
      }
    }

    return null;
  };

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
            Anonymous Chat
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

      {renderLiveConnectPanel()}

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
            editable={!!currentUserId}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!text.trim() || !currentUserId) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || !currentUserId}
          >
            <Ionicons
              name="send"
              size={18}
              color={text.trim() && currentUserId ? COLORS.white : COLORS.textMuted}
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
  connectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,107,107,0.06)',
  },
  connectBannerSuccess: {
    backgroundColor: 'rgba(52,199,89,0.08)',
  },
  connectBannerText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
    flex: 1,
  },
  connectBannerTextSuccess: {
    color: '#34C759',
  },
  connectActions: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  connectPrompt: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  connectButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  connectPrimaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },
  connectPrimaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.white,
  },
  connectSecondaryButton: {
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
  connectSecondaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  connectWaitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  connectWaitingText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  openChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  openChatButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
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
