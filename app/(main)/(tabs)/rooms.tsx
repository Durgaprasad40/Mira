import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '@/lib/constants';
import { Avatar, Badge } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';

interface RoomCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  rooms: Room[];
}

interface Room {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  onlineCount: number;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount?: number;
}

const ROOM_CATEGORIES: RoomCategory[] = [
  {
    id: 'interests',
    name: 'By Interests',
    icon: 'star',
    color: COLORS.primary,
    rooms: [
      { id: '1', name: 'Coffee Lovers ☕', description: 'Discuss your favorite brews', memberCount: 234, onlineCount: 12 },
      { id: '2', name: 'Travel Enthusiasts ✈️', description: 'Share travel stories and tips', memberCount: 456, onlineCount: 28 },
      { id: '3', name: 'Fitness & Health 💪', description: 'Workout buddies and motivation', memberCount: 189, onlineCount: 15 },
    ],
  },
  {
    id: 'location',
    name: 'Nearby',
    icon: 'location',
    color: COLORS.secondary,
    rooms: [
      { id: '4', name: 'Mumbai Singles', description: 'Connect with people in Mumbai', memberCount: 1234, onlineCount: 89 },
      { id: '5', name: 'Delhi Social', description: 'Events and meetups in Delhi', memberCount: 987, onlineCount: 67 },
    ],
  },
  {
    id: 'events',
    name: 'Events',
    icon: 'calendar',
    color: COLORS.warning,
    rooms: [
      { id: '6', name: 'Weekend Plans', description: 'What are you doing this weekend?', memberCount: 567, onlineCount: 34 },
      { id: '7', name: 'Free Tonight', description: 'Looking for something to do?', memberCount: 234, onlineCount: 19 },
    ],
  },
  {
    id: 'premium',
    name: 'Premium Rooms',
    icon: 'diamond',
    color: COLORS.gold,
    rooms: [
      { id: '8', name: 'VIP Lounge', description: 'Exclusive premium members only', memberCount: 89, onlineCount: 12 },
    ],
  },
];

export default function RoomsScreen() {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const renderRoomItem = (room: Room, category: RoomCategory) => (
    <TouchableOpacity
      style={styles.roomCard}
      onPress={() => router.push(`/(main)/room/${room.id}`)}
    >
      <View style={[styles.roomIcon, { backgroundColor: category.color + '20' }]}>
        <Ionicons name="people" size={24} color={category.color} />
      </View>
      <View style={styles.roomInfo}>
        <View style={styles.roomHeader}>
          <Text style={styles.roomName}>{room.name}</Text>
          {room.unreadCount && room.unreadCount > 0 && (
            <Badge count={room.unreadCount} />
          )}
        </View>
        <Text style={styles.roomDescription} numberOfLines={1}>
          {room.description}
        </Text>
        <View style={styles.roomMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={14} color={COLORS.textLight} />
            <Text style={styles.metaText}>{room.memberCount} members</Text>
          </View>
          {room.onlineCount > 0 && (
            <View style={styles.metaItem}>
              <View style={styles.onlineDot} />
              <Text style={styles.metaText}>{room.onlineCount} online</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Rooms</Text>
        <Text style={styles.subtitle}>Join group conversations</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryScroll}
        contentContainerStyle={styles.categoryContainer}
      >
        {ROOM_CATEGORIES.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.categoryChip,
              selectedCategory === category.id && styles.categoryChipActive,
            ]}
            onPress={() =>
              setSelectedCategory(selectedCategory === category.id ? null : category.id)
            }
          >
            <Ionicons
              name={category.icon as any}
              size={20}
              color={selectedCategory === category.id ? COLORS.white : category.color}
            />
            <Text
              style={[
                styles.categoryText,
                selectedCategory === category.id && styles.categoryTextActive,
              ]}
            >
              {category.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={
          selectedCategory
            ? ROOM_CATEGORIES.find((c) => c.id === selectedCategory)?.rooms || []
            : ROOM_CATEGORIES.flatMap((cat) => cat.rooms)
        }
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const category = ROOM_CATEGORIES.find((c) =>
            c.rooms.some((r) => r.id === item.id)
          )!;
          return renderRoomItem(item, category);
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={64} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No rooms found</Text>
            <Text style={styles.emptySubtitle}>
              Try selecting a different category
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  categoryScroll: {
    maxHeight: 60,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  categoryContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  categoryChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  categoryTextActive: {
    color: COLORS.white,
  },
  listContent: {
    padding: 16,
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  roomIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  roomInfo: {
    flex: 1,
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  roomName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  roomDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  roomMeta: {
    flexDirection: 'row',
    gap: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.success,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
});
