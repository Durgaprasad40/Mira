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
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  DEMO_CHAT_ROOMS,
  DEMO_JOINED_ROOMS,
  DemoChatRoom,
} from '@/lib/demoData';

const C = INCOGNITO_COLORS;

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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleOpenRoom = useCallback(
    (roomId: string) => {
      if (!joinedRooms[roomId]) {
        setJoinedRooms((prev) => ({ ...prev, [roomId]: true }));
      }
      router.push({
        pathname: '/(main)/chat-room/[roomId]',
        params: { roomId },
      } as any);
    },
    [router, joinedRooms]
  );

  const renderRoom = useCallback(
    ({ item }: { item: DemoChatRoom }) => {
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
              size={18}
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

  const generalRooms = DEMO_CHAT_ROOMS.filter((r) => r.category === 'general');
  const languageRooms = DEMO_CHAT_ROOMS.filter((r) => r.category === 'language');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="chatbubbles" size={20} color={C.primary} />
        <Text style={styles.headerTitle}>Chat Rooms</Text>
      </View>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: C.text,
  },
  listContent: {
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    marginHorizontal: 10,
    marginBottom: 4,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
  },
  roomIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    marginBottom: 2,
  },
  roomName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  roomTime: {
    fontSize: 10,
    color: C.textLight,
  },
  roomPreview: {
    fontSize: 12,
    color: C.textLight,
    marginBottom: 3,
  },
  roomPreviewEmpty: {
    fontSize: 12,
    color: C.textLight,
    fontStyle: 'italic',
    marginBottom: 3,
  },
  roomMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  roomMembers: {
    fontSize: 10,
    color: C.textLight,
  },
});
