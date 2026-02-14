import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import {
  DEMO_CHAT_ROOMS,
  DEMO_JOINED_ROOMS,
  DEMO_CURRENT_USER,
  DemoChatRoom,
} from '@/lib/demoData';
import ChatRoomsHeader from '@/components/chatroom/ChatRoomsHeader';

const C = INCOGNITO_COLORS;

// Unified room type for both demo and Convex modes
interface ChatRoom {
  id: string;
  name: string;
  slug: string;
  category: 'language' | 'general';
  memberCount: number;
  lastMessageAt?: number;
  lastMessageText?: string;
}

function getTimeAgo(timestamp?: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function ChatRoomsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [joinedRooms, setJoinedRooms] = useState(DEMO_JOINED_ROOMS);

  // Convex query for live mode (skipped in demo mode)
  const convexRooms = useQuery(
    api.chatRooms.listRooms,
    isDemoMode ? 'skip' : {}
  );

  // Unified rooms list: demo or Convex
  const rooms: ChatRoom[] = isDemoMode
    ? DEMO_CHAT_ROOMS
    : (convexRooms ?? []).map((r) => ({
        id: r._id,
        name: r.name,
        slug: r.slug,
        category: r.category,
        memberCount: r.memberCount,
        lastMessageAt: r.lastMessageAt,
        lastMessageText: r.lastMessageText,
      }));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // In live mode, Convex auto-refreshes. For demo mode, simulate delay.
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleOpenRoom = useCallback(
    (roomId: string) => {
      if (isDemoMode && !joinedRooms[roomId]) {
        setJoinedRooms((prev) => ({ ...prev, [roomId]: true }));
      }
      router.push({
        pathname: '/(main)/chat-room/[roomId]',
        params: { roomId },
      } as any);
    },
    [router, joinedRooms]
  );

  const handleCreateRoom = useCallback(() => {
    router.push('/(main)/create-room' as any);
  }, [router]);

  const renderRoom = useCallback(
    ({ item }: { item: ChatRoom }) => {
      const isGeneral = item.category === 'general';

      return (
        <TouchableOpacity
          style={styles.roomCard}
          onPress={() => handleOpenRoom(item.id)}
          activeOpacity={0.7}
        >
          <View style={[styles.roomIcon, isGeneral && styles.roomIconGeneral]}>
            <Ionicons
              name={isGeneral ? 'globe' : 'language'}
              size={22}
              color={isGeneral ? '#64B5F6' : C.primary}
            />
          </View>

          <View style={styles.roomInfo}>
            <View style={styles.roomNameRow}>
              <Text style={styles.roomName}>{item.name}</Text>
              {item.lastMessageAt && (
                <Text style={styles.roomTime}>{getTimeAgo(item.lastMessageAt)}</Text>
              )}
            </View>
            {item.lastMessageText ? (
              <Text style={styles.roomPreview} numberOfLines={1}>
                {item.lastMessageText}
              </Text>
            ) : (
              <Text style={styles.roomPreviewEmpty}>No messages yet</Text>
            )}
            <View style={styles.roomMeta}>
              <Ionicons name="people" size={11} color={C.textLight} />
              <Text style={styles.roomMembers}>{item.memberCount}</Text>
            </View>
          </View>

          <Ionicons name="chevron-forward" size={16} color={C.textLight} />
        </TouchableOpacity>
      );
    },
    [handleOpenRoom]
  );

  const generalRooms = rooms.filter((r) => r.category === 'general');
  const languageRooms = rooms.filter((r) => r.category === 'language');

  return (
    <View style={styles.container}>
      {/* Purple/Blue Header Bar */}
      <ChatRoomsHeader
        title="Chat Rooms"
        topInset={insets.top}
        onMenuPress={() => {
          // Menu placeholder - could open drawer if exists
        }}
        onRefreshPress={onRefresh}
        onInboxPress={() => {
          // Inbox placeholder
        }}
        onNotificationsPress={() => {
          // Notifications placeholder
        }}
        onProfilePress={() => {
          router.push('/(main)/edit-profile' as any);
        }}
        profileAvatar={DEMO_CURRENT_USER.avatar}
        showCreateButton
        onCreatePress={handleCreateRoom}
      />

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <>
            <Text style={styles.sectionTitle}>General</Text>
            {generalRooms.map((room) => (
              <React.Fragment key={room.id}>
                {renderRoom({ item: room })}
              </React.Fragment>
            ))}

            <Text style={styles.sectionTitle}>Languages</Text>
            {languageRooms.map((room) => (
              <React.Fragment key={room.id}>
                {renderRoom({ item: room })}
              </React.Fragment>
            ))}
          </>
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  listContent: {
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  roomIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(233,69,96,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomIconGeneral: {
    backgroundColor: 'rgba(100,181,246,0.12)',
  },
  roomInfo: {
    flex: 1,
  },
  roomNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  roomName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  roomTime: {
    fontSize: 12,
    color: C.textLight,
  },
  roomPreview: {
    fontSize: 14,
    color: C.textLight,
    marginBottom: 4,
  },
  roomPreviewEmpty: {
    fontSize: 14,
    color: C.textLight,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  roomMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  roomMembers: {
    fontSize: 12,
    color: C.textLight,
  },
});
