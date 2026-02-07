/**
 * Shared chat UI used by both:
 *   - app/(main)/chat/[id].tsx            (standalone stack screen)
 *   - app/(main)/(tabs)/messages/chat/[conversationId].tsx  (inside Messages tab)
 *
 * Accepts conversationId as a prop so the route file handles param extraction.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { MessageBubble, MessageInput, ProtectedMediaOptionsSheet, ProtectedMediaViewer, ReportModal, BottleSpinGame } from '@/components/chat';
import { ProtectedMediaOptions } from '@/components/chat/ProtectedMediaOptionsSheet';
import { ReportBlockModal } from '@/components/security/ReportBlockModal';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { isDemoMode } from '@/hooks/useConvex';
import { useDemoDmStore, DemoDmMessage } from '@/stores/demoDmStore';
import { useDemoStore } from '@/stores/demoStore';
import { useDemoNotifStore } from '@/hooks/useNotifications';
import { Toast } from '@/components/ui/Toast';
import { logDebugEvent } from '@/lib/debugEventLogger';
import {
  isUserBlocked,
  isExpiredConfessionThread,
  getOtherUserIdFromMeta,
} from '@/lib/threadsIntegrity';

/** Resolve the current demo user ID at call-time from authStore.
 *  Falls back to 'demo_user_1' for legacy data compatibility. */
function getDemoUserId(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useAuthStore } = require('@/stores/authStore');
  return useAuthStore.getState().userId || 'demo_user_1';
}

/** Seed data is no longer hardcoded — conversations are created dynamically
 * by simulateMatch() and match-celebration's "Say Hi" flow, both of which
 * seed demoDmStore with a deterministic `demo_convo_${profileId}` key.
 * This empty record is kept as a fallback for seedConversation(). */
const DEMO_SEED_MESSAGES: Record<string, DemoDmMessage[]> = {};

export type ChatSource = 'messages' | 'discover' | 'confession' | 'notification' | 'match' | undefined;

export interface ChatScreenInnerProps {
  conversationId: string;
  /** Source of navigation — determines back button behavior */
  source?: ChatSource;
}

