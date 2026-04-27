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
import * as ImagePicker from 'expo-image-picker';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, FONT_SIZE, SPACING } from '@/lib/constants';
import { Phase2ProtectedMediaBubble } from '@/components/private/Phase2ProtectedMediaBubble';
import { Phase2ProtectedMediaViewer } from '@/components/private/Phase2ProtectedMediaViewer';
import { Phase2VoiceRecorder } from '@/components/private/Phase2VoiceRecorder';
// Pure-UI voice playback bubble. Verified to make ZERO `api.*` calls; uses
// the pure Zustand audioPlayerStore. Safe to reuse across phases.
import DmAudioBubble from '@/components/chatroom/DmAudioBubble';

type Phase2MessageRow = {
  id: Id<'privateMessages'>;
  conversationId: Id<'privateConversations'>;
  senderId: Id<'users'>;
  type: 'text' | 'image' | 'video' | 'voice' | 'system';
  content: string;
  deliveredAt?: number;
  readAt?: number;
  createdAt: number;
  // Phase-2 protected media fields (returned by getPrivateMessages when isProtected=true)
  isProtected?: boolean;
  imageUrl?: string | null;
  protectedMediaTimer?: number;
  protectedMediaViewingMode?: 'tap' | 'hold';
  protectedMediaIsMirrored?: boolean;
  viewedAt?: number;
  timerEndsAt?: number;
  isExpired?: boolean;
  // Phase-2 voice fields (returned by getPrivateMessages when type='voice')
  audioUrl?: string | null;
  audioDurationMs?: number;
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
  // STRICT ISOLATION: Phase-2 typing presence. Never `api.typingStatus.*` (Phase-1).
  const setPrivateTypingStatus = useMutation(api.privateConversations.setPrivateTypingStatus);
  const otherTyping = useQuery(
    api.privateConversations.getPrivateTypingStatus,
    authReady && userId && conversationIdParam
      ? { conversationId, authUserId: userId }
      : 'skip'
  );
  // STRICT ISOLATION: Phase-2-only safety actions.
  // - blockUser/reportUser operate on shared `blocks`/`reports` tables (intentionally cross-phase by design).
  // - unmatchPrivate operates ONLY on Phase-2 tables; never `api.matches.unmatch`.
  const blockUserMutation = useMutation(api.users.blockUser);
  const reportUserMutation = useMutation(api.users.reportUser);
  const unmatchPrivateMutation = useMutation(api.privateSwipes.unmatchPrivate);
  // Phase-2 secure media upload URL (NOT Phase-1 protectedMedia.*)
  const generateSecureUploadUrl = useMutation(
    api.privateConversations.generateSecureMediaUploadUrl
  );

  // Protected media UI state
  const [sendingProtected, setSendingProtected] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerMessage, setViewerMessage] = useState<Phase2MessageRow | null>(null);

  // Typing-presence state (Phase-2-only):
  // - typingActiveRef: true when we last told backend we ARE typing (avoids per-keystroke RPC).
  // - typingIdleTimerRef: clears typing after 3s of no input.
  const typingActiveRef = useRef(false);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendTypingState = useCallback(
    (isTyping: boolean) => {
      if (!token || !conversationIdParam) return;
      setPrivateTypingStatus({ token, conversationId, isTyping }).catch((err) => {
        if (__DEV__) console.log('[P2_CHAT] setTyping failed:', err?.message);
      });
    },
    [token, conversationId, conversationIdParam, setPrivateTypingStatus]
  );

  const clearTypingIdleTimer = useCallback(() => {
    if (typingIdleTimerRef.current) {
      clearTimeout(typingIdleTimerRef.current);
      typingIdleTimerRef.current = null;
    }
  }, []);

  const stopTyping = useCallback(() => {
    clearTypingIdleTimer();
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      sendTypingState(false);
    }
  }, [clearTypingIdleTimer, sendTypingState]);

  const noteUserActivity = useCallback(() => {
    if (!token || !conversationIdParam) return;
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      sendTypingState(true);
    }
    clearTypingIdleTimer();
    typingIdleTimerRef.current = setTimeout(() => {
      typingActiveRef.current = false;
      sendTypingState(false);
    }, 3000);
  }, [token, conversationIdParam, sendTypingState, clearTypingIdleTimer]);

  // Cleanup typing presence on unmount.
  useEffect(() => {
    return () => {
      clearTypingIdleTimer();
      if (typingActiveRef.current && token && conversationIdParam) {
        // Fire-and-forget; component is unmounting.
        setPrivateTypingStatus({ token, conversationId, isTyping: false }).catch(() => {});
        typingActiveRef.current = false;
      }
    };
  }, [clearTypingIdleTimer, token, conversationId, conversationIdParam, setPrivateTypingStatus]);

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
      // Clear typing presence right after a successful send.
      stopTyping();
    } catch (err: any) {
      Alert.alert('Send failed', err?.message || 'Could not send message. Try again.');
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  }, [draft, token, conversationId, conversationIdParam, sendPrivateMessage, stopTyping]);

  const handleDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      if (next.length === 0) {
        // User cleared the input → no longer typing.
        stopTyping();
      } else {
        noteUserActivity();
      }
    },
    [noteUserActivity, stopTyping]
  );

  // ----- Phase-2 protected (secure) image send -----
  // STRICT ISOLATION: uses ONLY Phase-2 backend:
  //   api.privateConversations.generateSecureMediaUploadUrl
  //   api.privateConversations.sendPrivateMessage (with isProtected=true, imageStorageId)
  // Never uses Phase-1 api.media.* or api.protectedMedia.*.
  const sendProtectedImage = useCallback(
    async (
      uri: string,
      timerSeconds: number,
      viewingMode: 'tap' | 'hold'
    ) => {
      if (!token || !conversationIdParam) {
        Alert.alert('Not signed in', 'Please sign in again to send media.');
        return;
      }
      if (sendingProtected) return;
      setSendingProtected(true);
      try {
        // 1. Get a Phase-2 upload URL
        const uploadUrl = await generateSecureUploadUrl({ token });

        // 2. POST the file bytes to Convex storage
        const fileResp = await fetch(uri);
        const blob = await fileResp.blob();
        const uploadResp = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'image/jpeg' },
          body: blob,
        });
        if (!uploadResp.ok) {
          throw new Error(`Upload failed: ${uploadResp.status}`);
        }
        const { storageId } = (await uploadResp.json()) as {
          storageId: Id<'_storage'>;
        };

        // 3. Send a Phase-2 message referencing the uploaded asset
        const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await sendPrivateMessage({
          token,
          conversationId,
          type: 'image',
          content: '',
          imageStorageId: storageId,
          isProtected: true,
          protectedMediaTimer: timerSeconds, // 0 = view-once
          protectedMediaViewingMode: viewingMode,
          clientMessageId,
        });
      } catch (err: any) {
        Alert.alert('Send failed', err?.message || 'Could not send secure photo.');
      } finally {
        setSendingProtected(false);
      }
    },
    [
      token,
      conversationId,
      conversationIdParam,
      sendingProtected,
      generateSecureUploadUrl,
      sendPrivateMessage,
    ]
  );

  const promptProtectedTimerAndSend = useCallback(
    (uri: string) => {
      // Minimal options sheet via Alert (avoids Phase-1 TelegramMediaSheet/CameraPhotoSheet).
      Alert.alert('Secure photo timer', 'How should the recipient view it?', [
        {
          text: 'View once (tap)',
          onPress: () => sendProtectedImage(uri, 0, 'tap'),
        },
        {
          text: 'Hold to view (10s)',
          onPress: () => sendProtectedImage(uri, 10, 'hold'),
        },
        {
          text: 'Tap to view (10s)',
          onPress: () => sendProtectedImage(uri, 10, 'tap'),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [sendProtectedImage]
  );

  // ----- Phase-2 voice message send -----
  // STRICT ISOLATION: uses ONLY Phase-2 backend:
  //   api.privateConversations.generateSecureMediaUploadUrl  (generic upload URL after auth)
  //   api.privateConversations.sendPrivateMessage  (type='voice', audioStorageId, audioDurationMs)
  // Never uses Phase-1 audio/storage helpers.
  const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);

  const sendVoiceMessage = useCallback(
    async (audioUri: string, durationMs: number) => {
      if (!token || !conversationIdParam) {
        Alert.alert('Not signed in', 'Please sign in again to send a voice note.');
        return;
      }
      if (uploadingVoice) return;
      setUploadingVoice(true);
      try {
        // 1. Phase-2 upload URL
        const uploadUrl = await generateSecureUploadUrl({ token });
        // 2. POST audio bytes to Convex storage
        const fileResp = await fetch(audioUri);
        const blob = await fileResp.blob();
        const uploadResp = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/m4a' },
          body: blob,
        });
        if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
        const { storageId } = (await uploadResp.json()) as { storageId: Id<'_storage'> };
        // 3. Phase-2 message
        const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await sendPrivateMessage({
          token,
          conversationId,
          type: 'voice',
          content: '',
          audioStorageId: storageId,
          audioDurationMs: Math.round(durationMs),
          clientMessageId,
        });
        setVoiceRecorderOpen(false);
      } catch (err: any) {
        Alert.alert('Send failed', err?.message || 'Could not send voice note.');
      } finally {
        setUploadingVoice(false);
      }
    },
    [
      token,
      conversationId,
      conversationIdParam,
      uploadingVoice,
      generateSecureUploadUrl,
      sendPrivateMessage,
    ]
  );

  const closeVoiceRecorder = useCallback(() => {
    if (uploadingVoice) return;
    setVoiceRecorderOpen(false);
  }, [uploadingVoice]);

  const handleAttachProtected = useCallback(async () => {
    if (sendingProtected) return;
    try {
      // Permission flow
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission needed',
          'Allow photo library access to send a secure photo.'
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      promptProtectedTimerAndSend(asset.uri);
    } catch (err: any) {
      Alert.alert('Attach failed', err?.message || 'Could not open photo library.');
    }
  }, [sendingProtected, promptProtectedTimerAndSend]);

  // Phase-2-safe attach action sheet. Built on `Alert.alert` to avoid Phase-1
  // TelegramMediaSheet/CameraPhotoSheet. Defined AFTER `handleAttachProtected`
  // so the dependency array references a fully-initialised callback.
  const handleAttachMenu = useCallback(() => {
    if (sendingProtected || uploadingVoice) return;
    Alert.alert('Send', 'Pick a media type', [
      { text: 'Secure photo', onPress: () => handleAttachProtected() },
      { text: 'Voice note', onPress: () => setVoiceRecorderOpen(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [sendingProtected, uploadingVoice, handleAttachProtected]);

  const openProtectedViewer = useCallback((msg: Phase2MessageRow) => {
    setViewerMessage(msg);
    setViewerOpen(true);
  }, []);

  const closeProtectedViewer = useCallback(() => {
    setViewerOpen(false);
    setViewerMessage(null);
  }, []);

  // Build viewer messageData from a Phase-2 backend row (no Phase-1 shape).
  const viewerMessageData = useMemo(() => {
    if (!viewerMessage) return null;
    const timerSec = viewerMessage.protectedMediaTimer ?? 0;
    return {
      id: viewerMessage.id as string,
      isProtected: viewerMessage.isProtected ?? true,
      isExpired: viewerMessage.isExpired,
      viewedAt: viewerMessage.viewedAt,
      timerEndsAt: viewerMessage.timerEndsAt,
      protectedMedia: {
        localUri: viewerMessage.imageUrl ?? undefined,
        mediaType: 'photo' as const,
        timer: timerSec,
        viewingMode: viewerMessage.protectedMediaViewingMode ?? 'tap',
        isMirrored: viewerMessage.protectedMediaIsMirrored,
        expiresDurationMs: timerSec * 1000,
      },
    };
  }, [viewerMessage]);

  const isViewerSenderViewing = useMemo(() => {
    if (!viewerMessage || !userId) return false;
    return viewerMessage.senderId === (userId as unknown as Id<'users'>);
  }, [viewerMessage, userId]);

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
      // Phase-2 voice row: pure-UI DmAudioBubble. Backend `getPrivateMessages`
      // returns `audioUrl` for type='voice' messages.
      if (item.type === 'voice' && item.audioUrl) {
        return (
          <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
            <DmAudioBubble
              messageId={item.id as string}
              audioUrl={item.audioUrl}
              isMe={isOwn}
              bubbleColor={isOwn ? COLORS.primary : COLORS.backgroundDark}
            />
          </View>
        );
      }
      // Phase-2 protected media row: render the secure tile and let the viewer modal handle reveal/expiry.
      if (item.isProtected) {
        return (
          <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
            <Phase2ProtectedMediaBubble
              isOwn={isOwn}
              isProtected={item.isProtected === true}
              isExpired={item.isExpired}
              viewedAt={item.viewedAt}
              timerEndsAt={item.timerEndsAt}
              protectedMediaTimer={item.protectedMediaTimer}
              protectedMediaViewingMode={item.protectedMediaViewingMode}
              onOpen={() => openProtectedViewer(item)}
            />
          </View>
        );
      }
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
    [userId, openProtectedViewer]
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

      {/* Typing indicator (Phase-2). Subtle dots strip just above the input bar. */}
      {otherTyping?.isTyping && !isBlocked ? (
        <View style={styles.typingRow} accessibilityLabel="Other user is typing">
          <View style={styles.typingDots}>
            <View style={[styles.typingDot, styles.typingDot1]} />
            <View style={[styles.typingDot, styles.typingDot2]} />
            <View style={[styles.typingDot, styles.typingDot3]} />
          </View>
          <Text style={styles.typingText}>typing…</Text>
        </View>
      ) : null}

      {/* Input */}
      {isBlocked ? (
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
          <Text style={styles.blockedText}>
            Messaging is unavailable for this conversation.
          </Text>
        </View>
      ) : (
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
          <TouchableOpacity
            onPress={handleAttachMenu}
            disabled={sendingProtected || uploadingVoice}
            style={[
              styles.attachBtn,
              (sendingProtected || uploadingVoice) && styles.sendBtnDisabled,
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open media options"
          >
            {sendingProtected || uploadingVoice ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="add-circle-outline" size={26} color={COLORS.primary} />
            )}
          </TouchableOpacity>
          <TextInput
            value={draft}
            onChangeText={handleDraftChange}
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

      {/* Phase-2 protected media viewer (modal). Phase-2-only: uses
          api.privateConversations.markPrivateSecureMedia* internally. */}
      <Phase2ProtectedMediaViewer
        visible={viewerOpen && viewerMessage != null}
        conversationId={conversationIdParam}
        messageId={(viewerMessage?.id as string) ?? ''}
        onClose={closeProtectedViewer}
        messageData={viewerMessageData}
        isSenderViewing={isViewerSenderViewing}
      />

      {/* Phase-2 voice recorder (pure-UI). Upload + send is handled by
          `sendVoiceMessage` using only Phase-2 mutations. */}
      <Phase2VoiceRecorder
        visible={voiceRecorderOpen}
        onCancel={closeVoiceRecorder}
        onComplete={sendVoiceMessage}
        isUploading={uploadingVoice}
      />
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

  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    backgroundColor: COLORS.background,
  },
  typingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
    marginRight: 3,
    opacity: 0.45,
  },
  typingDot1: { opacity: 0.85 },
  typingDot2: { opacity: 0.65 },
  typingDot3: { opacity: 0.4 },
  typingText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
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
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
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
