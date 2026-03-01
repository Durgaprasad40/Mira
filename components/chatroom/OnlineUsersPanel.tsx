import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Animated,
  StyleSheet,
  Dimensions,
  Image,
  SectionList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoOnlineUser } from '@/lib/demoData';

const C = INCOGNITO_COLORS;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PANEL_WIDTH = SCREEN_WIDTH * 0.78;

// Time constants for online/offline grouping
const GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes grace
const OFFLINE_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours max

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

// Phase-2: Extended user type with optional penalty
interface OnlineUserWithPenalty extends DemoOnlineUser {
  penalty?: { type: 'readOnly'; expiresAt: number } | null;
}

interface OnlineUsersPanelProps {
  visible: boolean;
  onClose: () => void;
  users: OnlineUserWithPenalty[];
  onUserPress?: (user: OnlineUserWithPenalty) => void;
}

type SectionData = {
  title: string;
  data: OnlineUserWithPenalty[];
};

// Helper: Get display name for sorting (null-safe)
function getDisplayName(user: OnlineUserWithPenalty): string {
  return (user.username || '').toLowerCase();
}

export default function OnlineUsersPanel({
  visible,
  onClose,
  users,
  onUserPress,
}: OnlineUsersPanelProps) {
  const translateX = useRef(new Animated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: visible ? 0 : SCREEN_WIDTH,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [visible]);

  const sections = useMemo((): SectionData[] => {
    const now = Date.now();

    // Online: currently online OR last seen within grace period
    const online = users
      .filter((u) => {
        if (u.isOnline) return true;
        if (u.lastSeen && now - u.lastSeen <= GRACE_PERIOD_MS) return true;
        return false;
      })
      .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));

    // Offline: not online, outside grace period, but within max age
    const offline = users
      .filter((u) => {
        if (u.isOnline) return false;
        if (u.lastSeen && now - u.lastSeen <= GRACE_PERIOD_MS) return false;
        // Must have lastSeen within max age
        if (!u.lastSeen) return false;
        return now - u.lastSeen <= OFFLINE_MAX_AGE_MS;
      })
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    const result: SectionData[] = [];
    if (online.length > 0) result.push({ title: 'Online', data: online });
    if (offline.length > 0) result.push({ title: 'Offline', data: offline });
    return result;
  }, [users]);

  // Count includes grace-period users
  const onlineCount = useMemo(() => {
    const now = Date.now();
    return users.filter((u) => {
      if (u.isOnline) return true;
      if (u.lastSeen && now - u.lastSeen <= GRACE_PERIOD_MS) return true;
      return false;
    }).length;
  }, [users]);

  const renderUser = ({ item }: { item: OnlineUserWithPenalty }) => (
    <Pressable
      style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.7 }]}
      onPress={(e) => {
        e.stopPropagation?.();
        if (__DEV__) console.log('[TAP] active_member press fired', { id: item.id, t: Date.now() });
        onUserPress?.(item);
      }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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
      {/* Phase-2: Show Read-only badge if user has penalty */}
      {item.penalty ? (
        <View style={styles.readOnlyBadge}>
          <Text style={styles.readOnlyBadgeText}>Read-only</Text>
        </View>
      ) : !item.isOnline ? (
        <Text style={styles.offlineLabel}>Offline</Text>
      ) : null}
    </Pressable>
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
  // Phase-2: Read-only badge styles
  readOnlyBadge: {
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  readOnlyBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FF9800',
  },
});
