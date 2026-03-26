/**
 * Phase-2 Private Chat Screen
 * P0-002b FIX: Migrated to use Phase-2 privateConversations backend
 *
 * Backend source: privateMessages table
 * Queries: getPrivateMessages, sendPrivateMessage, markPrivateMessagesRead
 */
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
  NativeSyntheticEvent,
  NativeScrollEvent,
  Alert,
  InteractionManager,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { popHandoff } from '@/lib/memoryHandoff';
import * as ImagePicker from 'expo-image-picker';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { maskExplicitWords, MASKED_CONTENT_NOTICE } from '@/lib/contentFilter';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { useAuthStore } from '@/stores/authStore';
import { BottleSpinGame } from '@/components/chat/BottleSpinGame';
import { CameraPhotoSheet, type CameraPhotoOptions } from '@/components/chat/CameraPhotoSheet';
import { ReportModal } from '@/components/private/ReportModal';
import { Phase2ProtectedMediaViewer } from '@/components/private/Phase2ProtectedMediaViewer';
import { calculateProtectedMediaCountdown } from '@/utils/protectedMediaCountdown';
import { DEMO_INCOGNITO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { trackEvent } from '@/lib/analytics';
import { useVoiceRecorder, type VoiceRecorderResult } from '@/hooks/useVoiceRecorder';
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble';
import type { IncognitoMessage } from '@/types';

// ═══════════════════════════════════════════════════════════════════════════
// P0-002b: Message type for backend messages (mapped for UI compatibility)
// ═══════════════════════════════════════════════════════════════════════════
interface BackendMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: string;
  content: string;
  createdAt: number;
  readAt?: number;
  deliveredAt?: number;
}

/** Look up Phase-2 intent label for a participant (checks both demoStore and DEMO_INCOGNITO_PROFILES) */
const getIntentLabel = (participantId: string): string | null => {
  // First check demoStore profiles (for DesireLand matches with demo_profile_* IDs)
  const demoProfile = useDemoStore.getState().profiles.find((p) => p._id === participantId);
  if (demoProfile?.privateIntentKey) {
    const category = PRIVATE_INTENT_CATEGORIES.find((c) => c.key === demoProfile.privateIntentKey);
    return category?.label ?? null;
  }
  // Fallback to DEMO_INCOGNITO_PROFILES (for inc_* IDs from ToD/Room matches)
  const incognitoProfile = DEMO_INCOGNITO_PROFILES.find((p) => p.id === participantId);
  if (!incognitoProfile?.privateIntentKey) return null;
  const category = PRIVATE_INTENT_CATEGORIES.find((c) => c.key === incognitoProfile.privateIntentKey);
  return category?.label ?? null;
};

/** Look up privateIntentKey for analytics (checks both demoStore and DEMO_INCOGNITO_PROFILES) */
const getPrivateIntentKey = (participantId: string): string | undefined => {
  // First check demoStore profiles (for DesireLand matches with demo_profile_* IDs)
  const demoProfile = useDemoStore.getState().profiles.find((p) => p._id === participantId);
  if (demoProfile?.privateIntentKey) return demoProfile.privateIntentKey;
  // Fallback to DEMO_INCOGNITO_PROFILES (for inc_* IDs from ToD/Room matches)
  const incognitoProfile = DEMO_INCOGNITO_PROFILES.find((p) => p.id === participantId);
  return incognitoProfile?.privateIntentKey;
};

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE-TICKS-FIX: Helper functions for message status ticks
// Following Phase-1 pattern exactly: sent (1 gray), delivered (2 gray), read (2 blue)
// ═══════════════════════════════════════════════════════════════════════════
type TickStatus = 'sent' | 'delivered' | 'read';

function getTickStatus(message: { readAt?: number; deliveredAt?: number }): TickStatus {
  if (message.readAt) return 'read';
  if (message.deliveredAt) return 'delivered';
  return 'sent';
}

function getTickIcon(status: TickStatus): 'checkmark' | 'checkmark-done' {
  return status === 'sent' ? 'checkmark' : 'checkmark-done';
}

function getTickColor(status: TickStatus): string {
  if (status === 'read') {
    return '#34B7F1'; // Blue for read (WhatsApp-style)
  }
  // White/light for sent and delivered on dark bubbles
  return 'rgba(255,255,255,0.8)';
}

