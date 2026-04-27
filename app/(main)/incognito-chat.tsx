/**
 * Phase-2 Private Chat Screen
 *
 * Route: /(main)/incognito-chat?id=<privateConversationId>
 *
 * STRICT ISOLATION: Reads only from Phase-2 tables via privateConversations API.
 * - Header:   api.privateConversations.getPrivateConversation
 * - Messages: api.privateConversations.getPrivateMessages
 * - Send:     api.privateConversations.sendPrivateMessage (token-based auth)
 * - Read:     api.privateConversations.markPrivateMessagesRead
 *
 * Used by:
 *   - prompt-thread.tsx success sheet ("Say Hi" CTA)
 *   - chats.tsx inbox list tap
 *   - chats.tsx connect-success sheet
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, FONT_SIZE, SPACING } from '@/lib/constants';

type Phase2MessageRow = {
  id: Id<'privateMessages'>;
  conversationId: Id<'privateConversations'>;
  senderId: Id<'users'>;
  type: 'text' | 'image' | 'video' | 'voice' | 'system';
  content: string;
  deliveredAt?: number;
  readAt?: number;
  createdAt: number;
};

function isSystemContent(content: string): { isSystem: boolean; display: string } {
  if (content.startsWith('[SYSTEM:')) {
    const closeIdx = content.indexOf(']');
    if (closeIdx > 0) {
      return { isSystem: true, display: content.slice(closeIdx + 1) };
    }
  }
  return { isSystem: false, display: content };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours();
  const mm = d.getMinutes().toString().padStart(2, '0');
  const am = hh < 12 ? 'AM' : 'PM';
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${h12}:${mm} ${am}`;
}

export default function IncognitoChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const conversationIdParam = (Array.isArray(params.id) ? params.id[0] : params.id) || '';
  const conversationId = conversationIdParam as Id<'privateConversations'>;

  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const authReady = useAuthStore((s) => s.authReady);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sendInFlightRef = useRef(false);
  const listRef = useRef<FlashListRef<Phase2MessageRow> | null>(null);

  // Header / participant info
  const conversationInfo = useQuery(
    api.privateConversations.getPrivateConversation,
    authReady && userId && conversationIdParam
      ? { conversationId, authUserId: userId }
      : 'skip'
  );

  // Messages list
  const messages = useQuery(
    api.privateConversations.getPrivateMessages,
    authReady && userId && conversationIdParam
      ? { conversationId, authUserId: userId, limit: 100 }
      : 'skip'
  ) as Phase2MessageRow[] | undefined;

  const sendPrivateMessage = useMutation(api.privateConversations.sendPrivateMessage);
  const markPrivateMessagesRead = useMutation(api.privateConversations.markPrivateMessagesRead);
  // STRICT ISOLATION: Phase-2-only safety actions.
  // - blockUser/reportUser operate on shared `blocks`/`reports` tables (intentionally cross-phase by design).
  // - unmatchPrivate operates ONLY on Phase-2 tables; never `api.matches.unmatch`.
  const blockUserMutation = useMutation(api.users.blockUser);
  const reportUserMutation = useMutation(api.users.reportUser);
  const unmatchPrivateMutation = useMutation(api.privateSwipes.unmatchPrivate);

  // Mark as read whenever new messages arrive
  useEffect(() => {
    if (!authReady || !token || !conversationIdParam) return;
    if (!messages || messages.length === 0) return;
    const hasUnreadFromOther =
      userId != null &&
      messages.some((m) => m.senderId !== (userId as unknown as Id<'users'>) && !m.readAt);
    if (!hasUnreadFromOther) return;
    markPrivateMessagesRead({ token, conversationId }).catch((err) => {
      if (__DEV__) console.log('[P2_CHAT] markRead failed:', err?.message);
    });
  }, [
    messages,
    authReady,
    token,
    conversationId,
    conversationIdParam,
    userId,
    markPrivateMessagesRead,
  ]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToEnd({ animated: false });
      } catch {
        /* no-op */
      }
    });
  }, [messages?.length]);

  const handleSend = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!token || !conversationIdParam) {
      Alert.alert('Not signed in', 'Please sign in again to send messages.');
      return;
    }
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setSending(true);
    const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await sendPrivateMessage({
        token,
        conversationId,
        type: 'text',
        content: trimmed,
        clientMessageId,
      });
      setDraft('');
    } catch (err: any) {
      Alert.alert('Send failed', err?.message || 'Could not send message. Try again.');
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  }, [draft, token, conversationId, conversationIdParam, sendPrivateMessage]);

  // ----- Phase-2 header safety menu (block / report / unmatch) -----
  // Intentionally NOT using ReportBlockModal (Phase-1). All flows below are phase-safe:
  // block/report use shared cross-phase tables; unmatch hits ONLY Phase-2 privateMatches.
  const otherUserId = conversationInfo?.participantId as Id<'users'> | undefined;

  const handleBlock = useCallback(() => {
    if (!userId || !otherUserId) return;
    Alert.alert(
      'Block this user?',
      'They won’t be able to see or message you anywhere in the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUserMutation({ authUserId: userId, blockedUserId: otherUserId });
              router.back();
            } catch (err: any) {
              Alert.alert('Block failed', err?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  }, [userId, otherUserId, blockUserMutation, router]);

  const submitReport = useCallback(
    async (reason: 'inappropriate_photos' | 'harassment' | 'spam' | 'fake_profile' | 'other') => {
      if (!userId || !otherUserId) return;
      try {
        await reportUserMutation({
          authUserId: userId,
          reportedUserId: otherUserId,
          reason,
        });
        Alert.alert('Report submitted', 'Thanks — our team will review this.');
      } catch (err: any) {
        Alert.alert('Report failed', err?.message || 'Please try again.');
      }
    },
    [userId, otherUserId, reportUserMutation]
  );

  const handleReport = useCallback(() => {
    if (!userId || !otherUserId) return;
    Alert.alert('Report this user', 'Pick a reason:', [
      { text: 'Inappropriate photos', onPress: () => submitReport('inappropriate_photos') },
      { text: 'Harassment', onPress: () => submitReport('harassment') },
      { text: 'Spam', onPress: () => submitReport('spam') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [userId, otherUserId, submitReport]);

  const handleUnmatch = useCallback(() => {
    if (!userId || !conversationIdParam) return;
    Alert.alert(
      'Unmatch?',
      'This conversation will be removed from your inbox.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: async () => {
            try {
              await unmatchPrivateMutation({ authUserId: userId, conversationId });
              router.back();
            } catch (err: any) {
              Alert.alert('Unmatch failed', err?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  }, [userId, conversationId, conversationIdParam, unmatchPrivateMutation, router]);

  const handleHeaderMenu = useCallback(() => {
    if (!otherUserId) return;
    Alert.alert('Options', undefined, [
      { text: 'Block', style: 'destructive', onPress: handleBlock },
      { text: 'Report', onPress: handleReport },
      { text: 'Unmatch', style: 'destructive', onPress: handleUnmatch },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [otherUserId, handleBlock, handleReport, handleUnmatch]);

  const renderItem = useCallback(
    ({ item }: { item: Phase2MessageRow }) => {
      const { isSystem, display } = isSystemContent(item.content);
      if (isSystem || item.type === 'system') {
        return (
          <View style={styles.systemRow}>
            <Text style={styles.systemText}>{display}</Text>
          </View>
        );
      }
      const isOwn = userId != null && item.senderId === (userId as unknown as Id<'users'>);
      return (
        <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
          <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
            <Text
              style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}
            >
              {display}
            </Text>
            <Text
              style={[styles.bubbleTime, isOwn ? styles.bubbleTimeOwn : styles.bubbleTimeOther]}
            >
              {formatTime(item.createdAt)}
              {isOwn && item.readAt ? '  ✓✓' : isOwn && item.deliveredAt ? '  ✓' : ''}
            </Text>
          </View>
        </View>
      );
    },
    [userId]
  );

  const headerTitle = useMemo(() => {
    if (conversationInfo === undefined) return 'Loading…';
    if (conversationInfo === null) return 'Conversation';
    return conversationInfo.participantName || 'Connection';
  }, [conversationInfo]);

  const headerPhoto = conversationInfo?.participantPhotoUrl || null;
  const headerBlurred = conversationInfo?.isPhotoBlurred === true;

  if (!conversationIdParam) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>Conversation not specified.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.errorBackBtn}>
          <Text style={styles.errorBackText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!authReady || !userId) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (conversationInfo === null) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>This conversation isn’t available.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.errorBackBtn}>
          <Text style={styles.errorBackText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isBlocked = conversationInfo?.isBlocked === true;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerAvatarWrap}>
          {headerPhoto ? (
            <ExpoImage
              source={{ uri: headerPhoto }}
              style={styles.headerAvatar}
              contentFit="cover"
              blurRadius={headerBlurred ? 18 : 0}
            />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
              <Ionicons name="person" size={18} color={COLORS.textLight} />
            </View>
          )}
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>
            {headerTitle}
          </Text>
          {conversationInfo?.connectionSource === 'tod' ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              From a Truth & Dare connect
            </Text>
          ) : null}
        </View>
        {otherUserId ? (
          <TouchableOpacity
            onPress={handleHeaderMenu}
            style={styles.headerMenuBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Conversation options"
          >
            <Ionicons name="ellipsis-vertical" size={22} color={COLORS.text} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Messages */}
      <View style={styles.listWrap}>
        {messages === undefined ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : (
          <FlashList
            ref={(r) => {
              listRef.current = r;
            }}
            data={messages}
            keyExtractor={(item) => item.id as string}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => {
              try {
                listRef.current?.scrollToEnd({ animated: false });
              } catch {
                /* no-op */
              }
            }}
          />
        )}
      </View>

      {/* Input */}
      {isBlocked ? (
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
          <Text style={styles.blockedText}>
            Messaging is unavailable for this conversation.
          </Text>
        </View>
      ) : (
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
            multiline
            maxLength={5000}
            editable={!sending}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || draft.trim().length === 0}
            style={[
              styles.sendBtn,
              (sending || draft.trim().length === 0) && styles.sendBtnDisabled,
            ]}
            hitSlop={8}
          >
            {sending ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Ionicons name="send" size={18} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  backBtn: { padding: 4, marginRight: SPACING.xs },
  headerAvatarWrap: { marginRight: SPACING.sm },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
  },
  headerAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  headerName: { fontSize: FONT_SIZE.lg, fontWeight: '600', color: COLORS.text },
  headerSub: { fontSize: FONT_SIZE.xs, color: COLORS.textMuted, marginTop: 1 },
  headerMenuBtn: { padding: 4, marginLeft: SPACING.xs },

  listWrap: { flex: 1, backgroundColor: COLORS.background },
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
  },

  systemRow: { alignSelf: 'center', paddingVertical: SPACING.sm },
  systemText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  bubbleRow: { marginVertical: 4, flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  bubbleOwn: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: COLORS.backgroundDark,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: FONT_SIZE.md, lineHeight: 20 },
  bubbleTextOwn: { color: '#FFFFFF' },
  bubbleTextOther: { color: COLORS.text },
  bubbleTime: { fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.85)' },
  bubbleTimeOther: { color: COLORS.textMuted },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },
  blockedText: {
    flex: 1,
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    paddingVertical: SPACING.sm,
  },

  errorText: { color: COLORS.text, fontSize: FONT_SIZE.md, textAlign: 'center' },
  errorBackBtn: {
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
  },
  errorBackText: { color: '#FFF', fontWeight: '600' },
});
