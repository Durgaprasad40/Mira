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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConvex, useQuery, useMutation } from 'convex/react';
import { INCOGNITO_COLORS, lineHeight } from '@/lib/constants';
import {
  CHAT_FONTS,
  CHAT_ROOM_BUBBLE_MAX_WIDTH,
  CHAT_ROOM_BUBBLE_PADDING_H,
  CHAT_ROOM_BUBBLE_PADDING_V,
  CHAT_ROOM_BUBBLE_RADIUS,
  CHAT_ROOM_HEADER_AVATAR_SIZE,
  CHAT_ROOM_HEADER_HEIGHT,
  CHAT_ROOM_MAX_FONT_SCALE,
  CHAT_ROOM_MESSAGE_AVATAR_SIZE,
  CHAT_ROOM_MESSAGE_ROW_GAP,
  GENDER_COLORS,
  SPACING,
  SIZES,
  getChatRoomClosedBottomInset,
} from '@/lib/responsive';
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
import {
  CHAT_ROOM_TERMS_REQUIRED_MESSAGE,
  describeChatRoomBlockReason,
  isChatRoomTermsRequiredError,
} from '@/lib/chatRoomSafetyMessages';

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
  /**
   * P2-CHATROOM-COMPOSER-MEASURE: ChatSheet supplies a callback ref so it can
   * measure the composer wrapper's screen position after the keyboard opens
   * and apply an extra lift if the OEM IME (e.g. OnePlus) leaves the
   * composer overlapping the reported keyboard top. Modal-mode branch only.
   */
  onComposerRef?: (node: View | null) => void;
  /**
   * P2-CHATROOM-COMPOSER-MEASURE: Forwarded to the composer wrapper's
   * onLayout so ChatSheet can re-measure when the wrapper's size changes
   * (e.g. multi-line input growth, mute notice appears).
   */
  onComposerLayout?: (e: LayoutChangeEvent) => void;
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
  onComposerRef,
  onComposerLayout,
}: PrivateChatViewProps) {
  const flatListRef = useRef<FlatList>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [inputText, setInputText] = useState('');
  const [attachmentVisible, setAttachmentVisible] = useState(false);
  const [doodleVisible, setDoodleVisible] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [videoPlayerUri, setVideoPlayerUri] = useState('');
  const [imagePreviewUri, setImagePreviewUri] = useState('');
  const [olderMessages, setOlderMessages] = useState<DmMessage[]>([]);
  const [olderMessagesCursor, setOlderMessagesCursor] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
  const [composerSafetyMessage, setComposerSafetyMessage] = useState<string | null>(null);
  const composerSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearComposerSafetyMessage = useCallback(() => {
    if (composerSafetyTimerRef.current) {
      clearTimeout(composerSafetyTimerRef.current);
      composerSafetyTimerRef.current = null;
    }
    setComposerSafetyMessage(null);
  }, []);
  const showComposerSafetyMessage = useCallback((message: string) => {
    if (composerSafetyTimerRef.current) {
      clearTimeout(composerSafetyTimerRef.current);
      composerSafetyTimerRef.current = null;
    }
    setComposerSafetyMessage(message);
    composerSafetyTimerRef.current = setTimeout(() => {
      composerSafetyTimerRef.current = null;
      setComposerSafetyMessage(null);
    }, 4000);
  }, []);
  const routeToPolicyConsent = useCallback(() => {
    Alert.alert('Agreement Required', CHAT_ROOM_TERMS_REQUIRED_MESSAGE, [
      {
        text: 'Review Policies',
        onPress: () =>
          router.push({
            pathname: '/(onboarding)/consent',
            params: { returnTo: 'chatRooms' },
          } as any),
      },
    ]);
  }, [router]);

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

  // Keyboard transitions trigger layout/scroll events that should not be
  // interpreted as the user intentionally scrolling away from the newest item.
  const isKeyboardTransitioningRef = useRef(false);

  // Refs for scroll-related timeouts
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Threshold: how close to bottom counts as "at bottom" (in pixels)
  const NEAR_BOTTOM_THRESHOLD = 50;

  // DM-ID-FIX: Use Convex query for real-time messages (Phase-1 messages table)
  const messagesResult = useQuery(
    api.messages.getDmMessages,
    threadId && authUserId
      ? { authUserId, threadId, paginationOpts: { numItems: DM_PAGE_SIZE, cursor: null } }
      : 'skip'
  );
  const isExpiredThread = (messagesResult as { expired?: boolean } | undefined)?.expired === true;
  const liveMessages = isExpiredThread ? [] : messagesResult?.page ?? [];
  const messages = useMemo(
    () => (isExpiredThread ? [] : mergeDmMessagesById([...olderMessages, ...liveMessages])),
    [isExpiredThread, liveMessages, olderMessages]
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
    if (!isExpiredThread) return;
    setOlderMessages([]);
    setOlderMessagesCursor(null);
    setHasOlderMessages(false);
    setIsLoadingOlderMessages(false);
    setLoadOlderError(null);
    setAttachmentVisible(false);
    setDoodleVisible(false);
    setVideoPlayerUri('');
    setImagePreviewUri('');
  }, [isExpiredThread]);

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
    clearComposerSafetyMessage();
  }, [dm.peerId, clearComposerSafetyMessage]);

  useEffect(() => {
    return () => {
      if (composerSafetyTimerRef.current) {
        clearTimeout(composerSafetyTimerRef.current);
        composerSafetyTimerRef.current = null;
      }
    };
  }, []);

  // THREAD-REOPEN: Reset scroll state when DM changes (new thread or reopen)
  useEffect(() => {
    hasInitialScrolledRef.current = false;
    userScrolledAwayRef.current = false; // Fresh start = anchored to bottom
    scrollOffsetRef.current = 0;
  }, [dm.peerId]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (isExpiredThread || !threadId || !authUserId || !hasOlderMessages || !olderMessagesCursor || isLoadingOlderMessages) {
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
  }, [authUserId, convex, hasOlderMessages, isExpiredThread, isLoadingOlderMessages, olderMessagesCursor, threadId]);

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

  const markKeyboardTransitioning = useCallback(() => {
    isKeyboardTransitioningRef.current = true;
    if (keyboardTransitionTimeoutRef.current) {
      clearTimeout(keyboardTransitionTimeoutRef.current);
    }
    keyboardTransitionTimeoutRef.current = setTimeout(() => {
      isKeyboardTransitioningRef.current = false;
      keyboardTransitionTimeoutRef.current = null;
    }, 350);
  }, []);

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
  const scrollWithRetry = useCallback((
    animated: boolean,
    force: boolean,
    maxAttempts: number = 10,
    retryDelay: number = 80,
    initialDelay: number = 30
  ) => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    const attempt = (n: number) => {
      const success = scrollToLatest(animated, force);
      if (!success && n < maxAttempts) {
        scrollTimeoutRef.current = setTimeout(() => attempt(n + 1), retryDelay);
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
      scrollTimeoutRef.current = setTimeout(() => attempt(1), initialDelay);
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
      setIsKeyboardVisible(true);
      markKeyboardTransitioning();
      userScrolledAwayRef.current = false;
      scrollWithRetry(
        false,
        true,
        Platform.OS === 'android' ? 10 : 5,
        Platform.OS === 'android' ? 120 : 80,
        Platform.OS === 'android' ? 120 : 30
      );
    });

    return () => sub.remove();
  }, [markKeyboardTransitioning, scrollWithRetry]);

  // ==========================================================================
  // EVENT: Keyboard close - scroll to keep latest visible
  // ==========================================================================
  useEffect(() => {
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const sub = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
      markKeyboardTransitioning();
      // Wait for sheet animation, then scroll if not scrolled away
      InteractionManager.runAfterInteractions(() => {
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          scrollWithRetry(
            true,
            false,
            Platform.OS === 'android' ? 10 : 8,
            Platform.OS === 'android' ? 120 : 80,
            30
          );
        }, Platform.OS === 'android' ? 220 : 150);
      });
    });

    return () => sub.remove();
  }, [markKeyboardTransitioning, scrollWithRetry]);

  // ==========================================================================
  // Cleanup on unmount
  // ==========================================================================
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      if (keyboardTransitionTimeoutRef.current) {
        clearTimeout(keyboardTransitionTimeoutRef.current);
        keyboardTransitionTimeoutRef.current = null;
      }
    };
  }, []);

  // ==========================================================================
  // HANDLER: Content size change - new messages may have arrived
  // ==========================================================================
  const handleContentSizeChange = useCallback((width: number, height: number) => {
    const prevHeight = contentHeightRef.current;
    const wasNearBottom = isNearBottom();
    contentHeightRef.current = height;

    // If content grew (new messages) and we haven't scrolled away, scroll to bottom
    if (height > prevHeight && (!userScrolledAwayRef.current || wasNearBottom)) {
      userScrolledAwayRef.current = false;
      scrollToLatest(false, true);
    }

    // Handle initial scroll if dimensions just became valid
    if (!hasInitialScrolledRef.current && height > 0 && layoutHeightRef.current > 0) {
      scrollToLatest(false, true);
    }
  }, [isNearBottom, scrollToLatest]);

  // ==========================================================================
  // HANDLER: Layout change - visible area may have changed
  // ==========================================================================
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const newHeight = e.nativeEvent.layout.height;
    const prevHeight = layoutHeightRef.current;
    const wasNearBottom = isNearBottom();
    layoutHeightRef.current = newHeight;

    // If layout changed and we're not scrolled away, maintain bottom anchor
    if (prevHeight > 0 && newHeight !== prevHeight && (!userScrolledAwayRef.current || wasNearBottom)) {
      userScrolledAwayRef.current = false;
      scrollToLatest(false, true);
    }

    // Handle initial scroll if dimensions just became valid
    if (prevHeight === 0 && newHeight > 0 && contentHeightRef.current > 0 && !hasInitialScrolledRef.current) {
      scrollToLatest(false, true);
    }
  }, [isNearBottom, scrollToLatest]);

  // ==========================================================================
  // HANDLER: Scroll events - track position and detect manual scroll
  // ==========================================================================
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.y;
    scrollOffsetRef.current = offset;
    if (isKeyboardTransitioningRef.current) {
      return;
    }

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
    if (isKeyboardTransitioningRef.current) {
      return;
    }
    isDraggingRef.current = true;
  }, []);

  // ==========================================================================
  // HANDLER: Drag end - user finished manual scroll
  // ==========================================================================
  const handleScrollEndDrag = useCallback(() => {
    if (isKeyboardTransitioningRef.current) {
      isDraggingRef.current = false;
      return;
    }
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
    if (isExpiredThread) {
      Alert.alert('Chat Expired', 'This chat expired.');
      return;
    }

    setInputText('');
    clearComposerSafetyMessage();

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
      scrollWithRetry(
        false,
        true,
        Platform.OS === 'android' ? 10 : 5,
        Platform.OS === 'android' ? 120 : 50,
        50
      );
    } catch (error) {
      if (__DEV__) console.error('[DM] Failed to send message:', error);
      if (isChatRoomTermsRequiredError(error)) {
        routeToPolicyConsent();
        setInputText(trimmed);
        return;
      }
      const safetyMessage = describeChatRoomBlockReason(error);
      if (safetyMessage) {
        showComposerSafetyMessage(safetyMessage);
      }
      // Restore input on error
      setInputText(trimmed);
    }
  }, [inputText, isExpiredThread, threadId, authUserId, sendConversationMessage, onSendComplete, scrollWithRetry, clearComposerSafetyMessage, showComposerSafetyMessage, routeToPolicyConsent]);

  // DM-MEDIA-FIX: Full media upload implementation for DMs
  const handleSendMedia = useCallback(
    async (uri: string, mediaType: 'image' | 'video' | 'doodle' | 'audio') => {
      if (!threadId || !authUserId) return;
      if (isExpiredThread) {
        Alert.alert('Chat Expired', 'This chat expired.');
        return;
      }

      clearComposerSafetyMessage();

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
        userScrolledAwayRef.current = false;
        scrollWithRetry(
          true,
          true,
          Platform.OS === 'android' ? 10 : 5,
          Platform.OS === 'android' ? 120 : 50,
          50
        );

        // Notify parent if needed (e.g., for ChatSheet keyboard handling)
        onSendComplete?.();
      } catch (error) {
        if (__DEV__) console.error('[DM] Media send failed:', error);
        if (isChatRoomTermsRequiredError(error)) {
          routeToPolicyConsent();
          return;
        }
        const safetyMessage = describeChatRoomBlockReason(error);
        if (safetyMessage) {
          showComposerSafetyMessage(safetyMessage);
        }
      }
    },
    [threadId, authUserId, generateUploadUrl, sendConversationMessage, scrollWithRetry, onSendComplete, isExpiredThread, clearComposerSafetyMessage, showComposerSafetyMessage, routeToPolicyConsent]
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
  const effectiveKeyboardVisible = isKeyboardVisible || isKeyboardOpen;
  const composerBottomInset = effectiveKeyboardVisible ? 0 : getChatRoomClosedBottomInset(insets.bottom);

  const historyHeader = useMemo(() => {
    if (isLoading) {
      return null;
    }
    if (isLoadingOlderMessages) {
      return (
        <View style={styles.historyStatus}>
          <ActivityIndicator size="small" color={C.accent} />
          <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.historyStatusText}>Loading earlier messages…</Text>
        </View>
      );
    }
    if (loadOlderError) {
      return (
        <TouchableOpacity style={styles.historyButton} onPress={handleLoadOlderMessages}>
          <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.historyButtonText}>Retry loading earlier messages</Text>
        </TouchableOpacity>
      );
    }
    if (hasOlderMessages) {
      return (
        <TouchableOpacity style={styles.historyButton} onPress={handleLoadOlderMessages}>
          <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.historyButtonText}>Load earlier messages</Text>
        </TouchableOpacity>
      );
    }
    if (messages.length > 0) {
      return (
        <View style={styles.historyStatus}>
          <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.historyStatusText}>Beginning of conversation</Text>
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
            maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE}
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
              <Ionicons name="person" size={SIZES.icon.xs} color={themeColors.textLight} />
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
            <Ionicons name="arrow-back" size={SIZES.icon.lg} color={C.text} />
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
            <Ionicons name="person" size={SIZES.icon.sm} color={C.textLight} />
          </View>
        )}
        <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.headerName} numberOfLines={1}>{dm.peerName}</Text>
        <View style={{ flex: 1 }} />

        {/* X close button - only when in sheet mode */}
        {isInSheet && onSheetClose && (
          <TouchableOpacity
            style={styles.sheetCloseButton}
            onPress={onSheetClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={SIZES.icon.md} color={C.textLight} />
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
                  paddingHorizontal: SPACING.md,
                  paddingTop: SPACING.sm,
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
                    <Ionicons
                      name={isExpiredThread ? 'time-outline' : 'chatbubble-outline'}
                      size={SIZES.icon.xl}
                      color={C.textLight}
                    />
                    <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.emptyText}>
                      {isExpiredThread ? 'This chat expired.' : 'No messages yet. Start the conversation.'}
                    </Text>
                  </View>
                }
              />
            )}
          </View>

          {/* Composer - auto height, anchored at bottom of sheet.
              P2-CHATROOM-COMPOSER-MEASURE: ref + onLayout are forwarded by
              ChatSheet so it can re-measure the wrapper's screen position
              after the keyboard opens (or the wrapper height changes) and
              apply an extra lift if the OEM IME overlaps the composer. */}
          <View
            ref={onComposerRef}
            onLayout={onComposerLayout}
            style={[styles.inputWrapper, { paddingBottom: composerBottomInset }]}
          >
            {isExpiredThread ? (
              <View style={styles.expiredNotice}>
                <Ionicons name="time-outline" size={SIZES.icon.sm} color={C.textLight} />
                <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.expiredNoticeText}>This chat expired.</Text>
              </View>
            ) : (
              <>
                <ChatComposer
                  value={inputText}
                  onChangeText={(text) => {
                    setInputText(text);
                    if (composerSafetyMessage) {
                      clearComposerSafetyMessage();
                    }
                  }}
                  onSend={handleSend}
                  onPlusPress={() => setAttachmentVisible(true)}
                  onMicPress={toggleRecording}
                  isRecording={isRecording}
                  elapsedMs={elapsedMs}
                  safetyMessage={composerSafetyMessage}
                />
              </>
            )}
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
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
                paddingTop: SPACING.sm,
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
                  <Ionicons
                    name={isExpiredThread ? 'time-outline' : 'chatbubble-outline'}
                    size={SIZES.icon.xl}
                    color={C.textLight}
                  />
                  <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.emptyText}>
                    {isExpiredThread ? 'This chat expired.' : 'No messages yet. Start the conversation.'}
                  </Text>
                </View>
              }
            />
          )}
          <View style={{ paddingBottom: composerBottomInset }}>
            {isExpiredThread ? (
              <View style={styles.expiredNotice}>
                <Ionicons name="time-outline" size={SIZES.icon.sm} color={C.textLight} />
                <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.expiredNoticeText}>This chat expired.</Text>
              </View>
            ) : (
              <>
                <ChatComposer
                  value={inputText}
                  onChangeText={(text) => {
                    setInputText(text);
                    if (composerSafetyMessage) {
                      clearComposerSafetyMessage();
                    }
                  }}
                  onSend={handleSend}
                  onPlusPress={() => setAttachmentVisible(true)}
                  onMicPress={toggleRecording}
                  isRecording={isRecording}
                  elapsedMs={elapsedMs}
                  safetyMessage={composerSafetyMessage}
                />
              </>
            )}
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
    minHeight: CHAT_ROOM_HEADER_HEIGHT,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
    gap: SPACING.sm,
  },
  // Sheet-specific header: slightly more padding at top for visual balance
  // Solid background to prevent bleed-through near X button
  sheetHeader: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    borderTopLeftRadius: CHAT_ROOM_BUBBLE_RADIUS,
    borderTopRightRadius: CHAT_ROOM_BUBBLE_RADIUS,
    backgroundColor: C.surface,
    overflow: 'hidden',
  },
  // X close button in header (right side)
  sheetCloseButton: {
    width: SIZES.avatar.sm,
    height: SIZES.avatar.sm,
    borderRadius: SIZES.avatar.sm / 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: CHAT_ROOM_HEADER_AVATAR_SIZE,
    height: CHAT_ROOM_HEADER_AVATAR_SIZE,
    borderRadius: CHAT_ROOM_HEADER_AVATAR_SIZE / 2,
    borderWidth: 2,
  },
  headerAvatarPlaceholder: {
    width: CHAT_ROOM_HEADER_AVATAR_SIZE,
    height: CHAT_ROOM_HEADER_AVATAR_SIZE,
    borderRadius: CHAT_ROOM_HEADER_AVATAR_SIZE / 2,
    borderWidth: 2,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    fontSize: CHAT_FONTS.headerTitle,
    fontWeight: '700',
    lineHeight: lineHeight(CHAT_FONTS.headerTitle, 1.2),
    color: C.text,
  },
  rowOther: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: CHAT_ROOM_MESSAGE_ROW_GAP,
    maxWidth: '85%',
  },
  avatar: {
    width: CHAT_ROOM_MESSAGE_AVATAR_SIZE,
    height: CHAT_ROOM_MESSAGE_AVATAR_SIZE,
    borderRadius: CHAT_ROOM_MESSAGE_AVATAR_SIZE / 2,
    marginRight: SPACING.sm,
  },
  avatarPlaceholder: {
    width: CHAT_ROOM_MESSAGE_AVATAR_SIZE,
    height: CHAT_ROOM_MESSAGE_AVATAR_SIZE,
    borderRadius: CHAT_ROOM_MESSAGE_AVATAR_SIZE / 2,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  bubbleOther: {
    backgroundColor: C.surface,
    borderRadius: CHAT_ROOM_BUBBLE_RADIUS,
    borderTopLeftRadius: 4,
    paddingHorizontal: CHAT_ROOM_BUBBLE_PADDING_H,
    paddingVertical: CHAT_ROOM_BUBBLE_PADDING_V,
    maxWidth: CHAT_ROOM_BUBBLE_MAX_WIDTH,
    flexShrink: 1,
  },
  bubbleOtherText: {
    fontSize: CHAT_FONTS.messageText,
    lineHeight: lineHeight(CHAT_FONTS.messageText, 1.35),
    color: C.text,
  },
  // DM-UX-FIX: timeOther removed - no timestamps in 1-on-1 DM
  rowMe: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: CHAT_ROOM_MESSAGE_ROW_GAP,
  },
  bubbleMe: {
    backgroundColor: C.accent,
    borderRadius: CHAT_ROOM_BUBBLE_RADIUS,
    borderTopRightRadius: 4,
    paddingHorizontal: CHAT_ROOM_BUBBLE_PADDING_H,
    paddingVertical: CHAT_ROOM_BUBBLE_PADDING_V,
    maxWidth: CHAT_ROOM_BUBBLE_MAX_WIDTH,
  },
  bubbleMeText: {
    fontSize: CHAT_FONTS.messageText,
    lineHeight: lineHeight(CHAT_FONTS.messageText, 1.35),
    color: C.text,
  },
  // DM-UX-FIX: timeMe removed - no timestamps in 1-on-1 DM
  historyStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    gap: SPACING.xs,
  },
  historyStatusText: {
    fontSize: CHAT_FONTS.secondary,
    lineHeight: lineHeight(CHAT_FONTS.secondary, 1.35),
    color: C.textLight,
  },
  historyButton: {
    alignSelf: 'center',
    marginVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: SIZES.radius.sm,
    borderWidth: 1,
    borderColor: C.accent,
    backgroundColor: C.surface,
  },
  historyButtonText: {
    fontSize: CHAT_FONTS.secondary,
    fontWeight: '600',
    lineHeight: lineHeight(CHAT_FONTS.secondary, 1.2),
    color: C.text,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: SIZES.avatar.xl,
    gap: SPACING.sm,
  },
  emptyText: {
    fontSize: CHAT_FONTS.emptySubtitle,
    lineHeight: lineHeight(CHAT_FONTS.emptySubtitle, 1.35),
    color: C.textLight,
  },
  expiredNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: C.surface,
  },
  expiredNoticeText: {
    fontSize: CHAT_FONTS.label,
    fontWeight: '600',
    lineHeight: lineHeight(CHAT_FONTS.label, 1.2),
    color: C.textLight,
  },
});
