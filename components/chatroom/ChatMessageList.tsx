import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoChatMessage } from '@/lib/demoData';
import ChatMessageItem from './ChatMessageItem';
import SystemMessageItem from './SystemMessageItem';

const C = INCOGNITO_COLORS;

// ── Date separator helpers ──
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
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Build display items with date separators ──
type ListItem =
  | { type: 'date'; id: string; label: string }
  | { type: 'message'; id: string; message: DemoChatMessage };

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

interface ChatMessageListProps {
  messages: DemoChatMessage[];
  currentUserId?: string;
  mutedUserIds?: Set<string>;
  onMessageLongPress?: (message: DemoChatMessage) => void;
  onAvatarPress?: (senderId: string) => void;
  onMediaHoldStart?: (messageId: string, mediaUrl: string, type: 'image' | 'video') => void;
  onMediaHoldEnd?: () => void;
  /** Extra bottom padding on the list content (e.g. composerHeight + safeArea) */
  contentPaddingBottom?: number;
}

export interface ChatMessageListHandle {
  scrollToEnd: (animated?: boolean) => void;
}

const ChatMessageList = forwardRef<ChatMessageListHandle, ChatMessageListProps>(function ChatMessageList({
  messages,
  currentUserId,
  mutedUserIds,
  onMessageLongPress,
  onAvatarPress,
  onMediaHoldStart,
  onMediaHoldEnd,
  contentPaddingBottom = 0,
}, ref) {
  const listRef = useRef<FlashListRef<ListItem>>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const prevLengthRef = useRef(messages.length);
  const initialScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newMessageScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    scrollToEnd: (animated = true) => {
      listRef.current?.scrollToEnd({ animated });
    },
  }));

  const handleScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - layoutMeasurement.height - contentOffset.y;
    const atBottom = distanceFromBottom < 80;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setNewMessageCount(0);
    }
  }, []);

  // Initial scroll to bottom with cleanup
  useEffect(() => {
    if (messages.length > 0) {
      initialScrollTimeoutRef.current = setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: false });
      }, 150);
    }
    return () => {
      if (initialScrollTimeoutRef.current) {
        clearTimeout(initialScrollTimeoutRef.current);
        initialScrollTimeoutRef.current = null;
      }
    };
  }, []);

  // Handle new messages with cleanup
  useEffect(() => {
    const diff = messages.length - prevLengthRef.current;
    if (diff > 0 && !isAtBottom) {
      setNewMessageCount((prev) => prev + diff);
    }
    if (diff > 0 && isAtBottom) {
      newMessageScrollTimeoutRef.current = setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
    prevLengthRef.current = messages.length;
    return () => {
      if (newMessageScrollTimeoutRef.current) {
        clearTimeout(newMessageScrollTimeoutRef.current);
        newMessageScrollTimeoutRef.current = null;
      }
    };
  }, [messages.length, isAtBottom]);

  const handleJumpToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setNewMessageCount(0);
  }, []);

  // M2: Memoize listItems computation
  const listItems = useMemo(() => buildListItems(messages), [messages]);

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

      const isMuted = mutedUserIds?.has(msg.senderId) ?? false;
      const isMe = currentUserId ? msg.senderId === currentUserId : false;

      return (
        <ChatMessageItem
          senderName={msg.senderName}
          messageId={msg.id}
          senderId={msg.senderId}
          senderAvatar={msg.senderAvatar}
          text={msg.text || ''}
          timestamp={msg.createdAt}
          isMe={isMe}
          dimmed={isMuted}
          messageType={(msg.type || 'text') as 'text' | 'image' | 'video' | 'doodle'}
          mediaUrl={msg.mediaUrl}
          onLongPress={() => onMessageLongPress?.(msg)}
          onAvatarPress={() => onAvatarPress?.(msg.senderId)}
          onNamePress={() => onAvatarPress?.(msg.senderId)}
          onMediaHoldStart={onMediaHoldStart}
          onMediaHoldEnd={onMediaHoldEnd}
        />
      );
    },
    [currentUserId, mutedUserIds, onMessageLongPress, onAvatarPress, onMediaHoldStart, onMediaHoldEnd]
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  if (messages.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="chatbubble-outline" size={40} color={C.textLight} />
        <Text style={styles.emptyText}>No messages yet</Text>
        <Text style={styles.emptySubtext}>Be the first to say something!</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlashList
        ref={listRef}
        data={listItems}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'flex-end' as const,
          paddingTop: 8,
          paddingBottom: contentPaddingBottom,
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      />

      {!isAtBottom && (
        <TouchableOpacity style={styles.jumpButton} onPress={handleJumpToBottom}>
          <Ionicons name="arrow-down" size={14} color="#FFFFFF" />
          {newMessageCount > 0 && (
            <Text style={styles.jumpText}>{newMessageCount} new</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
});

export default ChatMessageList;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textLight,
  },
  emptySubtext: {
    fontSize: 12,
    color: C.textLight,
  },
  // Date separators
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  dateLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.accent,
  },
  dateLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Jump to bottom
  jumpButton: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  jumpText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