export default function ChatScreenInner({ conversationId, source }: ChatScreenInnerProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Back handler — routes based on source to ensure consistent navigation
  const handleBack = useCallback(() => {
    if (source === 'messages') {
      // From Messages tab: return to Messages list
      router.replace('/(main)/(tabs)/messages');
    } else {
      // Default: use router.back() for natural navigation
      router.back();
    }
  }, [source, router]);
  const { userId } = useAuthStore();
  const flatListRef = useRef<FlashListRef<any>>(null);

  // Measured header height — used as keyboardVerticalOffset so KAV
  // adjusts correctly regardless of device notch / status-bar height.
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setHeaderHeight(e.nativeEvent.layout.height);
  }, []);

  // Track whether the user is scrolled near the bottom so we only
  // auto-scroll on new messages when they are already reading the latest.
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  // Detect demo mode by global flag OR by convention: demo conversation IDs
  // start with "match_" (hardcoded seeds) or "demo_" (dynamically created).
  // This lets the same ChatScreenInner work for both demo and live Convex data.
  const isDemo = isDemoMode || (conversationId?.startsWith('match_') ?? false) || (conversationId?.startsWith('demo_') ?? false);

  // ── Demo DM store — messages survive navigation & restarts ──
  const seedConversation = useDemoDmStore((s) => s.seedConversation);
  const addDemoMessage = useDemoDmStore((s) => s.addMessage);
  const demoConversations = useDemoDmStore((s) => s.conversations);
  const demoMeta = useDemoDmStore((s) => s.meta);
  const demoDraft = useDemoDmStore((s) => conversationId ? s.drafts[conversationId] : undefined);
  const setDemoDraft = useDemoDmStore((s) => s.setDraft);
  const clearDemoDraft = useDemoDmStore((s) => s.clearDraft);
  const cleanupExpiredThreads = useDemoDmStore((s) => s.cleanupExpiredThreads);

  // ── Safety / integrity guards ──
  const blockedUserIds = useDemoStore((s) => s.blockedUserIds);
  const currentMeta = conversationId ? demoMeta[conversationId] : undefined;
  const otherUserIdFromMeta = getOtherUserIdFromMeta(currentMeta);

  // 5-3: Live re-check of blocked user status (not one-time)
  // Re-runs whenever blockedUserIds changes, even if chat is already open
  useEffect(() => {
    if (!isDemo) return;

    // Guard 1: Blocked user — re-check live when blockedUserIds changes
    if (otherUserIdFromMeta && isUserBlocked(otherUserIdFromMeta, blockedUserIds)) {
      logDebugEvent('BLOCK_OR_REPORT', 'Blocked user chat navigation prevented');
      Alert.alert(
        'User Blocked',
        'You cannot view this conversation because you blocked this user.',
        [{ text: 'OK', onPress: handleBack }]
      );
      return;
    }
  }, [isDemo, otherUserIdFromMeta, blockedUserIds, handleBack]);

  // 5-4: Expired thread guard with explanation alert (separate effect)
  useEffect(() => {
    if (!isDemo || !conversationId) return;

    // Guard 2: Expired confession thread — show alert before navigating back
    if (isExpiredConfessionThread(currentMeta)) {
      logDebugEvent('CHAT_EXPIRED', 'Expired confession thread cleaned on navigation');
      // Clean up the expired thread
      cleanupExpiredThreads([conversationId]);
      // 5-4: Show alert explaining why access is removed
      Alert.alert(
        'Chat Expired',
        'This confession chat has expired after 24 hours. The conversation is no longer accessible.',
        [{ text: 'OK', onPress: handleBack }]
      );
    }
  }, [isDemo, conversationId, currentMeta, handleBack, cleanupExpiredThreads]);

  const hasMeta = !!demoMeta[conversationId ?? ''];
  const hasMessages = !!(demoConversations[conversationId ?? '']?.length);
  useEffect(() => {
    if (__DEV__ && isDemo) {
      console.log(`[Chat] lookup convoId=${conversationId} hasMeta=${hasMeta} hasMessages=${hasMessages}`);
    }
  }, [conversationId, hasMeta, hasMessages]);

  // Seed once per conversation (no-op if already seeded)
  useEffect(() => {
    if (isDemo && conversationId) {
      seedConversation(conversationId, DEMO_SEED_MESSAGES[conversationId] || []);
    }
  }, [isDemo, conversationId, seedConversation]);

  const demoMessageList = conversationId ? demoConversations[conversationId] ?? [] : [];

  const conversation = useQuery(
    api.messages.getConversation,
    !isDemo && conversationId && userId ? { conversationId: conversationId as any, userId: userId as any } : 'skip'
  );

  const convexMessages = useQuery(
    api.messages.getMessages,
    !isDemo && conversationId ? { conversationId: conversationId as any, userId: userId as any } : 'skip'
  );

  const currentUser = useQuery(
    api.users.getCurrentUser,
    !isDemo && userId ? { userId: userId as any } : 'skip'
  );

  const messages = isDemo ? demoMessageList : convexMessages;

  // Demo conversation metadata comes from demoDmStore.meta, seeded by
  // simulateMatch() or match-celebration's "Say Hi" flow.
  // Falls back to null → triggers the "not found" empty state.
  const storedMeta = conversationId ? demoMeta[conversationId] : undefined;
  const demoConversation = storedMeta
    ? {
        otherUser: {
          ...storedMeta.otherUser,
          lastActive: storedMeta.otherUser.lastActive ?? Date.now(),
        },
        isPreMatch: storedMeta.isPreMatch,
        isConfessionChat: storedMeta.isConfessionChat,
        expiresAt: storedMeta.expiresAt,
      }
    : null;

  const activeConversation = isDemo ? demoConversation : conversation;

  // Check if this is an expired confession-based chat
  const now = Date.now();
  const isExpiredChat = activeConversation
    ? (isDemo
        ? !!(activeConversation.isConfessionChat && activeConversation.expiresAt && activeConversation.expiresAt <= now)
        : ((activeConversation as any).isExpired === true)
      )
    : false;

  const _queryStatus = conversation === undefined ? 'loading' : conversation ? 'ok' : 'null';
  useEffect(() => {
    if (__DEV__) {
      console.log('[Chat] route conversationId', conversationId, 'query result', _queryStatus);
    }
  }, [conversationId, _queryStatus]);

  // Log when chat is detected as expired
  const hasLoggedExpired = useRef(false);
  useEffect(() => {
    if (isExpiredChat && !hasLoggedExpired.current) {
      hasLoggedExpired.current = true;
      logDebugEvent('CHAT_EXPIRED', 'Confession chat expired');
    }
  }, [isExpiredChat]);

  const sendMessage = useMutation(api.messages.sendMessage);
  const markAsRead = useMutation(api.messages.markAsRead);
  const sendPreMatchMessage = useMutation(api.messages.sendPreMatchMessage);
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const sendProtectedImage = useMutation(api.protectedMedia.sendProtectedImage);

  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);

  // Protected media state
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [showReportBlock, setShowReportBlock] = useState(false);

  // Truth/Dare game state
  const [showTruthDareGame, setShowTruthDareGame] = useState(false);

  // Handler to send Truth/Dare result message to chat
  // Uses system message style: demo mode uses type:'system', Convex uses [SYSTEM:truthdare] marker
  const handleSendTruthDareResult = useCallback(async (message: string) => {
    if (!conversationId) return;

    try {
      if (isDemo) {
        // Demo mode: native system message type with subtype
        addDemoMessage(conversationId, {
          _id: `td_${Date.now()}`,
          content: message,
          senderId: getDemoUserId(),
          type: 'system',
          systemSubtype: 'truthdare',
          createdAt: Date.now(),
        } as any); // Cast needed since DemoDmMessage doesn't have systemSubtype
      } else if (userId) {
        // Convex mode: prefix with hidden marker (stripped by MessageBubble)
        const markedMessage = `[SYSTEM:truthdare]${message}`;
        await sendMessage({
          conversationId: conversationId as any,
          senderId: userId as any,
          content: markedMessage,
          type: 'text',
        });
      }
    } catch {
      // Silent fail - game continues even if message fails
    }
  }, [conversationId, isDemo, userId, addDemoMessage, sendMessage]);

  const markDemoRead = useDemoDmStore((s) => s.markConversationRead);
  const markNotifReadForConvo = useDemoNotifStore((s) => s.markReadForConversation);
  useEffect(() => {
    if (isDemo && conversationId) {
      markDemoRead(conversationId, getDemoUserId());
      markNotifReadForConvo(conversationId);
    } else if (!isDemo && conversationId && userId) {
      markAsRead({ conversationId: conversationId as any, userId: userId as any });
    }
  }, [conversationId, userId, isDemo, markDemoRead, markNotifReadForConvo]);

  // B6 fix: Auto-scroll when new messages arrive AND (user is near bottom OR message is from current user)
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (count > prevMessageCountRef.current) {
      // Check if latest message is from current user
      const latestMsg = messages?.[messages.length - 1];
      const currentUserId = isDemo ? getDemoUserId() : userId;
      const isSentByCurrentUser = latestMsg?.senderId === currentUserId;

      // Scroll if near bottom OR if current user sent the message
      if (isNearBottomRef.current || isSentByCurrentUser) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      }
    }
    prevMessageCountRef.current = count;
  }, [messages?.length, messages, isDemo, userId]);

  // Scroll to end when keyboard opens (WhatsApp behavior).
  // Always scroll — opening the keyboard means the user is engaged at the bottom.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
    });
    return () => sub.remove();
  }, []);

  // B5 fix: persist drafts in both demo and Convex modes
  const handleDraftChange = useCallback((text: string) => {
    if (conversationId) {
      if (text) {
        setDemoDraft(conversationId, text);
      } else {
        clearDemoDraft(conversationId);
      }
    }
  }, [conversationId, setDemoDraft, clearDemoDraft]);

  const handleSend = async (text: string, type: 'text' | 'template' = 'text') => {
    if (!activeConversation) return;
    if (isSendingRef.current) return;

    // Block sending if chat is expired
    if (isExpiredChat) {
      Alert.alert('Chat Expired', 'This confession chat has expired and can no longer receive messages.');
      return;
    }

    if (isDemo) {
      // C9 fix: use unique ID to prevent collision on rapid sends
      const uniqueId = `dm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      addDemoMessage(conversationId!, {
        _id: uniqueId,
        content: text,
        type: 'text',
        senderId: getDemoUserId(),
        createdAt: Date.now(),
      });
      // Clear the draft after sending
      if (conversationId) clearDemoDraft(conversationId);
      return;
    }

    if (!userId) return;
    isSendingRef.current = true;
    setIsSending(true);
    try {
      if (activeConversation.isPreMatch) {
        await sendPreMatchMessage({
          fromUserId: userId as any,
          toUserId: (activeConversation as any).otherUser.id as any,
          content: text,
          templateId: type === 'template' ? 'custom' : undefined,
        });
      } else {
        await sendMessage({
          conversationId: conversationId as any,
          senderId: userId as any,
          type: 'text',
          content: text,
        });
      }
      // B5 fix: clear draft after successful send in Convex mode
      if (conversationId) clearDemoDraft(conversationId);
    } catch (error: any) {
      Toast.show(error.message || 'Failed to send — tap send to retry');
      throw error; // Re-throw so MessageInput can restore text for retry
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  };

  const handleSendImage = async () => {
    if (!userId || !activeConversation) return;

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please allow access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images' as const],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPendingImageUri(result.assets[0].uri);
    }
  };

  const handleProtectedMediaConfirm = async (options: ProtectedMediaOptions) => {
    if (!pendingImageUri || !userId || !conversationId) return;

    const imageUri = pendingImageUri;
    setPendingImageUri(null);
    setIsSending(true);

    try {
      // 1. Get upload URL
      const uploadUrl = await generateUploadUrl();

      // 2. Upload the image
      const response = await fetch(imageUri);
      const blob = await response.blob();

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'image/jpeg' },
        body: blob,
      });

      const { storageId } = await uploadResponse.json();

      // 3. Send protected image message
      await sendProtectedImage({
        conversationId: conversationId as any,
        senderId: userId as any,
        imageStorageId: storageId,
        timer: options.timer,
        screenshotAllowed: options.screenshotAllowed,
        viewOnce: options.viewOnce,
        watermark: options.watermark,
      });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send protected photo');
    } finally {
      setIsSending(false);
    }
  };

  const handleProtectedMediaPress = (messageId: string) => {
    setViewerMessageId(messageId);
  };

  const handleSendDare = () => {
    router.push(`/(main)/dare/send?userId=${activeConversation?.otherUser.id}`);
  };

  // CRITICAL DISTINCTION:
  //   conversation === undefined  → Convex query still loading (show spinner)
  //   conversation === null       → Convex returned no result (show "not found")
  //   isDemo && demoConversation === null → no matching demo seed (show "not found")
  // We NEVER auto-navigate away — the user can tap "Go Back" themselves.
  // Auto-redirecting would cause flicker if the query is just slow.
  if (!activeConversation) {
    const isLoading = !isDemo && conversation === undefined;
    return (
      <View style={styles.loadingContainer}>
        {isLoading ? (
          <>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Opening chat…</Text>
          </>
        ) : (
          <>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.loadingText}>Chat not found</Text>
            <TouchableOpacity
              style={styles.errorBackButton}
              onPress={handleBack}
            >
              <Text style={styles.errorBackText}>Go Back</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  const canSendCustom = isDemo
    ? true
    : currentUser
      ? currentUser.gender === 'female' ||
        currentUser.subscriptionTier === 'premium' ||
        (!activeConversation.isPreMatch && currentUser.subscriptionTier !== 'free')
      : false;

  const messagesRemaining = isDemo ? 999999 : (currentUser?.messagesRemaining || 0);

  return (
    <View style={styles.container}>
      {/* Header — sits above KAV, measured for keyboardVerticalOffset */}
      <View onLayout={onHeaderLayout} style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{activeConversation.otherUser.name}</Text>
          <Text style={styles.headerStatus}>
            {activeConversation.otherUser.lastActive > Date.now() - 5 * 60 * 1000
              ? 'Active now'
              : 'Recently active'}
          </Text>
        </View>
        {activeConversation.otherUser.isVerified && (
          <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
        )}
        {/* Truth/Dare game button - only for matched users (non-pre-match) */}
        {!activeConversation.isPreMatch && (
          <TouchableOpacity
            onPress={() => setShowTruthDareGame(true)}
            hitSlop={8}
            style={styles.gameButton}
          >
            <View style={styles.truthDareButton}>
              <Ionicons name="wine" size={18} color={COLORS.white} />
              <Text style={styles.truthDareLabel}>T/D</Text>
            </View>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => setShowReportBlock(true)}
          hitSlop={8}
          style={styles.moreButton}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={COLORS.textLight} />
        </TouchableOpacity>
      </View>

      {/* Expired chat banner */}
      {isExpiredChat && (
        <View style={styles.expiredBanner}>
          <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.expiredBannerText}>This chat has expired.</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.kavContainer}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        <FlashList
          ref={flatListRef}
          data={messages || []}
          keyExtractor={(item) => item._id}
          renderItem={({ item }: { item: any }) => (
            <MessageBubble
              message={{
                id: item._id,
                content: item.content,
                type: item.type as any,
                senderId: item.senderId,
                createdAt: item.createdAt,
                readAt: item.readAt,
                isProtected: item.isProtected ?? false,
                protectedMedia: item.protectedMedia,
                isExpired: item.isExpired,
                viewedAt: item.viewedAt,
                systemSubtype: item.systemSubtype,
                mediaId: item.mediaId,
              }}
              isOwn={item.senderId === (isDemo ? getDemoUserId() : userId)}
              otherUserName={activeConversation.otherUser.name}
              currentUserId={(isDemo ? getDemoUserId() : userId) || undefined}
              onProtectedMediaPress={handleProtectedMediaPress}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons name="chatbubble-outline" size={40} color={COLORS.border} />
              <Text style={styles.emptyChatText}>
                Say hello to {activeConversation.otherUser.name}!
              </Text>
            </View>
          }
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: (messages?.length ?? 0) > 0 ? 'flex-end' as const : 'center' as const,
            paddingTop: 8,
            paddingBottom: 0,
          }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          // 5-5: Use "on-drag" to avoid conflict with auto-scroll on new messages
          keyboardDismissMode="on-drag"
        />
        <View style={{ paddingBottom: insets.bottom }}>
          <MessageInput
            onSend={handleSend}
            onSendImage={handleSendImage}
            onSendDare={activeConversation.isPreMatch ? handleSendDare : undefined}
            disabled={isSending || isExpiredChat}
            isPreMatch={activeConversation.isPreMatch}
            messagesRemaining={messagesRemaining}
            subscriptionTier={isDemo ? 'premium' : (currentUser?.subscriptionTier || 'free')}
            canSendCustom={canSendCustom}
            recipientName={activeConversation.otherUser.name}
            initialText={demoDraft ?? ''}
            onTextChange={handleDraftChange}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Protected Media Options Sheet */}
      <ProtectedMediaOptionsSheet
        visible={!!pendingImageUri}
        imageUri={pendingImageUri || ''}
        onConfirm={handleProtectedMediaConfirm}
        onCancel={() => setPendingImageUri(null)}
      />

      {/* Protected Media Viewer */}
      {viewerMessageId && userId && (
        <ProtectedMediaViewer
          visible={!!viewerMessageId}
          messageId={viewerMessageId}
          userId={userId}
          viewerName={currentUser?.name || activeConversation.otherUser.name}
          onClose={() => setViewerMessageId(null)}
          onReport={() => {
            setViewerMessageId(null);
            setReportModalVisible(true);
          }}
        />
      )}

      {/* Report Modal (for protected media) */}
      {userId && (
        <ReportModal
          visible={reportModalVisible}
          reporterId={userId}
          reportedUserId={(activeConversation as any).otherUser?.id || ''}
          chatId={conversationId || ''}
          onClose={() => setReportModalVisible(false)}
        />
      )}

      {/* Block / Report Modal (from header 3-dot menu) */}
      <ReportBlockModal
        visible={showReportBlock}
        onClose={() => setShowReportBlock(false)}
        reportedUserId={(activeConversation as any).otherUser?.id || ''}
        reportedUserName={activeConversation.otherUser.name}
        currentUserId={userId || getDemoUserId()}
        onBlockSuccess={() => router.back()}
      />

      {/* Truth/Dare Bottle Spin Game */}
      <BottleSpinGame
        visible={showTruthDareGame}
        onClose={() => setShowTruthDareGame(false)}
        currentUserName={isDemo ? 'You' : (currentUser?.name || 'You')}
        otherUserName={activeConversation.otherUser.name}
        conversationId={conversationId || ''}
        userId={userId || getDemoUserId()}
        onSendResultMessage={handleSendTruthDareResult}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  kavContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
  },
  errorBackButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
  },
  errorBackText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    marginRight: 12,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerStatus: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
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
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 4,
  },
  truthDareLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: COLORS.white,
  },
  moreButton: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  emptyChat: {
    alignItems: 'center',
    padding: 24,
  },
  emptyChatText: {
    fontSize: 15,
    color: COLORS.textMuted,
    marginTop: 12,
    textAlign: 'center',
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(153,153,153,0.12)',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  expiredBannerText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
});
