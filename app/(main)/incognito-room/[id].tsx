import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  LayoutChangeEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DEMO_ROOM_MESSAGES, DEMO_ONLINE_USERS } from '@/lib/demoData';
import ActiveUsersStrip from '@/components/chatroom/ActiveUsersStrip';
import { usePrivateChatStore } from '@/stores/privateChatStore';
import { ReportModal } from '@/components/private/ReportModal';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';

interface RoomMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: number;
}

const ROOM_INFO: Record<string, { name: string; icon: string; color: string; memberCount: number; onlineCount: number }> = {
  room_1: { name: 'Late Night Talks', icon: 'moon', color: '#6C5CE7', memberCount: 128, onlineCount: 34 },
  room_2: { name: 'Mumbai Meetups', icon: 'location', color: '#E17055', memberCount: 256, onlineCount: 67 },
  room_3: { name: 'Book Club', icon: 'book', color: '#00B894', memberCount: 89, onlineCount: 12 },
  room_4: { name: 'Fitness Buddies', icon: 'fitness', color: '#FDCB6E', memberCount: 175, onlineCount: 45 },
  room_5: { name: 'Music Lovers', icon: 'musical-notes', color: '#E84393', memberCount: 312, onlineCount: 89 },
  room_6: { name: 'Travel Stories', icon: 'airplane', color: '#0984E3', memberCount: 198, onlineCount: 28 },
};

export default function RoomChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const flatListRef = useRef<FlatList>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const onComposerLayout = useCallback((e: LayoutChangeEvent) => {
    setComposerHeight(e.nativeEvent.layout.height);
  }, []);

  const blockUser = usePrivateChatStore((s) => s.blockUser);

  const room = id ? ROOM_INFO[id] : null;
  const [messages, setMessages] = useState<RoomMessage[]>(DEMO_ROOM_MESSAGES);
  const [text, setText] = useState('');
  const [reportVisible, setReportVisible] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);

  const handleSend = () => {
    if (!text.trim()) return;
    const newMsg: RoomMessage = {
      id: `rm_${Date.now()}`,
      senderId: 'me',
      senderName: 'You',
      content: text.trim(),
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, newMsg]);
    setText('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleLongPressMessage = (msg: RoomMessage) => {
    if (msg.senderId === 'me') return;
    setReportTarget({ id: msg.senderId, name: msg.senderName });
    setReportVisible(true);
  };

  const handleReport = (reason: string) => {
    console.log('Report submitted:', reason, 'for user:', reportTarget?.id);
    setReportVisible(false);
    setReportTarget(null);
  };

  const handleBlock = () => {
    if (!reportTarget) return;
    blockUser(reportTarget.id);
    setMessages((prev) => prev.filter((m) => m.senderId !== reportTarget.id));
    setReportVisible(false);
    setReportTarget(null);
  };

  if (!room) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerName}>Room not found</Text>
        </View>
      </View>
    );
  }

  const renderMessage = ({ item }: { item: RoomMessage }) => {
    const isOwn = item.senderId === 'me';
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onLongPress={() => handleLongPressMessage(item)}
        delayLongPress={400}
      >
        <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
          {!isOwn && (
            <View style={[styles.msgAvatarCircle, { backgroundColor: room.color + '30' }]}>
              <Text style={[styles.msgAvatarText, { color: room.color }]}>
                {item.senderName.charAt(0)}
              </Text>
            </View>
          )}
          <View style={styles.msgContent}>
            {!isOwn && <Text style={styles.msgSenderName}>{item.senderName}</Text>}
            <View style={[styles.msgBubble, isOwn ? styles.msgBubbleOwn : styles.msgBubbleOther]}>
              <Text style={[styles.msgText, isOwn && styles.msgTextOwn]}>{item.content}</Text>
            </View>
            <Text style={[styles.msgTime, isOwn && styles.msgTimeOwn]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={[styles.headerIcon, { backgroundColor: room.color + '20' }]}>
          <Ionicons name={room.icon as any} size={20} color={room.color} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{room.name}</Text>
          <View style={styles.headerMetaRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.headerMeta}>{room.onlineCount} online · {room.memberCount} members</Text>
          </View>
        </View>
      </View>

      {/* Active users */}
      <ActiveUsersStrip
        users={DEMO_ONLINE_USERS.map((u) => ({ id: u.id, avatar: u.avatar, isOnline: u.isOnline }))}
        theme="dark"
        onUserPress={(userId) => Alert.alert('User', userId)}
      />

      {/* Hint */}
      <View style={styles.hintBar}>
        <Ionicons name="information-circle-outline" size={14} color={C.textLight} />
        <Text style={styles.hintText}>Long-press a message to report or block</Text>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={{
          ...styles.messageList,
          flexGrow: 1,
          justifyContent: 'flex-end' as const,
          paddingBottom: composerHeight + keyboardHeight + 8,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      />

      {/* Input */}
      <View
        onLayout={onComposerLayout}
        style={[styles.inputBar, {
          paddingBottom: 8,
          marginBottom: keyboardHeight,
        }]}
      >
        <TextInput
          style={styles.textInput}
          placeholder={`Message ${room.name}...`}
          placeholderTextColor={C.textLight}
          value={text}
          onChangeText={setText}
          multiline
          scrollEnabled
          textAlignVertical="top"
          blurOnSubmit={false}
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendButton, !text.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!text.trim()}
        >
          <Ionicons name="send" size={20} color={text.trim() ? '#FFFFFF' : C.textLight} />
        </TouchableOpacity>
      </View>

      {/* Report/Block Modal */}
      {reportTarget && (
        <ReportModal
          visible={reportVisible}
          targetName={reportTarget.name}
          onClose={() => { setReportVisible(false); setReportTarget(null); }}
          onReport={handleReport}
          onBlock={handleBlock}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  backButton: { marginRight: 8 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
  },
  headerInfo: { flex: 1, marginLeft: 10 },
  headerName: { fontSize: 16, fontWeight: '600', color: C.text },
  headerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00B894' },
  headerMeta: { fontSize: 12, color: C.textLight },

  hintBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 6, backgroundColor: C.surface,
  },
  hintText: { fontSize: 11, color: C.textLight },

  messageList: { padding: 16, paddingBottom: 8 },

  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-start' },
  msgRowOwn: { flexDirection: 'row-reverse' },
  msgAvatarCircle: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    marginRight: 8,
  },
  msgAvatarText: { fontSize: 14, fontWeight: '700' },
  msgContent: { maxWidth: '75%' },
  msgSenderName: { fontSize: 11, fontWeight: '600', color: C.textLight, marginBottom: 2, marginLeft: 4 },
  msgBubble: { padding: 12, borderRadius: 16 },
  msgBubbleOwn: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: C.surface, borderBottomLeftRadius: 4 },
  msgText: { fontSize: 14, color: C.text, lineHeight: 20 },
  msgTextOwn: { color: '#FFFFFF' },
  msgTime: { fontSize: 10, color: C.textLight, marginTop: 4, marginLeft: 4 },
  msgTimeOwn: { textAlign: 'right', marginRight: 4 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: C.surface, gap: 8,
  },
  textInput: {
    flex: 1, backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14, color: C.text, maxHeight: 100,
  },
  sendButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: C.surface },
});
