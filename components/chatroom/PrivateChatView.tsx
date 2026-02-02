import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  DemoDM,
  DemoPrivateMessage,
  DEMO_PRIVATE_MESSAGES,
  DEMO_CURRENT_USER,
} from '@/lib/demoData';
import MediaMessage from '@/components/chat/MediaMessage';
import ChatComposer from './ChatComposer';
import AttachmentPopup from './AttachmentPopup';
import DoodleCanvas from './DoodleCanvas';
import VideoPlayerModal from './VideoPlayerModal';
import ImagePreviewModal from './ImagePreviewModal';

const C = INCOGNITO_COLORS;

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes < 10 ? `0${minutes}` : minutes;
  return `${h}:${m} ${ampm}`;
}

function getDemoPrivateMessages(dm: DemoDM): DemoPrivateMessage[] {
  if (DEMO_PRIVATE_MESSAGES[dm.id]?.length) {
    return DEMO_PRIVATE_MESSAGES[dm.id];
  }
  const now = Date.now();
  return [
    { id: `${dm.id}_1`, dmId: dm.id, senderId: dm.peerId, senderName: dm.peerName, text: 'Hey! Thanks for connecting.', createdAt: now - 1000 * 60 * 30 },
    { id: `${dm.id}_me1`, dmId: dm.id, senderId: DEMO_CURRENT_USER.id, senderName: 'You', text: 'Hi! Nice to meet you here.', createdAt: now - 1000 * 60 * 28 },
    { id: `${dm.id}_2`, dmId: dm.id, senderId: dm.peerId, senderName: dm.peerName, text: 'So what do you do?', createdAt: now - 1000 * 60 * 22 },
    { id: `${dm.id}_me2`, dmId: dm.id, senderId: DEMO_CURRENT_USER.id, senderName: 'You', text: 'I work in tech. How about you?', createdAt: now - 1000 * 60 * 18 },
    { id: `${dm.id}_3`, dmId: dm.id, senderId: dm.peerId, senderName: dm.peerName, text: 'Same here! I am a designer. What a coincidence.', createdAt: now - 1000 * 60 * 12 },
    { id: `${dm.id}_me3`, dmId: dm.id, senderId: DEMO_CURRENT_USER.id, senderName: 'You', text: 'That is cool! We should chat more.', createdAt: now - 1000 * 60 * 8 },
    { id: `${dm.id}_4`, dmId: dm.id, senderId: dm.peerId, senderName: dm.peerName, text: 'Definitely! What are you up to this weekend?', createdAt: now - 1000 * 60 * 3 },
  ];
}

interface PrivateChatViewProps {
  dm: DemoDM;
  onBack: () => void;
  topInset?: number;
}

export default function PrivateChatView({ dm, onBack, topInset = 0 }: PrivateChatViewProps) {
  const flatListRef = useRef<FlatList>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [messages, setMessages] = useState<DemoPrivateMessage[]>(
    () => getDemoPrivateMessages(dm)
  );
  const [inputText, setInputText] = useState('');
  const [attachmentVisible, setAttachmentVisible] = useState(false);
  const [doodleVisible, setDoodleVisible] = useState(false);
  const [videoPlayerUri, setVideoPlayerUri] = useState('');
  const [imagePreviewUri, setImagePreviewUri] = useState('');

  const isNearBottomRef = useRef(true);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 100);
    }
  }, []);

  // Scroll to end when keyboard opens (WhatsApp behavior)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      }
    });
    return () => sub.remove();
  }, []);

  const handleContentSizeChange = useCallback(() => {
    if (isNearBottomRef.current) {
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, []);

  const handleScroll = useCallback((e: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const newMsg: DemoPrivateMessage = {
      id: `pm_me_${Date.now()}`,
      dmId: dm.id,
      senderId: DEMO_CURRENT_USER.id,
      senderName: 'You',
      text: trimmed,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputText('');
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }, [inputText, dm.id]);

  const handleSendMedia = useCallback(
    (uri: string, mediaType: 'image' | 'video') => {
      const labelMap = { image: 'Photo', video: 'Video' };
      const newMsg: DemoPrivateMessage = {
        id: `pm_me_${Date.now()}`,
        dmId: dm.id,
        senderId: DEMO_CURRENT_USER.id,
        senderName: 'You',
        text: `[${labelMap[mediaType]}]`,
        type: mediaType,
        mediaUrl: uri,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, newMsg]);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    },
    [dm.id]
  );


  const handleMediaPress = useCallback((mediaUrl: string, type: 'image' | 'video') => {
    if (type === 'video') {
      setVideoPlayerUri(mediaUrl);
    } else {
      setImagePreviewUri(mediaUrl);
    }
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: DemoPrivateMessage }) => {
      const isMe = item.senderId === DEMO_CURRENT_USER.id;
      const isMedia = (item.type === 'image' || item.type === 'video') && item.mediaUrl;

      if (isMe) {
        return (
          <View style={styles.rowMe}>
            <View style={styles.bubbleMe}>
              {isMedia ? (
                <MediaMessage
                  mediaUrl={item.mediaUrl!}
                  type={item.type as 'image' | 'video'}
                  onPress={() => handleMediaPress(item.mediaUrl!, item.type as 'image' | 'video')}
                />
              ) : (
                <Text style={styles.bubbleMeText}>{item.text}</Text>
              )}
              <Text style={styles.timeMe}>{formatTime(item.createdAt)}</Text>
            </View>
          </View>
        );
      }

      return (
        <View style={styles.rowOther}>
          {dm.peerAvatar ? (
            <Image source={{ uri: dm.peerAvatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={12} color={C.textLight} />
            </View>
          )}
          <View style={styles.bubbleOther}>
            {isMedia ? (
              <MediaBubble
                mediaUrl={item.mediaUrl!}
                messageType={item.type as 'image' | 'video'}
                onPress={() => handleMediaPress(item.mediaUrl!, item.type as 'image' | 'video')}
              />
            ) : (
              <Text style={styles.bubbleOtherText}>{item.text}</Text>
            )}
            <Text style={styles.timeOther}>{formatTime(item.createdAt)}</Text>
          </View>
        </View>
      );
    },
    [dm.peerAvatar, handleMediaPress]
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={[styles.header, topInset > 0 && { paddingTop: topInset + 8 }]}
      >
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        {dm.peerAvatar ? (
          <Image source={{ uri: dm.peerAvatar }} style={styles.headerAvatar} />
        ) : (
          <View style={styles.headerAvatarPlaceholder}>
            <Ionicons name="person" size={16} color={C.textLight} />
          </View>
        )}
        <Text style={styles.headerName}>{dm.peerName}</Text>
        <View style={{ flex: 1 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'flex-end' as const,
            paddingTop: 6,
            paddingBottom: 0,
          }}
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubble-outline" size={40} color={C.textLight} />
              <Text style={styles.emptyText}>Start a conversation</Text>
            </View>
          }
        />

        {/* Composer — pushed up by KAV */}
        <ChatComposer
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          onPlusPress={() => setAttachmentVisible(true)}
        />
      </KeyboardAvoidingView>

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
      <DoodleCanvas
        visible={doodleVisible}
        onClose={() => setDoodleVisible(false)}
        onSend={(uri) => handleSendMedia(uri, 'image')}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
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
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  headerAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  // ── Other user: left-aligned ──
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
  timeOther: {
    fontSize: 10,
    color: C.textLight,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  // ── My messages: right-aligned ──
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
  timeMe: {
    fontSize: 10,
    color: C.textLight,
    marginTop: 4,
    alignSelf: 'flex-end',
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
