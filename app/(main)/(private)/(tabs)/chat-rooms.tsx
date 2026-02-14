import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  ImageSourcePropType,
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
  DemoChatRoom,
} from '@/lib/demoData';

const C = INCOGNITO_COLORS;

// ─────────────────────────────────────────────────────────────────────────────
// ROOM ICONS - Local image assets for each room
// Add images to: assets/chatrooms/ (PNG, ~256x256, square)
// ─────────────────────────────────────────────────────────────────────────────
// Recommended images per room:
//   global.png    -> Globe/world icon
//   india.png     -> India map outline or tricolor themed
//   hindi.png     -> Taj Mahal silhouette
//   telugu.png    -> Charminar silhouette
//   tamil.png     -> Meenakshi Temple or Tamil temple
//   malayalam.png -> Kerala backwaters / houseboat
//   bengali.png   -> Howrah Bridge or Victoria Memorial
//   kannada.png   -> Vidhana Soudha or Karnataka emblem
//   marathi.png   -> Gateway of India
//   gujarati.png  -> Somnath Temple or Rann of Kutch
//   punjabi.png   -> Golden Temple
//   urdu.png      -> Calligraphy or crescent moon
// ─────────────────────────────────────────────────────────────────────────────

// Local asset mapping - require() for bundled images
// Uncomment each line after adding the corresponding image file
const ROOM_ICON_ASSETS: Record<string, ImageSourcePropType | null> = {
  // global: require('@/assets/chatrooms/global.png'),
  // india: require('@/assets/chatrooms/india.png'),
  // hindi: require('@/assets/chatrooms/hindi.png'),
  // telugu: require('@/assets/chatrooms/telugu.png'),
  // tamil: require('@/assets/chatrooms/tamil.png'),
  // malayalam: require('@/assets/chatrooms/malayalam.png'),
  // bengali: require('@/assets/chatrooms/bengali.png'),
  // kannada: require('@/assets/chatrooms/kannada.png'),
  // marathi: require('@/assets/chatrooms/marathi.png'),
  // gujarati: require('@/assets/chatrooms/gujarati.png'),
  // punjabi: require('@/assets/chatrooms/punjabi.png'),
  // urdu: require('@/assets/chatrooms/urdu.png'),

  // Fallback: null means use Ionicons fallback
  global: null,
  india: null,
  hindi: null,
  telugu: null,
  tamil: null,
  malayalam: null,
  bengali: null,
  kannada: null,
  marathi: null,
  gujarati: null,
  punjabi: null,
  urdu: null,
};

// Fallback colors for when images are not available
const ROOM_FALLBACK_COLORS: Record<string, string> = {
  global: '#4A90D9',
  india: '#FF9933',
  hindi: '#E94560',
  telugu: '#9C27B0',
  tamil: '#2196F3',
  malayalam: '#4CAF50',
  kannada: '#FF5722',
  marathi: '#795548',
  bengali: '#009688',
  gujarati: '#FFC107',
  punjabi: '#3F51B5',
  urdu: '#607D8B',
};

// Unified room type for both demo and Convex modes
interface ChatRoom {
  id: string;
  name: string;
  slug: string;
  category: 'language' | 'general';
  memberCount: number;
  lastMessageText?: string;
  // Icon support (admin-set, optional)
  iconKey?: string;   // Maps to ROOM_ICON_CONFIG or local asset
  iconUrl?: string;   // Remote image URL (takes priority over iconKey)
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
  // Filter out "English" room - users can chat in English inside Global
  const rooms: ChatRoom[] = (isDemoMode
    ? DEMO_CHAT_ROOMS.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        category: r.category,
        memberCount: r.memberCount,
        lastMessageText: r.lastMessageText,
        iconKey: r.slug, // Use slug as iconKey for demo rooms
      }))
    : (convexRooms ?? []).map((r) => ({
        id: r._id,
        name: r.name,
        slug: r.slug,
        category: r.category,
        memberCount: r.memberCount,
        lastMessageText: r.lastMessageText,
        iconKey: r.slug, // Use slug as iconKey fallback
        // iconUrl: r.iconUrl, // Enable when schema supports it
      }))
  ).filter((r) => r.name.toLowerCase() !== 'english');

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
      // Get icon key for this room (by slug/iconKey)
      const iconKey = item.iconKey ?? item.slug;
      const localAsset = ROOM_ICON_ASSETS[iconKey];
      const fallbackColor = ROOM_FALLBACK_COLORS[iconKey];

      // Render room icon
      const renderRoomIcon = () => {
        // Priority 1: Remote URL (admin-set)
        if (item.iconUrl) {
          return (
            <Image
              source={{ uri: item.iconUrl }}
              style={styles.roomIconImage}
              resizeMode="cover"
            />
          );
        }

        // Priority 2: Local asset image (when available)
        if (localAsset) {
          return (
            <Image
              source={localAsset}
              style={styles.roomIconImage}
              resizeMode="cover"
            />
          );
        }

        // Fallback: Colored circle with icon based on category
        const isGeneral = item.category === 'general';
        const bgColor = fallbackColor ? fallbackColor + '20' : (isGeneral ? 'rgba(100,181,246,0.12)' : 'rgba(233,69,96,0.12)');
        const iconColor = fallbackColor ?? (isGeneral ? '#64B5F6' : C.primary);

        return (
          <View style={[styles.roomIcon, { backgroundColor: bgColor }]}>
            <Ionicons
              name={isGeneral ? 'globe' : 'language'}
              size={22}
              color={iconColor}
            />
          </View>
        );
      };

      return (
        <TouchableOpacity
          style={styles.roomCard}
          onPress={() => handleOpenRoom(item.id)}
          activeOpacity={0.7}
        >
          {renderRoomIcon()}

          <View style={styles.roomInfo}>
            <Text style={styles.roomName}>{item.name}</Text>
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Simple heading - NO icons on HOME screen */}
      <View style={styles.header}>
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
        ListFooterComponent={
          <View style={styles.footerSection}>
            {/* Add a Room button */}
            <TouchableOpacity
              style={styles.addRoomButton}
              onPress={handleCreateRoom}
              activeOpacity={0.7}
            >
              <View style={styles.addRoomIcon}>
                <Ionicons name="add" size={24} color={C.primary} />
              </View>
              <Text style={styles.addRoomText}>Add a Room</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textLight} />
            </TouchableOpacity>
            {/* TODO (Phase later): Require coins/tokens to create a room. */}
          </View>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
  },
  listContent: {
    paddingBottom: 24,
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
  roomIconImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  roomInfo: {
    flex: 1,
  },
  roomName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 4,
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
  footerSection: {
    paddingTop: 16,
    paddingHorizontal: 12,
  },
  addRoomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: C.accent,
    borderStyle: 'dashed',
  },
  addRoomIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(233,69,96,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRoomText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: C.primary,
  },
});
