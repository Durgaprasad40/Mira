import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  LayoutChangeEvent,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  DEMO_CHAT_ROOMS,
  getDemoMessagesForRoom,
  DEMO_DM_INBOX,
  DEMO_FRIEND_REQUESTS,
  DEMO_ANNOUNCEMENTS,
  DEMO_CURRENT_USER,
  DEMO_ONLINE_USERS,
  DemoChatMessage,
  DemoDM,
  DemoFriendRequest,
  DemoAnnouncement,
  DemoOnlineUser,
} from '@/lib/demoData';

// Generate UUID for clientId (idempotency)
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const EMPTY_MESSAGES: DemoChatMessage[] = [];
import ChatRoomsHeader from '@/components/chatroom/ChatRoomsHeader';
import ChatMessageList, { ChatMessageListHandle } from '@/components/chatroom/ChatMessageList';
import ChatComposer, { type ComposerPanel } from '@/components/chatroom/ChatComposer';
import MessagesPopover from '@/components/chatroom/MessagesPopover';
import FriendRequestsPopover from '@/components/chatroom/FriendRequestsPopover';
import NotificationsPopover from '@/components/chatroom/NotificationsPopover';
import ProfilePopover from '@/components/chatroom/ProfilePopover';
import OnlineUsersPanel from '@/components/chatroom/OnlineUsersPanel';
import MessageActionsSheet from '@/components/chatroom/MessageActionsSheet';
import UserProfilePopup from '@/components/chatroom/UserProfilePopup';
import ViewProfileModal from '@/components/chatroom/ViewProfileModal';
import ReportUserModal, { ReportReason } from '@/components/chatroom/ReportUserModal';
import PrivateChatView from '@/components/chatroom/PrivateChatView';
import AttachmentPopup from '@/components/chatroom/AttachmentPopup';
import DoodleCanvas from '@/components/chatroom/DoodleCanvas';
// GIF feature removed
import VideoPlayerModal from '@/components/chatroom/VideoPlayerModal';
import ImagePreviewModal from '@/components/chatroom/ImagePreviewModal';
import ActiveUsersStrip from '@/components/chatroom/ActiveUsersStrip';
import { useDemoChatRoomStore } from '@/stores/demoChatRoomStore';
import { useChatRoomSessionStore } from '@/stores/chatRoomSessionStore';
const C = INCOGNITO_COLORS;

const MUTE_STORAGE_KEY = (roomId: string) => `@muted_room_${roomId}`;

type Overlay =
  | 'none'
  | 'profile'
  | 'notifications'
  | 'friendRequests'
  | 'messages'
  | 'onlineUsers'
  | 'messageActions'
  | 'userProfile'
  | 'viewProfile'
  | 'report'
  | 'attachment'
  | 'doodle';

