import React, { useState, useCallback, useRef, useEffect } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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

import ChatHeader from '@/components/chatroom/ChatHeader';
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

  const room = DEMO_CHAT_ROOMS.find((r) => r.id === roomId);

  // Measured header height
  const [chatHeaderHeight, setChatHeaderHeight] = useState(0);
  const onChatHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setChatHeaderHeight(e.nativeEvent.layout.height);
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

  // ── Chat messages ──
  const messageListRef = useRef<ChatMessageListHandle>(null);
  const userSentRef = useRef<DemoChatMessage[]>([]);
  const [messages, setMessages] = useState<DemoChatMessage[]>(() => {
    const base = roomId ? getDemoMessagesForRoom(roomId) : [];
    // Append a "joined" system message for current user on entry
    const joinMsg: DemoChatMessage = {
      id: `sys_join_${DEMO_CURRENT_USER.id}_${Date.now()}`,
      roomId: roomId || '',
      senderId: 'system',
      senderName: 'System',
      type: 'system',
      text: `${DEMO_CURRENT_USER.username} joined the room`,
      createdAt: Date.now(),
    };
    return [...base, joinMsg];
  });
  const [inputText, setInputText] = useState('');

  // ── User state ──
  const [userCoins, setUserCoins] = useState(DEMO_CURRENT_USER.coins);

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
    const joinIds = messages
      .filter((m) => m.id.startsWith('sys_join_'))
      .map((m) => m.id);
    if (joinIds.length === 0) return;

    const timer = setTimeout(() => {
      setMessages((prev) => prev.filter((m) => !m.id.startsWith('sys_join_')));
    }, 60000);

    return () => clearTimeout(timer);
  }, []); // run once on mount

  // ── Mute room (persisted in AsyncStorage) ──
  const [isRoomMuted, setIsRoomMuted] = useState(false);
  useEffect(() => {
    if (!roomId) return;
    AsyncStorage.getItem(MUTE_STORAGE_KEY(roomId)).then((val) => {
      if (val === 'true') setIsRoomMuted(true);
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
    const baseMessages = roomId ? getDemoMessagesForRoom(roomId) : [];

    const baseIds = new Set(baseMessages.map((m) => m.id));
    const merged = [
      ...baseMessages,
      ...userSentRef.current.filter((m) => !baseIds.has(m.id)),
    ].sort((a, b) => a.createdAt - b.createdAt);

    setMessages(merged);

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
  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || !roomId) return;

    const newMessage: DemoChatMessage = {
      id: `cm_me_${Date.now()}`,
      roomId,
      senderId: DEMO_CURRENT_USER.id,
      senderName: DEMO_CURRENT_USER.username,
      type: 'text',
      text: trimmed,
      createdAt: Date.now(),
    };

    userSentRef.current = [...userSentRef.current, newMessage];
    setMessages((prev) => {
      const next = [...prev, newMessage];
      return next.length > 1000 ? next.slice(next.length - 1000) : next;
    });
    setInputText('');
    setUserCoins((prev) => prev + 1);
  }, [inputText, roomId]);

  const handlePanelChange = useCallback((_panel: ComposerPanel) => {}, []);

  // ────────────────────────────────────────────
  // SEND MEDIA (image / video / doodle)
  // ────────────────────────────────────────────
  const handleSendMedia = useCallback(
    (uri: string, mediaType: 'image' | 'video') => {
      if (!roomId) return;
      const labelMap = { image: 'Photo', video: 'Video' };
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
      userSentRef.current = [...userSentRef.current, newMessage];
      setMessages((prev) => {
        const next = [...prev, newMessage];
        return next.length > 1000 ? next.slice(next.length - 1000) : next;
      });
      setUserCoins((prev) => prev + 1);
    },
    [roomId]
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
        <ChatHeader onMenuPress={() => router.back()} topInset={insets.top} />
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

  return (
    <View style={styles.container}>
      {/* Header with badge counters — measured via onLayout */}
      <View onLayout={onChatHeaderLayout}>
        <ChatHeader
          topInset={insets.top}
          onMenuPress={() => router.back()}
          onReloadPress={handleReload}
          onMessagesPress={() => setOverlay('messages')}
          onFriendRequestsPress={() => setOverlay('friendRequests')}
          onNotificationsPress={() => setOverlay('notifications')}
          onProfilePress={() => setOverlay('profile')}
          profileAvatar={DEMO_CURRENT_USER.avatar}
          unreadDMs={unreadDMs}
          pendingFriendRequests={friendRequests.length}
          unseenNotifications={unseenNotifications}
        />
      </View>

      {/* Active users strip */}
      <ActiveUsersStrip
        users={DEMO_ONLINE_USERS.map((u) => ({ id: u.id, avatar: u.avatar, isOnline: u.isOnline }))}
        theme="dark"
        onUserPress={(userId) => {
          const user = DEMO_ONLINE_USERS.find((u) => u.id === userId);
          if (user) handleOnlineUserPress(user);
        }}
        onMorePress={() => setOverlay('onlineUsers')}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={chatHeaderHeight}
      >
        {/* Messages */}
        <ChatMessageList
          ref={messageListRef}
          messages={messages}
          currentUserId={DEMO_CURRENT_USER.id}
          mutedUserIds={mutedUserIds}
          onMessageLongPress={handleMessageLongPress}
          onAvatarPress={handleAvatarPress}
          onMediaPress={handleMediaPress}
          contentPaddingBottom={0}
        />

        {/* Composer — pushed up by KAV */}
        <ChatComposer
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          onPlusPress={() => setOverlay('attachment')}
          onPanelChange={handlePanelChange}
        />
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
        isActive={DEMO_CURRENT_USER.isActive}
        coins={userCoins}
        onEditProfile={() => {
          router.push('/(main)/edit-profile' as any);
        }}
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
