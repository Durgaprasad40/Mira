import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
  Image,
  SectionList,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoOnlineUser } from '@/lib/demoData';

const C = INCOGNITO_COLORS;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PANEL_WIDTH = SCREEN_WIDTH * 0.78;

function formatLastSeen(timestamp?: number): string {
  if (!timestamp) return 'Last seen: a while ago';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Last seen: just now';
  if (mins < 60) return `Last seen: ${mins} min${mins > 1 ? 's' : ''} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last seen: ${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `Last seen: ${days} day${days > 1 ? 's' : ''} ago`;
}

interface OnlineUsersPanelProps {
  visible: boolean;
  onClose: () => void;
  users: DemoOnlineUser[];
  onUserPress?: (user: DemoOnlineUser) => void;
}

type SectionData = {
  title: string;
  data: DemoOnlineUser[];
};

export default function OnlineUsersPanel({
  visible,
  onClose,
  users,
  onUserPress,
}: OnlineUsersPanelProps) {
  const translateX = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: visible ? 0 : SCREEN_WIDTH,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
    if (!visible) {
      setSearchQuery('');
    }
  }, [visible]);

  const sections = useMemo((): SectionData[] => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? users.filter((u) => u.username.toLowerCase().includes(q))
      : users;

    const online = filtered.filter((u) => u.isOnline);
    const offline = filtered.filter((u) => !u.isOnline);

    const result: SectionData[] = [];
    if (online.length > 0) result.push({ title: 'Online', data: online });
    if (offline.length > 0) result.push({ title: 'Offline', data: offline });
    return result;
  }, [users, searchQuery]);

  const onlineCount = users.filter((u) => u.isOnline).length;

  const renderUser = ({ item }: { item: DemoOnlineUser }) => (
    <TouchableOpacity
      style={styles.userRow}
      onPress={() => onUserPress?.(item)}
      activeOpacity={0.7}
    >
      {item.avatar ? (
        <View style={styles.avatarContainer}>
          <Image source={{ uri: item.avatar }} style={styles.userAvatar} />
          {item.isOnline && <View style={styles.onlineDot} />}
        </View>
      ) : (
        <View style={styles.avatarContainer}>
          <View style={styles.userAvatarPlaceholder}>
            <Ionicons name="person" size={14} color={C.textLight} />
          </View>
          {item.isOnline && <View style={styles.onlineDot} />}
        </View>
      )}
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.username}</Text>
        {!item.isOnline && (
          <Text style={styles.lastSeen}>{formatLastSeen(item.lastSeen)}</Text>
        )}
      </View>
      {!item.isOnline && (
        <Text style={styles.offlineLabel}>Offline</Text>
      )}
    </TouchableOpacity>
  );

  const renderSectionHeader = ({ section }: { section: SectionData }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      {section.title === 'Online' && (
        <View style={styles.onlineCountBadge}>
          <Text style={styles.onlineCountText}>{onlineCount}</Text>
        </View>
      )}
    </View>
  );

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <Animated.View
        style={[styles.panel, { transform: [{ translateX }] }]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Users</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={onClose} style={styles.closeIcon}>
            <Ionicons name="close" size={22} color={C.text} />
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={C.textLight} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users…"
            placeholderTextColor={C.textLight}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={16} color={C.textLight} />
            </TouchableOpacity>
          )}
        </View>

        {/* User list with sections */}
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          renderSectionHeader={renderSectionHeader}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={36} color={C.textLight} />
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          }
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  panel: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: C.surface,
    borderLeftWidth: 1,
    borderLeftColor: C.accent,
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  closeIcon: {
    padding: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.background,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 6,
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: C.accent,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    paddingVertical: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  onlineCountBadge: {
    backgroundColor: '#00B894',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  onlineCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listContent: {
    paddingBottom: 40,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  avatarContainer: {
    position: 'relative',
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  userAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00B894',
    borderWidth: 2,
    borderColor: C.surface,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  lastSeen: {
    fontSize: 10,
    color: C.textLight,
    marginTop: 1,
  },
  offlineLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: C.textLight,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    color: C.textLight,
  },
});
