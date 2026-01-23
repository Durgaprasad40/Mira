import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { Avatar } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: number;
  isOwn: boolean;
}

interface Member {
  id: string;
  name: string;
  photoUrl?: string;
  isOnline: boolean;
}

export default function RoomScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const flatListRef = useRef<FlatList>(null);

  // Mock data - replace with actual Convex queries
  const [messages] = useState<Message[]>([
    {
      id: '1',
      senderId: 'user1',
      senderName: 'Alex',
      content: 'Hey everyone! Anyone up for coffee this weekend?',
      createdAt: Date.now() - 3600000,
      isOwn: false,
    },
    {
      id: '2',
      senderId: 'user2',
      senderName: 'You',
      content: 'I\'m interested! Where are you thinking?',
      createdAt: Date.now() - 1800000,
      isOwn: true,
    },
  ]);

  const [members] = useState<Member[]>([
    { id: 'user1', name: 'Alex', isOnline: true },
    { id: 'user2', name: 'Sarah', isOnline: true },
    { id: 'user3', name: 'Mike', isOnline: false },
  ]);

  const handleSend = () => {
    if (!message.trim()) return;
    // TODO: Send message via Convex
    setMessage('');
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Coffee Lovers ☕</Text>
          <Text style={styles.headerSubtitle}>{members.length} members</Text>
        </View>
        <TouchableOpacity onPress={() => {}}>
          <Ionicons name="people" size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.messageContainer, item.isOwn && styles.ownMessage]}>
            {!item.isOwn && (
              <Avatar size={32} style={styles.messageAvatar} />
            )}
            <View style={[styles.messageBubble, item.isOwn && styles.ownBubble]}>
              {!item.isOwn && (
                <Text style={styles.senderName}>{item.senderName}</Text>
              )}
              <Text style={[styles.messageText, item.isOwn && styles.ownMessageText]}>
                {item.content}
              </Text>
              <Text style={[styles.messageTime, item.isOwn && styles.ownMessageTime]}>
                {formatTime(item.createdAt)}
              </Text>
            </View>
          </View>
        )}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor={COLORS.textLight}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendButton, !message.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!message.trim()}
        >
          <Ionicons name="send" size={20} color={COLORS.white} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  messagesList: {
    padding: 16,
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-end',
  },
  ownMessage: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    marginRight: 8,
  },
  messageBubble: {
    maxWidth: '75%',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 18,
    padding: 12,
    borderBottomLeftRadius: 4,
  },
  ownBubble: {
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 4,
  },
  messageText: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 20,
  },
  ownMessageText: {
    color: COLORS.white,
  },
  messageTime: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 4,
  },
  ownMessageTime: {
    color: COLORS.white,
    opacity: 0.8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
