/**
 * Private Chat View (DM)
 *
 * Real-time 1:1 messaging component for Chat Room DMs.
 * DM-ID-FIX: Now uses Convex backend for persistent, synced messages.
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  InteractionManager,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConvex, useQuery, useMutation } from 'convex/react';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { GENDER_COLORS } from '@/lib/responsive';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { useChatThemeColors } from '@/stores/chatThemeStore';
import MediaMessage from '@/components/chat/MediaMessage';
import ChatComposer from './ChatComposer';
import AttachmentPopup from './AttachmentPopup';
import DoodleCanvas from './DoodleCanvas';
import VideoPlayerModal from './VideoPlayerModal';
import ImagePreviewModal from './ImagePreviewModal';
import DmAudioBubble from './DmAudioBubble';
// DM-UX-FIX: SecureMediaViewer removed - DM uses tap-to-view
import { shouldShowTimestamp } from '@/utils/chatTime';
import { uploadMediaToConvex } from '@/lib/uploadUtils';
import { useVoiceRecorder, VoiceRecorderResult } from '@/hooks/useVoiceRecorder';
import { preloadVideos } from '@/lib/videoCache';
import { Image as ExpoImage } from 'expo-image';
import type { Id } from '@/convex/_generated/dataModel';

const C = INCOGNITO_COLORS;

// DM info for display (peer details)
interface DmInfo {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  peerGender?: 'male' | 'female' | 'other';
}

interface PrivateChatViewProps {
  dm: DmInfo;
  /** Convex thread ID for backend sync */
  threadId?: Id<'conversations'>;
  onBack: () => void;
  topInset?: number;
  /** When true, rendered inside a modal/sheet - simple flex layout (no internal keyboard handling) */
  isModal?: boolean;
  /** Called after message is sent successfully - used by ChatSheet to dismiss keyboard */
  onSendComplete?: () => void;
  /** When true, hides back button (ChatSheet has its own close X) */
  hideBackButton?: boolean;
  /** When true, rendered inside ChatSheet - adjusts header styling */
  isInSheet?: boolean;
  /** Called to close the sheet (X button in header) - passed from ChatSheet */
  onSheetClose?: () => void;
  /** Whether keyboard is open and sheet is in full-screen mode */
  isKeyboardOpen?: boolean;
  /** Safe area top inset - for header padding when sheet is full-screen */
  safeAreaTop?: number;
}

// Message type from Convex query
interface DmMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text?: string;
  type: string;
  mediaUrl?: string;
  readAt?: number;
  createdAt: number;
  isMe: boolean;
}

const DM_PAGE_SIZE = 50;

function mergeDmMessagesById(messages: DmMessage[]): DmMessage[] {
  const byId = new Map<string, DmMessage>();
  for (const message of messages) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.id.localeCompare(b.id);
  });
}

