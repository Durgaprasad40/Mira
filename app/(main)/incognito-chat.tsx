import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { maskExplicitWords, MASKED_CONTENT_NOTICE } from '@/lib/contentFilter';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useIsMandatoryComplete } from '@/stores/chatTodStore';
import { ChatTodOverlay, type ChatTodUser } from '@/components/truthdare/ChatTodOverlay';
import { ReportModal } from '@/components/private/ReportModal';
import { DEMO_INCOGNITO_PROFILES } from '@/lib/demoData';
import { trackEvent } from '@/lib/analytics';
import type { IncognitoMessage } from '@/types';

/** Look up Phase-2 intent label for a participant */
const getIntentLabel = (participantId: string): string | null => {
  const profile = DEMO_INCOGNITO_PROFILES.find((p) => p.id === participantId);
  if (!profile?.privateIntentKey) return null;
  const category = PRIVATE_INTENT_CATEGORIES.find((c) => c.key === profile.privateIntentKey);
  return category?.label ?? null;
};

export default function PrivateChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlashListRef<IncognitoMessage>>(null);

  // Measured header height for KAV offset
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setHeaderHeight(e.nativeEvent.layout.height);
  }, []);

  // Near-bottom tracking for smart auto-scroll
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  const conversations = usePrivateChatStore((s) => s.conversations);
  const storeMessages = usePrivateChatStore((s) => s.messages);
  const addMessage = usePrivateChatStore((s) => s.addMessage);
  const blockUser = usePrivateChatStore((s) => s.blockUser);

  const conversation = conversations.find((c) => c.id === id);
  const messages = id ? storeMessages[id] || [] : [];

  const [text, setText] = useState('');
  const [reportVisible, setReportVisible] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // ─── Truth-or-Dare Mandatory Game ───
  // Check if the mandatory T&D round is complete for this conversation
  const isMandatoryComplete = useIsMandatoryComplete(id || '');
  // Local state to force re-render when T&D unlocks (store updates may lag)
  const [localUnlocked, setLocalUnlocked] = useState(false);
  const showTodOverlay = !isMandatoryComplete && !localUnlocked;

  // Build users array for T&D overlay
  const todUsers: [ChatTodUser, ChatTodUser] | null = useMemo(() => {
    if (!conversation) return null;
    return [
      { id: 'me', name: 'You', avatarUrl: undefined }, // Current user (demo)
      {
        id: conversation.participantId,
        name: conversation.participantName,
        avatarUrl: conversation.participantPhotoUrl,
      },
    ];
  }, [conversation]);

  // T&D callbacks
  const handleTodUnlock = useCallback(() => {
    setLocalUnlocked(true);
    if (__DEV__) {
      console.log('[IncognitoChat] T&D unlocked, chat now available');
    }
  }, []);

  const handleTodOpenCamera = useCallback(() => {
    // Navigate to camera-composer with T&D context
    router.push({
      pathname: '/(main)/camera-composer' as any,
      params: { todConversationId: id, mode: 'tod_answer' },
    });
  }, [router, id]);

  // Auto-scroll only when new messages arrive AND user is near bottom
  useEffect(() => {
    const count = messages.length;
    if (count > prevMessageCountRef.current && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
    }
    prevMessageCountRef.current = count;
  }, [messages.length]);

  // Scroll to end when keyboard opens (WhatsApp behavior) + track visibility
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      }
    });
    const s2 = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { s1.remove(); s2.remove(); };
  }, []);

  // Phase-2 analytics: Track when chat opens
  useEffect(() => {
    if (!conversation || !id) return;
    // Look up participant's privateIntentKey for analytics
    const profile = DEMO_INCOGNITO_PROFILES.find((p) => p.id === conversation.participantId);
    trackEvent({
      name: 'phase2_match_started',
      conversationId: id,
      privateIntentKey: profile?.privateIntentKey,
    });
  }, [id, conversation?.id]);

  const handleSend = () => {
    if (!text.trim() || !id) return;
    const newMsg: IncognitoMessage = {
      id: `im_${Date.now()}`,
      conversationId: id,
      senderId: 'me',
      content: text.trim(),
      createdAt: Date.now(),
      isRead: false,
    };
    addMessage(id, newMsg);
    setText('');
  };

  const handleReport = (reason: string) => {
    console.log('Report submitted:', reason, 'for user:', conversation?.participantId);
    setReportVisible(false);
  };

  const handleBlock = () => {
    if (!conversation) return;
    blockUser(conversation.participantId);
    router.back();
  };

  if (!conversation) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerName}>Conversation not found</Text>
        </View>
      </View>
    );
  }

  const renderMessage = ({ item }: { item: IncognitoMessage }) => {
    const isOwn = item.senderId === 'me';
    const isSystem = item.senderId === 'system';

    if (isSystem) {
      return (
        <View style={styles.systemMsgRow}>
          <Text style={styles.systemMsgText}>{item.content}</Text>
        </View>
      );
    }

    // D2: Mask explicit words in private chat with "****"
    const { masked, wasMasked } = maskExplicitWords(item.content);

    return (
      <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
        {!isOwn && (
          <Image
            source={{ uri: conversation.participantPhotoUrl }}
            style={styles.msgAvatar}
            blurRadius={10}
          />
        )}
        <View style={[styles.msgBubble, isOwn ? styles.msgBubbleOwn : styles.msgBubbleOther]}>
          <Text style={[styles.msgText, isOwn && styles.msgTextOwn]}>{masked}</Text>
          {wasMasked && (
            <Text style={styles.maskedNotice}>{MASKED_CONTENT_NOTICE}</Text>
          )}
          <Text style={[styles.msgTime, isOwn && styles.msgTimeOwn]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header — sits above KAV, measured for keyboardVerticalOffset */}
      <View onLayout={onHeaderLayout} style={[styles.header, { marginTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Image
          source={{ uri: conversation.participantPhotoUrl }}
          style={styles.headerAvatar}
          blurRadius={10}
          contentFit="cover"
        />
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{conversation.participantName}</Text>
          {(() => {
            const intentLabel = getIntentLabel(conversation.participantId);
            return intentLabel ? (
              <Text style={styles.headerIntent}>{intentLabel}</Text>
            ) : null;
          })()}
          <Text style={styles.headerMeta}>{conversation.participantAge} · via {conversation.connectionSource}</Text>
        </View>
        <TouchableOpacity onPress={() => setReportVisible(true)} style={styles.moreButton}>
          <Ionicons name="ellipsis-vertical" size={20} color={C.textLight} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight + insets.top}
      >
        {/* Messages */}
        <FlashList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'flex-end' as const,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 0,
          }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        />

        {/* Input — sits at the bottom of KAV, pushed up by keyboard */}
        <View style={[styles.inputBar, { paddingBottom: keyboardVisible ? 0 : Math.max(insets.bottom, 8) }]}>
          <TextInput
            style={styles.textInput}
            placeholder="Type a message..."
            placeholderTextColor={C.textLight}
            value={text}
            onChangeText={setText}
            multiline
            scrollEnabled
            textAlignVertical="top"
            blurOnSubmit={false}
            maxLength={1000}
          />
          <TouchableOpacity
            style={[styles.sendButton, !text.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
          >
            <Ionicons name="send" size={20} color={text.trim() ? '#FFFFFF' : C.textLight} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Report/Block Modal */}
      <ReportModal
        visible={reportVisible}
        targetName={conversation.participantName}
        onClose={() => setReportVisible(false)}
        onReport={handleReport}
        onBlock={handleBlock}
      />

      {/* Truth-or-Dare Mandatory Overlay */}
      {showTodOverlay && todUsers && id && (
        <ChatTodOverlay
          conversationId={id}
          users={todUsers}
          onUnlock={handleTodUnlock}
          onOpenCamera={handleTodOpenCamera}
        />
      )}
    </View>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const C = INCOGNITO_COLORS;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  backButton: { marginRight: 8 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent },
  headerInfo: { flex: 1, marginLeft: 10 },
  headerName: { fontSize: 16, fontWeight: '600', color: C.text },
  headerIntent: { fontSize: 11, color: C.primary, opacity: 0.85, marginTop: 1 },
  headerMeta: { fontSize: 12, color: C.textLight },
  moreButton: { padding: 8 },


  systemMsgRow: { alignItems: 'center', marginBottom: 12 },
  systemMsgText: { fontSize: 12, color: C.textLight, fontStyle: 'italic', textAlign: 'center' },

  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  msgRowOwn: { flexDirection: 'row-reverse' },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8, backgroundColor: C.accent },
  msgBubble: { maxWidth: '75%', padding: 12, borderRadius: 16 },
  msgBubbleOwn: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: C.surface, borderBottomLeftRadius: 4 },
  msgText: { fontSize: 14, color: C.text, lineHeight: 20 },
  msgTextOwn: { color: '#FFFFFF' },
  msgTime: { fontSize: 10, color: C.textLight, marginTop: 4, textAlign: 'right' },
  msgTimeOwn: { color: 'rgba(255,255,255,0.7)' },
  maskedNotice: { fontSize: 10, color: C.textLight, fontStyle: 'italic', marginTop: 2 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: C.surface, gap: 8,
  },
  textInput: {
    flex: 1, backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14, color: C.text, maxHeight: 100,
  },
  sendButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: C.surface },
});