export default function PrivateChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlashListRef<IncognitoMessage>>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002b: Auth for backend mutations
  // ═══════════════════════════════════════════════════════════════════════════
  const { token, userId: currentUserId } = useAuthStore();

  // ─── Composer height tracking (matches locked chat-rooms pattern) ───
  const [composerHeight, setComposerHeight] = useState(56);
  // Phase-1 style: + menu state
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Near-bottom tracking for smart auto-scroll
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  // Local store - ONLY used for conversation metadata (header info), NOT messages
  const conversations = usePrivateChatStore((s) => s.conversations);
  const blockUser = usePrivateChatStore((s) => s.blockUser);

  const conversation = conversations.find((c) => c.id === id);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002b: Backend message fetching (replaces local store)
  // ═══════════════════════════════════════════════════════════════════════════
  const backendMessages = useQuery(
    api.privateConversations.getPrivateMessages,
    id && currentUserId
      ? { conversationId: id as Id<'privateConversations'>, authUserId: currentUserId }
      : 'skip'
  );

  // Map backend messages to UI-compatible IncognitoMessage format
  // MESSAGE-TICKS-FIX: Include deliveredAt and readAt for visual ticks
  const messages: IncognitoMessage[] = useMemo(() => {
    if (!backendMessages) return [];
    return backendMessages.map((m: BackendMessage) => ({
      id: m.id,
      conversationId: m.conversationId,
      // P0-002b: Map senderId to 'me' for own messages (UI expects 'me' for isOwn check)
      senderId: m.senderId === currentUserId ? 'me' : m.senderId,
      content: m.content,
      type: m.type as any,
      createdAt: m.createdAt,
      isRead: !!m.readAt,
      // MESSAGE-TICKS-FIX: Pass through delivery and read timestamps
      deliveredAt: m.deliveredAt,
      readAt: m.readAt,
    }));
  }, [backendMessages, currentUserId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002b: Backend mutations
  // ═══════════════════════════════════════════════════════════════════════════
  const sendMessageMutation = useMutation(api.privateConversations.sendPrivateMessage);
  const markReadMutation = useMutation(api.privateConversations.markPrivateMessagesRead);
  const markDeliveredMutation = useMutation(api.privateConversations.markPrivateMessagesDelivered);
  const deleteMessageMutation = useMutation(api.privateConversations.deletePrivateMessage);

  // MESSAGE-TICKS-FIX: Mark messages as read AND delivered when screen opens
  // Following Phase-1 pattern: delivery happens when conversation opens
  const hasMarkedRef = useRef(false);
  useEffect(() => {
    if (!id || !token || hasMarkedRef.current) return;
    hasMarkedRef.current = true;

    // Mark as delivered first (Phase-1 pattern)
    markDeliveredMutation({
      token,
      conversationId: id as Id<'privateConversations'>,
    }).catch((err) => {
      if (process.env.NODE_ENV !== 'production') console.warn('[Phase2Chat] Failed to mark messages delivered:', err);
    });

    // Then mark as read
    markReadMutation({
      token,
      conversationId: id as Id<'privateConversations'>,
    }).catch((err) => {
      if (process.env.NODE_ENV !== 'production') console.warn('[Phase2Chat] Failed to mark messages read:', err);
    });
  }, [id, token, markReadMutation, markDeliveredMutation]);

  // Reset mark flag when conversation changes
  useEffect(() => {
    hasMarkedRef.current = false;
  }, [id]);

  // GOAL A: Live countdown state - updates every 250ms for smooth countdown display
  const [now, setNow] = useState(Date.now());

  // MESSAGE-TICKS-FIX: Live tick updates - hash of last 20 messages' delivery/read status
  // Following Phase-1 pattern: triggers FlashList re-render when ticks change
  const messageStatusHash = useMemo(() => {
    return messages
      .slice(-20)
      .map((m) => `${m.id}:${m.deliveredAt || 0}:${m.readAt || 0}`)
      .join('|');
  }, [messages]);

  // GOAL A: Update 'now' every 250ms for live countdown (only when messages have active timers)
  const hasActiveTimers = messages.some(
    (m) => m.isProtected && m.timerEndsAt && !m.isExpired && m.timerEndsAt > Date.now()
  );
  useEffect(() => {
    if (!hasActiveTimers) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [hasActiveTimers]);

  const [text, setText] = useState('');
  const [reportVisible, setReportVisible] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // ─── Scroll to bottom helper (with Android timing fix - matches locked pattern) ───
  const scrollToBottom = useCallback((animated = true) => {
    const run = () => flatListRef.current?.scrollToEnd({ animated });
    if (Platform.OS === 'android') {
      InteractionManager.runAfterInteractions(() => setTimeout(run, 120));
    } else {
      requestAnimationFrame(run);
    }
  }, []);

  // Voice recording - NOTE: Voice messages still use local store for now (media upload TODO)
  const localAddMessage = usePrivateChatStore((s) => s.addMessage);
  const deleteMessage = usePrivateChatStore((s) => s.deleteMessage);

  const handleRecordingComplete = useCallback((result: VoiceRecorderResult) => {
    if (!id) return;
    // Voice messages temporarily stored locally (backend media upload is separate feature)
    const newMsg: IncognitoMessage = {
      id: `im_voice_${Date.now()}`,
      conversationId: id,
      senderId: 'me',
      content: 'Voice message',
      type: 'voice',
      audioUri: result.audioUri,
      durationMs: result.durationMs,
      createdAt: Date.now(),
      isRead: false,
    };
    localAddMessage(id, newMsg);
  }, [id, localAddMessage]);

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
  const formatRecordingTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  // P0-001: Delete message handler (supports both local and backend messages)
  // - Backend messages: call deletePrivateMessage mutation
  // - Local messages (voice, tod): just remove from local store
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!id) return;

    // Local-only messages (voice, tod) have prefixed IDs
    const isLocalOnly = messageId.startsWith('im_voice_') || messageId.startsWith('tod_result_');

    if (isLocalOnly) {
      // Just remove from local store
      deleteMessage(id, messageId);
      return;
    }

    // Backend message: call mutation
    if (!token) {
      console.warn('[Phase2Chat] Cannot delete message: no token');
      return;
    }

    try {
      await deleteMessageMutation({
        token,
        messageId: messageId as Id<'privateMessages'>,
      });
      // Also remove from local store for immediate UI feedback
      deleteMessage(id, messageId);
    } catch (e) {
      console.error('[Phase2Chat] Failed to delete message:', e);
      Alert.alert('Error', 'Failed to delete message. Please try again.');
    }
  }, [id, token, deleteMessage, deleteMessageMutation]);

  // Alias for backward compatibility with voice message component
  const handleDeleteVoiceMessage = handleDeleteMessage;

  // Camera/gallery state for secure photos
  const [showCameraSheet, setShowCameraSheet] = useState(false);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);
  const [pendingMediaType, setPendingMediaType] = useState<'photo' | 'video'>('photo');
  const [pendingIsMirrored, setPendingIsMirrored] = useState(false);

  // Secure photo viewer state
  const [viewingMessageId, setViewingMessageId] = useState<string | null>(null);

  // ─── Truth-or-Dare game (same as Phase-1: BottleSpinGame) ───
  const [showTruthDareGame, setShowTruthDareGame] = useState(false);

  // C10 FIX: Disable profile navigation in incognito mode to prevent identity leak
  // In incognito chat, tapping the header should NOT reveal the other user's profile
  const handleOpenProfile = useCallback(() => {
    // No-op: profile viewing disabled in incognito mode
  }, []);

  // Phase-1 parity: send result message to chat when spin completes
  // NOTE: ToD results use local store for now (system messages)
  const handleSendTodResult = useCallback((message: string) => {
    if (!id) return;
    // Add as system message (senderId: 'tod' renders as capsule)
    localAddMessage(id, {
      id: `tod_result_${Date.now()}`,
      conversationId: id,
      senderId: 'tod',
      content: message,
      createdAt: Date.now(),
      isRead: true,
    });
    if (__DEV__) {
      console.log('[Phase2Chat] ToD result:', message);
    }
  }, [id, localAddMessage]);

  // Check for captured media from camera-composer when screen regains focus
  useFocusEffect(
    useCallback(() => {
      const checkCapturedMedia = () => {
        if (!id) return;
        const key = `secure_capture_media_${id}`;
        // Pop from memory (get and delete atomically, no persistence)
        const data = popHandoff<{ uri: string; type: string; isMirrored?: boolean }>(key);
        if (!data) return;

        try {
          if (data.uri && data.type && (data.type === 'photo' || data.type === 'video')) {
            setPickedImageUri(data.uri);
            setPendingMediaType(data.type);
            setPendingIsMirrored(data.isMirrored === true);
            setShowCameraSheet(true);
          }
        } catch {
          // Ignore parse errors
        }
      };
      checkCapturedMedia();
    }, [id])
  );

  // Auto-scroll only when new messages arrive AND user is near bottom
  useEffect(() => {
    const count = messages.length;
    if (count > prevMessageCountRef.current && isNearBottomRef.current) {
      scrollToBottom(true);
    }
    prevMessageCountRef.current = count;
  }, [messages.length, scrollToBottom]);

  // ─── Keyboard listener: scroll on open (matches locked chat-rooms pattern) ───
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      scrollToBottom(true);
    });
    return () => sub.remove();
  }, [scrollToBottom]);

  // Phase-2 analytics: Track when chat opens
  useEffect(() => {
    if (!conversation || !id) return;
    // Look up participant's privateIntentKey for analytics (checks demoStore + DEMO_INCOGNITO_PROFILES)
    trackEvent({
      name: 'phase2_match_started',
      conversationId: id,
      privateIntentKey: getPrivateIntentKey(conversation.participantId),
    });
  }, [id, conversation?.id]);

  // ═══════════════════════════════════════════════════════════════════════════
  // P0-002b: Send message via backend (replaces local store)
  // ═══════════════════════════════════════════════════════════════════════════
  const handleSend = useCallback(async () => {
    if (!text.trim() || !id || !token || isSending) return;

    const content = text.trim();
    setText(''); // Clear immediately for responsiveness

    setIsSending(true);
    try {
      await sendMessageMutation({
        token,
        conversationId: id as Id<'privateConversations'>,
        type: 'text',
        content,
        clientMessageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      });
      // Message will appear via query reactivity
      scrollToBottom(true);
    } catch (err) {
      // Restore text on error
      setText(content);
      Alert.alert('Error', 'Failed to send message. Please try again.');
      if (__DEV__) console.error('[Phase2Chat] Send failed:', err);
    } finally {
      setIsSending(false);
    }
  }, [text, id, token, isSending, sendMessageMutation, scrollToBottom]);

  const handleReport = (reason: string) => {
    console.log('Report submitted:', reason, 'for user:', conversation?.participantId);
    setReportVisible(false);
  };

  const handleBlock = () => {
    if (!conversation) return;
    blockUser(conversation.participantId);
    router.back();
  };

  // Gallery picker for secure photos/videos (Phase-1 style: from + menu)
  const handleGalleryPick = useCallback(async () => {
    if (!conversation) return;
    setShowAttachMenu(false);

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library access is needed to select media.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
        allowsEditing: false,
        selectionLimit: 1,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      setPickedImageUri(asset.uri);
      setPendingMediaType(isVideo ? 'video' : 'photo');
      setShowCameraSheet(true);
    } catch {
      // STABILITY: ImagePicker can fail on various devices
      Alert.alert('Error', 'Could not open photo picker. Please try again.');
    }
  }, [conversation]);

  // Camera capture: navigate directly to camera screen in PHOTO mode (no Alert prompt)
  const handleCameraCapture = useCallback(() => {
    if (!conversation) return;
    setShowAttachMenu(false);
    // Navigate to camera-composer in secure capture mode (default: photo)
    router.push(`/(main)/camera-composer?mode=secure_capture&conversationId=${id}` as any);
  }, [conversation, id, router]);

  // Voice recording from + menu
  const handleVoiceFromMenu = useCallback(() => {
    setShowAttachMenu(false);
    toggleRecording();
  }, [toggleRecording]);

  // Handle secure photo/video confirmation from CameraPhotoSheet
  // NOTE: Secure media still uses local store (backend media upload is separate feature)
  const handleCameraPhotoConfirm = useCallback((imageUri: string, options: CameraPhotoOptions) => {
    setShowCameraSheet(false);
    setPickedImageUri(null);
    const isVideo = pendingMediaType === 'video';
    const isMirrored = pendingIsMirrored;
    setPendingMediaType('photo'); // Reset for next time
    setPendingIsMirrored(false); // Reset for next time

    if (!id) return;

    // Create secure photo/video message for Phase-2 chat
    // NOTE: Protected media temporarily stored locally (backend media upload is separate feature)
    const newMsg: IncognitoMessage = {
      id: `im_${isVideo ? 'video' : 'photo'}_${Date.now()}`,
      conversationId: id,
      senderId: 'me',
      content: isVideo ? '🎬 Secure Video' : '📷 Secure Photo',
      createdAt: Date.now(),
      isRead: false,
      // Add protected media metadata
      isProtected: true,
      protectedMedia: {
        localUri: imageUri,
        mediaType: isVideo ? 'video' : 'photo',
        timer: options.timer,
        viewingMode: options.viewingMode,
        screenshotAllowed: false,
        viewOnce: options.timer === 0,
        watermark: false,
        isMirrored, // For render-time flip correction
      },
    };

    localAddMessage(id, newMsg);

    if (__DEV__) {
      console.log('[Phase2Chat] Sent secure media:', { type: pendingMediaType, timer: options.timer, viewingMode: options.viewingMode, isMirrored });
    }
  }, [id, localAddMessage, pendingMediaType, pendingIsMirrored]);

  // Loading state while fetching messages
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
    const isTodEvent = item.senderId === 'tod';

    // FIX #1: ToD event messages match Phase-1 SystemMessage style (dice icon, not flame)
    if (isTodEvent) {
      return (
        <View style={styles.todEventRow}>
          <View style={styles.todEventCapsule}>
            <Ionicons name="dice" size={13} color={C.primary} style={styles.todEventIcon} />
            <Text style={styles.todEventText}>{item.content}</Text>
          </View>
        </View>
      );
    }

    if (isSystem) {
      return (
        <View style={styles.systemMsgRow}>
          <Text style={styles.systemMsgText}>{item.content}</Text>
        </View>
      );
    }

    // Voice message
    if (item.type === 'voice' && item.audioUri) {
      return (
        <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
          {!isOwn && (
            <Image
              source={{ uri: conversation.participantPhotoUrl }}
              style={styles.msgAvatar}
              blurRadius={10}
            />
          )}
          <VoiceMessageBubble
            messageId={item.id}
            audioUri={item.audioUri}
            durationMs={item.durationMs || 0}
            isOwn={isOwn}
            timestamp={item.createdAt}
            onDelete={isOwn ? () => handleDeleteVoiceMessage(item.id) : undefined}
            darkTheme
          />
        </View>
      );
    }

    // Protected media message (secure photo)
    if (item.isProtected) {
      const isExpired = item.isExpired;
      const isHoldMode = item.protectedMedia?.viewingMode === 'hold';
      const originalTimer = item.protectedMedia?.timer ?? 0;

      // GOAL A: Live countdown - use shared helper to match viewer exactly
      const timerStarted = !!item.timerEndsAt;
      const countdown = timerStarted
        ? calculateProtectedMediaCountdown(item.timerEndsAt)
        : null;

      // Format: View once OR remaining time (matches viewer M:SS format)
      const remainingSec = countdown ? countdown.remainingSeconds : originalTimer;
      const timerLabel = originalTimer === 0 ? 'View once' : (countdown ? countdown.label : `${originalTimer}s`);
      const timerActive = timerStarted && remainingSec > 0;

      // Handlers for tap vs hold mode
      const handlePress = () => {
        if (!isHoldMode && !isExpired) {
          setViewingMessageId(item.id);
        }
      };

      const handlePressIn = () => {
        if (isHoldMode && !isExpired) {
          setViewingMessageId(item.id);
        }
      };

      const handlePressOut = () => {
        if (isHoldMode) {
          setViewingMessageId(null);
        }
      };

      // GOAL B: Expired bubble is small pill (not large card)
      if (isExpired) {
        return (
          <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
            {!isOwn && (
              <Image
                source={{ uri: conversation.participantPhotoUrl }}
                style={styles.msgAvatar}
                blurRadius={10}
              />
            )}
            <View style={[styles.expiredPill, isOwn && styles.expiredPillOwn]}>
              <Ionicons name="lock-closed" size={12} color={C.textLight} />
              <Text style={styles.expiredPillText}>Expired</Text>
            </View>
          </View>
        );
      }

      return (
        <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
          {!isOwn && (
            <Image
              source={{ uri: conversation.participantPhotoUrl }}
              style={styles.msgAvatar}
              blurRadius={10}
            />
          )}
          <TouchableOpacity
            style={[
              styles.msgBubble,
              styles.securePhotoBubble,
              isOwn ? styles.securePhotoBubbleOwn : styles.securePhotoBubbleOther,
            ]}
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={isHoldMode ? 1 : 0.8}
            delayPressIn={isHoldMode ? 0 : undefined}
          >
            <View style={styles.securePhotoContent}>
              <View style={styles.securePhotoIcon}>
                <Ionicons name="shield-checkmark" size={20} color={SOFT_ACCENT} />
              </View>
              <View style={styles.securePhotoInfo}>
                <Text style={[styles.securePhotoLabel, isOwn && { color: '#FFFFFF' }]}>Secure Photo</Text>
                <Text style={styles.securePhotoMeta}>
                  {isHoldMode ? 'Hold to view' : 'Tap to view'}
                </Text>
              </View>
              {/* GOAL A: Live countdown badge */}
              <View style={[styles.timerBadge, timerActive && styles.timerBadgeActive]}>
                <Ionicons name="timer-outline" size={11} color="#FFFFFF" />
                <Text style={styles.timerBadgeText}>{timerLabel}</Text>
              </View>
            </View>
            {/* MESSAGE-TICKS-FIX: Time + tick row for secure photos */}
            <View style={styles.msgTimeRow}>
              <Text style={[styles.msgTime, isOwn && styles.msgTimeOwn]}>
                {formatTime(item.createdAt)}
              </Text>
              {isOwn && (() => {
                const tickStatus = getTickStatus(item);
                return (
                  <Ionicons
                    name={getTickIcon(tickStatus)}
                    size={14}
                    color={getTickColor(tickStatus)}
                    style={styles.tickIcon}
                  />
                );
              })()}
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    // D2: Mask explicit words in private chat with "****"
    const { masked, wasMasked } = maskExplicitWords(item.content);

    // MESSAGE-TICKS-FIX: Get tick status for own messages
    const tickStatus = isOwn ? getTickStatus(item) : null;

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
          {/* MESSAGE-TICKS-FIX: Time + tick row for own messages */}
          <View style={styles.msgTimeRow}>
            <Text style={[styles.msgTime, isOwn && styles.msgTimeOwn]}>
              {formatTime(item.createdAt)}
            </Text>
            {isOwn && tickStatus && (
              <Ionicons
                name={getTickIcon(tickStatus)}
                size={14}
                color={getTickColor(tickStatus)}
                style={styles.tickIcon}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header — sits above KAV (does not move when keyboard opens) */}
      <View style={[styles.header, { marginTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        {/* Tappable avatar + info to open profile */}
        <TouchableOpacity onPress={handleOpenProfile} style={styles.headerTappable} activeOpacity={0.7}>
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
        </TouchableOpacity>
        {/* Truth-or-Dare button — same as Phase-1: opens BottleSpinGame */}
        <TouchableOpacity
          onPress={() => setShowTruthDareGame(true)}
          hitSlop={8}
          style={styles.gameButton}
        >
          <View style={styles.truthDareButton}>
            <Ionicons name="wine" size={18} color="#FFFFFF" />
            <Text style={styles.truthDareLabel}>T/D</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setReportVisible(true)} style={styles.moreButton}>
          <Ionicons name="ellipsis-vertical" size={20} color={C.textLight} />
        </TouchableOpacity>
      </View>

      {/* ─── KEYBOARD AVOIDING VIEW (matches locked chat-rooms pattern) ─── */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatArea}>
          {/* Messages */}
          {backendMessages === undefined ? (
            // Loading state
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
          ) : (
            <FlashList
              ref={flatListRef}
              data={messages}
              extraData={{ now, messageStatusHash }}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="chatbubble-outline" size={40} color={C.textLight} />
                  <Text style={styles.emptyText}>Say hi 👋</Text>
                </View>
              }
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: messages.length > 0 ? 'flex-end' as const : 'center' as const,
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: composerHeight,
              }}
              onScroll={onScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            />
          )}

          {/* Recording indicator */}
          {isRecording && (
            <View style={styles.recordingBanner}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>
                Recording... {formatRecordingTime(elapsedMs)} / {formatRecordingTime(maxDurationMs)}
              </Text>
            </View>
          )}

          {/* ─── COMPOSER (Phase-1 style: + menu with Camera/Gallery/Voice) ─── */}
          <View
            style={[styles.composerWrapper, { paddingBottom: (Platform.OS === 'ios' ? insets.bottom : 0) + 8 }]}
            onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
          >
            <View style={styles.inputBar}>
              {/* + Button with popup menu - LEFT side of TextInput */}
              {!isRecording ? (
                <TouchableOpacity
                  style={styles.attachButton}
                  onPress={() => setShowAttachMenu(true)}
                >
                  <Ionicons name="add" size={26} color={C.primary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.attachButton, styles.stopButton]}
                  onPress={toggleRecording}
                >
                  <Ionicons name="stop" size={22} color="#FF4444" />
                </TouchableOpacity>
              )}

              <TextInput
                style={[styles.textInput, isRecording && styles.textInputRecording]}
                placeholder={isRecording ? 'Recording voice message...' : 'Type a message...'}
                placeholderTextColor={isRecording ? '#FF4444' : C.textLight}
                value={text}
                onChangeText={setText}
                multiline
                scrollEnabled
                textAlignVertical="top"
                blurOnSubmit={false}
                maxLength={1000}
                editable={!isRecording && !isSending}
                autoComplete="off"
                textContentType="none"
                importantForAutofill="noExcludeDescendants"
              />

              {!isRecording && (
                <TouchableOpacity
                  style={[styles.sendButton, (!text.trim() || isSending) && styles.sendButtonDisabled]}
                  onPress={handleSend}
                  disabled={!text.trim() || isSending}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color={C.textLight} />
                  ) : (
                    <Ionicons name="send" size={20} color={text.trim() ? '#FFFFFF' : C.textLight} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* + Menu Modal */}
          <Modal
            visible={showAttachMenu}
            transparent
            animationType="fade"
            onRequestClose={() => setShowAttachMenu(false)}
          >
            <Pressable style={styles.menuOverlay} onPress={() => setShowAttachMenu(false)}>
              <View style={styles.menuContainer}>
                <TouchableOpacity style={styles.menuItem} onPress={handleCameraCapture}>
                  <View style={[styles.menuIcon, { backgroundColor: C.primary }]}>
                    <Ionicons name="camera" size={20} color="#FFFFFF" />
                  </View>
                  <Text style={styles.menuText}>Camera</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={handleGalleryPick}>
                  <View style={[styles.menuIcon, { backgroundColor: '#9B59B6' }]}>
                    <Ionicons name="images" size={20} color="#FFFFFF" />
                  </View>
                  <Text style={styles.menuText}>Gallery</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.menuItem} onPress={handleVoiceFromMenu}>
                  <View style={[styles.menuIcon, { backgroundColor: '#E67E22' }]}>
                    <Ionicons name="mic" size={20} color="#FFFFFF" />
                  </View>
                  <Text style={styles.menuText}>Voice</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Modal>
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

      {/* Truth-or-Dare Game — same component as Phase-1 */}
      <BottleSpinGame
        visible={showTruthDareGame}
        onClose={() => setShowTruthDareGame(false)}
        currentUserName="You"
        otherUserName={conversation.participantName}
        conversationId={id}
        userId="me"
        onSendResultMessage={handleSendTodResult}
      />

      {/* Camera Photo Sheet (gallery/camera picker -> secure options) */}
      <CameraPhotoSheet
        visible={showCameraSheet}
        imageUri={pickedImageUri}
        mediaType={pendingMediaType}
        onConfirm={handleCameraPhotoConfirm}
        onCancel={() => {
          setShowCameraSheet(false);
          setPickedImageUri(null);
          setPendingMediaType('photo');
        }}
      />

      {/* Secure Photo Viewer */}
      {viewingMessageId && id && (
        <Phase2ProtectedMediaViewer
          visible={!!viewingMessageId}
          conversationId={id}
          messageId={viewingMessageId}
          onClose={() => setViewingMessageId(null)}
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

// GOAL C: Softer accent colors for Phase-2 secure photo elements (not harsh pink)
const SOFT_ACCENT = '#7B68A6'; // Muted plum/purple
const SOFT_ACCENT_BG = '#3D3255'; // Deep plum background
const SOFT_ACCENT_ACTIVE = '#9B7DC4'; // Slightly brighter for active timer

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  keyboardAvoid: { flex: 1 },
  chatArea: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
    color: C.textLight,
  },
  composerWrapper: { backgroundColor: C.background },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  backButton: { marginRight: 8 },
  headerTappable: { flexDirection: 'row' as const, alignItems: 'center' as const, flex: 1 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent },
  headerInfo: { flex: 1, marginLeft: 10 },
  headerName: { fontSize: 16, fontWeight: '600', color: C.text },
  headerIntent: { fontSize: 11, color: C.primary, opacity: 0.85, marginTop: 1 },
  headerMeta: { fontSize: 12, color: C.textLight },
  moreButton: { padding: 8 },
  gameButton: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 4,
  },
  truthDareButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: C.primary,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 4,
  },
  truthDareLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },

  systemMsgRow: { alignItems: 'center', marginBottom: 12 },
  systemMsgText: { fontSize: 12, color: C.textLight, fontStyle: 'italic', textAlign: 'center' },

  // FIX #1: ToD event capsule styles matching Phase-1 SystemMessage
  todEventRow: {
    alignItems: 'center' as const,
    marginVertical: 6,
  },
  todEventCapsule: {
    alignSelf: 'center' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: C.surface, // Phase-2 dark theme equivalent of COLORS.backgroundDark
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 5,
  },
  todEventIcon: {
    marginRight: 2,
  },
  todEventText: {
    fontSize: 12,
    color: C.textLight,
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
  },

  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  msgRowOwn: { flexDirection: 'row-reverse' },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8, backgroundColor: C.accent },
  msgBubble: { maxWidth: '75%', padding: 12, borderRadius: 16 },
  msgBubbleOwn: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: C.surface, borderBottomLeftRadius: 4 },

  // GOAL C: Secure photo bubble with softer colors (not C.primary pink)
  securePhotoBubble: { minWidth: 180, padding: 10 },
  securePhotoBubbleOwn: { backgroundColor: SOFT_ACCENT_BG, borderBottomRightRadius: 4 },
  securePhotoBubbleOther: { backgroundColor: C.surface, borderBottomLeftRadius: 4 },
  securePhotoContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  securePhotoIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: SOFT_ACCENT + '30', alignItems: 'center', justifyContent: 'center',
  },
  securePhotoInfo: { flex: 1 },
  securePhotoLabel: { fontSize: 13, fontWeight: '600', color: C.text },
  securePhotoMeta: { fontSize: 10, color: C.textLight, marginTop: 1 },

  // GOAL A: Timer badge styles
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: SOFT_ACCENT_BG,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  timerBadgeActive: {
    backgroundColor: SOFT_ACCENT_ACTIVE,
  },
  timerBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // GOAL B: Small expired pill (not large card)
  expiredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: C.surface,
    opacity: 0.7,
  },
  expiredPillOwn: {
    backgroundColor: SOFT_ACCENT_BG,
  },
  expiredPillText: {
    fontSize: 12,
    color: C.textLight,
    fontWeight: '500',
  },
  msgText: { fontSize: 14, color: C.text, lineHeight: 20 },
  msgTextOwn: { color: '#FFFFFF' },
  // MESSAGE-TICKS-FIX: Time + tick row container
  msgTimeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'flex-end' as const,
    marginTop: 4,
    gap: 4,
  },
  msgTime: { fontSize: 10, color: C.textLight, textAlign: 'right' as const },
  msgTimeOwn: { color: 'rgba(255,255,255,0.7)' },
  // MESSAGE-TICKS-FIX: Tick icon style
  tickIcon: {
    marginLeft: 2,
  },
  maskedNotice: { fontSize: 10, color: C.textLight, fontStyle: 'italic', marginTop: 2 },

  // Recording indicator
  recordingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF444420',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF4444',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 13,
    color: '#FF4444',
    fontWeight: '600',
  },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: C.surface, gap: 8,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stopButton: {
    backgroundColor: '#FF444420',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end' as const,
  },
  menuContainer: {
    position: 'absolute' as const,
    left: 16,
    bottom: 80,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 140,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 12,
  },
  menuText: {
    fontSize: 15,
    color: C.text,
    fontWeight: '500' as const,
  },
  textInput: {
    flex: 1, backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14, color: C.text, maxHeight: 100,
  },
  textInputRecording: {
    borderWidth: 1,
    borderColor: '#FF444440',
  },
  cameraButton: {
    padding: 8, marginRight: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: C.surface },
});
