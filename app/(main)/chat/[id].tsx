import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { MessageBubble, MessageInput } from '@/components/chat';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { isDemoMode } from '@/hooks/useConvex';
import { DEMO_MATCHES } from '@/lib/demoData';
import { useDemoDmStore, DemoDmMessage } from '@/stores/demoDmStore';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';

/** Seed data — used only the very first time a conversation is opened. */
const DEMO_SEED_MESSAGES: Record<string, DemoDmMessage[]> = {
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
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { userId } = useAuthStore();
  const flatListRef = useRef<FlashList<any>>(null);

  // Measured header height — used as keyboardVerticalOffset so KAV
  // adjusts correctly regardless of device notch / status-bar height.
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setHeaderHeight(e.nativeEvent.layout.height);
  }, []);

  // Measured composer height — used as paddingBottom on the message list
  // so the last message is always visible above the composer.
  const [composerHeight, setComposerHeight] = useState(0);
  const onComposerLayout = useCallback((e: LayoutChangeEvent) => {
    setComposerHeight(e.nativeEvent.layout.height);
  }, []);

  // Track whether the user is scrolled near the bottom so we only
  // auto-scroll on new messages when they are already reading the latest.
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  const isDemo = isDemoMode || (conversationId?.startsWith('match_') ?? false);

  const demoMatch = isDemo ? DEMO_MATCHES.find((m) => m.id === conversationId) : null;

  // ── Demo DM store — messages survive navigation & restarts ──
  const seedConversation = useDemoDmStore((s) => s.seedConversation);
  const addDemoMessage = useDemoDmStore((s) => s.addMessage);
  const demoConversations = useDemoDmStore((s) => s.conversations);

  // Seed once per conversation (no-op if already seeded)
  useEffect(() => {
    if (isDemo && conversationId) {
      seedConversation(conversationId, DEMO_SEED_MESSAGES[conversationId] || []);
    }
  }, [isDemo, conversationId, seedConversation]);

  const demoMessageList = conversationId ? demoConversations[conversationId] ?? [] : [];

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

  // Auto-scroll only when new messages arrive AND user is near the bottom.
  // This prevents yanking the user back to the bottom when they are reading
  // older messages.
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (count > prevMessageCountRef.current && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
    }
    prevMessageCountRef.current = count;
  }, [messages?.length]);

  const handleSend = async (text: string, type: 'text' | 'template' = 'text') => {
    if (!userId || !activeConversation) return;

    if (isDemo) {
      addDemoMessage(conversationId!, {
        _id: `dm_${Date.now()}`,
        content: text,
        type: 'text',
        senderId: 'demo_user',
        createdAt: Date.now(),
      });
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
    <View style={styles.container}>
      {/* Header — uses onLayout to measure its real pixel height */}
      <View onLayout={onHeaderLayout} style={[styles.header, { paddingTop: insets.top }]}>
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

      <FlashList
        ref={flatListRef}
        data={messages || []}
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
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'flex-end' as const,
          paddingTop: 8,
          paddingBottom: composerHeight + keyboardHeight + insets.bottom + 8,
        }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        estimatedItemSize={60}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      />

      {/* Composer — lifted above keyboard via marginBottom */}
      <View
        onLayout={onComposerLayout}
        style={{
          paddingBottom: insets.bottom,
          marginBottom: keyboardHeight,
        }}
      >
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
      </View>
    </View>
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
    // paddingTop is set dynamically via insets.top in the JSX
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
});
