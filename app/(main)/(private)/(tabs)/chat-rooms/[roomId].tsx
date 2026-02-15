import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  InteractionManager,
  FlatList,
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

import ChatRoomsHeader from '@/components/chatroom/ChatRoomsHeader';
import ChatMessageItem from '@/components/chatroom/ChatMessageItem';
import SystemMessageItem from '@/components/chatroom/SystemMessageItem';
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
import VideoPlayerModal from '@/components/chatroom/VideoPlayerModal';
import ImagePreviewModal from '@/components/chatroom/ImagePreviewModal';
import ActiveUsersStrip from '@/components/chatroom/ActiveUsersStrip';
import { useDemoChatRoomStore } from '@/stores/demoChatRoomStore';
import { useChatRoomSessionStore } from '@/stores/chatRoomSessionStore';

const C = INCOGNITO_COLORS;
const MUTE_STORAGE_KEY = (roomId: string) => `@muted_room_${roomId}`;
const EMPTY_MESSAGES: DemoChatMessage[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatDateLabel(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  if (isSameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return 'Yesterday';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// List item types for FlatList
type ListItem =
  | { type: 'date'; id: string; label: string }
  | { type: 'message'; id: string; message: DemoChatMessage };

// Build list items with date separators (normal order, NOT reversed)
function buildListItems(messages: DemoChatMessage[]): ListItem[] {
  const items: ListItem[] = [];
  let lastDateLabel = '';
  for (const msg of messages) {
    const label = formatDateLabel(msg.createdAt);
    if (label !== lastDateLabel) {
      items.push({ type: 'date', id: `date_${msg.createdAt}`, label });
      lastDateLabel = label;
    }
    items.push({ type: 'message', id: msg.id, message: msg });
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERLAY TYPE
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function ChatRoomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH & SESSION
  // ─────────────────────────────────────────────────────────────────────────
  const authUserId = useAuthStore((s) => s.userId);
  const enterRoom = useChatRoomSessionStore((s) => s.enterRoom);
  const exitRoom = useChatRoomSessionStore((s) => s.exitRoom);
  const exitToHome = useChatRoomSessionStore((s) => s.exitToHome);
  const incrementCoins = useChatRoomSessionStore((s) => s.incrementCoins);
  const userCoinsFromStore = useChatRoomSessionStore((s) => s.coins);

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

  // ─────────────────────────────────────────────────────────────────────────
  // MOUNTED GUARD
  // ─────────────────────────────────────────────────────────────────────────
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // ENTER ROOM SESSION
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (roomId) {
      const identity = {
        userId: isDemoMode ? DEMO_CURRENT_USER.id : (authUserId ?? 'unknown'),
        name: DEMO_CURRENT_USER.username,
        age: DEMO_CURRENT_USER.age ?? 25,
        gender: DEMO_CURRENT_USER.gender ?? 'Unknown',
        profilePicture: DEMO_CURRENT_USER.avatar ?? '',
      };
      enterRoom(roomId, identity);
    }
  }, [roomId, enterRoom, authUserId]);

  // ─────────────────────────────────────────────────────────────────────────
  // ANDROID BACK BUTTON → Go back to chat-rooms list (within tab stack)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBackPress = () => {
      // Navigate back to the list screen within the same tab
      router.back();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [router]);


  // ─────────────────────────────────────────────────────────────────────────
  // FLATLIST REF & COMPOSER HEIGHT
  // ─────────────────────────────────────────────────────────────────────────
  const listRef = useRef<FlatList<ListItem>>(null);
  const [composerHeight, setComposerHeight] = useState(56);

  // ─────────────────────────────────────────────────────────────────────────
  // SCROLL TO BOTTOM HELPER (with Android timing fix)
  // ─────────────────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback((animated = true) => {
    const run = () => listRef.current?.scrollToEnd({ animated });
    if (Platform.OS === 'android') {
      InteractionManager.runAfterInteractions(() => setTimeout(run, 120));
    } else {
      requestAnimationFrame(run);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // KEYBOARD LISTENERS (scroll on open)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      scrollToBottom(true);
    });
    return () => sub.remove();
  }, [scrollToBottom]);

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGES (Demo store or Convex)
  // ─────────────────────────────────────────────────────────────────────────
  const seedRoom = useDemoChatRoomStore((s) => s.seedRoom);
  const addStoreMessage = useDemoChatRoomStore((s) => s.addMessage);
  const setStoreMessages = useDemoChatRoomStore((s) => s.setMessages);
  const demoMessages = useDemoChatRoomStore((s) => (roomId ? s.rooms[roomId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));

  const [pendingMessages, setPendingMessages] = useState<DemoChatMessage[]>([]);

  const messages: DemoChatMessage[] = useMemo(() => {
    if (isDemoMode) return demoMessages;
    const convexMsgs = convexMessagesResult?.messages ?? [];
    const converted: DemoChatMessage[] = convexMsgs.map((m) => ({
      id: m._id,
      roomId: m.roomId,
      senderId: m.senderId,
      senderName: 'User',
      type: m.type as 'text' | 'image' | 'system',
      text: m.text,
      mediaUrl: m.imageUrl,
      createdAt: m.createdAt,
    }));
    return [...converted, ...pendingMessages];
  }, [isDemoMode, demoMessages, convexMessagesResult, pendingMessages]);

  // Build list items (normal order)
  const listItems = useMemo(() => buildListItems(messages), [messages]);

  // Scroll to bottom when message count increases
  const prevMessageCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      scrollToBottom(true);
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, scrollToBottom]);

  // Initial scroll on first load
  const hasInitialScrolled = useRef(false);
  useEffect(() => {
    if (!hasInitialScrolled.current && messages.length > 0) {
      hasInitialScrolled.current = true;
      scrollToBottom(false);
    }
  }, [messages.length, scrollToBottom]);

  // Seed demo room on mount
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

  // Auto-join Convex room
  useEffect(() => {
    if (isDemoMode || !roomId || !authUserId) return;
    joinRoomMutation({
      roomId: roomId as Id<'chatRooms'>,
      userId: authUserId as Id<'users'>,
    }).catch(() => {});
  }, [roomId, authUserId, joinRoomMutation]);

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [inputText, setInputText] = useState('');
  const userCoins = userCoinsFromStore > 0 ? userCoinsFromStore : DEMO_CURRENT_USER.coins;

  // ─────────────────────────────────────────────────────────────────────────
  // DM / FRIEND REQUESTS / NOTIFICATIONS STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [dms, setDMs] = useState<DemoDM[]>(DEMO_DM_INBOX);
  const unreadDMs = dms.filter((dm) => dm.visible && !dm.hiddenUntilNextMessage && dm.unreadCount > 0).length;

  const [friendRequests, setFriendRequests] = useState<DemoFriendRequest[]>(DEMO_FRIEND_REQUESTS);
  const [announcements, setAnnouncements] = useState<DemoAnnouncement[]>(DEMO_ANNOUNCEMENTS);
  const unseenNotifications = announcements.filter((a) => !a.seen).length;

  // ─────────────────────────────────────────────────────────────────────────
  // OVERLAY STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<Overlay>('none');
  const closeOverlay = useCallback(() => setOverlay('none'), []);

  const [selectedMessage, setSelectedMessage] = useState<DemoChatMessage | null>(null);
  const [selectedUser, setSelectedUser] = useState<DemoOnlineUser | null>(null);
  const [viewProfileUser, setViewProfileUser] = useState<DemoOnlineUser | null>(null);
  const [reportTargetUser, setReportTargetUser] = useState<DemoOnlineUser | null>(null);
  const [directChatDM, setDirectChatDM] = useState<DemoDM | null>(null);

  const [videoPlayerUri, setVideoPlayerUri] = useState('');
  const [imagePreviewUri, setImagePreviewUri] = useState('');

  // ─────────────────────────────────────────────────────────────────────────
  // MUTE STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [isRoomMuted, setIsRoomMuted] = useState(false);
  const [mutedUserIds, setMutedUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!roomId) return;
    AsyncStorage.getItem(MUTE_STORAGE_KEY(roomId)).then((val) => {
      if (isMountedRef.current && val === 'true') setIsRoomMuted(true);
    });
  }, [roomId]);

  const handleToggleMuteUser = useCallback((userId: string) => {
    setMutedUserIds((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }, []);

  // Auto-clear join messages after 1 minute
  useEffect(() => {
    if (!roomId) return;
    const currentMsgs = useDemoChatRoomStore.getState().rooms[roomId] ?? [];
    if (!currentMsgs.some((m) => m.id.startsWith('sys_join_'))) return;

    const timer = setTimeout(() => {
      const latest = useDemoChatRoomStore.getState().rooms[roomId] ?? [];
      setStoreMessages(roomId, latest.filter((m) => !m.id.startsWith('sys_join_')));
    }, 60000);

    return () => clearTimeout(timer);
  }, [roomId, setStoreMessages]);

  // ─────────────────────────────────────────────────────────────────────────
  // NAVIGATION HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleExitToHome = useCallback(() => {
    closeOverlay();
    exitToHome();
    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, exitToHome, router]);

  const handleLeaveRoom = useCallback(() => {
    closeOverlay();
    exitRoom();
    router.replace('/(main)/(private)/(tabs)/chat-rooms');
  }, [closeOverlay, exitRoom, router]);

  // ─────────────────────────────────────────────────────────────────────────
  // RELOAD HANDLER
  // ─────────────────────────────────────────────────────────────────────────
  const handleReload = useCallback(() => {
    if (!roomId) return;
    const baseMessages = getDemoMessagesForRoom(roomId);
    const currentMessages = useDemoChatRoomStore.getState().rooms[roomId] ?? [];
    const baseIds = new Set(baseMessages.map((m) => m.id));
    const userSent = currentMessages.filter((m) => !baseIds.has(m.id) && !m.id.startsWith('sys_join_'));
    const merged = [...baseMessages, ...userSent].sort((a, b) => a.createdAt - b.createdAt);
    setStoreMessages(roomId, merged);

    setDMs((prev) =>
      prev.map((dm) => {
        const source = DEMO_DM_INBOX.find((s) => s.id === dm.id);
        if (!source) return dm;
        return { ...dm, unreadCount: dm.hiddenUntilNextMessage ? dm.unreadCount : source.unreadCount };
      })
    );
    setFriendRequests(DEMO_FRIEND_REQUESTS);
    setAnnouncements((prev) => {
      const seenIds = new Set(prev.filter((a) => a.seen).map((a) => a.id));
      return DEMO_ANNOUNCEMENTS.map((a) => ({ ...a, seen: seenIds.has(a.id) ? true : a.seen }));
    });
  }, [roomId, setStoreMessages]);

  // ─────────────────────────────────────────────────────────────────────────
  // SEND MESSAGE
  // ─────────────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed || !roomId) return;

    if (isDemoMode) {
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
      incrementCoins();
    } else {
      if (!authUserId) return;
      const clientId = generateUUID();
      const now = Date.now();

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
        setPendingMessages((prev) => prev.filter((m) => m.id !== `pending_${clientId}`));
        incrementCoins();
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to send message');
        setPendingMessages((prev) => prev.filter((m) => m.id !== `pending_${clientId}`));
      }
    }
  }, [inputText, roomId, addStoreMessage, authUserId, sendMessageMutation, incrementCoins]);

  const handlePanelChange = useCallback((_panel: ComposerPanel) => {}, []);

  // ─────────────────────────────────────────────────────────────────────────
  // SEND MEDIA
  // ─────────────────────────────────────────────────────────────────────────
  const handleSendMedia = useCallback(
    async (uri: string, mediaType: 'image' | 'video') => {
      if (!roomId) return;
      const labelMap = { image: 'Photo', video: 'Video' };

      if (isDemoMode) {
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
        incrementCoins();
      } else {
        if (!authUserId) return;
        const clientId = generateUUID();
        try {
          await sendMessageMutation({
            roomId: roomId as Id<'chatRooms'>,
            senderId: authUserId as Id<'users'>,
            imageUrl: uri,
            clientId,
          });
          incrementCoins();
        } catch (err: any) {
          Alert.alert('Error', err.message || 'Failed to send media');
        }
      }
    },
    [roomId, addStoreMessage, authUserId, sendMessageMutation, incrementCoins]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // MEDIA PRESS
  // ─────────────────────────────────────────────────────────────────────────
  const handleMediaPress = useCallback((mediaUrl: string, type: 'image' | 'video') => {
    if (type === 'video') {
      setVideoPlayerUri(mediaUrl);
    } else {
      setImagePreviewUri(mediaUrl);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // DM HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleMarkDMRead = useCallback((dmId: string) => {
    setDMs((prev) => prev.map((dm) => (dm.id === dmId ? { ...dm, unreadCount: 0 } : dm)));
  }, []);

  const handleHideDM = useCallback((dmId: string) => {
    setDMs((prev) =>
      prev.map((dm) => (dm.id === dmId ? { ...dm, hiddenUntilNextMessage: true, unreadCount: 0 } : dm))
    );
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // FRIEND REQUEST HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleAcceptFriendRequest = useCallback((requestId: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  const handleRejectFriendRequest = useCallback((requestId: string) => {
    setFriendRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // NOTIFICATION HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const handleMarkAllNotificationsSeen = useCallback(() => {
    setAnnouncements((prev) => prev.map((a) => ({ ...a, seen: true })));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE LONG PRESS
  // ─────────────────────────────────────────────────────────────────────────
  const handleMessageLongPress = useCallback((message: DemoChatMessage) => {
    setSelectedMessage(message);
    setOverlay('messageActions');
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // AVATAR PRESS
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // ONLINE USER PRESS
  // ─────────────────────────────────────────────────────────────────────────
  const handleOnlineUserPress = useCallback((user: DemoOnlineUser) => {
    setSelectedUser(user);
    setOverlay('userProfile');
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW PROFILE
  // ─────────────────────────────────────────────────────────────────────────
  const handleViewProfile = useCallback(() => {
    setViewProfileUser(selectedUser);
    setOverlay('viewProfile');
  }, [selectedUser]);

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE MESSAGE
  // ─────────────────────────────────────────────────────────────────────────
  const handlePrivateMessage = useCallback((userId: string) => {
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

  // ─────────────────────────────────────────────────────────────────────────
  // REPORT
  // ─────────────────────────────────────────────────────────────────────────
  const handleReport = useCallback(() => {
    setReportTargetUser(selectedUser);
    setOverlay('report');
  }, [selectedUser]);

  const handleSubmitReport = useCallback(
    (data: { reportedUserId: string; reason: ReportReason; details?: string; roomId?: string }) => {
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
      Alert.alert('Report submitted', 'Thank you. We will review this report.', [{ text: 'OK' }]);
    },
    []
  );

  // ─────────────────────────────────────────────────────────────────────────
  // CLOSE DIRECT CHAT
  // ─────────────────────────────────────────────────────────────────────────
  const handleCloseDirectChat = useCallback(() => {
    setDirectChatDM(null);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER MESSAGE ITEM (reuses existing components)
  // ─────────────────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'date') {
        return (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateLabel}>{item.label}</Text>
            <View style={styles.dateLine} />
          </View>
        );
      }

      const msg = item.message;

      if (msg.type === 'system') {
        const isJoin = (msg.text || '').includes('joined');
        return <SystemMessageItem text={msg.text || ''} isJoin={isJoin} />;
      }

      const isMuted = mutedUserIds.has(msg.senderId);
      const isMe = (isDemoMode ? DEMO_CURRENT_USER.id : authUserId) === msg.senderId;

      return (
        <ChatMessageItem
          senderName={msg.senderName}
          senderId={msg.senderId}
          senderAvatar={msg.senderAvatar}
          text={msg.text || ''}
          timestamp={msg.createdAt}
          isMe={isMe}
          dimmed={isMuted}
          messageType={(msg.type || 'text') as 'text' | 'image' | 'video'}
          mediaUrl={msg.mediaUrl}
          onLongPress={() => handleMessageLongPress(msg)}
          onAvatarPress={() => handleAvatarPress(msg.senderId)}
          onNamePress={() => handleAvatarPress(msg.senderId)}
          onMediaPress={handleMediaPress}
        />
      );
    },
    [mutedUserIds, authUserId, handleMessageLongPress, handleAvatarPress, handleMediaPress]
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  // ─────────────────────────────────────────────────────────────────────────
  // NOT FOUND
  // ─────────────────────────────────────────────────────────────────────────
  if (!room) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ChatRoomsHeader title="Room Not Found" hideLeftButton topInset={insets.top} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.notFoundText}>Room not found</Text>
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DIRECT CHAT OVERLAY
  // ─────────────────────────────────────────────────────────────────────────
  if (directChatDM) {
    return (
      <View style={styles.container}>
        <PrivateChatView dm={directChatDM} onBack={handleCloseDirectChat} topInset={insets.top} />
      </View>
    );
  }

  const roomName = (room as any)?.name ?? 'Chat Room';

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER - KAV + FlatList + flexGrow + justifyContent:flex-end
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <View style={styles.container}>
      {/* ─── HEADER ─── */}
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

      {/* ─── ACTIVE USERS STRIP ─── */}
      <ActiveUsersStrip
        users={DEMO_ONLINE_USERS.map((u) => ({ id: u.id, avatar: u.avatar, isOnline: u.isOnline }))}
        theme="dark"
        onUserPress={(userId) => {
          const user = DEMO_ONLINE_USERS.find((u) => u.id === userId);
          if (user) handleOnlineUserPress(user);
        }}
        onMorePress={() => setOverlay('onlineUsers')}
      />

      {/* ─── KEYBOARD AVOIDING VIEW ─── */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatArea}>
          {messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubble-outline" size={40} color={C.textLight} />
              <Text style={styles.emptyText}>No messages yet</Text>
              <Text style={styles.emptySubtext}>Be the first to say something!</Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={listItems}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'flex-end',
                paddingHorizontal: 12,
                paddingTop: 8,
                paddingBottom: composerHeight,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            />
          )}

          {/* ─── COMPOSER ─── */}
          <View
            style={[styles.composerWrapper, { paddingBottom: Platform.OS === 'ios' ? insets.bottom : 0 }]}
            onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
          >
            <ChatComposer
              value={inputText}
              onChangeText={setInputText}
              onSend={handleSend}
              onPlusPress={() => setOverlay('attachment')}
              onPanelChange={handlePanelChange}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* MODALS / SHEETS / PANELS                                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

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

      <OnlineUsersPanel
        visible={overlay === 'onlineUsers'}
        onClose={closeOverlay}
        users={DEMO_ONLINE_USERS}
        onUserPress={handleOnlineUserPress}
      />

      <MessageActionsSheet
        visible={overlay === 'messageActions'}
        onClose={() => { closeOverlay(); setSelectedMessage(null); }}
        messageText={selectedMessage?.text || ''}
        senderName={selectedMessage?.senderName || ''}
        onReply={() => { closeOverlay(); setSelectedMessage(null); }}
        onReport={() => { closeOverlay(); setSelectedMessage(null); }}
      />

      <UserProfilePopup
        visible={overlay === 'userProfile'}
        onClose={() => { closeOverlay(); setSelectedUser(null); }}
        user={selectedUser}
        isMuted={selectedUser ? mutedUserIds.has(selectedUser.id) : false}
        onViewProfile={handleViewProfile}
        onPrivateMessage={handlePrivateMessage}
        onMuteUser={handleToggleMuteUser}
        onReport={handleReport}
      />

      <ViewProfileModal
        visible={overlay === 'viewProfile'}
        onClose={() => { closeOverlay(); setViewProfileUser(null); }}
        user={viewProfileUser}
      />

      <AttachmentPopup
        visible={overlay === 'attachment'}
        onClose={closeOverlay}
        onImageCaptured={(uri) => handleSendMedia(uri, 'image')}
        onGalleryImage={(uri) => handleSendMedia(uri, 'image')}
        onVideoSelected={(uri) => handleSendMedia(uri, 'video')}
        onDoodlePress={() => setOverlay('doodle')}
      />

      <DoodleCanvas
        visible={overlay === 'doodle'}
        onClose={closeOverlay}
        onSend={(uri) => handleSendMedia(uri, 'image')}
      />

      <VideoPlayerModal
        visible={!!videoPlayerUri}
        videoUri={videoPlayerUri}
        onClose={() => setVideoPlayerUri('')}
      />

      <ImagePreviewModal
        visible={!!imagePreviewUri}
        imageUri={imagePreviewUri}
        onClose={() => setImagePreviewUri('')}
      />

      <ReportUserModal
        visible={overlay === 'report'}
        onClose={() => { closeOverlay(); setReportTargetUser(null); }}
        reportedUserId={reportTargetUser?.id || ''}
        reportedUserName={reportTargetUser?.username || ''}
        roomId={roomId}
        onSubmit={handleSubmitReport}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  chatArea: {
    flex: 1,
  },
  composerWrapper: {
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
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    paddingHorizontal: 16,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dateLabel: {
    fontSize: 12,
    color: C.textLight,
    marginHorizontal: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textLight,
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: C.textLight,
    opacity: 0.7,
  },
});