export default function PrivateChatView({
  dm,
  threadId,
  onBack,
  topInset = 0,
  isModal = false,
  onSendComplete,
  hideBackButton = false,
  isInSheet = false,
  onSheetClose,
  isKeyboardOpen = false,
  safeAreaTop = 0,
}: PrivateChatViewProps) {
  const flatListRef = useRef<FlatList>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const insets = useSafeAreaInsets();

  const [inputText, setInputText] = useState('');
  const [attachmentVisible, setAttachmentVisible] = useState(false);
  const [doodleVisible, setDoodleVisible] = useState(false);
  const [videoPlayerUri, setVideoPlayerUri] = useState('');
  const [imagePreviewUri, setImagePreviewUri] = useState('');
  const [olderMessages, setOlderMessages] = useState<DmMessage[]>([]);
  const [olderMessagesCursor, setOlderMessagesCursor] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);

  // Auth
  const authUserId = useAuthStore((s) => s.userId);
  const convex = useConvex();

  // THEME: Get current chat theme colors
  const themeColors = useChatThemeColors();

  // ==========================================================================
  // UNIFIED BOTTOM-ANCHOR SCROLL STRATEGY
  // ==========================================================================
  // Rule: Always show the latest message UNLESS user manually scrolled away.
  //
  // Events that trigger scroll-to-latest (if not scrolled away):
  // - Thread open/reopen
  // - Message sent (always scrolls, resets scrolled-away state)
  // - Keyboard opens
  // - Keyboard closes
  // - Content size changes (new messages arrive)
  // - Layout size changes (sheet resize)
  //
  // User scrolled away detection:
  // - onScrollBeginDrag: user started manual scroll
  // - If scroll position is NOT near bottom after drag, mark as scrolled away
  // - Reset when: user scrolls back to bottom, sends message, or thread reopens
  // ==========================================================================

  // Track content and layout dimensions for accurate scrolling
  const contentHeightRef = useRef(0);
  const layoutHeightRef = useRef(0);

  // Track scroll position to detect if user is near bottom
  const scrollOffsetRef = useRef(0);

  // Track if user has manually scrolled away from bottom
  // When true, auto-scroll is suppressed until reset condition
  const userScrolledAwayRef = useRef(false);

  // Track if we've completed initial scroll (prevents duplicate initial scrolls)
  const hasInitialScrolledRef = useRef(false);

  // Track if user is currently dragging (manual scroll in progress)
  const isDraggingRef = useRef(false);

  // Refs for scroll-related timeouts
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Threshold: how close to bottom counts as "at bottom" (in pixels)
  const NEAR_BOTTOM_THRESHOLD = 50;

  // DM-ID-FIX: Use Convex query for real-time messages (Phase-1 messages table)
  const messagesResult = useQuery(
    api.messages.getDmMessages,
    threadId && authUserId
      ? { authUserId, threadId, paginationOpts: { numItems: DM_PAGE_SIZE, cursor: null } }
      : 'skip'
  );
  const liveMessages = messagesResult?.page ?? [];
  const messages = useMemo(
    () => mergeDmMessagesById([...olderMessages, ...liveMessages]),
    [liveMessages, olderMessages]
  );

  // DM-ID-FIX: Mutations for sending and marking read (messages module)
  const sendConversationMessage = useMutation(api.messages.sendMessage);
  const markConversationRead = useMutation(api.messages.markAsRead);
  // DM-MEDIA-FIX: Mutation for generating upload URL for media messages
  const generateUploadUrl = useMutation(api.chatRooms.generateUploadUrl);

  const unreadIncomingMessageIds = useMemo(
    () =>
      messages
        .filter((message) => !message.isMe && message.readAt === undefined)
        .map((message) => message.id)
        .join('|'),
    [messages]
  );

  // Mark messages as read when opening DM and when new incoming messages arrive
  useEffect(() => {
    if (threadId && authUserId && unreadIncomingMessageIds.length > 0) {
      markConversationRead({ authUserId, conversationId: threadId }).catch((err) => {
        if (__DEV__) console.warn('[DM] Failed to mark messages read:', err);
      });
    }
  }, [threadId, authUserId, unreadIncomingMessageIds, markConversationRead]);

  useEffect(() => {
    setOlderMessages([]);
    setOlderMessagesCursor(null);
    setHasOlderMessages(false);
    setIsLoadingOlderMessages(false);
    setLoadOlderError(null);
  }, [threadId, authUserId]);

  useEffect(() => {
    if (!messagesResult || olderMessages.length > 0) {
      return;
    }

    setHasOlderMessages(!messagesResult.isDone);
    setOlderMessagesCursor(messagesResult.isDone ? null : messagesResult.continueCursor);
  }, [messagesResult, olderMessages.length]);

  // CHAT_SHEET: Clear draft when switching to a different user
  // This ensures text isn't carried across different chat partners
  useEffect(() => {
    setInputText('');
  }, [dm.peerId]);

  // THREAD-REOPEN: Reset scroll state when DM changes (new thread or reopen)
  useEffect(() => {
    hasInitialScrolledRef.current = false;
    userScrolledAwayRef.current = false; // Fresh start = anchored to bottom
    scrollOffsetRef.current = 0;
  }, [dm.peerId]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (!threadId || !authUserId || !hasOlderMessages || !olderMessagesCursor || isLoadingOlderMessages) {
      return;
    }

    userScrolledAwayRef.current = true;
    setIsLoadingOlderMessages(true);
    setLoadOlderError(null);

    try {
      const nextPage = await convex.query(api.messages.getDmMessages, {
        authUserId,
        threadId,
        paginationOpts: {
          numItems: DM_PAGE_SIZE,
          cursor: olderMessagesCursor,
        },
      });

      setOlderMessages((prev) => mergeDmMessagesById([...prev, ...nextPage.page]));
      setHasOlderMessages(!nextPage.isDone);
      setOlderMessagesCursor(nextPage.isDone ? null : nextPage.continueCursor);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load earlier messages right now.';
      setLoadOlderError(message);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [authUserId, convex, hasOlderMessages, isLoadingOlderMessages, olderMessagesCursor, threadId]);

  // ==========================================================================
  // HELPER: Check if currently near bottom
  // ==========================================================================
  const isNearBottom = useCallback((): boolean => {
    const contentHeight = contentHeightRef.current;
    const layoutHeight = layoutHeightRef.current;
    const scrollOffset = scrollOffsetRef.current;

    if (contentHeight <= layoutHeight) {
      // All content fits in view - always "at bottom"
      return true;
    }

    const maxOffset = contentHeight - layoutHeight;
    const distanceFromBottom = maxOffset - scrollOffset;
    return distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
  }, [NEAR_BOTTOM_THRESHOLD]);

  // ==========================================================================
  // CORE: Scroll to latest message
  // ==========================================================================
  // force=true: Always scroll (used after send, initial open)
  // force=false: Only scroll if user hasn't scrolled away
  const scrollToLatest = useCallback((animated: boolean = false, force: boolean = false): boolean => {
    // Check if we should scroll
    if (!force && userScrolledAwayRef.current) {
      return true; // Return true to indicate "handled" (just skipped)
    }

    const contentHeight = contentHeightRef.current;
    const layoutHeight = layoutHeightRef.current;

    if (contentHeight > 0 && layoutHeight > 0) {
      if (contentHeight > layoutHeight) {
        // Calculate exact offset to show bottom of content
        const offset = contentHeight - layoutHeight;
        flatListRef.current?.scrollToOffset({ offset, animated });
        scrollOffsetRef.current = offset; // Update tracked position
      }
      // Content fits in view - no scroll needed, but dimensions are valid
      return true;
    }

    // Dimensions not ready
    return false;
  }, []);

  // ==========================================================================
  // HELPER: Retry scroll until dimensions are valid
  // ==========================================================================
  const scrollWithRetry = useCallback((animated: boolean, force: boolean, maxAttempts: number = 10) => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    const attempt = (n: number) => {
      const success = scrollToLatest(animated, force);
      if (!success && n < maxAttempts) {
        scrollTimeoutRef.current = setTimeout(() => attempt(n + 1), 80);
      } else if (success && !hasInitialScrolledRef.current) {
        // Verification scroll for initial
        scrollTimeoutRef.current = setTimeout(() => {
          scrollToLatest(animated, force);
          hasInitialScrolledRef.current = true;
        }, 100);
      }
    };

    // Start after interactions settle
    InteractionManager.runAfterInteractions(() => {
      scrollTimeoutRef.current = setTimeout(() => attempt(1), 30);
    });
  }, [scrollToLatest]);

  // ==========================================================================
  // EVENT: Initial thread open / messages load
  // ==========================================================================
  useEffect(() => {
    if (messages.length > 0 && !hasInitialScrolledRef.current) {
      // Force scroll on initial open (ignore userScrolledAway)
      scrollWithRetry(false, true, 10);
    }
  }, [messages.length > 0, scrollWithRetry]);

  // ==========================================================================
  // EVENT: Keyboard open - scroll to keep latest visible
  // ==========================================================================
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';

    const sub = Keyboard.addListener(showEvent, () => {
      // Scroll if not scrolled away (don't force)
      scrollWithRetry(false, false, 5);
    });

    return () => sub.remove();
  }, [scrollWithRetry]);

  // ==========================================================================
  // EVENT: Keyboard close - scroll to keep latest visible
  // ==========================================================================
  useEffect(() => {
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const sub = Keyboard.addListener(hideEvent, () => {
      // Wait for sheet animation, then scroll if not scrolled away
      InteractionManager.runAfterInteractions(() => {
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          scrollWithRetry(true, false, 8);
        }, 150);
      });
    });

    return () => sub.remove();
  }, [scrollWithRetry]);

  // ==========================================================================
  // Cleanup on unmount
  // ==========================================================================
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, []);

  // ==========================================================================
  // HANDLER: Content size change - new messages may have arrived
  // ==========================================================================
  const handleContentSizeChange = useCallback((width: number, height: number) => {
    const prevHeight = contentHeightRef.current;
    contentHeightRef.current = height;

    // If content grew (new messages) and we haven't scrolled away, scroll to bottom
    if (height > prevHeight && !userScrolledAwayRef.current) {
      scrollToLatest(false, false);
    }

    // Handle initial scroll if dimensions just became valid
    if (!hasInitialScrolledRef.current && height > 0 && layoutHeightRef.current > 0) {
      scrollToLatest(false, true);
    }
  }, [scrollToLatest]);

  // ==========================================================================
  // HANDLER: Layout change - visible area may have changed
  // ==========================================================================
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const newHeight = e.nativeEvent.layout.height;
    const prevHeight = layoutHeightRef.current;
    layoutHeightRef.current = newHeight;

    // If layout changed and we're not scrolled away, maintain bottom anchor
    if (prevHeight > 0 && newHeight !== prevHeight && !userScrolledAwayRef.current) {
      scrollToLatest(false, false);
    }

    // Handle initial scroll if dimensions just became valid
    if (prevHeight === 0 && newHeight > 0 && contentHeightRef.current > 0 && !hasInitialScrolledRef.current) {
      scrollToLatest(false, true);
    }
  }, [scrollToLatest]);

  // ==========================================================================
  // HANDLER: Scroll events - track position and detect manual scroll
  // ==========================================================================
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.y;
    scrollOffsetRef.current = offset;

    // If user is dragging, check if they've scrolled away from bottom
    if (isDraggingRef.current) {
      const nearBottom = isNearBottom();
      if (!nearBottom) {
        userScrolledAwayRef.current = true;
      } else if (userScrolledAwayRef.current && nearBottom) {
        // User scrolled back to bottom - reset the flag
        userScrolledAwayRef.current = false;
      }
    }
  }, [isNearBottom]);

  // ==========================================================================
  // HANDLER: Drag begin - user started manual scroll
  // ==========================================================================
  const handleScrollBeginDrag = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  // ==========================================================================
  // HANDLER: Drag end - user finished manual scroll
  // ==========================================================================
  const handleScrollEndDrag = useCallback(() => {
    isDraggingRef.current = false;

    // Final check: if user ended near bottom, reset scrolled-away state
    if (isNearBottom()) {
      userScrolledAwayRef.current = false;
    }
  }, [isNearBottom]);

  // ==========================================================================
  // HANDLER: Momentum end - scroll animation finished
  // ==========================================================================
  const handleMomentumScrollEnd = useCallback(() => {
    // Final position check after momentum scroll
    if (isNearBottom()) {
      userScrolledAwayRef.current = false;
    }
  }, [isNearBottom]);

  // DM-ID-FIX: Send message via Convex mutation
  // UNIFIED-SCROLL: Send always resets scroll state and forces scroll to latest
  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || !threadId || !authUserId) return;

    setInputText('');

    try {
      await sendConversationMessage({
        conversationId: threadId,
        authUserId,
        type: 'text',
        content: trimmed,
      });

      // CHAT_SHEET: Notify parent that send is complete
      onSendComplete?.();

      // UNIFIED-SCROLL: User sent a message = they want to see it
      // Reset scrolled-away state and force scroll to latest
      userScrolledAwayRef.current = false;

      InteractionManager.runAfterInteractions(() => {
        // Force scroll to show sent message (with retry)
        const attemptSendScroll = (attempt: number) => {
          const success = scrollToLatest(false, true); // force=true
          if (!success && attempt < 5) {
            setTimeout(() => attemptSendScroll(attempt + 1), 50);
          }
        };
        setTimeout(() => attemptSendScroll(1), 50);
      });
    } catch (error) {
      if (__DEV__) console.error('[DM] Failed to send message:', error);
      // Restore input on error
      setInputText(trimmed);
    }
  }, [inputText, threadId, authUserId, sendConversationMessage, onSendComplete, scrollToLatest]);

  // DM-MEDIA-FIX: Full media upload implementation for DMs
  const handleSendMedia = useCallback(
    async (uri: string, mediaType: 'image' | 'video' | 'doodle' | 'audio') => {
      if (!threadId || !authUserId) return;

      try {
        // Step 1: Upload media to Convex storage
        const uploadHint = mediaType === 'video' ? 'video' : mediaType === 'audio' ? 'audio' : 'photo';
        const storageId = await uploadMediaToConvex(
          uri,
          () => generateUploadUrl({}),
          uploadHint
        );

        // Step 2: Send DM message with storage ID
        // Backend will resolve storageId to mediaUrl
        await sendConversationMessage(
          mediaType === 'audio'
            ? {
                conversationId: threadId,
                authUserId,
                type: 'voice',
                content: '',
                audioStorageId: storageId,
              }
            : {
                conversationId: threadId,
                authUserId,
                type: mediaType === 'video' ? 'video' : 'image',
                content: '',
                imageStorageId: storageId,
              }
        );

        // Scroll to show the new message
        scrollToLatest(true, true);

        // Notify parent if needed (e.g., for ChatSheet keyboard handling)
        onSendComplete?.();
      } catch (error) {
        if (__DEV__) console.error('[DM] Media send failed:', error);
      }
    },
    [threadId, authUserId, generateUploadUrl, sendConversationMessage, scrollToLatest, onSendComplete]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // DM-AUDIO-FIX: Voice recording support for 1-on-1 DM
  // ─────────────────────────────────────────────────────────────────────────
  const handleVoiceRecordingComplete = useCallback(
    async (result: VoiceRecorderResult) => {
      if (!result.audioUri) return;
      // Reuse existing handleSendMedia with 'audio' type
      await handleSendMedia(result.audioUri, 'audio');
    },
    [handleSendMedia]
  );

  const { toggleRecording, isRecording, elapsedMs } = useVoiceRecorder({
    onRecordingComplete: handleVoiceRecordingComplete,
    onError: (msg) => Alert.alert('Recording Error', msg),
  });

  // Enrich messages with showTimestamp
  type EnrichedMessage = DmMessage & { showTimestamp: boolean };
  const enrichedMessages = useMemo<EnrichedMessage[]>(() => {
    return messages.map((msg, index) => {
      const prevMessage = index > 0 ? messages[index - 1] : undefined;
      return {
        ...msg,
        showTimestamp: shouldShowTimestamp(msg.createdAt, prevMessage?.createdAt),
      };
    });
  }, [messages]);

  // MEDIA-INSTANT-FIX: Preload all media for instant open
  useEffect(() => {
    if (messages.length === 0) return;

    // Collect media URLs from recent messages (last 15 for good coverage)
    const recentMessages = messages.slice(-15);
    const videoUrls: string[] = [];
    const imageUrls: string[] = [];

    for (const msg of recentMessages) {
      const url = msg.mediaUrl;
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        continue;
      }

      if (msg.type === 'video') {
        videoUrls.push(url);
      } else if (msg.type === 'image' || msg.type === 'doodle') {
        imageUrls.push(url);
      }
      // Audio is handled by audioPlayerStore when played
    }

    // Preload videos to file system cache
    if (videoUrls.length > 0) {
      const uniqueUrls = [...new Set(videoUrls)];
      preloadVideos(uniqueUrls, 2);
    }

    // Prefetch images/doodles to expo-image cache
    if (imageUrls.length > 0) {
      const uniqueUrls = [...new Set(imageUrls)];
      ExpoImage.prefetch(uniqueUrls);
    }
  }, [messages]);

  const keyExtractor = useCallback((item: EnrichedMessage) => item.id, []);
  const isLoading = messagesResult === undefined && !!threadId;

  const historyHeader = useMemo(() => {
    if (isLoading) {
      return null;
    }
    if (isLoadingOlderMessages) {
      return (
        <View style={styles.historyStatus}>
          <ActivityIndicator size="small" color={C.accent} />
          <Text style={styles.historyStatusText}>Loading earlier messages…</Text>
        </View>
      );
    }
    if (loadOlderError) {
      return (
        <TouchableOpacity style={styles.historyButton} onPress={handleLoadOlderMessages}>
          <Text style={styles.historyButtonText}>Retry loading earlier messages</Text>
        </TouchableOpacity>
      );
    }
    if (hasOlderMessages) {
      return (
        <TouchableOpacity style={styles.historyButton} onPress={handleLoadOlderMessages}>
          <Text style={styles.historyButtonText}>Load earlier messages</Text>
        </TouchableOpacity>
      );
    }
    if (messages.length > 0) {
      return (
        <View style={styles.historyStatus}>
          <Text style={styles.historyStatusText}>Beginning of conversation</Text>
        </View>
      );
    }
    return null;
  }, [handleLoadOlderMessages, hasOlderMessages, isLoading, isLoadingOlderMessages, loadOlderError, messages.length]);

  // DM-UX-FIX: Handle tap-to-view for media (not hold-to-view)
  const handleMediaTap = useCallback((mediaUrl: string, mediaType: 'image' | 'video' | 'doodle') => {
    if (mediaType === 'video') {
      setVideoPlayerUri(mediaUrl);
    } else {
      // Images and doodles open in image preview
      setImagePreviewUri(mediaUrl);
    }
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: EnrichedMessage }) => {
      const isMe = item.isMe;
      // DM-SECURE-FIX: Include doodle in media check
      const isMedia = (item.type === 'image' || item.type === 'video' || item.type === 'doodle') && item.mediaUrl;
      const isDoodle = item.type === 'doodle';
      // AUDIO-UX-FIX: Check for audio message
      const isAudio = item.type === 'audio' && item.mediaUrl;

      // DM-SECURE-FIX: Photo/Video = blurred + tap-to-view (pass messageId + onPress)
      // Doodle = not blurred, normal display (no messageId)
      const mediaProps = isMedia
        ? {
            // For photo/video: include messageId to enable blur, onPress for tap-to-view
            // For doodle: no messageId (shows without blur)
            ...(isDoodle ? {} : { messageId: item.id }),
            mediaUrl: item.mediaUrl!,
            type: item.type as 'image' | 'video' | 'doodle',
            onPress: () => handleMediaTap(item.mediaUrl!, item.type as 'image' | 'video' | 'doodle'),
          }
        : null;

      // Determine bubble content
      const renderBubbleContent = () => {
        if (mediaProps) {
          return <MediaMessage {...mediaProps} />;
        }
        if (isAudio) {
          return (
            <DmAudioBubble
              messageId={item.id}
              audioUrl={item.mediaUrl!}
              isMe={isMe}
              bubbleColor={isMe ? themeColors.bubbleMe : themeColors.bubbleOther}
            />
          );
        }
        return (
          <Text
            style={[
              isMe ? styles.bubbleMeText : styles.bubbleOtherText,
              { color: isMe ? themeColors.bubbleMeText : themeColors.bubbleOtherText },
            ]}
          >
            {item.text}
          </Text>
        );
      };

      // DM-UX-FIX: No timestamps in 1-on-1 DM
      // THEME: Apply dynamic bubble colors from theme
      if (isMe) {
        return (
          <View style={styles.rowMe}>
            {isAudio ? (
              // Audio has its own bubble styling
              renderBubbleContent()
            ) : (
              <View style={[styles.bubbleMe, { backgroundColor: themeColors.bubbleMe }]}>
                {renderBubbleContent()}
              </View>
            )}
          </View>
        );
      }

      return (
        <View style={styles.rowOther}>
          {dm.peerAvatar ? (
            <Image source={{ uri: dm.peerAvatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: themeColors.surface }]}>
              <Ionicons name="person" size={12} color={themeColors.textLight} />
            </View>
          )}
          {isAudio ? (
            // Audio has its own bubble styling
            renderBubbleContent()
          ) : (
            <View style={[styles.bubbleOther, { backgroundColor: themeColors.bubbleOther }]}>
              {renderBubbleContent()}
            </View>
          )}
        </View>
      );
    },
    [dm.peerAvatar, handleMediaTap, themeColors]
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.dmBackground }]}>
      {/* [CHAT_SHEET_HEADER] Header row with avatar, name, and X button */}
      {/* When keyboard is open, sheet is full-screen - add safe area top padding
          to keep header content below status bar. */}
      <View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={[
          styles.header,
          topInset > 0 && !isInSheet && { paddingTop: topInset + 8 },
          isInSheet && styles.sheetHeader,
          // Fixed header padding in sheet mode - does NOT change on keyboard open
          // This keeps the top stable instead of extending when typing
        ]}
      >
        {/* Back button - hidden when in ChatSheet */}
        {!hideBackButton && (
          <TouchableOpacity
            onPress={onBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
        )}
        {dm.peerAvatar ? (
          <Image
            source={{ uri: dm.peerAvatar }}
            style={[
              styles.headerAvatar,
              { borderColor: GENDER_COLORS[dm.peerGender || 'other'] },
            ]}
          />
        ) : (
          <View
            style={[
              styles.headerAvatarPlaceholder,
              { borderColor: GENDER_COLORS[dm.peerGender || 'other'] },
            ]}
          >
            <Ionicons name="person" size={16} color={C.textLight} />
          </View>
        )}
        <Text style={styles.headerName} numberOfLines={1}>{dm.peerName}</Text>
        <View style={{ flex: 1 }} />

        {/* X close button - only when in sheet mode */}
        {isInSheet && onSheetClose && (
          <TouchableOpacity
            style={styles.sheetCloseButton}
            onPress={onSheetClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={20} color={C.textLight} />
          </TouchableOpacity>
        )}
      </View>

      {/* Content area - flex: 1 fills space between header and screen bottom */}
      {isModal ? (
        // Sheet/Modal mode: Explicit flex column layout
        // Structure: messages (flex: 1) + composer (auto height at bottom)
        // ChatSheet handles keyboard by translating the entire sheet upward
        <View style={styles.modalContent}>
          {/* Messages area - flex: 1 fills available space, pushes composer to bottom */}
          <View style={styles.messagesContainer}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={C.accent} />
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                style={styles.messagesList}
                data={enrichedMessages}
                keyExtractor={keyExtractor}
                renderItem={renderMessage}
                contentContainerStyle={{
                  flexGrow: 1,
                  justifyContent: 'flex-end' as const,
                  paddingHorizontal: 12,
                  paddingTop: 6,
                }}
                onLayout={handleLayout}
                onContentSizeChange={handleContentSizeChange}
                onScroll={handleScroll}
                onScrollBeginDrag={handleScrollBeginDrag}
                onScrollEndDrag={handleScrollEndDrag}
                onMomentumScrollEnd={handleMomentumScrollEnd}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                removeClippedSubviews={Platform.OS === 'android'}
                maxToRenderPerBatch={10}
                windowSize={10}
                initialNumToRender={15}
                ListHeaderComponent={historyHeader}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="chatbubble-outline" size={40} color={C.textLight} />
                    <Text style={styles.emptyText}>No messages yet. Start the conversation.</Text>
                  </View>
                }
              />
            )}
          </View>

          {/* Composer - auto height, anchored at bottom of sheet */}
          <View style={styles.inputWrapper}>
            <ChatComposer
              value={inputText}
              onChangeText={setInputText}
              onSend={handleSend}
              onPlusPress={() => setAttachmentVisible(true)}
              onMicPress={toggleRecording}
              isRecording={isRecording}
              elapsedMs={elapsedMs}
            />
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={headerHeight}
        >
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={C.accent} />
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={enrichedMessages}
              keyExtractor={keyExtractor}
              renderItem={renderMessage}
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'flex-end' as const,
                paddingTop: 6,
                paddingBottom: 0,
              }}
              onLayout={handleLayout}
              onContentSizeChange={handleContentSizeChange}
              onScroll={handleScroll}
              onScrollBeginDrag={handleScrollBeginDrag}
              onScrollEndDrag={handleScrollEndDrag}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              removeClippedSubviews={Platform.OS === 'android'}
              maxToRenderPerBatch={10}
              windowSize={10}
              initialNumToRender={15}
              ListHeaderComponent={historyHeader}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="chatbubble-outline" size={40} color={C.textLight} />
                  <Text style={styles.emptyText}>No messages yet. Start the conversation.</Text>
                </View>
              }
            />
          )}
          <View style={{ paddingBottom: insets.bottom }}>
            <ChatComposer
              value={inputText}
              onChangeText={setInputText}
              onSend={handleSend}
              onPlusPress={() => setAttachmentVisible(true)}
              onMicPress={toggleRecording}
              isRecording={isRecording}
              elapsedMs={elapsedMs}
            />
          </View>
        </KeyboardAvoidingView>
      )}

      {/* MODAL CONTAINER: Absolutely positioned to not affect flex layout */}
      {/* These modals were consuming ~80px in the flex layout, causing the gap */}
      <View style={styles.modalOverlayContainer} pointerEvents="box-none">
        {/* Attachment popup */}
        <AttachmentPopup
          visible={attachmentVisible}
          onClose={() => setAttachmentVisible(false)}
          onImageCaptured={(uri) => handleSendMedia(uri, 'image')}
          onGalleryImage={(uri) => handleSendMedia(uri, 'image')}
          onVideoSelected={(uri) => handleSendMedia(uri, 'video')}
          onDoodlePress={() => setDoodleVisible(true)}
        />

        {/* Doodle canvas */}
        {/* DM-UX-FIX: Send doodles as 'doodle' type (not 'image') so they render without blur */}
        <DoodleCanvas
          visible={doodleVisible}
          onClose={() => setDoodleVisible(false)}
          onSend={(uri) => handleSendMedia(uri, 'doodle')}
        />

        {/* Video player */}
        <VideoPlayerModal
          visible={!!videoPlayerUri}
          videoUri={videoPlayerUri}
          onClose={() => setVideoPlayerUri('')}
        />

        {/* Image preview */}
        <ImagePreviewModal
          visible={!!imagePreviewUri}
          imageUri={imagePreviewUri}
          onClose={() => setImagePreviewUri('')}
        />

        {/* DM-UX-FIX: SecureMediaViewer removed - DM now uses tap-to-view with ImagePreviewModal/VideoPlayerModal */}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // DM-VISUAL-FIX: Use purple-tinted background to distinguish DM from group chat
    backgroundColor: C.dmBackground,
  },
  // Absolutely positioned container for modals - does NOT affect flex layout
  // This fixes the 80px gap that was caused by modals consuming space in the column layout
  modalOverlayContainer: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'box-none',
  },
  // Modal/sheet content: flex column, fills available space
  modalContent: {
    flex: 1,
    flexDirection: 'column',
  },
  // Messages container: flex: 1 fills space, pushes composer to bottom
  messagesContainer: {
    flex: 1,
  },
  // FlatList fills the messages container
  messagesList: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Composer wrapper: auto height, stays at bottom due to flex layout above
  // NO padding - composer must touch sheet bottom directly
  inputWrapper: {
    borderTopWidth: 1,
    borderTopColor: C.accent,
    backgroundColor: C.surface, // Match composer background for seamless appearance
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
    gap: 10,
  },
  // Sheet-specific header: slightly more padding at top for visual balance
  // Solid background to prevent bleed-through near X button
  sheetHeader: {
    paddingTop: 12,
    paddingBottom: 10,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: C.surface,
    overflow: 'hidden',
  },
  // X close button in header (right side)
  sheetCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
  },
  headerAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  rowOther: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 8,
    maxWidth: '85%',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  bubbleOther: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderTopLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexShrink: 1,
  },
  bubbleOtherText: {
    fontSize: 15,
    lineHeight: 20,
    color: C.text,
  },
  // DM-UX-FIX: timeOther removed - no timestamps in 1-on-1 DM
  rowMe: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  bubbleMe: {
    backgroundColor: C.accent,
    borderRadius: 14,
    borderTopRightRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '80%',
  },
  bubbleMeText: {
    fontSize: 15,
    lineHeight: 20,
    color: C.text,
  },
  // DM-UX-FIX: timeMe removed - no timestamps in 1-on-1 DM
  historyStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  historyStatusText: {
    fontSize: 12,
    color: C.textLight,
  },
  historyButton: {
    alignSelf: 'center',
    marginVertical: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.accent,
    backgroundColor: C.surface,
  },
  historyButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.text,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: C.textLight,
  },
});
