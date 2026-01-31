import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { textForPublicSurface } from '@/lib/contentFilter';
import type { IncognitoChatRoom } from '@/types';

const C = INCOGNITO_COLORS;

const DEMO_CHAT_ROOMS: IncognitoChatRoom[] = [
  { id: 'room_1', name: 'Flirty Chats', language: 'English', memberCount: 128, onlineCount: 34, latestMessage: 'What is your best opening line?', icon: 'chatbubble-ellipses', color: '#6C5CE7' },
  { id: 'room_2', name: 'Boundaries Talk', language: 'English', memberCount: 96, onlineCount: 21, latestMessage: 'How do you set expectations early?', icon: 'shield-checkmark', color: '#00B894' },
  { id: 'room_3', name: 'Discreet Dating', language: 'English', memberCount: 205, onlineCount: 52, latestMessage: 'Best low-key date spots?', icon: 'eye-off', color: '#E17055' },
  { id: 'room_4', name: 'Late Night Talks', language: 'English', memberCount: 128, onlineCount: 34, latestMessage: 'Anyone still awake?', icon: 'moon', color: '#7C4DFF' },
  { id: 'room_5', name: 'Music Lovers', language: 'English', memberCount: 312, onlineCount: 89, latestMessage: 'New Prateek Kuhad drop!', icon: 'musical-notes', color: '#E84393' },
  { id: 'room_6', name: 'Travel Stories', language: 'English', memberCount: 198, onlineCount: 28, latestMessage: 'Goa tips for first timers?', icon: 'airplane', color: '#0984E3' },
];

export default function RoomsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Ionicons name="chatbubbles" size={24} color={C.primary} />
        <Text style={styles.headerTitle}>Rooms</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContent}>
        <View style={styles.adminNotice}>
          <Ionicons name="shield-checkmark" size={14} color={C.textLight} />
          <Text style={styles.adminNoticeText}>All rooms are moderated. No user-created rooms in this version.</Text>
        </View>
        {DEMO_CHAT_ROOMS.map((room) => (
          <View key={room.id} style={styles.roomCard}>
            <TouchableOpacity
              style={styles.roomCardInner}
              onPress={() => router.push(`/(main)/incognito-room/${room.id}` as any)}
              activeOpacity={0.8}
            >
              <View style={[styles.roomIcon, { backgroundColor: room.color + '20' }]}>
                <Ionicons name={room.icon as any} size={24} color={room.color} />
              </View>
              <View style={styles.roomInfo}>
                <Text style={styles.roomName}>{room.name}</Text>
                <Text style={styles.roomLatest} numberOfLines={1}>{textForPublicSurface(room.latestMessage ?? '')}</Text>
              </View>
              <View style={styles.roomMeta}>
                <View style={styles.roomOnline}>
                  <View style={styles.onlineIndicator} />
                  <Text style={styles.roomOnlineText}>{room.onlineCount}</Text>
                </View>
                <Text style={styles.roomMembers}>{room.memberCount} members</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.roomReportBtn}
              onPress={() => Alert.alert(
                'Report Room',
                'Report this room for inappropriate content?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Report', style: 'destructive', onPress: () => Alert.alert('Reported', 'This room has been reported for review.') },
                ],
              )}
            >
              <Ionicons name="flag-outline" size={14} color={C.textLight} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text, flex: 1, marginLeft: 10 },
  listContent: { padding: 16 },
  adminNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12,
    backgroundColor: C.surface, borderRadius: 8,
  },
  adminNoticeText: { fontSize: 11, color: C.textLight, flex: 1 },
  roomCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12, marginBottom: 10,
  },
  roomCardInner: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 14 },
  roomReportBtn: { paddingHorizontal: 12, paddingVertical: 14 },
  roomIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  roomInfo: { flex: 1, marginLeft: 12 },
  roomName: { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 2 },
  roomLatest: { fontSize: 12, color: C.textLight },
  roomMeta: { alignItems: 'flex-end' },
  roomOnline: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  onlineIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00B894' },
  roomOnlineText: { fontSize: 11, color: '#00B894', fontWeight: '500' },
  roomMembers: { fontSize: 10, color: C.textLight },
});