export default function ChatRoomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Get current user ID for Convex (live mode)
  const authUserId = useAuthStore((s) => s.userId);

  // Chat room session management
  const enterRoom = useChatRoomSessionStore((s) => s.enterRoom);
  const exitRoom = useChatRoomSessionStore((s) => s.exitRoom);
  const exitToHome = useChatRoomSessionStore((s) => s.exitToHome);
  const incrementCoins = useChatRoomSessionStore((s) => s.incrementCoins);
  const userCoinsFromStore = useChatRoomSessionStore((s) => s.coins);
  const isInChatRoom = useChatRoomSessionStore((s) => s.isInChatRoom);

  // Demo mode: use local room data
  const demoRoom = DEMO_CHAT_ROOMS.find((r) => r.id === roomId);

  // Convex queries (skipped in demo mode)
  const convexRoom = useQuery(
    api.chatRooms.getRoom,
    isDemoMode ? 'skip' : { roomId: roomId as Id<'chatRooms'> }
  );

  const convexMessagesResult = useQuery(
    api.chatRooms.listMessages,
    isDemoMode ? 'skip' : { roomId: roomId as Id<'chatRooms'>, limit: 50 }
  );

  // Convex mutations
  const sendMessageMutation = useMutation(api.chatRooms.sendMessage);
  const joinRoomMutation = useMutation(api.chatRooms.joinRoom);

  // Unified room object
  const room = isDemoMode ? demoRoom : convexRoom;

  // ── Mounted guard: prevents setState after unmount ──
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const safeSet = (fn: () => void) => {
    if (isMountedRef.current) fn();
  };

  // ── Enter room session on mount ──
  useEffect(() => {
    if (roomId) {
      // Build identity from demo user or auth user
      const identity = {
        userId: isDemoMode ? DEMO_CURRENT_USER.id : (authUserId ?? 'unknown'),
        name: DEMO_CURRENT_USER.username,
        age: DEMO_CURRENT_USER.age ?? 25,
        gender: DEMO_CURRENT_USER.gender ?? 'Unknown',
        profilePicture: DEMO_CURRENT_USER.avatar ?? '',
      };
      enterRoom(roomId, identity);
    }
    // Note: We do NOT call exitRoom on unmount - user must explicitly leave via Profile
  }, [roomId, enterRoom, authUserId]);

  // ── Block hardware back button (Android) ──
  useEffect(() => {
    const onBackPress = () => {
      // Return true to prevent default back behavior
      // User must use "Leave Room" from profile menu to exit
      return true;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, []);

  // Measured heights above the KeyboardAvoidingView
  const [chatHeaderHeight, setChatHeaderHeight] = useState(0);
  const [stripHeight, setStripHeight] = useState(0);
  const onChatHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setChatHeaderHeight(e.nativeEvent.layout.height);
  }, []);
  const onStripLayout = useCallback((e: LayoutChangeEvent) => {
    setStripHeight(e.nativeEvent.layout.height);
  }, []);

  // Scroll to end when keyboard opens (WhatsApp behavior)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      requestAnimationFrame(() => {
        messageListRef.current?.scrollToEnd(true);
      });
    });
    return () => sub.remove();
  }, []);

  // ── Chat messages (persisted via Zustand store for demo mode) ──
  const messageListRef = useRef<ChatMessageListHandle>(null);
  const seedRoom = useDemoChatRoomStore((s) => s.seedRoom);
  const addStoreMessage = useDemoChatRoomStore((s) => s.addMessage);
  const setStoreMessages = useDemoChatRoomStore((s) => s.setMessages);
  const demoMessages = useDemoChatRoomStore((s) => (roomId ? s.rooms[roomId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));

  // Optimistic messages for live mode (pending messages before server confirms)
  const [pendingMessages, setPendingMessages] = useState<DemoChatMessage[]>([]);

  // Unified messages: demo mode uses store, live mode uses Convex + pending
  const messages: DemoChatMessage[] = useMemo(() => {
    if (isDemoMode) {
      return demoMessages;
    }
    // Live mode: convert Convex messages to DemoChatMessage format
    const convexMsgs = convexMessagesResult?.messages ?? [];
    const converted: DemoChatMessage[] = convexMsgs.map((m) => ({
      id: m._id,
      roomId: m.roomId,
      senderId: m.senderId,
      senderName: 'User', // Would need user lookup for names
      type: m.type as 'text' | 'image' | 'system',
      text: m.text,
      mediaUrl: m.imageUrl,
      createdAt: m.createdAt,
    }));
    // Add pending messages at the end
    return [...converted, ...pendingMessages];
  }, [isDemoMode, demoMessages, convexMessagesResult, pendingMessages]);

  // Seed the room once with demo data + join message (demo mode only)
  useEffect(() => {
    if (!isDemoMode || !roomId) return;
    const base = getDemoMessagesForRoom(roomId);
    const joinMsg: DemoChatMessage = {
      id: `sys_join_${DEMO_CURRENT_USER.id}_${Date.now()}`,
      roomId,
      senderId: 'system',
      senderName: 'System',
      type: 'system',
      text: `${DEMO_CURRENT_USER.username} joined the room`,
      createdAt: Date.now(),
    };
    seedRoom(roomId, [...base, joinMsg]);
  }, [roomId, seedRoom]);

  // Auto-join room on mount (live mode)
  useEffect(() => {
    if (isDemoMode || !roomId || !authUserId) return;
    // Auto-join the room when entering
    joinRoomMutation({
      roomId: roomId as Id<'chatRooms'>,
      userId: authUserId as Id<'users'>,
    }).catch((err) => {
      // Silently ignore - user may already be a member
      console.log('Join room:', err.message);
    });
  }, [roomId, authUserId, joinRoomMutation]);

  const [inputText, setInputText] = useState('');

  // ── User coins (from session store, persisted) ──
  // Initial coins from demo user, then store takes over
  const userCoins = userCoinsFromStore > 0 ? userCoinsFromStore : DEMO_CURRENT_USER.coins;

  // ── DM inbox state ──
  const [dms, setDMs] = useState<DemoDM[]>(DEMO_DM_INBOX);
  const unreadDMs = dms.filter(
    (dm) => dm.visible && !dm.hiddenUntilNextMessage && dm.unreadCount > 0
  ).length;

  // ── Friend requests state ──
  const [friendRequests, setFriendRequests] = useState<DemoFriendRequest[]>(
    DEMO_FRIEND_REQUESTS
  );

  // ── Announcements state ──
  const [announcements, setAnnouncements] = useState<DemoAnnouncement[]>(
    DEMO_ANNOUNCEMENTS
  );
  const unseenNotifications = announcements.filter((a) => !a.seen).length;

  // ── Single overlay state — only one modal/panel can be open at a time ──
  const [overlay, setOverlay] = useState<Overlay>('none');
  const closeOverlay = useCallback(() => setOverlay('none'), []);
  const onlineCount = DEMO_ONLINE_USERS.filter((u) => u.isOnline).length;

  // ── Exit to Chat Rooms Home (keeps session active, can return) ──
  const handleExitToHome = useCallback(() => {
    closeOverlay();
    exitToHome();
    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, exitToHome, router]);

  // ── Leave Room handler (ends session completely, clears identity) ──
  const handleLeaveRoom = useCallback(() => {
    closeOverlay();
    exitRoom();
    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, exitRoom, router]);

  // ── Payload data for overlays that need it ──
  const [selectedMessage, setSelectedMessage] = useState<DemoChatMessage | null>(null);
  const [selectedUser, setSelectedUser] = useState<DemoOnlineUser | null>(null);
  const [viewProfileUser, setViewProfileUser] = useState<DemoOnlineUser | null>(null);
  const [reportTargetUser, setReportTargetUser] = useState<DemoOnlineUser | null>(null);
  const [directChatDM, setDirectChatDM] = useState<DemoDM | null>(null);

  // ── Media preview (these use URI strings, not booleans) ──
  const [videoPlayerUri, setVideoPlayerUri] = useState('');
  const [imagePreviewUri, setImagePreviewUri] = useState('');

  // ── Auto-clear join messages after 1 minute ──
  useEffect(() => {
    if (!roomId) return;
    const currentMsgs = useDemoChatRoomStore.getState().rooms[roomId] ?? [];
    const hasJoin = currentMsgs.some((m) => m.id.startsWith('sys_join_'));
    if (!hasJoin) return;

    const timer = setTimeout(() => {
      const latest = useDemoChatRoomStore.getState().rooms[roomId] ?? [];
      setStoreMessages(roomId, latest.filter((m) => !m.id.startsWith('sys_join_')));
    }, 60000);

    return () => clearTimeout(timer);
  }, [roomId, setStoreMessages]); // run once on mount

  // ── Mute room (persisted in AsyncStorage) ──
  const [isRoomMuted, setIsRoomMuted] = useState(false);
  useEffect(() => {
    if (!roomId) return;
    AsyncStorage.getItem(MUTE_STORAGE_KEY(roomId)).then((val) => {
      safeSet(() => { if (val === 'true') setIsRoomMuted(true); });
    });
  }, [roomId]);

  const handleToggleMute = useCallback(() => {
    if (!roomId) return;
    setIsRoomMuted((prev) => {
      const next = !prev;
      AsyncStorage.setItem(MUTE_STORAGE_KEY(roomId), next ? 'true' : 'false');
      return next;
    });
  }, [roomId]);

  // ── Muted users (local Set) ──
  const [mutedUserIds, setMutedUserIds] = useState<Set<string>>(new Set());

  const handleToggleMuteUser = useCallback((userId: string) => {
    setMutedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  // ────────────────────────────────────────────
  // RELOAD
  // ────────────────────────────────────────────
  const handleReload = useCallback(() => {
    if (!roomId) return;
    const baseMessages = getDemoMessagesForRoom(roomId);
    const currentMessages = useDemoChatRoomStore.getState().rooms[roomId] ?? [];

    // Keep user-sent messages (not in base seed) merged with refreshed base
    const baseIds = new Set(baseMessages.map((m) => m.id));
    const userSent = currentMessages.filter((m) => !baseIds.has(m.id) && !m.id.startsWith('sys_join_'));
    const merged = [
      ...baseMessages,
      ...userSent,
    ].sort((a, b) => a.createdAt - b.createdAt);

    setStoreMessages(roomId, merged);

    setDMs((prev) =>
      prev.map((dm) => {
        const source = DEMO_DM_INBOX.find((s) => s.id === dm.id);
        if (!source) return dm;
        return {
          ...dm,
          unreadCount: dm.hiddenUntilNextMessage
            ? dm.unreadCount
            : source.unreadCount,
        };
      })
    );

    setFriendRequests(DEMO_FRIEND_REQUESTS);

    setAnnouncements((prev) => {
      const seenIds = new Set(prev.filter((a) => a.seen).map((a) => a.id));
      return DEMO_ANNOUNCEMENTS.map((a) => ({
        ...a,
        seen: seenIds.has(a.id) ? true : a.seen,
      }));
    });
  }, [roomId]);

  // ────────────────────────────────────────────
  // SEND MESSAGE
  // ────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || !roomId) return;

    if (isDemoMode) {
      // Demo mode: use local store
      const newMessage: DemoChatMessage = {
        id: `cm_me_${Date.now()}`,
        roomId,
        senderId: DEMO_CURRENT_USER.id,
        senderName: DEMO_CURRENT_USER.username,
        type: 'text',
        text: trimmed,
        createdAt: Date.now(),
      };
      addStoreMessage(roomId, newMessage);
      setInputText('');
      incrementCoins(); // +1 coin for sending message
    } else {
      // Live mode: use Convex with idempotency
      if (!authUserId) return;

      const clientId = generateUUID();
      const now = Date.now();

      // Optimistic update: add pending message
      const pendingMsg: DemoChatMessage = {
        id: `pending_${clientId}`,
        roomId,
        senderId: authUserId,
        senderName: 'You',
        type: 'text',
        text: trimmed,
        createdAt: now,
      };
      setPendingMessages((prev) => [...prev, pendingMsg]);
      setInputText('');

      try {
        await sendMessageMutation({
          roomId: roomId as Id<'chatRooms'>,
          senderId: authUserId as Id<'users'>,
          text: trimmed,
          clientId,
        });
        // Remove pending message on success (Convex will add the real one)
        setPendingMessages((prev) => prev.filter((m) => m.id !== `pending_${clientId}`));
        incrementCoins(); // +1 coin for sending message
      } catch (err: any) {
        // On failure, mark message as failed or remove
        Alert.alert('Error', err.message || 'Failed to send message');
        setPendingMessages((prev) => prev.filter((m) => m.id !== `pending_${clientId}`));
      }
    }
  }, [inputText, roomId, addStoreMessage, authUserId, sendMessageMutation, incrementCoins]);

  const handlePanelChange = useCallback((_panel: ComposerPanel) => {}, []);

  // ────────────────────────────────────────────
  // SEND MEDIA (image / video / doodle)
  // ────────────────────────────────────────────
  const handleSendMedia = useCallback(
    async (uri: string, mediaType: 'image' | 'video') => {
      if (!roomId) return;
      const labelMap = { image: 'Photo', video: 'Video' };

      if (isDemoMode) {
        // Demo mode: use local store
        const newMessage: DemoChatMessage = {
          id: `cm_me_${Date.now()}`,
          roomId,
          senderId: DEMO_CURRENT_USER.id,
          senderName: DEMO_CURRENT_USER.username,
          type: mediaType,
          text: `[${labelMap[mediaType]}]`,
          mediaUrl: uri,
          createdAt: Date.now(),
        };
        addStoreMessage(roomId, newMessage);
        incrementCoins(); // +1 coin for sending media
      } else {
        // Live mode: use Convex with idempotency
        if (!authUserId) return;

        const clientId = generateUUID();
        try {
          await sendMessageMutation({
            roomId: roomId as Id<'chatRooms'>,
            senderId: authUserId as Id<'users'>,
            imageUrl: uri,
            clientId,
          });
          incrementCoins(); // +1 coin for sending media
        } catch (err: any) {
          Alert.alert('Error', err.message || 'Failed to send media');
        }
      }
    },
    [roomId, addStoreMessage, authUserId, sendMessageMutation, incrementCoins]
  );

  // ────────────────────────────────────────────
  // MEDIA TAP — open preview/player
  // ────────────────────────────────────────────
  const handleMediaPress = useCallback((mediaUrl: string, type: 'image' | 'video') => {
    if (type === 'video') {
      setVideoPlayerUri(mediaUrl);
    } else {
      setImagePreviewUri(mediaUrl);
    }
  }, []);

  // ────────────────────────────────────────────
  // DM handlers
  // ────────────────────────────────────────────
  const handleMarkDMRead = useCallback((dmId: string) => {
    setDMs((prev) =>
      prev.map((dm) => (dm.id === dmId ? { ...dm, unreadCount: 0 } : dm))
    );
  }, []);

  const handleHideDM = useCallback((dmId: string) => {
    setDMs((prev) =>
      prev.map((dm) =>
        dm.id === dmId
          ? { ...dm, hiddenUntilNextMessage: true, unreadCount: 0 }
          : dm
      )
    );
  }, []);

  const handleIncomingDM = useCallback(
    (peerId: string, message: string) => {
      setDMs((prev) =>
        prev.map((dm) => {
          if (dm.peerId !== peerId) return dm;
          return {
            ...dm,
            hiddenUntilNextMessage: false,
            visible: true,
            unreadCount: dm.unreadCount + 1,
            lastMessage: message,
            lastMessageAt: Date.now(),
          };
        })
      );
    },
    []
  );

  // ────────────────────────────────────────────
  // Friend requests
  // ────────────────────────────────────────────
  const handleAcceptFriendRequest = useCallback((requestId: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  const handleRejectFriendRequest = useCallback((requestId: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  // ────────────────────────────────────────────
  // Notifications
  // ────────────────────────────────────────────
  const handleMarkAllNotificationsSeen = useCallback(() => {
    setAnnouncements((prev) => prev.map((a) => ({ ...a, seen: true })));
  }, []);

  // ────────────────────────────────────────────
  // Message long-press → actions sheet
  // ────────────────────────────────────────────
  const handleMessageLongPress = useCallback((message: DemoChatMessage) => {
    setSelectedMessage(message);
    setOverlay('messageActions');
  }, []);

  // ────────────────────────────────────────────
  // Avatar/name tap → user profile popup
  // ────────────────────────────────────────────
  const handleAvatarPress = useCallback((senderId: string) => {
    const onlineUser = DEMO_ONLINE_USERS.find((u) => u.id === senderId);
    if (onlineUser) {
      setSelectedUser(onlineUser);
    } else {
      const msg = messages.find((m) => m.senderId === senderId);
      setSelectedUser({
        id: senderId,
        username: msg?.senderName || 'Unknown',
        avatar: msg?.senderAvatar,
        isOnline: false,
      });
    }
    setOverlay('userProfile');
  }, [messages]);

  // ────────────────────────────────────────────
  // Online users panel — user tap
  // ────────────────────────────────────────────
  const handleOnlineUserPress = useCallback((user: DemoOnlineUser) => {
    setSelectedUser(user);
    setOverlay('userProfile');
  }, []);

  // ────────────────────────────────────────────
  // View Profile — open large photo modal
  // ────────────────────────────────────────────
  const handleViewProfile = useCallback((userId: string) => {
    setViewProfileUser(selectedUser);
    setOverlay('viewProfile');
  }, [selectedUser]);

  // ────────────────────────────────────────────
  // Private Message — open direct 1:1 chat
  // Find or create DM thread, then open PrivateChatView
  // ────────────────────────────────────────────
  const handlePrivateMessage = useCallback((userId: string) => {
    // Find existing DM thread for this peer
    let existingDM = dms.find((dm) => dm.peerId === userId);

    if (!existingDM) {
      const user = selectedUser;
      const newDM: DemoDM = {
        id: `dm_new_${userId}`,
        peerId: userId,
        peerName: user?.username || 'Unknown',
        peerAvatar: user?.avatar,
        lastMessage: '',
        lastMessageAt: Date.now(),
        unreadCount: 0,
        visible: true,
        hiddenUntilNextMessage: false,
      };
      setDMs((prev) => [newDM, ...prev]);
      existingDM = newDM;
    }

    setDirectChatDM(existingDM);
    setSelectedUser(null);
    setOverlay('none');
  }, [dms, selectedUser]);

  // ────────────────────────────────────────────
  // Report — open report modal
  // ────────────────────────────────────────────
  const handleReport = useCallback((userId: string) => {
    setReportTargetUser(selectedUser);
    setOverlay('report');
  }, [selectedUser]);

  const handleSubmitReport = useCallback(
    (data: {
      reportedUserId: string;
      reason: ReportReason;
      details?: string;
      roomId?: string;
    }) => {
      // Store the report (in a real app, call convex mutation)
      // For now, store in AsyncStorage as a simple JSON array
      const reportEntry = {
        reporterId: DEMO_CURRENT_USER.id,
        reportedUserId: data.reportedUserId,
        roomId: data.roomId,
        reason: data.reason,
        detailsText: data.details,
        createdAt: Date.now(),
      };

      AsyncStorage.getItem('@chat_room_reports').then((raw) => {
        const reports = raw ? JSON.parse(raw) : [];
        reports.push(reportEntry);
        AsyncStorage.setItem('@chat_room_reports', JSON.stringify(reports));
      });

      setOverlay('none');
      setReportTargetUser(null);

      // Show success toast
      Alert.alert('Report submitted', 'Thank you. We will review this report.', [
        { text: 'OK' },
      ]);
    },
    []
  );

  // ────────────────────────────────────────────
  // Close direct chat → back to room
  // ────────────────────────────────────────────
  const handleCloseDirectChat = useCallback(() => {
    setDirectChatDM(null);
  }, []);

  // ── Not found ──
  if (!room) {
    return (
      <View style={styles.container}>
        <ChatRoomsHeader
          title="Room Not Found"
          hideLeftButton
          topInset={insets.top}
        />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.notFoundText}>Room not found</Text>
        </View>
      </View>
    );
  }

  // ── If direct chat is open, show it as full-screen overlay ──
  if (directChatDM) {
    return (
      <View style={styles.container}>
        <PrivateChatView dm={directChatDM} onBack={handleCloseDirectChat} topInset={insets.top} />
      </View>
    );
  }

  // Get room name for header
  const roomName = isDemoMode
    ? (room as any)?.name ?? 'Chat Room'
    : (room as any)?.name ?? 'Chat Room';

  return (
    <View style={styles.container}>
      {/* Header with badge counters — measured via onLayout */}
      <View onLayout={onChatHeaderLayout}>
        <ChatRoomsHeader
          title={roomName}
          hideLeftButton
          topInset={insets.top}
          onRefreshPress={handleReload}
          onInboxPress={() => setOverlay('messages')}
          onNotificationsPress={() => setOverlay('notifications')}
          onProfilePress={() => setOverlay('profile')}
          profileAvatar={DEMO_CURRENT_USER.avatar}
          unreadInbox={unreadDMs}
          unseenNotifications={unseenNotifications}
        />
      </View>

      {/* Active users strip */}
      <View onLayout={onStripLayout}>
        <ActiveUsersStrip
          users={DEMO_ONLINE_USERS.map((u) => ({ id: u.id, avatar: u.avatar, isOnline: u.isOnline }))}
          theme="dark"
          onUserPress={(userId) => {
            const user = DEMO_ONLINE_USERS.find((u) => u.id === userId);
            if (user) handleOnlineUserPress(user);
          }}
          onMorePress={() => setOverlay('onlineUsers')}
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={chatHeaderHeight + stripHeight}
      >
        {/* Messages */}
        <ChatMessageList
          ref={messageListRef}
          messages={messages}
          currentUserId={isDemoMode ? DEMO_CURRENT_USER.id : (authUserId ?? '')}
          mutedUserIds={mutedUserIds}
          onMessageLongPress={handleMessageLongPress}
          onAvatarPress={handleAvatarPress}
          onMediaPress={handleMediaPress}
          contentPaddingBottom={0}
        />

        {/* Composer — pushed up by KAV */}
        <View style={{ paddingBottom: insets.bottom }}>
          <ChatComposer
            value={inputText}
            onChangeText={setInputText}
            onSend={handleSend}
            onPlusPress={() => setOverlay('attachment')}
            onPanelChange={handlePanelChange}
          />
        </View>
      </KeyboardAvoidingView>

      {/* ── Modals / Sheets / Panels ── */}

      <MessagesPopover
        visible={overlay === 'messages'}
        onClose={closeOverlay}
        dms={dms}
        onOpenChat={(dm) => {
          handleMarkDMRead(dm.id);
          setDirectChatDM(dm);
          closeOverlay();
        }}
        onHideDM={handleHideDM}
      />

      <FriendRequestsPopover
        visible={overlay === 'friendRequests'}
        onClose={closeOverlay}
        requests={friendRequests}
        onAccept={handleAcceptFriendRequest}
        onReject={handleRejectFriendRequest}
      />

      <NotificationsPopover
        visible={overlay === 'notifications'}
        onClose={closeOverlay}
        announcements={announcements}
        onMarkAllSeen={handleMarkAllNotificationsSeen}
      />

      <ProfilePopover
        visible={overlay === 'profile'}
        onClose={closeOverlay}
        username={DEMO_CURRENT_USER.username}
        avatar={DEMO_CURRENT_USER.avatar}
        isActive={true}
        coins={userCoins}
        age={DEMO_CURRENT_USER.age ?? 25}
        gender={DEMO_CURRENT_USER.gender ?? 'Unknown'}
        onExitToHome={handleExitToHome}
        onLeaveRoom={handleLeaveRoom}
      />

      {/* Online users right panel */}
      <OnlineUsersPanel
        visible={overlay === 'onlineUsers'}
        onClose={closeOverlay}
        users={DEMO_ONLINE_USERS}
        onUserPress={handleOnlineUserPress}
      />

      {/* Message actions sheet (long-press) */}
      <MessageActionsSheet
        visible={overlay === 'messageActions'}
        onClose={() => {
          closeOverlay();
          setSelectedMessage(null);
        }}
        messageText={selectedMessage?.text || ''}
        senderName={selectedMessage?.senderName || ''}
        onReply={() => {
          closeOverlay();
          setSelectedMessage(null);
        }}
        onReport={() => {
          closeOverlay();
          setSelectedMessage(null);
        }}
      />

      {/* User profile popup (tap avatar/name) */}
      <UserProfilePopup
        visible={overlay === 'userProfile'}
        onClose={() => {
          closeOverlay();
          setSelectedUser(null);
        }}
        user={selectedUser}
        isMuted={selectedUser ? mutedUserIds.has(selectedUser.id) : false}
        onViewProfile={handleViewProfile}
        onPrivateMessage={handlePrivateMessage}
        onMuteUser={(userId) => {
          handleToggleMuteUser(userId);
        }}
        onReport={handleReport}
      />

      {/* View Profile modal (large 3x photo) */}
      <ViewProfileModal
        visible={overlay === 'viewProfile'}
        onClose={() => {
          closeOverlay();
          setViewProfileUser(null);
        }}
        user={viewProfileUser}
      />

      {/* Attachment popup (+ button) */}
      <AttachmentPopup
        visible={overlay === 'attachment'}
        onClose={closeOverlay}
        onImageCaptured={(uri) => handleSendMedia(uri, 'image')}
        onGalleryImage={(uri) => handleSendMedia(uri, 'image')}
        onVideoSelected={(uri) => handleSendMedia(uri, 'video')}
        onDoodlePress={() => setOverlay('doodle')}
      />

      {/* Doodle canvas */}
      <DoodleCanvas
        visible={overlay === 'doodle'}
        onClose={closeOverlay}
        onSend={(uri) => handleSendMedia(uri, 'image')}
      />

      {/* Video player modal */}
      <VideoPlayerModal
        visible={!!videoPlayerUri}
        videoUri={videoPlayerUri}
        onClose={() => setVideoPlayerUri('')}
      />

      {/* Image preview modal */}
      <ImagePreviewModal
        visible={!!imagePreviewUri}
        imageUri={imagePreviewUri}
        onClose={() => setImagePreviewUri('')}
      />

      {/* Report user modal */}
      <ReportUserModal
        visible={overlay === 'report'}
        onClose={() => {
          closeOverlay();
          setReportTargetUser(null);
        }}
        reportedUserId={reportTargetUser?.id || ''}
        reportedUserName={reportTargetUser?.username || ''}
        roomId={roomId}
        onSubmit={handleSubmitReport}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  notFoundText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textLight,
  },
});
