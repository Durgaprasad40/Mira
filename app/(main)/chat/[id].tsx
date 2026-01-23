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
import { MessageBubble, MessageInput, TypingIndicatorComponent } from '@/components/chat';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { userId } = useAuthStore();
  const flatListRef = useRef<FlatList>(null);

  const conversation = useQuery(
    api.messages.getConversation,
    conversationId && userId ? { conversationId: conversationId as any, userId: userId as any } : 'skip'
  );

  const messages = useQuery(
    api.messages.getMessages,
    conversationId ? { conversationId: conversationId as any, userId: userId as any } : 'skip'
  );

  const currentUser = useQuery(
    api.users.getCurrentUser,
    userId ? { userId: userId as any } : 'skip'
  );

  const sendMessage = useMutation(api.messages.sendMessage);
  const markAsRead = useMutation(api.messages.markAsRead);
  const sendPreMatchMessage = useMutation(api.messages.sendPreMatchMessage);

  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (conversationId && userId) {
      markAsRead({ conversationId: conversationId as any, userId: userId as any });
    }
  }, [conversationId, userId]);

  useEffect(() => {
    if (messages && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const handleSend = async (text: string, type: 'text' | 'template' = 'text') => {
    if (!userId || !conversation) return;

    setIsSending(true);
    try {
      if (conversation.isPreMatch) {
        await sendPreMatchMessage({
          fromUserId: userId as any,
          toUserId: conversation.otherUser.id as any,
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
    if (!userId || !conversation) return;

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please allow access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      // TODO: Upload image to Convex storage and get storageId
      Alert.alert('Coming Soon', 'Image upload will be available soon.');
    }
  };

  const handleSendDare = () => {
    router.push(`/(main)/dare/send?userId=${conversation?.otherUser.id}`);
  };

  if (!conversation || !currentUser) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const canSendCustom =
    currentUser.gender === 'female' ||
    currentUser.subscriptionTier === 'premium' ||
    (!conversation.isPreMatch && currentUser.subscriptionTier !== 'free');

  const messagesRemaining = currentUser.messagesRemaining || 0;

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
          <Text style={styles.headerName}>{conversation.otherUser.name}</Text>
          <Text style={styles.headerStatus}>
            {conversation.otherUser.lastActive > Date.now() - 5 * 60 * 1000
              ? 'Active now'
              : 'Recently active'}
          </Text>
        </View>
        {conversation.otherUser.isVerified && (
          <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={messages || []}
        ListFooterComponent={
          <TypingIndicatorComponent conversationId={id} currentUserId={userId || ''} />
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
            otherUserName={conversation.otherUser.name}
          />
        )}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <MessageInput
        onSend={handleSend}
        onSendImage={handleSendImage}
        onSendDare={conversation.isPreMatch ? handleSendDare : undefined}
        disabled={isSending}
        isPreMatch={conversation.isPreMatch}
        messagesRemaining={messagesRemaining}
        subscriptionTier={currentUser.subscriptionTier}
        canSendCustom={canSendCustom}
        recipientName={conversation.otherUser.name}
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
