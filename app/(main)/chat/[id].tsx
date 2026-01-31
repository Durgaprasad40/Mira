import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { MessageBubble, MessageInput, TypingIndicator } from '@/components/chat';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_MATCHES } from '@/lib/demoData';

const DEMO_MESSAGES: Record<string, Array<{ _id: string; content: string; type: string; senderId: string; createdAt: number; readAt?: number }>> = {
  match_1: [
    { _id: 'dm_1', content: 'Hey! How are you?', type: 'text', senderId: 'demo_profile_1', createdAt: Date.now() - 1000 * 60 * 30, readAt: Date.now() - 1000 * 60 * 28 },
    { _id: 'dm_2', content: "Hi Priya! I'm doing great, thanks for asking 😊", type: 'text', senderId: 'demo_user', createdAt: Date.now() - 1000 * 60 * 25 },
    { _id: 'dm_3', content: 'What are you up to this weekend?', type: 'text', senderId: 'demo_profile_1', createdAt: Date.now() - 1000 * 60 * 20 },
  ],
  match_2: [
    { _id: 'dm_4', content: 'You matched with Meera! Say hello 👋', type: 'text', senderId: 'system', createdAt: Date.now() - 1000 * 60 * 60 },
  ],
};

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userId } = useAuthStore();
  const flatListRef = useRef<FlatList>(null);

  const isDemo = isDemoMode || (conversationId?.startsWith('match_') ?? false);

  const demoMatch = isDemo ? DEMO_MATCHES.find((m) => m.id === conversationId) : null;

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

  const [demoMessageList, setDemoMessageList] = useState(
    DEMO_MESSAGES[conversationId || ''] || []
  );

  const messages = isDemo ? demoMessageList : convexMessages;

  const demoConversation = demoMatch
    ? {
        otherUser: {
          ...demoMatch.otherUser,
          lastActive: Date.now() - 1000 * 60 * 2,
        },
        isPreMatch: demoMatch.isPreMatch,
      }
    : null;

  const activeConversation = isDemo ? demoConversation : conversation;

  const sendMessage = useMutation(api.messages.sendMessage);
  const markAsRead = useMutation(api.messages.markAsRead);
  const sendPreMatchMessage = useMutation(api.messages.sendPreMatchMessage);

  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!isDemo && conversationId && userId) {
      markAsRead({ conversationId: conversationId as any, userId: userId as any });
    }
  }, [conversationId, userId, isDemo]);

  useEffect(() => {
    if (messages && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const handleSend = async (text: string, type: 'text' | 'template' = 'text') => {
    if (!userId || !activeConversation) return;

    if (isDemo) {
      const newMsg = {
        _id: `dm_${Date.now()}`,
        content: text,
        type: 'text',
        senderId: 'demo_user',
        createdAt: Date.now(),
      };
      setDemoMessageList((prev) => [...prev, newMsg]);
      return;
    }

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
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send message');
    } finally {
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
      // TODO: Upload image to Convex storage and get storageId
      Alert.alert('Coming Soon', 'Image upload will be available soon.');
    }
  };

  const handleSendDare = () => {
    router.push(`/(main)/dare/send?userId=${activeConversation?.otherUser.id}`);
  };

  if (!activeConversation) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
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

  const messagesRemaining = isDemo ? 10 : (currentUser?.messagesRemaining || 0);

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
          <Text style={styles.headerName}>{activeConversation.otherUser.name}</Text>
          <Text style={styles.headerStatus}>
            {activeConversation.otherUser.lastActive > Date.now() - 5 * 60 * 1000
              ? 'Active now'
              : 'Recently active'}
          </Text>
        </View>
        {activeConversation.otherUser.isVerified && (
          <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={messages || []}
        ListFooterComponent={
          <TypingIndicator conversationId={conversationId || ''} currentUserId={userId || ''} />
        }
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <MessageBubble
            message={{
              id: item._id,
              content: item.content,
              type: item.type,
              senderId: item.senderId,
              createdAt: item.createdAt,
              readAt: item.readAt,
            }}
            isOwn={item.senderId === userId}
            otherUserName={activeConversation.otherUser.name}
          />
        )}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <MessageInput
        onSend={handleSend}
        onSendImage={handleSendImage}
        onSendDare={activeConversation.isPreMatch ? handleSendDare : undefined}
        disabled={isSending}
        isPreMatch={activeConversation.isPreMatch}
        messagesRemaining={messagesRemaining}
        subscriptionTier={isDemo ? 'premium' : (currentUser?.subscriptionTier || 'free')}
        canSendCustom={canSendCustom}
        recipientName={activeConversation.otherUser.name}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  messagesList: {
    paddingVertical: 16,
  },
});
