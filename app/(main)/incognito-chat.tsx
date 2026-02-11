import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import { maskExplicitWords, MASKED_CONTENT_NOTICE } from '@/lib/contentFilter';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { BottleSpinGame } from '@/components/chat/BottleSpinGame';
import { CameraPhotoSheet, type CameraPhotoOptions } from '@/components/chat/CameraPhotoSheet';
import { ReportModal } from '@/components/private/ReportModal';
import { Phase2ProtectedMediaViewer } from '@/components/private/Phase2ProtectedMediaViewer';
import { DEMO_INCOGNITO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { trackEvent } from '@/lib/analytics';
import { useVoiceRecorder, type VoiceRecorderResult } from '@/hooks/useVoiceRecorder';
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble';
import type { IncognitoMessage } from '@/types';

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
  const deleteMessage = usePrivateChatStore((s) => s.deleteMessage);
  const blockUser = usePrivateChatStore((s) => s.blockUser);
  const pruneDeletedMessages = usePrivateChatStore((s) => s.pruneDeletedMessages);

  const conversation = conversations.find((c) => c.id === id);
  const messages = id ? storeMessages[id] || [] : [];

  // GOAL A: Live countdown state - updates every 250ms for smooth countdown display
  const [now, setNow] = useState(Date.now());

  // GOAL D: Auto-cleanup - prune deleted messages on mount and every 5 seconds
  useEffect(() => {
    pruneDeletedMessages(); // Prune on mount
    const interval = setInterval(() => {
      pruneDeletedMessages();
    }, 5000);
    return () => clearInterval(interval);
  }, [pruneDeletedMessages]);

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
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Voice recording
  const handleRecordingComplete = useCallback((result: VoiceRecorderResult) => {
    if (!id) return;
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
    addMessage(id, newMsg);
  }, [id, addMessage]);

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

  // Delete voice message handler
  const handleDeleteVoiceMessage = useCallback((messageId: string) => {
    if (!id) return;
    deleteMessage(id, messageId);
  }, [id, deleteMessage]);

  // Camera/gallery state for secure photos
  const [showCameraSheet, setShowCameraSheet] = useState(false);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);

  // Secure photo viewer state
  const [viewingMessageId, setViewingMessageId] = useState<string | null>(null);

  // ─── Truth-or-Dare game (same as Phase-1: BottleSpinGame) ───
  const [showTruthDareGame, setShowTruthDareGame] = useState(false);

  // Handler for tapping header avatar/name to open profile
  const handleOpenProfile = useCallback(() => {
    if (!conversation) return;
    router.push(`/(main)/profile/${conversation.participantId}?mode=phase2` as any);
  }, [conversation, router]);

  // Phase-1 parity: send result message to chat when spin completes
  const handleSendTodResult = useCallback((message: string) => {
    if (!id) return;
    // Add as system message (senderId: 'tod' renders as capsule)
    addMessage(id, {
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
  }, [id, addMessage]);

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
    // Look up participant's privateIntentKey for analytics (checks demoStore + DEMO_INCOGNITO_PROFILES)
    trackEvent({
      name: 'phase2_match_started',
      conversationId: id,
      privateIntentKey: getPrivateIntentKey(conversation.participantId),
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

  // Gallery picker for secure photos
  const handleSendImage = useCallback(async () => {
    if (!conversation) return;

    // Open gallery picker directly (no camera)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
      allowsEditing: false,
      selectionLimit: 1,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    // Store picked image and show secure options sheet
    setPickedImageUri(result.assets[0].uri);
    setShowCameraSheet(true);
  }, [conversation]);

  // Handle secure photo confirmation from CameraPhotoSheet
  const handleCameraPhotoConfirm = useCallback((imageUri: string, options: CameraPhotoOptions) => {
    setShowCameraSheet(false);
    setPickedImageUri(null);

    if (!id) return;

    // Create secure photo message for Phase-2 chat
    const newMsg: IncognitoMessage = {
      id: `im_photo_${Date.now()}`,
      conversationId: id,
      senderId: 'me',
      content: '📷 Secure Photo',
      createdAt: Date.now(),
      isRead: false,
      // Add protected media metadata
      isProtected: true,
      protectedMedia: {
        localUri: imageUri,
        timer: options.timer,
        viewingMode: options.viewingMode,
        screenshotAllowed: false,
        viewOnce: options.timer === 0,
        watermark: false,
      },
    };

    addMessage(id, newMsg);

    if (__DEV__) {
      console.log('[Phase2Chat] Sent secure photo:', { timer: options.timer, viewingMode: options.viewingMode });
    }
  }, [id, addMessage]);

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

      // GOAL A: Live countdown - show remaining time if timer started, else static
      const timerStarted = !!item.timerEndsAt;
      const remainingSec = timerStarted
        ? Math.max(0, Math.ceil((item.timerEndsAt! - now) / 1000))
        : originalTimer;
      const timerLabel = originalTimer === 0 ? 'View once' : `${remainingSec}s`;
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
            <Text style={[styles.msgTime, isOwn && styles.msgTimeOwn]}>
              {formatTime(item.createdAt)}
            </Text>
          </TouchableOpacity>
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

        {/* ToD inline banner removed — ToD accessed via header icon only */}

        {/* Recording indicator */}
        {isRecording && (
          <View style={styles.recordingBanner}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              Recording... {formatRecordingTime(elapsedMs)} / {formatRecordingTime(maxDurationMs)}
            </Text>
          </View>
        )}

        {/* Input — sits at the bottom of KAV, pushed up by keyboard */}
        <View style={[styles.inputBar, { paddingBottom: keyboardVisible ? 0 : Math.max(insets.bottom, 8) }]}>
          {/* Mic button - LEFT side of TextInput */}
          <TouchableOpacity
            style={[styles.micButton, isRecording && styles.micButtonRecording]}
            onPress={toggleRecording}
          >
            <Ionicons
              name={isRecording ? 'stop' : 'mic'}
              size={22}
              color={isRecording ? '#FF4444' : C.primary}
            />
          </TouchableOpacity>

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
            editable={!isRecording}
          />
          {/* Camera button for secure photos */}
          {!isRecording && (
            <TouchableOpacity style={styles.cameraButton} onPress={handleSendImage}>
              <Ionicons name="camera" size={22} color={C.primary} />
            </TouchableOpacity>
          )}
          {!isRecording && (
            <TouchableOpacity
              style={[styles.sendButton, !text.trim() && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!text.trim()}
            >
              <Ionicons name="send" size={20} color={text.trim() ? '#FFFFFF' : C.textLight} />
            </TouchableOpacity>
          )}
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

      {/* Camera Photo Sheet (gallery picker -> secure options) */}
      <CameraPhotoSheet
        visible={showCameraSheet}
        imageUri={pickedImageUri}
        onConfirm={handleCameraPhotoConfirm}
        onCancel={() => {
          setShowCameraSheet(false);
          setPickedImageUri(null);
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
  msgTime: { fontSize: 10, color: C.textLight, marginTop: 4, textAlign: 'right' },
  msgTimeOwn: { color: 'rgba(255,255,255,0.7)' },
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
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: C.surface, gap: 8,
  },
  micButton: {
    padding: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minWidth: 40,
    minHeight: 40,
  },
  micButtonRecording: {
    backgroundColor: '#FF444420',
    borderRadius: 20,
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
